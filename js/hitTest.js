// --- START OF FILE hitTest.js ---

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

        const s = Math.sin(rotation);
        const c = Math.cos(rotation);
        const rotatedPivotX = pivot.x * c - pivot.y * s;
        const rotatedPivotY = pivot.x * s + pivot.y * c;
        
        const pivotX = centerX + rotatedPivotX;
        const pivotY = centerY + rotatedPivotY;
        
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

    let pivotX = centerX;
    let pivotY = centerY;
    
    if (isSingleSelection && layer && layer.pivot) {
        const rotation = layer.rotation || 0;
        const rotatedPivotOffset = geo.rotatePoint(layer.pivot, {x:0, y:0}, rotation);
        pivotX = centerX + rotatedPivotOffset.x;
        pivotY = centerY + rotatedPivotOffset.y;
    }
    
    const rotation = getSelectionRotation(layers, groupRotation);

    if (isSingleSelection && layer) {
         if (pos.x >= pivotX - halfHandle && pos.x <= pivotX + halfHandle && pos.y >= pivotY - halfHandle && pos.y <= pivotY + halfHandle) {
            return 'pivot';
        }
    }

    const rotationHandleY = box.y - 20 / zoom;
    const rotationHandlePoint = { x: centerX, y: rotationHandleY };
    
    const rotatedHandle = geo.rotatePoint(rotationHandlePoint, { x: pivotX, y: pivotY }, rotation);

    if (pos.x >= rotatedHandle.x - halfHandle && pos.x <= rotatedHandle.x + halfHandle && pos.y >= rotatedHandle.y - halfHandle && pos.y <= rotatedHandle.y + halfHandle) {
        return 'rotate';
    }

    const handles = {
        topLeft: { x: box.x, y: box.y }, top: { x: centerX, y: box.y }, topRight: { x: box.x + box.width, y: box.y },
        left: { x: box.x, y: centerY }, right: { x: box.x + box.width, y: centerY },
        bottomLeft: { x: box.x, y: box.y + box.height }, bottom: { x: centerX, y: box.y + box.height }, bottomRight: { x: box.x + box.width, y: box.y + box.height },
    };

    for (const handleName in handles) {
        const handlePos = handles[handleName];
        const rotatedHandle = geo.rotatePoint(handlePos, { x: pivotX, y: pivotY }, rotation);
        if (pos.x >= rotatedHandle.x - halfHandle && pos.x <= rotatedHandle.x + halfHandle && pos.y >= rotatedHandle.y - halfHandle && pos.y <= rotatedHandle.y + halfHandle) {
            return handleName;
        }
    }
    return null;
}