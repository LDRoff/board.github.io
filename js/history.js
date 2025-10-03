// --- START OF FILE js/history.js ---

let history = [];
let historyIndex = -1;
let canvasStateRef = null;

function cloneLayers(layers) {
    return layers.map(l => {
        const n = { ...l };
        if (l.points) {
            n.points = l.points.map(p => ({ ...p }));
        }
        return n;
    });
}

export function initHistory(canvasState) {
    canvasStateRef = canvasState;
}

export function saveState(layers) {
    if (historyIndex < history.length - 1) {
        history.splice(historyIndex + 1);
    }
    if (history.length > 50) {
        history.shift();
    }
    history.push(cloneLayers(layers));
    historyIndex = history.length - 1;

    try {
        const serializableLayers = layers.map(layer => {
            if (layer.type === 'image' && layer.image instanceof HTMLImageElement) {
                const newLayer = { ...layer };
                if (!newLayer.src || !newLayer.src.startsWith('data:')) {
                    const tempCanvas = document.createElement('canvas');
                    tempCanvas.width = newLayer.image.naturalWidth;
                    tempCanvas.height = newLayer.image.naturalHeight;
                    const tempCtx = tempCanvas.getContext('2d');
                    tempCtx.drawImage(newLayer.image, 0, 0);
                    newLayer.src = tempCanvas.toDataURL();
                }
                delete newLayer.image;
                return newLayer;
            }
            return layer;
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