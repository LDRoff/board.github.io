// --- START OF FILE js/actions.js ---

import * as geo from './geometry.js';
import * as hitTest from './hitTest.js';
import { snapToGrid } from './utils.js';

export function handleMove(state, pos, event) {
    let dx = pos.x - state.dragStartPos.x;
    let dy = pos.y - state.dragStartPos.y;
    
    if (event.altKey) {
        state.snapPoint = null; 
        const SNAP_THRESHOLD = 10 / state.zoom;

        const getPointsForBox = (box) => {
            if (!box) return [];
            const { x, y, width, height } = box;
            return [
                { x, y }, { x: x + width / 2, y }, { x: x + width, y },
                { x, y: y + height / 2 }, { x: x + width / 2, y: y + height / 2 }, { x: x + width, y: y + height / 2 },
                { x, y: y + height }, { x: x + width / 2, y: y + height }, { x: x + width, y: y + height }
            ];
        };

        const movingSelectionBox = geo.getGroupBoundingBox(state.selectedLayers);
        if (movingSelectionBox) {
            let currentMovingBox = { ...movingSelectionBox };
            currentMovingBox.x += dx;
            currentMovingBox.y += dy;
            const movingPoints = getPointsForBox(currentMovingBox);

            const staticLayers = state.layers.filter(l => !state.selectedLayers.some(sl => sl.id === l.id));
            let staticPoints = [];
            staticLayers.forEach(layer => {
                const box = geo.getBoundingBox(layer);
                if (box) staticPoints.push(...getPointsForBox(box));
            });

            let snapDX = 0;
            let snapDY = 0;
            let objectSnapped = false;

            for (const movingPoint of movingPoints) {
                for (const staticPoint of staticPoints) {
                    const diffX = Math.abs(movingPoint.x - staticPoint.x);
                    const diffY = Math.abs(movingPoint.y - staticPoint.y);

                    if (diffX < SNAP_THRESHOLD && snapDX === 0) {
                       snapDX = staticPoint.x - movingPoint.x;
                       state.snapPoint = { x: staticPoint.x, y: movingPoint.y + snapDY };
                       objectSnapped = true;
                    }
                    if (diffY < SNAP_THRESHOLD && snapDY === 0) {
                       snapDY = staticPoint.y - movingPoint.y;
                       state.snapPoint = { x: (state.snapPoint?.x || movingPoint.x) + snapDX, y: staticPoint.y };
                       objectSnapped = true;
                    }
                }
            }
            
            if (!objectSnapped) {
                const snappedX = snapToGrid(currentMovingBox.x);
                const snappedY = snapToGrid(currentMovingBox.y);
                const diffX = snappedX - currentMovingBox.x;
                const diffY = snappedY - currentMovingBox.y;

                if (Math.abs(diffX) < SNAP_THRESHOLD) {
                    snapDX = diffX;
                    state.snapPoint = { x: snappedX, y: currentMovingBox.y };
                }
                if (Math.abs(diffY) < SNAP_THRESHOLD) {
                    snapDY = diffY;
                    state.snapPoint = { x: state.snapPoint ? state.snapPoint.x : currentMovingBox.x, y: snappedY };
                }
            }

            dx += snapDX;
            dy += snapDY;
        }
    }
    
    state.selectedLayers.forEach(layer => {
        // --- НАЧАЛО ИЗМЕНЕНИЙ: Добавляем 'pdf' в список перемещаемых объектов ---
        if (['rect', 'image', 'text', 'pdf', 'parallelogram', 'parallelepiped'].includes(layer.type)) {
            layer.x = (layer.x || 0) + dx;
            layer.y = (layer.y || 0) + dy;
        } else if (['triangle', 'trapezoid', 'rhombus'].includes(layer.type)) {
            layer.p1.x += dx; layer.p1.y += dy;
            layer.p2.x += dx; layer.p2.y += dy;
            layer.p3.x += dx; layer.p3.y += dy;
            if (layer.p4) { layer.p4.x += dx; layer.p4.y += dy; }
        }
        // --- КОНЕЦ ИЗМЕНЕНИЙ ---
        else if (layer.type === 'cone' || layer.type === 'frustum') { layer.cx += dx; layer.baseY += dy; if(layer.apex){layer.apex.x += dx; layer.apex.y += dy;} if(layer.topY){layer.topY += dy;} }
        else if (layer.type === 'sphere' || layer.type === 'ellipse' || layer.type === 'truncated-sphere') { layer.cx += dx; layer.cy += dy; if(layer.cutY) layer.cutY += dy; }
        else if (layer.type === 'path') { layer.points.forEach(p => { p.x += dx; p.y += dy; }); }
        else if (layer.type === 'line') { layer.x1 += dx; layer.y1 += dy; layer.x2 += dx; layer.y2 += dy; }
        else if (layer.type === 'pyramid' || layer.type === 'truncated-pyramid') {
            if (layer.apex) { layer.apex.x += dx; layer.apex.y += dy; }
            layer.base.p1.x += dx; layer.base.p1.y += dy;
            layer.base.p2.x += dx; layer.base.p2.y += dy;
            layer.base.p3.x += dx; layer.base.p3.y += dy;
            layer.base.p4.x += dx; layer.base.p4.y += dy;
             if (layer.top) {
                layer.top.p1.x += dx; layer.top.p1.y += dy;
                layer.top.p2.x += dx; layer.top.p2.y += dy;
                layer.top.p3.x += dx; layer.top.p3.y += dy;
                layer.top.p4.x += dx; layer.top.p4.y += dy;
            }
        }
    });
    state.dragStartPos = { x: state.dragStartPos.x + dx, y: state.dragStartPos.y + dy };
}

export function handleScale(state, pos, event) {
    if (event.altKey) {
        pos = { x: snapToGrid(pos.x), y: snapToGrid(pos.y) };
    }
    
    const oBox = state.originalBox;
    let nX = oBox.x, nY = oBox.y, nW = oBox.width, nH = oBox.height;

    const rotation = hitTest.getSelectionRotation(state.selectedLayers, state.groupRotation);
    const world_dx = pos.x - state.dragStartPos.x;
    const world_dy = pos.y - state.dragStartPos.y;

    const dx = world_dx * Math.cos(-rotation) - world_dy * Math.sin(-rotation);
    const dy = world_dx * Math.sin(-rotation) + world_dy * Math.cos(-rotation);

    switch (state.scalingHandle) {
        case 'top': nY = oBox.y + dy; nH = oBox.height - dy; break;
        case 'bottom': nH = oBox.height + dy; break;
        case 'left': nX = oBox.x + dx; nW = oBox.width - dx; break;
        case 'right': nW = oBox.width + dx; break;
        case 'topLeft': nX = oBox.x + dx; nY = oBox.y + dy; nW = oBox.width - dx; nH = oBox.height - dy; break;
        case 'topRight': nY = oBox.y + dy; nW = oBox.width + dx; nH = oBox.height - dy; break;
        case 'bottomLeft': nX = oBox.x + dx; nW = oBox.width - dx; nH = oBox.height + dy; break;
        case 'bottomRight': nW = oBox.width + dx; nH = oBox.height + dy; break;
    }

    if (event.shiftKey) {
        const aspectRatio = oBox.height !== 0 ? oBox.width / oBox.height : 1;
        const relWidthChange = Math.abs(nW - oBox.width) / (oBox.width || 1);
        const relHeightChange = Math.abs(nH - oBox.height) / (oBox.height || 1);

        if (relWidthChange > relHeightChange) {
            const newHeight = nW / aspectRatio;
            if (state.scalingHandle.includes('top')) {
                nY += nH - newHeight;
            }
            nH = newHeight;
        } else {
            const newWidth = nH * aspectRatio;
            if (state.scalingHandle.includes('left')) {
                nX += nW - newWidth;
            }
            nW = newWidth;
        }
    }
    
    if (nW < 1) nW = 1; if (nH < 1) nH = 1;
    const scaleX = oBox.width > 0 ? nW / oBox.width : 1;
    const scaleY = oBox.height > 0 ? nH / oBox.height : 1;
    state.selectedLayers.forEach((layer, index) => {
        const originalLayer = state.originalLayers[index];
        // --- НАЧАЛО ИЗМЕНЕНИЙ: Добавляем 'pdf' в логику масштабирования ---
        if (['rect', 'image', 'text', 'pdf'].includes(layer.type)) { 
            layer.x = nX + (originalLayer.x - oBox.x) * scaleX; 
            layer.y = nY + (originalLayer.y - oBox.y) * scaleY; 
            layer.width = originalLayer.width * scaleX; 
            layer.height = originalLayer.height * scaleY; 
        }
        // --- КОНЕЦ ИЗМЕНЕНИЙ ---
        else if (layer.type === 'parallelogram') { layer.x = nX + (originalLayer.x - oBox.x) * scaleX; layer.y = nY + (originalLayer.y - oBox.y) * scaleY; layer.width = originalLayer.width * scaleX; layer.height = originalLayer.height * scaleY; layer.slantOffset = originalLayer.slantOffset * scaleX; }
        else if (layer.type === 'parallelepiped') { layer.x = nX + (originalLayer.x - oBox.x) * scaleX; layer.y = nY + (originalLayer.y - oBox.y) * scaleY; layer.width = originalLayer.width * scaleX; layer.height = originalLayer.height * scaleY; layer.depthOffset.x = originalLayer.depthOffset.x * scaleX; layer.depthOffset.y = originalLayer.depthOffset.y * scaleY; }
        else if (layer.type === 'cone') { layer.cx = nX + (originalLayer.cx - oBox.x) * scaleX; layer.baseY = nY + (originalLayer.baseY - oBox.y) * scaleY; layer.rx = originalLayer.rx * scaleX; layer.ry = originalLayer.ry * scaleY; layer.apex.x = nX + (originalLayer.apex.x - oBox.x) * scaleX; layer.apex.y = nY + (originalLayer.apex.y - oBox.y) * scaleY; }
        else if (layer.type === 'frustum') { layer.cx = nX + (originalLayer.cx - oBox.x) * scaleX; layer.baseY = nY + (originalLayer.baseY - oBox.y) * scaleY; layer.topY = nY + (originalLayer.topY - oBox.y) * scaleY; layer.rx1 = originalLayer.rx1 * scaleX; layer.ry1 = originalLayer.ry1 * scaleY; layer.rx2 = originalLayer.rx2 * scaleX; layer.ry2 = originalLayer.ry2 * scaleY; }
        else if (layer.type === 'pyramid' || layer.type === 'truncated-pyramid') {
            const scalePoint = p => ({ x: nX + (p.x - oBox.x) * scaleX, y: nY + (p.y - oBox.y) * scaleY });
            if(layer.apex) layer.apex = scalePoint(originalLayer.apex);
            layer.base.p1 = scalePoint(originalLayer.base.p1);
            layer.base.p2 = scalePoint(originalLayer.base.p2);
            layer.base.p3 = scalePoint(originalLayer.base.p3);
            layer.base.p4 = scalePoint(originalLayer.base.p4);
            if(layer.top) {
                layer.top.p1 = scalePoint(originalLayer.top.p1);
                layer.top.p2 = scalePoint(originalLayer.top.p2);
                layer.top.p3 = scalePoint(originalLayer.top.p3);
                layer.top.p4 = scalePoint(originalLayer.top.p4);
            }
        }
        else if (['triangle', 'trapezoid', 'rhombus'].includes(layer.type)) { layer.p1.x = nX + (originalLayer.p1.x - oBox.x) * scaleX; layer.p1.y = nY + (originalLayer.p1.y - oBox.y) * scaleY; layer.p2.x = nX + (originalLayer.p2.x - oBox.x) * scaleX; layer.p2.y = nY + (originalLayer.p2.y - oBox.y) * scaleY; layer.p3.x = nX + (originalLayer.p3.x - oBox.x) * scaleX; layer.p3.y = nY + (originalLayer.p3.y - oBox.y) * scaleY; if(layer.p4) { layer.p4.x = nX + (originalLayer.p4.x - oBox.x) * scaleX; layer.p4.y = nY + (originalLayer.p4.y - oBox.y) * scaleY;} }
        else if (layer.type === 'ellipse') { layer.cx = nX + (originalLayer.cx - oBox.x) * scaleX; layer.cy = nY + (originalLayer.cy - oBox.y) * scaleY; layer.rx = originalLayer.rx * scaleX; layer.ry = originalLayer.ry * scaleY; }
        else if (layer.type === 'sphere' || layer.type === 'truncated-sphere') { layer.cx = nX + (originalLayer.cx - oBox.x) * scaleX; layer.cy = nY + (originalLayer.cy - oBox.y) * scaleY; layer.r = originalLayer.r * ((scaleX + scaleY) / 2); if(layer.cutY) { layer.cutY = nY + (originalLayer.cutY - oBox.y) * scaleY; layer.cutR = originalLayer.cutR * scaleX; layer.cutRy = originalLayer.cutRy * scaleY; } }
        else if (layer.type === 'path') { layer.points = originalLayer.points.map(p => ({ x: nX + (p.x - oBox.x) * scaleX, y: nY + (p.y - oBox.y) * scaleY, })); }
        else if (layer.type === 'line') { layer.x1 = nX + (originalLayer.x1 - oBox.x) * scaleX; layer.y1 = nY + (originalLayer.y1 - oBox.y) * scaleY; layer.x2 = nX + (originalLayer.x2 - oBox.x) * scaleX; layer.y2 = nY + (originalLayer.y2 - oBox.y) * scaleY; }
    });
}

export function handleRotate(state, pos, event) {
    const currentAngle = Math.atan2(pos.y - state.groupPivot.y, pos.x - state.groupPivot.x);
    let deltaAngle = currentAngle - state.rotationStartAngle;

    if (event.shiftKey) {
        const snapAngle = 15 * (Math.PI / 180);
        deltaAngle = Math.round(deltaAngle / snapAngle) * snapAngle;
    }
    
    state.groupRotation = deltaAngle;

    state.selectedLayers.forEach((layer, index) => {
        const originalLayer = state.originalLayers[index];
        const originalBox = geo.getBoundingBox(originalLayer);
        if (!originalBox) return;
        
        const originalCenter = { x: originalBox.x + originalBox.width / 2, y: originalBox.y + originalBox.height / 2 };
        const newCenter = geo.rotatePoint(originalCenter, state.groupPivot, deltaAngle);
        
        const dx = newCenter.x - originalCenter.x;
        const dy = newCenter.y - originalCenter.y;

        // --- НАЧАЛО ИЗМЕНЕНИЙ: Добавляем 'pdf' в список вращаемых объектов ---
        if (['rect', 'image', 'text', 'pdf', 'parallelogram', 'parallelepiped'].includes(layer.type)) {
            layer.x = originalLayer.x + dx;
            layer.y = originalLayer.y + dy;
        } else if (['ellipse', 'sphere', 'cone', 'frustum', 'truncated-sphere'].includes(layer.type)) {
            layer.cx = originalLayer.cx + dx;
            layer.cy = originalLayer.cy + dy;
            if (layer.baseY !== undefined) layer.baseY = originalLayer.baseY + dy;
            if (layer.topY !== undefined) layer.topY = originalLayer.topY + dy;
            if (layer.apex) {
                layer.apex.x = originalLayer.apex.x + dx;
                layer.apex.y = originalLayer.apex.y + dy;
            }
            if (layer.cutY !== undefined) layer.cutY = originalLayer.cutY + dy;
        } 
        // --- КОНЕЦ ИЗМЕНЕНИЙ ---
        else if (layer.type === 'line') {
            layer.x1 = originalLayer.x1 + dx; layer.y1 = originalLayer.y1 + dy;
            layer.x2 = originalLayer.x2 + dx; layer.y2 = originalLayer.y2 + dy;
        } else if (layer.type === 'path') {
            layer.points = originalLayer.points.map(p => ({ x: p.x + dx, y: p.y + dy }));
        } else if (layer.hasOwnProperty('p1')) {
            for (let i = 1; i <= 4; i++) {
                if (layer[`p${i}`]) {
                    layer[`p${i}`].x = originalLayer[`p${i}`].x + dx;
                    layer[`p${i}`].y = originalLayer[`p${i}`].y + dy;
                }
            }
        }
         if (layer.base) {
            Object.keys(layer.base).forEach(key => {
                layer.base[key].x = originalLayer.base[key].x + dx;
                layer.base[key].y = originalLayer.base[key].y + dy;
            });
        }
        if (layer.top) {
            Object.keys(layer.top).forEach(key => {
                layer.top[key].x = originalLayer.top[key].x + dx;
                layer.top[key].y = originalLayer.top[key].y + dy;
            });
        }
         if (layer.apex && !layer.baseY) {
            layer.apex.x = originalLayer.apex.x + dx;
            layer.apex.y = originalLayer.apex.y + dy;
        }
        
        layer.rotation = (originalLayer.rotation || 0) + deltaAngle;
    });
}

export function handleMovePivot(state, pos) {
    const layer = state.selectedLayers[0];
    const box = geo.getBoundingBox(layer);
    if (box) {
        const centerX = box.x + box.width / 2;
        const centerY = box.y + box.height / 2;
        
        const newPivotVector = {
            x: pos.x - centerX,
            y: pos.y - centerY
        };
        
        layer.pivot = geo.rotatePoint(newPivotVector, { x: 0, y: 0 }, -(layer.rotation || 0));
    }
}

export function endSelectionBox(state, pos, event) {
    const selBox = {
        x: Math.min(pos.x, state.startPos.x),
        y: Math.min(pos.y, state.startPos.y),
        width: Math.abs(pos.x - state.startPos.x),
        height: Math.abs(pos.y - state.startPos.y),
    };
    const layersInBox = state.layers.filter(layer => geo.doBoxesIntersect(geo.getBoundingBox(layer), selBox));

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