// --- START OF FILE js/file.js ---

import { processImageFile, processPdfFile } from './utils.js';

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
        const serializableLayers = canvasState.layers.map(layer => {
            const newLayer = { ...layer };
            if (layer.type === 'image' && layer.image instanceof HTMLImageElement) {
                if (!newLayer.src || !newLayer.src.startsWith('data:')) {
                    const tempCanvas = document.createElement('canvas');
                    tempCanvas.width = newLayer.image.naturalWidth;
                    tempCanvas.height = newLayer.image.naturalHeight;
                    const tempCtx = tempCanvas.getContext('2d');
                    tempCtx.drawImage(newLayer.image, 0, 0);
                    newLayer.src = tempCanvas.toDataURL();
                }
                delete newLayer.image;
            }
            if (layer.type === 'pdf') {
                delete newLayer.pdfDoc;
                delete newLayer.renderedPages;
            }
            return newLayer;
        });

        const projectData = {
            viewState: {
                panX: canvasState.panX,
                panY: canvasState.panY,
                zoom: canvasState.zoom
            },
            layers: serializableLayers
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

    // --- НАЧАЛО ИЗМЕНЕНИЙ: Удаляем дублирующий обработчик клика ---
    // document.getElementById('addImageMenuBtn').addEventListener('click', ...); <- ЭТА СТРОКА УДАЛЕНА
    // --- КОНЕЦ ИЗМЕНЕНИЙ ---

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

    // Кнопка в главном меню (File > Add PDF)
    document.getElementById('addPdfBtnMenu').addEventListener('click', (e) => {
        e.preventDefault();
        pdfUploadInput.click();
    });
    
    // --- НАЧАЛО ИЗМЕНЕНИЙ: Удаляем дублирующий обработчик клика ---
    // document.getElementById('addPdfMenuBtn').addEventListener('click', ...); <- ЭТА СТРОКА УДАЛЕНА
    // --- КОНЕЦ ИЗМЕНЕНИЙ ---

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
}