// js/pointerHandlers.js

import * as geo from './geometry.js';
import * as hitTest from './hitTest.js';
import * as actions from './actions.js';
import * as tools from './tools.js';
import * as utils from './utils.js';
import * as shapeRecognizer from './shapeRecognizer.js';
import * as textTool from './text.js';
import { animateEraserTrail, updateCursor } from './ui.js';
import { drawLayer, drawSelectionBox } from './renderer.js';

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

/**
 * Подготавливает холсты к интерактивной трансформации.
 * Рисует все невыбранные объекты на кеш-холст один раз.
 */
function prepareInteractionCache(state) {
    state.isInteracting = true;
    const { cacheCtx, ctx, layers, selectedLayers, cacheCanvas } = state;
    const selectedIds = new Set(selectedLayers.map(l => l.id));

    // Очищаем кеш и основной холст для рисования
    cacheCtx.clearRect(0, 0, cacheCanvas.width, cacheCanvas.height);
    cacheCtx.save();
    cacheCtx.translate(state.panX, state.panY);
    cacheCtx.scale(state.zoom, state.zoom);

    // Рисуем все НЕвыбранные слои на кеш-холст
    layers.forEach(layer => {
        if (!selectedIds.has(layer.id)) {
            drawLayer(cacheCtx, layer, state);
        }
    });
    cacheCtx.restore();

    // Очищаем основной холст, чтобы на нем не было "грязи"
    ctx.clearRect(0, 0, state.canvas.width, state.canvas.height);
}

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
            if (state.tempLayer.points && state.tempLayer.points.length > 2) {
                 const newLayer = utils.cloneLayersForAction([state.tempLayer])[0];
                 state.layers.push(newLayer);
                 saveState({ type: 'creation', before: [], after: [newLayer] });
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
            const layersToErase = utils.cloneLayersForAction(Array.from(state.layersToErase));
            const idsToErase = new Set(layersToErase.map(l => l.id));
            saveState({ type: 'deletion', before: layersToErase, after: [] });
            state.layers = state.layers.filter(layer => !idsToErase.has(layer.id));
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
    if (state.hoverCheckTimer) {
        clearTimeout(state.hoverCheckTimer);
        state.hoverCheckTimer = null;
    }
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
    state.dragStartPos = pos;

    const isPanToolActive = state.activeTool === 'pan' && e.button === 0;
    const isMiddleMouseButton = e.pointerType === 'mouse' && e.button === 1;

    if (isPanToolActive || isMiddleMouseButton) {
        state.isPanning = true;
        state.panStartPos = { x: e.clientX, y: e.clientY };
        state.initialPan = { x: state.panX, y: state.panY };
        state.canvas.style.cursor = 'grabbing';

        // --- НАЧАЛО ИЗМЕНЕНИЙ: Правильное кеширование для панорамирования ---
        // Создаем пиксельный "снимок" текущего состояния основного холста.
        // Это самый быстрый и надежный способ избежать проблем с обрезкой.
        const { cacheCtx, cacheCanvas, canvas } = state;
        cacheCtx.clearRect(0, 0, cacheCanvas.width, cacheCanvas.height);
        cacheCtx.drawImage(canvas, 0, 0);
        // --- КОНЕЦ ИЗМЕНЕНИЙ ---
        
        document.addEventListener('pointermove', state.onPointerMove);
        document.addEventListener('pointerup', state.onPointerUp);
        return;
    }
    
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    
    hideContextMenu();
    
    if (state.activeTool === 'select') {
        document.addEventListener('pointermove', state.onPointerMove);
        document.addEventListener('pointerup', state.onPointerUp);
        
        const now = Date.now();
        const CLICK_SPEED = 500, CLICK_RADIUS = 20;
        const timeDiff = now - state.lastClickTime;
        if (state.lastClickPos && timeDiff < CLICK_SPEED && Math.abs(pos.x - state.lastClickPos.x) < CLICK_RADIUS && Math.abs(pos.y - state.lastClickPos.y) < CLICK_RADIUS) { state.clickCount++; } else { state.clickCount = 1; }
        state.lastClickTime = now; state.lastClickPos = pos;
        
        if (state.clickCount === 2 && e.button === 0) {
            const clickedLayer = hitTest.getLayerAtPosition(pos, state.layers, state.zoom, state.spatialGrid);
            if (clickedLayer && clickedLayer.type === 'text') {
                state.selectedLayers = [clickedLayer];
                clickedLayer.isEditing = true;
                state.isEditingText = true;
                redrawCallback();
                state.updateFloatingToolbar();
                textTool.startEditing(state, clickedLayer, (isIntermediate, before, after) => {
                    if (isIntermediate) { redrawCallback(); state.updateFloatingToolbar(); if(state.updateTextEditorTransform) state.updateTextEditorTransform(clickedLayer, state); return; }
                    
                    state.isEditingText = false;
                    const finishedLayer = state.layers.find(l => l.id === clickedLayer.id);
                    if (finishedLayer) { finishedLayer.isEditing = false; }

                    if (before && after) {
                        saveState({ type: 'update', before, after });
                    }
                    
                    redrawCallback();
                    state.updateFloatingToolbar();
                });
                return;
            } else if (clickedLayer && clickedLayer.type === 'curve') {
                e.preventDefault();
                const closest = geo.findClosestPointOnCurveSegment(pos, clickedLayer);
                if (closest && closest.distance < (10 / state.zoom)) {
                    const before = utils.cloneLayersForAction([clickedLayer]);
                    const [p0, p1, p2, p3] = [clickedLayer.nodes[closest.segmentIndex].p, clickedLayer.nodes[closest.segmentIndex].h1, clickedLayer.nodes[closest.segmentIndex + 1].h2, clickedLayer.nodes[closest.segmentIndex + 1].p];
                    const newNodeP = geo.getPointOnBezier(closest.t, p0, p1, p2, p3);
                    const newNode = { p: newNodeP, h1: null, h2: null, type: 'smooth' };
                    clickedLayer.nodes.splice(closest.segmentIndex + 1, 0, newNode);
                    utils.smoothCurveHandles(clickedLayer.nodes);
                    const after = utils.cloneLayersForAction([clickedLayer]);
                    saveState({ type: 'update', before, after });
                    redrawCallback();
                }
                return;
            }
        }
        
        state.groupRotation = 0;
        const handle = hitTest.getHandleAtPosition(pos, state.selectedLayers, state.zoom, state.groupRotation);

        if (handle) {
            document.querySelectorAll('.floating-toolbar').forEach(tb => tb.classList.remove('visible'));
            state.scalingHandle = handle;
            if (typeof handle === 'object' && (handle.type === 'curveNode' || handle.type === 'curveHandle')) {
                if (handle.type === 'curveNode' && state.selectedCurveNodeIndex !== handle.nodeIndex) { state.selectedCurveNodeIndex = handle.nodeIndex; }
                else if (handle.type === 'curveHandle') { state.selectedCurveNodeIndex = null; }
                state.currentAction = 'editingCurve';
                state.originalLayers = utils.cloneLayersForAction(state.selectedLayers);
            } else if (handle === 'pivot') { 
                state.currentAction = 'movingPivot';
                state.canvas.style.cursor = 'none';
                state.originalLayers = utils.cloneLayersForAction(state.selectedLayers);
            } else if (handle === 'rotate') {
                state.currentAction = 'rotating';
                const box = geo.getGroupLogicalBoundingBox(state.selectedLayers);
                const centerX = box.x + box.width / 2, centerY = box.y + box.height / 2;
                let pivotX = centerX, pivotY = centerY;
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
            prepareInteractionCache(state);
            return;
        }

        if (state.selectedLayers.length > 0) {
            const selectionBox = geo.getGroupBoundingBox(state.selectedLayers);
            if (selectionBox) {
                const rotation = hitTest.getSelectionRotation(state.selectedLayers, state.groupRotation);
                const center = { x: selectionBox.x + selectionBox.width/2, y: selectionBox.y + selectionBox.height/2 };
                const rotatedPos = geo.rotatePoint(pos, center, -rotation);
                const logicalBox = geo.getGroupLogicalBoundingBox(state.selectedLayers);

                if (geo.isPointInRect(rotatedPos, logicalBox)) {
                    document.querySelectorAll('.floating-toolbar').forEach(tb => tb.classList.remove('visible'));
                    state.currentAction = 'moving';
                    state.originalLayers = utils.cloneLayersForAction(state.selectedLayers);
                    prepareInteractionCache(state);
                    return;
                }
            }
        }

        const clickedLayer = hitTest.getLayerAtPosition(pos, state.layers, state.zoom, state.spatialGrid);
        if (clickedLayer) {
            const isAlreadySelected = state.selectedLayers.some(l => l.id === clickedLayer.id);
            if (e.shiftKey) {
                if (isAlreadySelected) {
                    state.selectedLayers = state.selectedLayers.filter(l => l.id !== clickedLayer.id);
                } else {
                    state.selectedLayers.push(clickedLayer);
                }
                state.selectedCurveNodeIndex = null;
                
                if (state.selectedLayers.length > 1) {
                    // Проверяем, нужно ли сбрасывать pivot/rotation у каких-либо слоев в группе
                    const needsReset = state.selectedLayers.some(l => (l.rotation && l.rotation !== 0) || (l.pivot && (l.pivot.x !== 0 || l.pivot.y !== 0)));
            
                    if (needsReset) {
                        const before = utils.cloneLayersForAction(state.selectedLayers);
                        
                        // "Запекаем" трансформации и сбрасываем pivot/rotation
                        state.selectedLayers.forEach(layer => {
                            utils.applyTransformations(layer);
                        });
            
                        const after = utils.cloneLayersForAction(state.selectedLayers);
                        
                        saveState({
                            type: 'update',
                            before: before,
                            after: after,
                        });
                    }
                }

            } else {
                if (!isAlreadySelected) {
                    state.selectedLayers = [clickedLayer];
                    state.selectedCurveNodeIndex = null;
                }
                document.querySelectorAll('.floating-toolbar').forEach(tb => tb.classList.remove('visible'));
                state.currentAction = 'moving';
                state.originalLayers = utils.cloneLayersForAction(state.selectedLayers);
                prepareInteractionCache(state);
            }
            redrawCallback(); 
            updateToolbarCallback();
            state.updateFloatingToolbar();
        } else {
            if (!e.shiftKey && !e.ctrlKey && !e.metaKey) {
                if (state.selectedLayers.length > 0) {
                    // This deselection doesn't need to be in history.
                    // Transformations are saved at the end of the action.
                }
                state.selectedLayers = [];
                state.selectedCurveNodeIndex = null;
            }
            state.currentAction = 'selectionBox';
            state.startPos = pos;
            redrawCallback(); 
            updateToolbarCallback();
            state.updateFloatingToolbar();
        }
    } else {
        document.addEventListener('pointermove', state.onPointerMove);
        document.addEventListener('pointerup', state.onPointerUp);
        
        state.selectedLayers = []; 
        state.selectedCurveNodeIndex = null;
        updateToolbarCallback();
        state.updateFloatingToolbar();
        state.isDrawing = true; 

        let finalPos = pos;
        const isSnappingTool = !['brush', 'smart-brush', 'curve'].includes(state.activeTool);
        const shouldSnap = isSnappingTool && ((state.snappingMode === 'manual' && e.altKey) || (state.snappingMode === 'auto' && !e.altKey));
        if (shouldSnap) {
            const SNAP_THRESHOLD = 10 / state.zoom;
            const snappedX = utils.snapToGrid(pos.x);
            const snappedY = utils.snapToGrid(pos.y);
            finalPos.x = (Math.abs(snappedX - pos.x) < SNAP_THRESHOLD) ? snappedX : pos.x;
            finalPos.y = (Math.abs(snappedY - pos.y) < SNAP_THRESHOLD) ? snappedY : pos.y;
        }
        state.startPos = finalPos;

        if (state.activeTool === 'curve') {
            if (!state.tempLayer || state.tempLayer.type !== 'curve') {
                state.currentAction = 'drawingCurve';
                state.tempLayer = { type: 'curve', nodes: [], color: state.activeColor, lineWidth: state.activeLineWidth, id: Date.now(), rotation: 0, pivot: { x: 0, y: 0 }, lineStyle: state.activeLineStyle };
                const newNode = { p: { ...finalPos }, h1: { ...finalPos }, h2: { ...finalPos }, type: 'smooth' };
                state.tempLayer.nodes.push(newNode);
            } else {
                const lastNode = state.tempLayer.nodes[state.tempLayer.nodes.length - 1];
                const reflectedH1 = { x: 2 * lastNode.p.x - lastNode.h1.x, y: 2 * lastNode.p.y - lastNode.h1.y };
                const newNode = { p: { ...finalPos }, h1: { ...finalPos }, h2: reflectedH1, type: 'smooth' };
                state.tempLayer.nodes.push(newNode);
            }
    
            if (state.tempLayer.nodes.length === 3) {
                utils.smoothCurveHandles(state.tempLayer.nodes); 
                const newLayer = utils.cloneLayersForAction([state.tempLayer])[0];
                state.layers.push(newLayer);
                saveState({ type: 'creation', before: [], after: [newLayer] });
                state.selectedLayers = [newLayer];
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
        
        if (state.activeTool === 'text' && !state.isEditingText && e.button === 0) {
            const clickedLayer = hitTest.getLayerAtPosition(pos, state.layers, state.zoom, state.spatialGrid);
            if (clickedLayer && clickedLayer.type === 'text') {
                state.selectedLayers = [clickedLayer];
                clickedLayer.isEditing = true;
                state.isEditingText = true;
                redrawCallback();
                state.updateFloatingToolbar();
                textTool.startEditing(state, clickedLayer, (isIntermediate, before, after) => {
                    if (isIntermediate) { redrawCallback(); state.updateFloatingToolbar(); if (state.updateTextEditorTransform) state.updateTextEditorTransform(clickedLayer, state); return; }
                    state.isEditingText = false;
                    const finishedLayer = state.layers.find(l => l.id === clickedLayer.id);
                    if (finishedLayer) { finishedLayer.isEditing = false; }
                    if (before && after) {
                        saveState({ type: 'update', before, after });
                    }
                    redrawCallback();
                    state.updateFloatingToolbar();
                });
                return;
            }
        }
        
        clearTimeout(state.shapeRecognitionTimer);
        state.shapeWasJustRecognized = false;
        state.layersToErase.clear();

        if (state.activeTool === 'brush' || state.activeTool === 'smart-brush') {
            state.tempLayer = { type: 'path', points: [], hasPressure: e.pointerType === 'pen', color: state.activeColor, lineWidth: state.activeLineWidth, id: Date.now(), rotation: 0, pivot: { x: 0, y: 0 }, lineStyle: state.activeLineStyle };
            const point = [finalPos.x, finalPos.y];
            if (state.tempLayer.hasPressure) {
                const rawPressure = e.pressure > 0 ? e.pressure : 0.5;
                const pressure = rawPressure < 0.5 ? rawPressure * 2 : rawPressure + 0.5;
                point.push(pressure);
            }
            state.tempLayer.points.push(...point);
            state.lastBrushPoint = finalPos;
        } else if (state.activeTool === 'eraser') {
            state.isDrawing = true;
            state.didErase = false;
            
            if (!document.body.classList.contains('no-animations')) {
                state.lastEraserPos = finalPos;
                state.eraserTrailNodes = Array(10).fill(null).map(() => ({ ...finalPos }));
                if (state.eraserAnimationId) { cancelAnimationFrame(state.eraserAnimationId); }
                animateEraserTrail(state);
            }
        }
    }
}

export function draw(state, callbacks, e) {
    if (state.isMultiTouching) return;

    const { redrawCallback, saveViewStateCallback, drawBackgroundCallback } = callbacks;

    if (state.isPanning) { 
        const dx = e.clientX - state.panStartPos.x; 
        const dy = e.clientY - state.panStartPos.y; 
        
        // --- НАЧАЛО ИЗМЕНЕНИЙ: Правильная отрисовка во время панорамирования ---
        // Обновляем `panX` и `panY` временно, чтобы фон (сетка) отрисовался в правильном месте.
        state.panX = state.initialPan.x + dx;
        state.panY = state.initialPan.y + dy;

        // Перерисовываем фон с новым смещением.
        if (drawBackgroundCallback) {
            drawBackgroundCallback();
        }
        
        // Очищаем основной холст и рисуем на нем сдвинутый "снимок" из кеша.
        // Это быстрая операция, которая не вызывает "обрезку".
        state.ctx.clearRect(0, 0, state.canvas.width, state.canvas.height);
        state.ctx.drawImage(state.cacheCanvas, dx, dy);
        // --- КОНЕЦ ИЗМЕНЕНИЙ ---
        
        state.updateFloatingToolbar(); 
        if (saveViewStateCallback) {
            saveViewStateCallback();
        }
        return; 
    }
    
    if (state.isInteracting) {
        const pos = utils.getMousePos(e, state);
        
        state.iCtx.clearRect(0, 0, state.interactionCanvas.width, state.interactionCanvas.height);
        state.iCtx.drawImage(state.cacheCanvas, 0, 0);

        switch(state.currentAction) {
            case 'editingCurve': actions.handleEditCurve(state, pos, e); break;
            case 'movingPivot': actions.handleMovePivot(state, pos); break;
            case 'rotating': actions.handleRotate(state, pos, e); break;
            case 'moving': actions.handleMove(state, pos, e); break;
            case 'scaling': actions.handleScale(state, pos, e); break;
        }
        
        state.iCtx.save();
        state.iCtx.translate(state.panX, state.panY);
        state.iCtx.scale(state.zoom, state.zoom);

        if (state.selectedLayers.length > 1 && state.groupRotation && state.groupPivot) {
            state.iCtx.save(); 
            state.iCtx.translate(state.groupPivot.x, state.groupPivot.y);
            state.iCtx.rotate(state.groupRotation);
            state.iCtx.translate(-state.groupPivot.x, -state.groupPivot.y);
        }

        state.selectedLayers.forEach(layer => {
            drawLayer(state.iCtx, layer, state);
        });

        if (state.selectedLayers.length > 1 && state.groupRotation && state.groupPivot) {
            state.iCtx.restore(); 
        }

        drawSelectionBox(state.iCtx, state.selectedLayers, state);
        
        state.iCtx.restore();
        
        return; 
    }

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

    if (state.currentAction !== 'none' || state.isDrawing) {
        if (state.isEditingText && (state.currentAction === 'moving' || state.currentAction === 'scaling')) {
            const textarea = textTool.getEditorTextarea();
            if (textarea) textarea.style.pointerEvents = 'none';
        }
        
        const shouldSnap = (state.snappingMode === 'manual' && e.altKey) || (state.snappingMode === 'auto' && !e.altKey);
        if (!shouldSnap) { state.snapPoint = null; }

        switch(state.currentAction) {
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
                const point = [pos.x, pos.y];
                if (state.tempLayer.hasPressure) {
                    const rawPressure = e.pressure > 0 ? e.pressure : 0.5;
                    const pressure = rawPressure < 0.5 ? rawPressure * 2 : rawPressure + 0.5;
                    point.push(pressure);
                }
                state.tempLayer.points.push(...point);

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
                        const recognizedShape = shapeRecognizer.recognizeShape(state.tempLayer.points, state.tempLayer.hasPressure);
                        if (recognizedShape) {
                            const newLayer = {
                                ...recognizedShape,
                                color: state.tempLayer.color,
                                lineWidth: state.tempLayer.lineWidth,
                                lineStyle: state.tempLayer.lineStyle
                            };
                            state.layers.push(newLayer);
                            state.tempLayer.points = [];
                            state.iCtx.clearRect(0, 0, state.interactionCanvas.width, state.interactionCanvas.height);
                            state.isDrawing = false;
                            state.shapeWasJustRecognized = true;
                            redrawCallback();
                            callbacks.saveState({ type: 'creation', before: [], after: [newLayer] });
                        }
                    }, 500);
                }
            } else if (state.activeTool === 'eraser') {
                const layerToErase = hitTest.getLayerAtPosition(pos, state.layers, state.zoom, state.spatialGrid);
                if (layerToErase && layerToErase.type !== 'image' && layerToErase.type !== 'pdf' && !state.layersToErase.has(layerToErase)) {
                    state.layersToErase.add(layerToErase);
                    state.didErase = true;
                    redrawCallback();
                }

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
            }
        }
    } else {
        if (state.hoverCheckTimer) {
            clearTimeout(state.hoverCheckTimer);
        }
        state.hoverCheckTimer = setTimeout(() => {
            const handle = (state.selectedLayers.length > 0)
                ? hitTest.getHandleAtPosition(pos, state.selectedLayers, state.zoom, state.groupRotation)
                : null;

            if (handle) {
                const rotation = hitTest.getSelectionRotation(state.selectedLayers, state.groupRotation);
                updateCursor(state, handle, rotation);
            } else {
                const layerAtPos = hitTest.getLayerAtPosition(pos, state.layers, state.zoom, state.spatialGrid);
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
        }, 50);
    }
}

export function stopDrawing(state, callbacks, e) {
    if (state.isInteracting) {
        state.isInteracting = false;
        state.iCtx.clearRect(0, 0, state.interactionCanvas.width, state.interactionCanvas.height);
        state.cacheCtx.clearRect(0, 0, state.cacheCanvas.width, state.cacheCanvas.height);
    }
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

    const { redrawCallback, saveState, updateToolbarCallback } = callbacks;
    
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
        if (shouldSnap) { /* ... */ }
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
        let createdLayer = null;

        if (state.currentAction === 'drawingParallelogramSlant') { const finalSlant = finalPos.x - (state.tempLayer.x + state.tempLayer.width / 2); state.tempLayer.slantOffset = finalSlant; if (state.tempLayer.width > 5 || state.tempLayer.height > 5) { createdLayer = state.tempLayer; } isFinalStep = true; } 
        else if (state.currentAction === 'drawingTriangleApex') { state.tempLayer.p3 = finalPos; if (Math.abs(state.tempLayer.p1.x - state.tempLayer.p2.x) > 5 || Math.abs(state.tempLayer.p1.y - state.tempLayer.p2.y) > 5) { createdLayer = state.tempLayer; } isFinalStep = true; } 
        else if (state.currentAction === 'drawingParallelepipedDepth') { state.tempLayer.depthOffset = { x: finalPos.x - (state.tempLayer.x + state.tempLayer.width), y: finalPos.y - state.tempLayer.y }; if (state.tempLayer.width > 5 || state.tempLayer.height > 5) { createdLayer = state.tempLayer; } isFinalStep = true; } 
        else if (state.currentAction === 'drawingPyramidApex') { state.tempLayer.apex = finalPos; createdLayer = state.tempLayer; isFinalStep = true; } 
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
        else if (state.currentAction === 'drawingTruncatedPyramidTop') { const { base, apex } = state.tempLayer; const totalHeight = Math.abs(apex.y - base.p1.y); const cutHeight = Math.abs(finalPos.y - base.p1.y); const ratio = Math.max(0.05, Math.min(0.95, cutHeight / totalHeight)); const interpolate = (p1, p2) => ({ x: p1.x + (p2.x - p1.x) * ratio, y: p1.y + (p2.y - p1.y) * ratio }); state.tempLayer.top = { p1: interpolate(base.p1, apex), p2: interpolate(base.p2, apex), p3: interpolate(base.p3, apex), p4: interpolate(base.p4, apex), }; delete state.tempLayer.apex; createdLayer = state.tempLayer; isFinalStep = true; } 
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
        else if (state.currentAction === 'drawingTrapezoidP4') { state.tempLayer.p4 = finalPos; if (Math.abs(state.tempLayer.p1.x - state.tempLayer.p2.x) > 5) { createdLayer = state.tempLayer; } isFinalStep = true; } 
        else if (state.currentAction === 'drawingFrustum') { const { cx } = state.tempLayer; state.tempLayer.topY = finalPos.y; state.tempLayer.rx2 = Math.abs(finalPos.x - cx); state.tempLayer.ry2 = state.tempLayer.rx2 * 0.3; createdLayer = state.tempLayer; isFinalStep = true; } 
        else if (state.currentAction === 'drawingTruncatedSphere') { const { cx, cy, rx, ry } = state.tempLayer; const cutY = Math.max(cy - ry, Math.min(cy + ry, finalPos.y)); const h = Math.abs(cutY - cy); const ratioY = h / ry; const cutRx = rx * Math.sqrt(1 - (ratioY * ratioY)); state.tempLayer.cutY = cutY; state.tempLayer.cutR = cutRx > 0 ? cutRx : 0; state.tempLayer.cutRy = state.tempLayer.cutR * 0.3; createdLayer = state.tempLayer; isFinalStep = true; }
        
        if (isFinalStep) {
            if (createdLayer) {
                const newLayer = utils.cloneLayersForAction([createdLayer])[0];
                state.layers.push(newLayer);
                saveState({ type: 'creation', before: [], after: [newLayer] });
            }
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

        // --- НАЧАЛО ИЗМЕНЕНИЙ: Финальная отрисовка после панорамирования ---
        // Окончательно обновляем координаты панорамирования.
        const dx = e.clientX - state.panStartPos.x;
        const dy = e.clientY - state.panStartPos.y;
        state.panX = state.initialPan.x + dx;
        state.panY = state.initialPan.y + dy;
        
        // Очищаем кеш и вызываем полную, качественную перерисовку.
        state.cacheCtx.clearRect(0, 0, state.cacheCanvas.width, state.cacheCanvas.height);
        redrawCallback();
        // --- КОНЕЦ ИЗМЕНЕНИЙ ---
        
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
                state.selectedLayers.forEach((layer) => {
                    const box = geo.getBoundingBox(layer);
                    if (!box) return;

                    const originalCenter = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
                    const newCenter = geo.rotatePoint(originalCenter, state.groupPivot, state.groupRotation);
                    
                    const dx = newCenter.x - originalCenter.x;
                    const dy = newCenter.y - originalCenter.y;
                    
                    utils.translateLayer(layer, dx, dy);
                    layer.rotation = (layer.rotation || 0) + state.groupRotation;
                });
            }
             state.groupPivot = null;
             state.groupRotation = 0;
        }

        const dragDistance = Math.hypot(utils.getMousePos(e, state).x - state.dragStartPos.x, utils.getMousePos(e, state).y - state.dragStartPos.y);
        
        if (state.currentAction === 'editingCurve' && dragDistance < 5 / state.zoom) {
            // Do nothing if it was just a click
        } else {
            const finalLayers = utils.cloneLayersForAction(state.selectedLayers);
            saveState({
                type: 'update',
                before: state.originalLayers,
                after: finalLayers
            });
            
            if (state.currentAction === 'scaling' && state.selectedLayers.length === 1 && state.selectedLayers[0].type === 'pdf') {
                const layer = state.selectedLayers[0];
                utils.renderPdfPageToCanvas(layer, layer.currentPage).then(redrawCallback);
            }
        }
    }

    if (state.isEditingText) return;

    clearTimeout(state.shapeRecognitionTimer);
    
    if (state.isDrawing) {
        if (state.activeTool === 'brush' || state.activeTool === 'smart-brush') {
            const newLayer = state.tempLayer;
            if (newLayer && newLayer.points.length > 1) {
                if (state.smoothingAmount > 0) {
                    const tolerance = state.smoothingAmount * 0.5;
                    newLayer.points = utils.simplifyPath(newLayer.points, tolerance);
                }
                
                let finalLayer;
                if (state.activeTool === 'smart-brush' && !state.shapeWasJustRecognized) {
                    const recognizedShape = shapeRecognizer.recognizeShape(newLayer.points, newLayer.hasPressure);
                    if (recognizedShape) {
                        finalLayer = { ...recognizedShape, color: newLayer.color, lineWidth: newLayer.lineWidth, lineStyle: newLayer.lineStyle };
                    } else {
                       finalLayer = newLayer; 
                    }
                } else {
                    finalLayer = newLayer;
                }
                state.layers.push(finalLayer);
                saveState({ type: 'creation', before: [], after: [finalLayer] });

                const ctx = state.ctx;
                ctx.save();
                ctx.translate(state.panX, state.panY);
                ctx.scale(state.zoom, state.zoom);
                drawLayer(ctx, finalLayer, state);
                ctx.restore();
            }
            state.isDrawing = false;
            state.currentAction = 'none';
            state.tempLayer = null;
            return;
        } 
        
        const rawEnd = utils.getMousePos(e, state);
        let finalStart = state.startPos;
        let finalEnd = rawEnd;

        const shouldSnap = (state.snappingMode === 'manual' && e.altKey) || (state.snappingMode === 'auto' && !e.altKey);
        if (shouldSnap) { /* ... */ }
        
        if (state.activeTool === 'line' && e.shiftKey) { /* ... */ }

        if (state.activeTool === 'eraser') { 
            if (state.didErase) {
                const layersToErase = utils.cloneLayersForAction(Array.from(state.layersToErase));
                const idsToErase = new Set(layersToErase.map(l => l.id));
                saveState({ type: 'deletion', before: layersToErase, after: [] });
                state.layers = state.layers.filter(layer => !idsToErase.has(layer.id));
                state.layersToErase.clear();
            }
            redrawCallback(); 
        } else {
            let newLayer = null;
            const commonProps = { color: state.activeColor, lineWidth: state.activeLineWidth, id: Date.now(), rotation: 0, pivot: { x: 0, y: 0 }, lineStyle: state.activeLineStyle };
            switch(state.activeTool) {
                case 'rect': { const rect = { type: 'rect', x: Math.min(finalEnd.x, finalStart.x), y: Math.min(finalEnd.y, finalStart.y), width: Math.abs(finalEnd.x - finalStart.x), height: Math.abs(finalEnd.y - finalStart.y), ...commonProps }; if (rect.width > 5 || rect.height > 5) newLayer = rect; break; }
                case 'text': { const width = Math.abs(finalEnd.x - finalStart.x); const height = Math.abs(finalEnd.y - finalStart.y); if (width < 20 || height < 20) { state.isDrawing = false; redrawCallback(); return; } const newTextLayer = { type: 'text', x: Math.min(finalEnd.x, finalStart.x), y: Math.min(finalEnd.y, finalStart.y), width: width, height: height, content: '', color: state.activeTextColor, fontSize: state.activeFontSize, fontFamily: state.activeFontFamily, align: state.activeTextAlign, fontWeight: state.activeFontWeight, fontStyle: state.activeFontStyle, textDecoration: state.activeTextDecoration, id: Date.now(), rotation: 0, pivot: { x: 0, y: 0 } }; state.layers.push(newTextLayer); state.selectedLayers = [newTextLayer]; newTextLayer.isEditing = true; state.isDrawing = true; state.isEditingText = true; state.justCreatedText = true; textTool.startEditing(state, newTextLayer, (isIntermediate, before, after) => { if (isIntermediate) { redrawCallback(); state.updateFloatingToolbar(); if(state.updateTextEditorTransform) state.updateTextEditorTransform(newTextLayer, state); return; } state.isEditingText = false; const finishedLayer = state.layers.find(l => l.id === newTextLayer.id); if (finishedLayer) { finishedLayer.isEditing = false; } if (state.justCreatedText) { const selectButton = document.querySelector('button[data-tool="select"]'); if (selectButton) { selectButton.click(); } state.justCreatedText = false; } if (before && after) { saveState({ type: 'creation', before, after }); } redrawCallback(); state.updateFloatingToolbar(); }); state.isDrawing = false; return; }
                case 'rhombus': { const x = Math.min(finalEnd.x, finalStart.x); const y = Math.min(finalEnd.y, finalStart.y); const width = Math.abs(finalEnd.x - finalStart.x); const height = Math.abs(finalEnd.y - finalStart.y); if(width>5 && height>5) newLayer = { type: 'rhombus', p1: {x: x+width/2, y: y}, p2: {x: x+width, y: y+height/2}, p3: {x: x+width/2, y: y+height}, p4: {x: x, y: y+height/2}, ...commonProps }; break; }
                case 'ellipse': case 'sphere': case 'cone': { const width = Math.abs(finalEnd.x - finalStart.x); const height = Math.abs(finalEnd.y - finalStart.y); const cx = finalStart.x + (finalEnd.x - finalStart.x) / 2; const cy = finalStart.y + (finalEnd.y - finalStart.y) / 2; if (state.activeTool === 'sphere') { const rx = width / 2; const ry = e.shiftKey ? rx : height / 2; if (rx > 2 || ry > 2) newLayer = { type: 'sphere', cx, cy, rx, ry, ...commonProps }; } else if (state.activeTool === 'cone') { const rx = width / 2; const apex = {x: cx, y: Math.min(finalEnd.y, finalStart.y)}; const baseY = Math.max(finalEnd.y, finalStart.y); if (rx > 5 && height > 5) newLayer = { type: 'cone', cx, baseY, rx, ry: rx * 0.3, apex, ...commonProps }; } else { const rx = width / 2; const ry = height/2; if (rx > 2 || ry > 2) newLayer = { type: 'ellipse', cx, cy, rx, ry, ...commonProps }; } break; }
                case 'line': { const line = { type: 'line', x1: finalStart.x, y1: finalStart.y, x2: finalEnd.x, y2: finalEnd.y, ...commonProps }; if (Math.abs(line.x1 - line.x2) > 5 || Math.abs(line.y1 - line.y2) > 5) newLayer = line; break; }
            }
            if (newLayer) {
                state.layers.push(newLayer);
                saveState({ type: 'creation', before: [], after: [newLayer] });
            }
            redrawCallback();
        }
    } else if (state.currentAction === 'selectionBox') { 
      redrawCallback();
    } else {
        redrawCallback();
    }
    
    updateCursor(state, null);
    if (state.currentAction === 'selectionBox') {
        actions.endSelectionBox(state, utils.getMousePos(e, state), e);
        
        if (state.selectedLayers.length > 1) {
            const needsReset = state.selectedLayers.some(l => (l.rotation && l.rotation !== 0) || (l.pivot && (l.pivot.x !== 0 || l.pivot.y !== 0)));
    
            if (needsReset) {
                const before = utils.cloneLayersForAction(state.selectedLayers);
                
                state.selectedLayers.forEach(layer => {
                    utils.applyTransformations(layer);
                });
    
                const after = utils.cloneLayersForAction(state.selectedLayers);
                
                saveState({
                    type: 'update',
                    before: before,
                    after: after,
                });
            }
        }
        
        redrawCallback();
    }
    
    state.updateFloatingToolbar();
    
    if (state.currentAction === 'selectionBox') {
        updateToolbarCallback();
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