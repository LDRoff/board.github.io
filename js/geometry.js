// js/geometry.js

// --- НАЧАЛО ИЗМЕНЕНИЙ: Добавляем быструю функцию для поиска центра ---

/**
 * Быстро вычисляет центр вращения для слоя, избегая полного расчета BoundingBox для простых фигур.
 * @param {object} layer - Слой для анализа.
 * @returns {{x: number, y: number}|null} Координаты центра или null.
 */
export function getRotationCenter(layer) {
    if (!layer) return null;

    // Быстрые пути для простых фигур
    switch (layer.type) {
        case 'rect':
        case 'image':
        case 'text':
        case 'pdf':
            return { x: layer.x + layer.width / 2, y: layer.y + layer.height / 2 };
        case 'ellipse':
        case 'sphere':
        case 'truncated-sphere':
            return { x: layer.cx, y: layer.cy };
        case 'line':
        case 'arrow':
            return { x: (layer.x1 + layer.x2) / 2, y: (layer.y1 + layer.y2) / 2 };
        default:
            // Для всех остальных сложных фигур используем старый, более медленный метод
            const box = getBoundingBox(layer);
            if (!box) return null;
            return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    }
}
// --- КОНЕЦ ИЗМЕНЕНИЙ ---


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

    const center = getRotationCenter(layer); // Используем быструю функцию
    if (!center) return box; // Fallback

    const pivot = layer.pivot || { x: 0, y: 0 };
    const pivotPoint = { x: center.x + pivot.x, y: center.y + pivot.y };

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
    if (layer.type === 'rect' || layer.type === 'image' || layer.type === 'text' || layer.type === 'pdf') {
        const pad = (layer.lineWidth || 2) / 2 + 2;
        return { x: layer.x - pad, y: layer.y - pad, width: layer.width + pad * 2, height: layer.height + pad * 2 };
    }
    if (layer.type === 'ellipse' || layer.type === 'sphere' || layer.type === 'truncated-sphere') {
        const rx = layer.rx ?? layer.r;
        const ry = layer.ry ?? layer.r;
        const pad = (layer.lineWidth || 2) / 2 + 2;
        return { x: layer.cx - rx - pad, y: layer.cy - ry - pad, width: rx * 2 + pad * 2, height: ry * 2 + pad * 2 };
    }
    if (layer.type === 'line' || layer.type === 'arrow') {
        const pad = (layer.lineWidth || 2) / 2 + 2;
        return { x: Math.min(layer.x1, layer.x2) - pad, y: Math.min(layer.y1, layer.y2) - pad, width: Math.abs(layer.x1 - layer.x2) + pad * 2, height: Math.abs(layer.y1 - layer.y2) + pad * 2 };
    }
    if (layer.type === 'parallelogram') { const x_coords = [layer.x, layer.x + layer.width, layer.x + layer.slantOffset, layer.x + layer.width + layer.slantOffset]; const y_coords = [layer.y, layer.y + layer.height]; const minX = Math.min(...x_coords); const maxX = Math.max(...x_coords); const minY = Math.min(...y_coords); const maxY = Math.max(...y_coords); const pad = (layer.lineWidth || 2) / 2 + 2; return { x: minX - pad, y: minY - pad, width: maxX - minX + pad * 2, height: maxY - minY + pad * 2 }; }
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
        const pad = (layer.lineWidth || 2) / 2 + 2;
        return { x: minX - pad, y: minY - pad, width: maxX - minX + pad * 2, height: maxY - minY + pad * 2 };
    }
    if (layer.type === 'cone') {
        const minX = Math.min(layer.cx - layer.rx, layer.apex.x);
        const maxX = Math.max(layer.cx + layer.rx, layer.apex.x);
        const minY = Math.min(layer.baseY - (layer.ry || 0), layer.apex.y);
        const maxY = Math.max(layer.baseY + (layer.ry || 0), layer.apex.y);
        const pad = (layer.lineWidth || 2) / 2 + 2;
        return { x: minX - pad, y: minY - pad, width: maxX - minX + pad * 2, height: maxY - minY + pad * 2 };
    }
    if (layer.type === 'parallelepiped') { const { x, y, width, height, depthOffset } = layer; const x_coords = [x, x + width, x + depthOffset.x, x + width + depthOffset.x]; const y_coords = [y, y + height, y + depthOffset.y, y + height + depthOffset.y]; const minX = Math.min(...x_coords); const maxX = Math.max(...x_coords); const minY = Math.min(...y_coords); const maxY = Math.max(...y_coords); const pad = (layer.lineWidth || 2) / 2 + 2; return { x: minX - pad, y: minY - pad, width: maxX - minX + pad * 2, height: maxY - minY + pad * 2 }; }
    if (layer.type === 'pyramid') { const { base, apex } = layer; const x_coords = [base.p1.x, base.p2.x, base.p3.x, base.p4.x, apex.x]; const y_coords = [base.p1.y, base.p2.y, base.p3.y, base.p4.y, apex.y]; const minX = Math.min(...x_coords); const maxX = Math.max(...x_coords); const minY = Math.min(...y_coords); const maxY = Math.max(...y_coords); const pad = (layer.lineWidth || 2) / 2 + 2; return { x: minX - pad, y: minY - pad, width: maxX - minX + pad * 2, height: maxY - minY + pad * 2 }; }
    if (layer.type === 'frustum') {
        const { cx, baseY, topY, rx1, rx2 = rx1, ry1 = 0, ry2 = 0 } = layer;
        const minX = Math.min(cx - rx1, cx - rx2);
        const maxX = Math.max(cx + rx1, cx + rx2);
        const minY = Math.min(baseY - ry1, topY - ry2);
        const maxY = Math.max(baseY + ry1, topY + ry2);
        const pad = (layer.lineWidth || 2) / 2 + 2;
        return { x: minX - pad, y: minY - pad, width: maxX - minX + pad * 2, height: maxY - minY + pad * 2 };
    }
    if (layer.type === 'truncated-pyramid') {
        const points = [...Object.values(layer.base), ...Object.values(layer.top)];
        const x_coords = points.map(p => p.x);
        const y_coords = points.map(p => p.y);
        const minX = Math.min(...x_coords);
        const maxX = Math.max(...x_coords);
        const minY = Math.min(...y_coords);
        const maxY = Math.max(...y_coords);
        const pad = (layer.lineWidth || 2) / 2 + 2;
        return { x: minX - pad, y: minY - pad, width: maxX - minX + pad * 2, height: maxY - minY + pad * 2 };
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
        const pad = (layer.lineWidth || 2) / 2 + 2;
        return { x: minX - pad, y: minY - pad, width: maxX - minX + pad * 2, height: maxY - minY + pad * 2 };
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
        const pad = (layer.lineWidth || 2) / 2 + 2;
        if (minX === Infinity) return { x: 0, y: 0, width: 0, height: 0 };
        return { x: minX - pad, y: minY - pad, width: maxX - minX + pad * 2, height: maxY - minY + pad * 2 };
    }
    return null;
}
export function isPointInRect(point, rect, tolerance = 0, onlyOutline = false, lineWidth = 2) {
    if (!rect) return false;
    // Outer boundary: expand by half stroke + tolerance
    const outerExpand = (lineWidth / 2) + tolerance;
    const hitOuter = point.x >= rect.x - outerExpand &&
        point.x <= rect.x + rect.width + outerExpand &&
        point.y >= rect.y - outerExpand &&
        point.y <= rect.y + rect.height + outerExpand;

    if (!hitOuter) return false;
    if (!onlyOutline) return true;

    // Inner boundary: shrink by half stroke + tolerance
    const innerShrink = (lineWidth / 2) + tolerance;
    const hitInner = point.x > rect.x + innerShrink &&
        point.x < rect.x + rect.width - innerShrink &&
        point.y > rect.y + innerShrink &&
        point.y < rect.y + rect.height - innerShrink;

    return !hitInner;
}
export function isPointInTriangle(pt, v1, v2, v3, eraserRadius = 0, onlyOutline = false, lineWidth = 2) {
    if (onlyOutline) {
        // Outline test: is it close to any of the 3 edges?
        const edges = [
            { x1: v1.x, y1: v1.y, x2: v2.x, y2: v2.y, lineWidth },
            { x1: v2.x, y1: v2.y, x2: v3.x, y2: v3.y, lineWidth },
            { x1: v3.x, y1: v3.y, x2: v1.x, y2: v1.y, lineWidth }
        ];
        // We zoom=1 because we already scale eraserRadius in hitTest, so threshold in isPointOnLineSegment will just use it.
        // Actually, isPointOnLineSegment expects zoom. We can pass a dummy zoom=1 and pre-adjust lineWidth.
        for (const edge of edges) {
            if (isPointOnLineSegment(pt, edge, 1, eraserRadius)) return true;
        }
        return false;
    }

    // Filled test
    const d1 = sign(pt, v1, v2);
    const d2 = sign(pt, v2, v3);
    const d3 = sign(pt, v3, v1);
    const has_neg = (d1 < 0) || (d2 < 0) || (d3 < 0);
    const has_pos = (d1 > 0) || (d2 > 0) || (d3 > 0);
    return !(has_neg && has_pos);
}
function sign(p1, p2, p3) { return (p1.x - p3.x) * (p2.y - p3.y) - (p2.x - p3.x) * (p1.y - p3.y); }
export function isPointInPolygon(point, vertices, eraserRadius = 0, onlyOutline = false, lineWidth = 2) {
    if (onlyOutline) {
        // Outline test: is it close to any edge?
        for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
            const edge = { x1: vertices[j].x, y1: vertices[j].y, x2: vertices[i].x, y2: vertices[i].y, lineWidth };
            if (isPointOnLineSegment(point, edge, 1, eraserRadius)) return true;
        }
        return false;
    }

    // Filled test
    let isInside = false;
    for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
        const xi = vertices[i].x, yi = vertices[i].y;
        const xj = vertices[j].x, yj = vertices[j].y;
        const intersect = ((yi > point.y) !== (yj > point.y)) && (point.x < (xj - xi) * (point.y - yi) / (yj - yi) + xi);
        if (intersect) isInside = !isInside;
    }
    return isInside;
}
export function isPointInParallelogram(point, layer, tolerance = 0, onlyOutline = false, lineWidth = 2) {
    const pts = [
        { x: layer.x, y: layer.y + layer.height },
        { x: layer.x + layer.width, y: layer.y + layer.height },
        { x: layer.x + layer.width + layer.slantOffset, y: layer.y },
        { x: layer.x + layer.slantOffset, y: layer.y }
    ];
    return isPointInPolygon(point, pts, tolerance, onlyOutline, lineWidth);
}
export function isPointInParallelepiped(point, layer) { const { x, y, width, height, depthOffset } = layer; const dx = depthOffset.x; const dy = depthOffset.y; const frontFace = [{ x, y }, { x: x + width, y }, { x: x + width, y: y + height }, { x, y: y + height }]; const topFace = [{ x, y }, { x: x + dx, y: y + dy }, { x: x + width + dx, y: y + dy }, { x: x + width, y }]; const rightFace = [{ x: x + width, y }, { x: x + width + dx, y: y + dy }, { x: x + width + dx, y: y + height + dy }, { x: x + width, y: y + height }]; return isPointInTriangle(point, frontFace[0], frontFace[1], frontFace[2]) || isPointInTriangle(point, frontFace[0], frontFace[2], frontFace[3]) || isPointInTriangle(point, topFace[0], topFace[1], topFace[2]) || isPointInTriangle(point, topFace[0], topFace[2], topFace[3]) || isPointInTriangle(point, rightFace[0], rightFace[1], rightFace[2]) || isPointInTriangle(point, rightFace[0], rightFace[2], rightFace[3]); }
export function isPointInCone(point, layer) { const { cx, baseY, rx, ry, apex } = layer; const baseEllipse = { cx, cy: baseY, rx, ry }; if (isPointInEllipse(point, baseEllipse)) return true; const p1 = { x: cx - rx, y: baseY }; const p2 = { x: cx + rx, y: baseY }; const p3 = apex; return isPointInTriangle(point, p1, p2, p3); }
export function isPointInPyramid(point, layer) { const { base, apex } = layer; return isPointInTriangle(point, base.p1, base.p2, apex) || isPointInTriangle(point, base.p2, base.p3, apex) || isPointInTriangle(point, base.p3, base.p4, apex) || isPointInTriangle(point, base.p4, base.p1, apex); }
export function isPointInFrustum(point, layer) { const { cx, baseY, topY, rx1, ry1, rx2, ry2 } = layer; const baseEllipse = { cx, cy: baseY, rx: rx1, ry: ry1 }; const topEllipse = { cx, cy: topY, rx: rx2, ry: ry2 }; if (isPointInEllipse(point, baseEllipse) || isPointInEllipse(point, topEllipse)) return true; const p1 = { x: cx - rx1, y: baseY }; const p2 = { x: cx + rx1, y: baseY }; const p3 = { x: cx + rx2, y: topY }; const p4 = { x: cx - rx2, y: topY }; return isPointInPolygon(point, [p1, p2, p3, p4]); }
export function isPointOnPath(point, layer, zoom, eraserRadius = 0) {
    const threshold = (layer.lineWidth / 2) + (5 / zoom) + eraserRadius;
    const points = layer.points;
    const step = layer.hasPressure ? 3 : 2;

    // Support erasing single dots (1 coordinate pair)
    if (points.length === step) {
        const distSq = (point.x - points[0]) ** 2 + (point.y - points[1]) ** 2;
        return distSq < threshold ** 2;
    }

    for (let i = 0; i < points.length - step; i += step) {
        const p1 = { x: points[i], y: points[i + 1] };
        const p2 = { x: points[i + step], y: points[i + step + 1] };
        const dx = p2.x - p1.x, dy = p2.y - p1.y;
        const lenSq = dx * dx + dy * dy;
        if (lenSq === 0) {
            const distSq = (point.x - p1.x) ** 2 + (point.y - p1.y) ** 2;
            if (distSq < threshold ** 2) return true;
            continue;
        }
        let t = ((point.x - p1.x) * dx + (point.y - p1.y) * dy) / lenSq;
        t = Math.max(0, Math.min(1, t));
        const closestX = p1.x + t * dx, closestY = p1.y + t * dy;
        const distSq = (point.x - closestX) ** 2 + (point.y - closestY) ** 2;
        if (distSq < threshold ** 2) return true;
    }
    return false;
}
export function isPointOnLineSegment(point, layer, zoom, eraserRadius = 0) { const threshold = (layer.lineWidth / 2) + (5 / zoom) + eraserRadius; const p1 = { x: layer.x1, y: layer.y1 }; const p2 = { x: layer.x2, y: layer.y2 }; const dx = p2.x - p1.x, dy = p2.y - p1.y; const lenSq = dx * dx + dy * dy; if (lenSq === 0) { const distSq = (point.x - p1.x) ** 2 + (point.y - p1.y) ** 2; return distSq < threshold ** 2; } let t = ((point.x - p1.x) * dx + (point.y - p1.y) * dy) / lenSq; t = Math.max(0, Math.min(1, t)); const closestX = p1.x + t * dx, closestY = p1.y + t * dy; const distSq = (point.x - closestX) ** 2 + (point.y - closestY) ** 2; return distSq < threshold ** 2; }
export function isPointInEllipse(point, layer, tolerance = 0, onlyOutline = false) {
    const { cx, cy } = layer;
    const lineWidth = layer.lineWidth || 2;
    const baseRx = layer.rx ?? layer.r;
    const baseRy = layer.ry ?? layer.r;

    // Outer boundary: stroke center + half stroke + tolerance
    const outerRx = baseRx + (lineWidth / 2) + tolerance;
    const outerRy = baseRy + (lineWidth / 2) + tolerance;

    if (outerRx <= 0 || outerRy <= 0) return false;

    const dx = point.x - cx;
    const dy = point.y - cy;
    const distSqOuter = (dx * dx) / (outerRx * outerRx) + (dy * dy) / (outerRy * outerRy);

    if (distSqOuter > 1) return false; // Outside outer boundary
    if (!onlyOutline) return true;     // Fully filled hit test

    // Inner boundary: stroke center - half stroke - tolerance
    const innerRx = baseRx - (lineWidth / 2) - tolerance;
    const innerRy = baseRy - (lineWidth / 2) - tolerance;

    // If inner becomes zero/negative, the entire ellipse is "all stroke"
    if (innerRx <= 0 || innerRy <= 0) return true;

    const distSqInner = (dx * dx) / (innerRx * innerRx) + (dy * dy) / (innerRy * innerRy);
    return distSqInner >= 1; // Hits if outside the inner cutout (i.e. on the stroke zone)
}
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

export function rotatePoint(point, pivot, angle) {
    const s = Math.sin(angle);
    const c = Math.cos(angle);
    const px = point.x - pivot.x;
    const py = point.y - pivot.y;

    const xnew = px * c - py * s;
    const ynew = px * s + py * c;

    return {
        ...point,
        x: xnew + pivot.x,
        y: ynew + pivot.y,
    };
}

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

export function isPointOnCurve(point, layer, zoom, eraserRadius = 0) {
    const threshold = (layer.lineWidth / 2) + (10 / zoom) + eraserRadius;
    if (!layer.nodes || layer.nodes.length === 0) return false;

    // Support erasing single dots
    if (layer.nodes.length === 1) {
        const p = layer.nodes[0].p;
        const distSq = (point.x - p.x) ** 2 + (point.y - p.y) ** 2;
        return distSq < threshold ** 2;
    }

    for (let i = 1; i < layer.nodes.length; i++) {
        const p0 = layer.nodes[i - 1].p;
        const p1 = layer.nodes[i - 1].h1;
        const p2 = layer.nodes[i].h2;
        const p3 = layer.nodes[i].p;

        if (!p1 || !p2) continue;

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

// --- Helpers for marquee (rect) selection by stroke ---

function _pointInSimpleRect(px, py, rx, ry, rw, rh) {
    return px >= rx && px <= rx + rw && py >= ry && py <= ry + rh;
}

function _segmentsIntersect(ax1, ay1, ax2, ay2, bx1, by1, bx2, by2) {
    const d1 = (bx2 - bx1) * (ay1 - by1) - (by2 - by1) * (ax1 - bx1);
    const d2 = (bx2 - bx1) * (ay2 - by1) - (by2 - by1) * (ax2 - bx1);
    const d3 = (ax2 - ax1) * (by1 - ay1) - (ay2 - ay1) * (bx1 - ax1);
    const d4 = (ax2 - ax1) * (by2 - ay1) - (ay2 - ay1) * (bx2 - ax1);
    if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
        ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
        return true;
    }
    return false;
}

function _segmentIntersectsRect(x1, y1, x2, y2, rx, ry, rw, rh) {
    if (_pointInSimpleRect(x1, y1, rx, ry, rw, rh)) return true;
    if (_pointInSimpleRect(x2, y2, rx, ry, rw, rh)) return true;
    if (_segmentsIntersect(x1, y1, x2, y2, rx, ry, rx + rw, ry)) return true;
    if (_segmentsIntersect(x1, y1, x2, y2, rx + rw, ry, rx + rw, ry + rh)) return true;
    if (_segmentsIntersect(x1, y1, x2, y2, rx, ry + rh, rx + rw, ry + rh)) return true;
    if (_segmentsIntersect(x1, y1, x2, y2, rx, ry, rx, ry + rh)) return true;
    return false;
}

function _polygonEdgesIntersectRect(pts, rx, ry, rw, rh) {
    for (let i = 0; i < pts.length; i++) {
        const a = pts[i], b = pts[(i + 1) % pts.length];
        if (_segmentIntersectsRect(a.x, a.y, b.x, b.y, rx, ry, rw, rh)) return true;
    }
    return false;
}

function _ellipseIntersectsRect(cx, cy, erx, ery, rx, ry, rw, rh) {
    const numSeg = 36;
    let prevX = cx + erx, prevY = cy;
    for (let i = 1; i <= numSeg; i++) {
        const angle = (i / numSeg) * 2 * Math.PI;
        const x = cx + erx * Math.cos(angle);
        const y = cy + ery * Math.sin(angle);
        if (_segmentIntersectsRect(prevX, prevY, x, y, rx, ry, rw, rh)) return true;
        prevX = x; prevY = y;
    }
    return false;
}

/**
 * Check if the actual stroke of a layer intersects a selection rectangle.
 * The rect is expanded by lineWidth/2 to account for stroke thickness.
 */
export function doesStrokeIntersectRect(layer, selectionRect) {
    const hw = (layer.lineWidth || 2) / 2;
    const rx = selectionRect.x - hw;
    const ry = selectionRect.y - hw;
    const rw = selectionRect.width + hw * 2;
    const rh = selectionRect.height + hw * 2;

    // --- path (brush strokes) ---
    if (layer.type === 'path') {
        const points = layer.points;
        const step = layer.hasPressure ? 3 : 2;
        if (!points || points.length < step) return false;
        if (points.length < step * 2) {
            return _pointInSimpleRect(points[0], points[1], rx, ry, rw, rh);
        }
        for (let i = 0; i < points.length - step; i += step) {
            if (_segmentIntersectsRect(points[i], points[i + 1], points[i + step], points[i + step + 1], rx, ry, rw, rh)) return true;
        }
        return false;
    }

    // --- curve (bezier) ---
    if (layer.type === 'curve') {
        if (!layer.nodes || layer.nodes.length === 0) return false;
        if (layer.nodes.length === 1) {
            return _pointInSimpleRect(layer.nodes[0].p.x, layer.nodes[0].p.y, rx, ry, rw, rh);
        }
        for (let i = 1; i < layer.nodes.length; i++) {
            const p0 = layer.nodes[i - 1].p;
            const cp1 = layer.nodes[i - 1].h1;
            const cp2 = layer.nodes[i].h2;
            const p3 = layer.nodes[i].p;
            if (!cp1 || !cp2) continue;
            let prev = p0;
            for (let t = 0.05; t <= 1.001; t += 0.05) {
                const pt = getPointOnBezier(Math.min(t, 1), p0, cp1, cp2, p3);
                if (_segmentIntersectsRect(prev.x, prev.y, pt.x, pt.y, rx, ry, rw, rh)) return true;
                prev = pt;
            }
        }
        return false;
    }

    // --- line ---
    if (layer.type === 'line' || layer.type === 'arrow') {
        return _segmentIntersectsRect(layer.x1, layer.y1, layer.x2, layer.y2, rx, ry, rw, rh);
    }

    // --- rect ---
    if (layer.type === 'rect') {
        const lx = layer.x, ly = layer.y, lw = layer.width, lh = layer.height;
        return _polygonEdgesIntersectRect(
            [{ x: lx, y: ly }, { x: lx + lw, y: ly }, { x: lx + lw, y: ly + lh }, { x: lx, y: ly + lh }],
            rx, ry, rw, rh
        );
    }

    // --- ellipse / sphere / truncated-sphere ---
    if (layer.type === 'ellipse' || layer.type === 'sphere' || layer.type === 'truncated-sphere') {
        const erx = layer.rx ?? layer.r;
        const ery = layer.ry ?? layer.r;
        return _ellipseIntersectsRect(layer.cx, layer.cy, erx, ery, rx, ry, rw, rh);
    }

    // --- triangle ---
    if (layer.type === 'triangle') {
        return _polygonEdgesIntersectRect([layer.p1, layer.p2, layer.p3], rx, ry, rw, rh);
    }

    // --- trapezoid / rhombus ---
    if (layer.type === 'trapezoid' || layer.type === 'rhombus') {
        return _polygonEdgesIntersectRect([layer.p1, layer.p2, layer.p3, layer.p4], rx, ry, rw, rh);
    }

    // --- parallelogram ---
    if (layer.type === 'parallelogram') {
        const pts = [
            { x: layer.x, y: layer.y + layer.height },
            { x: layer.x + layer.width, y: layer.y + layer.height },
            { x: layer.x + layer.width + layer.slantOffset, y: layer.y },
            { x: layer.x + layer.slantOffset, y: layer.y }
        ];
        return _polygonEdgesIntersectRect(pts, rx, ry, rw, rh);
    }

    // --- cone ---
    if (layer.type === 'cone') {
        const { cx, baseY, rx: crx, ry: cry, apex } = layer;
        if (_segmentIntersectsRect(cx - crx, baseY, apex.x, apex.y, rx, ry, rw, rh)) return true;
        if (_segmentIntersectsRect(cx + crx, baseY, apex.x, apex.y, rx, ry, rw, rh)) return true;
        return _ellipseIntersectsRect(cx, baseY, crx, cry || crx * 0.3, rx, ry, rw, rh);
    }

    // --- parallelepiped ---
    if (layer.type === 'parallelepiped') {
        const { x, y, width, height, depthOffset } = layer;
        const dx = depthOffset.x, dy = depthOffset.y;
        const edges = [
            [x, y, x + width, y], [x + width, y, x + width, y + height],
            [x + width, y + height, x, y + height], [x, y + height, x, y],
            [x, y, x + dx, y + dy], [x + width, y, x + width + dx, y + dy],
            [x + width, y + height, x + width + dx, y + height + dy], [x, y + height, x + dx, y + height + dy],
            [x + dx, y + dy, x + width + dx, y + dy], [x + width + dx, y + dy, x + width + dx, y + height + dy],
            [x + width + dx, y + height + dy, x + dx, y + height + dy], [x + dx, y + height + dy, x + dx, y + dy]
        ];
        for (const [ex1, ey1, ex2, ey2] of edges) {
            if (_segmentIntersectsRect(ex1, ey1, ex2, ey2, rx, ry, rw, rh)) return true;
        }
        return false;
    }

    // --- pyramid ---
    if (layer.type === 'pyramid') {
        const { base, apex } = layer;
        const basePts = [base.p1, base.p2, base.p3, base.p4];
        if (_polygonEdgesIntersectRect(basePts, rx, ry, rw, rh)) return true;
        for (const bp of basePts) {
            if (_segmentIntersectsRect(bp.x, bp.y, apex.x, apex.y, rx, ry, rw, rh)) return true;
        }
        return false;
    }

    // --- truncated-pyramid ---
    if (layer.type === 'truncated-pyramid') {
        const { base, top } = layer;
        const basePts = [base.p1, base.p2, base.p3, base.p4];
        const topPts = [top.p1, top.p2, top.p3, top.p4];
        if (_polygonEdgesIntersectRect(basePts, rx, ry, rw, rh)) return true;
        if (_polygonEdgesIntersectRect(topPts, rx, ry, rw, rh)) return true;
        for (let i = 0; i < 4; i++) {
            if (_segmentIntersectsRect(basePts[i].x, basePts[i].y, topPts[i].x, topPts[i].y, rx, ry, rw, rh)) return true;
        }
        return false;
    }

    // --- frustum ---
    if (layer.type === 'frustum') {
        const { cx, baseY, topY, rx1, ry1, rx2, ry2 } = layer;
        if (_segmentIntersectsRect(cx - rx1, baseY, cx - rx2, topY, rx, ry, rw, rh)) return true;
        if (_segmentIntersectsRect(cx + rx1, baseY, cx + rx2, topY, rx, ry, rw, rh)) return true;
        if (_ellipseIntersectsRect(cx, baseY, rx1, ry1 || rx1 * 0.3, rx, ry, rw, rh)) return true;
        if (_ellipseIntersectsRect(cx, topY, rx2, ry2 || rx2 * 0.3, rx, ry, rw, rh)) return true;
        return false;
    }

    // --- text / image / pdf: use bounding box (no stroke) ---
    if (['text', 'image', 'pdf'].includes(layer.type)) {
        const bbox = getBoundingBox(layer);
        return bbox ? doBoxesIntersect(bbox, selectionRect) : false;
    }

    // --- fallback: bounding box ---
    const bbox = getBoundingBox(layer);
    return bbox ? doBoxesIntersect(bbox, selectionRect) : false;
}