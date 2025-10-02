// --- START OF FILE js/shapeRecognizer.js ---

import { simplifyPath } from './utils.js';

/**
 * Получает ограничительную рамку для массива точек.
 */
function getBoundingBox(points) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    points.forEach(p => {
        minX = Math.min(minX, p.x);
        minY = Math.min(minY, p.y);
        maxX = Math.max(maxX, p.x);
        maxY = Math.max(maxY, p.y);
    });
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/**
 * Проверяет, является ли путь "почти замкнутым".
 * Допуск зависит от размера фигуры.
 */
function isPathClosed(points, box) {
    if (points.length < 3) return false;
    const tolerance = Math.hypot(box.width, box.height) * 0.25; // 25% от диагонали
    const first = points[0];
    const last = points[points.length - 1];
    return Math.hypot(first.x - last.x, first.y - last.y) < tolerance;
}

/**
 * Вспомогательная функция: вычисляет перпендикулярное расстояние от точки до отрезка.
 */
function perpendicularDistance(pt, p1, p2) {
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const lenSq = dx * dx + dy * dy;
    if (lenSq === 0) return Math.hypot(pt.x - p1.x, pt.y - p1.y);
    return Math.abs(dy * pt.x - dx * pt.y + p2.x * p1.y - p2.y * p1.x) / Math.sqrt(lenSq);
}

/**
 * Пытается распознать прямую линию.
 */
function recognizeLine(points) {
    const p1 = points[0];
    const p2 = points[points.length - 1];
    const directDistance = Math.hypot(p1.x - p2.x, p1.y - p2.y);
    
    if (directDistance < 30) return null;

    let maxDeviation = 0;
    for (let i = 1; i < points.length - 1; i++) {
        const deviation = perpendicularDistance(points[i], p1, p2);
        if (deviation > maxDeviation) {
            maxDeviation = deviation;
        }
    }

    if (maxDeviation < directDistance * 0.08) { // Допуск 8% от длины
        return {
            type: 'line',
            x1: p1.x, y1: p1.y,
            x2: p2.x, y2: p2.y,
            id: Date.now(), rotation: 0, pivot: { x: 0, y: 0 }
        };
    }
    
    return null;
}

/**
 * Пытается распознать эллипс или круг.
 */
function recognizeEllipse(points) {
    const box = getBoundingBox(points);
    const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    
    let totalError = 0;
    points.forEach(p => {
        const dx = p.x - center.x;
        const dy = p.y - center.y;
        if (box.width > 0 && box.height > 0) {
            const error = Math.abs(1 - ((dx * dx) / (box.width / 2) ** 2 + (dy * dy) / (box.height / 2) ** 2));
            totalError += error;
        }
    });
    const averageError = totalError / points.length;

    if (averageError < 0.4) {
        return {
            type: 'ellipse',
            cx: center.x, cy: center.y,
            rx: box.width / 2, ry: box.height / 2,
            id: Date.now(), rotation: 0, pivot: { x: 0, y: 0 }
        };
    }
    return null;
}

/**
 * Пытается распознать многоугольник (треугольник или прямоугольник).
 */
function recognizePolygon(points) {
    const box = getBoundingBox(points);
    const tolerance = Math.hypot(box.width, box.height) * 0.1;
    const simplified = simplifyPath(points, tolerance);

    // Если 3 или 4 точки (для треугольника)
    if (simplified.length === 3 || (simplified.length === 4 && isPathClosed(simplified, box))) {
        return {
            type: 'triangle',
            p1: simplified[0], p2: simplified[1], p3: simplified[2],
            id: Date.now(), rotation: 0, pivot: { x: 0, y: 0 }
        };
    }
    
    // Если 4 или 5 точек (для прямоугольника)
    if (simplified.length === 4 || (simplified.length === 5 && isPathClosed(simplified, box))) {
        return {
            type: 'rect',
            x: box.x, y: box.y,
            width: box.width, height: box.height,
            id: Date.now(), rotation: 0, pivot: { x: 0, y: 0 }
        };
    }
    return null;
}


/**
 * Главная функция, которая пытается распознать фигуру.
 */
export function recognizeShape(points) {
    if (points.length < 10) return null;
    const box = getBoundingBox(points);
    if (box.width < 20 && box.height < 20) return null;

    // --- НАЧАЛО НОВОЙ ЛОГИКИ С ПРАВИЛЬНЫМ ПОРЯДКОМ ---

    // 1. Проверяем, замкнута ли фигура.
    if (isPathClosed(points, box)) {
        // Если да, то это НЕ линия. Ищем среди замкнутых фигур.
        const analysisPoints = [...points, points[0]];
        
        // 2. Сначала ищем многоугольники, так как у них более строгие критерии (углы).
        let shape = recognizePolygon(analysisPoints);
        if (shape) return shape;

        // 3. Если это не многоугольник, проверяем на эллипс.
        shape = recognizeEllipse(analysisPoints);
        if (shape) return shape;

    } else {
        // 4. Если фигура НЕ замкнута, это может быть только линия.
        let shape = recognizeLine(points);
        if (shape) return shape;
    }
    
    // --- КОНЕЦ НОВОЙ ЛОГИКИ ---

    return null;
}
// --- END OF FILE js/shapeRecognizer.js ---