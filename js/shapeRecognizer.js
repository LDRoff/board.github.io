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
 * Главная функция, которая пытается распознать фигуру.
 * Она использует новый, более надежный подход.
 */
export function recognizeShape(points) {
    if (points.length < 10) return null;

    const box = getBoundingBox(points);
    if (box.width < 20 && box.height < 20) return null; // Слишком маленькая фигура для анализа

    // 1. Упрощаем линию, чтобы найти ключевые "углы".
    // Допуск для упрощения зависит от размера фигуры, что делает его гибким.
    const tolerance = Math.hypot(box.width, box.height) * 0.1;
    const simplified = simplifyPath(points, tolerance);

    // 2. Анализируем результат упрощения.
    
    // Если осталось 2 точки - это, скорее всего, ПРЯМАЯ ЛИНИЯ.
    if (simplified.length === 2) {
        // Дополнительная проверка, чтобы не спутать с плавной кривой
        const pathLength = points.reduce((len, p, i) => i === 0 ? 0 : len + Math.hypot(p.x - points[i-1].x, p.y - points[i-1].y), 0);
        const directDistance = Math.hypot(simplified[0].x - simplified[1].x, simplified[0].y - simplified[1].y);
        if (pathLength < directDistance * 1.3) {
            return {
                type: 'line',
                x1: simplified[0].x, y1: simplified[0].y,
                x2: simplified[1].x, y2: simplified[1].y,
                id: Date.now(), rotation: 0, pivot: { x: 0, y: 0 }
            };
        }
    }

    // Проверяем, замкнута ли фигура. Если нет, дальше не идем.
    if (!isPathClosed(points, box)) return null;

    // Если после упрощения осталось 3 или 4 точки (и первая/последняя почти совпадают) - это ТРЕУГОЛЬНИК.
    if (simplified.length === 3 || (simplified.length === 4 && Math.hypot(simplified[0].x - simplified[3].x, simplified[0].y - simplified[3].y) < tolerance * 2)) {
         return {
            type: 'triangle',
            p1: simplified[0], p2: simplified[1], p3: simplified[2],
            id: Date.now(), rotation: 0, pivot: { x: 0, y: 0 }
        };
    }

    // Если после упрощения осталось 4 или 5 точек - это ПРЯМОУГОЛЬНИК.
    if (simplified.length === 4 || (simplified.length === 5 && Math.hypot(simplified[0].x - simplified[4].x, simplified[0].y - simplified[4].y) < tolerance * 2)) {
        return {
            type: 'rect',
            x: box.x, y: box.y,
            width: box.width, height: box.height,
            id: Date.now(), rotation: 0, pivot: { x: 0, y: 0 }
        };
    }

    // Если углов много, это, скорее всего, плавная фигура. Проверяем на ЭЛЛИПС.
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
    
    // Если ничего не подошло, это просто кривая линия.
    return null;
}
// --- END OF FILE js/shapeRecognizer.js ---