import { processImageFile, processPdfFile, serializeLayers, getMousePos } from './utils.js';


async function tryLoadImageFromUrl(url, pos, canvasState, redrawCallback, saveState) {
    try {
        // Basic sanity
        if (!url) return false;
        // Some drags give data: URIs or http(s) links
        // We only attempt http(s)/data/blob urls
        if (!/^https?:|^data:|^blob:/.test(url)) return false;
        // Fetch to Blob (CORS must allow it)
        const res = await fetch(url);
        if (!res.ok) return false;
        const blob = await res.blob();
        if (!blob.type.startsWith('image/')) return false;
        const file = new File([blob], 'dropped.' + (blob.type.split('/')[1] || 'png'), { type: blob.type });
        processImageFile(file, pos, canvasState, redrawCallback, saveState);
        return true;
    } catch (e) {
        console.warn('Не удалось загрузить картинку по ссылке из drop:', e);
        return false;
    }
}

export function initializeFileHandlers(canvasState, loadState, redrawCallback, saveState) {
    const drawingCanvas = canvasState.canvas;
    const backgroundCanvas = document.getElementById('backgroundCanvas');

    // --- Export to JPG ---
    document.getElementById('exportJpgBtn').addEventListener('click', (e) => {
        e.preventDefault();
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = drawingCanvas.width;
        tempCanvas.height = drawingCanvas.height;
        const tempCtx = tempCanvas.getContext('2d');

        tempCtx.fillStyle = window.getComputedStyle(backgroundCanvas).backgroundColor || '#FFFFFF';
        tempCtx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);

        tempCtx.drawImage(backgroundCanvas, 0, 0);
        tempCtx.drawImage(drawingCanvas, 0, 0);
        const link = document.createElement('a');
        link.download = 'my-board.jpg';
        link.href = tempCanvas.toDataURL('image/jpeg', 0.95);
        link.click();
    });

    // --- Save Project ---
    document.getElementById('saveProjectBtn').addEventListener('click', (e) => {
        e.preventDefault();
        
        const projectData = {
            viewState: {
                panX: canvasState.panX,
                panY: canvasState.panY,
                zoom: canvasState.zoom
            },
            layers: serializeLayers(canvasState.layers)
        };

        const dataStr = JSON.stringify(projectData);
        const blob = new Blob([dataStr], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.download = 'project.board';
        link.href = url;
        link.click();
        URL.revokeObjectURL(url);
    });

    // --- Open Project ---
    const projectUploadInput = document.getElementById('projectUpload');
    document.getElementById('openProjectBtn').addEventListener('click', (e) => {
        e.preventDefault();
        projectUploadInput.click();
    });

    projectUploadInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event) => {
            loadState(event.target.result);
        };
        reader.onerror = () => {
            console.error("Не удалось прочитать файл.");
            alert("Ошибка при чтении файла.");
        }
        reader.readAsText(file);
        e.target.value = null;
    });

    // --- Image Upload Logic ---
    const imageUploadInput = document.getElementById('imageUpload');

    imageUploadInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const centerPos = {
            x: (drawingCanvas.width / 2 - canvasState.panX) / canvasState.zoom,
            y: (drawingCanvas.height / 2 - canvasState.panY) / canvasState.zoom
        };

        processImageFile(file, centerPos, canvasState, redrawCallback, saveState);
        
        e.target.value = null;
    });

    // --- PDF Upload Logic ---
    const pdfUploadInput = document.getElementById('pdfUpload');

    pdfUploadInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const centerPos = {
            x: (drawingCanvas.width / 2 - canvasState.panX) / canvasState.zoom,
            y: (drawingCanvas.height / 2 - canvasState.panY) / canvasState.zoom
        };

        processPdfFile(file, centerPos, canvasState, redrawCallback, saveState);

        e.target.value = null;
    });

    // --- Централизованная обработка Drag-and-Drop ---
    const dropZone = document.body; // Слушаем на всем body для удобства

    dropZone.addEventListener('dragenter', (e) => {
        e.preventDefault();
        e.stopPropagation();
        // Показываем оверлей, только если перетаскивается файл
        if (e.dataTransfer.types.includes('Files')) {
            document.body.classList.add('drag-over');
        }
    });

    dropZone.addEventListener('dragleave', (e) => {
        e.preventDefault();
        e.stopPropagation();
        // Убираем подсветку, если курсор покинул окно
        if (e.relatedTarget === null || e.target === document.body) {
             document.body.classList.remove('drag-over');
        }
    });

    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault(); 
        e.stopPropagation();
    });
    
    dropZone.addEventListener('drop', (e) => { 
        e.preventDefault(); 
        e.stopPropagation();
        document.body.classList.remove('drag-over');

        // Используем getMousePos, чтобы координаты были относительно холста
        const pos = getMousePos(e, canvasState); 
        
        let file = null;

        // --- НАЧАЛО ИЗМЕНЕНИЙ: Более надежный способ получения файла ---
        // Приоритет 1: Проверяем e.dataTransfer.items - это часто работает лучше на Android.
        if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
            // Итерируем в поиске первого элемента, который является файлом.
            for (let i = 0; i < e.dataTransfer.items.length; i++) {
                if (e.dataTransfer.items[i].kind === 'file') {
                    file = e.dataTransfer.items[i].getAsFile();
                    break; // Берем только первый найденный файл.
                }
            }
        } 
        // Приоритет 2 (Fallback): Если .items не сработал или пуст, пробуем старый метод .files.
        else if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            file = e.dataTransfer.files[0];
        }
        
        // NEW: If no File yet, try URLs from DataTransfer
        if (!file) {
            let url = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain');
            if (url) {
                const ok = await tryLoadImageFromUrl(url.trim(), pos, canvasState, redrawCallback, saveState);
                if (ok) return; // handled
            }
        }

        // NEW: If items contain HTML with <img>, try to extract first image src
        if (!file && e.dataTransfer.items) {
            for (const it of e.dataTransfer.items) {
                if (it.type === 'text/html') {
                    try {
                        const html = await new Promise(resolve => it.getAsString(resolve));
                        const m = html && html.match(/<img[^>]+src=["']([^"']+)["']/i);
                        if (m && m[1]) {
                            const ok = await tryLoadImageFromUrl(m[1], pos, canvasState, redrawCallback, saveState);
                            if (ok) return; // handled
                        }
                    } catch {}
                }
            }
        }
    // --- КОНЕЦ ИЗМЕНЕНИЙ ---

        if (file) {
            if (file.type.startsWith('image/')) {
                processImageFile(file, pos, canvasState, redrawCallback, saveState);
            } else if (file.type === 'application/pdf') {
                processPdfFile(file, pos, canvasState, redrawCallback, saveState);
            }
        }
    });
}