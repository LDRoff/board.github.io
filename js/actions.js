// --- START OF FILE js/actions.js ---

import { getBoundingBox, getGroupBoundingBox, rotatePoint } from './geometry.js';
import * as hitTest from './hitTest.js';
import { snapToGrid } from './utils.js';

export function handleMove(state, pos, event) {
    let dx = pos.x - state.dragStartPos.x;
    let dy = pos.y - state.dragStartPos.y;
    
    const shouldSnap = (state.snappingMode === 'manual' && event.altKey) || (state.snappingMode === 'auto' && !event.altKey);
    
    if (shouldSnap) {
        state.snapPoint = null; 
        const SNAP_THRESHOLD = 10 / state.zoom;
        let bestSnapDX = null;
        let bestSnapDY = null;

        const getPointsForBox = (box) => {
            if (!box) return [];
            const { x, y, width, height } = box;
            return [
                { x, y }, { x: x + width / 2, y }, { x: x + width, y },
                { x, y: y + height / 2 }, { x: x + width / 2, y: y + height / 2 }, { x: x + width, y: y + height / 2 },
                { x, y: y + height }, { x: x + width / 2, y: y + height }, { x: x + width, y: y + height }
            ];
        };

        const originalSelectionBox = getGroupBoundingBox(state.originalLayers);
        if (originalSelectionBox) {
            let currentUnsnappedBox = { ...originalSelectionBox };
            currentUnsnappedBox.x += dx;
            currentUnsnappedBox.y += dy;
            const movingPoints = getPointsForBox(currentUnsnappedBox);
            
            const staticLayers = state.layers.filter(l => !state.selectedLayers.some(sl => sl.id === l.id));
            let staticPoints = [];
            staticLayers.forEach(layer => {
                const box = getBoundingBox(layer);
                if (box) staticPoints.push(...getPointsForBox(box));
            });

            for (const movingPoint of movingPoints) {
                for (const staticPoint of staticPoints) {
                    const snapDX = staticPoint.x - movingPoint.x;
                    const snapDY = staticPoint.y - movingPoint.y;

                    if (Math.abs(snapDX) < SNAP_THRESHOLD) {
                        if (bestSnapDX === null || Math.abs(snapDX) < Math.abs(bestSnapDX)) {
                            bestSnapDX = snapDX;
                        }
                    }
                    if (Math.abs(snapDY) < SNAP_THRESHOLD) {
                        if (bestSnapDY === null || Math.abs(snapDY) < Math.abs(bestSnapDY)) {
                            bestSnapDY = snapDY;
                        }
                    }
                }
            }
            
            const gridPoints = movingPoints;
            for(const gridPoint of gridPoints) {
                const snappedX = snapToGrid(gridPoint.x);
                const diffX = snappedX - gridPoint.x;
                if (Math.abs(diffX) < SNAP_THRESHOLD) {
                    if (bestSnapDX === null || Math.abs(diffX) < Math.abs(bestSnapDX)) {
                        bestSnapDX = diffX;
                    }
                }
                const snappedY = snapToGrid(gridPoint.y);
                const diffY = snappedY - gridPoint.y;
                 if (Math.abs(diffY) < SNAP_THRESHOLD) {
                    if (bestSnapDY === null || Math.abs(diffY) < Math.abs(bestSnapDY)) {
                        bestSnapDY = diffY;
                    }
                }
            }
            
            if (bestSnapDX !== null) dx += bestSnapDX;
            if (bestSnapDY !== null) dy += bestSnapDY;
        }
    } else {
        state.snapPoint = null; 
    }

    state.selectedLayers.forEach((layer, index) => {
        const originalLayer = state.originalLayers[index];

        if (layer.type === 'path') {
            const step = layer.hasPressure ? 3 : 2;
            for (let i = 0; i < layer.points.length; i += step) {
                layer.points[i] = originalLayer.points[i] + dx;
                layer.points[i+1] = originalLayer.points[i+1] + dy;
            }
        }
        else if (['rect', 'image', 'text', 'pdf'].includes(layer.type)) { 
            layer.x = originalLayer.x + dx; 
            layer.y = originalLayer.y + dy; 
        }
        else if (layer.type === 'parallelogram') { 
            layer.x = originalLayer.x + dx; 
            layer.y = originalLayer.y + dy; 
        }
        else if (layer.type === 'parallelepiped') { 
            layer.x = originalLayer.x + dx; 
            layer.y = originalLayer.y + dy; 
        }
        else if (layer.type === 'cone') { 
            layer.cx = originalLayer.cx + dx; 
            layer.baseY = originalLayer.baseY + dy; 
            if (layer.apex) { 
                layer.apex.x = originalLayer.apex.x + dx; 
                layer.apex.y = originalLayer.apex.y + dy; 
            } 
        }
        else if (layer.type === 'frustum') { 
            layer.cx = originalLayer.cx + dx; 
            layer.baseY = originalLayer.baseY + dy; 
            layer.topY = originalLayer.topY + dy; 
        }
        else if (['sphere', 'ellipse', 'truncated-sphere'].includes(layer.type)) { 
            layer.cx = originalLayer.cx + dx; 
            layer.cy = originalLayer.cy + dy; 
            if (layer.cutY !== undefined) {
                layer.cutY = originalLayer.cutY + dy;
            }
        }
        else if (layer.type === 'triangle') { 
            layer.p1.x = originalLayer.p1.x + dx; layer.p1.y = originalLayer.p1.y + dy; 
            layer.p2.x = originalLayer.p2.x + dx; layer.p2.y = originalLayer.p2.y + dy; 
            layer.p3.x = originalLayer.p3.x + dx; layer.p3.y = originalLayer.p3.y + dy; 
        }
        else if (['trapezoid', 'rhombus'].includes(layer.type)) { 
            layer.p1.x = originalLayer.p1.x + dx; layer.p1.y = originalLayer.p1.y + dy; 
            layer.p2.x = originalLayer.p2.x + dx; layer.p2.y = originalLayer.p2.y + dy; 
            layer.p3.x = originalLayer.p3.x + dx; layer.p3.y = originalLayer.p3.y + dy; 
            layer.p4.x = originalLayer.p4.x + dx; layer.p4.y = originalLayer.p4.y + dy; 
        }
        else if (layer.type === 'curve') { 
            layer.nodes.forEach((node, i) => { 
                const originalNode = originalLayer.nodes[i];
                node.p.x = originalNode.p.x + dx;
                node.p.y = originalNode.p.y + dy;
                if(node.h1) {
                    node.h1.x = originalNode.h1.x + dx;
                    node.h1.y = originalNode.h1.y + dy;
                }
                 if(node.h2) {
                    node.h2.x = originalNode.h2.x + dx;
                    node.h2.y = originalNode.h2.y + dy;
                }
            }); 
        }
        else if (layer.type === 'line') { 
            layer.x1 = originalLayer.x1 + dx; layer.y1 = originalLayer.y1 + dy; 
            layer.x2 = originalLayer.x2 + dx; layer.y2 = originalLayer.y2 + dy; 
        }
        else if (['pyramid', 'truncated-pyramid'].includes(layer.type)) {
            if (layer.apex) { 
                layer.apex.x = originalLayer.apex.x + dx; 
                layer.apex.y = originalLayer.apex.y + dy; 
            }
            Object.keys(layer.base).forEach(key => {
                layer.base[key].x = originalLayer.base[key].x + dx;
                layer.base[key].y = originalLayer.base[key].y + dy;
            });
            if (layer.top) {
                Object.keys(layer.top).forEach(key => {
                    layer.top[key].x = originalLayer.top[key].x + dx;
                    layer.top[key].y = originalLayer.top[key].y + dy;
                });
            }
        }
    });
}

export function handleScale(state, pos, event) {
    const shouldSnap = (state.snappingMode === 'manual' && event.altKey) || (state.snappingMode === 'auto' && !event.altKey);
    let finalPos = pos;
    if (shouldSnap) {
        const SNAP_THRESHOLD = 10 / state.zoom;
        const snappedX = snapToGrid(pos.x);
        const snappedY = snapToGrid(pos.y);
        
        const finalX = (Math.abs(snappedX - pos.x) < SNAP_THRESHOLD) ? snappedX : pos.x;
        const finalY = (Math.abs(snappedY - pos.y) < SNAP_THRESHOLD) ? snappedY : pos.y;
        finalPos = { x: finalX, y: finalY };
    }
    
    const oBox = state.originalBox;
    if (!oBox) return;

    const handle = state.scalingHandle;
    const rotation = hitTest.getSelectionRotation(state.selectedLayers, state.groupRotation);
    const pivot = { x: oBox.x + oBox.width / 2, y: oBox.y + oBox.height / 2 };
    
    const localPos = rotatePoint(finalPos, pivot, -rotation);

    let newLeft = oBox.x, newTop = oBox.y, newRight = oBox.x + oBox.width, newBottom = oBox.y + oBox.height;
    
    switch (handle) {
        case 'topLeft': newLeft = localPos.x; newTop = localPos.y; break;
        case 'topRight': newRight = localPos.x; newTop = localPos.y; break;
        case 'bottomLeft': newLeft = localPos.x; newBottom = localPos.y; break;
        case 'bottomRight': newRight = localPos.x; newBottom = localPos.y; break;
        case 'top': newTop = localPos.y; break;
        case 'bottom': newBottom = localPos.y; break;
        case 'left': newLeft = localPos.x; break;
        case 'right': newRight = localPos.x; break;
    }

    if (event.shiftKey && oBox.width > 0 && oBox.height > 0) {
        const aspect = oBox.width / oBox.height;
        let newW = Math.abs(newRight - newLeft);
        let newH = Math.abs(newBottom - newTop);

        if (['left', 'right'].includes(handle)) {
            newH = newW / aspect;
            newTop = pivot.y - newH / 2;
            newBottom = pivot.y + newH / 2;
        } else if (['top', 'bottom'].includes(handle)) {
            newW = newH * aspect;
            newLeft = pivot.x - newW / 2;
            newRight = pivot.x + newW / 2;
        } else {
            const ratioW = newW / oBox.width;
            const ratioH = newH / oBox.height;
            if (ratioW > ratioH) { newH = newW / aspect; } 
            else { newW = newH * aspect; }

            if (handle.includes('left')) newLeft = newRight - newW; else newRight = newLeft + newW;
            if (handle.includes('top')) newTop = newBottom - newH; else newBottom = newTop + newH;
        }
    }

    const nX = Math.min(newLeft, newRight);
    const nY = Math.min(newTop, newBottom);
    let nW = Math.abs(newLeft - newRight);
    let nH = Math.abs(newTop - newBottom);
    if (nW < 1) nW = 1; if (nH < 1) nH = 1;

    const oldLocalCenter = { x: oBox.x + oBox.width / 2, y: oBox.y + oBox.height / 2 };
    const newLocalCenter = { x: nX + nW / 2, y: nY + nH / 2 };
    const centerShiftLocal = { x: newLocalCenter.x - oldLocalCenter.x, y: newLocalCenter.y - oldLocalCenter.y };
    const centerShiftWorld = rotatePoint(centerShiftLocal, { x: 0, y: 0 }, rotation);

    const newWorldCenter = { x: pivot.x + centerShiftWorld.x, y: pivot.y + centerShiftWorld.y };
    const finalBoxTopLeft = { x: newWorldCenter.x - nW / 2, y: newWorldCenter.y - nH / 2 };

    const scaleX = oBox.width > 0 ? nW / oBox.width : 1;
    const scaleY = oBox.height > 0 ? nH / oBox.height : 1;
    
    state.selectedLayers.forEach((layer, index) => {
        const originalLayer = state.originalLayers[index];
        const originalRx = originalLayer.rx ?? originalLayer.r;
        const originalRy = originalLayer.ry ?? originalLayer.r;
        const newLayerProps = {
            x: finalBoxTopLeft.x + (originalLayer.x - oBox.x) * scaleX,
            y: finalBoxTopLeft.y + (originalLayer.y - oBox.y) * scaleY,
            width: originalLayer.width * scaleX,
            height: originalLayer.height * scaleY,
            cx: finalBoxTopLeft.x + (originalLayer.cx - oBox.x) * scaleX,
            cy: finalBoxTopLeft.y + (originalLayer.cy - oBox.y) * scaleY,
            rx: originalRx * scaleX,
            ry: originalRy * scaleY,
        };

        if (['rect', 'image', 'text', 'pdf'].includes(layer.type)) { 
            Object.assign(layer, { x: newLayerProps.x, y: newLayerProps.y, width: newLayerProps.width, height: newLayerProps.height });
        }
        else if (layer.type === 'parallelogram') { Object.assign(layer, { x: newLayerProps.x, y: newLayerProps.y, width: newLayerProps.width, height: newLayerProps.height, slantOffset: originalLayer.slantOffset * scaleX }); }
        else if (layer.type === 'parallelepiped') { Object.assign(layer, { x: newLayerProps.x, y: newLayerProps.y, width: newLayerProps.width, height: newLayerProps.height, depthOffset: { x: originalLayer.depthOffset.x * scaleX, y: originalLayer.depthOffset.y * scaleY } }); }
        else if (layer.type === 'cone') { layer.baseY = finalBoxTopLeft.y + (originalLayer.baseY - oBox.y) * scaleY; layer.apex.y = finalBoxTopLeft.y + (originalLayer.apex.y - oBox.y) * scaleY; layer.cx = newLayerProps.cx; layer.apex.x = newLayerProps.cx; layer.rx = newLayerProps.rx; layer.ry = newLayerProps.ry; }
        else if (layer.type === 'frustum') { layer.baseY = finalBoxTopLeft.y + (originalLayer.baseY - oBox.y) * scaleY; layer.topY = finalBoxTopLeft.y + (originalLayer.topY - oBox.y) * scaleY; layer.cx = newLayerProps.cx; layer.rx1 = originalLayer.rx1 * scaleX; layer.ry1 = originalLayer.ry1 * scaleY; layer.rx2 = originalLayer.rx2 * scaleX; layer.ry2 = originalLayer.ry2 * scaleY; }
        else if (layer.type === 'sphere') { 
            Object.assign(layer, { cx: newLayerProps.cx, cy: newLayerProps.cy, rx: newLayerProps.rx, ry: newLayerProps.ry });
            delete layer.r;
        }
        else if (layer.type === 'ellipse') { Object.assign(layer, { cx: newLayerProps.cx, cy: newLayerProps.cy, rx: newLayerProps.rx, ry: newLayerProps.ry }); }
        else if (layer.type === 'truncated-sphere') {
            const scaledLayer = {
                cx: newLayerProps.cx,
                cy: newLayerProps.cy,
                rx: newLayerProps.rx,
                ry: newLayerProps.ry,
                cutY: finalBoxTopLeft.y + (originalLayer.cutY - oBox.y) * scaleY,
            };

            const h = Math.abs(scaledLayer.cutY - scaledLayer.cy);
            if (h >= scaledLayer.ry) {
                scaledLayer.cutR = 0;
                scaledLayer.cutRy = 0;
            } else {
                const ratioY = h / scaledLayer.ry;
                scaledLayer.cutR = scaledLayer.rx * Math.sqrt(1 - (ratioY * ratioY));
                scaledLayer.cutRy = scaledLayer.cutR * 0.3;
            }

            Object.assign(layer, scaledLayer);
            delete layer.r;
        }
        else if (['triangle', 'trapezoid', 'rhombus'].includes(layer.type)) {
            ['p1', 'p2', 'p3', 'p4'].forEach(p => { if(layer[p]) { layer[p] = { x: finalBoxTopLeft.x + (originalLayer[p].x - oBox.x) * scaleX, y: finalBoxTopLeft.y + (originalLayer[p].y - oBox.y) * scaleY }; } });
        }
        // --- НАЧАЛО ИЗМЕНЕНИЙ: Исправляем масштабирование для path ---
        else if (layer.type === 'path') {
            const newPoints = [];
            const step = originalLayer.hasPressure ? 3 : 2;
            for (let i = 0; i < originalLayer.points.length; i += step) {
                const originalX = originalLayer.points[i];
                const originalY = originalLayer.points[i + 1];

                const newX = finalBoxTopLeft.x + (originalX - oBox.x) * scaleX;
                const newY = finalBoxTopLeft.y + (originalY - oBox.y) * scaleY;
                
                newPoints.push(newX, newY);
                
                if (originalLayer.hasPressure) {
                    newPoints.push(originalLayer.points[i + 2]);
                }
            }
            layer.points = newPoints;
        }
        // --- КОНЕЦ ИЗМЕНЕНИЙ ---
        else if (layer.type === 'curve') { layer.nodes = originalLayer.nodes.map(node => ({ p: { x: finalBoxTopLeft.x + (node.p.x - oBox.x) * scaleX, y: finalBoxTopLeft.y + (node.p.y - oBox.y) * scaleY }, h1: node.h1 ? { x: finalBoxTopLeft.x + (node.h1.x - oBox.x) * scaleX, y: finalBoxTopLeft.y + (node.h1.y - oBox.y) * scaleY } : null, h2: node.h2 ? { x: finalBoxTopLeft.x + (node.h2.x - oBox.x) * scaleX, y: finalBoxTopLeft.y + (node.h2.y - oBox.y) * scaleY } : null, type: node.type })); }
        else if (layer.type === 'line') { layer.x1 = finalBoxTopLeft.x + (originalLayer.x1 - oBox.x) * scaleX; layer.y1 = finalBoxTopLeft.y + (originalLayer.y1 - oBox.y) * scaleY; layer.x2 = finalBoxTopLeft.x + (originalLayer.x2 - oBox.x) * scaleX; layer.y2 = finalBoxTopLeft.y + (originalLayer.y2 - oBox.y) * scaleY; }
        else if (['pyramid', 'truncated-pyramid'].includes(layer.type)) {
            if (layer.apex) { layer.apex = { x: finalBoxTopLeft.x + (originalLayer.apex.x - oBox.x) * scaleX, y: finalBoxTopLeft.y + (originalLayer.apex.y - oBox.y) * scaleY }; }
            ['base', 'top'].forEach(part => { if(layer[part]) { Object.keys(layer[part]).forEach(p => { layer[part][p] = { x: finalBoxTopLeft.x + (originalLayer[part][p].x - oBox.x) * scaleX, y: finalBoxTopLeft.y + (originalLayer[part][p].y - oBox.y) * scaleY }; }); } });
        }
    });
}

export function handleRotate(state, pos, event) {
    const currentAngle = Math.atan2(pos.y - state.groupPivot.y, pos.x - state.groupPivot.x);
    let deltaAngle = currentAngle - state.rotationStartAngle;

    if (event.shiftKey) {
        const snapAngle = 15 * (Math.PI / 180);
        deltaAngle = Math.round(deltaAngle / snapAngle) * snapAngle;
    }
    
    if (state.selectedLayers.length > 1) {
        state.groupRotation = deltaAngle;
    } 
    else if (state.selectedLayers.length === 1) {
        const layer = state.selectedLayers[0];
        const originalLayer = state.originalLayers[0];
        layer.rotation = (originalLayer.rotation || 0) + deltaAngle;
    }
}

export function handleMovePivot(state, pos) {
    if (state.selectedLayers.length !== 1) return;

    const layer = state.selectedLayers[0];
    const originalLayer = state.originalLayers[0];
    const rotation = layer.rotation || 0;

    const originalBox = getBoundingBox(originalLayer);
    if (!originalBox) return;

    const originalCenterX = originalBox.x + originalBox.width / 2;
    const originalCenterY = originalBox.y + originalBox.height / 2;

    const oldPivotWorld = {
        x: originalCenterX + (originalLayer.pivot?.x || 0),
        y: originalCenterY + (originalLayer.pivot?.y || 0),
    };

    const newPivotWorld = { x: pos.x, y: pos.y };

    const pivotDisplacement = {
        x: newPivotWorld.x - oldPivotWorld.x,
        y: newPivotWorld.y - oldPivotWorld.y,
    };

    const cosA = Math.cos(-rotation);
    const sinA = Math.sin(-rotation);

    const rotatedDx = pivotDisplacement.x * cosA - pivotDisplacement.y * sinA;
    const rotatedDy = pivotDisplacement.x * sinA + pivotDisplacement.y * cosA;

    const dx = pivotDisplacement.x - rotatedDx;
    const dy = pivotDisplacement.y - rotatedDy;

    const applyOffset = (p, d) => ({ x: p.x + d.x, y: p.y + d.y });

    if (['rect', 'image', 'text', 'pdf', 'parallelogram', 'parallelepiped'].includes(layer.type)) {
        layer.x = originalLayer.x + dx;
        layer.y = originalLayer.y + dy;
    } else if (['triangle', 'trapezoid', 'rhombus'].includes(layer.type)) {
        ['p1', 'p2', 'p3', 'p4'].forEach(key => {
            if (layer[key]) layer[key] = applyOffset(originalLayer[key], { x: dx, y: dy });
        });
    } else if (['cone', 'frustum', 'sphere', 'ellipse', 'truncated-sphere'].includes(layer.type)) {
        layer.cx = originalLayer.cx + dx;
        layer.cy = (originalLayer.cy !== undefined) ? originalLayer.cy + dy : undefined;
        if (layer.baseY !== undefined) layer.baseY = originalLayer.baseY + dy;
        if (layer.topY !== undefined) layer.topY = originalLayer.topY + dy;
        if (layer.cutY !== undefined) layer.cutY = originalLayer.cutY + dy;
        if (layer.apex) layer.apex = applyOffset(originalLayer.apex, { x: dx, y: dy });
    } else if (layer.type === 'path') {
        const step = layer.hasPressure ? 3 : 2;
        for (let i = 0; i < layer.points.length; i += step) {
            layer.points[i] = originalLayer.points[i] + dx;
            layer.points[i + 1] = originalLayer.points[i + 1] + dy;
        }
    } else if (layer.type === 'curve') {
        layer.nodes.forEach((node, i) => {
            const originalNode = originalLayer.nodes[i];
            node.p = applyOffset(originalNode.p, { x: dx, y: dy });
            if (node.h1) node.h1 = applyOffset(originalNode.h1, { x: dx, y: dy });
            if (node.h2) node.h2 = applyOffset(originalNode.h2, { x: dx, y: dy });
        });
    } else if (layer.type === 'line') {
        layer.x1 = originalLayer.x1 + dx; layer.y1 = originalLayer.y1 + dy;
        layer.x2 = originalLayer.x2 + dx; layer.y2 = originalLayer.y2 + dy;
    } else if (['pyramid', 'truncated-pyramid'].includes(layer.type)) {
        if (layer.apex) layer.apex = applyOffset(originalLayer.apex, { x: dx, y: dy });
        ['base', 'top'].forEach(part => {
            if (layer[part]) {
                Object.keys(layer[part]).forEach(key => {
                    layer[part][key] = applyOffset(originalLayer[part][key], { x: dx, y: dy });
                });
            }
        });
    }

    const newCenterX = originalCenterX + dx;
    const newCenterY = originalCenterY + dy;

    layer.pivot = {
        x: newPivotWorld.x - newCenterX,
        y: newPivotWorld.y - newCenterY,
    };
}


export function handleEditCurve(state, pos, event) {
    const handleInfo = state.scalingHandle;
    if (!handleInfo) return;

    let finalPos = { ...pos };
    const shouldSnap = (state.snappingMode === 'manual' && event.altKey) || (state.snappingMode === 'auto' && !event.altKey);
    if (shouldSnap) {
        const SNAP_THRESHOLD = 10 / state.zoom;
        const snappedX = snapToGrid(pos.x);
        const snappedY = snapToGrid(pos.y);
        
        finalPos.x = (Math.abs(snappedX - pos.x) < SNAP_THRESHOLD) ? snappedX : pos.x;
        finalPos.y = (Math.abs(snappedY - pos.y) < SNAP_THRESHOLD) ? snappedY : pos.y;
    }

    const layer = state.selectedLayers[0];
    const originalLayer = state.originalLayers[0];
    const node = layer.nodes[handleInfo.nodeIndex];
    const originalNode = originalLayer.nodes[handleInfo.nodeIndex];

    const dx = finalPos.x - state.dragStartPos.x;
    const dy = finalPos.y - state.dragStartPos.y;

    if (handleInfo.type === 'curveNode') {
        node.p.x = originalNode.p.x + dx;
        node.p.y = originalNode.p.y + dy;
        if (node.h1) {
            node.h1.x = originalNode.h1.x + dx;
            node.h1.y = originalNode.h1.y + dy;
        }
        if (node.h2) {
            node.h2.x = originalNode.h2.x + dx;
            node.h2.y = originalNode.h2.y + dy;
        }
    } else if (handleInfo.type === 'curveHandle') {
        const handleKey = handleInfo.pointType;
        const otherHandleKey = handleKey === 'h1' ? 'h2' : 'h1';

        node[handleKey].x = originalNode[handleKey].x + dx;
        node[handleKey].y = originalNode[handleKey].y + dy;
        
        if (node.type === 'smooth' && node[otherHandleKey]) {
            const vx = node.p.x - node[handleKey].x;
            const vy = node.p.y - node[handleKey].y;
            const originalDist = Math.hypot(originalNode[otherHandleKey].x - originalNode.p.x, originalNode[otherHandleKey].y - originalNode.p.y);
            const currentDist = Math.hypot(vx, vy);
            
            if (currentDist > 0) {
                const newX = node.p.x + (vx / currentDist) * originalDist;
                const newY = node.p.y + (vy / currentDist) * originalDist;
                node[otherHandleKey].x = newX;
                node[otherHandleKey].y = newY;
            }
        }
    }
}

export function startSelectionBox(state, pos) {
    state.startPos = pos;
    state.selectionBox = { x: pos.x, y: pos.y, width: 0, height: 0 };
}

export function updateSelectionBox(state, pos) {
    if (!state.selectionBox) return;
    state.selectionBox.width = pos.x - state.startPos.x;
    state.selectionBox.height = pos.y - state.startPos.y;
}

export function endSelectionBox(state, pos, event) {
    const selBox = {
        x: Math.min(pos.x, state.startPos.x),
        y: Math.min(pos.y, state.startPos.y),
        width: Math.abs(pos.x - state.startPos.x),
        height: Math.abs(pos.y - state.startPos.y)
    };

    const layersInBox = state.layers.filter(layer => hitTest.layerInRect(layer, selBox));

    if (event.ctrlKey || event.metaKey) {
        const idsToDeselect = new Set(layersInBox.map(l => l.id));
        state.selectedLayers = state.selectedLayers.filter(layer => !idsToDeselect.has(layer.id));
    } else if (event.shiftKey) {
        const existingIds = new Set(state.selectedLayers.map(l => l.id));
        layersInBox.forEach(layer => {
            if (!existingIds.has(layer.id)) {
                state.selectedLayers.push(layer);
            }
        });
    } else {
        state.selectedLayers = layersInBox;
    }
}
// --- END OF FILE js/actions.js ---