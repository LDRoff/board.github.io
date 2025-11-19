// js/touchHandlers.js

export function handleTouchStart(state, e) {
    if (e.touches.length === 2) {
        e.preventDefault();
        state.isMultiTouching = true;
        state.isDrawing = false;
        state.currentAction = 'none';
        state.iCtx.clearRect(0, 0, state.interactionCanvas.width, state.interactionCanvas.height);

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
        state.isMultiTouching = false;
        state.multiTouchState = {};
    }
}