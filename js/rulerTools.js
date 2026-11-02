// --- START OF FILE js/rulerTools.js ---
// Угольники с фиксированными углами: 45–45–90 и 30–60–90.
//
// Здесь собрана вся геометрия инструмента, чтобы отрисовка, попадание,
// панель настроек и привязка считали одно и то же и не расходились.
//
// Локальные координаты угольника: прямой угол в точке (0, 0),
// длинный катет идёт по +X, второй катет — по -Y (вверх по экрану).
// Поэтому гипотенуза соединяет P = (A, 0) и Q = (0, -B),
// где A — длинный катет, B — второй катет (для 45–45–90 A = B).

import { PAGE_PX_PER_MM } from './pages.js?v=1.4.19';

// 1 мм в мировых координатах доски (как у листов из pages.js).
export const MM = PAGE_PX_PER_MM;
export const CM = MM * 10;

export const TRIANGLE45 = 'triangle45';
export const TRIANGLE30 = 'triangle30';

// Размер = длинный катет в сантиметрах. Значения совпадают с линейкой.
export const TRIANGLE_SIZES_CM = [5, 8, 10, 12, 15, 20, 25, 30];
export const DEFAULT_TRIANGLE_SIZE = 10 * CM;
export const MIN_TRIANGLE_SIZE = 3 * CM;
export const MAX_TRIANGLE_SIZE = 40 * CM;

export function isTriangleRuler(ruler) {
    return !!ruler && (ruler.type === TRIANGLE45 || ruler.type === TRIANGLE30);
}

export function clampSize(size) {
    const s = Number(size);
    if (!Number.isFinite(s) || s <= 0) return DEFAULT_TRIANGLE_SIZE;
    return Math.max(MIN_TRIANGLE_SIZE, Math.min(MAX_TRIANGLE_SIZE, s));
}

// Начальный размер: берём самый крупный «круглый» размер из списка,
// который ещё помещается на экране (на телефоне это 5 см, на ноутбуке 10 см).
export function pickDefaultSize(maxSize) {
    const limit = Number.isFinite(maxSize) && maxSize > 0 ? maxSize : Infinity;
    let best = TRIANGLE_SIZES_CM[0] * CM;
    for (const cm of TRIANGLE_SIZES_CM) {
        if (cm * CM <= limit) best = cm * CM;
    }
    return clampSize(best);
}

// Углы при вершинах: atP — у конца длинного катета, atQ — у конца короткого.
export function getTriangleAngles(ruler) {
    return (ruler && ruler.type === TRIANGLE30)
        ? { atP: 30, atQ: 60 }
        : { atP: 45, atQ: 45 };
}

export function getTriangleGeometry(ruler) {
    const A = clampSize(ruler && ruler.size);
    const B = (ruler && ruler.type === TRIANGLE30) ? A / Math.sqrt(3) : A;
    const H = Math.hypot(A, B);
    // Центр вписанной окружности — по нему удобно ставить подписи углов.
    const k = (A * B) / (A + B + H);
    return {
        A,
        B,
        H,
        O: { x: 0, y: 0 },
        P: { x: A, y: 0 },
        Q: { x: 0, y: -B },
        M: { x: A / 2, y: -B / 2 },          // середина гипотенузы
        normal: { x: B / H, y: -A / H },     // наружу от гипотенузы
        tangent: { x: -A / H, y: -B / H },   // от P к Q
        incenter: { x: k, y: -k },
    };
}

// Попадание в корпус (локальные координаты).
export function isPointInTriangle(localX, localY, geom) {
    if (localX < 0 || localY > 0) return false;
    return (localX / geom.A) + (-localY / geom.B) <= 1;
}

// Экранные ручки инструмента. scaleFactor = 1 / zoom, как у линейки:
// размеры ручек не зависят от масштаба доски.
export function getTriangleHandles(ruler, scaleFactor) {
    const g = getTriangleGeometry(ruler);
    const sf = scaleFactor;
    const n = g.normal;
    const t = g.tangent;
    return {
        // Изменение размера — от середины гипотенузы наружу.
        resize: {
            x: g.M.x + n.x * 20 * sf,
            y: g.M.y + n.y * 20 * sf,
        },
        // Кнопки — над гипотенузой, как у транспортира над дугой.
        delete: {
            x: g.M.x + n.x * 48 * sf - t.x * 22 * sf,
            y: g.M.y + n.y * 48 * sf - t.y * 22 * sf,
        },
        settings: {
            x: g.M.x + n.x * 48 * sf + t.x * 22 * sf,
            y: g.M.y + n.y * 48 * sf + t.y * 22 * sf,
        },
        // Поворот — за концы катетов, как у линейки за торцы.
        rotateP: { x: g.P.x + 10 * sf, y: g.P.y },
        rotateQ: { x: g.Q.x, y: g.Q.y - 10 * sf },
    };
}

// Подписи углов внутри корпуса: 90°, 45°/45° или 90°, 30°/60°.
// Ставим их по биссектрисе на 30% пути к центру вписанной окружности:
// у острого угла подпись остаётся рядом с вершиной, а не уезжает в середину.
export function getTriangleAngleLabels(ruler) {
    const g = getTriangleGeometry(ruler);
    const angles = getTriangleAngles(ruler);
    const inset = (v) => ({
        x: v.x + (g.incenter.x - v.x) * 0.30,
        y: v.y + (g.incenter.y - v.y) * 0.30,
    });
    return [
        { text: '90°', x: inset(g.O).x, y: inset(g.O).y },
        { text: `${angles.atP}°`, x: inset(g.P).x, y: inset(g.P).y },
        { text: `${angles.atQ}°`, x: inset(g.Q).x, y: inset(g.Q).y },
    ];
}

export function getTriangleOutline(ruler) {
    const g = getTriangleGeometry(ruler);
    return [g.O, g.P, g.Q];
}

export function getTriangleEdgesLocal(ruler) {
    const g = getTriangleGeometry(ruler);
    return [
        { ax: g.O.x, ay: g.O.y, bx: g.P.x, by: g.P.y },
        { ax: g.O.x, ay: g.O.y, bx: g.Q.x, by: g.Q.y },
        { ax: g.P.x, ay: g.P.y, bx: g.Q.x, by: g.Q.y },
    ];
}

export function closestPointOnSegment(px, py, ax, ay, bx, by) {
    const dx = bx - ax;
    const dy = by - ay;
    const lenSq = dx * dx + dy * dy;
    let t = lenSq > 0 ? ((px - ax) * dx + (py - ay) * dy) / lenSq : 0;
    if (t < 0) t = 0;
    if (t > 1) t = 1;
    return { x: ax + dx * t, y: ay + dy * t, t };
}

// Новый инструмент: x, y — точка, вокруг которой ставим корпус
// (середина корпуса, а не прямой угол).
export function createTriangleRuler(type, x, y, size = DEFAULT_TRIANGLE_SIZE) {
    const actualSize = clampSize(size);
    const g = getTriangleGeometry({ type, size: actualSize });
    return {
        id: `${type}_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
        type,
        x: x - g.A / 2,
        y: y + g.B / 2,
        angle: 0,
        size: actualSize,
        pivotOffset: 0,
        pivotOffsetY: 0,
        snapEnabled: false,
        snapAngle: 15,
        color: null,
    };
}
// --- END OF FILE js/rulerTools.js ---
