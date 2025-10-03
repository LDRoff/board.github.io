import { getBoundingBox, rotatePoint } from './geometry.js';
import * as hitTest from './hitTest.js';
import { snapToGrid } from './utils.js';

export function handleMove(state, pos, event) {
    // Общее смещение от точки начала перетаскивания
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

        // --- ИЗМЕНЕНИЕ: Используем bounding box для всей группы оригинальных слоев ---
        const originalSelectionBox = getGroupBoundingBox(state.originalLayers);
        if (originalSelectionBox) {
            let currentMovingBox = { ...originalSelectionBox };
            currentMovingBox.x += dx;
            currentMovingBox.y += dy;
            const movingPoints = getPointsForBox(currentMovingBox);
            
            const staticLayers = state.layers.filter(l => !state.selectedLayers.some(sl => sl.id === l.id));
            let staticPoints = [];
            staticLayers.forEach(layer => {
                const box = getBoundingBox(layer);
                if (box) staticPoints.push(...getPointsForBox(box));
            });

            // 1. Примагничивание к объектам
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
            
            // 2. Примагничивание к сетке (по всем 9 точкам рамки)
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

    // --- НАЧАЛО ИЗМЕНЕНИЙ: Обновляем живые слои на основе смещения от оригинальных ---
    state.selectedLayers.forEach((layer, index) => {
        const originalLayer = state.originalLayers[index];

        if (['rect', 'image', 'text', 'pdf'].includes(layer.type)) { 
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
        else if (layer.type === 'path') { 
            layer.points.forEach((p, i) => { 
                p.x = originalLayer.points[i].x + dx; 
                p.y = originalLayer.points[i].y + dy; 
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
    // --- КОНЕЦ ИЗМЕНЕНИЙ ---
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
    let nX = oBox.x, nY = oBox.y, nW = oBox.width, nH = oBox.height;

    const rotation = hitTest.getSelectionRotation(state.selectedLayers, state.groupRotation);
    const world_dx = finalPos.x - state.dragStartPos.x;
    const world_dy = finalPos.y - state.dragStartPos.y;

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
        case 'topLeft':
            nW = oBox.width - dx; nX = oBox.x + dx; nH = oBox.height - dy; nY = oBox.y + dy;
            break;
        case 'topRight':
            nW = oBox.width + dx; nH = oBox.height - dy; nY = oBox.y + dy;
            break;
        case 'bottomLeft':
            nW = oBox.width - dx; nX = oBox.x + dx; nH = oBox.height + dy;
            break;
        case 'bottomRight':
            nW = oBox.width + dx; nH = oBox.height + dy;
            break;
    }

    if (event.shiftKey) {
        const aspect = oBox.width / oBox.height;
        if (Math.abs(dx) > Math.abs(dy)) {
            nH = nW / aspect;
            if (['left', 'topLeft', 'bottomLeft'].includes(state.scalingHandle)) nY = oBox.y + (oBox.height - nH);
        } else {
            nW = nH * aspect;
            if (['top', 'topLeft', 'topRight'].includes(state.scalingHandle)) nX = oBox.x + (oBox.width - nW);
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
    if (state.selectedLayers.length !== 1) return;

    // --- НАЧАЛО ИЗМЕНЕНИЙ: Полная переработка логики для корректной работы ---
    const layer = state.selectedLayers[0];
    const originalLayer = state.originalLayers[0];
    const rotation = layer.rotation || 0;
    
    const originalBox = getBoundingBox(originalLayer);
    if (!originalBox) return;

    const originalCenterX = originalBox.x + originalBox.width / 2;
    const originalCenterY = originalBox.y + originalBox.height / 2;

    // Старое положение пивота в мировых координатах (на основе оригинального слоя)
    const oldPivotWorld = {
        x: originalCenterX + (originalLayer.pivot?.x || 0),
        y: originalCenterY + (originalLayer.pivot?.y || 0),
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
    const dx = centerShift.x, dy = centerShift.y;
    
    // Применяем смещение к ГЕОМЕТРИИ живого слоя, основываясь на ОРИГИНАЛЬНОМ слое
    if (['rect', 'image', 'text', 'pdf'].includes(layer.type)) {
        layer.x = originalLayer.x + dx;
        layer.y = originalLayer.y + dy;
    } else if (['triangle', 'trapezoid', 'rhombus'].includes(layer.type)) {
        layer.p1 = { x: originalLayer.p1.x + dx, y: originalLayer.p1.y + dy };
        layer.p2 = { x: originalLayer.p2.x + dx, y: originalLayer.p2.y + dy };
        layer.p3 = { x: originalLayer.p3.x + dx, y: originalLayer.p3.y + dy };
        if (layer.p4) { layer.p4 = { x: originalLayer.p4.x + dx, y: originalLayer.p4.y + dy }; }
    } else if (['cone', 'frustum'].includes(layer.type)) {
        layer.cx = originalLayer.cx + dx;
        layer.baseY = originalLayer.baseY + dy;
        if (layer.apex) { layer.apex = { x: originalLayer.apex.x + dx, y: originalLayer.apex.y + dy }; }
        if (layer.topY !== undefined) { layer.topY = originalLayer.topY + dy; }
    } else if (['sphere', 'ellipse', 'truncated-sphere'].includes(layer.type)) {
        layer.cx = originalLayer.cx + dx;
        layer.cy = originalLayer.cy + dy;
        if (layer.cutY !== undefined) { layer.cutY = originalLayer.cutY + dy; }
    } else if (layer.type === 'path') {
        layer.points.forEach((p, i) => {
            p.x = originalLayer.points[i].x + dx;
            p.y = originalLayer.points[i].y + dy;
        });
    } else if (layer.type === 'line') {
        layer.x1 = originalLayer.x1 + dx; layer.y1 = originalLayer.y1 + dy;
        layer.x2 = originalLayer.x2 + dx; layer.y2 = originalLayer.y2 + dy;
    } else if (['pyramid', 'truncated-pyramid'].includes(layer.type)) {
        if (layer.apex) { layer.apex = { x: originalLayer.apex.x + dx, y: originalLayer.apex.y + dy }; }
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
    
    // Новый центр ПОСЛЕ смещения
    const newCenterX = originalCenterX + dx;
    const newCenterY = originalCenterY + dy;

    // Записываем pivot как смещение относительно НОВОГО центра
    layer.pivot = { x: newPivotWorld.x - newCenterX, y: newPivotWorld.y - newCenterY };
    // --- КОНЕЦ ИЗМЕНЕНИЙ ---
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