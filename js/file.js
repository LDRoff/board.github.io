import { processImageFile, processPdfFile, serializeLayers, getMousePos } from './utils.js';

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

    // --- НАЧАЛО ИЗМЕНЕНИЙ: Централизованная обработка Drag-and-Drop ---
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
        
        if (e.dataTransfer.files.length > 0) {
            const file = e.dataTransfer.files[0];
            if (file.type.startsWith('image/')) {
                processImageFile(file, pos, canvasState, redrawCallback, saveState);
            } else if (file.type === 'application/pdf') {
                processPdfFile(file, pos, canvasState, redrawCallback, saveState);
            }
        }
    });
    // --- КОНЕЦ ИЗМЕНЕНИЙ ---
}