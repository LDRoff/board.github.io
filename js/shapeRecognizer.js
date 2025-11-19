// --- START OF FILE js/shapeRecognizer.js ---

import { simplifyPath } from './utils.js';

function getBoundingBox(points) {
    if (points.length < 2) return { x: 0, y: 0, width: 0, height: 0 };
    let minX = points[0], minY = points[1], maxX = points[0], maxY = points[1];
    for (let i = 2; i < points.length; i += 2) {
        minX = Math.min(minX, points[i]); minY = Math.min(minY, points[i + 1]);
        maxX = Math.max(maxX, points[i]); maxY = Math.max(maxY, points[i + 1]);
    }
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function isPathClosed(points, box) {
    if (points.length < 4) return false;
    const tolerance = Math.hypot(box.width, box.height) * 0.25;
    return Math.hypot(points[0] - points[points.length - 2], points[1] - points[points.length - 1]) < tolerance;
}

// --- НАЧАЛО ИЗМЕНЕНИЙ: Добавляем функцию для расчета длины пути ---
function getPathLength(points) {
    let length = 0;
    for (let i = 2; i < points.length; i += 2) {
        length += Math.hypot(points[i] - points[i - 2], points[i + 1] - points[i - 1]);
    }
    return length;
}
// --- КОНЕЦ ИЗМЕНЕНИЙ ---

/**
 * Главная и единственная функция распознавания.
 */
export function recognizeShape(points, hasPressure) {
    const step = hasPressure ? 3 : 2;
    const xyPoints = [];
    for (let i = 0; i < points.length; i += step) {
        xyPoints.push(points[i], points[i + 1]);
    }

    if (xyPoints.length < 10) return null;

    const boundingBox = getBoundingBox(xyPoints);
    if (boundingBox.width < 20 && boundingBox.height < 20) return null;

    const isClosed = isPathClosed(xyPoints, boundingBox);
    const commonProps = { id: Date.now(), rotation: 0, pivot: { x: 0, y: 0 } };

    const tolerance = Math.hypot(boundingBox.width, boundingBox.height) * 0.15;
    const simplifiedRaw = simplifyPath(xyPoints, tolerance);
    const vertexCount = simplifiedRaw.length / 2;
    
    let scores = {
        line: 0,
        triangle: 0,
        rectangle: 0,
        ellipse: 0
    };

    if (isClosed) {
        if (vertexCount === 3 || (vertexCount === 4 && isPathClosed(simplifiedRaw, getBoundingBox(simplifiedRaw)))) {
            scores.triangle = 0.9;
        }

        if (vertexCount === 4 || (vertexCount === 5 && isPathClosed(simplifiedRaw, getBoundingBox(simplifiedRaw)))) {
            scores.rectangle = 0.9;
        }

        const center = { x: boundingBox.x + boundingBox.width / 2, y: boundingBox.y + boundingBox.height / 2 };
        const rx = boundingBox.width / 2;
        const ry = boundingBox.height / 2;
        if (rx > 0 && ry > 0) {
            let totalError = 0;
            for (let i = 0; i < xyPoints.length; i += 2) {
                const dx = xyPoints[i] - center.x;
                const dy = xyPoints[i + 1] - center.y;
                totalError += Math.abs(1 - ((dx * dx) / (rx * rx) + (dy * dy) / (ry * ry)));
            }
            const averageError = totalError / (xyPoints.length / 2);
            scores.ellipse = Math.max(0, 1 - averageError);
        }
    } else {
        // --- НАЧАЛО ИЗМЕНЕНИЙ: Улучшаем логику распознавания линии ---
        if (vertexCount === 2) {
            const pathLength = getPathLength(xyPoints);
            const directDistance = Math.hypot(xyPoints[0] - xyPoints[xyPoints.length - 2], xyPoints[1] - xyPoints[xyPoints.length - 1]);
            
            if (pathLength > 0) {
                const straightness = directDistance / pathLength;
                // Оценка зависит от прямолинейности. Только очень прямые линии получат высокий балл.
                if (straightness > 0.98) {
                    scores.line = 0.95;
                } else if (straightness > 0.9) {
                    scores.line = 0.7; // Менее прямая линия получит балл ниже порога
                }
            }
        }
        // --- КОНЕЦ ИЗМЕНЕНИЙ ---
    }

    let bestShape = 'none';
    let maxScore = 0.8; // --- ИЗМЕНЕНИЕ: Устанавливаем более высокий общий порог
    for (const shape in scores) {
        if (scores[shape] > maxScore) {
            maxScore = scores[shape];
            bestShape = shape;
        }
    }

    switch (bestShape) {
        case 'line':
            return {
                type: 'line',
                x1: xyPoints[0], y1: xyPoints[1],
                x2: xyPoints[xyPoints.length - 2], y2: xyPoints[xyPoints.length - 1],
                ...commonProps
            };
        case 'triangle':
            return {
                type: 'triangle',
                p1: { x: simplifiedRaw[0], y: simplifiedRaw[1] },
                p2: { x: simplifiedRaw[2], y: simplifiedRaw[3] },
                p3: { x: simplifiedRaw[4], y: simplifiedRaw[5] },
                ...commonProps
            };
        case 'rectangle':
            return {
                type: 'rect',
                x: boundingBox.x, y: boundingBox.y,
                width: boundingBox.width, height: boundingBox.height,
                ...commonProps
            };
        case 'ellipse':
            return {
                type: 'ellipse',
                cx: boundingBox.x + boundingBox.width / 2,
                cy: boundingBox.y + boundingBox.height / 2,
                rx: boundingBox.width / 2,
                ry: boundingBox.height / 2,
                ...commonProps
            };
        default:
            return null;
    }
}
// --- END OF FILE js/shapeRecognizer.js ---