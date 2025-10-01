// --- START OF FILE js/canvas.js ---

import * as geo from './geometry.js';
import * as hitTest from './hitTest.js';
import * as actions from './actions.js';
import * as tools from './tools.js';
import * as utils from './utils.js';
import * as layerManager from './layerManager.js';
import * as shapeRecognizer from './shapeRecognizer.js';
import * as textTool from './text.js';

export function initializeCanvas(canvas, interactionCanvas, ctx, redrawCallback, saveState, updateToolbarCallback) {
    const iCtx = interactionCanvas.getContext('2d');

    const state = {
        canvas, ctx,
        interactionCanvas, iCtx,
        isDrawing: false, layers: [], activeTool: 'brush', previousTool: 'brush',
        startPos: null, selectedLayers: [], currentAction: 'none', dragStartPos: null,
        scalingHandle: null, activeColor: '#000000',
        activeLineWidth: 3,
        activeLineStyle: 'solid',
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
        layersToErase: new Set(),
        isMultiTouching: false, 
        multiTouchState: {},
        // --- Новые состояния для мобильного рисования фигур ---
        mobileShapeState: 'idle', // 'idle', 'defining_first_point', 'defining_second_point', ...
        mobileFirstPoint: null,
        mobileDragAnchor: null,
    };

    function resetMobileShapeState() {
        state.mobileShapeState = 'idle';
        state.mobileFirstPoint = null;
        state.mobileDragAnchor = null;
        iCtx.clearRect(0, 0, interactionCanvas.width, interactionCanvas.height);
    }
    
    state.updateTextEditorStyle = textTool.updateEditorStyle;
    state.updateTextEditorTransform = textTool.updateEditorTransform;

    state.updateFloatingToolbar = () => {
        const textToolbar = document.getElementById('floating-text-toolbar');
        const selectionToolbar = document.getElementById('floating-selection-toolbar');

        textToolbar.classList.remove('visible');
        selectionToolbar.classList.remove('visible');

        const hasSelection = state.selectedLayers.length > 0;
        const isSingleTextSelection = hasSelection && state.selectedLayers.length === 1 && state.selectedLayers[0].type === 'text';
        const isGeneralSelection = hasSelection && !isSingleTextSelection;
        
        if (state.isEditingText || isSingleTextSelection) {
            textToolbar.classList.add('visible'); 

            const layer = state.isEditingText 
                ? state.layers.find(l => l.isEditing) 
                : state.selectedLayers[0];

            if (!layer) {
                textToolbar.classList.remove('visible');
                return;
            }

            const box = geo.getBoundingBox(layer);
            if (!box) {
                textToolbar.classList.remove('visible');
                return;
            }
            
            document.getElementById('fontFamilySelect').value = layer.fontFamily || 'Arial';
            document.getElementById('floatingFontSizeInput').value = layer.fontSize || 30;
            const colorButtonCircle = textToolbar.querySelector('[data-action="pick-color"] circle');
            if (colorButtonCircle) {
                colorButtonCircle.style.fill = layer.color || '#000000';
            }
            
            textToolbar.querySelector('[data-action="align-left"]').classList.toggle('active', !layer.align || layer.align === 'left');
            textToolbar.querySelector('[data-action="align-center"]').classList.toggle('active', layer.align === 'center');
            textToolbar.querySelector('[data-action="align-right"]').classList.toggle('active', layer.align === 'right');
            textToolbar.querySelector('[data-action="font-bold"]').classList.toggle('active', layer.fontWeight === 'bold');
            textToolbar.querySelector('[data-action="font-italic"]').classList.toggle('active', layer.fontStyle === 'italic');
            textToolbar.querySelector('[data-action="font-underline"]').classList.toggle('active', layer.textDecoration === 'underline');
            
            const screenX = (box.x * state.zoom) + state.panX;
            const screenY = (box.y * state.zoom) + state.panY;
            const screenHeight = box.height * state.zoom;
            
            textToolbar.style.left = `${screenX}px`;

            const toolbarHeight = textToolbar.offsetHeight;
            const spaceAbove = screenY;
            
            if (spaceAbove > toolbarHeight + 10) {
                textToolbar.style.top = `${screenY - toolbarHeight - 10}px`;
            } else {
                textToolbar.style.top = `${screenY + screenHeight + 10}px`;
            }

        } else if (isGeneralSelection) {
            selectionToolbar.classList.add('visible');
            const box = geo.getGroupBoundingBox(state.selectedLayers);
            if (!box) {
                selectionToolbar.classList.remove('visible');
                return;
            }

            const screenX = (box.x * state.zoom) + state.panX;
            const screenY = (box.y * state.zoom) + state.panY;
            const screenHeight = box.height * state.zoom;

            selectionToolbar.style.left = `${screenX + (box.width * state.zoom / 2) - (selectionToolbar.offsetWidth / 2)}px`;

            const toolbarHeight = selectionToolbar.offsetHeight;
            const spaceAbove = screenY;
            
            if (spaceAbove > toolbarHeight + 20) {
                selectionToolbar.style.top = `${screenY - toolbarHeight - 10}px`;
            } else {
                selectionToolbar.style.top = `${screenY + screenHeight + 10}px`;
            }
        }
    };
    
    const NUM_TRAIL_NODES = 10;
    const EASING_FACTOR = 0.3;

    function animateEraserTrail() {
        state.eraserAnimationId = requestAnimationFrame(animateEraserTrail);
        
        const { zoom, panX, panY, eraserTrailNodes, lastEraserPos } = state;
        
        let target = lastEraserPos;
        for (const node of eraserTrailNodes) {
            node.x += (target.x - node.x) * EASING_FACTOR;
            node.y += (target.y - node.y) * EASING_FACTOR;
            target = node;
        }

        iCtx.clearRect(0, 0, interactionCanvas.width, interactionCanvas.height);
        iCtx.save();
        iCtx.translate(panX, panY);
        iCtx.scale(zoom, zoom);
        iCtx.lineCap = 'round';
        iCtx.lineJoin = 'round';
        
        for (let i = 1; i < eraserTrailNodes.length; i++) {
            const p1 = eraserTrailNodes[i - 1];
            const p2 = eraserTrailNodes[i];
            
            const ratio = i / eraserTrailNodes.length;
            const alpha = 1 - ratio;
            const lineWidth = alpha * 20 / zoom;

            if (lineWidth < 0.1 || alpha <= 0) continue;

            iCtx.lineWidth = lineWidth;
            iCtx.strokeStyle = `rgba(135, 206, 250, ${alpha * 0.75})`;

            iCtx.beginPath();
            iCtx.moveTo(p1.x, p1.y);
            iCtx.lineTo(p2.x, p2.y);
            iCtx.stroke();
        }

        iCtx.restore();
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

    function handleTouchShapeDrawing(pos) {
        if (state.mobileShapeState === 'idle') {
            state.mobileFirstPoint = pos;
            state.mobileShapeState = 'defining_first_point';
            
            iCtx.clearRect(0, 0, interactionCanvas.width, interactionCanvas.height);
            iCtx.save();
            iCtx.translate(state.panX, state.panY);
            iCtx.scale(state.zoom, state.zoom);
            iCtx.fillStyle = 'rgba(0, 122, 255, 0.5)';
            iCtx.beginPath();
            iCtx.arc(pos.x, pos.y, 8 / state.zoom, 0, Math.PI * 2);
            iCtx.fill();
            iCtx.restore();
            return true; // Event handled, stop startDrawing here
        } else if (state.mobileShapeState === 'defining_first_point') {
            state.isDrawing = true;
            state.startPos = state.mobileFirstPoint;
            state.mobileDragAnchor = pos;
            state.mobileShapeState = 'defining_second_point';
            iCtx.clearRect(0, 0, interactionCanvas.width, interactionCanvas.height);
            return false; // Continue with startDrawing to add listeners
        }
        return false;
    }

    function startDrawing(e) {
        if (e.target.id !== 'drawingBoard' || (e.pointerType === 'touch' && state.isMultiTouching)) return;
        
        const pos = getMousePos(e);
        let finalPos = pos;
        if (e.altKey) {
            finalPos = { x: utils.snapToGrid(pos.x), y: utils.snapToGrid(pos.y) };
        }

        const isShapeTool = !['brush', 'smart-brush', 'eraser', 'select', 'pan', 'text'].includes(state.activeTool);
        if (e.pointerType === 'touch' && isShapeTool) {
            if (handleTouchShapeDrawing(pos)) {
                return;
            }
        }

        if (state.currentAction.startsWith('drawing')) {
            let isFinalStep = false;
            if (state.currentAction === 'drawingParallelogramSlant') {
                const finalSlant = finalPos.x - (state.tempLayer.x + state.tempLayer.width / 2);
                state.tempLayer.slantOffset = finalSlant;
                if (state.tempLayer.width > 5 || state.tempLayer.height > 5) { state.layers.push(state.tempLayer); }
                isFinalStep = true;
            } else if (state.currentAction === 'drawingTriangleApex') {
                state.tempLayer.p3 = finalPos;
                if (Math.abs(state.tempLayer.p1.x - state.tempLayer.p2.x) > 5 || Math.abs(state.tempLayer.p1.y - state.tempLayer.p2.y) > 5) { state.layers.push(state.tempLayer); }
                isFinalStep = true;
            } else if (state.currentAction === 'drawingParallelepipedDepth') {
                state.tempLayer.depthOffset = { x: finalPos.x - (state.tempLayer.x + state.tempLayer.width), y: finalPos.y - state.tempLayer.y };
                if (state.tempLayer.width > 5 || state.tempLayer.height > 5) { state.layers.push(state.tempLayer); }
                isFinalStep = true;
            } else if (state.currentAction === 'drawingPyramidApex') {
                state.tempLayer.apex = finalPos;
                state.layers.push(state.tempLayer);
                isFinalStep = true;
            } else if (state.currentAction === 'drawingTruncatedPyramidApex') {
                state.tempLayer.apex = finalPos;
                state.currentAction = 'drawingTruncatedPyramidTop';
                return; 
            } else if (state.currentAction === 'drawingTruncatedPyramidTop') {
                const { base, apex } = state.tempLayer;
                const totalHeight = Math.abs(apex.y - base.p1.y);
                const cutHeight = Math.abs(finalPos.y - base.p1.y);
                const ratio = Math.max(0.05, Math.min(0.95, cutHeight / totalHeight));
    
                const interpolate = (p1, p2) => ({ x: p1.x + (p2.x - p1.x) * ratio, y: p1.y + (p2.y - p1.y) * ratio });
    
                state.tempLayer.top = {
                    p1: interpolate(base.p1, apex), p2: interpolate(base.p2, apex),
                    p3: interpolate(base.p3, apex), p4: interpolate(base.p4, apex),
                };
                delete state.tempLayer.apex;
                state.layers.push(state.tempLayer);
                isFinalStep = true;
            } else if (state.currentAction === 'drawingTrapezoidP3') {
                state.tempLayer.p3 = finalPos;
                state.currentAction = 'drawingTrapezoidP4';
                return; 
            } else if (state.currentAction === 'drawingTrapezoidP4') {
                state.tempLayer.p4 = finalPos;
                if (Math.abs(state.tempLayer.p1.x - state.tempLayer.p2.x) > 5) { state.layers.push(state.tempLayer); }
                isFinalStep = true;
            } else if (state.currentAction === 'drawingFrustum') {
                const { cx } = state.tempLayer;
                state.tempLayer.topY = finalPos.y;
                state.tempLayer.rx2 = Math.abs(finalPos.x - cx);
                state.tempLayer.ry2 = state.tempLayer.rx2 * 0.3;
                state.layers.push(state.tempLayer);
                isFinalStep = true;
            } else if (state.currentAction === 'drawingTruncatedSphere') {
                const { cx, cy, r } = state.tempLayer;
                const cutY = Math.max(cy - r, Math.min(cy + r, finalPos.y));
                const h = Math.abs(cutY - cy);
                const cutRSquared = (r * r) - (h * h);
                state.tempLayer.cutY = cutY;
                state.tempLayer.cutR = cutRSquared > 0 ? Math.sqrt(cutRSquared) : 0;
                state.tempLayer.cutRy = state.tempLayer.cutR * 0.3;
                state.layers.push(state.tempLayer);
                isFinalStep = true;
            }

            if (isFinalStep) {
                saveState(state.layers); 
                state.currentAction = 'none'; 
                state.tempLayer = null; 
                redrawCallback();
                iCtx.clearRect(0, 0, interactionCanvas.width, interactionCanvas.height);
                document.removeEventListener('pointermove', draw);
                document.removeEventListener('pointerup', stopDrawing);
            }
            return;
        }
        
        document.addEventListener('pointermove', draw);
        document.addEventListener('pointerup', stopDrawing);

        if (state.activeTool === 'text' && !state.isEditingText) {
            const clickedLayer = hitTest.getLayerAtPosition(pos, state.layers);
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
            canvas.style.cursor = 'grabbing';
            return;
        }
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        
        hideContextMenu();

        const now = Date.now();
        const CLICK_SPEED = 400, CLICK_RADIUS = 10;
        const timeDiff = now - state.lastClickTime;
        if (state.lastClickPos && timeDiff < CLICK_SPEED && Math.abs(pos.x - state.lastClickPos.x) < CLICK_RADIUS && Math.abs(pos.y - state.lastClickPos.y) < CLICK_RADIUS) { state.clickCount++; } else { state.clickCount = 1; }
        state.lastClickTime = now; state.lastClickPos = pos;
        
        if (state.activeTool === 'select' && state.clickCount === 2) {
            const clickedLayer = hitTest.getLayerAtPosition(pos, state.layers);
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

        if (state.clickCount === 3) { state.clickCount = 0; if (handleTripleClick(pos)) return; }
        
        state.dragStartPos = pos;
        
        if (state.activeTool === 'select') {
            state.groupRotation = 0;
            const handle = hitTest.getHandleAtPosition(pos, state.selectedLayers, state.zoom, state.groupRotation);
    
            if (handle) {
                state.scalingHandle = handle;
                if (handle === 'pivot') { 
                    state.currentAction = 'movingPivot';
                    canvas.style.cursor = 'none'; 
                } else if (handle === 'rotate') {
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
                } else {
                    state.currentAction = 'scaling'; 
                    state.originalBox = geo.getGroupBoundingBox(state.selectedLayers); 
                    state.originalLayers = state.selectedLayers.map(l => JSON.parse(JSON.stringify(l)));
                }
                return;
            }
    
            const clickedLayer = hitTest.getLayerAtPosition(pos, state.layers);
            if (clickedLayer) {
                const isAlreadySelected = state.selectedLayers.some(l => l.id === clickedLayer.id);
    
                if (e.shiftKey) {
                    if (isAlreadySelected) {
                        state.selectedLayers = state.selectedLayers.filter(l => l.id !== clickedLayer.id);
                    } else {
                        state.selectedLayers.push(clickedLayer);
                    }
                } else {
                    if (!isAlreadySelected) {
                        state.selectedLayers = [clickedLayer];
                    }
                    state.currentAction = 'moving';
                }
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
            state.tempLayer = { type: 'path', points: [], color: state.activeColor, lineWidth: state.activeLineWidth, id: Date.now(), rotation: 0, pivot: { x: 0, y: 0 }, lineStyle: state.activeLineStyle };
            const pressure = e.pressure > 0 ? e.pressure : 0.5;
            state.tempLayer.points.push({...pos, pressure });
            state.lastBrushPoint = pos;

            iCtx.lineCap = 'round';
            iCtx.lineJoin = 'round';
            iCtx.strokeStyle = state.activeColor;
            iCtx.fillStyle = state.activeColor;
            
            if (e.pointerType === 'pen') {
                iCtx.save();
                iCtx.translate(state.panX, state.panY);
                iCtx.scale(state.zoom, state.zoom);
                iCtx.beginPath();
                const radius = Math.max(0.5, state.activeLineWidth / 2);
                iCtx.arc(pos.x, pos.y, radius, 0, 2 * Math.PI);
                iCtx.fill();
                iCtx.restore();
            }
        } 
        else if (state.activeTool === 'eraser') {
            state.didErase = false;
            
            if (!document.body.classList.contains('no-animations')) {
                state.lastEraserPos = pos;
                state.eraserTrailNodes = Array(NUM_TRAIL_NODES).fill(null).map(() => ({ ...pos }));
                if (state.eraserAnimationId) {
                    cancelAnimationFrame(state.eraserAnimationId);
                }
                animateEraserTrail();
            }

            const layerToErase = hitTest.getLayerAtPosition(pos, state.layers);
            if (layerToErase) {
                state.layersToErase.add(layerToErase);
                state.didErase = true;
                redrawCallback();
            }
        }
    }

    function draw(e) {
        if (state.isMultiTouching) return;

        const pos = getMousePos(e);
        
        if (state.isPanning) { 
            const dx = e.clientX - state.panStartPos.x; 
            const dy = e.clientY - state.panStartPos.y; 
            state.panX += dx; 
            state.panY += dy; 
            state.panStartPos = { x: e.clientX, y: e.clientY }; 
            redrawCallback(); 
            state.updateFloatingToolbar(); 
            return; 
        }

        if (state.currentAction.startsWith('drawing')) {
            iCtx.clearRect(0, 0, interactionCanvas.width, interactionCanvas.height);
            tools.handleMultiStepDrawing(iCtx, state, pos, e);
            return;
        }

        if (state.isDrawing || state.currentAction !== 'none') {
            if (state.isEditingText && (state.currentAction === 'moving' || state.currentAction === 'scaling')) {
                const textarea = textTool.getEditorTextarea();
                if (textarea) textarea.style.pointerEvents = 'none';
            }
            
            if (!e.altKey) { state.snapPoint = null; }

            switch(state.currentAction) {
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
                    iCtx.clearRect(0, 0, interactionCanvas.width, interactionCanvas.height);
                    iCtx.save();
                    iCtx.translate(state.panX, state.panY);
                    iCtx.scale(state.zoom, state.zoom);
                    iCtx.strokeStyle = 'rgba(0, 122, 255, 0.8)';
                    iCtx.fillStyle = 'rgba(0, 122, 255, 0.1)';
                    iCtx.lineWidth = 1 / state.zoom;
                    iCtx.beginPath();
                    iCtx.rect(state.startPos.x, state.startPos.y, pos.x - state.startPos.x, pos.y - state.startPos.y);
                    iCtx.fill();
                    iCtx.stroke();
                    iCtx.restore();
                    return;
            }

            if (state.isDrawing) {
                if (state.activeTool === 'brush' || state.activeTool === 'smart-brush') {
                    const pressure = e.pressure > 0 ? e.pressure : 0.5;
                    state.tempLayer.points.push({...pos, pressure });

                    iCtx.save();
                    iCtx.translate(state.panX, state.panY);
                    iCtx.scale(state.zoom, state.zoom);
                    iCtx.lineWidth = state.tempLayer.lineWidth;
                    
                    const p1 = state.lastBrushPoint;
                    const p2 = pos;
                    iCtx.beginPath();
                    iCtx.moveTo(p1.x, p1.y);
                    iCtx.lineTo(p2.x, p2.y);
                    iCtx.stroke();
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
                                iCtx.clearRect(0, 0, interactionCanvas.width, interactionCanvas.height);
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
                    }
                    const layerToErase = hitTest.getLayerAtPosition(pos, state.layers);
                    if (layerToErase && !state.layersToErase.has(layerToErase)) {
                        state.layersToErase.add(layerToErase);
                        state.didErase = true;
                        redrawCallback();
                    }
                } else {
                     iCtx.clearRect(0, 0, interactionCanvas.width, interactionCanvas.height);

                    let start = state.startPos;
                    let end = pos;

                    if (e.pointerType === 'touch' && state.mobileShapeState === 'defining_second_point') {
                        const deltaX = pos.x - state.mobileDragAnchor.x;
                        const deltaY = pos.y - state.mobileDragAnchor.y;
                        start = state.mobileFirstPoint;
                        end = {
                            x: state.mobileFirstPoint.x + deltaX,
                            y: state.mobileFirstPoint.y + deltaY,
                        };
                    }
                    
                    if (state.mobileShapeState !== 'defining_first_point') {
                        tools.handleShapeDrawing(iCtx, { ...state, startPos: start }, end, e);
                    }
                }
            }
        } else {
            // Hover logic
            const layerAtPos = hitTest.getLayerAtPosition(pos, state.layers);
            if (state.selectedLayers.length > 0) { 
                const handle = hitTest.getHandleAtPosition(pos, state.selectedLayers, state.zoom, state.groupRotation); 
                updateCursor(handle); 
                if (!handle && hitTest.getLayerAtPosition(pos, state.selectedLayers)) {
                    canvas.style.cursor = 'move'; 
                } 
            } else if (state.activeTool === 'select') { 
                if (layerAtPos && layerAtPos.type === 'text') {
                    canvas.style.cursor = 'text';
                } else {
                    canvas.style.cursor = layerAtPos ? 'pointer' : ''; 
                }
            } else if (state.activeTool === 'pan') {
                canvas.style.cursor = 'grab';
            } else { updateCursor(null); }
        }
    }

    function stopDrawing(e) {
        if (state.isMultiTouching) return;
    
        if (state.currentAction.startsWith('drawing')) {
            return;
        }
    
        const isShapeTool = !['brush', 'smart-brush', 'eraser', 'select', 'pan', 'text'].includes(state.activeTool);
        if (e.pointerType === 'touch' && isShapeTool && state.mobileShapeState !== 'defining_second_point') {
            return;
        }

        const isSettingUpMultiStep = ['parallelogram', 'triangle', 'parallelepiped', 'pyramid', 'truncated-pyramid', 'trapezoid', 'frustum', 'truncated-sphere'].includes(state.activeTool) && state.isDrawing;
        if (isSettingUpMultiStep) {
            state.isDrawing = false; // Stop the dragging phase
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

            const commonProps = { color: state.activeColor, lineWidth: state.activeLineWidth, id: Date.now(), rotation: 0, pivot: { x: 0, y: 0 }, lineStyle: state.activeLineStyle };
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
                    const r = Math.abs(finalEnd.x - finalStart.x) / 2; 
                    const cenX = finalStart.x + (finalEnd.x - finalStart.x) / 2; 
                    const cenY = finalStart.y + (finalEnd.y - finalStart.y)/2; 
                    state.tempLayer = { type: 'truncated-sphere', cx: cenX, cy: cenY, r, cutY: cenY, cutR: r, cutRy: r * 0.3, ...commonProps }; 
                    break;
            }
            return; // IMPORTANT: Keep listening for the next click
        }
        
        document.removeEventListener('pointermove', draw);
        document.removeEventListener('pointerup', stopDrawing);
    
        iCtx.clearRect(0, 0, interactionCanvas.width, interactionCanvas.height);
        
        if (state.isEditingText) {
            const textarea = textTool.getEditorTextarea();
            if (textarea) textarea.style.pointerEvents = 'auto';
        }

        if (state.isEditingText && (state.currentAction === 'moving' || state.currentAction === 'scaling' || state.currentAction === 'rotating' || state.currentAction === 'movingPivot')) {
            saveState(state.layers);
            state.currentAction = 'none';
            state.scalingHandle = null;
            state.originalBox = null;
            state.originalLayers = [];
            return;
        }

        if (state.isEditingText) return;

        clearTimeout(state.shapeRecognitionTimer);
        if (state.eraserAnimationId) {
            cancelAnimationFrame(state.eraserAnimationId);
            state.eraserAnimationId = null;
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

        if (!state.isDrawing && ['rotating', 'scaling', 'movingPivot', 'moving'].includes(state.currentAction)) {
            if (state.currentAction === 'rotating' || state.currentAction === 'scaling' || state.currentAction === 'movingPivot') {
                state.selectedLayers.forEach(utils.applyTransformations);
            }
            saveState(state.layers);
        }
        
        if (state.isDrawing) {
            const rawEnd = getMousePos(e);
            let finalStart = state.startPos;
            let finalEnd = rawEnd;

            if (e.pointerType === 'touch' && state.mobileShapeState === 'defining_second_point') {
                const deltaX = finalEnd.x - state.mobileDragAnchor.x;
                const deltaY = finalEnd.y - state.mobileDragAnchor.y;
                finalStart = state.mobileFirstPoint;
                finalEnd = {
                    x: state.mobileFirstPoint.x + deltaX,
                    y: state.mobileFirstPoint.y + deltaY,
                };
            }
            else if (e.altKey) {
                finalStart = { x: utils.snapToGrid(state.startPos.x), y: utils.snapToGrid(state.startPos.y) };
                finalEnd = { x: utils.snapToGrid(rawEnd.x), y: utils.snapToGrid(rawEnd.y) };
            }
            
            if (state.activeTool === 'line' && e.shiftKey) {
                const dx = finalEnd.x - finalStart.x;
                const dy = finalEnd.y - finalStart.y;
                if (Math.abs(dx) > Math.abs(dy)) { finalEnd.y = finalStart.y; } else { finalEnd.x = finalStart.x; }
            }

            if (state.activeTool === 'brush' || state.activeTool === 'smart-brush') {
                const newLayer = state.tempLayer;
                if (newLayer && newLayer.points.length > 1) {
                    if (state.smoothingAmount > 0) {
                        const tolerance = state.smoothingAmount * 0.5;
                        newLayer.points = utils.simplifyPath(newLayer.points, tolerance);
                    }
                    
                    if (state.activeTool === 'smart-brush' && !state.shapeWasJustRecognized) {
                        const recognizedShape = shapeRecognizer.recognizeShape(newLayer.points);
                        if (recognizedShape) {
                            state.layers.push({ 
                                ...recognizedShape, 
                                color: newLayer.color, 
                                lineWidth: newLayer.lineWidth,
                                lineStyle: newLayer.lineStyle
                            });
                        } else {
                           state.layers.push(newLayer); 
                        }
                    } else {
                        state.layers.push(newLayer);
                    }
                }
                saveState(state.layers);
            } 
            else if (state.activeTool === 'eraser') { 
                if (state.didErase) {
                    const idsToErase = new Set(Array.from(state.layersToErase).map(l => l.id));
                    state.layers = state.layers.filter(layer => !idsToErase.has(layer.id));
                    state.layersToErase.clear();
                    saveState(state.layers);
                }
            } else {
                const commonProps = { color: state.activeColor, lineWidth: state.activeLineWidth, id: Date.now(), rotation: 0, pivot: { x: 0, y: 0 }, lineStyle: state.activeLineStyle };
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
                        state.selectedLayers = [newTextLayer];
                        newTextLayer.isEditing = true;
                        
                        state.isDrawing = true;
                        state.isEditingText = true;
                        
                        textTool.startEditing(state, newTextLayer, (isIntermediate) => {
                            if (isIntermediate) {
                                redrawCallback();
                                state.updateFloatingToolbar();
                                if(state.updateTextEditorTransform) state.updateTextEditorTransform(newTextLayer, state);
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
        
        if (e.pointerType === 'touch') {
            resetMobileShapeState();
        }

        updateCursor(null);
        if (state.currentAction === 'selectionBox') {
            actions.endSelectionBox(state, getMousePos(e), e);
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

    function handleTouchStart(e) {
        if (e.touches.length === 2) {
            e.preventDefault();
            state.isMultiTouching = true;
            state.isDrawing = false;
            state.currentAction = 'none';
            iCtx.clearRect(0, 0, interactionCanvas.width, interactionCanvas.height);

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

    function handleTouchMove(e) {
        if (e.touches.length === 2) {
            e.preventDefault();
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
        }
    }

    function handleTouchEnd(e) {
        if (e.touches.length < 2) {
            state.isMultiTouching = false;
            state.multiTouchState = {};
        }
    }
    
    canvas.addEventListener('pointerdown', startDrawing);
    
    canvas.addEventListener('touchstart', handleTouchStart, { passive: false });
    canvas.addEventListener('touchmove', handleTouchMove, { passive: false });
    canvas.addEventListener('touchend', handleTouchEnd);

    canvas.addEventListener('pointerleave', (e) => { 
        if (state.isPanning) { 
            state.isPanning = false; 
            document.removeEventListener('pointermove', draw);
            document.removeEventListener('pointerup', stopDrawing);
        } 
    });
    
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
    
    state.performZoom = performZoom;
    state.resetMobileShapeState = resetMobileShapeState;

    return state;
}

// --- END OF FILE js/canvas.js ---