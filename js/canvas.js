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
    
    const callbacks = { redrawCallback, saveState, updateToolbarCallback };

    const state = {
        ...createInitialState(),
        canvas, ctx,
        interactionCanvas, iCtx,
        saveState
    };

    state.updateFloatingToolbar = ui.updateFloatingToolbar.bind(null, state);
    state.updateTextEditorStyle = textTool.updateEditorStyle;
    state.updateTextEditorTransform = textTool.updateTextEditorTransform;
    state.performZoom = performZoom.bind(null, state, callbacks);
    state.resetMobileShapeState = () => {
        state.mobileShapeState = 'idle';
        state.mobileFirstPoint = null;
        state.mobileDragAnchor = null;
        iCtx.clearRect(0, 0, interactionCanvas.width, interactionCanvas.height);
    };

    const hideContextMenu = ui.setupContextMenu(state, callbacks);
    
    state.onPointerMove = pointer.draw.bind(null, state, callbacks);
    state.onPointerUp = pointer.stopDrawing.bind(null, state, callbacks);
    
    const onPointerDown = pointer.startDrawing.bind(null, state, callbacks, hideContextMenu);
    const onTouchStart = touch.handleTouchStart.bind(null, state);
    const onTouchMove = touch.handleTouchMove.bind(null, state, callbacks);
    const onTouchEnd = touch.handleTouchEnd.bind(null, state);

    canvas.addEventListener('pointerdown', onPointerDown);
    // --- НАЧАЛО ИЗМЕНЕНИЙ: Добавляем постоянный слушатель для обновления курсора при наведении ---
    canvas.addEventListener('pointermove', state.onPointerMove);
    // --- КОНЕЦ ИЗМЕНЕНИЙ ---
    
    canvas.addEventListener('touchstart', onTouchStart, { passive: false });
    canvas.addEventListener('touchmove', onTouchMove, { passive: false });
    canvas.addEventListener('touchend', onTouchEnd);

    // --- НАЧАЛО ИЗМЕНЕНИЙ: Расширяем обработку ухода курсора с холста ---
    const handlePointerEndOutside = () => {
        if (state.isSpenEraserActive) {
            if (state.isDrawing && state.didErase) {
                const ids = new Set(Array.from(state.layersToErase).map(l => l.id));
                state.layers = state.layers.filter(l => !ids.has(l.id));
                saveState(state.layers);
                redrawCallback();
            }
            state.isDrawing = false;
            state.didErase = false;
            state.layersToErase.clear();
            if (state.eraserAnimationId) {
                cancelAnimationFrame(state.eraserAnimationId);
                state.eraserAnimationId = null;
            }
            state.iCtx.clearRect(0, 0, state.interactionCanvas.width, state.interactionCanvas.height);

            state.activeTool = state.toolBeforeSpenEraser;
            state.isSpenEraserActive = false;
            state.toolBeforeSpenEraser = null;
            state.canvas.classList.remove('cursor-eraser');
            updateToolbarCallback();
        }

        if (state.isPanning) { 
            state.isPanning = false; 
            document.removeEventListener('pointermove', state.onPointerMove);
            document.removeEventListener('pointerup', state.onPointerUp);
        } 
    };

    canvas.addEventListener('pointerleave', handlePointerEndOutside);
    canvas.addEventListener('pointercancel', handlePointerEndOutside);
    // --- КОНЕЦ ИЗМЕНЕНИЙ ---
    
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
            contextMenu.style.left = '0px';
            contextMenu.style.top = '0px';
            contextMenu.classList.add('visible');

            const menuWidth = contextMenu.offsetWidth;
            const menuHeight = contextMenu.offsetHeight;
            const { innerWidth: vpWidth, innerHeight: vpHeight } = window;
            const margin = 10;

            let left = e.clientX;
            let top = e.clientY;

            if (left + menuWidth > vpWidth - margin) {
                left = vpWidth - menuWidth - margin;
            }
            if (top + menuHeight > vpHeight - margin) {
                top = vpHeight - menuHeight - margin;
            }

            contextMenu.style.left = `${left}px`;
            contextMenu.style.top = `${top}px`;
        } else {
            hideContextMenu();
        }
    });
    
    saveState(state.layers);

    return state;
}
