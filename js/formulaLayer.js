// --- START OF FILE js/formulaLayer.js ---
// Формула как объект доски.
//
// Слой типа 'formula' хранит дерево формулы и картинку-кэш, которую рисует
// renderer (как у текста и картинок). Растеризуем через SVG <foreignObject>,
// поэтому формула попадает и в PNG/PDF, и в миниатюры, и в экспорт страниц.

import {
    formulaToHtml, mathToPlain, normalizeRow, isMathEmpty, plainTextOf, mathToAttr,
} from './mathModel.js?v=1.4.19';
import { openMathEditor } from './mathEditor.js?v=1.4.19';
import { cloneLayersForAction } from './utils.js?v=1.4.19';

const RENDER_SCALE = 3; // запас чёткости при увеличении доски

export function defaultFormulaColor() {
    return document.body.classList.contains('dark-theme') ? '#f1f5f9' : '#111827';
}

function measureHtml(html) {
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;left:-10000px;top:-10000px;visibility:hidden;pointer-events:none;white-space:pre;';
    host.innerHTML = html;
    document.body.appendChild(host);
    const target = host.firstElementChild || host;
    const rect = target.getBoundingClientRect();
    const size = {
        width: Math.max(8, Math.ceil(rect.width)),
        height: Math.max(8, Math.ceil(rect.height)),
    };
    host.remove();
    return size;
}

export function measureFormula(math, fontSize, color = '#111827') {
    return measureHtml(formulaToHtml(normalizeRow(math), { fontSize, color }));
}

function formulaSvg(html, width, height, scale) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.ceil(width * scale)}" height="${Math.ceil(height * scale)}" viewBox="0 0 ${width} ${height}">`
        + `<foreignObject x="0" y="0" width="${width}" height="${height}">`
        + `<div xmlns="http://www.w3.org/1999/xhtml" style="width:${width}px;height:${height}px;margin:0;padding:0;display:flex;align-items:center;justify-content:center;background:transparent;overflow:visible;">${html}</div>`
        + `</foreignObject></svg>`;
}

function htmlToImage(html, width, height, scale) {
    return new Promise((resolve) => {
        try {
            const svg = formulaSvg(html, width, height, scale);
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = () => resolve(null);
            img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svg)));
        } catch (e) {
            console.warn('formula raster failed', e);
            resolve(null);
        }
    });
}

export function renderFormulaImage(layer) {
    const width = layer.naturalWidth || layer.width || 100;
    const height = layer.naturalHeight || layer.height || 40;
    const html = formulaToHtml(layer.math, { fontSize: layer.fontSize, color: layer.color });
    return htmlToImage(html, width, height, RENDER_SCALE);
}

// Пересобрать картинку, если её нет (после загрузки доски).
export async function ensureFormulaImages(canvasState) {
    if (!canvasState || !Array.isArray(canvasState.layers)) return;
    const pending = canvasState.layers.filter((l) => l && l.type === 'formula' && !l.cachedImage);
    if (pending.length === 0) return;
    for (const layer of pending) {
        if (!layer.naturalWidth || !layer.naturalHeight) {
            const nat = measureFormula(layer.math, layer.fontSize, layer.color);
            layer.naturalWidth = nat.width;
            layer.naturalHeight = nat.height;
            if (!layer.width) layer.width = nat.width;
            if (!layer.height) layer.height = nat.height;
        }
        layer.cachedImage = await renderFormulaImage(layer);
    }
    if (canvasState.redraw) canvasState.redraw();
}

// После масштабирования: рендерим формулу под новый размер, чтобы она
// не растягивалась пикселями, а пересобиралась в нужном кегле.
export async function refreshFormulaResolution(layer) {
    if (!layer || layer.type !== 'formula' || !layer.math) return;
    const natural = layer.naturalWidth || layer.width;
    if (!natural || !layer.width) return;

    const k = layer.width / natural;
    if (!Number.isFinite(k) || k <= 0 || Math.abs(k - 1) < 0.03) return;

    const newFont = Math.max(6, (layer.fontSize || 40) * k);
    const size = measureFormula(layer.math, newFont, layer.color);

    layer.fontSize = newFont;
    layer.naturalWidth = size.width;
    layer.naturalHeight = size.height;
    layer.cachedImage = await renderFormulaImage(layer);
}

export async function createFormulaLayer(math, opts = {}) {
    const clean = normalizeRow(math);
    const fontSize = opts.fontSize || 40;
    const color = opts.color || defaultFormulaColor();
    const nat = measureFormula(clean, fontSize, color);

    const layer = {
        id: `formula_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
        type: 'formula',
        x: Math.round((opts.x || 0) - nat.width / 2),
        y: Math.round((opts.y || 0) - nat.height / 2),
        width: nat.width,
        height: nat.height,
        naturalWidth: nat.width,
        naturalHeight: nat.height,
        math: clean,
        fontSize,
        color,
        rotation: 0,
        cachedImage: null,
    };

    layer.cachedImage = await renderFormulaImage(layer);
    return layer;
}

// Добавляем слой на доску: сетка, история, выделение, перерисовка.
export function addLayerToBoard(canvasState, layer) {    if (!canvasState || !layer) return;
    canvasState.layers.push(layer);

    if (canvasState.spatialGrid) {
        const pad = 4;
        const box = {
            x: layer.x - pad,
            y: layer.y - pad,
            width: (layer.width || 0) + pad * 2,
            height: (layer.height || 0) + pad * 2,
        };
        const startCol = Math.floor(box.x / 500);
        const endCol = Math.floor((box.x + box.width) / 500);
        const startRow = Math.floor(box.y / 500);
        const endRow = Math.floor((box.y + box.height) / 500);
        for (let row = startRow; row <= endRow; row++) {
            for (let col = startCol; col <= endCol; col++) {
                const key = `${col}_${row}`;
                if (!canvasState.spatialGrid.has(key)) canvasState.spatialGrid.set(key, []);
                canvasState.spatialGrid.get(key).push(layer);
            }
        }
    }

    if (canvasState.tileManager) canvasState.tileManager.clear();
    if (canvasState.saveState) {
        canvasState.saveState({ type: 'creation', before: [], after: [layer] });
    }
    if (canvasState.performDeselect) canvasState.performDeselect();
    canvasState.selectedLayers = [layer];
    if (canvasState.updateFloatingToolbar) canvasState.updateFloatingToolbar();
    if (canvasState.redraw) canvasState.redraw();
    if (canvasState.saveViewState) canvasState.saveViewState();
}

export async function insertFormulaLayer(canvasState, math, opts = {}) {
    const layer = await createFormulaLayer(math, opts);
    addLayerToBoard(canvasState, layer);

    // Если попросили график — сразу строим его справа от формулы.
    if (opts.withGraph) {
        const { insertPlotFromMath } = await import('./plotLayer.js?v=1.4.19');
        insertPlotFromMath(canvasState, math, {
            x: layer.x + (layer.width || 200) + 60 + 260,
            y: layer.y + 210,
        });
    }
    return layer;
}

// Обновление существующего слоя после правки формулы.
export async function applyMathToFormulaLayer(canvasState, layer, math) {
    if (!canvasState || !layer) return;
    const before = cloneLayersForAction([layer]);
    const scale = (layer.naturalWidth > 0 && layer.width > 0) ? layer.width / layer.naturalWidth : 1;

    layer.math = normalizeRow(math);
    const nat = measureFormula(layer.math, layer.fontSize, layer.color);
    layer.naturalWidth = nat.width;
    layer.naturalHeight = nat.height;
    layer.width = Math.max(8, nat.width * scale);
    layer.height = Math.max(8, nat.height * scale);
    layer.cachedImage = await renderFormulaImage(layer);

    if (canvasState.tileManager) canvasState.tileManager.invalidateLayer(layer, canvasState);
    const after = cloneLayersForAction([layer]);
    if (canvasState.saveState) canvasState.saveState({ type: 'update', before, after });
    if (canvasState.redraw) canvasState.redraw();
}

// ------------------------------------------------------------- диалоги

export function openNewFormulaDialog(canvasState, opts = {}) {
    openMathEditor({
        title: opts.title || 'Новая формула',
        math: opts.math,
        hint: 'Печатайте как обычно: x^2, a/b, x_1 превратятся в формулу. → в конце степени — выйти из неё.',
        onSubmit: async ({ math, graph }) => {
            await insertFormulaLayer(canvasState, math, {
                x: opts.x,
                y: opts.y,
                fontSize: opts.fontSize || 40,
                withGraph: graph,
            });
        },
    });
}

export function openEditFormulaDialog(canvasState, layer) {
    if (!layer || layer.type !== 'formula') return;
    openMathEditor({
        title: 'Формула',
        math: layer.math,
        hint: 'Печатайте как обычно: x^2, a/b, x_1 превратятся в формулу.',
        onSubmit: async ({ math, graph }) => {
            await applyMathToFormulaLayer(canvasState, layer, math);
            if (graph) {
                const { insertPlotFromMath } = await import('./plotLayer.js?v=1.4.19');
                insertPlotFromMath(canvasState, math, {
                    x: layer.x + (layer.width || 200) + 60 + 260,
                    y: layer.y + 210,
                });
            }
        },
    });
}

// -------------------------------------------------- формула внутри текста

// HTML для вставки в текстовый слой: самодостаточный, с данными формулы.
export function formulaInlineHtml(math, opts = {}) {
    const clean = normalizeRow(math);
    // Внутри текста формула живёт в «em»: её размер всегда равен размеру
    // текста слоя, поэтому при смене кегля текста она масштабируется сама.
    const fontSize = opts.fontSize || '1em';
    const color = opts.color || 'currentColor';
    const plain = plainTextOf(clean);
    // Формула в тексте — неделимый объект: править её нужно в редакторе
    // (двойной клик), иначе курсор путается в числителе и показателе.
    return `<span class="rep-math" data-math="${mathToAttr(clean)}" data-tex="${escapeAttr(plain)}" contenteditable="false" `
        + `style="display:inline-block;vertical-align:middle;margin:0 0.1em;">`
        + formulaToHtml(clean, { fontSize, color })
        + `</span>`;
}

function escapeAttr(str) {
    return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

export { mathToPlain };
