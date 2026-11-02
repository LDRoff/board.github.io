// --- START OF FILE js/plotDialog.js ---
// Окно графика: функции (ввод формул той же клавиатурой), диапазон,
// живое превью и список корней.

import {
    PLOT_COLORS, createPlotLayer, drawPlotLayer, preparePlot, getCompiledFns, prettifyExpression,
} from './plotLayer.js?v=1.4.19';
import { formulaToHtml, mathToPlain, emptyMath, isMathEmpty } from './mathModel.js?v=1.4.19';
import { openMathEditor } from './mathEditor.js?v=1.4.19';

let modal = null;
let previewCanvas = null;
let handler = null;
let previewScheduled = 0;

function el(id) {
    return document.getElementById(id);
}

function renderField(field, row) {
    if (row._math && !isMathEmpty(row._math)) {
        field.classList.remove('is-empty');
        field.innerHTML = formulaToHtml(row._math, { fontSize: 18, color: 'currentColor' });
    } else if (row._raw) {
        field.classList.remove('is-empty');
        field.textContent = row._raw;
    } else {
        field.classList.add('is-empty');
        field.innerHTML = '';
    }
}

function openExpressionEditor(row) {
    openMathEditor({
        title: 'Функция графика',
        math: row._math || emptyMath(),
        hint: 'Введите функцию или уравнение — превью обновится сразу.',
        showGraph: false,
        onSubmit: ({ math }) => {
            const plain = mathToPlain(math).replace(/\s+/g, ' ').trim();
            if (!plain) return;
            row._math = math;
            row._raw = plain;
            if (row._field) renderField(row._field, row);
            schedulePreview();
        },
    });
}

function addExpressionRow(expression = {}, focus = false) {
    const host = el('plot-expressions');
    if (!host) return null;

    const index = host.children.length;
    const row = document.createElement('div');
    row.className = 'plot-expr-row';
    row._math = expression.math || null;
    row._raw = expression.raw || '';

    const dot = document.createElement('span');
    dot.className = 'plot-expr-dot';
    dot.style.background = expression.color || PLOT_COLORS[index % PLOT_COLORS.length];

    const field = document.createElement('button');
    field.type = 'button';
    field.className = 'plot-expr-field';
    field.title = 'Нажмите, чтобы ввести формулу';
    field.addEventListener('click', () => openExpressionEditor(row));
    row._field = field;
    renderField(field, row);

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'plot-expr-remove';
    remove.textContent = '×';
    remove.title = 'Убрать функцию';
    remove.addEventListener('click', () => {
        row.remove();
        renumberColors();
        schedulePreview();
    });

    row.appendChild(dot);
    row.appendChild(field);
    row.appendChild(remove);
    host.appendChild(row);

    if (focus) openExpressionEditor(row);
    return row;
}

function renumberColors() {
    const host = el('plot-expressions');
    if (!host) return;
    Array.from(host.children).forEach((row, i) => {
        const dot = row.querySelector('.plot-expr-dot');
        if (!dot) return;
        dot.style.background = PLOT_COLORS[i % PLOT_COLORS.length];
    });
}

function readExpressions() {
    const host = el('plot-expressions');
    if (!host) return [];
    return Array.from(host.children)
        .map((row, i) => ({
            raw: (row._raw || '').trim(),
            math: row._math || null,
            color: PLOT_COLORS[i % PLOT_COLORS.length],
        }))
        .filter((e) => e.raw);
}

function readFields() {
    const xMin = parseFloat(el('plot-x-min').value);
    const xMax = parseFloat(el('plot-x-max').value);
    const yAuto = el('plot-y-auto').checked;
    const yMin = parseFloat(el('plot-y-min').value);
    const yMax = parseFloat(el('plot-y-max').value);

    return {
        expressions: readExpressions(),
        xMin: Number.isFinite(xMin) ? xMin : -6,
        xMax: Number.isFinite(xMax) ? xMax : 6,
        yAuto,
        yMin: Number.isFinite(yMin) ? yMin : undefined,
        yMax: Number.isFinite(yMax) ? yMax : undefined,
        showGrid: el('plot-grid').checked,
        showRoots: el('plot-roots').checked,
        showIntersections: el('plot-intersections').checked,
        showTicks: el('plot-ticks').checked,
        showAxisLabels: el('plot-axis-labels').checked,
        showHeader: el('plot-header').checked,
    };
}

function buildTempLayer(fields) {
    // Пока не введено ни одного выражения — графика нет (иначе превью
    // рисовало бы y = 0 и «находило» корни по всей оси).
    if (!fields.expressions.length) return null;

    const layer = createPlotLayer(fields.expressions, {
        x: 0, y: 0, width: 1, height: 1,
        xMin: fields.xMin,
        xMax: fields.xMax,
        yAuto: fields.yAuto,
        yMin: fields.yMin,
        yMax: fields.yMax,
        showGrid: fields.showGrid,
        showRoots: fields.showRoots,
        showIntersections: fields.showIntersections,
        showTicks: fields.showTicks,
        showAxisLabels: fields.showAxisLabels,
        showHeader: fields.showHeader,
    });
    const cssW = previewCanvas ? previewCanvas.clientWidth || 520 : 520;
    const cssH = previewCanvas ? previewCanvas.clientHeight || 300 : 300;
    layer.x = 0;
    layer.y = 0;
    layer.width = cssW;
    layer.height = cssH;
    return layer;
}

function schedulePreview() {
    if (previewScheduled) cancelAnimationFrame(previewScheduled);
    previewScheduled = requestAnimationFrame(() => {
        previewScheduled = 0;
        drawPreview();
    });
}

function drawPreview() {
    if (!previewCanvas || !modal || modal.classList.contains('hidden')) return;

    const fields = readFields();
    const layer = buildTempLayer(fields);
    const ctx = previewCanvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const cssW = previewCanvas.clientWidth || 520;
    const cssH = previewCanvas.clientHeight || 300;

    if (previewCanvas.width !== Math.round(cssW * dpr) || previewCanvas.height !== Math.round(cssH * dpr)) {
        previewCanvas.width = Math.round(cssW * dpr);
        previewCanvas.height = Math.round(cssH * dpr);
    }

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
    ctx.scale(dpr, dpr);

    if (!layer) {
        const errorEl = el('plot-error');
        const rootsEl = el('plot-roots-text');
        if (errorEl) errorEl.textContent = '';
        if (rootsEl) rootsEl.textContent = '';
        const dark = document.body.classList.contains('dark-theme');
        ctx.fillStyle = dark ? '#1e2733' : '#ffffff';
        ctx.strokeStyle = dark ? '#3b475a' : '#dbe3ee';
        const r = 14;
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(2, 2, cssW - 4, cssH - 4, r);
        else ctx.rect(2, 2, cssW - 4, cssH - 4);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = dark ? '#8b9bb0' : '#94a3b8';
        ctx.font = '15px "Roboto", Arial, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('Введите функцию — график появится здесь', cssW / 2, cssH / 2);
        return;
    }

    layer.width = cssW;
    layer.height = cssH;

    const theme = document.body.classList.contains('dark-theme') ? 'dark' : 'light';
    drawPlotLayer(ctx, layer, theme);

    // Ошибки и корни.
    const errorEl = el('plot-error');
    const rootsEl = el('plot-roots-text');
    const data = preparePlot(layer);
    const broken = data.expressions.filter((e) => e.error);

    if (broken.length) {
        if (errorEl) errorEl.textContent = `Не разобрать: ${broken.map((b) => b.raw).join(', ')} — ${broken[0].error}`;
    } else if (errorEl) {
        errorEl.textContent = '';
    }

    if (!rootsEl) return;
    if (!fields.showRoots) {
        rootsEl.textContent = '';
        return;
    }
    const parts = [];
    const groups = data.roots.filter((g) => g.values.length);
    for (const group of groups) {
        const values = group.values.slice(0, 6).map((v) => `x = ${(Math.round(v * 1000) / 1000).toString().replace('.', ',')}`);
        parts.push(`${prettifyExpression(group.raw)}: ${values.join(', ')}`);
    }

    if (fields.showIntersections && data.intersections && data.intersections.length) {
        const pts = data.intersections.slice(0, 6).map((p) =>
            `(${(Math.round(p.x * 1000) / 1000).toString().replace('.', ',')}; ${(Math.round(p.y * 1000) / 1000).toString().replace('.', ',')})`);
        parts.push(`пересечения: ${pts.join(', ')}`);
    }

    if (!parts.length) {
        rootsEl.textContent = getCompiledFns(data).some(Boolean)
            ? 'Корней и пересечений на этом отрезке нет'
            : '';
        return;
    }
    rootsEl.textContent = `Корни и пересечения — ${parts.join('; ')}`;
}

function open(layerOrNull, onSave) {
    modal = el('plot-modal');
    if (!modal) return;
    previewCanvas = el('plot-preview');
    handler = onSave || null;

    const source = layerOrNull || null;
    el('plot-expressions').innerHTML = '';

    const list = source && Array.isArray(source.expressions) && source.expressions.length
        ? source.expressions
        : [{}];
    list.forEach((expr) => addExpressionRow(expr));

    el('plot-x-min').value = source && Number.isFinite(source.xMin) ? source.xMin : -6;
    el('plot-x-max').value = source && Number.isFinite(source.xMax) ? source.xMax : 6;
    el('plot-y-auto').checked = !source || source.yAuto !== false;
    el('plot-y-min').value = source && Number.isFinite(source.yMin) ? source.yMin : -5;
    el('plot-y-max').value = source && Number.isFinite(source.yMax) ? source.yMax : 5;
    el('plot-grid').checked = !source || source.showGrid !== false;
    el('plot-roots').checked = !source || source.showRoots !== false;
    el('plot-intersections').checked = !source || source.showIntersections !== false;
    el('plot-ticks').checked = !source || source.showTicks !== false;
    el('plot-axis-labels').checked = !source || source.showAxisLabels !== false;
    el('plot-header').checked = !source || source.showHeader !== false;

    const title = el('plot-modal-title');
    if (title) title.textContent = source ? 'График' : 'Новый график';
    const hint = el('plot-hint');
    if (hint) hint.textContent = 'Нажмите на выражение — откроется клавиатура формул. Корни считаются автоматически.';

    toggleYRange();
    modal.classList.remove('hidden');
    document.body.classList.add('math-modal-open');
    schedulePreview();
    setTimeout(schedulePreview, 60);
}

function toggleYRange() {
    const auto = el('plot-y-auto');
    const row = el('plot-y-range');
    if (row) row.style.display = auto && auto.checked ? 'none' : 'flex';
}

function close() {
    if (!modal) return;
    modal.classList.add('hidden');
    document.body.classList.remove('math-modal-open');
}

function commit() {
    if (!modal) return;
    const fields = readFields();
    if (!fields.expressions.length) {
        const err = el('plot-error');
        if (err) err.textContent = 'Добавьте хотя бы одно выражение';
        return;
    }
    const cb = handler;
    close();
    if (cb) cb(fields);
}

let wired = false;

function wire() {
    if (wired) return;
    wired = true;

    el('plot-modal-close').addEventListener('click', close);
    el('plot-cancel').addEventListener('click', close);
    el('plot-done').addEventListener('click', commit);

    el('plot-add-expr').addEventListener('click', () => {
        const host = el('plot-expressions');
        if (host && host.children.length >= 4) return;
        addExpressionRow({}, true);
        schedulePreview();
    });

    ['plot-x-min', 'plot-x-max', 'plot-y-min', 'plot-y-max'].forEach((id) => {
        el(id).addEventListener('input', schedulePreview);
    });
    ['plot-grid', 'plot-roots', 'plot-intersections', 'plot-ticks', 'plot-axis-labels', 'plot-header'].forEach((id) => {
        el(id).addEventListener('change', schedulePreview);
    });
    el('plot-y-auto').addEventListener('change', () => {
        toggleYRange();
        schedulePreview();
    });

    window.addEventListener('resize', () => {
        if (modal && !modal.classList.contains('hidden')) schedulePreview();
    });

    document.addEventListener('keydown', (e) => {
        if (!modal || modal.classList.contains('hidden')) return;
        // Окно формулы может быть открыто поверх — не закрываем график.
        const mathModal = document.getElementById('math-modal');
        if (mathModal && !mathModal.classList.contains('hidden')) return;
        if (e.key === 'Escape') {
            e.preventDefault();
            close();
        }
    }, true);
}

export function openPlotDialog(layer, onSave) {
    wire();
    open(layer, onSave);
}

export function closePlotDialog() {
    close();
}
// --- END OF FILE js/plotDialog.js ---
