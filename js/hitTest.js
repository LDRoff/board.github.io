import * as geo from './geometry.js';

export function getLayerAtPosition(pos, layers) { 
    for (let i = layers.length - 1; i >= 0; i--) { 
        const layer = layers[i]; 
        const box = geo.getBoundingBox(layer); 
        if (!box) continue; 

        const rotation = layer.rotation || 0;
        const pivot = layer.pivot || { x: 0, y: 0 }; 
        const centerX = box.x + box.width / 2; 
        const centerY = box.y + box.height / 2; 

        const pivotX = centerX + pivot.x;
        const pivotY = centerY + pivot.y;
        
        const cos = Math.cos(-rotation);
        const sin = Math.sin(-rotation);
        const dx = pos.x - pivotX;
        const dy = pos.y - pivotY;

        const rotatedPos = {
            x: dx * cos - dy * sin + pivotX,
            y: dx * sin + dy * cos + pivotY
        };

        let hit = false; 
        if (layer.type === 'path') { hit = geo.isPointOnPath(rotatedPos, layer); } 
        else if (layer.type === 'text') { hit = geo.isPointInRect(rotatedPos, box); }
        else if (layer.type === 'sphere' || layer.type === 'truncated-sphere') { hit = geo.isPointInEllipse(rotatedPos, { cx: layer.cx, cy: layer.cy, rx: layer.r, ry: layer.r }); } 
        else if (layer.type === 'ellipse') { hit = geo.isPointInEllipse(rotatedPos, layer); } 
        else if (layer.type === 'line') { hit = geo.isPointOnLineSegment(rotatedPos, layer); } 
        else if (layer.type === 'parallelogram') { hit = geo.isPointInParallelogram(rotatedPos, layer); } 
        else if (layer.type === 'triangle') { hit = geo.isPointInTriangle(rotatedPos, layer.p1, layer.p2, layer.p3); } 
        else if (layer.type === 'cone') { hit = geo.isPointInCone(rotatedPos, layer); } 
        else if (layer.type === 'parallelepiped') { hit = geo.isPointInParallelepiped(rotatedPos, layer); } 
        else if (layer.type === 'pyramid') { hit = geo.isPointInPyramid(rotatedPos, layer); } 
        else if (layer.type === 'trapezoid' || layer.type === 'rhombus') { hit = geo.isPointInPolygon(rotatedPos, [layer.p1, layer.p2, layer.p3, layer.p4]); } 
        else if (layer.type === 'frustum') { hit = geo.isPointInFrustum(rotatedPos, layer); } 
        else if (layer.type === 'truncated-pyramid') { 
            const { base, top } = layer; 
            const faces = [ [base.p1, base.p2, base.p3, base.p4], [top.p1, top.p2, top.p3, top.p4], [base.p1, base.p2, top.p2, top.p1], [base.p2, base.p3, top.p3, top.p2], [base.p3, base.p4, top.p4, top.p3], [base.p4, base.p1, top.p1, top.p4] ]; 
            for (const face of faces) { 
                if (geo.isPointInPolygon(rotatedPos, face)) { hit = true; break; } 
            } 
        } else { hit = geo.isPointInRect(rotatedPos, geo.getBoundingBox(layer)); } 
        if (hit) return layer; 
    } 
    return null; 
}

export function getSelectionRotation(layers, groupRotation) {
    if (layers.length > 1) {
        return groupRotation;
    }
    if (layers.length === 1) {
        return layers[0].rotation || 0;
    }
    return 0;
}

// --- НАЧАЛО ИЗМЕНЕНИЙ: Полностью переписанная функция для корректной работы с вращением ---
export function getHandleAtPosition(pos, layers, zoom, groupRotation) {
    if (!layers || layers.length === 0) return null;

    const box = geo.getGroupBoundingBox(layers);
    if (!box) return null;
    
    const handleHitboxSize = 10 / zoom;
    const halfHandle = handleHitboxSize / 2;
    const centerX = box.x + box.width / 2;
    const centerY = box.y + box.height / 2;

    const isSingleSelection = layers.length === 1;
    const layer = isSingleSelection ? layers[0] : null;
    
    // 1. Определяем точку вращения (pivot) в мировых координатах
    let pivotX = centerX;
    let pivotY = centerY;
    if (isSingleSelection && layer && layer.pivot) {
        pivotX = centerX + layer.pivot.x;
        pivotY = centerY + layer.pivot.y;
    }
    
    // 2. Сначала проверяем маркер пивота, так как он не вращается
    if (isSingleSelection && layer) {
         if (pos.x >= pivotX - halfHandle && pos.x <= pivotX + halfHandle && pos.y >= pivotY - halfHandle && pos.y <= pivotY + halfHandle) {
            return 'pivot';
        }
    }
    
    const rotation = getSelectionRotation(layers, groupRotation);

    // 3. "Разворачиваем" клик мыши в систему координат неповёрнутого объекта
    const cos = Math.cos(-rotation);
    const sin = Math.sin(-rotation);
    const dx = pos.x - pivotX;
    const dy = pos.y - pivotY;

    const rotatedPos = {
        x: dx * cos - dy * sin + pivotX,
        y: dx * sin + dy * cos + pivotY
    };
    
    // 4. Теперь все проверки делаем с `rotatedPos` против НЕПОВЁРНУТЫХ координат маркеров

    // Маркер вращения
    const rotationHandlePoint = { x: box.x + box.width, y: box.y + box.height + 20 / zoom };
    if (rotatedPos.x >= rotationHandlePoint.x - halfHandle && rotatedPos.x <= rotationHandlePoint.x + halfHandle && rotatedPos.y >= rotationHandlePoint.y - halfHandle && rotatedPos.y <= rotationHandlePoint.y + halfHandle) {
        return 'rotate';
    }

    // Маркеры масштабирования
    const handles = {
        topLeft: { x: box.x, y: box.y }, top: { x: centerX, y: box.y }, topRight: { x: box.x + box.width, y: box.y },
        left: { x: box.x, y: centerY }, right: { x: box.x + box.width, y: centerY },
        bottomLeft: { x: box.x, y: box.y + box.height }, bottom: { x: centerX, y: box.y + box.height }, bottomRight: { x: box.x + box.width, y: box.y + box.height },
    };

    // Смещаем `rotatedPos` в ту же систему координат, что и unrotated box, для простоты сравнения
    const localRotatedPos = {
        x: rotatedPos.x - pivotX + centerX,
        y: rotatedPos.y - pivotY + centerY
    };

    for (const handleName in handles) {
        const handlePos = handles[handleName];
        if (localRotatedPos.x >= handlePos.x - halfHandle && localRotatedPos.x <= handlePos.x + halfHandle && localRotatedPos.y >= handlePos.y - halfHandle && localRotatedPos.y <= handlePos.y + halfHandle) {
            return handleName;
        }
    }
    
    return null;
}
// --- КОНЕЦ ИЗМЕНЕНИЙ ---

export function layerInRect(layer, rect) {
    const layerBox = geo.getBoundingBox(layer);
    if (!layerBox) return false;
    return geo.doBoxesIntersect(layerBox, rect);
}