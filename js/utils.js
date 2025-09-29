// --- START OF FILE utils.js ---

import { getBoundingBox, rotatePoint } from './geometry.js';

const GRID_SPACING = 20;

export function snapToGrid(value) {
    return Math.round(value / GRID_SPACING) * GRID_SPACING;
}

export function processImageFile(file, position, canvasState, redrawCallback, saveState) {
    if (!file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
            const newLayer = { type: 'image', image: img, x: position.x - img.width / 2, y: position.y - img.height / 2, width: img.width, height: img.height, id: Date.now(), rotation: 0, pivot: { x: 0, y: 0 } };
            canvasState.layers.push(newLayer);
            saveState(canvasState.layers);
            redrawCallback();
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
}

export function applyTransformations(layer) {
    if (!layer || (!layer.rotation && (!layer.pivot || (layer.pivot.x === 0 && layer.pivot.y === 0)))) {
        return;
    }

    const rotation = layer.rotation || 0;
    const pivot = layer.pivot || { x: 0, y: 0 };
    const box = getBoundingBox(layer);
    if (!box) return;

    const centerX = box.x + box.width / 2;
    const centerY = box.y + box.height / 2;

    const rotatedPivotOffset = rotatePoint(pivot, { x: 0, y: 0 }, rotation);
    const pivotPoint = {
        x: centerX + rotatedPivotOffset.x,
        y: centerY + rotatedPivotOffset.y,
    };

    const rotate = (p) => rotatePoint(p, pivotPoint, rotation);

    const layerProps = Object.keys(layer);
    for (const prop of layerProps) {
        if (layer[prop] && typeof layer[prop] === 'object' && layer[prop].hasOwnProperty('x') && layer[prop].hasOwnProperty('y')) {
             const newPoint = rotate(layer[prop]);
             layer[prop].x = newPoint.x;
             layer[prop].y = newPoint.y;
        }
    }

    if (layer.points) {
        layer.points.forEach(p => {
            const newPoint = rotate(p);
            p.x = newPoint.x;
            p.y = newPoint.y;
        });
    }

    if (layer.hasOwnProperty('x') && layer.hasOwnProperty('y')) {
        const newCenter = rotate({ x: centerX, y: centerY });
        const dx = newCenter.x - centerX;
        const dy = newCenter.y - centerY;
        layer.x += dx;
        layer.y += dy;
    }
    if (layer.hasOwnProperty('cx') && layer.hasOwnProperty('cy')) {
        const newCenter = rotate({ x: layer.cx, y: layer.cy });
        layer.cx = newCenter.x;
        layer.cy = newCenter.y;
    }
     if (layer.hasOwnProperty('x1') && layer.hasOwnProperty('y1')) {
        const newP1 = rotate({ x: layer.x1, y: layer.y1 });
        const newP2 = rotate({ x: layer.x2, y: layer.y2 });
        layer.x1 = newP1.x; layer.y1 = newP1.y;
        layer.x2 = newP2.x; layer.y2 = newP2.y;
    }
     if (layer.baseY) {
        const newBaseCenter = rotate({ x: layer.cx, y: layer.baseY });
        const dy = newBaseCenter.y - layer.baseY;
        layer.baseY += dy;
        if(layer.topY) layer.topY += dy;
     }

    layer.rotation = 0;
    layer.pivot = { x: 0, y: 0 };
}


// --- НАЧАЛО ИЗМЕНЕНИЙ: Алгоритм сглаживания линий ---

/**
 * Вычисляет перпендикулярное расстояние от точки до отрезка прямой.
 * @param {object} pt - Точка {x, y}.
 * @param {object} p1 - Начало отрезка {x, y}.
 * @param {object} p2 - Конец отрезка {x, y}.
 * @returns {number} - Расстояние.
 */
function perpendicularDistance(pt, p1, p2) {
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const lenSq = dx * dx + dy * dy;
    if (lenSq === 0) {
        return Math.hypot(pt.x - p1.x, pt.y - p1.y);
    }
    const t = ((pt.x - p1.x) * dx + (pt.y - p1.y) * dy) / lenSq;
    const clampedT = Math.max(0, Math.min(1, t));
    const closestX = p1.x + clampedT * dx;
    const closestY = p1.y + clampedT * dy;
    return Math.hypot(pt.x - closestX, pt.y - closestY);
}

/**
 * Упрощает путь с помощью алгоритма Рамера-Дугласа-Пойкера.
 * @param {Array<object>} points - Массив точек.
 * @param {number} tolerance - Допустимое отклонение. Чем больше, тем сильнее сглаживание.
 * @returns {Array<object>} - Упрощенный массив точек.
 */
export function simplifyPath(points, tolerance) {
    if (points.length < 3) {
        return points;
    }

    let dmax = 0;
    let index = 0;
    const end = points.length - 1;

    for (let i = 1; i < end; i++) {
        const d = perpendicularDistance(points[i], points[0], points[end]);
        if (d > dmax) {
            index = i;
            dmax = d;
        }
    }

    if (dmax > tolerance) {
        const recResults1 = simplifyPath(points.slice(0, index + 1), tolerance);
        const recResults2 = simplifyPath(points.slice(index), tolerance);
        
        return recResults1.slice(0, recResults1.length - 1).concat(recResults2);
    } else {
        return [points[0], points[end]];
    }
}
// --- КОНЕЦ ИЗМЕНЕНИЙ ---
// --- END OF FILE utils.js ---