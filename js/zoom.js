// js/zoom.js
import * as utils from './utils.js';
import { getTransformedBoundingBox } from './geometry.js';

export function performZoom(state, callbacks, direction, zoomCenter) {
    const { redrawCallback, saveViewStateCallback } = callbacks;
    const zoomFactor = 1.1;
    const oldZoom = state.zoom;
    let newZoom = (direction === 'in') ? oldZoom * zoomFactor : oldZoom / zoomFactor;

    state.zoom = Math.max(0.1, Math.min(newZoom, 10));

    if (!zoomCenter) {
        zoomCenter = {
            x: state.canvas.getBoundingClientRect().width / 2,
            y: state.canvas.getBoundingClientRect().height / 2
        };
    }

    state.panX = zoomCenter.x - (zoomCenter.x - state.panX) * (state.zoom / oldZoom);
    state.panY = zoomCenter.y - (zoomCenter.y - state.panY) * (state.zoom / oldZoom);

    // --- НАЧАЛО ИЗМЕНЕНИЙ ---
    // Удалена строка `state.isBBoxCacheDirty = true;`.
    // Кеш Bounding Box'ов хранит мировые координаты объектов, которые не меняются
    // при масштабировании вида. Поэтому инвалидация кеша здесь не требуется.
    // --- КОНЕЦ ИЗМЕНЕНИЙ ---

    if (state.activeTool === 'eraser' && state.canvas) {
        state.canvas.style.cursor = utils.getEraserCursorStyle(state.activeEraserWidth, state.zoom, document.body.classList.contains('dark-theme'));
    }

    if (state.syncTextEditorWithCanvas) {
        state.syncTextEditorWithCanvas(state);
    }

    redrawCallback();
    state.updateFloatingToolbar();
    if (saveViewStateCallback) {
        saveViewStateCallback();
    }
}

export function zoomToFit(state, callbacks) {
    if (!state.layers || state.layers.length === 0) return;

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    let found = false;

    // We calculate the precise bounding box of all objects
    for (const layer of state.layers) {
        let box = state.layerBBoxCache ? state.layerBBoxCache.get(layer.id) : null;
        if (!box) {
            box = getTransformedBoundingBox(layer);
            if (box && state.layerBBoxCache) {
                state.layerBBoxCache.set(layer.id, box);
            }
        }
        if (box) {
            minX = Math.min(minX, box.x);
            minY = Math.min(minY, box.y);
            maxX = Math.max(maxX, box.x + box.width);
            maxY = Math.max(maxY, box.y + box.height);
            found = true;
        }
    }

    const rect = state.canvas.getBoundingClientRect();
    const viewportWidth = rect.width;
    const viewportHeight = rect.height;

    let targetPanX, targetPanY, targetZoom;

    if (!found) {
        targetPanX = viewportWidth / 2;
        targetPanY = viewportHeight / 2;
        targetZoom = 1;
    } else {
        const PADDING = 100; 
        minX -= PADDING;
        minY -= PADDING;
        maxX += PADDING;
        maxY += PADDING;

        const contentWidth = maxX - minX;
        const contentHeight = maxY - minY;
        
        if (contentWidth <= 0 || contentHeight <= 0) return;

        const scaleX = viewportWidth / contentWidth;
        const scaleY = viewportHeight / contentHeight;
        targetZoom = Math.min(scaleX, scaleY);
        targetZoom = Math.max(0.1, Math.min(targetZoom, 10));

        const contentCenterX = minX + contentWidth / 2;
        const contentCenterY = minY + contentHeight / 2;

        targetPanX = (viewportWidth / 2) - (contentCenterX * targetZoom);
        targetPanY = (viewportHeight / 2) - (contentCenterY * targetZoom);
    }

    animateView(state, callbacks, targetPanX, targetPanY, targetZoom);
}

function animateView(state, callbacks, targetPanX, targetPanY, targetZoom) {
    const startPanX = state.panX;
    const startPanY = state.panY;
    const startZoom = state.zoom;
    
    // Very small differences don't need animation
    if (Math.abs(startPanX - targetPanX) < 1 && Math.abs(startPanY - targetPanY) < 1 && Math.abs(startZoom - targetZoom) < 0.01) return;

    // smooth animation
    const duration = 500;
    const startTime = performance.now();
    
    // easeOutCubic
    const ease = (t) => 1 - Math.pow(1 - t, 3);

    function step(currentTime) {
        let progress = (currentTime - startTime) / duration;
        if (progress > 1) progress = 1;
        
        const eased = ease(progress);
        
        state.panX = startPanX + (targetPanX - startPanX) * eased;
        state.panY = startPanY + (targetPanY - startPanY) * eased;
        state.zoom = startZoom + (targetZoom - startZoom) * eased;
        
        if (state.activeTool === 'eraser' && state.canvas) {
            state.canvas.style.cursor = utils.getEraserCursorStyle(state.activeEraserWidth, state.zoom, document.body.classList.contains('dark-theme'));
        }

        if (state.syncTextEditorWithCanvas) {
            state.syncTextEditorWithCanvas(state);
        }

        callbacks.redrawCallback();
        if (state.updateFloatingToolbar) {
            state.updateFloatingToolbar();
        }
        
        if (progress < 1) {
            requestAnimationFrame(step);
        } else {
            if (callbacks.saveViewStateCallback) {
                callbacks.saveViewStateCallback();
            }
        }
    }
    
    requestAnimationFrame(step);
}