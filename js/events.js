// --- START OF FILE js/events.js ---

import { getEditorTextarea } from './text.js';
import { getGroupBoundingBox } from './geometry.js';
import { drawLayer } from './renderer.js'; 
import * as utils from './utils.js';

const shapes2DOrder = ['rect', 'ellipse', 'line', 'curve', 'parallelogram', 'triangle', 'trapezoid', 'rhombus'];
const shapes3DOrder = ['sphere', 'cone', 'parallelepiped', 'pyramid', 'frustum', 'truncated-pyramid', 'truncated-sphere'];
const CUSTOM_MIME_TYPE = 'web application/x-drawing-board-layers+json';

export async function copySelectionToClipboard(canvasState, cut = false) {
    if (canvasState.selectedLayers.length === 0) return;
    if (!navigator.clipboard || !navigator.clipboard.write) {
        console.warn('Clipboard API не поддерживается или недоступен в этом контексте (требуется HTTPS).');
        alert('Функция копирования недоступна в вашем браузере (требуется HTTPS).');
        return;
    }

    try {
        const layersJson = JSON.stringify(canvasState.selectedLayers.map(layer => {
            const clonedLayer = { ...layer };
            delete clonedLayer.image;
            // --- НАЧАЛО ИЗМЕНЕНИЙ: Удаляем несериализуемые PDF-данные ---
            delete clonedLayer.pdfDoc;
            delete clonedLayer.renderedPages;
            // --- КОНЕЦ ИЗМЕНЕНИЙ ---
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
            drawLayer(offscreenCtx, layer, { zoom: 1 });
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
            canvasState.saveState(canvasState.layers);
            canvasState.redraw();
            canvasState.updateFloatingToolbar();
        }

    } catch (err) {
        console.error('Не удалось скопировать в буфер обмена:', err);
        alert('Не удалось скопировать. Убедитесь, что вы предоставили разрешение на доступ к буферу обмена.');
    }
}

export async function pasteFromClipboard(canvasState) {
    if (!navigator.clipboard || !navigator.clipboard.read) {
        console.warn('Clipboard API не поддерживается или недоступен в этом контексте (требуется HTTPS).');
        alert('Функция вставки недоступна в вашем браузере (требуется HTTPS).');
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
                
                // --- НАЧАЛО ИЗМЕНЕНИЙ: Правильная логика вставки с "оживлением" ---
                const offset = 20 / canvasState.zoom;
                layersToPaste.forEach(layer => {
                    layer.id = Date.now() + Math.random();

                    if (layer.x !== undefined) { layer.x += offset; layer.y += offset; }
                    if (layer.cx !== undefined) { layer.cx += offset; layer.cy += offset; }
                    if (layer.x1 !== undefined) { layer.x1 += offset; layer.y1 += offset; layer.x2 += offset; layer.y2 += offset; }
                    if (layer.points) { layer.points.forEach(p => { p.x += offset; p.y += offset; }); }
                    if (layer.nodes) { layer.nodes.forEach(n => {
                        if (n.p) { n.p.x += offset; n.p.y += offset; }
                        if (n.h1) { n.h1.x += offset; n.h1.y += offset; }
                        if (n.h2) { n.h2.x += offset; n.h2.y += offset; }
                    });}
                    if (layer.p1) {
                        const points = ['p1', 'p2', 'p3', 'p4', 'base', 'top', 'apex'];
                        for (const key of points) {
                            if (layer[key]?.x) { layer[key].x += offset; layer[key].y += offset; }
                            else if (typeof layer[key] === 'object') {
                                for (const subKey in layer[key]) {
                                    if (layer[key][subKey]?.x) { layer[key][subKey].x += offset; layer[key][subKey].y += offset; }
                                }
                            }
                        }
                    }
                });

                const liveLayers = await utils.rehydrateLayers(layersToPaste);
                
                canvasState.layers.push(...liveLayers);
                canvasState.selectedLayers = liveLayers;
                // --- КОНЕЦ ИЗМЕНЕНИЙ ---
                
                const selectButton = document.querySelector('button[data-tool="select"]');
                if (selectButton) selectButton.click();
                canvasState.saveState(canvasState.layers);
                canvasState.redraw();
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
                        x: (canvasState.canvas.width / 2 - canvasState.panX) / canvasState.zoom,
                        y: (canvasState.canvas.height / 2 - canvasState.panY) / canvasState.zoom
                    };
                    const img = new Image();
                    img.onload = () => {
                        const newLayer = { type: 'image', image: img, x: centerPos.x - img.width / 2, y: centerPos.y - img.height / 2, width: img.width, height: img.height, id: Date.now(), rotation: 0, pivot: { x: 0, y: 0 } };
                        canvasState.layers.push(newLayer);
                        canvasState.selectedLayers = [newLayer];
                        const selectButton = document.querySelector('button[data-tool="select"]');
                        if (selectButton) selectButton.click();
                        canvasState.saveState(canvasState.layers);
                        canvasState.redraw();
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
        // alert('Не удалось вставить. Убедитесь, что вы предоставили разрешение на доступ к буферу обмена.');
    }
}

export function initializeEventListeners(canvasState, handlers) {
    const { 
        performUndo, performRedo,
        performDeleteSelectedCurveNode
    } = handlers;
    
    const drawingCanvas = canvasState.canvas;

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
                    copySelectionToClipboard(canvasState, false);
                    break;
                case 'KeyX':
                    e.preventDefault();
                    copySelectionToClipboard(canvasState, true);
                    break;
                case 'KeyV':
                    e.preventDefault();
                    pasteFromClipboard(canvasState);
                    break;
            }
            return;
        }
        
        if (e.code === 'Enter') {
            if (canvasState.currentAction === 'drawingCurve' && canvasState.tempLayer) {
                e.preventDefault();
                if (canvasState.tempLayer.nodes.length > 1) {
                    canvasState.layers.push(canvasState.tempLayer);
                    canvasState.saveState(canvasState.layers);
                }
                canvasState.currentAction = 'none';
                canvasState.tempLayer = null;
                canvasState.redraw();
                return;
            }
        }

        switch (e.code) {
            case 'Escape':
                e.preventDefault();
                if (canvasState.currentAction.startsWith('drawing')) {
                    canvasState.currentAction = 'none';
                    canvasState.tempLayer = null;
                    canvasState.redraw();
                }
                else if (canvasState.isEditingText) {
                    const textarea = getEditorTextarea();
                    if (textarea) textarea.blur();
                }
                else if (canvasState.selectedLayers.length > 0) {
                    canvasState.selectedLayers.forEach(layer => utils.applyTransformations(layer));
                    canvasState.saveState(canvasState.layers);
                    canvasState.selectedLayers = [];
                    canvasState.selectedCurveNodeIndex = null;
                    canvasState.redraw();
                    canvasState.updateFloatingToolbar();
                }
                break;

            case 'Delete':
            case 'Backspace':
                if (canvasState.selectedCurveNodeIndex !== null) {
                    e.preventDefault();
                    performDeleteSelectedCurveNode();
                } else if (canvasState.selectedLayers.length > 0) {
                    e.preventDefault();
                    const idsToDelete = new Set(canvasState.selectedLayers.map(l => l.id));
                    canvasState.layers = canvasState.layers.filter(layer => !idsToDelete.has(layer.id));
                    canvasState.selectedLayers = [];
                    canvasState.saveState(canvasState.layers);
                    canvasState.redraw();
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
        pasteFromClipboard(canvasState);
    });


    // --- Resize Event ---
    window.addEventListener('resize', () => {
        handlers.setupCanvases();
        if (canvasState) {
            canvasState.updateFloatingToolbar();
            handlers.updateSubToolbarVisibility();
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