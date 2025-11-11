// js/canvas.js

import { createInitialState } from './state.js';
import * as ui from './ui.js';
import * as touch from './touchHandlers.js';
import * as pointer from './pointerHandlers.js';
import { performZoom } from './zoom.js';
import * as textTool from './text.js';
import * as utils from './utils.js';
import * as hitTest from './hitTest.js';

export function initializeCanvas(
  canvas,
  interactionCanvas,
  ctx,
  redraw,
  commitChange,
  updateSubToolbarVisibility,
  debouncedSaveViewState,
  drawBackground
) {
    const iCtx = interactionCanvas.getContext('2d');
    const cacheCanvas = document.getElementById('cacheCanvas');
    const cacheCtx = cacheCanvas.getContext('2d');
    
    const callbacks = {
        redrawCallback: redraw,
        saveState: commitChange,
        updateToolbarCallback: updateSubToolbarVisibility,
        saveViewStateCallback: debouncedSaveViewState,
        drawBackgroundCallback: drawBackground,
    };

    const state = {
        ...createInitialState(),
        canvas, ctx,
        interactionCanvas, iCtx,
        cacheCanvas, cacheCtx,
        isInteracting: false,
        saveState: commitChange,
        spatialGrid: new Map(),
    };

    state.updateFloatingToolbar = ui.updateFloatingToolbar.bind(null, state);
    state.showCreationTooltip = ui.showCreationTooltip;
    state.hideCreationTooltip = ui.hideCreationTooltip;
    state.updateTextEditorStyle = textTool.updateEditorStyle;
    state.updateTextEditorTransform = textTool.updateTextEditorTransform;
    state.performZoom = performZoom.bind(null, state, callbacks);

    const hideContextMenu = ui.setupContextMenu(state, callbacks);
    
    state.onPointerMove = pointer.draw.bind(null, state, callbacks);
    state.onPointerUp = pointer.stopDrawing.bind(null, state, callbacks);
    
    const onPointerDown = pointer.startDrawing.bind(null, state, callbacks, hideContextMenu);
    const onTouchStart = touch.handleTouchStart.bind(null, state);
    const onTouchMove = touch.handleTouchMove.bind(null, state, callbacks);
    const onTouchEnd = touch.handleTouchEnd.bind(null, state);

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', state.onPointerMove);
    
    canvas.addEventListener('touchstart', onTouchStart, { passive: false });
    canvas.addEventListener('touchmove', onTouchMove, { passive: false });
    canvas.addEventListener('touchend', onTouchEnd);

    const handlePointerEndOutside = (e) => {
        if (state.hoverCheckTimer) {
            clearTimeout(state.hoverCheckTimer);
            state.hoverCheckTimer = null;
        }
        if (state.isSpenEraserActive) {
            if (state.isDrawing && state.didErase) {
                const layersToErase = Array.from(state.layersToErase);
                const ids = new Set(layersToErase.map(l => l.id));
                
                commitChange({
                    type: 'deletion',
                    before: layersToErase,
                    after: [],
                });

                state.layers = state.layers.filter(l => !ids.has(l.id));
                redraw();
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
            updateSubToolbarVisibility();
        }

        if (state.isPanning) { 
            state.isPanning = false; 
            document.removeEventListener('pointermove', state.onPointerMove);
            document.removeEventListener('pointerup', state.onPointerUp);
        }
        
        if (state.isDrawing || state.isInteracting) {
            const fakeEvent = new PointerEvent('pointerup', e);
            pointer.stopDrawing(state, callbacks, fakeEvent);
        }
    };

    canvas.addEventListener('pointerleave', handlePointerEndOutside);
    canvas.addEventListener('pointercancel', handlePointerEndOutside);
    
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
    
    canvas.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        const pos = utils.getMousePos(e, state);
        const clickedLayer = hitTest.getLayerAtPosition(pos, state.layers, state.zoom, state.spatialGrid);

        if (clickedLayer) {
            if (!state.selectedLayers.some(l => l.id === clickedLayer.id)) {
                state.selectedLayers = [clickedLayer];
                redraw();
                updateSubToolbarVisibility();
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
    

    return state;
}