// --- START OF FILE js/hitTest.js ---

import * as geo from './geometry.js';
import { getLayersInProximity } from './utils.js';

// ... (getLayerAtPosition, getSelectionRotation, getHandleAtPosition без изменений) ...

export function getLayerAtPosition(pos, layers, zoom, spatialGrid, eraserRadius = 0, onlyOutline = false) {
    // ИГНОРИРУЕМ spatialGrid для гарантированной точности.
    // Перебор массива layers работает очень быстро.
    const candidates = layers;

    // Ищем в обратном порядке, чтобы сначала найти верхние слои
    for (let i = candidates.length - 1; i >= 0; i--) {
        const layer = candidates[i];

        // 1. Получаем центр вращения
        const center = geo.getRotationCenter(layer);

        let pivotX, pivotY;
        let box = null;

        if (center) {
            const pivot = layer.pivot || { x: 0, y: 0 };
            pivotX = center.x + pivot.x;
            pivotY = center.y + pivot.y;
        } else {
            // Fallback, если центр не определен геометрически
            box = geo.getBoundingBox(layer);
            if (!box) continue;
            const pivot = layer.pivot || { x: 0, y: 0 };
            pivotX = box.x + box.width / 2 + pivot.x;
            pivotY = box.y + box.height / 2 + pivot.y;
        }

        const rotation = layer.rotation || 0;

        // 2. Вращаем точку клика в обратную сторону вокруг пивота объекта.
        // Это переводит точку клика в локальную систему координат объекта (где он не повернут).
        const cos = Math.cos(-rotation);
        const sin = Math.sin(-rotation);
        const dx = pos.x - pivotX;
        const dy = pos.y - pivotY;

        const rotatedPos = {
            x: dx * cos - dy * sin + pivotX,
            y: dx * sin + dy * cos + pivotY
        };

        // Если box еще не вычислен, вычисляем его сейчас для проверки Rect
        if (!box) {
            box = geo.getBoundingBox(layer);
            if (!box) continue;
        }

        let hit = false;

        // Evaluate whether the shape has a solid fill or is transparent
        const isFilled = layer.fillColor && layer.fillColor !== 'transparent';
        const checkOutline = onlyOutline && !isFilled;

        // 3. Проверяем попадание точки в невращенный объект
        if (layer.type === 'path') {
            hit = geo.isPointOnPath(rotatedPos, layer, zoom, eraserRadius);
        }
        else if (layer.type === 'curve') {
            hit = geo.isPointOnCurve(rotatedPos, layer, zoom, eraserRadius);
        }
        else if (['text', 'image', 'pdf'].includes(layer.type)) {
            // Text, images, and PDFs should be erasable by clicking anywhere inside their bounds
            hit = geo.isPointInRect(rotatedPos, box, eraserRadius, false);
        }
        else if (layer.type === 'rect') {
            const lineWidth = layer.lineWidth || 2;
            hit = geo.isPointInRect(rotatedPos, box, eraserRadius, checkOutline, lineWidth);
        }
        else if (layer.type === 'sphere' || layer.type === 'truncated-sphere') {
            const rx = layer.rx ?? layer.r;
            const ry = layer.ry ?? layer.r;
            hit = geo.isPointInEllipse(rotatedPos, { cx: layer.cx, cy: layer.cy, rx, ry, lineWidth: layer.lineWidth }, eraserRadius, checkOutline);
        }
        else if (layer.type === 'ellipse') {
            hit = geo.isPointInEllipse(rotatedPos, layer, eraserRadius, checkOutline);
        }
        else if (layer.type === 'line') {
            hit = geo.isPointOnLineSegment(rotatedPos, layer, zoom, eraserRadius);
        }
        else if (layer.type === 'parallelogram') {
            hit = geo.isPointInParallelogram(rotatedPos, layer, eraserRadius, checkOutline, layer.lineWidth || 2);
        }
        else if (layer.type === 'triangle') {
            hit = geo.isPointInTriangle(rotatedPos, layer.p1, layer.p2, layer.p3, eraserRadius, checkOutline, layer.lineWidth || 2);
        }
        else if (layer.type === 'cone') {
            hit = geo.isPointInCone(rotatedPos, layer, eraserRadius, checkOutline, layer.lineWidth || 2);
        }
        else if (layer.type === 'parallelepiped') {
            hit = geo.isPointInParallelepiped(rotatedPos, layer, eraserRadius, checkOutline, layer.lineWidth || 2);
        }
        else if (layer.type === 'pyramid') {
            hit = geo.isPointInPyramid(rotatedPos, layer, eraserRadius, checkOutline, layer.lineWidth || 2);
        }
        else if (layer.type === 'trapezoid' || layer.type === 'rhombus') {
            hit = geo.isPointInPolygon(rotatedPos, [layer.p1, layer.p2, layer.p3, layer.p4], eraserRadius, checkOutline, layer.lineWidth || 2);
        }
        else if (layer.type === 'frustum') {
            hit = geo.isPointInFrustum(rotatedPos, layer, eraserRadius, checkOutline, layer.lineWidth || 2);
        }
        else if (layer.type === 'truncated-pyramid') {
            const { base, top } = layer;
            const faces = [[base.p1, base.p2, base.p3, base.p4], [top.p1, top.p2, top.p3, top.p4], [base.p1, base.p2, top.p2, top.p1], [base.p2, base.p3, top.p3, top.p2], [base.p3, base.p4, top.p4, top.p3], [base.p4, base.p1, top.p1, top.p4]];
            for (const face of faces) {
                if (geo.isPointInPolygon(rotatedPos, face, eraserRadius, checkOutline, layer.lineWidth || 2)) {
                    hit = true;
                    break;
                }
            }
        } else {
            hit = geo.isPointInRect(rotatedPos, box, eraserRadius, onlyOutline);
        }

        if (hit) return layer;
    }
    return null;
}

// --- НАЧАЛО ИЗМЕНЕНИЙ: Оптимизация для ластика ---
/**
 * Оптимизированный поиск слоя для ластика.
 * Использует Spatial Grid для получения списка кандидатов (вместо перебора всех слоев).
 */
export function getLayerForEraser(pos, layers, zoom, spatialGrid, bboxCache, eraserWidth = 40) {
    // 1. Получаем список кандидатов из Spatial Grid (ближайшие объекты)
    // Если сетка не инициализирована (например, при старте), используем полный список.
    const candidates = (spatialGrid && spatialGrid.size > 0) ? getLayersInProximity(spatialGrid, pos, zoom) : layers;

    // Размер "пятна" ластика должен точно совпадать с размером курсора в ui.js: Math.max(10, eraserWidth * zoom)
    // Делим на 2 для радиуса в экранных координатах, и на zoom для перевода в мировые координаты холста
    const screenEraserDiameter = Math.max(10, eraserWidth * zoom);
    const eraserRadius = (screenEraserDiameter / 2) / zoom;

    const eraserRect = {
        x: pos.x - eraserRadius,
        y: pos.y - eraserRadius,
        width: eraserRadius * 2,
        height: eraserRadius * 2
    };

    // Ищем в обратном порядке (сверху вниз)
    for (let i = candidates.length - 1; i >= 0; i--) {
        const layer = candidates[i];

        // 2. Broad-phase: Проверка кэшированного BBox
        let bbox = bboxCache ? bboxCache.get(layer.id) : null;
        if (!bbox) {
            bbox = geo.getTransformedBoundingBox(layer);
            if (bbox && bboxCache) {
                bboxCache.set(layer.id, bbox);
            }
        }

        if (bbox) {
            if (!geo.doBoxesIntersect(bbox, eraserRect)) {
                continue;
            }
        }

        // 3. Narrow-phase: Точная проверка
        // Для ластика передаем onlyOutline = true (будет стирать только при касании линии для фигур без заливки)
        const hitLayer = getLayerAtPosition(pos, [layer], zoom, null, eraserRadius, true);
        if (hitLayer) {
            return hitLayer;
        }
    }
    return null;
}
// --- КОНЕЦ ИЗМЕНЕНИЙ ---

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
// --- END OF FILE js/hitTest.js ---