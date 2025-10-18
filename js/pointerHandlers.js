import * as geo from './geometry.js';
import * as hitTest from './hitTest.js';
import * as actions from './actions.js';
import * as tools from './tools.js';
import * as utils from './utils.js';
import * as shapeRecognizer from './shapeRecognizer.js';
import * as textTool from './text.js';
import { animateEraserTrail, updateCursor } from './ui.js';
import { drawLayer } from './renderer.js';

const TOOLTIP_MESSAGES = {
    drawingParallelogramSlant: 'Потяните, чтобы задать наклон',
    drawingTriangleApex: 'Укажите третью вершину',
    drawingParallelepipedDepth: 'Потяните, чтобы задать глубину',
    drawingPyramidApex: 'Укажите вершину пирамиды',
    drawingTruncatedPyramidApex: 'Укажите вершину исходной пирамиды',
    drawingTruncatedPyramidTop: 'Укажите высоту среза',
    drawingTrapezoidP3: 'Укажите третью вершину',
    drawingTrapezoidP4: 'Укажите четвертую вершину',
    drawingFrustum: 'Задайте радиус и высоту',
    drawingTruncatedSphere: 'Укажите высоту среза',
};

function isSpenButtonPressed(e) {
  if (e.pointerType !== 'pen') return false;
  return (e.buttons & 32) !== 0 || (e.buttons & 2) !== 0 || e.button === 5 || e.button === 2;
}

function checkAndHandleSpenEraser(state, e, callbacks) {
    if (e.pointerType !== 'pen') {
        return false;
    }

    const { redrawCallback, saveState, updateToolbarCallback } = callbacks;
    const isButtonPressed = isSpenButtonPressed(e);

    if (isButtonPressed && !state.isSpenEraserActive) {
        if (state.isDrawing && state.tempLayer) {
            if (state.tempLayer.points && state.tempLayer.points.length > 1) {
                state.layers.push(state.tempLayer);
                saveState(state.layers);
            }
            state.tempLayer = null;
            redrawCallback();
        }

        state.toolBeforeSpenEraser = state.activeTool;
        state.activeTool = 'eraser';
        state.isSpenEraserActive = true;
        state.isDrawing = true; 
        
        const pos = utils.getMousePos(e, state);
        state.startPos = pos;
        state.didErase = false;
        state.layersToErase.clear();
        state.canvas.classList.add('cursor-eraser');
        
        if (!document.body.classList.contains('no-animations')) {
            state.lastEraserPos = pos;
            state.eraserTrailNodes = Array(10).fill(null).map(() => ({ ...pos }));
            if (state.eraserAnimationId) cancelAnimationFrame(state.eraserAnimationId);
            animateEraserTrail(state);
        }

        return true; 
    
    } else if (!isButtonPressed && state.isSpenEraserActive) {
        if (state.isDrawing && state.didErase) {
            const idsToErase = new Set(Array.from(state.layersToErase).map(l => l.id));
            state.layers = state.layers.filter(layer => !idsToErase.has(layer.id));
            saveState(state.layers);
            redrawCallback();
        }
        
        state.isDrawing = false;
        state.didErase = false;
        state.layersToErase.clear();
        if (state.eraserAnimationId) cancelAnimationFrame(state.eraserAnimationId);
        state.iCtx.clearRect(0, 0, state.interactionCanvas.width, state.interactionCanvas.height);

        state.activeTool = state.toolBeforeSpenEraser;
        state.isSpenEraserActive = false;
        state.toolBeforeSpenEraser = null;
        state.canvas.classList.remove('cursor-eraser');
        updateToolbarCallback();

        return true;
    }

    return false;
}

export function startDrawing(state, callbacks, hideContextMenu, e) {
    if (e.target.id !== 'drawingBoard' || (e.pointerType === 'touch' && state.isMultiTouching)) return;
    
    if (state.hideCreationTooltip) {
        state.hideCreationTooltip();
    }

    const subToolbar = document.getElementById('drawingSubToolbar');
    if (subToolbar && !subToolbar.classList.contains('hidden') && !subToolbar.classList.contains('sub-toolbar-collapsed')) {
        subToolbar.classList.add('sub-toolbar-collapsed');
    }

    const { redrawCallback, saveState, updateToolbarCallback } = callbacks;

    if (checkAndHandleSpenEraser(state, e, callbacks)) {
        document.addEventListener('pointermove', state.onPointerMove);
        document.addEventListener('pointerup', state.onPointerUp);
        return;
    }

    const pos = utils.getMousePos(e, state);
    let finalPos = pos;
    
    const isSnappingTool = !['brush', 'smart-brush'].includes(state.activeTool);
    const shouldSnap = isSnappingTool && ((state.snappingMode === 'manual' && e.altKey) || (state.snappingMode === 'auto' && !e.altKey));

    if (shouldSnap) {
        const SNAP_THRESHOLD = 10 / state.zoom;
        const snappedX = utils.snapToGrid(pos.x);
        const snappedY = utils.snapToGrid(pos.y);
        finalPos.x = (Math.abs(snappedX - pos.x) < SNAP_THRESHOLD) ? snappedX : pos.x;
        finalPos.y = (Math.abs(snappedY - pos.y) < SNAP_THRESHOLD) ? snappedY : pos.y;
    }
    
    if (state.activeTool === 'curve') {
        document.addEventListener('pointermove', state.onPointerMove);
        document.addEventListener('pointerup', state.onPointerUp);
        
        state.isDrawing = true;

        if (!state.tempLayer || state.tempLayer.type !== 'curve') {
            state.currentAction = 'drawingCurve';
            state.tempLayer = {
                type: 'curve', nodes: [],
                color: state.activeColor, lineWidth: state.activeLineWidth, id: Date.now(),
                rotation: 0, pivot: { x: 0, y: 0 }, lineStyle: state.activeLineStyle
            };
            const newNode = { p: { ...finalPos }, h1: { ...finalPos }, h2: { ...finalPos }, type: 'smooth' };
            state.tempLayer.nodes.push(newNode);
        } else {
            const lastNode = state.tempLayer.nodes[state.tempLayer.nodes.length - 1];
            const reflectedH1 = {
                 x: 2 * lastNode.p.x - lastNode.h1.x,
                 y: 2 * lastNode.p.y - lastNode.h1.y
            };
            const newNode = { p: { ...finalPos }, h1: { ...finalPos }, h2: reflectedH1, type: 'smooth' };
            state.tempLayer.nodes.push(newNode);
        }

        if (state.tempLayer.nodes.length === 3) {
            utils.smoothCurveHandles(state.tempLayer.nodes); 
            state.layers.push(state.tempLayer);
            saveState(state.layers);

            state.selectedLayers = [state.tempLayer];
            
            state.currentAction = 'none';
            state.tempLayer = null;
            state.isDrawing = false;
            
            document.querySelector('button[data-tool="select"]')?.click();
            
            state.iCtx.clearRect(0, 0, state.interactionCanvas.width, state.interactionCanvas.height);
            redrawCallback();
            
            document.removeEventListener('pointermove', state.onPointerMove);
            document.removeEventListener('pointerup', state.onPointerUp);

        } else {
            state.iCtx.clearRect(0, 0, state.interactionCanvas.width, state.interactionCanvas.height);
            tools.handleShapeDrawing(state.iCtx, state, finalPos, e);
        }

        return;
    }
    
    document.addEventListener('pointermove', state.onPointerMove);
    document.addEventListener('pointerup', state.onPointerUp);

    if (state.activeTool === 'text' && !state.isEditingText && e.button === 0) {
        const clickedLayer = hitTest.getLayerAtPosition(pos, state.layers, state.zoom);
        if (clickedLayer && clickedLayer.type === 'text') {
            state.selectedLayers = [clickedLayer];
            clickedLayer.isEditing = true;
            state.isEditingText = true;
            redrawCallback();
            state.updateFloatingToolbar();

            textTool.startEditing(state, clickedLayer, (isIntermediate) => {
                if (isIntermediate) {
                    redrawCallback();
                    state.updateFloatingToolbar();
                    if(state.updateTextEditorTransform) state.updateTextEditorTransform(clickedLayer, state);
                    return;
                }
                state.isEditingText = false;
                const finishedLayer = state.layers.find(l => l.id === clickedLayer.id);
                if (finishedLayer) {
                    finishedLayer.isEditing = false;
                }
                saveState(state.layers);
                redrawCallback();
                state.updateFloatingToolbar();
            });
            return;
        }
    }
    
    if (state.isEditingText) {
         const handle = hitTest.getHandleAtPosition(pos, state.selectedLayers, state.zoom, state.groupRotation);
         if (!handle) { return; }
    }

    clearTimeout(state.shapeRecognitionTimer);
    state.shapeWasJustRecognized = false;
    state.layersToErase.clear();

    const isPanToolActive = state.activeTool === 'pan' && e.button === 0;
    const isMiddleMouseButton = e.pointerType === 'mouse' && e.button === 1;

    if (isPanToolActive || isMiddleMouseButton) {
        state.isPanning = true;
        state.panStartPos = { x: e.clientX, y: e.clientY };
        state.canvas.style.cursor = 'grabbing';
        return;
    }
    
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    
    hideContextMenu();

    const now = Date.now();
    const CLICK_SPEED = 500, CLICK_RADIUS = 20;
    const timeDiff = now - state.lastClickTime;
    if (state.lastClickPos && timeDiff < CLICK_SPEED && Math.abs(pos.x - state.lastClickPos.x) < CLICK_RADIUS && Math.abs(pos.y - state.lastClickPos.y) < CLICK_RADIUS) { state.clickCount++; } else { state.clickCount = 1; }
    state.lastClickTime = now; state.lastClickPos = pos;
    
    if (state.activeTool === 'select' && state.clickCount === 2 && e.button === 0) {
        const clickedLayer = hitTest.getLayerAtPosition(pos, state.layers, state.zoom);
        if (clickedLayer && clickedLayer.type === 'text') {
            state.selectedLayers = [clickedLayer];
            clickedLayer.isEditing = true;
            
            state.isEditingText = true;
            redrawCallback();
            state.updateFloatingToolbar();

            textTool.startEditing(state, clickedLayer, (isIntermediate) => {
                if (isIntermediate) {
                    redrawCallback();
                    state.updateFloatingToolbar();
                    if(state.updateTextEditorTransform) state.updateTextEditorTransform(clickedLayer, state);
                    return;
                }
                state.isEditingText = false;
                const finishedLayer = state.layers.find(l => l.id === clickedLayer.id);
                if (finishedLayer) {
                    finishedLayer.isEditing = false;
                }
                saveState(state.layers);
                redrawCallback();
                state.updateFloatingToolbar();
            });
            return;
        }
        else if (clickedLayer && clickedLayer.type === 'curve') {
            e.preventDefault();
            const closest = geo.findClosestPointOnCurveSegment(pos, clickedLayer);
            if (closest && closest.distance < (10 / state.zoom)) {
                const p0 = clickedLayer.nodes[closest.segmentIndex].p;
                const p1 = clickedLayer.nodes[closest.segmentIndex].h1;
                const p2 = clickedLayer.nodes[closest.segmentIndex + 1].h2;
                const p3 = clickedLayer.nodes[closest.segmentIndex + 1].p;
                
                const newNodeP = geo.getPointOnBezier(closest.t, p0, p1, p2, p3);
                
                const newNode = { p: newNodeP, h1: null, h2: null, type: 'smooth' };
                clickedLayer.nodes.splice(closest.segmentIndex + 1, 0, newNode);
                
                utils.smoothCurveHandles(clickedLayer.nodes);
                
                saveState(state.layers);
                redrawCallback();
            }
            return;
        }
    }
    
    state.dragStartPos = pos;
    
    if (state.activeTool === 'select') {
        state.groupRotation = 0;
        const handle = hitTest.getHandleAtPosition(pos, state.selectedLayers, state.zoom, state.groupRotation);

        if (handle) {
            state.scalingHandle = handle;
            if (typeof handle === 'object' && (handle.type === 'curveNode' || handle.type === 'curveHandle')) {
                if (handle.type === 'curveNode') {
                    if (state.selectedCurveNodeIndex !== handle.nodeIndex) {
                        state.selectedCurveNodeIndex = handle.nodeIndex;
                    }
                } else {
                    state.selectedCurveNodeIndex = null;
                }
                state.currentAction = 'editingCurve';
                state.originalLayers = utils.cloneLayersForAction(state.selectedLayers);
                redrawCallback();
                state.updateFloatingToolbar();
                return;
            }
            if (handle === 'pivot') { 
                state.currentAction = 'movingPivot';
                state.canvas.style.cursor = 'none';
                state.originalLayers = utils.cloneLayersForAction(state.selectedLayers);
            } else if (handle === 'rotate') {
                state.currentAction = 'rotating';
                const box = geo.getGroupLogicalBoundingBox(state.selectedLayers);
                const centerX = box.x + box.width / 2;
                const centerY = box.y + box.height / 2;
                let pivotX = centerX;
                let pivotY = centerY;

                if (state.selectedLayers.length === 1 && state.selectedLayers[0].pivot) {
                    const layer = state.selectedLayers[0];
                    pivotX = centerX + layer.pivot.x;
                    pivotY = centerY + layer.pivot.y;
                }
                
                state.groupPivot = { x: pivotX, y: pivotY };
                state.rotationStartAngle = Math.atan2(pos.y - state.groupPivot.y, pos.x - state.groupPivot.x);
                state.originalLayers = utils.cloneLayersForAction(state.selectedLayers);
            } else {
                state.currentAction = 'scaling'; 
                state.originalBox = geo.getGroupLogicalBoundingBox(state.selectedLayers); 
                state.originalLayers = utils.cloneLayersForAction(state.selectedLayers);
            }
            return;
        }

        const clickedLayer = hitTest.getLayerAtPosition(pos, state.layers, state.zoom);
        if (clickedLayer) {
            const isAlreadySelected = state.selectedLayers.some(l => l.id === clickedLayer.id);

            if (e.shiftKey) {
                if (isAlreadySelected) {
                    state.selectedLayers = state.selectedLayers.filter(l => l.id !== clickedLayer.id);
                } else {
                    state.selectedLayers.push(clickedLayer);
                }
                state.selectedCurveNodeIndex = null;
            } else {
                if (!isAlreadySelected) {
                    state.selectedLayers = [clickedLayer];
                    state.selectedCurveNodeIndex = null;
                }
                state.currentAction = 'moving';
                state.originalLayers = utils.cloneLayersForAction(state.selectedLayers);
            }
        } else {
            if (!e.shiftKey && !e.ctrlKey && !e.metaKey) {
                if (state.selectedLayers.length > 0) {
                    state.selectedLayers.forEach(layer => utils.applyTransformations(layer));
                    saveState(state.layers);
                }
                state.selectedLayers = [];
                state.selectedCurveNodeIndex = null;
            }
            state.currentAction = 'selectionBox';
            state.startPos = pos;
        }
        
        redrawCallback(); 
        updateToolbarCallback();
        state.updateFloatingToolbar();
        return;
    }

    state.selectedLayers = []; 
    state.selectedCurveNodeIndex = null;
    updateToolbarCallback();
    state.updateFloatingToolbar();
    state.isDrawing = true; 
    state.startPos = finalPos;
    
    if (state.activeTool === 'brush' || state.activeTool === 'smart-brush') {
        state.tempLayer = { type: 'path', points: [], color: state.activeColor, lineWidth: state.activeLineWidth, id: Date.now(), rotation: 0, pivot: { x: 0, y: 0 }, lineStyle: state.activeLineStyle };
        
        const point = { ...finalPos };
        if (e.pointerType === 'pen') {
            const rawPressure = e.pressure > 0 ? e.pressure : 0.5;
            point.pressure = rawPressure < 0.5 ? rawPressure * 2 : rawPressure + 0.5;
        }
        state.tempLayer.points.push(point);
        
        state.lastBrushPoint = finalPos;
    } 
    else if (state.activeTool === 'eraser') {
        state.didErase = false;
        
        if (!document.body.classList.contains('no-animations')) {
            state.lastEraserPos = finalPos;
            state.eraserTrailNodes = Array(10).fill(null).map(() => ({ ...finalPos }));
            if (state.eraserAnimationId) {
                cancelAnimationFrame(state.eraserAnimationId);
            }
            animateEraserTrail(state);
        } else {
            state.iCtx.save();
            state.iCtx.translate(state.panX, state.panY);
            state.iCtx.scale(state.zoom, state.zoom);
            state.iCtx.fillStyle = 'rgba(135, 206, 250, 0.75)';
            state.iCtx.beginPath();
            state.iCtx.arc(finalPos.x, finalPos.y, 12 / state.zoom, 0, 2 * Math.PI);
            state.iCtx.fill();
            state.iCtx.restore();
        }

        const layerToErase = hitTest.getLayerAtPosition(finalPos, state.layers, state.zoom);
        if (layerToErase && layerToErase.type !== 'image' && layerToErase.type !== 'pdf') {
            state.layersToErase.add(layerToErase);
            state.didErase = true;
            redrawCallback();
        }
    }
}

export function draw(state, callbacks, e) {
    if (state.isMultiTouching) return;

    const { redrawCallback, saveState, updateToolbarCallback, saveViewStateCallback } = callbacks;
    
    if (state.currentAction === 'drawingCurve') {
        const pos = utils.getMousePos(e, state);
        state.iCtx.clearRect(0, 0, state.interactionCanvas.width, state.interactionCanvas.height);
    
        if (state.isDrawing && state.tempLayer) {
            const nodes = state.tempLayer.nodes;
            const currentNode = nodes[nodes.length - 1];
    
            currentNode.h1 = { ...pos };
            
            currentNode.h2 = { 
                x: 2 * currentNode.p.x - pos.x,
                y: 2 * currentNode.p.y - pos.y
            };
        }
        
        tools.handleShapeDrawing(state.iCtx, state, pos, e);
        return;
    }

    if (checkAndHandleSpenEraser(state, e, callbacks)) {
        return;
    }

    const pos = utils.getMousePos(e, state);
    
    if (state.isPanning) { 
        const dx = e.clientX - state.panStartPos.x; 
        const dy = e.clientY - state.panStartPos.y; 
        state.panX += dx; 
        state.panY += dy; 
        state.panStartPos = { x: e.clientX, y: e.clientY }; 
        redrawCallback(); 
        state.updateFloatingToolbar(); 
        if (saveViewStateCallback) {
            saveViewStateCallback();
        }
        return; 
    }

    if (state.currentAction !== 'none' || state.isDrawing) {
        if (state.isEditingText && (state.currentAction === 'moving' || state.currentAction === 'scaling')) {
            const textarea = textTool.getEditorTextarea();
            if (textarea) textarea.style.pointerEvents = 'none';
        }
        
        const shouldSnap = (state.snappingMode === 'manual' && e.altKey) || (state.snappingMode === 'auto' && !e.altKey);
        if (!shouldSnap) { state.snapPoint = null; }

        switch(state.currentAction) {
            case 'editingCurve': actions.handleEditCurve(state, pos, e); redrawCallback(); return;
            case 'movingPivot': actions.handleMovePivot(state, pos); redrawCallback(); return;
            case 'rotating': actions.handleRotate(state, pos, e); redrawCallback(); state.updateFloatingToolbar(); return;
            case 'moving': 
                actions.handleMove(state, pos, e); 
                if (state.isEditingText && state.updateTextEditorTransform) {
                    state.updateTextEditorTransform(state.selectedLayers[0], state);
                }
                redrawCallback(); 
                state.updateFloatingToolbar(); 
                return;
            case 'scaling': 
                actions.handleScale(state, pos, e); 
                if (state.isEditingText && state.updateTextEditorTransform) {
                    state.updateTextEditorTransform(state.selectedLayers[0], state);
                }
                redrawCallback(); 
                state.updateFloatingToolbar(); 
                return;
            case 'selectionBox': 
                state.iCtx.clearRect(0, 0, state.interactionCanvas.width, state.interactionCanvas.height);
                state.iCtx.save();
                state.iCtx.translate(state.panX, state.panY);
                state.iCtx.scale(state.zoom, state.zoom);
                state.iCtx.strokeStyle = 'rgba(0, 122, 255, 0.8)';
                state.iCtx.fillStyle = 'rgba(0, 122, 255, 0.1)';
                state.iCtx.lineWidth = 1 / state.zoom;
                state.iCtx.beginPath();
                state.iCtx.rect(state.startPos.x, state.startPos.y, pos.x - state.startPos.x, pos.y - state.startPos.y);
                state.iCtx.fill();
                state.iCtx.stroke();
                state.iCtx.restore();
                return;
        }
        
        const isShapeTool = !['brush', 'smart-brush', 'eraser', 'select', 'pan'].includes(state.activeTool);
        
        if ((state.isDrawing && isShapeTool) || state.currentAction.startsWith('drawing')) {
            state.iCtx.clearRect(0, 0, state.interactionCanvas.width, state.interactionCanvas.height);
            tools.handleShapeDrawing(state.iCtx, state, pos, e);
        }
        else if (state.isDrawing) {
            if (state.activeTool === 'brush' || state.activeTool === 'smart-brush') {
                const point = { ...pos };
                if (e.pointerType === 'pen') {
                    const rawPressure = e.pressure > 0 ? e.pressure : 0.5;
                    point.pressure = rawPressure < 0.5 ? rawPressure * 2 : rawPressure + 0.5;
                }
                state.tempLayer.points.push(point);

                const iCtx = state.iCtx;
                iCtx.clearRect(0, 0, state.interactionCanvas.width, state.interactionCanvas.height);
                
                iCtx.save();
                iCtx.translate(state.panX, state.panY);
                iCtx.scale(state.zoom, state.zoom);

                drawLayer(iCtx, state.tempLayer, state);
                
                iCtx.restore();

                state.lastBrushPoint = pos;

                if (state.activeTool === 'smart-brush') {
                    clearTimeout(state.shapeRecognitionTimer);
                    state.shapeRecognitionTimer = setTimeout(() => {
                        const recognizedShape = shapeRecognizer.recognizeShape(state.tempLayer.points);
                        if (recognizedShape) {
                            state.layers.push({
                                ...recognizedShape,
                                color: state.tempLayer.color,
                                lineWidth: state.tempLayer.lineWidth,
                                lineStyle: state.tempLayer.lineStyle
                            });
                            state.tempLayer.points = [];
                            state.iCtx.clearRect(0, 0, state.interactionCanvas.width, state.interactionCanvas.height);
                            state.isDrawing = false;
                            state.shapeWasJustRecognized = true;
                            redrawCallback();
                            saveState(state.layers);
                        }
                    }, 500);
                }
            } else if (state.activeTool === 'eraser') {
                if (!document.body.classList.contains('no-animations')) {
                    state.lastEraserPos = pos;
                } else {
                    state.iCtx.clearRect(0, 0, state.interactionCanvas.width, state.interactionCanvas.height);
                    state.iCtx.save();
                    state.iCtx.translate(state.panX, state.panY);
                    state.iCtx.scale(state.zoom, state.zoom);
                    state.iCtx.fillStyle = 'rgba(135, 206, 250, 0.75)';
                    state.iCtx.beginPath();
                    state.iCtx.arc(pos.x, pos.y, 12 / state.zoom, 0, 2 * Math.PI);
                    state.iCtx.fill();
                    state.iCtx.restore();
                }
                const layerToErase = hitTest.getLayerAtPosition(pos, state.layers, state.zoom);
                if (layerToErase && layerToErase.type !== 'image' && layerToErase.type !== 'pdf' && !state.layersToErase.has(layerToErase)) {
                    state.layersToErase.add(layerToErase);
                    state.didErase = true;
                    redrawCallback();
                }
            }
        }
    } else {
        const handle = (state.selectedLayers.length > 0)
            ? hitTest.getHandleAtPosition(pos, state.selectedLayers, state.zoom, state.groupRotation)
            : null;

        if (handle) {
            const rotation = hitTest.getSelectionRotation(state.selectedLayers, state.groupRotation);
            updateCursor(state, handle, rotation);
        } else {
            const layerAtPos = hitTest.getLayerAtPosition(pos, state.layers, state.zoom);
            const isOverSelectedLayer = layerAtPos && state.selectedLayers.some(l => l.id === layerAtPos.id);

            if (state.activeTool === 'select') {
                if (isOverSelectedLayer) {
                    state.canvas.style.cursor = 'grab';
                } else if (layerAtPos) {
                    state.canvas.style.cursor = layerAtPos.type === 'text' ? 'text' : 'pointer';
                } else {
                    state.canvas.style.cursor = '';
                }
            } else if (state.activeTool === 'pan') {
                state.canvas.style.cursor = 'grab';
            } else {
                state.canvas.style.cursor = '';
            }
        }
    }
}

export function stopDrawing(state, callbacks, e) {
    if (state.currentAction === 'drawingCurve') {
        const pos = utils.getMousePos(e, state);
        
        if (!state.tempLayer || !state.tempLayer.nodes) { 
             document.removeEventListener('pointermove', state.onPointerMove);
             document.removeEventListener('pointerup', state.onPointerUp);
             return; 
        }

        const nodes = state.tempLayer.nodes;
        const currentNode = nodes[nodes.length - 1];
    
        const dragDistance = Math.hypot(pos.x - state.dragStartPos.x, pos.y - state.dragStartPos.y);
        if (state.isDrawing && dragDistance < 5 / state.zoom) {
            currentNode.h1 = { ...currentNode.p };
            currentNode.type = 'corner';
        }
    
        state.isDrawing = false;
        
        state.iCtx.clearRect(0, 0, state.interactionCanvas.width, state.interactionCanvas.height);
        tools.handleShapeDrawing(state.iCtx, state, pos, e);
    
        document.removeEventListener('pointermove', state.onPointerMove);
        document.removeEventListener('pointerup', state.onPointerUp);
        
        return;
    }

    if (state.isMultiTouching) return;

    // --- НАЧАЛО ИЗМЕНЕНИЙ: Получаем debouncedSaveState из callbacks ---
    const { redrawCallback, saveState, updateToolbarCallback, debouncedSaveState } = callbacks;
    // --- КОНЕЦ ИЗМЕНЕНИЙ ---
    
    if (checkAndHandleSpenEraser(state, e, callbacks)) {
        state.isDrawing = false;
        state.currentAction = 'none';
        return;
    }
    
    const isMultiStepTool = ['parallelogram', 'triangle', 'parallelepiped', 'pyramid', 'truncated-pyramid', 'trapezoid', 'frustum', 'truncated-sphere'].includes(state.activeTool);

    if (isMultiStepTool && state.isDrawing) {
        state.isDrawing = false; 
        const rawEnd = utils.getMousePos(e, state);
        let finalStart = { ...state.startPos };
        let finalEnd = rawEnd;

        const shouldSnap = (state.snappingMode === 'manual' && e.altKey) || (state.snappingMode === 'auto' && !e.altKey);
        if (shouldSnap) {
             // ... snapping logic ...
        }
        if (state.activeTool === 'line' && e.shiftKey) { /* ... */ }

        const commonProps = { color: state.activeColor, lineWidth: state.activeLineWidth, id: Date.now(), rotation: 0, pivot: { x: 0, y: 0 }, lineStyle: state.activeLineStyle };
        
        if (!state.currentAction.startsWith('drawing')) {
            switch(state.activeTool) {
                case 'parallelogram': 
                    state.currentAction = 'drawingParallelogramSlant'; 
                    state.tempLayer = { type: 'parallelogram', x: Math.min(finalEnd.x, finalStart.x), y: Math.min(finalEnd.y, finalStart.y), width: Math.abs(finalEnd.x - finalStart.x), height: Math.abs(finalEnd.y - finalStart.y), slantOffset: 0, ...commonProps }; 
                    break;
                case 'triangle':
                    state.currentAction = 'drawingTriangleApex'; 
                    state.tempLayer = { type: 'triangle', p1: finalStart, p2: finalEnd, p3: finalEnd, ...commonProps }; 
                    break;
                case 'parallelepiped':
                    state.currentAction = 'drawingParallelepipedDepth'; 
                    const width = Math.abs(finalEnd.x - finalStart.x); 
                    state.tempLayer = { type: 'parallelepiped', x: Math.min(finalEnd.x, finalStart.x), y: Math.min(finalEnd.y, finalStart.y), width, height: Math.abs(finalEnd.y - finalStart.y), depthOffset: { x: width * 0.3, y: -width * 0.3 }, ...commonProps }; 
                    break;
                case 'pyramid': case 'truncated-pyramid':
                    state.currentAction = state.activeTool === 'pyramid' ? 'drawingPyramidApex' : 'drawingTruncatedPyramidApex'; 
                    const x = Math.min(finalEnd.x, finalStart.x); 
                    const y = Math.min(finalEnd.y, finalStart.y); 
                    const w = Math.abs(finalEnd.x - finalStart.x); 
                    const h = Math.abs(finalEnd.y - finalStart.y); 
                    const d = {x: w * 0.3, y: -w * 0.2}; 
                    state.tempLayer = { type: state.activeTool, base: { p1: { x: x, y: y + h }, p2: { x: x + w, y: y + h }, p3: { x: x + w + d.x, y: y + h + d.y }, p4: { x: x + d.x, y: y + h + d.y } }, apex: { x: x + w/2, y: y }, ...commonProps }; 
                    break;
                case 'trapezoid':
                    state.currentAction = 'drawingTrapezoidP3'; 
                    state.tempLayer = { type: 'trapezoid', p1: finalStart, p2: finalEnd, p3: finalEnd, p4: finalStart, ...commonProps }; 
                    break;
                case 'frustum':
                    state.currentAction = 'drawingFrustum'; 
                    const rx1 = Math.abs(finalEnd.x - finalStart.x) / 2; 
                    const cx = finalStart.x + (finalEnd.x - finalStart.x) / 2; 
                    const baseY = Math.max(finalEnd.y, finalStart.y); 
                    state.tempLayer = { type: 'frustum', cx, baseY, rx1, ry1: rx1 * 0.3, topY: baseY, rx2: rx1, ry2: rx1 * 0.3, ...commonProps }; 
                    break;
                case 'truncated-sphere':
                    state.currentAction = 'drawingTruncatedSphere'; 
                    const rx = Math.abs(finalEnd.x - finalStart.x) / 2; 
                    const ry = e.shiftKey ? rx : Math.abs(finalEnd.y - finalStart.y) / 2;
                    const cenX = finalStart.x + (finalEnd.x - finalStart.x) / 2; 
                    const cenY = finalStart.y + (finalEnd.y - finalStart.y)/2; 
                    state.tempLayer = { type: 'truncated-sphere', cx: cenX, cy: cenY, rx, ry, cutY: cenY, cutR: rx, cutRy: rx * 0.3, ...commonProps }; 
                    break;
            }

            if (state.showCreationTooltip && TOOLTIP_MESSAGES[state.currentAction] && (e.pointerType === 'touch' || e.pointerType === 'pen')) {
                state.showCreationTooltip(TOOLTIP_MESSAGES[state.currentAction], finalEnd, state);
            }

            document.removeEventListener('pointermove', state.onPointerMove);
            document.removeEventListener('pointerup', state.onPointerUp);
            return;
        }
    }
    
    if (state.currentAction.startsWith('drawing')) {
        const finalPos = utils.getMousePos(e, state);
        let isFinalStep = false;
        if (state.currentAction === 'drawingParallelogramSlant') { const finalSlant = finalPos.x - (state.tempLayer.x + state.tempLayer.width / 2); state.tempLayer.slantOffset = finalSlant; if (state.tempLayer.width > 5 || state.tempLayer.height > 5) { state.layers.push(state.tempLayer); } isFinalStep = true; } 
        else if (state.currentAction === 'drawingTriangleApex') { state.tempLayer.p3 = finalPos; if (Math.abs(state.tempLayer.p1.x - state.tempLayer.p2.x) > 5 || Math.abs(state.tempLayer.p1.y - state.tempLayer.p2.y) > 5) { state.layers.push(state.tempLayer); } isFinalStep = true; } 
        else if (state.currentAction === 'drawingParallelepipedDepth') { state.tempLayer.depthOffset = { x: finalPos.x - (state.tempLayer.x + state.tempLayer.width), y: finalPos.y - state.tempLayer.y }; if (state.tempLayer.width > 5 || state.tempLayer.height > 5) { state.layers.push(state.tempLayer); } isFinalStep = true; } 
        else if (state.currentAction === 'drawingPyramidApex') { state.tempLayer.apex = finalPos; state.layers.push(state.tempLayer); isFinalStep = true; } 
        else if (state.currentAction === 'drawingTruncatedPyramidApex') {
            state.tempLayer.apex = finalPos;
            state.currentAction = 'drawingTruncatedPyramidTop';
            if (state.showCreationTooltip && (e.pointerType === 'touch' || e.pointerType === 'pen')) {
                state.showCreationTooltip(TOOLTIP_MESSAGES[state.currentAction], finalPos, state);
            }
            document.removeEventListener('pointermove', state.onPointerMove);
            document.removeEventListener('pointerup', state.onPointerUp);
            return;
        } 
        else if (state.currentAction === 'drawingTruncatedPyramidTop') { const { base, apex } = state.tempLayer; const totalHeight = Math.abs(apex.y - base.p1.y); const cutHeight = Math.abs(finalPos.y - base.p1.y); const ratio = Math.max(0.05, Math.min(0.95, cutHeight / totalHeight)); const interpolate = (p1, p2) => ({ x: p1.x + (p2.x - p1.x) * ratio, y: p1.y + (p2.y - p1.y) * ratio }); state.tempLayer.top = { p1: interpolate(base.p1, apex), p2: interpolate(base.p2, apex), p3: interpolate(base.p3, apex), p4: interpolate(base.p4, apex), }; delete state.tempLayer.apex; state.layers.push(state.tempLayer); isFinalStep = true; } 
        else if (state.currentAction === 'drawingTrapezoidP3') {
            state.tempLayer.p3 = finalPos;
            state.currentAction = 'drawingTrapezoidP4';
            if (state.showCreationTooltip && (e.pointerType === 'touch' || e.pointerType === 'pen')) {
                state.showCreationTooltip(TOOLTIP_MESSAGES[state.currentAction], finalPos, state);
            }
            document.removeEventListener('pointermove', state.onPointerMove);
            document.removeEventListener('pointerup', state.onPointerUp);
            return;
        } 
        else if (state.currentAction === 'drawingTrapezoidP4') { state.tempLayer.p4 = finalPos; if (Math.abs(state.tempLayer.p1.x - state.tempLayer.p2.x) > 5) { state.layers.push(state.tempLayer); } isFinalStep = true; } 
        else if (state.currentAction === 'drawingFrustum') { const { cx } = state.tempLayer; state.tempLayer.topY = finalPos.y; state.tempLayer.rx2 = Math.abs(finalPos.x - cx); state.tempLayer.ry2 = state.tempLayer.rx2 * 0.3; state.layers.push(state.tempLayer); isFinalStep = true; } 
        else if (state.currentAction === 'drawingTruncatedSphere') { const { cx, cy, rx, ry } = state.tempLayer; const cutY = Math.max(cy - ry, Math.min(cy + ry, finalPos.y)); const h = Math.abs(cutY - cy); const ratioY = h / ry; const cutRx = rx * Math.sqrt(1 - (ratioY * ratioY)); state.tempLayer.cutY = cutY; state.tempLayer.cutR = cutRx > 0 ? cutRx : 0; state.tempLayer.cutRy = state.tempLayer.cutR * 0.3; state.layers.push(state.tempLayer); isFinalStep = true; }
        
        if (isFinalStep) {
            saveState(state.layers);
            state.currentAction = 'none';
            state.tempLayer = null;
            if (state.hideCreationTooltip) {
                state.hideCreationTooltip();
            }
            redrawCallback();
        }
    }
    
    document.removeEventListener('pointermove', state.onPointerMove);
    document.removeEventListener('pointerup', state.onPointerUp);

    state.iCtx.clearRect(0, 0, state.interactionCanvas.width, state.interactionCanvas.height);
    
    if (state.isEditingText) {
        const textarea = textTool.getEditorTextarea();
        if (textarea) textarea.style.pointerEvents = 'auto';
    }

    if (state.eraserAnimationId) {
        cancelAnimationFrame(state.eraserAnimationId);
        state.eraserAnimationId = null;
    }

    if (state.isPanning) {
        state.isPanning = false;
        if (state.activeTool === 'pan') {
            state.canvas.style.cursor = 'grab';
        } else {
            updateCursor(state, null);
        }
    }

    const transformActions = ['rotating', 'scaling', 'moving', 'movingPivot', 'editingCurve'];
    if (transformActions.includes(state.currentAction)) {
        if (state.currentAction === 'rotating') {
            if (state.selectedLayers.length > 1 && state.groupRotation !== 0) {
                const groupPivot = state.groupPivot;
                const groupRotation = state.groupRotation;

                state.selectedLayers.forEach((layer, index) => {
                    const originalLayer = state.originalLayers[index];
                    const box = geo.getBoundingBox(originalLayer);
                    if (!box) return;

                    const originalCenter = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
                    const newCenter = geo.rotatePoint(originalCenter, groupPivot, groupRotation);
                    
                    const dx = newCenter.x - originalCenter.x;
                    const dy = newCenter.y - originalCenter.y;
                    
                    utils.translateLayer(layer, dx, dy);
                    layer.rotation = (layer.rotation || 0) + groupRotation;
                });
            }
            state.groupPivot = null;
            state.groupRotation = 0;
            saveState(state.layers);

        } else if (state.currentAction === 'movingPivot') {
            saveState(state.layers);
        } else {
            const dragDistance = Math.hypot(utils.getMousePos(e, state).x - state.dragStartPos.x, utils.getMousePos(e, state).y - state.dragStartPos.y);
            if (state.currentAction === 'editingCurve' && dragDistance < 5 / state.zoom) {
                state.isDrawing = false;
                state.currentAction = 'none';
                state.scalingHandle = null;
                state.originalLayers = [];
                return;
            } else {
                state.selectedLayers.forEach(layer => utils.applyTransformations(layer));
            
                if (state.currentAction === 'scaling' && state.selectedLayers.length === 1 && state.selectedLayers[0].type === 'pdf') {
                    const layer = state.selectedLayers[0];
                    utils.renderPdfPageToCanvas(layer, layer.currentPage).then(() => {
                        redrawCallback();
                    });
                }
                saveState(state.layers);
            }
        }
    }

    if (state.isEditingText) return;

    clearTimeout(state.shapeRecognitionTimer);
    
    if (state.isDrawing) {
        const rawEnd = utils.getMousePos(e, state);
        let finalStart = state.startPos;
        let finalEnd = rawEnd;

        const shouldSnap = (state.snappingMode === 'manual' && e.altKey) || (state.snappingMode === 'auto' && !e.altKey);
        if (shouldSnap) { /* ... */ }
        
        if (state.activeTool === 'line' && e.shiftKey) { /* ... */ }

        if (state.activeTool === 'brush' || state.activeTool === 'smart-brush') {
            const newLayer = state.tempLayer;
            if (newLayer && newLayer.points.length > 1) {
                if (state.smoothingAmount > 0) {
                    const tolerance = state.smoothingAmount * 0.5;
                    newLayer.points = utils.simplifyPath(newLayer.points, tolerance);
                }
                
                let finalLayer;
                if (state.activeTool === 'smart-brush' && !state.shapeWasJustRecognized) {
                    const recognizedShape = shapeRecognizer.recognizeShape(newLayer.points);
                    if (recognizedShape) {
                        finalLayer = { 
                            ...recognizedShape, 
                            color: newLayer.color, 
                            lineWidth: newLayer.lineWidth,
                            lineStyle: newLayer.lineStyle
                        };
                    } else {
                       finalLayer = newLayer; 
                    }
                } else {
                    finalLayer = newLayer;
                }
                state.layers.push(finalLayer);
                // --- НАЧАЛО ИЗМЕНЕНИЙ: Используем отложенное сохранение ---
                debouncedSaveState(state.layers);
                // --- КОНЕЦ ИЗМЕНЕНИЙ ---

                const ctx = state.ctx;
                ctx.save();
                ctx.translate(state.panX, state.panY);
                ctx.scale(state.zoom, state.zoom);
                drawLayer(ctx, finalLayer, state);
                ctx.restore();
            }
        } 
        else if (state.activeTool === 'eraser') { 
            if (state.didErase) {
                const idsToErase = new Set(Array.from(state.layersToErase).map(l => l.id));
                state.layers = state.layers.filter(layer => !idsToErase.has(layer.id));
                state.layersToErase.clear();
                saveState(state.layers);
            }
            redrawCallback(); 
        } else {
            const commonProps = { color: state.activeColor, lineWidth: state.activeLineWidth, id: Date.now(), rotation: 0, pivot: { x: 0, y: 0 }, lineStyle: state.activeLineStyle };
            switch(state.activeTool) {
                case 'rect': { const rect = { type: 'rect', x: Math.min(finalEnd.x, finalStart.x), y: Math.min(finalEnd.y, finalStart.y), width: Math.abs(finalEnd.x - finalStart.x), height: Math.abs(finalEnd.y - finalStart.y), ...commonProps }; if (rect.width > 5 || rect.height > 5) state.layers.push(rect); break; }
                case 'text': { const width = Math.abs(finalEnd.x - finalStart.x); const height = Math.abs(finalEnd.y - finalStart.y); if (width < 20 || height < 20) { state.isDrawing = false; redrawCallback(); return; } const newTextLayer = { type: 'text', x: Math.min(finalEnd.x, finalStart.x), y: Math.min(finalEnd.y, finalStart.y), width: width, height: height, content: '', color: state.activeTextColor, fontSize: state.activeFontSize, fontFamily: state.activeFontFamily, align: state.activeTextAlign, fontWeight: state.activeFontWeight, fontStyle: state.activeFontStyle, textDecoration: state.activeTextDecoration, id: Date.now(), rotation: 0, pivot: { x: 0, y: 0 } }; state.layers.push(newTextLayer); state.selectedLayers = [newTextLayer]; newTextLayer.isEditing = true; state.isDrawing = true; state.isEditingText = true; state.justCreatedText = true; textTool.startEditing(state, newTextLayer, (isIntermediate) => { if (isIntermediate) { redrawCallback(); state.updateFloatingToolbar(); if(state.updateTextEditorTransform) state.updateTextEditorTransform(newTextLayer, state); return; } state.isEditingText = false; const finishedLayer = state.layers.find(l => l.id === newTextLayer.id); if (finishedLayer) { finishedLayer.isEditing = false; } if (state.justCreatedText) { const selectButton = document.querySelector('button[data-tool="select"]'); if (selectButton) { selectButton.click(); } state.justCreatedText = false; } saveState(state.layers); redrawCallback(); state.updateFloatingToolbar(); }); state.isDrawing = false; return; }
                case 'rhombus': { const x = Math.min(finalEnd.x, finalStart.x); const y = Math.min(finalEnd.y, finalStart.y); const width = Math.abs(finalEnd.x - finalStart.x); const height = Math.abs(finalEnd.y - finalStart.y); if(width>5 && height>5) state.layers.push({ type: 'rhombus', p1: {x: x+width/2, y: y}, p2: {x: x+width, y: y+height/2}, p3: {x: x+width/2, y: y+height}, p4: {x: x, y: y+height/2}, ...commonProps }); break; }
                case 'ellipse': case 'sphere': case 'cone': { const width = Math.abs(finalEnd.x - finalStart.x); const height = Math.abs(finalEnd.y - finalStart.y); const cx = finalStart.x + (finalEnd.x - finalStart.x) / 2; const cy = finalStart.y + (finalEnd.y - finalStart.y) / 2; if (state.activeTool === 'sphere') { const rx = width / 2; const ry = e.shiftKey ? rx : height / 2; if (rx > 2 || ry > 2) state.layers.push({ type: 'sphere', cx, cy, rx, ry, ...commonProps }); } else if (state.activeTool === 'cone') { const rx = width / 2; const apex = {x: cx, y: Math.min(finalEnd.y, finalStart.y)}; const baseY = Math.max(finalEnd.y, finalStart.y); if (rx > 5 && height > 5) state.layers.push({ type: 'cone', cx, baseY, rx, ry: rx * 0.3, apex, ...commonProps }); } else { const rx = width / 2; const ry = height/2; if (rx > 2 || ry > 2) state.layers.push({ type: 'ellipse', cx, cy, rx, ry, ...commonProps }); } break; }
                case 'line': { const line = { type: 'line', x1: finalStart.x, y1: finalStart.y, x2: finalEnd.x, y2: finalEnd.y, ...commonProps }; if (Math.abs(line.x1 - line.x2) > 5 || Math.abs(line.y1 - line.y2) > 5) state.layers.push(line); break; }
            }
            saveState(state.layers);
            redrawCallback();
        }
    } else if (state.currentAction !== 'selectionBox') { // Добавляем проверку, чтобы не было лишней перерисовки
      redrawCallback(); 
    }
    
    updateCursor(state, null);
    if (state.currentAction === 'selectionBox') {
        actions.endSelectionBox(state, utils.getMousePos(e, state), e);
        updateToolbarCallback();
        state.updateFloatingToolbar();
    }

    state.isDrawing = false; 
    state.currentAction = 'none'; 
    state.scalingHandle = null; 
    state.startPos = null; 
    state.originalBox = null; 
    state.originalLayers = []; 
    state.groupPivot = null; 
    state.didErase = false; 
    state.groupRotation = 0; 
    state.snapPoint = null;
    state.tempLayer = null;
    if (state.hideCreationTooltip) {
        state.hideCreationTooltip();
    }
}