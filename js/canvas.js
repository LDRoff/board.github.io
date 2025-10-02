// --- START OF FILE js/canvas.js ---

import { createInitialState } from './state.js';
import * as ui from './ui.js';
import * as touch from './touchHandlers.js';
import * as pointer from './pointerHandlers.js';
import { performZoom } from './zoom.js';
import * as textTool from './text.js';
import * as utils from './utils.js';
import * as hitTest from './hitTest.js';

export function initializeCanvas(canvas, interactionCanvas, ctx, redrawCallback, saveState, updateToolbarCallback) {
    const iCtx = interactionCanvas.getContext('2d');
    
    // Объект обратных вызовов для передачи в обработчики
    const callbacks = { redrawCallback, saveState, updateToolbarCallback };

    // 1. Создание и расширение состояния
    const state = {
        ...createInitialState(),
        canvas, ctx,
        interactionCanvas, iCtx,
        saveState
    };

    // 2. Привязка функций к состоянию для внешнего и внутреннего использования
    state.updateFloatingToolbar = ui.updateFloatingToolbar.bind(null, state);
    state.updateTextEditorStyle = textTool.updateEditorStyle;
    state.updateTextEditorTransform = textTool.updateEditorTransform;
    state.performZoom = performZoom.bind(null, state, callbacks);
    state.resetMobileShapeState = () => {
        state.mobileShapeState = 'idle';
        state.mobileFirstPoint = null;
        state.mobileDragAnchor = null;
        iCtx.clearRect(0, 0, interactionCanvas.width, interactionCanvas.height);
    };

    // 3. Настройка обработчиков событий
    const hideContextMenu = ui.setupContextMenu(state, callbacks);
    
    // Создаем привязанные версии обработчиков для возможности их последующего удаления
    state.onPointerMove = pointer.draw.bind(null, state, callbacks);
    state.onPointerUp = pointer.stopDrawing.bind(null, state, callbacks);
    
    const onPointerDown = pointer.startDrawing.bind(null, state, callbacks, hideContextMenu);
    const onTouchStart = touch.handleTouchStart.bind(null, state);
    const onTouchMove = touch.handleTouchMove.bind(null, state, callbacks);
    const onTouchEnd = touch.handleTouchEnd.bind(null, state);

    // 4. Добавление прослушивателей событий
    canvas.addEventListener('pointerdown', onPointerDown);
    
    canvas.addEventListener('touchstart', onTouchStart, { passive: false });
    canvas.addEventListener('touchmove', onTouchMove, { passive: false });
    canvas.addEventListener('touchend', onTouchEnd);

    canvas.addEventListener('pointerleave', () => { 
        if (state.isPanning) { 
            state.isPanning = false; 
            document.removeEventListener('pointermove', state.onPointerMove);
            document.removeEventListener('pointerup', state.onPointerUp);
        } 
    });
    
    canvas.addEventListener('wheel', (e) => {
        e.preventDefault(); 
        const rect = canvas.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;
        
        if (e.deltaY < 0) {
            state.performZoom('in', { x: mouseX, y: mouseY });
        } else {
            state.performZoom('out', { x: mouseX, y: mouseY });
        }
    });

    canvas.addEventListener('dragover', (e) => e.preventDefault());
    canvas.addEventListener('drop', (e) => { 
        e.preventDefault(); 
        const pos = utils.getMousePos(e, state); 
        if (e.dataTransfer.files.length > 0) {
            utils.processImageFile(e.dataTransfer.files[0], pos, state, redrawCallback, saveState);
        }
    });
    
    canvas.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        const pos = utils.getMousePos(e, state);
        const clickedLayer = hitTest.getLayerAtPosition(pos, state.layers);

        if (clickedLayer) {
            if (!state.selectedLayers.some(l => l.id === clickedLayer.id)) {
                state.selectedLayers = [clickedLayer];
                redrawCallback();
                updateToolbarCallback();
                state.updateFloatingToolbar();
            }
            
            const contextMenu = document.getElementById('contextMenu');
            contextMenu.style.top = `${e.clientY}px`;
            contextMenu.style.left = `${e.clientX}px`;
            contextMenu.classList.add('visible');
        } else {
            hideContextMenu();
        }
    });
    
    saveState(state.layers);

    return state;
}
// --- END OF FILE js/canvas.js ---