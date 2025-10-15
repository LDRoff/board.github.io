import * as geo from './geometry.js';

export function getLayerAtPosition(pos, layers, zoom) { 
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
        if (layer.type === 'path') { hit = geo.isPointOnPath(rotatedPos, layer, zoom); } 
        else if (layer.type === 'curve') { hit = geo.isPointOnCurve(rotatedPos, layer, zoom); }
        else if (layer.type === 'text') { hit = geo.isPointInRect(rotatedPos, box); }
        // --- НАЧАЛО ИЗМЕНЕНИЙ: Обновляем проверку попадания для сфер ---
        else if (layer.type === 'sphere' || layer.type === 'truncated-sphere') { 
            const rx = layer.rx ?? layer.r;
            const ry = layer.ry ?? layer.r;
            hit = geo.isPointInEllipse(rotatedPos, { cx: layer.cx, cy: layer.cy, rx, ry }); 
        } 
        // --- КОНЕЦ ИЗМЕНЕНИЙ ---
        else if (layer.type === 'ellipse') { hit = geo.isPointInEllipse(rotatedPos, layer); } 
        else if (layer.type === 'line') { hit = geo.isPointOnLineSegment(rotatedPos, layer, zoom); } 
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
        } else { 
            hit = geo.isPointInRect(rotatedPos, box); 
        } 
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

    const isSingleSelection = layers.length === 1;
    const layer = isSingleSelection ? layers[0] : null;

    const generalHandleHitboxSize = 20 / zoom;
    const curveHandleHitboxSize = 18 / zoom;
    const rotationHandleHitboxSize = 24 / zoom;
    
    const halfGeneralHandle = generalHandleHitboxSize / 2;
    const halfCurveHandle = curveHandleHitboxSize / 2;
    const halfRotationHandle = rotationHandleHitboxSize / 2;

    if (isSingleSelection && layer.type === 'curve') {
        for (let i = 0; i < layer.nodes.length; i++) {
            const node = layer.nodes[i];
            
            if (node.h1 && pos.x >= node.h1.x - halfCurveHandle && pos.x <= node.h1.x + halfCurveHandle &&
                pos.y >= node.h1.y - halfCurveHandle && pos.y <= node.h1.y + halfCurveHandle) {
                return { type: 'curveHandle', nodeIndex: i, pointType: 'h1' };
            }
            if (node.h2 && pos.x >= node.h2.x - halfCurveHandle && pos.x <= node.h2.x + halfCurveHandle &&
                pos.y >= node.h2.y - halfCurveHandle && pos.y <= node.h2.y + halfCurveHandle) {
                return { type: 'curveHandle', nodeIndex: i, pointType: 'h2' };
            }

            if (pos.x >= node.p.x - halfCurveHandle && pos.x <= node.p.x + halfCurveHandle &&
                pos.y >= node.p.y - halfCurveHandle && pos.y <= node.p.y + halfCurveHandle) {
                return { type: 'curveNode', nodeIndex: i, pointType: 'p' };
            }
        }
    }

    const box = geo.getGroupLogicalBoundingBox(layers);
    if (!box) return null;
    
    const centerX = box.x + box.width / 2;
    const centerY = box.y + box.height / 2;
    
    let pivotX = centerX;
    let pivotY = centerY;
    if (isSingleSelection && layer && layer.pivot) {
        pivotX = centerX + layer.pivot.x;
        pivotY = centerY + layer.pivot.y;
    }
    
    if (isSingleSelection && layer) {
         if (pos.x >= pivotX - halfGeneralHandle && pos.x <= pivotX + halfGeneralHandle && pos.y >= pivotY - halfGeneralHandle && pos.y <= pivotY + halfGeneralHandle) {
            return 'pivot';
        }
    }
    
    const rotation = getSelectionRotation(layers, groupRotation);

    const cos = Math.cos(-rotation);
    const sin = Math.sin(-rotation);
    const dx = pos.x - pivotX;
    const dy = pos.y - pivotY;

    const rotatedPos = {
        x: dx * cos - dy * sin + pivotX,
        y: dx * sin + dy * cos + pivotY
    };
    
    const rotationHandlePoint = { x: box.x + box.width, y: box.y + box.height + 25 / zoom };
    if (rotatedPos.x >= rotationHandlePoint.x - halfRotationHandle && rotatedPos.x <= rotationHandlePoint.x + halfRotationHandle && 
        rotatedPos.y >= rotationHandlePoint.y - halfRotationHandle && rotatedPos.y <= rotationHandlePoint.y + halfRotationHandle) {
        return 'rotate';
    }

    const handles = {
        topLeft: { x: box.x, y: box.y }, top: { x: centerX, y: box.y }, topRight: { x: box.x + box.width, y: box.y },
        left: { x: box.x, y: centerY }, right: { x: box.x + box.width, y: centerY },
        bottomLeft: { x: box.x, y: box.y + box.height }, bottom: { x: centerX, y: box.y + box.height }, bottomRight: { x: box.x + box.width, y: box.y + box.height },
    };
    
    for (const handleName in handles) {
        const handlePos = handles[handleName];
        if (rotatedPos.x >= handlePos.x - halfGeneralHandle && rotatedPos.x <= handlePos.x + halfGeneralHandle && 
            rotatedPos.y >= handlePos.y - halfGeneralHandle && rotatedPos.y <= handlePos.y + halfGeneralHandle) {
            return handleName;
        }
    }
    
    return null;
}

export function layerInRect(layer, rect) {
    const layerBox = geo.getBoundingBox(layer);
    if (!layerBox) return false;
    return geo.doBoxesIntersect(layerBox, rect);
}