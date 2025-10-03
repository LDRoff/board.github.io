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
    } else {
        state.snapPoint = null; 
    }

    state.selectedLayers.forEach(layer => {
        if (['rect', 'image', 'text', 'pdf'].includes(layer.type)) { layer.x += dx; layer.y += dy; }
        else if (layer.type === 'parallelogram') { layer.x += dx; layer.y += dy; }
        else if (layer.type === 'parallelepiped') { layer.x += dx; layer.y += dy; layer.depthOffset.x += dx; layer.depthOffset.y += dy; }
        else if (layer.type === 'cone') { layer.cx += dx; layer.baseY += dy; if (layer.apex) { layer.apex.x += dx; layer.apex.y += dy; } }
        else if (layer.type === 'frustum') { layer.cx += dx; layer.baseY += dy; layer.topY += dy; }
        else if (layer.type === 'sphere' || layer.type === 'ellipse' || layer.type === 'truncated-sphere') { layer.cx += dx; layer.cy += dy; if (layer.cutY !== undefined) layer.cutY += dy; }
        else if (layer.type === 'triangle') { layer.p1.x += dx; layer.p1.y += dy; layer.p2.x += dx; layer.p2.y += dy; layer.p3.x += dx; layer.p3.y += dy; }
        else if (layer.type === 'trapezoid') { layer.p1.x += dx; layer.p1.y += dy; layer.p2.x += dx; layer.p2.y += dy; layer.p3.x += dx; layer.p3.y += dy; layer.p4.x += dx; layer.p4.y += dy; }
        else if (layer.type === 'rhombus') { layer.p1.x += dx; layer.p1.y += dy; layer.p2.x += dx; layer.p2.y += dy; layer.p3.x += dx; layer.p3.y += dy; layer.p4.x += dx; layer.p4.y += dy; }
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
        case 'right':
            nW = oBox.width + dx;
            break;
        case 'left':
            nW = oBox.width - dx; nX = oBox.x + dx;
            break;
        case 'bottom':
            nH = oBox.height + dy;
            break;
        case 'top':
            nH = oBox.height - dy; nY = oBox.y + dy;
            break;
        case 'top-left':
            nW = oBox.width - dx; nX = oBox.x + dx; nH = oBox.height - dy; nY = oBox.y + dy;
            break;
        case 'top-right':
            nW = oBox.width + dx; nH = oBox.height - dy; nY = oBox.y + dy;
            break;
        case 'bottom-left':
            nW = oBox.width - dx; nX = oBox.x + dx; nH = oBox.height + dy;
            break;
        case 'bottom-right':
            nW = oBox.width + dx; nH = oBox.height + dy;
            break;
    }

    if (event.shiftKey) {
        const aspect = oBox.width / oBox.height;
        if (Math.abs(dx) > Math.abs(dy)) {
            nH = nW / aspect;
            if (['left', 'top-left', 'bottom-left'].includes(state.scalingHandle)) nY = oBox.y + (oBox.height - nH);
        } else {
            nW = nH * aspect;
            if (['top', 'top-left', 'top-right'].includes(state.scalingHandle)) nX = oBox.x + (oBox.width - nW);
        }
    }

    if (nW < 1) nW = 1; if (nH < 1) nH = 1;
    const scaleX = oBox.width > 0 ? nW / oBox.width : 1;
    const scaleY = oBox.height > 0 ? nH / oBox.height : 1;
    state.selectedLayers.forEach((layer, index) => {
        const originalLayer = state.originalLayers[index];
        if (['rect', 'image', 'text', 'pdf'].includes(layer.type)) { 
            layer.x = nX + (originalLayer.x - oBox.x) * scaleX; 
            layer.y = nY + (originalLayer.y - oBox.y) * scaleY; 
            layer.width = originalLayer.width * scaleX; 
            layer.height = originalLayer.height * scaleY; 
        }
        else if (layer.type === 'parallelogram') { layer.x = nX + (originalLayer.x - oBox.x) * scaleX; layer.y = nY + (originalLayer.y - oBox.y) * scaleY; layer.width = originalLayer.width * scaleX; layer.height = originalLayer.height * scaleY; layer.slantOffset = originalLayer.slantOffset * scaleX; }
        else if (layer.type === 'parallelepiped') { layer.x = nX + (originalLayer.x - oBox.x) * scaleX; layer.y = nY + (originalLayer.y - oBox.y) * scaleY; layer.width = originalLayer.width * scaleX; layer.height = originalLayer.height * scaleY; layer.depthOffset.x = originalLayer.depthOffset.x * scaleX; layer.depthOffset.y = originalLayer.depthOffset.y * scaleY; }
        else if (layer.type === 'cone') { layer.cx = nX + (originalLayer.cx - oBox.x) * scaleX; layer.baseY = nY + (originalLayer.baseY - oBox.y) * scaleY; if (originalLayer.apex) { layer.apex = { x: nX + (originalLayer.apex.x - oBox.x) * scaleX, y: nY + (originalLayer.apex.y - oBox.y) * scaleY }; } }
        else if (layer.type === 'frustum') { layer.cx = nX + (originalLayer.cx - oBox.x) * scaleX; layer.baseY = nY + (originalLayer.baseY - oBox.y) * scaleY; layer.topY = nY + (originalLayer.topY - oBox.y) * scaleY; layer.bottomRadius = originalLayer.bottomRadius * scaleX; layer.topRadius = originalLayer.topRadius * scaleX; }
        else if (layer.type === 'sphere' || layer.type === 'ellipse' || layer.type === 'truncated-sphere') { layer.cx = nX + (originalLayer.cx - oBox.x) * scaleX; layer.cy = nY + (originalLayer.cy - oBox.y) * scaleY; layer.rx = originalLayer.rx * scaleX; layer.ry = originalLayer.ry * scaleY; if (layer.cutY !== undefined) layer.cutY = nY + (originalLayer.cutY - oBox.y) * scaleY; }
        else if (layer.type === 'triangle') { 
            layer.p1 = { x: nX + (originalLayer.p1.x - oBox.x) * scaleX, y: nY + (originalLayer.p1.y - oBox.y) * scaleY };
            layer.p2 = { x: nX + (originalLayer.p2.x - oBox.x) * scaleX, y: nY + (originalLayer.p2.y - oBox.y) * scaleY };
            layer.p3 = { x: nX + (originalLayer.p3.x - oBox.x) * scaleX, y: nY + (originalLayer.p3.y - oBox.y) * scaleY };
        }
        else if (layer.type === 'trapezoid' || layer.type === 'rhombus') {
            layer.p1 = { x: nX + (originalLayer.p1.x - oBox.x) * scaleX, y: nY + (originalLayer.p1.y - oBox.y) * scaleY };
            layer.p2 = { x: nX + (originalLayer.p2.x - oBox.x) * scaleX, y: nY + (originalLayer.p2.y - oBox.y) * scaleY };
            layer.p3 = { x: nX + (originalLayer.p3.x - oBox.x) * scaleX, y: nY + (originalLayer.p3.y - oBox.y) * scaleY };
            layer.p4 = { x: nX + (originalLayer.p4.x - oBox.x) * scaleX, y: nY + (originalLayer.p4.y - oBox.y) * scaleY };
        }
        else if (layer.type === 'path') { layer.points = originalLayer.points.map(p => ({ x: nX + (p.x - oBox.x) * scaleX, y: nY + (p.y - oBox.y) * scaleY })); }
        else if (layer.type === 'line') { 
            layer.x1 = nX + (originalLayer.x1 - oBox.x) * scaleX; 
            layer.y1 = nY + (originalLayer.y1 - oBox.y) * scaleY; 
            layer.x2 = nX + (originalLayer.x2 - oBox.x) * scaleX; 
            layer.y2 = nY + (originalLayer.y2 - oBox.y) * scaleY; 
        }
        else if (layer.type === 'pyramid' || layer.type === 'truncated-pyramid') {
            if (originalLayer.apex) {
                layer.apex = {
                    x: nX + (originalLayer.apex.x - oBox.x) * scaleX,
                    y: nY + (originalLayer.apex.y - oBox.y) * scaleY
                };
            }
            layer.base = {
                p1: { x: nX + (originalLayer.base.p1.x - oBox.x) * scaleX, y: nY + (originalLayer.base.p1.y - oBox.y) * scaleY },
                p2: { x: nX + (originalLayer.base.p2.x - oBox.x) * scaleX, y: nY + (originalLayer.base.p2.y - oBox.y) * scaleY },
                p3: { x: nX + (originalLayer.base.p3.x - oBox.x) * scaleX, y: nY + (originalLayer.base.p3.y - oBox.y) * scaleY },
                p4: { x: nX + (originalLayer.base.p4.x - oBox.x) * scaleX, y: nY + (originalLayer.base.p4.y - oBox.y) * scaleY },
            };
            if (originalLayer.top) {
                layer.top = {
                    p1: { x: nX + (originalLayer.top.p1.x - oBox.x) * scaleX, y: nY + (originalLayer.top.p1.y - oBox.y) * scaleY },
                    p2: { x: nX + (originalLayer.top.p2.x - oBox.x) * scaleX, y: nY + (originalLayer.top.p2.y - oBox.y) * scaleY },
                    p3: { x: nX + (originalLayer.top.p3.x - oBox.x) * scaleX, y: nY + (originalLayer.top.p3.y - oBox.y) * scaleY },
                    p4: { x: nX + (originalLayer.top.p4.x - oBox.x) * scaleX, y: nY + (originalLayer.top.p4.y - oBox.y) * scaleY },
                };
            }
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
    
    state.groupRotation = deltaAngle;

    state.selectedLayers.forEach((layer, index) => {
        const originalLayer = state.originalLayers[index];
        layer.rotation = (originalLayer.rotation || 0) + deltaAngle;
    });
}

export function handleMovePivot(state, pos) {
    // Центр выделения
    const box = geo.getGroupBoundingBox(state.selectedLayers);
    if (!box) return;

    const centerX = box.x + box.width / 2;
    const centerY = box.y + box.height / 2;

    // Группа — оставляем как есть: двигаем общий pivot, слои не трогаем
    if (state.selectedLayers.length !== 1) {
        state.groupPivot = { x: pos.x, y: pos.y };
        return;
    }

    // Один слой — компенсируем геометрию при переносе пивота
    const layer = state.selectedLayers[0];
    const rotation = layer.rotation || 0;

    // Старое положение пивота в мировых координатах
    const oldPivotWorld = {
        x: centerX + (layer.pivot?.x || 0),
        y: centerY + (layer.pivot?.y || 0),
    };

    // Новое положение пивота — это позиция курсора
    const newPivotWorld = { x: pos.x, y: pos.y };

    // Мировой сдвиг пивота
    const d = { x: newPivotWorld.x - oldPivotWorld.x, y: newPivotWorld.y - oldPivotWorld.y };

    // invR(d): повернуть d на -rotation
    const cosA = Math.cos(-rotation);
    const sinA = Math.sin(-rotation);
    const invDx = d.x * cosA - d.y * sinA;
    const invDy = d.x * sinA + d.y * cosA;

    // Сдвиг центра, который компенсирует визуальное движение фигуры
    const centerShift = { x: d.x - invDx, y: d.y - invDy };

    // Универсально сдвигаем фигуру на centerShift (как в handleMove)
    const dx = centerShift.x, dy = centerShift.y;

    if (['rect', 'image', 'text', 'pdf', 'parallelogram', 'parallelepiped'].includes(layer.type)) {
        layer.x = (layer.x || 0) + dx;
        layer.y = (layer.y || 0) + dy;
    } else if (['triangle', 'trapezoid', 'rhombus'].includes(layer.type)) {
        layer.p1.x += dx; layer.p1.y += dy;
        layer.p2.x += dx; layer.p2.y += dy;
        layer.p3.x += dx; layer.p3.y += dy;
        if (layer.p4) { layer.p4.x += dx; layer.p4.y += dy; }
    } else if (layer.type === 'cone' || layer.type === 'frustum') {
        layer.cx += dx; layer.baseY += dy;
        if (layer.apex) { layer.apex.x += dx; layer.apex.y += dy; }
        if (layer.topY !== undefined) { layer.topY += dy; }
    } else if (layer.type === 'sphere' || layer.type === 'ellipse' || layer.type === 'truncated-sphere') {
        layer.cx += dx; layer.cy += dy;
        if (layer.cutY !== undefined) layer.cutY += dy;
    } else if (layer.type === 'path') {
        layer.points.forEach(p => { p.x += dx; p.y += dy; });
    } else if (layer.type === 'line') {
        layer.x1 += dx; layer.y1 += dy; layer.x2 += dx; layer.y2 += dy;
    } else if (layer.type === 'pyramid' || layer.type === 'truncated-pyramid') {
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

    // Новый центр после сдвига
    const newCenterX = centerX + centerShift.x;
    const newCenterY = centerY + centerShift.y;

    // Записываем pivot как смещение относительно НОВОГО центра
    layer.pivot = { x: newPivotWorld.x - newCenterX, y: newPivotWorld.y - newCenterY };
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
