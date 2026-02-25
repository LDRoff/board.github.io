// --- START OF FILE js/pointerHandlers.js ---

import * as geo from './geometry.js';
import * as hitTest from './hitTest.js';
import * as actions from './actions.js';
import * as tools from './tools.js';
import * as utils from './utils.js';
import * as shapeRecognizer from './shapeRecognizer.js';
import * as textTool from './text.js';
// --- ИЗМЕНЕНИЕ: Импортируем новые функции для DOM-курсора ---
import { updateEraserCursor, hideEraserCursor, updateCursor } from './ui.js';
// -----------------------------------------------------------
import { drawLayer, drawSelectionBox } from './renderer.js';

// ... (константы и функции prepareInteractionCache, isSpenButtonPressed, checkAndHandleSpenEraser без изменений) ...
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

function prepareInteractionCache(state) {
    state.isInteracting = true;
    const { cacheCtx, ctx, iCtx, layers, selectedLayers, cacheCanvas, interactionCanvas } = state;
    const selectedIds = new Set(selectedLayers.map(l => l.id));
    const dpr = window.devicePixelRatio || 1;

    cacheCtx.setTransform(1, 0, 0, 1, 0, 0);
    cacheCtx.clearRect(0, 0, cacheCanvas.width, cacheCanvas.height);

    cacheCtx.save();
    cacheCtx.scale(dpr, dpr);
    cacheCtx.translate(state.panX, state.panY);
    cacheCtx.scale(state.zoom, state.zoom);

    layers.forEach(layer => {
        if (!selectedIds.has(layer.id)) {
            drawLayer(cacheCtx, layer, state);
        }
    });
    cacheCtx.restore();

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, state.canvas.width, state.canvas.height);

    iCtx.setTransform(1, 0, 0, 1, 0, 0);
    iCtx.clearRect(0, 0, interactionCanvas.width, interactionCanvas.height);

    iCtx.drawImage(cacheCanvas, 0, 0);

    iCtx.save();
    iCtx.scale(dpr, dpr);
    iCtx.translate(state.panX, state.panY);
    iCtx.scale(state.zoom, state.zoom);

    selectedLayers.forEach(layer => {
        drawLayer(iCtx, layer, state);
    });

    drawSelectionBox(iCtx, selectedLayers, state);
    iCtx.restore();
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
                if (state.tileManager) state.tileManager.invalidateLayer(newLayer, state);
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

        // --- ИЗМЕНЕНИЕ: Используем DOM курсор для S-Pen ---
        updateEraserCursor(e.clientX, e.clientY, state.zoom, true);
        // --------------------------------------------------

        return true;

    } else if (!isButtonPressed && state.isSpenEraserActive) {
        if (state.isDrawing && state.didErase) {
            const layersToErase = utils.cloneLayersForAction(Array.from(state.layersToErase));

            if (state.tileManager) {
                layersToErase.forEach(layer => state.tileManager.invalidateLayer(layer, state));
            }

            const idsToErase = new Set(layersToErase.map(l => l.id));
            saveState({ type: 'deletion', before: layersToErase, after: [] });
            state.layers = state.layers.filter(layer => !idsToErase.has(layer.id));

            if (state.spatialGrid) {
                state.spatialGrid = utils.buildSpatialGrid(state.layers);
            }

            redrawCallback();
        }

        state.isDrawing = false;
        state.didErase = false;
        state.layersToErase.clear();

        state.iCtx.setTransform(1, 0, 0, 1, 0, 0);
        state.iCtx.clearRect(0, 0, state.interactionCanvas.width, state.interactionCanvas.height);

        state.activeTool = state.toolBeforeSpenEraser;
        state.isSpenEraserActive = false;
        state.toolBeforeSpenEraser = null;
        state.canvas.classList.remove('cursor-eraser');

        // --- ИЗМЕНЕНИЕ: Скрываем DOM курсор ---
        hideEraserCursor();
        // -------------------------------------

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
    if (e.pointerId !== undefined) {
        state.activePointers.add(e.pointerId);
    }

    if (state.isMultiTouching || e.target.id !== 'drawingBoard' || (e.pointerType === 'touch' && state.activePointers.size > 1)) {
        return;
    }

    // Save selection state before touch interaction so we can restore it if a zoom gesture cancels
    if (e.pointerType === 'touch') {
        state._preTouchSelectedLayers = [...state.selectedLayers];
    }

    // --- ANDROID FIX: Захватываем указатель, чтобы не терять события pointermove/pointerup ---
    try {
        if (e.pointerId !== undefined && e.target.hasPointerCapture && !e.target.hasPointerCapture(e.pointerId)) {
            e.target.setPointerCapture(e.pointerId);
        }
    } catch (err) {
        console.warn('Pointer capture failed:', err);
    }
    // -----------------------------------------------------------------------------------------

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

        document.addEventListener('pointermove', state.onPointerMove);
        document.addEventListener('pointerup', state.onPointerUp);
        return;
    }

    if (e.pointerType === 'mouse' && e.button !== 0) return;

    hideContextMenu();

    state.iCtx.setTransform(1, 0, 0, 1, 0, 0);
    state.iCtx.clearRect(0, 0, state.interactionCanvas.width, state.interactionCanvas.height);

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

                if (state.tileManager) state.tileManager.invalidateLayer(clickedLayer, state);

                clickedLayer.isEditing = true;
                state.isEditingText = true;
                redrawCallback();
                state.updateFloatingToolbar();
                textTool.startEditing(state, clickedLayer, (isIntermediate, before, after) => {
                    if (isIntermediate) { redrawCallback(); state.updateFloatingToolbar(); if (state.updateTextEditorTransform) state.updateTextEditorTransform(clickedLayer, state); return; }

                    state.isEditingText = false;
                    const finishedLayer = state.layers.find(l => l.id === clickedLayer.id);
                    if (finishedLayer) {
                        finishedLayer.isEditing = false;
                        if (state.tileManager) state.tileManager.invalidateLayer(finishedLayer, state);
                    }

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
                    if (state.tileManager) state.tileManager.invalidateLayer(clickedLayer, state);

                    const [p0, p1, p2, p3] = [clickedLayer.nodes[closest.segmentIndex].p, clickedLayer.nodes[closest.segmentIndex].h1, clickedLayer.nodes[closest.segmentIndex + 1].h2, clickedLayer.nodes[closest.segmentIndex + 1].p];
                    const newNodeP = geo.getPointOnBezier(closest.t, p0, p1, p2, p3);
                    const newNode = { p: newNodeP, h1: null, h2: null, type: 'smooth' };
                    clickedLayer.nodes.splice(closest.segmentIndex + 1, 0, newNode);
                    utils.smoothCurveHandles(clickedLayer.nodes);

                    if (state.tileManager) state.tileManager.invalidateLayer(clickedLayer, state);

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

            if (state.tileManager) {
                state.selectedLayers.forEach(layer => state.tileManager.invalidateLayer(layer, state));
            }

            prepareInteractionCache(state);
            return;
        }

        if (state.selectedLayers.length > 0) {
            const selectionBox = geo.getGroupBoundingBox(state.selectedLayers);
            if (selectionBox) {
                const rotation = hitTest.getSelectionRotation(state.selectedLayers, state.groupRotation);
                const center = { x: selectionBox.x + selectionBox.width / 2, y: selectionBox.y + selectionBox.height / 2 };
                const rotatedPos = geo.rotatePoint(pos, center, -rotation);
                const logicalBox = geo.getGroupLogicalBoundingBox(state.selectedLayers);

                if (geo.isPointInRect(rotatedPos, logicalBox)) {
                    document.querySelectorAll('.floating-toolbar').forEach(tb => tb.classList.remove('visible'));
                    state.currentAction = 'moving';
                    state.originalLayers = utils.cloneLayersForAction(state.selectedLayers);

                    if (state.tileManager) {
                        state.selectedLayers.forEach(layer => state.tileManager.invalidateLayer(layer, state));
                    }

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
                    const needsReset = state.selectedLayers.some(l => (l.rotation && l.rotation !== 0) || (l.pivot && (l.pivot.x !== 0 || l.pivot.y !== 0)));

                    if (needsReset) {
                        if (state.tileManager) state.selectedLayers.forEach(l => state.tileManager.invalidateLayer(l, state));

                        const before = utils.cloneLayersForAction(state.selectedLayers);
                        state.selectedLayers.forEach(layer => {
                            utils.applyTransformations(layer);
                        });
                        const after = utils.cloneLayersForAction(state.selectedLayers);

                        if (state.tileManager) state.selectedLayers.forEach(l => state.tileManager.invalidateLayer(l, state));

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

                if (state.tileManager) {
                    state.selectedLayers.forEach(layer => state.tileManager.invalidateLayer(layer, state));
                }

                prepareInteractionCache(state);
            }
            redrawCallback();
            updateToolbarCallback();
            state.updateFloatingToolbar();
        } else {
            if (!e.shiftKey && !e.ctrlKey && !e.metaKey) {
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
                delete newLayer.isEditing;
                state.layers.push(newLayer);

                if (state.tileManager) state.tileManager.invalidateLayer(newLayer, state);

                // Add to spatial grid so tileManager can find the layer
                if (state.spatialGrid) {
                    const box = geo.getTransformedBoundingBox(newLayer);
                    if (box) {
                        const startCol = Math.floor(box.x / 500);
                        const endCol = Math.floor((box.x + box.width) / 500);
                        const startRow = Math.floor(box.y / 500);
                        const endRow = Math.floor((box.y + box.height) / 500);
                        for (let r = startRow; r <= endRow; r++) {
                            for (let c = startCol; c <= endCol; c++) {
                                const cellKey = `${c}_${r}`;
                                if (!state.spatialGrid.has(cellKey)) state.spatialGrid.set(cellKey, []);
                                state.spatialGrid.get(cellKey).push(newLayer);
                            }
                        }
                    }
                }

                saveState({ type: 'creation', before: [], after: [newLayer] });
                state.selectedLayers = [newLayer];
                state.currentAction = 'none';
                state.tempLayer = null;
                state.isDrawing = false;
                document.querySelector('button[data-tool="select"]')?.click();
                state.iCtx.setTransform(1, 0, 0, 1, 0, 0);
                state.iCtx.clearRect(0, 0, state.interactionCanvas.width, state.interactionCanvas.height);
                redrawCallback();
                document.removeEventListener('pointermove', state.onPointerMove);
                document.removeEventListener('pointerup', state.onPointerUp);
            } else {
                state.iCtx.setTransform(1, 0, 0, 1, 0, 0);
                state.iCtx.clearRect(0, 0, state.interactionCanvas.width, state.interactionCanvas.height);
                tools.handleShapeDrawing(state.iCtx, state, finalPos, e);
            }
            return;
        }

        if (state.activeTool === 'text' && !state.isEditingText && e.button === 0) {
            const clickedLayer = hitTest.getLayerAtPosition(pos, state.layers, state.zoom, state.spatialGrid);
            if (clickedLayer && clickedLayer.type === 'text') {
                state.selectedLayers = [clickedLayer];

                if (state.tileManager) state.tileManager.invalidateLayer(clickedLayer, state);

                clickedLayer.isEditing = true;
                state.isEditingText = true;
                redrawCallback();
                state.updateFloatingToolbar();
                textTool.startEditing(state, clickedLayer, (isIntermediate, before, after) => {
                    if (isIntermediate) { redrawCallback(); state.updateFloatingToolbar(); if (state.updateTextEditorTransform) state.updateTextEditorTransform(clickedLayer, state); return; }
                    state.isEditingText = false;
                    const finishedLayer = state.layers.find(l => l.id === clickedLayer.id);
                    if (finishedLayer) {
                        finishedLayer.isEditing = false;
                        if (state.tileManager) state.tileManager.invalidateLayer(finishedLayer, state);
                    }
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
            // Smart-brush: track when the pointer last moved significantly
            state.lastSignificantMoveTime = Date.now();
            state.lastSignificantMovePos = { x: finalPos.x, y: finalPos.y };

        } else if (state.activeTool === 'eraser') {
            state.isDrawing = true;
            state.didErase = false;

            // --- ИЗМЕНЕНИЕ: Включаем DOM-курсор ---
            updateEraserCursor(e.clientX, e.clientY, state.zoom, true);
            // --------------------------------------
        }
    }
}

export function draw(state, callbacks, e) {
    if (state.activePointers.size > 1 && e.pointerType === 'touch') return;
    if (state.isMultiTouching) return;

    const { redrawCallback, saveViewStateCallback, drawBackgroundCallback } = callbacks;
    const dpr = window.devicePixelRatio || 1;

    if (state.isPanning) {
        const dx = e.clientX - state.panStartPos.x;
        const dy = e.clientY - state.panStartPos.y;

        state.panX = state.initialPan.x + dx;
        state.panY = state.initialPan.y + dy;

        if (drawBackgroundCallback) {
            drawBackgroundCallback();
        }

        redrawCallback();

        state.updateFloatingToolbar();
        if (saveViewStateCallback) {
            saveViewStateCallback();
        }
        return;
    }

    if (state.isInteracting) {
        const pos = utils.getMousePos(e, state);

        state.iCtx.setTransform(1, 0, 0, 1, 0, 0);
        state.iCtx.clearRect(0, 0, state.interactionCanvas.width, state.interactionCanvas.height);

        state.iCtx.drawImage(state.cacheCanvas, 0, 0);

        switch (state.currentAction) {
            case 'editingCurve': actions.handleEditCurve(state, pos, e); break;
            case 'movingPivot': actions.handleMovePivot(state, pos); break;
            case 'rotating': actions.handleRotate(state, pos, e); break;
            case 'moving': actions.handleMove(state, pos, e); break;
            case 'scaling': actions.handleScale(state, pos, e); break;
        }

        state.iCtx.save();
        state.iCtx.scale(dpr, dpr);
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
        state.iCtx.setTransform(1, 0, 0, 1, 0, 0);
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

        switch (state.currentAction) {
            case 'selectionBox':
                state.iCtx.setTransform(1, 0, 0, 1, 0, 0);
                state.iCtx.clearRect(0, 0, state.interactionCanvas.width, state.interactionCanvas.height);
                state.iCtx.save();
                state.iCtx.scale(dpr, dpr);
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
            state.iCtx.setTransform(1, 0, 0, 1, 0, 0);
            state.iCtx.clearRect(0, 0, state.interactionCanvas.width, state.interactionCanvas.height);
            tools.handleShapeDrawing(state.iCtx, state, pos, e);
        }
        else if (state.isDrawing) {
            // --- ANDROID GHOST FIX: Возможный баг с getCoalescedEvents на Android ---
            // На некоторых Android-устройствах Chrome getCoalescedEvents возвращает
            // координаты в физических пикселях (unscaled), а не в CSS-пикселях, 
            // что приводит к двойному или уменьшенному рисованию (призракам).
            // Используем только само событие.
            const events = [e];
            // ------------------------------------------------------------------------

            if (state.activeTool === 'brush' || state.activeTool === 'smart-brush') {
                for (const subEvent of events) {
                    const subPos = utils.getMousePos(subEvent, state);
                    const point = [subPos.x, subPos.y];

                    if (state.tempLayer.hasPressure) {
                        const rawPressure = subEvent.pressure > 0 ? subEvent.pressure : 0.5;
                        const pressure = rawPressure < 0.5 ? rawPressure * 2 : rawPressure + 0.5;
                        point.push(pressure);
                    }
                    state.tempLayer.points.push(...point);
                    state.lastBrushPoint = subPos;
                    // Smart-brush: update last significant move time if pointer moved enough
                    if (state.lastSignificantMovePos) {
                        const dx = subPos.x - state.lastSignificantMovePos.x;
                        const dy = subPos.y - state.lastSignificantMovePos.y;
                        if (dx * dx + dy * dy > 9) { // > 3px movement
                            state.lastSignificantMoveTime = Date.now();
                            state.lastSignificantMovePos = { x: subPos.x, y: subPos.y };
                        }
                    }
                }

                const iCtx = state.iCtx;
                iCtx.setTransform(1, 0, 0, 1, 0, 0);
                iCtx.clearRect(0, 0, state.interactionCanvas.width, state.interactionCanvas.height);

                iCtx.save();
                iCtx.scale(dpr, dpr);
                iCtx.translate(state.panX, state.panY);
                iCtx.scale(state.zoom, state.zoom);

                drawLayer(iCtx, state.tempLayer, state);
                iCtx.restore();

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
                            if (state.tileManager) state.tileManager.invalidateLayer(newLayer, state);

                            if (state.spatialGrid) {
                                const box = geo.getTransformedBoundingBox(newLayer);
                                if (box) {
                                    const startCol = Math.floor(box.x / 500);
                                    const endCol = Math.floor((box.x + box.width) / 500);
                                    const startRow = Math.floor(box.y / 500);
                                    const endRow = Math.floor((box.y + box.height) / 500);
                                    for (let r = startRow; r <= endRow; r++) {
                                        for (let c = startCol; c <= endCol; c++) {
                                            const cellKey = `${c}_${r}`;
                                            if (!state.spatialGrid.has(cellKey)) state.spatialGrid.set(cellKey, []);
                                            state.spatialGrid.get(cellKey).push(newLayer);
                                        }
                                    }
                                }
                            }

                            state.tempLayer.points = [];
                            state.iCtx.setTransform(1, 0, 0, 1, 0, 0);
                            state.iCtx.clearRect(0, 0, state.interactionCanvas.width, state.interactionCanvas.height);
                            state.isDrawing = false;
                            state.shapeWasJustRecognized = true;
                            redrawCallback();
                            callbacks.saveState({ type: 'creation', before: [], after: [newLayer] });
                        }
                    }, 500);
                }
            } else if (state.activeTool === 'eraser') {
                let needsRedraw = false;

                // --- ИЗМЕНЕНИЕ: Обновляем DOM-курсор ---
                updateEraserCursor(e.clientX, e.clientY, state.zoom, true);
                // ---------------------------------------

                for (const subEvent of events) {
                    const subPos = utils.getMousePos(subEvent, state);
                    const layerToErase = hitTest.getLayerForEraser(subPos, state.layers, state.zoom, state.spatialGrid, state.layerBBoxCache);

                    if (layerToErase && layerToErase.type !== 'image' && layerToErase.type !== 'pdf' && !state.layersToErase.has(layerToErase)) {
                        state.layersToErase.add(layerToErase);
                        if (state.tileManager) state.tileManager.invalidateLayer(layerToErase, state);
                        state.didErase = true;
                        needsRedraw = true;
                    }
                }

                if (needsRedraw) {
                    redrawCallback();
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
    if (e.pointerId !== undefined) {
        state.activePointers.delete(e.pointerId);
    }

    if (state.isInteracting) {
        if (state.currentAction === 'scaling' && state.selectedLayers.length === 1 && state.selectedLayers[0].type === 'text') {
            const layer = state.selectedLayers[0];
            utils.createTextImage(layer).then(img => {
                layer.cachedImage = img;
                callbacks.redrawCallback();
            });
        }

        state.isInteracting = false;
        state.iCtx.setTransform(1, 0, 0, 1, 0, 0);
        state.iCtx.clearRect(0, 0, state.interactionCanvas.width, state.interactionCanvas.height);
        state.cacheCtx.setTransform(1, 0, 0, 1, 0, 0);
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

        state.iCtx.setTransform(1, 0, 0, 1, 0, 0);
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

        const commonProps = { color: state.activeColor, lineWidth: state.activeLineWidth, id: Date.now(), rotation: 0, pivot: { x: 0, y: 0 }, lineStyle: state.activeLineStyle };

        if (!state.currentAction.startsWith('drawing')) {
            switch (state.activeTool) {
                case 'parallelogram': state.currentAction = 'drawingParallelogramSlant'; state.tempLayer = { type: 'parallelogram', x: Math.min(finalEnd.x, finalStart.x), y: Math.min(finalEnd.y, finalStart.y), width: Math.abs(finalEnd.x - finalStart.x), height: Math.abs(finalEnd.y - finalStart.y), slantOffset: 0, ...commonProps }; break;
                case 'triangle': state.currentAction = 'drawingTriangleApex'; state.tempLayer = { type: 'triangle', p1: finalStart, p2: finalEnd, p3: finalEnd, ...commonProps }; break;
                case 'parallelepiped': state.currentAction = 'drawingParallelepipedDepth'; state.tempLayer = { type: 'parallelepiped', x: Math.min(finalEnd.x, finalStart.x), y: Math.min(finalEnd.y, finalStart.y), width: Math.abs(finalEnd.x - finalStart.x), height: Math.abs(finalEnd.y - finalStart.y), depthOffset: { x: 0, y: 0 }, ...commonProps }; break;
                case 'pyramid': {
                    const startX = Math.min(finalStart.x, finalEnd.x); const startY = Math.min(finalStart.y, finalEnd.y);
                    const width = Math.abs(finalEnd.x - finalStart.x); const height = Math.abs(finalEnd.y - finalStart.y);
                    const depth = { x: width * 0.3, y: -height * 0.3 };
                    const perspectiveBase = {
                        p1: { x: startX, y: startY + height },
                        p2: { x: startX + width, y: startY + height },
                        p3: { x: startX + width + depth.x, y: startY + height + depth.y },
                        p4: { x: startX + depth.x, y: startY + height + depth.y }
                    };
                    state.currentAction = 'drawingPyramidApex';
                    state.tempLayer = { type: 'pyramid', base: perspectiveBase, apex: { x: startX + width / 2, y: startY }, ...commonProps };
                    break;
                }
                case 'truncated-pyramid': {
                    const startX = Math.min(finalStart.x, finalEnd.x); const startY = Math.min(finalStart.y, finalEnd.y);
                    const width = Math.abs(finalEnd.x - finalStart.x); const height = Math.abs(finalEnd.y - finalStart.y);
                    const depth = { x: width * 0.3, y: -height * 0.3 };
                    const perspectiveBase = {
                        p1: { x: startX, y: startY + height },
                        p2: { x: startX + width, y: startY + height },
                        p3: { x: startX + width + depth.x, y: startY + height + depth.y },
                        p4: { x: startX + depth.x, y: startY + height + depth.y }
                    };
                    state.currentAction = 'drawingTruncatedPyramidApex';
                    state.tempLayer = { type: 'truncated-pyramid', base: perspectiveBase, apex: { x: startX + width / 2, y: startY }, top: null, ...commonProps };
                    break;
                }
                case 'trapezoid': state.currentAction = 'drawingTrapezoidP3'; state.tempLayer = { type: 'trapezoid', p1: finalStart, p2: finalEnd, p3: finalEnd, p4: finalStart, ...commonProps }; break;
                case 'frustum': {
                    const fw = Math.abs(finalEnd.x - finalStart.x); const fh = Math.abs(finalEnd.y - finalStart.y);
                    const rx1 = fw / 2; const ry1 = rx1 * 0.3;
                    state.currentAction = 'drawingFrustum';
                    state.tempLayer = { type: 'frustum', cx: Math.min(finalStart.x, finalEnd.x) + rx1, baseY: Math.max(finalStart.y, finalEnd.y) - ry1, topY: Math.max(finalStart.y, finalEnd.y) - ry1, rx1, ry1, rx2: 0, ry2: 0, ...commonProps };
                    break;
                }
                case 'truncated-sphere': {
                    const tw = Math.abs(finalEnd.x - finalStart.x); const th = Math.abs(finalEnd.y - finalStart.y);
                    const sx = tw / 2; const sy = th / 2;
                    state.currentAction = 'drawingTruncatedSphere';
                    state.tempLayer = { type: 'truncated-sphere', cx: Math.min(finalStart.x, finalEnd.x) + sx, cy: Math.min(finalStart.y, finalEnd.y) + sy, rx: sx, ry: sy, cutY: Math.max(finalStart.y, finalEnd.y), cutR: 0, cutRy: 0, ...commonProps };
                    break;
                }
            }
            if (state.showCreationTooltip && TOOLTIP_MESSAGES[state.currentAction]) {
                state.showCreationTooltip(TOOLTIP_MESSAGES[state.currentAction], finalEnd, state);
            }
            return;
        }
    }

    if (state.currentAction.startsWith('drawing')) {
        const finalPos = utils.getMousePos(e, state);
        let isFinalStep = false;
        let createdLayer = null;

        if (state.currentAction === 'drawingParallelogramSlant') {
            const finalSlant = finalPos.x - (state.tempLayer.x + state.tempLayer.width / 2);
            state.tempLayer.slantOffset = finalSlant; createdLayer = state.tempLayer; isFinalStep = true;
        } else if (state.currentAction === 'drawingTriangleApex') {
            state.tempLayer.p3 = finalPos; createdLayer = state.tempLayer; isFinalStep = true;
        } else if (state.currentAction === 'drawingParallelepipedDepth') {
            state.tempLayer.depthOffset = { x: finalPos.x - (state.tempLayer.x + state.tempLayer.width), y: finalPos.y - state.tempLayer.y }; createdLayer = state.tempLayer; isFinalStep = true;
        } else if (state.currentAction === 'drawingPyramidApex') {
            state.tempLayer.apex = finalPos; createdLayer = state.tempLayer; isFinalStep = true;
        } else if (state.currentAction === 'drawingTruncatedPyramidApex') {
            state.tempLayer.apex = finalPos; state.currentAction = 'drawingTruncatedPyramidTop';
            if (state.showCreationTooltip) state.showCreationTooltip(TOOLTIP_MESSAGES[state.currentAction], finalPos, state);
        } else if (state.currentAction === 'drawingTruncatedPyramidTop') {
            const { base, apex } = state.tempLayer;
            const totalHeight = Math.abs(apex.y - base.p1.y);
            const cutHeight = Math.abs(finalPos.y - base.p1.y);
            const ratio = Math.max(0.05, Math.min(0.95, cutHeight / totalHeight));
            const interpolate = (p1, p2) => ({ x: p1.x + (p2.x - p1.x) * ratio, y: p1.y + (p2.y - p1.y) * ratio });
            state.tempLayer.top = { p1: interpolate(base.p1, apex), p2: interpolate(base.p2, apex), p3: interpolate(base.p3, apex), p4: interpolate(base.p4, apex) };
            delete state.tempLayer.apex;
            createdLayer = state.tempLayer; isFinalStep = true;
        } else if (state.currentAction === 'drawingTrapezoidP3') {
            state.tempLayer.p3 = finalPos; state.currentAction = 'drawingTrapezoidP4';
            if (state.showCreationTooltip) state.showCreationTooltip(TOOLTIP_MESSAGES[state.currentAction], finalPos, state);
        } else if (state.currentAction === 'drawingTrapezoidP4') {
            state.tempLayer.p4 = finalPos; createdLayer = state.tempLayer; isFinalStep = true;
        } else if (state.currentAction === 'drawingFrustum') {
            state.tempLayer.topY = finalPos.y;
            state.tempLayer.rx2 = Math.abs(finalPos.x - state.tempLayer.cx);
            state.tempLayer.ry2 = state.tempLayer.rx2 * 0.3;
            createdLayer = state.tempLayer; isFinalStep = true;
        } else if (state.currentAction === 'drawingTruncatedSphere') {
            state.tempLayer.cutY = finalPos.y;
            const h = Math.abs(state.tempLayer.cutY - state.tempLayer.cy);
            const ratioY = h / state.tempLayer.ry;
            if (ratioY >= 1) { state.tempLayer.cutR = 0; }
            else { state.tempLayer.cutR = state.tempLayer.rx * Math.sqrt(1 - ratioY * ratioY); }
            state.tempLayer.cutRy = state.tempLayer.cutR * 0.3;
            createdLayer = state.tempLayer; isFinalStep = true;
        }

        if (isFinalStep) {
            if (createdLayer) {
                const newLayer = utils.cloneLayersForAction([createdLayer])[0];
                state.layers.push(newLayer);
                if (state.tileManager) state.tileManager.invalidateLayer(newLayer, state);

                // Add to spatial grid
                if (state.spatialGrid) {
                    const box = geo.getTransformedBoundingBox(newLayer);
                    if (box) {
                        const startCol = Math.floor(box.x / 500);
                        const endCol = Math.floor((box.x + box.width) / 500);
                        const startRow = Math.floor(box.y / 500);
                        const endRow = Math.floor((box.y + box.height) / 500);
                        for (let r = startRow; r <= endRow; r++) {
                            for (let c = startCol; c <= endCol; c++) {
                                const cellKey = `${c}_${r}`;
                                if (!state.spatialGrid.has(cellKey)) state.spatialGrid.set(cellKey, []);
                                state.spatialGrid.get(cellKey).push(newLayer);
                            }
                        }
                    }
                }

                saveState({ type: 'creation', before: [], after: [newLayer] });
            }
            state.currentAction = 'none';
            state.tempLayer = null;
            if (state.hideCreationTooltip) state.hideCreationTooltip();
        }
        redrawCallback();
    }

    document.removeEventListener('pointermove', state.onPointerMove);
    document.removeEventListener('pointerup', state.onPointerUp);

    state.iCtx.setTransform(1, 0, 0, 1, 0, 0);
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
        const dx = e.clientX - state.panStartPos.x;
        const dy = e.clientY - state.panStartPos.y;
        state.panX = state.initialPan.x + dx;
        state.panY = state.initialPan.y + dy;
        state.cacheCtx.setTransform(1, 0, 0, 1, 0, 0);
        state.cacheCtx.clearRect(0, 0, state.cacheCanvas.width, state.cacheCanvas.height);
        redrawCallback();
        if (state.activeTool === 'pan') { state.canvas.style.cursor = 'grab'; } else { updateCursor(state, null); }
    }

    const transformActions = ['rotating', 'scaling', 'moving', 'movingPivot', 'editingCurve'];
    if (transformActions.includes(state.currentAction)) {
        if (state.currentAction === 'rotating') {
            if (state.selectedLayers.length > 1 && state.groupRotation !== 0) {
                if (state.tileManager) state.selectedLayers.forEach(layer => state.tileManager.invalidateLayer(layer, state));
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
                if (state.tileManager) state.selectedLayers.forEach(layer => state.tileManager.invalidateLayer(layer, state));
            }
            state.groupPivot = null;
            state.groupRotation = 0;
        }

        const dragDistance = Math.hypot(utils.getMousePos(e, state).x - state.dragStartPos.x, utils.getMousePos(e, state).y - state.dragStartPos.y);

        if (state.currentAction === 'editingCurve' && dragDistance < 5 / state.zoom) {
        } else {
            if (state.tileManager) {
                state.selectedLayers.forEach(layer => state.tileManager.invalidateLayer(layer, state));
            }
            const finalLayers = utils.cloneLayersForAction(state.selectedLayers);

            // Rebuild grid after transformation
            if (state.spatialGrid) {
                state.spatialGrid = utils.buildSpatialGrid(state.layers);
            }

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

            // --- SMART-BRUSH: Attempt shape recognition before saving ---
            if (state.activeTool === 'smart-brush' && newLayer && newLayer.points.length > 1) {
                // Check if user held still at the end of the stroke (confirms intent)
                const heldAtEnd = state.lastSignificantMoveTime
                    ? (Date.now() - state.lastSignificantMoveTime > 400)
                    : false;
                const recognizedShape = shapeRecognizer.recognizeShape(newLayer.points, newLayer.hasPressure, heldAtEnd);
                if (recognizedShape) {
                    // Shape recognized — save the clean shape instead of the raw brush stroke
                    const shapeLayer = {
                        ...recognizedShape,
                        color: newLayer.color,
                        lineWidth: newLayer.lineWidth,
                        lineStyle: newLayer.lineStyle
                    };
                    state.layers.push(shapeLayer);
                    if (state.tileManager) state.tileManager.invalidateLayer(shapeLayer, state);

                    if (state.spatialGrid) {
                        const box = geo.getTransformedBoundingBox(shapeLayer);
                        if (box) {
                            const startCol = Math.floor(box.x / 500);
                            const endCol = Math.floor((box.x + box.width) / 500);
                            const startRow = Math.floor(box.y / 500);
                            const endRow = Math.floor((box.y + box.height) / 500);
                            for (let r = startRow; r <= endRow; r++) {
                                for (let c = startCol; c <= endCol; c++) {
                                    const cellKey = `${c}_${r}`;
                                    if (!state.spatialGrid.has(cellKey)) state.spatialGrid.set(cellKey, []);
                                    state.spatialGrid.get(cellKey).push(shapeLayer);
                                }
                            }
                        }
                    }

                    state.isDrawing = false;
                    state.currentAction = 'none';
                    state.tempLayer = null;
                    state.shapeWasJustRecognized = true;
                    redrawCallback();
                    saveState({ type: 'creation', before: [], after: [shapeLayer] });

                    document.removeEventListener('pointermove', state.onPointerMove);
                    document.removeEventListener('pointerup', state.onPointerUp);

                    if (state.interactionCanvas && state.iCtx) {
                        state.iCtx.setTransform(1, 0, 0, 1, 0, 0);
                        state.iCtx.clearRect(0, 0, state.interactionCanvas.width, state.interactionCanvas.height);
                    }

                    try {
                        if (e && e.pointerId !== undefined && e.target && e.target.hasPointerCapture && e.target.hasPointerCapture(e.pointerId)) {
                            e.target.releasePointerCapture(e.pointerId);
                        }
                    } catch (err) { /* ignore */ }

                    return;
                }
                // Shape NOT recognized — fall through to save as raw brush stroke
            }
            // ---------------------------------------------------------------

            if (newLayer && newLayer.points.length > 1) {
                state.layers.push(newLayer);
                if (state.tileManager) state.tileManager.invalidateLayer(newLayer, state);

                if (state.spatialGrid) {
                    const box = geo.getTransformedBoundingBox(newLayer);
                    if (box) {
                        const startCol = Math.floor(box.x / 500);
                        const endCol = Math.floor((box.x + box.width) / 500);
                        const startRow = Math.floor(box.y / 500);
                        const endRow = Math.floor((box.y + box.height) / 500);
                        for (let r = startRow; r <= endRow; r++) {
                            for (let c = startCol; c <= endCol; c++) {
                                const cellKey = `${c}_${r}`;
                                if (!state.spatialGrid.has(cellKey)) state.spatialGrid.set(cellKey, []);
                                state.spatialGrid.get(cellKey).push(newLayer);
                            }
                        }
                    }
                }

                saveState({ type: 'creation', before: [], after: [newLayer] });
            }
            state.isDrawing = false;
            state.currentAction = 'none';
            state.tempLayer = null;
            redrawCallback();

            document.removeEventListener('pointermove', state.onPointerMove);
            document.removeEventListener('pointerup', state.onPointerUp);

            if (state.interactionCanvas && state.iCtx) {
                state.iCtx.setTransform(1, 0, 0, 1, 0, 0);
                state.iCtx.clearRect(0, 0, state.interactionCanvas.width, state.interactionCanvas.height);
                state.interactionCanvas.style.opacity = '0.99';
                setTimeout(() => { state.interactionCanvas.style.opacity = '1'; }, 10);
            }

            try {
                if (e && e.pointerId !== undefined && e.target && e.target.hasPointerCapture && e.target.hasPointerCapture(e.pointerId)) {
                    e.target.releasePointerCapture(e.pointerId);
                }
            } catch (err) {
                console.warn('Pointer release failed:', err);
            }

            return;
        }

        const rawEnd = utils.getMousePos(e, state);
        let finalStart = state.startPos;
        let finalEnd = rawEnd;

        // ... Snapping Logic ...
        const shouldSnap = (state.snappingMode === 'manual' && e.altKey) || (state.snappingMode === 'auto' && !e.altKey);
        if (shouldSnap) {
            const SNAP_THRESHOLD = 10 / state.zoom;
            const snappedEndX = utils.snapToGrid(rawEnd.x);
            const snappedEndY = utils.snapToGrid(rawEnd.y);
            finalEnd.x = (Math.abs(snappedEndX - rawEnd.x) < SNAP_THRESHOLD) ? snappedEndX : rawEnd.x;
            finalEnd.y = (Math.abs(snappedEndY - rawEnd.y) < SNAP_THRESHOLD) ? snappedEndY : rawEnd.y;
        }

        if (state.activeTool === 'eraser') {
            if (state.didErase) {
                // ... erase logic ...
                const layersToErase = utils.cloneLayersForAction(Array.from(state.layersToErase));
                if (state.tileManager) layersToErase.forEach(layer => state.tileManager.invalidateLayer(layer, state));
                const idsToErase = new Set(layersToErase.map(l => l.id));
                saveState({ type: 'deletion', before: layersToErase, after: [] });
                state.layers = state.layers.filter(layer => !idsToErase.has(layer.id));
                state.layersToErase.clear();

                // Rebuild grid
                state.spatialGrid = utils.buildSpatialGrid(state.layers);
            }
            // --- ИЗМЕНЕНИЕ: Скрываем DOM-курсор ---
            hideEraserCursor();
            // -------------------------------------
            redrawCallback();
        } else {
            let newLayer = null;
            const commonProps = { color: state.activeColor, lineWidth: state.activeLineWidth, id: Date.now(), rotation: 0, pivot: { x: 0, y: 0 }, lineStyle: state.activeLineStyle };
            switch (state.activeTool) {
                case 'rect': { const rect = { type: 'rect', x: Math.min(finalEnd.x, finalStart.x), y: Math.min(finalEnd.y, finalStart.y), width: Math.abs(finalEnd.x - finalStart.x), height: Math.abs(finalEnd.y - finalStart.y), ...commonProps }; if (rect.width > 5 || rect.height > 5) newLayer = rect; break; }
                case 'ellipse': { const rx = Math.abs(finalEnd.x - finalStart.x) / 2; const ry = e.shiftKey ? rx : Math.abs(finalEnd.y - finalStart.y) / 2; newLayer = { type: 'ellipse', cx: finalStart.x + (finalEnd.x - finalStart.x) / 2, cy: finalStart.y + (finalEnd.y - finalStart.y) / 2, rx, ry, ...commonProps }; if (rx < 2 || ry < 2) newLayer = null; break; }
                case 'sphere': { const rx = Math.abs(finalEnd.x - finalStart.x) / 2; const ry = e.shiftKey ? rx : Math.abs(finalEnd.y - finalStart.y) / 2; newLayer = { type: 'sphere', cx: finalStart.x + (finalEnd.x - finalStart.x) / 2, cy: finalStart.y + (finalEnd.y - finalStart.y) / 2, rx, ry, ...commonProps }; if (rx < 2 || ry < 2) newLayer = null; break; }
                case 'cone': { const rx = Math.abs(finalEnd.x - finalStart.x) / 2; const ry = rx * 0.3; newLayer = { type: 'cone', cx: finalStart.x + (finalEnd.x - finalStart.x) / 2, baseY: Math.max(finalStart.y, finalEnd.y) - ry, rx, ry, apex: { x: finalStart.x + (finalEnd.x - finalStart.x) / 2, y: Math.min(finalStart.y, finalEnd.y) }, ...commonProps }; break; }
                case 'rhombus': {
                    const x = Math.min(finalEnd.x, finalStart.x);
                    const y = Math.min(finalEnd.y, finalStart.y);
                    const width = Math.abs(finalEnd.x - finalStart.x);
                    const height = Math.abs(finalEnd.y - finalStart.y);
                    newLayer = {
                        type: 'rhombus',
                        p1: { x: x + width / 2, y: y },
                        p2: { x: x + width, y: y + height / 2 },
                        p3: { x: x + width / 2, y: y + height },
                        p4: { x: x, y: y + height / 2 },
                        ...commonProps
                    };
                    if (width < 5 || height < 5) newLayer = null;
                    break;
                }
                case 'text': {
                    const width = Math.abs(finalEnd.x - finalStart.x);
                    const height = Math.abs(finalEnd.y - finalStart.y);
                    if (width < 20 || height < 20) { state.isDrawing = false; redrawCallback(); return; }
                    const newTextLayer = {
                        type: 'text',
                        x: Math.min(finalEnd.x, finalStart.x),
                        y: Math.min(finalEnd.y, finalStart.y),
                        width: width,
                        height: height,
                        content: '',
                        color: state.activeTextColor,
                        fontSize: state.activeFontSize,
                        fontFamily: state.activeFontFamily,
                        align: state.activeTextAlign,
                        fontWeight: state.activeFontWeight,
                        fontStyle: state.activeFontStyle,
                        textDecoration: state.activeTextDecoration,
                        id: Date.now(),
                        rotation: 0,
                        pivot: { x: 0, y: 0 }
                    };
                    state.layers.push(newTextLayer);
                    state.selectedLayers = [newTextLayer];
                    if (state.tileManager) state.tileManager.invalidateLayer(newTextLayer, state);
                    newTextLayer.isEditing = true;
                    state.isDrawing = true;
                    state.isEditingText = true;
                    state.justCreatedText = true;
                    textTool.startEditing(state, newTextLayer, (isIntermediate, before, after) => {
                        if (isIntermediate) { redrawCallback(); state.updateFloatingToolbar(); if (state.updateTextEditorTransform) state.updateTextEditorTransform(newTextLayer, state); return; }
                        state.isEditingText = false;
                        const finishedLayer = state.layers.find(l => l.id === newTextLayer.id);
                        if (finishedLayer) {
                            finishedLayer.isEditing = false;
                            if (state.tileManager) state.tileManager.invalidateLayer(finishedLayer, state);
                        }
                        if (state.justCreatedText) {
                            const selectButton = document.querySelector('button[data-tool="select"]');
                            if (selectButton) { selectButton.click(); }
                            state.justCreatedText = false;
                        }
                        if (before && after) { saveState({ type: 'creation', before, after }); }
                        // Update grid
                        if (state.spatialGrid) {
                            state.spatialGrid = utils.buildSpatialGrid(state.layers);
                        }
                        redrawCallback();
                        state.updateFloatingToolbar();
                    });
                    state.isDrawing = false;
                    return;
                }
                case 'line': { const line = { type: 'line', x1: finalStart.x, y1: finalStart.y, x2: finalEnd.x, y2: finalEnd.y, ...commonProps }; if (Math.abs(line.x1 - line.x2) > 5 || Math.abs(line.y1 - line.y2) > 5) newLayer = line; break; }
            }
            if (newLayer) {
                state.layers.push(newLayer);
                if (state.tileManager) state.tileManager.invalidateLayer(newLayer, state);

                // Add to spatial grid
                if (state.spatialGrid) {
                    const box = geo.getTransformedBoundingBox(newLayer);
                    if (box) {
                        const startCol = Math.floor(box.x / 500);
                        const endCol = Math.floor((box.x + box.width) / 500);
                        const startRow = Math.floor(box.y / 500);
                        const endRow = Math.floor((box.y + box.height) / 500);

                        for (let r = startRow; r <= endRow; r++) {
                            for (let c = startCol; c <= endCol; c++) {
                                const cellKey = `${c}_${r}`;
                                if (!state.spatialGrid.has(cellKey)) state.spatialGrid.set(cellKey, []);
                                state.spatialGrid.get(cellKey).push(newLayer);
                            }
                        }
                    }
                }

                saveState({ type: 'creation', before: [], after: [newLayer] });
            }
            state.isDrawing = false;
            state.currentAction = 'none';
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
                if (state.tileManager) state.selectedLayers.forEach(l => state.tileManager.invalidateLayer(l, state));
                const before = utils.cloneLayersForAction(state.selectedLayers);
                state.selectedLayers.forEach(layer => { utils.applyTransformations(layer); });
                const after = utils.cloneLayersForAction(state.selectedLayers);
                if (state.tileManager) state.selectedLayers.forEach(l => state.tileManager.invalidateLayer(l, state));
                saveState({ type: 'update', before: before, after: after });
            }
        }
        state.currentAction = 'none';
        redrawCallback();
    }

    state.updateFloatingToolbar();

    if (state.currentAction === 'selectionBox') {
        updateToolbarCallback();
    }

    const isMidShapeDrawing = state.currentAction.startsWith('drawing');
    if (!isMidShapeDrawing) {
        state.isDrawing = false;
        state.currentAction = 'none';
        state.tempLayer = null;
        if (state.hideCreationTooltip) {
            state.hideCreationTooltip();
        }
    }

    state.scalingHandle = null;
    state.startPos = null;
    state.originalBox = null;
    state.originalLayers = [];
    state.groupPivot = null;
    state.didErase = false;
    state.groupRotation = 0;
    state.snapPoint = null;

    // --- ANDROID FIX: Освобождаем захват указателя ---
    try {
        if (e && e.pointerId !== undefined && e.target && e.target.hasPointerCapture && e.target.hasPointerCapture(e.pointerId)) {
            e.target.releasePointerCapture(e.pointerId);
        }
    } catch (err) {
        console.warn('Pointer release failed:', err);
    }
    // -------------------------------------------------
}
// --- END OF FILE js/pointerHandlers.js ---