// --- START OF FILE js/history.js ---

let history = [];
let historyIndex = -1;
let canvasStateRef = null;

/**
 * Создает глубокую, но "чистую" копию слоев для хранения в истории.
 * Удаляет несериализуемые свойства, такие как pdfDoc, image и renderedPages.
 * @param {Array<Object>} layers - Массив слоев для клонирования.
 * @returns {Array<Object>} "Чистая" копия массива слоев для истории.
 */
function cloneLayers(layers) {
    // Используем JSON.stringify с replacer-функцией для глубокого клонирования
    // и одновременного удаления проблемных ключей.
    // Это самый надежный способ избежать циклических ссылок и сложных объектов.
    const replacer = (key, value) => {
        if (key === 'image' || key === 'pdfDoc' || key === 'renderedPages') {
            return undefined; // Удаляем эти ключи из результирующего JSON
        }
        return value;
    };
    
    // Преобразуем в строку и обратно, чтобы получить глубокую копию без ссылок
    return JSON.parse(JSON.stringify(layers, replacer));
}

export function initHistory(canvasState) {
    canvasStateRef = canvasState;
}

export function saveState(layers, addToHistory = true) {
    if (addToHistory) {
        if (historyIndex < history.length - 1) {
            history.splice(historyIndex + 1);
        }
        if (history.length > 50) {
            history.shift();
        }
        // В историю кладем уже очищенную и безопасную копию
        history.push(cloneLayers(layers));
        historyIndex = history.length - 1;
    }

    try {
        // Готовим слои для сохранения в localStorage, здесь своя логика сериализации
        const serializableLayers = layers.map(layer => {
            const newLayer = { ...layer };

            // Для изображений - конвертируем в data URL
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
            
            // Для PDF - удаляем "живые" объекты
            if (layer.type === 'pdf') {
                delete newLayer.pdfDoc;
                delete newLayer.renderedPages;
            }

            return newLayer;
        });

        const dataToSave = {
            viewState: {
                panX: canvasStateRef ? canvasStateRef.panX : 0,
                panY: canvasStateRef ? canvasStateRef.panY : 0,
                zoom: canvasStateRef ? canvasStateRef.zoom : 1
            },
            layers: serializableLayers
        };

        localStorage.setItem('drawingBoard', JSON.stringify(dataToSave));
    } catch (e) {
        console.error("Не удалось сохранить состояние доски:", e);
    }
}

export function undo() {
    if (!canUndo()) return null;
    historyIndex--;
    // При восстановлении из истории мы снова делаем глубокую копию,
    // чтобы изменения в `canvasState.layers` не затронули саму историю.
    return cloneLayers(history[historyIndex]);
}

export function redo() {
    if (!canRedo()) return null;
    historyIndex++;
    return cloneLayers(history[historyIndex]);
}

export function canUndo() {
    return historyIndex > 0;
}

export function canRedo() {
    return historyIndex < history.length - 1;
}

export function resetHistory() {
    history.length = 0;
    historyIndex = -1;
}

// --- END OF FILE js/history.js ---