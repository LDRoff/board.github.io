// --- START OF FILE js/geometry.js ---

export function getTransformedBoundingBox(layer) {
    const box = getBoundingBox(layer);
    if (!box) return null;
    const rotation = layer.rotation || 0;
    if (!rotation) return box;

    const corners = [
        { x: box.x, y: box.y },
        { x: box.x + box.width, y: box.y },
        { x: box.x + box.width, y: box.y + box.height },
        { x: box.x, y: box.y + box.height }
    ];

    const centerX = box.x + box.width / 2;
    const centerY = box.y + box.height / 2;
    const pivot = layer.pivot || { x: 0, y: 0 };
    const pivotPoint = { x: centerX + pivot.x, y: centerY + pivot.y };

    const rotatedCorners = corners.map(p => rotatePoint(p, pivotPoint, rotation));

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    rotatedCorners.forEach(p => {
        minX = Math.min(minX, p.x);
        minY = Math.min(minY, p.y);
        maxX = Math.max(maxX, p.x);
        maxY = Math.max(maxY, p.y);
    });

    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}


export function getBoundingBox(layer) {
    if (!layer) return null;
    if (layer.type === 'rect' || layer.type === 'image' || layer.type === 'text' || layer.type === 'pdf') { return { x: layer.x, y: layer.y, width: layer.width, height: layer.height }; }
    if (layer.type === 'ellipse' || layer.type === 'sphere' || layer.type === 'truncated-sphere') { 
        const rx = layer.rx ?? layer.r;
        const ry = layer.ry ?? layer.r;
        return { x: layer.cx - rx, y: layer.cy - ry, width: rx * 2, height: ry * 2 }; 
    }
    if (layer.type === 'line') { return { x: Math.min(layer.x1, layer.x2), y: Math.min(layer.y1, layer.y2), width: Math.abs(layer.x1 - layer.x2), height: Math.abs(layer.y1 - layer.y2) }; }
    if (layer.type === 'parallelogram') { const x_coords = [layer.x, layer.x + layer.width, layer.x + layer.slantOffset, layer.x + layer.width + layer.slantOffset]; const y_coords = [layer.y, layer.y + layer.height]; const minX = Math.min(...x_coords); const maxX = Math.max(...x_coords); const minY = Math.min(...y_coords); const maxY = Math.max(...y_coords); return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }; }
    if (layer.type === 'triangle' || layer.type === 'trapezoid' || layer.type === 'rhombus') {
        const points = [layer.p1, layer.p2, layer.p3];
        if (layer.p4) {
            points.push(layer.p4);
        }
        const x_coords = points.map(p => p.x);
        const y_coords = points.map(p => p.y);
        const minX = Math.min(...x_coords);
        const maxX = Math.max(...x_coords);
        const minY = Math.min(...y_coords);
        const maxY = Math.max(...y_coords);
        return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
    }
    if (layer.type === 'cone') { const minX = Math.min(layer.cx - layer.rx, layer.apex.x); const maxX = Math.max(layer.cx + layer.rx, layer.apex.x); const minY = Math.min(layer.baseY, layer.apex.y); const maxY = Math.max(layer.baseY, layer.apex.y); return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }; }
    if (layer.type === 'parallelepiped') { const { x, y, width, height, depthOffset } = layer; const x_coords = [x, x + width, x + depthOffset.x, x + width + depthOffset.x]; const y_coords = [y, y + height, y + depthOffset.y, y + height + depthOffset.y]; const minX = Math.min(...x_coords); const maxX = Math.max(...x_coords); const minY = Math.min(...y_coords); const maxY = Math.max(...y_coords); return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }; }
    if (layer.type === 'pyramid') { const { base, apex } = layer; const x_coords = [base.p1.x, base.p2.x, base.p3.x, base.p4.x, apex.x]; const y_coords = [base.p1.y, base.p2.y, base.p3.y, base.p4.y, apex.y]; const minX = Math.min(...x_coords); const maxX = Math.max(...x_coords); const minY = Math.min(...y_coords); const maxY = Math.max(...y_coords); return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }; }
    if (layer.type === 'frustum') { const { cx, baseY, topY, rx1 } = layer; const minX = cx - rx1; const maxX = cx + rx1; const minY = Math.min(baseY, topY); const maxY = Math.max(baseY, topY); return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }; }
    if (layer.type === 'truncated-pyramid') {
        const points = [...Object.values(layer.base), ...Object.values(layer.top)];
        const x_coords = points.map(p => p.x);
        const y_coords = points.map(p => p.y);
        const minX = Math.min(...x_coords);
        const maxX = Math.max(...x_coords);
        const minY = Math.min(...y_coords);
        const maxY = Math.max(...y_coords);
        return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
    }
    if (layer.type === 'curve') {
        if (!layer.nodes || layer.nodes.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        layer.nodes.forEach(node => {
            const pointsToCheck = [node.p];
            if (node.h1) pointsToCheck.push(node.h1);
            if (node.h2) pointsToCheck.push(node.h2);
            
            pointsToCheck.forEach(p => {
                minX = Math.min(minX, p.x);
                minY = Math.min(minY, p.y);
                maxX = Math.max(maxX, p.x);
                maxY = Math.max(maxY, p.y);
            });
        });
        return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
    }
    if (layer.type === 'path') {
        if (!layer.points || layer.points.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        const step = layer.hasPressure ? 3 : 2;
        for (let i = 0; i < layer.points.length; i += step) {
            const x = layer.points[i];
            const y = layer.points[i + 1];
            minX = Math.min(minX, x);
            minY = Math.min(minY, y);
            maxX = Math.max(maxX, x);
            maxY = Math.max(maxY, y);
        }
        if (minX === Infinity) return { x: 0, y: 0, width: 0, height: 0 };
        return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
    }
    return null;
}
export function isPointInRect(point, rect) { return rect && point.x >= rect.x && point.x <= rect.x + rect.width && point.y >= rect.y && point.y <= rect.y + rect.height; }
export function isPointInTriangle(pt, v1, v2, v3) { const d1 = sign(pt, v1, v2); const d2 = sign(pt, v2, v3); const d3 = sign(pt, v3, v1); const has_neg = (d1 < 0) || (d2 < 0) || (d3 < 0); const has_pos = (d1 > 0) || (d2 > 0) || (d3 > 0); return !(has_neg && has_pos); }
function sign(p1, p2, p3) { return (p1.x - p3.x) * (p2.y - p3.y) - (p2.x - p3.x) * (p1.y - p3.y); }
export function isPointInPolygon(point, vertices) { let isInside = false; for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) { const xi = vertices[i].x, yi = vertices[i].y; const xj = vertices[j].x, yj = vertices[j].y; const intersect = ((yi > point.y) !== (yj > point.y)) && (point.x < (xj - xi) * (point.y - yi) / (yj - yi) + xi); if (intersect) isInside = !isInside; } return isInside; }
export function isPointInParallelogram(point, layer) { const p1 = { x: layer.x, y: layer.y + layer.height }; const p2 = { x: layer.x + layer.width, y: layer.y + layer.height }; const p3 = { x: layer.x + layer.width + layer.slantOffset, y: layer.y }; const p4 = { x: layer.x + layer.slantOffset, y: layer.y }; return isPointInTriangle(point, p1, p2, p3) || isPointInTriangle(point, p1, p3, p4); }
export function isPointInParallelepiped(point, layer) { const { x, y, width, height, depthOffset } = layer; const dx = depthOffset.x; const dy = depthOffset.y; const frontFace = [{x, y}, {x: x+width, y}, {x: x+width, y: y+height}, {x, y: y+height}]; const topFace = [{x, y}, {x: x+dx, y: y+dy}, {x: x+width+dx, y: y+dy}, {x: x+width, y}]; const rightFace = [{x: x+width, y}, {x: x+width+dx, y: y+dy}, {x: x+width+dx, y: y+height+dy}, {x: x+width, y: y+height}]; return isPointInTriangle(point, frontFace[0], frontFace[1], frontFace[2]) || isPointInTriangle(point, frontFace[0], frontFace[2], frontFace[3]) || isPointInTriangle(point, topFace[0], topFace[1], topFace[2]) || isPointInTriangle(point, topFace[0], topFace[2], topFace[3]) || isPointInTriangle(point, rightFace[0], rightFace[1], rightFace[2]) || isPointInTriangle(point, rightFace[0], rightFace[2], rightFace[3]); }
export function isPointInCone(point, layer) { const { cx, baseY, rx, ry, apex } = layer; const baseEllipse = { cx, cy: baseY, rx, ry }; if (isPointInEllipse(point, baseEllipse)) return true; const p1 = { x: cx - rx, y: baseY }; const p2 = { x: cx + rx, y: baseY }; const p3 = apex; return isPointInTriangle(point, p1, p2, p3); }
export function isPointInPyramid(point, layer) { const { base, apex } = layer; return isPointInTriangle(point, base.p1, base.p2, apex) || isPointInTriangle(point, base.p2, base.p3, apex) || isPointInTriangle(point, base.p3, base.p4, apex) || isPointInTriangle(point, base.p4, base.p1, apex); }
export function isPointInFrustum(point, layer) { const { cx, baseY, topY, rx1, ry1, rx2, ry2 } = layer; const baseEllipse = { cx, cy: baseY, rx: rx1, ry: ry1 }; const topEllipse = { cx, cy: topY, rx: rx2, ry: ry2 }; if (isPointInEllipse(point, baseEllipse) || isPointInEllipse(point, topEllipse)) return true; const p1 = {x: cx - rx1, y: baseY}; const p2 = {x: cx + rx1, y: baseY}; const p3 = {x: cx + rx2, y: topY}; const p4 = {x: cx - rx2, y: topY}; return isPointInPolygon(point, [p1, p2, p3, p4]); }
export function isPointOnPath(point, layer, zoom) {
    const threshold = (layer.lineWidth / 2) + (5 / zoom);
    const points = layer.points;
    const step = layer.hasPressure ? 3 : 2;
    for (let i = 0; i < points.length - step; i += step) {
        const p1 = { x: points[i], y: points[i + 1] };
        const p2 = { x: points[i + step], y: points[i + step + 1] };
        const dx = p2.x - p1.x, dy = p2.y - p1.y;
        const lenSq = dx * dx + dy * dy;
        if (lenSq === 0) {
            const distSq = (point.x - p1.x)**2 + (point.y - p1.y)**2;
            if (distSq < threshold**2) return true;
            continue;
        }
        let t = ((point.x - p1.x) * dx + (point.y - p1.y) * dy) / lenSq;
        t = Math.max(0, Math.min(1, t));
        const closestX = p1.x + t * dx, closestY = p1.y + t * dy;
        const distSq = (point.x - closestX)**2 + (point.y - closestY)**2;
        if (distSq < threshold**2) return true;
    }
    return false;
}
export function isPointOnLineSegment(point, layer, zoom) { const threshold = (layer.lineWidth / 2) + (5 / zoom); const p1 = { x: layer.x1, y: layer.y1 }; const p2 = { x: layer.x2, y: layer.y2 }; const dx = p2.x - p1.x, dy = p2.y - p1.y; const lenSq = dx * dx + dy * dy; if (lenSq === 0) { const distSq = (point.x - p1.x)**2 + (point.y - p1.y)**2; return distSq < threshold**2; } let t = ((point.x - p1.x) * dx + (point.y - p1.y) * dy) / lenSq; t = Math.max(0, Math.min(1, t)); const closestX = p1.x + t * dx, closestY = p1.y + t * dy; const distSq = (point.x - closestX)**2 + (point.y - closestY)**2; return distSq < threshold**2; }
export function isPointInEllipse(point, layer) { const { cx, cy, rx, ry } = layer; if (rx <= 0 || ry <= 0) return false; const dx = point.x - cx, dy = point.y - cy; return (dx * dx) / (rx * rx) + (dy * dy) / (ry * ry) <= 1; }
export function doBoxesIntersect(boxA, boxB) { if (!boxA || !boxB) return false; return !(boxB.x > boxA.x + boxA.width || boxB.x + boxB.width < boxA.x || boxB.y > boxA.y + boxA.height || boxB.y + boxB.height < boxA.y); }
export function getGroupBoundingBox(layers) {
    if (!layers || layers.length === 0) return null;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    layers.forEach(layer => {
        const box = getTransformedBoundingBox(layer);
        if (box) {
            minX = Math.min(minX, box.x);
            minY = Math.min(minY, box.y);
            maxX = Math.max(maxX, box.x + box.width);
            maxY = Math.max(maxY, box.y + box.height);
        }
    });
    if (minX === Infinity) return null;
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/**
 * Вычисляет общую рамку для группы слоев, ИГНОРИРУЯ их индивидуальные повороты.
 * Это нужно для отрисовки рамки выделения и проверки нажатий на маркеры.
 */
export function getGroupLogicalBoundingBox(layers) {
    if (!layers || layers.length === 0) return null;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    layers.forEach(layer => {
        const box = getBoundingBox(layer);
        if (box) {
            minX = Math.min(minX, box.x);
            minY = Math.min(minY, box.y);
            maxX = Math.max(maxX, box.x + box.width);
            maxY = Math.max(maxY, box.y + box.height);
        }
    });
    if (minX === Infinity) return null;
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}


// --- НАЧАЛО ИЗМЕНЕНИЙ: Обновляем rotatePoint для сохранения всех свойств ---
export function rotatePoint(point, pivot, angle) {
    const s = Math.sin(angle);
    const c = Math.cos(angle);
    const px = point.x - pivot.x;
    const py = point.y - pivot.y;
    
    const xnew = px * c - py * s;
    const ynew = px * s + py * c;

    // Сначала копируем все свойства изначальной точки (включая pressure),
    // а затем перезаписываем x и y новыми значениями.
    return {
        ...point,
        x: xnew + pivot.x,
        y: ynew + pivot.y,
    };
}
// --- КОНЕЦ ИЗМЕНЕНИЙ ---

export function getPointOnBezier(t, p0, p1, p2, p3) {
    const cX = 3 * (p1.x - p0.x);
    const bX = 3 * (p2.x - p1.x) - cX;
    const aX = p3.x - p0.x - cX - bX;

    const cY = 3 * (p1.y - p0.y);
    const bY = 3 * (p2.y - p1.y) - cY;
    const aY = p3.y - p0.y - cY - bY;

    const x = (aX * Math.pow(t, 3)) + (bX * Math.pow(t, 2)) + (cX * t) + p0.x;
    const y = (aY * Math.pow(t, 3)) + (bY * Math.pow(t, 2)) + (cY * t) + p0.y;

    return { x, y };
}

export function isPointOnCurve(point, layer, zoom) {
    const threshold = (layer.lineWidth / 2) + (10 / zoom);
    if (!layer.nodes || layer.nodes.length < 2) return false;

    for (let i = 1; i < layer.nodes.length; i++) {
        const p0 = layer.nodes[i - 1].p;
        const p1 = layer.nodes[i - 1].h1;
        const p2 = layer.nodes[i].h2;
        const p3 = layer.nodes[i].p;

        if(!p1 || !p2) continue;

        let min_dist_sq = Infinity;
        for (let t = 0; t <= 1; t += 0.05) {
            const p = getPointOnBezier(t, p0, p1, p2, p3);
            const dist_sq = Math.pow(point.x - p.x, 2) + Math.pow(point.y - p.y, 2);
            if (dist_sq < min_dist_sq) {
                min_dist_sq = dist_sq;
            }
        }
        if (min_dist_sq <= threshold * threshold) {
            return true;
        }
    }
    return false;
}

export function findClosestPointOnCurveSegment(point, layer) {
    if (!layer.nodes || layer.nodes.length < 2) return null;

    let overallClosest = {
        distance: Infinity,
        t: 0,
        segmentIndex: -1,
    };

    for (let i = 0; i < layer.nodes.length - 1; i++) {
        const p0 = layer.nodes[i].p;
        const p1 = layer.nodes[i].h1;
        const p2 = layer.nodes[i + 1].h2;
        const p3 = layer.nodes[i + 1].p;

        if (!p1 || !p2) continue;

        let segmentBestT = 0;
        let min_dist_sq = Infinity;

        for (let t = 0; t <= 1; t += 0.01) {
            const p = getPointOnBezier(t, p0, p1, p2, p3);
            const dist_sq = Math.pow(point.x - p.x, 2) + Math.pow(point.y - p.y, 2);
            if (dist_sq < min_dist_sq) {
                min_dist_sq = dist_sq;
                segmentBestT = t;
            }
        }
        
        if (min_dist_sq < overallClosest.distance) {
            overallClosest.distance = min_dist_sq;
            overallClosest.t = segmentBestT;
            overallClosest.segmentIndex = i;
        }
    }

    if (overallClosest.segmentIndex === -1) return null;
    
    overallClosest.distance = Math.sqrt(overallClosest.distance);
    return overallClosest;
}
// --- END OF FILE js/geometry.js ---