// --- START OF FILE canvas.js ---

import * as geo from './geometry.js';
import * as hitTest from './hitTest.js';
import * as actions from './actions.js';
import * as tools from './tools.js';
import * as utils from './utils.js';
import * as layerManager from './layerManager.js';
import * as shapeRecognizer from './shapeRecognizer.js';
import * as textTool from './text.js';

export function initializeCanvas(canvas, ctx, redrawCallback, saveState, updateToolbarCallback) {
    const state = {
        canvas, ctx, isDrawing: false, layers: [], activeTool: 'brush', previousTool: 'brush',
        startPos: null, selectedLayers: [], currentAction: 'none', dragStartPos: null,
        scalingHandle: null, activeColor: '#000000',
        activeLineWidth: 3,
        activeFontFamily: 'Arial',
        activeFontSize: 30,
        activeFontWeight: 'normal',
        activeFontStyle: 'normal',
        activeTextDecoration: 'none',
        activeTextAlign: 'left',
        lastClickTime: 0, clickCount: 0, lastClickPos: null,
        originalLayers: [], originalBox: null, saveState, didErase: false, tempLayer: null,
        panX: 0, panY: 0, zoom: 1.0, isPanning: false, panStartPos: { x: 0, y: 0 },
        rotationStartAngle: 0,
        groupPivot: null,
        groupRotation: 0,
        snapPoint: null,
        lastBrushTime: 0,
        lastBrushPoint: null,
        smoothingAmount: 2,
        shapeRecognitionTimer: null,
        shapeWasJustRecognized: false, 
        eraserTrailNodes: [],
        eraserAnimationId: null,
        lastEraserPos: { x: 0, y: 0 },
        isEditingText: false,
        activePointers: new Map(),
        isPinching: false,
        initialPinchDistance: 0,
        initialPinchZoom: 1,
        initialPinchWorld: { x: 0, y: 0 },
    };

    // --- НАЧАЛО ИЗМЕНЕНИЙ: Добавляем функцию обновления редактора в состояние холста ---
    state.updateTextEditorStyle = textTool.updateEditorStyle;
    // --- КОНЕЦ ИЗМЕНЕНИЙ ---

    const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

    state.updateFloatingToolbar = () => {
        const toolbar = document.getElementById('floating-text-toolbar');
        const isVisible = state.isEditingText || (state.selectedLayers.length === 1 && state.selectedLayers[0].type === 'text');

        if (isVisible) {
            toolbar.classList.add('visible'); 

            const layer = state.isEditingText 
                ? state.layers.find(l => l.isEditing) 
                : state.selectedLayers[0];

            if (!layer) {
                toolbar.classList.remove('visible');
                return;
            }

            const box = geo.getBoundingBox(layer);
            if (!box) {
                toolbar.classList.remove('visible');
                return;
            }

            document.getElementById('fontFamilySelect').value = layer.fontFamily || 'Arial';
            document.getElementById('floatingFontSizeInput').value = layer.fontSize || 30;
            const colorButtonCircle = toolbar.querySelector('[data-action="pick-color"] circle');
            if (colorButtonCircle) {
                colorButtonCircle.style.fill = layer.color || '#000000';
            }
            
            toolbar.querySelector('[data-action="align-left"]').classList.toggle('active', !layer.align || layer.align === 'left');
            toolbar.querySelector('[data-action="align-center"]').classList.toggle('active', layer.align === 'center');
            toolbar.querySelector('[data-action="align-right"]').classList.toggle('active', layer.align === 'right');
            toolbar.querySelector('[data-action="font-bold"]').classList.toggle('active', layer.fontWeight === 'bold');
            toolbar.querySelector('[data-action="font-italic"]').classList.toggle('active', layer.fontStyle === 'italic');
            toolbar.querySelector('[data-action="font-underline"]').classList.toggle('active', layer.textDecoration === 'underline');
            
            const screenX = (box.x * state.zoom) + state.panX;
            const screenY = (box.y * state.zoom) + state.panY;
            const screenHeight = box.height * state.zoom;
            
            toolbar.style.left = `${screenX}px`;

            const toolbarHeight = toolbar.offsetHeight;
            const spaceAbove = screenY;
            
            if (spaceAbove > toolbarHeight + 10) {
                toolbar.style.top = `${screenY - toolbarHeight - 10}px`;
            } else {
                toolbar.style.top = `${screenY + screenHeight + 10}px`;
            }

        } else {
            toolbar.classList.remove('visible');
        }
    };

    const NUM_TRAIL_NODES = 15;
    const EASING_FACTOR = 0.2;

    function updateTouchPointer(e) {
        if (e.pointerType !== 'touch') return;
        const rect = canvas.getBoundingClientRect();
        state.activePointers.set(e.pointerId, {
            x: e.clientX - rect.left,
            y: e.clientY - rect.top,
        });
    }

    function removeTouchPointer(e) {
        if (e.pointerType !== 'touch') return;
        state.activePointers.delete(e.pointerId);
    }

    function beginPinchGesture() {
        if (state.activePointers.size < 2) return false;
        const pointers = Array.from(state.activePointers.values()).slice(0, 2);
        const [first, second] = pointers;
        const distance = Math.hypot(second.x - first.x, second.y - first.y) || 1;

        if (state.isDrawing || state.currentAction.startsWith('drawing')) {
            state.isDrawing = false;
            state.currentAction = 'none';
            state.tempLayer = null;
        }

        if (state.eraserAnimationId) {
            cancelAnimationFrame(state.eraserAnimationId);
            state.eraserAnimationId = null;
        }

        state.isPinching = true;
        state.initialPinchDistance = distance;
        state.initialPinchZoom = state.zoom;
        const center = {
            x: (first.x + second.x) / 2,
            y: (first.y + second.y) / 2,
        };
        state.initialPinchWorld = {
            x: (center.x - state.panX) / state.zoom,
            y: (center.y - state.panY) / state.zoom,
        };
        return true;
    }

    function updatePinchGesture() {
        if (!state.isPinching || state.activePointers.size < 2) return;
        const pointers = Array.from(state.activePointers.values()).slice(0, 2);
        const [first, second] = pointers;
        const distance = Math.hypot(second.x - first.x, second.y - first.y) || 1;
        const scale = distance / (state.initialPinchDistance || distance);
        const newZoom = clamp(state.initialPinchZoom * scale, 0.1, 10);
        const center = {
            x: (first.x + second.x) / 2,
            y: (first.y + second.y) / 2,
        };

        state.zoom = newZoom;
        state.panX = center.x - state.initialPinchWorld.x * newZoom;
        state.panY = center.y - state.initialPinchWorld.y * newZoom;

        redrawCallback();
        state.updateFloatingToolbar();
    }

    function animateEraserTrail() {
        state.eraserAnimationId = requestAnimationFrame(animateEraserTrail);
        redrawCallback();

        const { ctx, zoom, panX, panY, eraserTrailNodes, lastEraserPos } = state;
        
        let target = lastEraserPos;
        for (const node of eraserTrailNodes) {
            node.x += (target.x - node.x) * EASING_FACTOR;
            node.y += (target.y - node.y) * EASING_FACTOR;
            target = node;
        }

        ctx.save();
        ctx.translate(panX, panY);
        ctx.scale(zoom, zoom);
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        
        for (let i = 1; i < eraserTrailNodes.length; i++) {
            const p1 = eraserTrailNodes[i - 1];
            const p2 = eraserTrailNodes[i];
            
            const ratio = i / eraserTrailNodes.length;
            ctx.lineWidth = (1 - ratio) * 15 / zoom;
            ctx.strokeStyle = `rgba(135, 206, 250, ${1 - ratio})`;

            ctx.beginPath();
            ctx.moveTo(p1.x, p1.y);
            const midPoint = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
            ctx.quadraticCurveTo(p1.x, p1.y, midPoint.x, midPoint.y);
            ctx.stroke();
        }

        ctx.restore();
    }

    function performZoom(direction, zoomCenter) {
        const zoomFactor = 1.1;
        const oldZoom = state.zoom;
        let newZoom = (direction === 'in') ? oldZoom * zoomFactor : oldZoom / zoomFactor;
        state.zoom = Math.max(0.1, Math.min(newZoom, 10));
        if (!zoomCenter) zoomCenter = { x: canvas.getBoundingClientRect().width / 2, y: canvas.getBoundingClientRect().height / 2 };
        state.panX = zoomCenter.x - (zoomCenter.x - state.panX) * (state.zoom / oldZoom);
        state.panY = zoomCenter.y - (zoomCenter.y - state.panY) * (state.zoom / oldZoom);
        redrawCallback();
        state.updateFloatingToolbar();
    }
    
    saveState(state.layers);

    const getMousePos = (e) => { const rect = canvas.getBoundingClientRect(); const screenX = e.clientX - rect.left; const screenY = e.clientY - rect.top; return { x: (screenX - state.panX) / state.zoom, y: (screenY - state.panY) / state.zoom, }; };
    
    const contextMenu = document.getElementById('contextMenu');
    function hideContextMenu() { contextMenu.classList.remove('visible'); }
    document.addEventListener('click', (e) => { if (!contextMenu.contains(e.target)) hideContextMenu(); });

    contextMenu.addEventListener('click', (e) => {
        const action = e.target.dataset.action;
        if (!action || state.selectedLayers.length === 0) return;
        let newLayers;
        switch (action) {
            case 'bringForward': newLayers = layerManager.bringForward(state.layers, state.selectedLayers); break;
            case 'sendBackward': newLayers = layerManager.sendBackward(state.layers, state.selectedLayers); break;
            case 'bringToFront': newLayers = layerManager.bringToFront(state.layers, state.selectedLayers); break;
            case 'sendToBack': newLayers = layerManager.sendToBack(state.layers, state.selectedLayers); break;
        }
        if (newLayers) {
            state.layers = newLayers;
            saveState(state.layers);
            redrawCallback();
        }
        hideContextMenu();
    });
    
    function updateCursor(handle) {
        let cursor = '';
        if (handle) {
            switch (handle) {
                case 'pivot': cursor = 'grab'; break;
                case 'rotate': cursor = 'crosshair'; break;
                case 'topLeft': case 'bottomRight': cursor = 'nwse-resize'; break;
                case 'topRight': case 'bottomLeft': cursor = 'nesw-resize'; break;
                case 'top': case 'bottom': cursor = 'ns-resize'; break;
                case 'left': case 'right': cursor = 'ew-resize'; break;
            }
        }
        canvas.style.cursor = cursor;
    }

    function handleTripleClick(pos) { const layer = hitTest.getLayerAtPosition(pos, state.layers); if (layer) { state.isDrawing = false; state.selectedLayers = [layer]; const selectButton = document.querySelector('button[data-tool="select"]'); if (selectButton && state.activeTool !== 'select') { selectButton.click(); } else { redrawCallback(); } updateToolbarCallback(); return true; } return false; }

    function startDrawing(e) {
        if (state.isEditingText) return;
        if (e.pointerType === 'touch') {
            updateTouchPointer(e);
            if (state.activePointers.size >= 2) {
                if (!state.isPinching) {
                    beginPinchGesture();
                }
                updatePinchGesture();
                return;
            } else {
                state.isPinching = false;
            }
        }
        const pos = getMousePos(e);

        // --- НАЧАЛО ИЗМЕНЕНИЙ: Логика для быстрого редактирования текста ---
        if (state.activeTool === 'text') {
            const clickedLayer = hitTest.getLayerAtPosition(pos, state.layers);
            if (clickedLayer && clickedLayer.type === 'text') {
                // Если кликнули по существующему тексту, начинаем его редактирование
                clickedLayer.isEditing = true;
                state.isEditingText = true;
                redrawCallback();
                state.updateFloatingToolbar();

                textTool.startEditing(state, clickedLayer, (isIntermediate) => {
                    if (isIntermediate) {
                        redrawCallback();
                        state.updateFloatingToolbar();
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
                return; // Важно! Прерываем выполнение функции, чтобы не создавать новый текст.
            }
        }
        // --- КОНЕЦ ИЗМЕНЕНИЙ ---

        clearTimeout(state.shapeRecognitionTimer);
        state.shapeWasJustRecognized = false;

        const isPanToolActive = state.activeTool === 'pan' && e.button === 0;
        const isMiddleMouseButton = e.pointerType === 'mouse' && e.button === 1;

        if (isPanToolActive || isMiddleMouseButton) {
            state.isPanning = true;
            state.panStartPos = { x: e.clientX, y: e.clientY };
            canvas.style.cursor = 'grabbing';
            return;
        }
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        
        hideContextMenu();

        let finalPos = pos;
        if (e.altKey) {
            finalPos = { x: utils.snapToGrid(pos.x), y: utils.snapToGrid(pos.y) };
        }
        
        if (state.currentAction.startsWith('drawing')) {
            if (state.currentAction === 'drawingParallelogramSlant') {
                const finalSlant = finalPos.x - (state.tempLayer.x + state.tempLayer.width / 2);
                state.tempLayer.slantOffset = finalSlant;
                if (state.tempLayer.width > 5 || state.tempLayer.height > 5) { state.layers.push(state.tempLayer); }
            } else if (state.currentAction === 'drawingTriangleApex') {
                state.tempLayer.p3 = finalPos;
                if (Math.abs(state.tempLayer.p1.x - state.tempLayer.p2.x) > 5 || Math.abs(state.tempLayer.p1.y - state.tempLayer.p2.y) > 5) { state.layers.push(state.tempLayer); }
            } else if (state.currentAction === 'drawingParallelepipedDepth') {
                state.tempLayer.depthOffset = { x: finalPos.x - (state.tempLayer.x + state.tempLayer.width), y: finalPos.y - tempLayer.y };
                if (state.tempLayer.width > 5 || state.tempLayer.height > 5) { state.layers.push(state.tempLayer); }
            } else if (state.currentAction === 'drawingPyramidApex') {
                state.tempLayer.apex = finalPos;
                state.layers.push(state.tempLayer);
            } else if (state.currentAction === 'drawingTruncatedPyramidApex') {
                state.tempLayer.apex = finalPos;
                state.currentAction = 'drawingTruncatedPyramidTop';
                return;
            } else if (state.currentAction === 'drawingTruncatedPyramidTop') {
                const { base, apex } = state.tempLayer;
                const totalHeight = Math.abs(apex.y - base.p1.y);
                const cutHeight = Math.abs(finalPos.y - base.p1.y);
                const ratio = Math.max(0.05, Math.min(0.95, cutHeight / totalHeight));
    
                const interpolate = (p1, p2) => ({
                    x: p1.x + (p2.x - p1.x) * ratio,
                    y: p1.y + (p2.y - p1.y) * ratio
                });
    
                state.tempLayer.top = {
                    p1: interpolate(base.p1, apex), p2: interpolate(base.p2, apex),
                    p3: interpolate(base.p3, apex), p4: interpolate(base.p4, apex),
                };
                state.layers.push(state.tempLayer);
            } else if (state.currentAction === 'drawingTrapezoidP3') {
                state.tempLayer.p3 = finalPos;
                state.currentAction = 'drawingTrapezoidP4';
                return;
            } else if (state.currentAction === 'drawingTrapezoidP4') {
                state.tempLayer.p4 = finalPos;
                if (Math.abs(state.tempLayer.p1.x - state.tempLayer.p2.x) > 5) { state.layers.push(state.tempLayer); }
            } else if (state.currentAction === 'drawingFrustum') {
                const { cx } = state.tempLayer;
                state.tempLayer.topY = finalPos.y;
                state.tempLayer.rx2 = Math.abs(finalPos.x - cx);
                state.tempLayer.ry2 = state.tempLayer.rx2 * 0.3;
                state.layers.push(state.tempLayer);
            } else if (state.currentAction === 'drawingTruncatedSphere') {
                const { cx, cy, r } = state.tempLayer;
                const cutY = Math.max(cy - r, Math.min(cy + r, finalPos.y));
                const h = Math.abs(cutY - cy);
                const cutRSquared = (r * r) - (h * h);
                state.tempLayer.cutY = cutY;
                state.tempLayer.cutR = cutRSquared > 0 ? Math.sqrt(cutRSquared) : 0;
                state.tempLayer.cutRy = state.tempLayer.cutR * 0.3;
                state.layers.push(state.tempLayer);
            }
            saveState(state.layers); state.currentAction = 'none'; state.tempLayer = null; redrawCallback(); return;
        }

        const now = Date.now();
        const CLICK_SPEED = 400, CLICK_RADIUS = 10;
        const timeDiff = now - state.lastClickTime;
        if (state.lastClickPos && timeDiff < CLICK_SPEED && Math.abs(pos.x - state.lastClickPos.x) < CLICK_RADIUS && Math.abs(pos.y - state.lastClickPos.y) < CLICK_RADIUS) { state.clickCount++; } else { state.clickCount = 1; }
        state.lastClickTime = now; state.lastClickPos = pos;
        
        if (state.activeTool === 'select' && state.clickCount === 2) {
            const clickedLayer = hitTest.getLayerAtPosition(pos, state.layers);
            if (clickedLayer && clickedLayer.type === 'text') {
                clickedLayer.isEditing = true;
                
                state.isEditingText = true;
                redrawCallback();
                state.updateFloatingToolbar();

                textTool.startEditing(state, clickedLayer, (isIntermediate) => {
                    if (isIntermediate) {
                        redrawCallback();
                        state.updateFloatingToolbar();
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

        if (state.clickCount === 3) { state.clickCount = 0; if (handleTripleClick(pos)) return; }
        
        state.dragStartPos = pos;
        
        if (state.activeTool === 'select') {
            state.groupRotation = 0;
            if (state.selectedLayers.length > 0) {
                state.scalingHandle = hitTest.getHandleAtPosition(pos, state.selectedLayers, state.zoom, state.groupRotation);
                if (state.scalingHandle === 'pivot') { 
                    state.currentAction = 'movingPivot';
                    canvas.style.cursor = 'none'; 
                    return; 
                }
                if (state.scalingHandle === 'rotate') {
                    state.currentAction = 'rotating';
                    const box = geo.getGroupBoundingBox(state.selectedLayers);
                    const centerX = box.x + box.width / 2;
                    const centerY = box.y + box.height / 2;
                    let pivotX = centerX;
                    let pivotY = centerY;

                    if (state.selectedLayers.length === 1) {
                        const layer = state.selectedLayers[0];
                        const pivot = layer.pivot || { x: 0, y: 0 };
                        const rotation = layer.rotation || 0;
                        const rotatedPivotOffset = geo.rotatePoint(pivot, {x: 0, y: 0}, rotation);
                        pivotX = centerX + rotatedPivotOffset.x;
                        pivotY = centerY + rotatedPivotOffset.y;
                    }
                    
                    state.groupPivot = { x: pivotX, y: pivotY };
                    state.rotationStartAngle = Math.atan2(pos.y - state.groupPivot.y, pos.x - state.groupPivot.x);
                    state.originalLayers = state.selectedLayers.map(l => JSON.parse(JSON.stringify(l)));
                    return;
                }
                if (state.scalingHandle) { state.currentAction = 'scaling'; state.originalBox = geo.getGroupBoundingBox(state.selectedLayers); state.originalLayers = state.selectedLayers.map(l => JSON.parse(JSON.stringify(l))); return; }
            }
            const clickedLayer = hitTest.getLayerAtPosition(pos, state.layers);
            if (clickedLayer) {
                if (e.ctrlKey || e.metaKey) {
                    const index = state.selectedLayers.findIndex(l => l.id === clickedLayer.id);
                    if (index > -1) {
                        state.selectedLayers.splice(index, 1);
                    }
                } else if (e.shiftKey) {
                    const index = state.selectedLayers.findIndex(l => l.id === clickedLayer.id);
                    if (index > -1) {
                        state.selectedLayers.splice(index, 1);
                    } else {
                        state.selectedLayers.push(clickedLayer);
                    }
                } else {
                    if (!state.selectedLayers.some(l => l.id === clickedLayer.id)) {
                        state.selectedLayers = [clickedLayer];
                    }
                }
                state.currentAction = 'moving';
            } else {
                if (!e.shiftKey && !e.ctrlKey && !e.metaKey) {
                    state.selectedLayers = [];
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
        updateToolbarCallback();
        state.updateFloatingToolbar();
        state.isDrawing = true; 
        state.startPos = pos;
        if (state.activeTool === 'brush' || state.activeTool === 'smart-brush') { 
            const pressure = e.pressure > 0 ? e.pressure : 0.5;
            state.layers.push({ type: 'path', points: [{...pos, pressure }], color: state.activeColor, lineWidth: state.activeLineWidth, id: Date.now(), rotation: 0, pivot: { x: 0, y: 0 } });
            state.lastBrushTime = Date.now();
            state.lastBrushPoint = pos;
        } 
        else if (state.activeTool === 'eraser') {
            state.didErase = false; 
            state.lastEraserPos = pos;
            state.eraserTrailNodes = Array(NUM_TRAIL_NODES).fill(null).map(() => ({ ...pos }));
            if (state.eraserAnimationId) {
                cancelAnimationFrame(state.eraserAnimationId);
            }
            animateEraserTrail();
            if (tools.handleEraser(state, pos)) {
                redrawCallback();
            }
        }
    }

    function draw(e) {
        if (state.isEditingText) return;

        if (e.pointerType === 'touch') {
            updateTouchPointer(e);
            if (state.activePointers.size >= 2) {
                if (!state.isPinching) {
                    beginPinchGesture();
                }
                updatePinchGesture();
                return;
            }

            if (state.isPinching) {
                updatePinchGesture();
                return;
            }
        }

        if (state.isPinching) {
            return;
        }

        if (state.isPanning) { const dx = e.clientX - state.panStartPos.x; const dy = e.clientY - state.panStartPos.y; state.panX += dx; state.panY += dy; state.panStartPos = { x: e.clientX, y: e.clientY }; redrawCallback(); state.updateFloatingToolbar(); return; }
        const pos = getMousePos(e);

        if (!state.isDrawing && state.currentAction === 'none') { 
            const layerAtPos = hitTest.getLayerAtPosition(pos, state.layers);
            if (state.selectedLayers.length > 0) { 
                const handle = hitTest.getHandleAtPosition(pos, state.selectedLayers, state.zoom, state.groupRotation); 
                updateCursor(handle); 
                if (!handle && hitTest.getLayerAtPosition(pos, state.selectedLayers)) { canvas.style.cursor = 'move'; } 
            } else if (state.activeTool === 'select') { 
                if (layerAtPos && layerAtPos.type === 'text') {
                    canvas.style.cursor = 'text';
                } else {
                    canvas.style.cursor = layerAtPos ? 'pointer' : ''; 
                }
            } else if (state.activeTool === 'pan') {
                canvas.style.cursor = 'grab';
            } else { updateCursor(null); } 
            return;
        }
        
        if (!e.altKey) { state.snapPoint = null; }

        switch(state.currentAction) {
            case 'movingPivot': actions.handleMovePivot(state, pos); redrawCallback(); return;
            case 'rotating': actions.handleRotate(state, pos, e); redrawCallback(); state.updateFloatingToolbar(); return;
            case 'moving': actions.handleMove(state, pos, e); redrawCallback(); state.updateFloatingToolbar(); return;
            case 'scaling': actions.handleScale(state, pos, e); redrawCallback(); state.updateFloatingToolbar(); return;
            case 'selectionBox': 
                redrawCallback(); ctx.save(); ctx.translate(state.panX, state.panY); ctx.scale(state.zoom, state.zoom); 
                ctx.strokeStyle = 'rgba(0, 122, 255, 0.8)'; ctx.fillStyle = 'rgba(0, 122, 255, 0.1)'; 
                ctx.lineWidth = 1 / state.zoom; ctx.beginPath(); 
                ctx.rect(state.startPos.x, state.startPos.y, pos.x - state.startPos.x, pos.y - state.startPos.y); 
                ctx.fill(); ctx.stroke(); ctx.restore(); 
                return;
        }
        
        if (state.currentAction.startsWith('drawing')) {
            tools.handleMultiStepDrawing(state, pos, e, redrawCallback);
        } else if (state.isDrawing) {
            if (state.activeTool === 'brush' || state.activeTool === 'smart-brush') {
                tools.handleBrush(state, pos, e);

                if (state.activeTool === 'smart-brush') {
                    clearTimeout(state.shapeRecognitionTimer); 
                    const lastLayer = state.layers[state.layers.length - 1];
                    if (lastLayer && lastLayer.type === 'path') {
                        state.shapeRecognitionTimer = setTimeout(() => {
                            const recognizedShape = shapeRecognizer.recognizeShape(lastLayer.points);
                            if (recognizedShape) {
                                if (state.layers[state.layers.length - 1] === lastLayer) {
                                    state.layers.pop();
                                    recognizedShape.color = lastLayer.color;
                                    recognizedShape.lineWidth = lastLayer.lineWidth;
                                    state.layers.push(recognizedShape);
                                    
                                    state.isDrawing = false; 
                                    state.shapeWasJustRecognized = true;
                                    
                                    saveState(state.layers);
                                    redrawCallback();
                                }
                            }
                        }, 500); 
                    }
                }
                redrawCallback();
            } else if (state.activeTool === 'eraser') {
                state.lastEraserPos = pos;
                tools.handleEraser(state, pos);
            } else {
                tools.handleShapeDrawing(state, pos, e, redrawCallback);
            }
        }
    }

    function stopDrawing(e) {
        if (state.isEditingText) return;

        if (e.pointerType === 'touch') {
            removeTouchPointer(e);
            if (state.isPinching) {
                if (state.activePointers.size < 2) {
                    state.isPinching = false;
                    state.initialPinchDistance = 0;
                    if (state.activePointers.size === 0) {
                        state.initialPinchWorld = { x: 0, y: 0 };
                    }
                }
                redrawCallback();
                state.updateFloatingToolbar();
                return;
            }
        }

        clearTimeout(state.shapeRecognitionTimer);
        if (state.eraserAnimationId) {
            cancelAnimationFrame(state.eraserAnimationId);
            state.eraserAnimationId = null;
            redrawCallback();
        }

        if (state.isPanning) {
            state.isPanning = false;
            if (state.activeTool === 'pan') {
                canvas.style.cursor = 'grab';
            } else {
                updateCursor(null);
            }
            return;
        }

        if (!state.isDrawing && ['rotating', 'scaling', 'movingPivot'].includes(state.currentAction)) {
            state.selectedLayers.forEach(utils.applyTransformations);
            saveState(state.layers);
        }

        const isMultiStep = state.currentAction.startsWith('drawing');
        if (!state.isDrawing) {
            if (state.currentAction === 'movingPivot') { updateCursor(null); }
            if (isMultiStep) return;
            if (state.currentAction === 'moving') { saveState(state.layers); }
        } else if (state.isDrawing) {
            const rawEnd = getMousePos(e);
            let finalStart = { ...state.startPos };
            let finalEnd = rawEnd;

            if (e.altKey) {
                finalStart = { x: utils.snapToGrid(state.startPos.x), y: utils.snapToGrid(state.startPos.y) };
                finalEnd = { x: utils.snapToGrid(rawEnd.x), y: utils.snapToGrid(rawEnd.y) };
            }
            
            if (state.activeTool === 'line' && e.shiftKey) {
                const dx = finalEnd.x - finalStart.x;
                const dy = finalEnd.y - finalStart.y;
                if (Math.abs(dx) > Math.abs(dy)) { finalEnd.y = finalStart.y; } else { finalEnd.x = finalStart.x; }
            }

            if (state.activeTool === 'brush' || state.activeTool === 'smart-brush') {
                const lastLayer = state.layers[state.layers.length - 1];
                if (lastLayer && lastLayer.type === 'path') {
                    if (state.smoothingAmount > 0) {
                        const tolerance = state.smoothingAmount * 0.5;
                        lastLayer.points = utils.simplifyPath(lastLayer.points, tolerance);
                    }
                    
                    if (state.activeTool === 'smart-brush' && !state.shapeWasJustRecognized) {
                        const recognizedShape = shapeRecognizer.recognizeShape(lastLayer.points);
                        if (recognizedShape) {
                            state.layers.pop();
                            recognizedShape.color = lastLayer.color;
                            recognizedShape.lineWidth = lastLayer.lineWidth;
                            state.layers.push(recognizedShape);
                        }
                    }
                }
                saveState(state.layers);
            } 
            else if (state.activeTool === 'eraser') { 
                if (state.didErase) { saveState(state.layers); } 
            } else if (['parallelogram', 'triangle', 'parallelepiped', 'pyramid', 'truncated-pyramid', 'trapezoid', 'frustum', 'truncated-sphere'].includes(state.activeTool)) {
                state.isDrawing = false;
                const commonProps = { color: state.activeColor, lineWidth: state.activeLineWidth, id: Date.now(), rotation: 0, pivot: { x: 0, y: 0 } };
                switch(state.activeTool) {
                    case 'parallelogram': {
                        state.currentAction = 'drawingParallelogramSlant'; 
                        state.tempLayer = { type: 'parallelogram', x: Math.min(finalEnd.x, finalStart.x), y: Math.min(finalEnd.y, finalStart.y), width: Math.abs(finalEnd.x - finalStart.x), height: Math.abs(finalEnd.y - finalStart.y), slantOffset: 0, ...commonProps }; 
                        break;
                    }
                    case 'triangle': {
                        state.currentAction = 'drawingTriangleApex'; 
                        state.tempLayer = { type: 'triangle', p1: finalStart, p2: finalEnd, p3: finalEnd, ...commonProps }; 
                        break;
                    }
                    case 'parallelepiped': {
                        state.currentAction = 'drawingParallelepipedDepth'; 
                        const width = Math.abs(finalEnd.x - finalStart.x); 
                        state.tempLayer = { type: 'parallelepiped', x: Math.min(finalEnd.x, finalStart.x), y: Math.min(finalEnd.y, finalStart.y), width, height: Math.abs(finalEnd.y - finalStart.y), depthOffset: { x: width * 0.3, y: -width * 0.3 }, ...commonProps }; 
                        break;
                    }
                    case 'pyramid': case 'truncated-pyramid': {
                        state.currentAction = state.activeTool === 'pyramid' ? 'drawingPyramidApex' : 'drawingTruncatedPyramidApex'; 
                        const x = Math.min(finalEnd.x, finalStart.x); 
                        const y = Math.min(finalEnd.y, finalStart.y); 
                        const w = Math.abs(finalEnd.x - finalStart.x); 
                        const h = Math.abs(finalEnd.y - finalStart.y); 
                        const d = {x: w * 0.3, y: -w * 0.2}; 
                        state.tempLayer = { type: state.activeTool, base: { p1: { x: x, y: y + h }, p2: { x: x + w, y: y + h }, p3: { x: x + w + d.x, y: y + h + d.y }, p4: { x: x + d.x, y: y + h + d.y } }, apex: { x: x + w/2, y: y }, ...commonProps }; 
                        break;
                    }
                    case 'trapezoid': {
                        state.currentAction = 'drawingTrapezoidP3'; 
                        state.tempLayer = { type: 'trapezoid', p1: finalStart, p2: finalEnd, p3: finalEnd, p4: finalStart, ...commonProps }; 
                        break;
                    }
                    case 'frustum': {
                        state.currentAction = 'drawingFrustum'; 
                        const rx1 = Math.abs(finalEnd.x - finalStart.x) / 2; 
                        const cx = finalStart.x + (finalEnd.x - finalStart.x) / 2; 
                        const baseY = Math.max(finalEnd.y, finalStart.y); 
                        state.tempLayer = { type: 'frustum', cx, baseY, rx1, ry1: rx1 * 0.3, topY: baseY, rx2: rx1, ry2: rx1 * 0.3, ...commonProps }; 
                        break;
                    }
                    case 'truncated-sphere': {
                        state.currentAction = 'drawingTruncatedSphere'; 
                        const r = Math.abs(finalEnd.x - finalStart.x) / 2; 
                        const cenX = finalStart.x + (finalEnd.x - finalStart.x) / 2; 
                        const cenY = finalStart.y + (finalEnd.y - finalStart.y)/2; 
                        state.tempLayer = { type: 'truncated-sphere', cx: cenX, cy: cenY, r, cutY: cenY, cutR: r, cutRy: r * 0.3, ...commonProps }; 
                        break;
                    }
                }
                return;
            } else {
                const commonProps = { color: state.activeColor, lineWidth: state.activeLineWidth, id: Date.now(), rotation: 0, pivot: { x: 0, y: 0 } };
                switch(state.activeTool) {
                    case 'rect': {
                        const rect = { type: 'rect', x: Math.min(finalEnd.x, finalStart.x), y: Math.min(finalEnd.y, finalStart.y), width: Math.abs(finalEnd.x - finalStart.x), height: Math.abs(finalEnd.y - finalStart.y), ...commonProps }; 
                        if (rect.width > 5 || rect.height > 5) state.layers.push(rect); 
                        break;
                    }
                    case 'text': {
                        const width = Math.abs(finalEnd.x - finalStart.x);
                        const height = Math.abs(finalEnd.y - finalStart.y);
                        if (width < 20 || height < 20) { 
                            state.isDrawing = false;
                            redrawCallback();
                            return; 
                        }

                        const newTextLayer = {
                            type: 'text',
                            x: Math.min(finalEnd.x, finalStart.x),
                            y: Math.min(finalEnd.y, finalStart.y),
                            width: width,
                            height: height,
                            content: '',
                            color: state.activeColor,
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
            
                        newTextLayer.isEditing = true;
                        
                        state.isEditingText = true;
                        redrawCallback();
                        state.updateFloatingToolbar();

                        textTool.startEditing(state, newTextLayer, (isIntermediate) => {
                            if (isIntermediate) {
                                redrawCallback();
                                state.updateFloatingToolbar();
                                return;
                            }
                            state.isEditingText = false;
                            const finishedLayer = state.layers.find(l => l.id === newTextLayer.id);
                            if (finishedLayer) {
                                finishedLayer.isEditing = false;
                            }
                            saveState(state.layers);
                            redrawCallback();
                            state.updateFloatingToolbar();
                        });
                        state.isDrawing = false;
                        return;
                    }
                    case 'rhombus': {
                        const x = Math.min(finalEnd.x, finalStart.x); 
                        const y = Math.min(finalEnd.y, finalStart.y); 
                        const width = Math.abs(finalEnd.x - finalStart.x); 
                        const height = Math.abs(finalEnd.y - finalStart.y); 
                        if(width>5 && height>5) state.layers.push({ type: 'rhombus', p1: {x: x+width/2, y: y}, p2: {x: x+width, y: y+height/2}, p3: {x: x+width/2, y: y+height}, p4: {x: x, y: y+height/2}, ...commonProps }); 
                        break;
                    }
                    case 'ellipse': case 'sphere': case 'cone': {
                        const width = Math.abs(finalEnd.x - finalStart.x); 
                        const height = Math.abs(finalEnd.y - finalStart.y); 
                        const cx = finalStart.x + (finalEnd.x - finalStart.x) / 2; 
                        if (state.activeTool === 'sphere') { 
                            const r = width / 2; 
                            if (r > 5) state.layers.push({ type: 'sphere', cx, cy: finalStart.y + (finalEnd.y-finalStart.y)/2, r, ...commonProps }); 
                        } else if (state.activeTool === 'cone') { 
                            const rx = width / 2; 
                            const apex = {x: cx, y: Math.min(finalEnd.y, finalStart.y)}; 
                            const baseY = Math.max(finalEnd.y, finalStart.y); 
                            if (rx > 5 && height > 5) state.layers.push({ type: 'cone', cx, baseY, rx, ry: rx * 0.3, apex, ...commonProps }); 
                        } else { 
                            const rx = width / 2; 
                            const ry = height/2; 
                            const cy = finalStart.y + (finalEnd.y - finalStart.y) / 2; 
                            if (rx > 5 || ry > 5) state.layers.push({ type: 'ellipse', cx, cy, rx, ry, ...commonProps }); 
                        } 
                        break;
                    }
                    case 'line': {
                        const line = { type: 'line', x1: finalStart.x, y1: finalStart.y, x2: finalEnd.x, y2: finalEnd.y, ...commonProps }; 
                        if (Math.abs(line.x1 - line.x2) > 5 || Math.abs(line.y1 - line.y2) > 5) state.layers.push(line); 
                        break;
                    }
                }
                saveState(state.layers);
            }
        }
        
        updateCursor(null);
        if (state.currentAction === 'selectionBox') {
            actions.endSelectionBox(state, getMousePos(e), e);
            updateToolbarCallback();
            state.updateFloatingToolbar();
        }

        state.isDrawing = false; state.currentAction = 'none'; state.scalingHandle = null; state.startPos = null; state.originalBox = null; state.originalLayers = []; state.groupPivot = null; state.didErase = false; state.groupRotation = 0; state.snapPoint = null;
        redrawCallback();
    }
    
    function handleContextMenu(e) {
        e.preventDefault();
        const pos = getMousePos(e);
        const clickedLayer = hitTest.getLayerAtPosition(pos, state.layers);

        if (clickedLayer) {
            if (!state.selectedLayers.some(l => l.id === clickedLayer.id)) {
                state.selectedLayers = [clickedLayer];
                redrawCallback();
                updateToolbarCallback();
                state.updateFloatingToolbar();
            }
            
            contextMenu.style.top = `${e.clientY}px`;
            contextMenu.style.left = `${e.clientX}px`;
            contextMenu.classList.add('visible');
        } else {
            hideContextMenu();
        }
    }
    
    canvas.addEventListener('pointerdown', startDrawing);
    canvas.addEventListener('pointermove', draw);
    canvas.addEventListener('pointerup', stopDrawing);
    canvas.addEventListener('pointerleave', (e) => {
        if (state.isDrawing || state.currentAction !== 'none' || state.isPanning || state.isPinching || (e.pointerType === 'touch' && state.activePointers.size > 0)) {
            stopDrawing(e);
        }
        state.isPanning = false;
    });
    canvas.addEventListener('pointercancel', stopDrawing);
    
    canvas.addEventListener('wheel', (e) => {
        e.preventDefault(); 
        const rect = canvas.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;
        
        if (e.deltaY < 0) {
            performZoom('in', { x: mouseX, y: mouseY });
        } else {
            performZoom('out', { x: mouseX, y: mouseY });
        }
    });

    canvas.addEventListener('dragover', (e) => e.preventDefault());
    canvas.addEventListener('drop', (e) => { e.preventDefault(); const pos = getMousePos(e); if (e.dataTransfer.files.length > 0) utils.processImageFile(e.dataTransfer.files[0], pos, state, redrawCallback, saveState); });
    
    canvas.addEventListener('contextmenu', handleContextMenu);

    const imageUploadInput = document.getElementById('imageUpload');
    imageUploadInput.addEventListener('change', (e) => { if (e.target.files.length > 0) { const centerPos = { x: canvas.width / 2, y: canvas.height / 2 }; utils.processImageFile(e.target.files[0], centerPos, state, redrawCallback, saveState); e.target.value = ''; } });
    
    state.performZoom = performZoom;

    return state;
}
// --- END OF FILE canvas.js ---