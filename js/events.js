// --- START OF FILE js/events.js ---

import { getEditorTextarea } from './text.js';
import { getGroupBoundingBox } from './geometry.js';
import { drawLayer } from './renderer.js'; 

const shapes2DOrder = ['rect', 'ellipse', 'line', 'parallelogram', 'triangle', 'trapezoid', 'rhombus'];
const shapes3DOrder = ['sphere', 'cone', 'parallelepiped', 'pyramid', 'frustum', 'truncated-pyramid', 'truncated-sphere'];
// --- НАЧАЛО ИЗМЕНЕНИЯ: Исправляем MIME-тип для Clipboard API ---
// Браузеры требуют префикс "web " для нестандартных форматов в целях безопасности.
const CUSTOM_MIME_TYPE = 'web application/x-drawing-board-layers+json';
// --- КОНЕЦ ИЗМЕНЕНИЯ ---

export function initializeEventListeners(canvasState, handlers) {
    const { 
        performUndo, performRedo, performSaveState, 
        redraw, setupCanvases, updateSubToolbarVisibility 
    } = handlers;
    
    const drawingCanvas = canvasState.canvas;

    async function copySelectionToClipboard(cut = false) {
        if (canvasState.selectedLayers.length === 0) return;
        if (!navigator.clipboard || !navigator.clipboard.write) {
            console.warn('Clipboard API не поддерживается или недоступен в этом контексте (требуется HTTPS).');
            return;
        }

        try {
            const layersJson = JSON.stringify(canvasState.selectedLayers.map(layer => {
                const clonedLayer = { ...layer };
                delete clonedLayer.image; 
                if (layer.type === 'image' && layer.image instanceof HTMLImageElement) {
                    const tempCanvas = document.createElement('canvas'); 
                    tempCanvas.width = layer.image.naturalWidth;
                    tempCanvas.height = layer.image.naturalHeight;
                    const tempCtx = tempCanvas.getContext('2d');
                    tempCtx.drawImage(layer.image, 0, 0);
                    clonedLayer.src = tempCanvas.toDataURL();
                }
                return clonedLayer;
            }));
            const jsonBlob = new Blob([layersJson], { type: CUSTOM_MIME_TYPE });

            const box = getGroupBoundingBox(canvasState.selectedLayers);
            if (!box || box.width === 0 || box.height === 0) return;

            const offscreenCanvas = document.createElement('canvas');
            offscreenCanvas.width = box.width;
            offscreenCanvas.height = box.height;
            const offscreenCtx = offscreenCanvas.getContext('2d');

            offscreenCtx.translate(-box.x, -box.y);
            
            canvasState.selectedLayers.forEach(layer => {
                drawLayer(offscreenCtx, layer);
            });

            const pngBlob = await new Promise(resolve => offscreenCanvas.toBlob(resolve, 'image/png'));

            const clipboardItem = new ClipboardItem({
                [CUSTOM_MIME_TYPE]: jsonBlob,
                'image/png': pngBlob
            });
            await navigator.clipboard.write([clipboardItem]);

            if (cut) {
                const idsToDelete = new Set(canvasState.selectedLayers.map(l => l.id));
                canvasState.layers = canvasState.layers.filter(layer => !idsToDelete.has(layer.id));
                canvasState.selectedLayers = [];
                performSaveState(canvasState.layers);
                redraw();
                canvasState.updateFloatingToolbar();
            }

        } catch (err) {
            console.error('Не удалось скопировать в буфер обмена:', err);
        }
    }

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
                    copySelectionToClipboard(false);
                    break;
                case 'KeyX':
                    e.preventDefault();
                    copySelectionToClipboard(true);
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

    window.addEventListener('paste', async (e) => {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') {
            return;
        }
        e.preventDefault();
        if (!navigator.clipboard || !navigator.clipboard.read) {
             console.warn('Clipboard API не поддерживается или недоступен в этом контексте (требуется HTTPS).');
            return;
        }

        try {
            const clipboardItems = await navigator.clipboard.read();
            let contentPasted = false;

            for (const item of clipboardItems) {
                if (item.types.includes(CUSTOM_MIME_TYPE)) {
                    const blob = await item.getType(CUSTOM_MIME_TYPE);
                    const json = await blob.text();
                    const layersToPaste = JSON.parse(json);
                    
                    const newLayers = [];
                    const imageLoadPromises = [];

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
                            const promise = new Promise((resolve, reject) => {
                                const img = new Image();
                                img.onload = () => { newLayer.image = img; resolve(); };
                                img.onerror = reject;
                                img.src = newLayer.src;
                            });
                            imageLoadPromises.push(promise);
                        }

                        canvasState.layers.push(newLayer);
                        newLayers.push(newLayer);
                    });

                    await Promise.all(imageLoadPromises);
                    canvasState.selectedLayers = newLayers;
                    const selectButton = document.querySelector('button[data-tool="select"]');
                    if (selectButton) selectButton.click();
                    performSaveState(canvasState.layers);
                    redraw();
                    canvasState.updateFloatingToolbar();
                    contentPasted = true;
                    break; 
                }
            }

            if (!contentPasted) {
                for (const item of clipboardItems) {
                    const imageType = item.types.find(type => type.startsWith('image/'));
                    if (imageType) {
                        const blob = await item.getType(imageType);
                        const centerPos = {
                            x: (drawingCanvas.width / 2 - canvasState.panX) / canvasState.zoom,
                            y: (drawingCanvas.height / 2 - canvasState.panY) / canvasState.zoom
                        };
                        const img = new Image();
                        img.onload = () => {
                            const newLayer = { type: 'image', image: img, x: centerPos.x - img.width / 2, y: centerPos.y - img.height / 2, width: img.width, height: img.height, id: Date.now(), rotation: 0, pivot: { x: 0, y: 0 } };
                            canvasState.layers.push(newLayer);
                            canvasState.selectedLayers = [newLayer];
                            const selectButton = document.querySelector('button[data-tool="select"]');
                            if (selectButton) selectButton.click();
                            performSaveState(canvasState.layers);
                            redraw();
                            canvasState.updateFloatingToolbar();
                            URL.revokeObjectURL(img.src);
                        };
                        img.src = URL.createObjectURL(blob);
                        break; 
                    }
                }
            }
        } catch (err) {
            console.error('Не удалось вставить из буфера обмена:', err);
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