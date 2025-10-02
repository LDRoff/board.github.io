// --- START OF FILE js/events.js ---

import { getEditorTextarea } from './text.js';

let clipboard = null;
const shapes2DOrder = ['rect', 'ellipse', 'line', 'parallelogram', 'triangle', 'trapezoid', 'rhombus'];
const shapes3DOrder = ['sphere', 'cone', 'parallelepiped', 'pyramid', 'frustum', 'truncated-pyramid', 'truncated-sphere'];

export function initializeEventListeners(canvasState, handlers) {
    const { 
        performUndo, performRedo, performSaveState, 
        redraw, setupCanvases, updateSubToolbarVisibility 
    } = handlers;
    
    const drawingCanvas = canvasState.canvas;

    // --- Keyboard Events ---
    window.addEventListener('keydown', (e) => {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') {
            return;
        }

        if (e.ctrlKey || e.metaKey) {
            switch (e.code) {
                case 'KeyZ': e.preventDefault(); performUndo(); break;
                case 'KeyY': e.preventDefault(); performRedo(); break;
                case 'KeyC':
                    e.preventDefault();
                    if (canvasState.selectedLayers.length > 0) {
                        clipboard = JSON.stringify(canvasState.selectedLayers.map(layer => {
                            const clonedLayer = { ...layer };
                            if (layer.type === 'image' && layer.image instanceof HTMLImageElement) {
                                const tempCanvas = document.createElement('canvas');
                                tempCanvas.width = layer.image.naturalWidth;
                                tempCanvas.height = layer.image.naturalHeight;
                                const tempCtx = tempCanvas.getContext('2d');
                                tempCtx.drawImage(layer.image, 0, 0);
                                clonedLayer.src = tempCanvas.toDataURL();
                            }
                            delete clonedLayer.image;
                            return clonedLayer;
                        }));
                    }
                    break;
                case 'KeyX':
                    e.preventDefault();
                    if (canvasState.selectedLayers.length > 0) {
                        clipboard = JSON.stringify(canvasState.selectedLayers.map(layer => {
                            const clonedLayer = { ...layer };
                            if (layer.type === 'image' && layer.image instanceof HTMLImageElement) {
                                const tempCanvas = document.createElement('canvas');
                                tempCanvas.width = layer.image.naturalWidth;
                                tempCanvas.height = layer.image.naturalHeight;
                                const tempCtx = tempCanvas.getContext('2d');
                                tempCtx.drawImage(layer.image, 0, 0);
                                clonedLayer.src = tempCanvas.toDataURL();
                            }
                            delete clonedLayer.image;
                            return clonedLayer;
                        }));
                        const idsToDelete = new Set(canvasState.selectedLayers.map(l => l.id));
                        canvasState.layers = canvasState.layers.filter(layer => !idsToDelete.has(layer.id));
                        canvasState.selectedLayers = [];
                        performSaveState(canvasState.layers);
                        redraw();
                        canvasState.updateFloatingToolbar();
                    }
                    break;
            }
            return;
        }

        switch (e.code) {
            case 'Escape':
                e.preventDefault();
                if (canvasState.currentAction.startsWith('drawing')) {
                    canvasState.currentAction = 'none';
                    canvasState.tempLayer = null;
                    redraw();
                }
                else if (canvasState.isEditingText) {
                    const textarea = getEditorTextarea();
                    if (textarea) textarea.blur();
                }
                else if (canvasState.selectedLayers.length > 0) {
                    canvasState.selectedLayers = [];
                    redraw();
                    canvasState.updateFloatingToolbar();
                }
                break;

            case 'Delete':
            case 'Backspace':
                if (canvasState.selectedLayers.length > 0) {
                    e.preventDefault();
                    const idsToDelete = new Set(canvasState.selectedLayers.map(l => l.id));
                    canvasState.layers = canvasState.layers.filter(layer => !idsToDelete.has(layer.id));
                    canvasState.selectedLayers = [];
                    performSaveState(canvasState.layers);
                    redraw();
                    canvasState.updateFloatingToolbar();
                }
                break;

            case 'KeyV':
                e.preventDefault();
                document.querySelector('button[data-tool="select"]')?.click();
                drawingCanvas.focus({ preventScroll: true });
                break;
            case 'KeyB':
                e.preventDefault();
                const currentTool = canvasState.activeTool;
                if (currentTool === 'brush') {
                    document.querySelector('button[data-tool="smart-brush"]')?.click();
                } else {
                    document.querySelector('button[data-tool="brush"]')?.click();
                }
                drawingCanvas.focus({ preventScroll: true });
                break;
            case 'KeyE':
                e.preventDefault();
                document.querySelector('button[data-tool="eraser"]')?.click();
                drawingCanvas.focus({ preventScroll: true });
                break;
            case 'KeyT':
                e.preventDefault();
                document.querySelector('button[data-tool="text"]')?.click();
                drawingCanvas.focus({ preventScroll: true });
                break;
            case 'KeyS':
                e.preventDefault();
                const current2DIndex = shapes2DOrder.indexOf(canvasState.activeTool);
                const next2DIndex = (current2DIndex === -1) ? 0 : (current2DIndex + 1) % shapes2DOrder.length;
                const next2DTool = shapes2DOrder[next2DIndex];
                const shape2DLink = document.querySelector(`#shapes2DOptions a[data-tool="${next2DTool}"]`);
                if (shape2DLink) {
                    shape2DLink.click();
                }
                drawingCanvas.focus({ preventScroll: true });
                break;
            case 'KeyD':
                e.preventDefault();
                const current3DIndex = shapes3DOrder.indexOf(canvasState.activeTool);
                const next3DIndex = (current3DIndex === -1) ? 0 : (current3DIndex + 1) % shapes3DOrder.length;
                const next3DTool = shapes3DOrder[next3DIndex];
                const shape3DLink = document.querySelector(`#shapes3DOptions a[data-tool="${next3DTool}"]`);
                if (shape3DLink) {
                    shape3DLink.click();
                }
                drawingCanvas.focus({ preventScroll: true });
                break;
            case 'KeyI':
                e.preventDefault();
                document.getElementById('addImageBtn')?.click();
                drawingCanvas.focus({ preventScroll: true });
                break;
        }
    });

    // --- Paste Event ---
    window.addEventListener('paste', (e) => {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') {
            return;
        }
        e.preventDefault();

        let imagePasted = false;
        const items = e.clipboardData.items;

        for (const item of items) {
            if (item.kind === 'file' && item.type.startsWith('image/')) {
                const file = item.getAsFile();
                const centerPos = {
                    x: (drawingCanvas.width / 2 - canvasState.panX) / canvasState.zoom,
                    y: (drawingCanvas.height / 2 - canvasState.panY) / canvasState.zoom
                };
                const reader = new FileReader();
                reader.onload = (event) => {
                    const img = new Image();
                    img.onload = () => {
                        const newLayer = { type: 'image', image: img, x: centerPos.x - img.width / 2, y: centerPos.y - img.height / 2, width: img.width, height: img.height, id: Date.now(), rotation: 0, pivot: { x: 0, y: 0 } };
                        canvasState.layers.push(newLayer);
                        canvasState.selectedLayers = [newLayer];
                        const selectButton = document.querySelector('button[data-tool="select"]');
                        if (selectButton) {
                            selectButton.click();
                        }
                        performSaveState(canvasState.layers);
                        redraw();
                        canvasState.updateFloatingToolbar();
                    };
                    img.src = event.target.result;
                };
                reader.readAsDataURL(file);
                imagePasted = true;
                break;
            }
        }

        if (!imagePasted && clipboard) {
            try {
                const layersToPaste = JSON.parse(clipboard);
                const newLayers = [];

                layersToPaste.forEach(layer => {
                    const newLayer = { ...layer };
                    newLayer.id = Date.now() + Math.random();

                    const offset = 20 / canvasState.zoom;

                    if (newLayer.x !== undefined) { newLayer.x += offset; newLayer.y += offset; }
                    if (newLayer.cx !== undefined) { newLayer.cx += offset; newLayer.cy += offset; }
                    if (newLayer.x1 !== undefined) { newLayer.x1 += offset; newLayer.y1 += offset; newLayer.x2 += offset; newLayer.y2 += offset; }
                    if (newLayer.points) { newLayer.points.forEach(p => { p.x += offset; p.y += offset; }); }
                    if (newLayer.p1) {
                        const points = ['p1', 'p2', 'p3', 'p4', 'base', 'top', 'apex'];
                        for (const key of points) {
                            if (newLayer[key]?.x) { newLayer[key].x += offset; newLayer[key].y += offset; }
                            else if (typeof newLayer[key] === 'object') {
                                for (const subKey in newLayer[key]) {
                                    if (newLayer[key][subKey]?.x) { newLayer[key][subKey].x += offset; newLayer[key][subKey].y += offset; }
                                }
                            }
                        }
                    }

                    if (newLayer.type === 'image' && newLayer.src) {
                        const img = new Image();
                        img.onload = () => {
                            newLayer.image = img;
                            redraw();
                        }
                        img.src = newLayer.src;
                    }

                    canvasState.layers.push(newLayer);
                    newLayers.push(newLayer);
                });

                canvasState.selectedLayers = newLayers;

                const selectButton = document.querySelector('button[data-tool="select"]');
                if (selectButton) {
                    selectButton.click();
                }

                performSaveState(canvasState.layers);
                redraw();
                canvasState.updateFloatingToolbar();

            } catch (err) {
                console.error("Не удалось вставить из буфера обмена:", err);
            }
        }
    });

    // --- Resize Event ---
    window.addEventListener('resize', () => {
        setupCanvases();
        if (canvasState) {
            canvasState.updateFloatingToolbar();
            updateSubToolbarVisibility();
        }

        const toolbarWrapper = document.getElementById('toolbarWrapper');
        if (toolbarWrapper) {
            toolbarWrapper.style.left = '';
            toolbarWrapper.style.transform = '';
        }
    });

    // --- Zoom Buttons ---
    document.getElementById('zoomInBtn').addEventListener('click', () => {
        if (canvasState && typeof canvasState.performZoom === 'function') {
            canvasState.performZoom('in');
        }
    });

    document.getElementById('zoomOutBtn').addEventListener('click', () => {
        if (canvasState && typeof canvasState.performZoom === 'function') {
            canvasState.performZoom('out');
        }
    });
}

// --- END OF FILE js/events.js ---