// js/touchHandlers.js
import { hideEraserCursor } from './ui.js';
import * as utils from './utils.js';

export function handleTouchStart(state, callbacks, e) {
    if (e.touches.length === 2) {
        e.preventDefault();

        // --- ABORT any in-progress drawing/interaction WITHOUT committing ---
        // Do NOT call stopDrawing() here — it would SAVE the partial stroke.
        // Instead, discard everything the first finger started.
        state.isMultiTouching = true;
        state.isDrawing = false;
        state.isPanning = false;
        state.tempLayer = null;           // discard any partial brush stroke / shape
        state.currentAction = 'none';
        state.isInteracting = false;

        hideEraserCursor();

        // Restore selection state to what it was before the first finger accidentally selected
        if (state._preTouchSelectedLayers !== undefined) {
            state.selectedLayers = state._preTouchSelectedLayers;
            delete state._preTouchSelectedLayers;
            if (callbacks && callbacks.updateToolbarCallback) {
                callbacks.updateToolbarCallback();
            }
        }

        // Remove document-level listeners that startDrawing bound for the first finger
        if (state.onPointerMove) document.removeEventListener('pointermove', state.onPointerMove);
        if (state.onPointerUp) document.removeEventListener('pointerup', state.onPointerUp);

        // Clear pointer tracking
        if (state.activePointers) state.activePointers.clear();

        // Clear both interaction canvases
        state.iCtx.setTransform(1, 0, 0, 1, 0, 0);
        state.iCtx.clearRect(0, 0, state.interactionCanvas.width, state.interactionCanvas.height);
        if (state.cacheCtx) {
            state.cacheCtx.setTransform(1, 0, 0, 1, 0, 0);
            state.cacheCtx.clearRect(0, 0, state.cacheCanvas.width, state.cacheCanvas.height);
        }

        // Redraw the main canvas cleanly (without the discarded partial stroke)
        if (callbacks && callbacks.redrawCallback) {
            callbacks.redrawCallback();
        }
        // ---------------------------------------------------------------

        const t1 = e.touches[0];
        const t2 = e.touches[1];

        state.multiTouchState.initialDistance = Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);
        state.multiTouchState.initialCenter = {
            x: (t1.clientX + t2.clientX) / 2,
            y: (t1.clientY + t2.clientY) / 2,
        };
        state.multiTouchState.initialPan = { x: state.panX, y: state.panY };
        state.multiTouchState.initialZoom = state.zoom;
    }
}

export function handleTouchMove(state, callbacks, e) {
    if (e.touches.length === 2) {
        e.preventDefault();
        const { redrawCallback, saveViewStateCallback } = callbacks;
        const t1 = e.touches[0];
        const t2 = e.touches[1];

        const currentDist = Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);
        const zoomFactor = currentDist / state.multiTouchState.initialDistance;
        const newZoom = Math.max(0.1, Math.min(state.multiTouchState.initialZoom * zoomFactor, 10));

        const pinchCenter = state.multiTouchState.initialCenter;

        const currentCenter = {
            x: (t1.clientX + t2.clientX) / 2,
            y: (t1.clientY + t2.clientY) / 2,
        };
        const dx = currentCenter.x - state.multiTouchState.initialCenter.x;
        const dy = currentCenter.y - state.multiTouchState.initialCenter.y;

        state.panX = pinchCenter.x - (pinchCenter.x - state.multiTouchState.initialPan.x - dx) * (newZoom / state.multiTouchState.initialZoom);
        state.panY = pinchCenter.y - (pinchCenter.y - state.multiTouchState.initialPan.y - dy) * (newZoom / state.multiTouchState.initialZoom);

        state.zoom = newZoom;

        if (state.activeTool === 'eraser' && state.canvas) {
            state.canvas.style.cursor = utils.getEraserCursorStyle(state.activeEraserWidth, state.zoom, document.body.classList.contains('dark-theme'));
        }

        redrawCallback();
        state.updateFloatingToolbar();
        // --- НАЧАЛО ИЗМЕНЕНИЙ: Вызываем отложенное сохранение ---
        if (saveViewStateCallback) {
            saveViewStateCallback();
        }
        // --- КОНЕЦ ИЗМЕНЕНИЙ ---
    }
}

export function handleTouchEnd(state, e) {
    if (e.touches.length < 2) {
        state.multiTouchState = {};
        // Add a delay before releasing the multiTouch lock to swallow trailing pointer events (pointerup)
        setTimeout(() => {
            state.isMultiTouching = false;
            // Trigger redraw so tiles that entered viewport during zoom get queued and rendered
            if (state.redraw) state.redraw();
        }, 150);
    }
}