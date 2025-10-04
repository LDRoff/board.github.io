// --- START OF FILE js/zoom.js ---

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
    
    redrawCallback();
    state.updateFloatingToolbar();
    // --- НАЧАЛО ИЗМЕНЕНИЙ: Вызываем отложенное сохранение ---
    if (saveViewStateCallback) {
        saveViewStateCallback();
    }
    // --- КОНЕЦ ИЗМЕНЕНИЙ ---
}
// --- END OF FILE js/zoom.js ---