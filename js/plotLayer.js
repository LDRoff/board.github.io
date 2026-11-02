// --- START OF FILE js/plotLayer.js ---
// График функции как объект доски.
//
// Выражение разбирается своим маленьким парсером (без внешних библиотек):
// поддерживаются + − × ÷, степени, скобки, модуль, функции (sin, cos, tg, ln…),
// π, e, неявное умножение (2x, 3(x+1)) и уравнения вида «левая = правая».
// Корни ищутся численно: смена знака на сетке + бисекция.

import { cloneLayersForAction } from './utils.js?v=1.4.19';
import { getBoundingBox } from './geometry.js?v=1.4.19';
import { mathToPlain } from './mathModel.js?v=1.4.19';

export const PLOT_COLORS = ['#2563eb', '#dc2626', '#16a34a'];

// Больше этого числа «корней» — почти наверняка не корни, а шум
// (например, тождественный ноль или разрыв функции).
const MAX_ROOTS = 24;

const FUNCTIONS = {
    sin: Math.sin, cos: Math.cos, tan: Math.tan, tg: Math.tan, cot: (v) => 1 / Math.tan(v), ctg: (v) => 1 / Math.tan(v),
    asin: Math.asin, arcsin: Math.asin, acos: Math.acos, arccos: Math.acos, atan: Math.atan, arctan: Math.atan,
    ln: Math.log, log: (v) => Math.log(v) / Math.LN10, lg: (v) => Math.log(v) / Math.LN10,
    log10: (v) => Math.log(v) / Math.LN10, log2: (v) => Math.log(v) / Math.LN2,
    sqrt: Math.sqrt, abs: Math.abs, exp: Math.exp,
    sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh,
    sh: Math.sinh, ch: Math.cosh, th: Math.tanh,
    sign: Math.sign, floor: Math.floor, ceil: Math.ceil, round: Math.round,
};

export const FUNCTION_NAMES = ['sin', 'cos', 'tg', 'ctg', 'ln', 'lg', 'log', 'sqrt', 'abs', 'exp'];

const CONSTANTS = { pi: Math.PI, 'π': Math.PI, e: Math.E };

// --------------------------------------------------------------- парсер

function normalizeSource(raw) {
    return String(raw || '')
        .replace(/[−–—]/g, '-')
        .replace(/[×·∙⋅]/g, '*')
        .replace(/[÷]/g, '/')
        .replace(/≤/g, '<=')
        .replace(/≥/g, '>=')
        .replace(/≠/g, '!=')
        .replace(/√/g, 'sqrt')
        .replace(/π/g, 'pi')
        .replace(/\s+/g, ' ')
        .trim();
}

function tokenize(src) {
    const tokens = [];
    let i = 0;
    while (i < src.length) {
        const ch = src[i];
        if (ch === ' ') { i++; continue; }

        if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(src[i + 1] || ''))) {
            let j = i;
            while (j < src.length && /[0-9.]/.test(src[j])) j++;
            tokens.push({ type: 'num', value: parseFloat(src.slice(i, j)) });
            i = j;
            continue;
        }

        if (/[a-zA-Zа-яА-Я_]/.test(ch)) {
            let j = i;
            while (j < src.length && /[a-zA-Zа-яА-Я0-9_]/.test(src[j])) j++;
            const name = src.slice(i, j).toLowerCase();
            tokens.push({ type: 'ident', value: name });
            i = j;
            continue;
        }

        if (ch === '<' || ch === '>' || ch === '!' || ch === '=') {
            if (src[i + 1] === '=') { tokens.push({ type: 'op', value: ch + '=' }); i += 2; continue; }
            if (ch === '=') { tokens.push({ type: 'op', value: '=' }); i++; continue; }
            tokens.push({ type: 'op', value: ch }); i++; continue;
        }

        if ('+-*/^()|'.includes(ch)) {
            tokens.push({ type: 'op', value: ch });
            i++;
            continue;
        }

        throw new Error(`Непонятный символ: ${ch}`);
    }
    return tokens;
}

function parseTokens(tokens) {
    let pos = 0;
    const peek = () => tokens[pos];
    const next = () => tokens[pos++];

    function parseExpression() {
        return parseAdditive();
    }

    function parseAdditive() {
        let left = parseMultiplicative();
        while (peek() && peek().type === 'op' && (peek().value === '+' || peek().value === '-')) {
            const op = next().value;
            const right = parseMultiplicative();
            left = { kind: 'bin', op, left, right };
        }
        return left;
    }

    function startsPrimary(tok) {
        if (!tok) return false;
        if (tok.type === 'num') return true;
        if (tok.type === 'ident') return true;
        if (tok.type === 'op' && (tok.value === '(' || tok.value === '|')) return true;
        return false;
    }

    function parseMultiplicative() {
        let left = parseUnary();
        while (true) {
            const tok = peek();
            if (tok && tok.type === 'op' && (tok.value === '*' || tok.value === '/')) {
                const op = next().value;
                const right = parseUnary();
                left = { kind: 'bin', op, left, right };
                continue;
            }
            // Неявное умножение: 2x, 3(x+1), 2 sin(x), πr
            if (startsPrimary(tok)) {
                const right = parseUnary();
                left = { kind: 'bin', op: '*', left, right };
                continue;
            }
            break;
        }
        return left;
    }

    function parseUnary() {
        const tok = peek();
        if (tok && tok.type === 'op' && (tok.value === '-' || tok.value === '+')) {
            next();
            const operand = parseUnary();
            return tok.value === '-' ? { kind: 'neg', value: operand } : operand;
        }
        return parsePower();
    }

    function parsePower() {
        const base = parsePostfix();
        const tok = peek();
        if (tok && tok.type === 'op' && tok.value === '^') {
            next();
            const exponent = parseUnary();
            return { kind: 'bin', op: '^', left: base, right: exponent };
        }
        return base;
    }

    function parsePostfix() {
        return parsePrimary();
    }

    function parsePrimary() {
        const tok = next();
        if (!tok) throw new Error('Выражение обрывается');

        if (tok.type === 'num') return { kind: 'num', value: tok.value };

        if (tok.type === 'op' && tok.value === '(') {
            const inner = parseExpression();
            if (peek() && peek().value === ')') next();
            return inner;
        }

        if (tok.type === 'op' && tok.value === '|') {
            const inner = parseExpression();
            if (peek() && peek().value === '|') next();
            return { kind: 'func', name: 'abs', arg: inner };
        }

        if (tok.type === 'ident') {
            const name = tok.value;
            if (CONSTANTS[name] !== undefined) return { kind: 'num', value: CONSTANTS[name] };
            if (name === 'x') return { kind: 'var' };
            if (FUNCTIONS[name]) {
                let arg;
                if (peek() && peek().value === '(') {
                    next();
                    arg = parseExpression();
                    if (peek() && peek().value === ')') next();
                } else {
                    arg = parseUnary();
                }
                return { kind: 'func', name, arg };
            }
            throw new Error(`Неизвестная переменная «${name}». Поддерживается x`);
        }

        throw new Error('Не удалось разобрать выражение');
    }

    const ast = parseExpression();
    if (pos < tokens.length) throw new Error('Лишние символы в выражении');
    return ast;
}

// Разбираем строку в функцию f(x). Уравнение «a = b» превращаем в a − b.
export function compileExpression(raw) {
    const source = normalizeSource(raw);
    if (!source) throw new Error('Пустое выражение');

    // Ищем знак равенства верхнего уровня (не внутри скобок и модулей).
    let depth = 0;
    let eqIndex = -1;
    for (let i = 0; i < source.length; i++) {
        const ch = source[i];
        if (ch === '(' || ch === '|') depth++;
        else if (ch === ')' || ch === '|') depth = Math.max(0, depth - 1);
        else if (ch === '=' && depth === 0 && source[i + 1] !== '=' && source[i - 1] !== '<' && source[i - 1] !== '>' && source[i - 1] !== '!') {
            eqIndex = i;
            break;
        }
    }

    let ast;
    let equation = false;
    if (eqIndex > 0) {
        const left = parseTokens(tokenize(source.slice(0, eqIndex)));
        const right = parseTokens(tokenize(source.slice(eqIndex + 1)));
        ast = { kind: 'bin', op: '-', left, right };
        equation = true;
    } else {
        ast = parseTokens(tokenize(source));
    }

    const fn = (x) => evaluate(ast, x);
    return { fn, equation, source, ast };
}

function evaluate(node, x) {
    switch (node.kind) {
        case 'num': return node.value;
        case 'var': return x;
        case 'neg': return -evaluate(node.value, x);
        case 'bin': {
            const a = evaluate(node.left, x);
            const b = evaluate(node.right, x);
            switch (node.op) {
                case '+': return a + b;
                case '-': return a - b;
                case '*': return a * b;
                case '/': return a / b;
                case '^': return Math.pow(a, b);
                default: return NaN;
            }
        }
        case 'func': {
            const f = FUNCTIONS[node.name];
            if (!f) return NaN;
            const v = evaluate(node.arg, x);
            if (node.name === 'sqrt' && v < 0) return NaN;
            if ((node.name === 'ln' || node.name === 'log' || node.name === 'lg') && v <= 0) return NaN;
            return f(v);
        }
        default: return NaN;
    }
}

// --------------------------------------------------------------- корни

export function findRoots(fn, xMin, xMax, samples = 1600) {
    const roots = [];
    if (!(xMax > xMin)) return roots;

    const pushRoot = (r) => {
        if (!Number.isFinite(r)) return;
        if (!roots.some((v) => Math.abs(v - r) < 1e-6)) roots.push(r);
    };

    let prevX = xMin;
    let prevY = fn(xMin);
    if (Number.isFinite(prevY) && Math.abs(prevY) < 1e-10) pushRoot(prevX);

    for (let i = 1; i <= samples; i++) {
        const x = xMin + (xMax - xMin) * (i / samples);
        const y = fn(x);
        if (Number.isFinite(y) && Number.isFinite(prevY)) {
            if (Math.abs(y) < 1e-10) {
                pushRoot(x);
            } else if (prevY * y < 0) {
                let a = prevX;
                let b = x;
                let fa = prevY;
                for (let k = 0; k < 80; k++) {
                    const m = (a + b) / 2;
                    const fm = fn(m);
                    if (!Number.isFinite(fm)) break;
                    if (fa * fm <= 0) { b = m; } else { a = m; fa = fm; }
                }
                pushRoot((a + b) / 2);
            }
        }
        prevX = x;
        prevY = y;
    }
    return roots.sort((p, q) => p - q);
}

// --------------------------------------------------------------- отрисовка

function niceStep(range, target) {
    const raw = range / Math.max(1, target);
    if (!Number.isFinite(raw) || raw <= 0) return 1;
    const power = Math.pow(10, Math.floor(Math.log10(raw)));
    const norm = raw / power;
    let step = 1;
    if (norm > 5) step = 10;
    else if (norm > 2) step = 5;
    else if (norm > 1) step = 2;
    return step * power;
}

function formatTick(value) {
    if (Math.abs(value) < 1e-9) return '0';
    const abs = Math.abs(value);
    if (abs >= 10000 || abs < 0.01) return value.toExponential(1).replace('.0e', 'e');
    const rounded = Math.round(value * 1000) / 1000;
    return String(rounded).replace('.', ',');
}

// Убираем лишние скобки вокруг простых имён: «(x)^(2)» → «x^2».
// Скобки после имени функции не трогаем: «sin(x)» должно остаться как есть.
const SUP_DIGITS = { '0': '\u2070', '1': '\u00b9', '2': '\u00b2', '3': '\u00b3', '4': '\u2074', '5': '\u2075', '6': '\u2076', '7': '\u2077', '8': '\u2078', '9': '\u2079', '-': '\u207b' };

function toSuperscript(value) {
    return String(value).split('').map((c) => SUP_DIGITS[c] || c).join('');
}

export function prettifyExpression(raw) {
    let s = String(raw || '')
        .replace(/\*/g, '\u00b7')
        .replace(/sqrt\s*\(/gi, '\u221a(');

    // Скобки вокруг одной буквы можно убрать: 2(x) → 2x, (x)^2 → x^2.
    // У функций скобки не трогаем: sin(x) остаётся как есть.
    s = s.replace(/(^|[^a-zA-Zа-яА-Я])\(([a-zA-Zπ])\)/g, '$1$2');

    // Степени: ^2 → ², ^(2) → ², ^-1 → ⁻¹.
    s = s.replace(/\^\(?(-?\d+)\)?/g, (m, digits) => toSuperscript(digits));

    // Минус — типографский, как в учебнике.
    s = s.replace(/-/g, '\u2212');

    return s.replace(/\s+/g, ' ').trim();
}

export function getPlotExpressions(layer) {
    if (!layer || !Array.isArray(layer.expressions)) return [];
    return layer.expressions.filter((e) => e && String(e.raw || '').trim());
}

// Компилированные функции держим отдельно (WeakMap), чтобы в слое не было
// функций: слои клонируются structuredClone и уходят в Worker сохранения.
const compiledByCache = new WeakMap();

// Пересчитываем данные (функции, корни) и кэшируем на слое.
export function preparePlot(layer) {
    const xMin = Number.isFinite(layer.xMin) ? layer.xMin : -6;
    const xMax = Number.isFinite(layer.xMax) ? layer.xMax : 6;
    const compiledFns = [];

    const expressions = getPlotExpressions(layer).map((expr, index) => {
        const color = expr.color || PLOT_COLORS[index % PLOT_COLORS.length];
        let compiled = null;
        let error = null;
        try {
            compiled = compileExpression(expr.raw);
        } catch (e) {
            error = e.message || 'Ошибка';
        }
        compiledFns[index] = compiled ? compiled.fn : null;
        return { raw: expr.raw, color, error, index };
    });

    // Автоматический диапазон по Y.
    let yMin = layer.yAuto === false && Number.isFinite(layer.yMin) ? layer.yMin : null;
    let yMax = layer.yAuto === false && Number.isFinite(layer.yMax) ? layer.yMax : null;

    if (yMin === null || yMax === null) {
        let lo = Infinity;
        let hi = -Infinity;
        const samples = 240;
        for (let index = 0; index < compiledFns.length; index++) {
            const fn = compiledFns[index];
            if (!fn) continue;
            for (let i = 0; i <= samples; i++) {
                const x = xMin + (xMax - xMin) * (i / samples);
                const y = fn(x);
                if (!Number.isFinite(y)) continue;
                if (y < lo) lo = y;
                if (y > hi) hi = y;
            }
        }
        if (!Number.isFinite(lo) || !Number.isFinite(hi)) { lo = -5; hi = 5; }
        if (Math.abs(hi - lo) < 1e-6) { lo -= 1; hi += 1; }
        const pad = (hi - lo) * 0.12;
        yMin = lo - pad;
        yMax = hi + pad;
    }

    const roots = [];
    if (layer.showRoots !== false) {
        for (let index = 0; index < compiledFns.length; index++) {
            const fn = compiledFns[index];
            if (!fn) continue;
            const expr = expressions[index];
            // У постоянных функций (без x) корней либо нет, либо бесконечно много.
            if (!/[xX]/.test(expr.raw)) {
                roots.push({ color: expr.color, values: [], raw: expr.raw });
                continue;
            }
            const list = findRoots(fn, xMin, xMax);
            // Защита от «шума»: если корней подозрительно много, это не корни.
            const values = list.length > MAX_ROOTS ? [] : list;
            roots.push({ color: expr.color, values, raw: expr.raw });
        }
    }

    // Точки пересечения графиков: корни разности двух функций.
    const intersections = [];
    if (layer.showIntersections !== false && compiledFns.filter(Boolean).length >= 2) {
        for (let i = 0; i < compiledFns.length; i++) {
            for (let j = i + 1; j < compiledFns.length; j++) {
                const f = compiledFns[i];
                const g = compiledFns[j];
                if (!f || !g) continue;
                const xs = findRoots((x) => f(x) - g(x), xMin, xMax);
                if (xs.length > MAX_ROOTS) continue;
                for (const x of xs) {
                    const y = f(x);
                    if (!Number.isFinite(y)) continue;
                    if (y < yMin - 1e-9 || y > yMax + 1e-9) continue;
                    if (intersections.some((p) => Math.abs(p.x - x) < 1e-4 && Math.abs(p.y - y) < 1e-4)) continue;
                    intersections.push({ x, y });
                }
            }
        }
    }

    const cache = {
        key: JSON.stringify([layer.expressions, layer.xMin, layer.xMax, layer.yMin, layer.yMax, layer.yAuto, layer.showRoots, layer.showIntersections]),
        expressions,
        roots,
        intersections,
        xMin, xMax, yMin, yMax,
    };
    compiledByCache.set(cache, compiledFns);
    layer._plotCache = cache;
    return cache;
}

export function getCompiledFns(cache) {
    return compiledByCache.get(cache) || [];
}

export function drawPlotLayer(ctx, layer, theme) {
    if (!layer) return;
    let data = layer._plotCache;
    const key = JSON.stringify([layer.expressions, layer.xMin, layer.xMax, layer.yMin, layer.yMax, layer.yAuto, layer.showRoots, layer.showIntersections]);
    if (!data || data.key !== key) data = preparePlot(layer);

    const dark = theme === 'dark';
    const x = layer.x;
    const y = layer.y;
    const w = layer.width;
    const h = layer.height;
    const radius = Math.min(14, w * 0.04);
    const showHeader = layer.showHeader !== false;

    // Карточка.
    ctx.save();
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, w, h, radius);
    else ctx.rect(x, y, w, h);
    ctx.fillStyle = dark ? '#1e2733' : '#ffffff';
    ctx.fill();
    ctx.strokeStyle = dark ? '#3b475a' : '#dbe3ee';
    ctx.lineWidth = 1;
    ctx.stroke();

    const showTicks = layer.showTicks !== false;
    const showAxisLabels = layer.showAxisLabels !== false;
    const padLeft = showTicks ? 42 : 16;
    const padRight = 18;
    const padTop = showHeader ? 32 : 14;
    const padBottom = showTicks ? 28 : 12;
    const plotX = x + padLeft;
    const plotY = y + padTop;
    const plotW = Math.max(10, w - padLeft - padRight);
    const plotH = Math.max(10, h - padTop - padBottom);

    const { xMin, xMax, yMin, yMax } = data;
    const sx = (vx) => plotX + ((vx - xMin) / (xMax - xMin)) * plotW;
    const sy = (vy) => plotY + plotH - ((vy - yMin) / (yMax - yMin)) * plotH;

    const axisColor = dark ? '#8b9bb0' : '#94a3b8';
    const gridColor = dark ? 'rgba(139,155,176,0.18)' : 'rgba(148,163,184,0.25)';
    const textColor = dark ? '#c7d2e0' : '#475569';
    const axisX = (xMin <= 0 && xMax >= 0) ? sx(0) : plotX;
    const axisY = (yMin <= 0 && yMax >= 0) ? sy(0) : plotY + plotH;

    // Сетка.
    if (layer.showGrid !== false) {
        const stepX = niceStep(xMax - xMin, Math.max(3, Math.round(plotW / 70)));
        const stepY = niceStep(yMax - yMin, Math.max(3, Math.round(plotH / 55)));

        ctx.strokeStyle = gridColor;
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let v = Math.ceil(xMin / stepX) * stepX; v <= xMax; v += stepX) {
            const px = Math.round(sx(v)) + 0.5;
            ctx.moveTo(px, plotY);
            ctx.lineTo(px, plotY + plotH);
        }
        for (let v = Math.ceil(yMin / stepY) * stepY; v <= yMax; v += stepY) {
            const py = Math.round(sy(v)) + 0.5;
            ctx.moveTo(plotX, py);
            ctx.lineTo(plotX + plotW, py);
        }
        ctx.stroke();
    }

    // Оси со стрелками.
    ctx.strokeStyle = axisColor;
    ctx.fillStyle = axisColor;
    ctx.lineWidth = 1.4;

    if (showAxisLabels) {
        const py = Math.round(axisY) + 0.5;
        const px = Math.round(axisX) + 0.5;

        ctx.beginPath();
        ctx.moveTo(plotX, py);
        ctx.lineTo(plotX + plotW, py);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(plotX + plotW + 7, py);
        ctx.lineTo(plotX + plotW - 1, py - 4);
        ctx.lineTo(plotX + plotW - 1, py + 4);
        ctx.closePath();
        ctx.fill();

        ctx.beginPath();
        ctx.moveTo(px, plotY + plotH);
        ctx.lineTo(px, plotY);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(px, plotY - 7);
        ctx.lineTo(px - 4, plotY + 1);
        ctx.lineTo(px + 4, plotY + 1);
        ctx.closePath();
        ctx.fill();

        // Буквы осей.
        ctx.font = 'italic 12px Arial, sans-serif';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'bottom';
        ctx.fillText('x', plotX + plotW - 4, py - 4);
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillText('y', px + 5, plotY + 2);
    } else {
        // Без осей — только тонкая рамка области графика.
        ctx.strokeStyle = gridColor;
        ctx.lineWidth = 1;
        ctx.strokeRect(plotX + 0.5, plotY + 0.5, plotW, plotH);
    }

    // Подписи делений.
    if (showTicks) {
        ctx.fillStyle = textColor;
        ctx.font = '11px Arial, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        const labelStepX = niceStep(xMax - xMin, Math.max(3, Math.round(plotW / 70)));
        for (let v = Math.ceil(xMin / labelStepX) * labelStepX; v <= xMax; v += labelStepX) {
            if (Math.abs(v) < 1e-9) continue;
            ctx.fillText(formatTick(v), sx(v), plotY + plotH + 7);
        }
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        const labelStepY = niceStep(yMax - yMin, Math.max(3, Math.round(plotH / 55)));
        for (let v = Math.ceil(yMin / labelStepY) * labelStepY; v <= yMax; v += labelStepY) {
            if (Math.abs(v) < 1e-9) continue;
            ctx.fillText(formatTick(v), plotX - 8, sy(v));
        }
        // Ноль подписываем один раз, у начала координат.
        if (xMin <= 0 && xMax >= 0 && yMin <= 0 && yMax >= 0) {
            ctx.textAlign = 'right';
            ctx.textBaseline = 'top';
            ctx.fillText('0', axisX - 5, axisY + 4);
        }
    }

    // Кривые.
    ctx.save();
    ctx.beginPath();
    ctx.rect(plotX, plotY, plotW, plotH);
    ctx.clip();

    const compiledFns = getCompiledFns(data);
    for (let index = 0; index < data.expressions.length; index++) {
        const expr = data.expressions[index];
        const fn = compiledFns[index];
        if (!fn) continue;
        ctx.strokeStyle = expr.color;
        ctx.lineWidth = 2.2;
        ctx.lineJoin = 'round';
        ctx.beginPath();
        let started = false;
        const steps = Math.max(120, Math.ceil(plotW));
        for (let i = 0; i <= steps; i++) {
            const vx = xMin + (xMax - xMin) * (i / steps);
            const vy = fn(vx);
            if (!Number.isFinite(vy) || vy < yMin - (yMax - yMin) * 2 || vy > yMax + (yMax - yMin) * 2) {
                started = false;
                continue;
            }
            const px = sx(vx);
            const py = sy(vy);
            if (!started) {
                ctx.moveTo(px, py);
                started = true;
            } else {
                ctx.lineTo(px, py);
            }
        }
        ctx.stroke();
    }

    // Корни: точки на оси X и подписи (подписи не наезжают друг на друга).
    if (layer.showRoots !== false && yMin <= 0 && yMax >= 0) {
        const baseLabelY = Math.min(sy(0) - 9, plotY + plotH - 6);
        const placed = [];
        ctx.font = 'bold 11px Arial, sans-serif';

        for (const group of data.roots) {
            for (const root of group.values) {
                const px = sx(root);
                if (px < plotX - 2 || px > plotX + plotW + 2) continue;
                const py = sy(0);
                ctx.beginPath();
                ctx.arc(px, py, 4, 0, Math.PI * 2);
                ctx.fillStyle = group.color;
                ctx.fill();
                ctx.strokeStyle = dark ? '#1e2733' : '#ffffff';
                ctx.lineWidth = 1.5;
                ctx.stroke();

                const text = `x=${formatTick(root)}`;
                const wLabel = ctx.measureText(text).width;
                let labelY = null;
                for (let step = 0; step < 3 && labelY === null; step++) {
                    const candidate = baseLabelY - step * 13;
                    const box = { x0: px - wLabel / 2 - 2, x1: px + wLabel / 2 + 2, y0: candidate - 11, y1: candidate + 1 };
                    const hits = placed.some((b) => !(box.x1 < b.x0 || box.x0 > b.x1 || box.y1 < b.y0 || box.y0 > b.y1));
                    if (!hits) {
                        placed.push(box);
                        labelY = candidate;
                    }
                }
                if (labelY === null) continue;

                ctx.fillStyle = group.color;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'bottom';
                ctx.fillText(text, px, labelY);
            }
        }
    }
    // Точки пересечения графиков.
    if (layer.showIntersections !== false && data.intersections && data.intersections.length) {
        const list = data.intersections.slice(0, 8);
        for (let i = 0; i < list.length; i++) {
            const pt = list[i];
            const px = sx(pt.x);
            const py = sy(pt.y);
            if (px < plotX - 2 || px > plotX + plotW + 2) continue;

            ctx.beginPath();
            ctx.arc(px, py, 4.5, 0, Math.PI * 2);
            ctx.fillStyle = '#7c3aed';
            ctx.fill();
            ctx.strokeStyle = dark ? '#1e2733' : '#ffffff';
            ctx.lineWidth = 1.6;
            ctx.stroke();

            if (list.length > 6) continue;
            const short = (v) => String(Math.round(v * 100) / 100).replace('.', ',');
            const label = `(${short(pt.x)}; ${short(pt.y)})`;
            ctx.font = 'bold 10.5px Arial, sans-serif';
            ctx.textAlign = 'left';
            // Подпись кладём ниже точки, чтобы не спорить с подписями корней.
            const labelY = py + 14;
            ctx.textBaseline = 'top';
            ctx.lineWidth = 3;
            ctx.strokeStyle = dark ? 'rgba(30,39,51,0.85)' : 'rgba(255,255,255,0.92)';
            ctx.strokeText(label, px + 7, labelY);
            ctx.fillStyle = '#7c3aed';
            ctx.fillText(label, px + 7, labelY);
        }
    }

    ctx.restore();
    if (showHeader) {
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        let cursorX = x + 12;
        const headY = y + 17;

        // Заголовок рисуем двумя шрифтами: «y =» помельче и приглушённо,
        // само выражение — крупным математическим шрифтом со степенями.
        const prefixFont = '11.5px "Cambria Math", "Times New Roman", serif';
        const exprFont = '14px "Cambria Math", "Times New Roman", serif';

        const listed = data.expressions.slice(0, 3);
        for (const expr of listed) {
            ctx.fillStyle = expr.color;
            ctx.beginPath();
            ctx.arc(cursorX + 4, headY, 4, 0, Math.PI * 2);
            ctx.fill();
            cursorX += 14;

            const hasEquation = !!(expr.raw && expr.raw.includes('='));
            if (!hasEquation) {
                ctx.font = prefixFont;
                ctx.fillStyle = dark ? '#94a3b8' : '#64748b';
                ctx.fillText('y =', cursorX, headY + 1);
                cursorX += ctx.measureText('y =').width + 5;
            }

            ctx.font = exprFont;
            ctx.fillStyle = dark ? '#e2e8f0' : '#0f172a';
            const label = prettifyExpression(expr.raw);
            ctx.fillText(label, cursorX, headY);
            cursorX += ctx.measureText(label).width + 14;
            if (cursorX > x + w - 40) break;
        }
    }

    // Если выражение с ошибкой — показываем это прямо на карточке.
    const broken = data.expressions.find((e) => e.error);
    if (broken) {
        ctx.fillStyle = '#ef4444';
        ctx.font = '12px Arial, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(`Не разобрать: ${prettifyExpression(broken.raw)}`, x + w / 2, y + h / 2);
    }

    ctx.restore();

}

export function getPlotButtonRects(layer, scaleFactor = 1) {
    const size = 18 * scaleFactor;
    const pad = 6 * scaleFactor;
    return {
        settings: { x: layer.x + layer.width - size - pad - size - 6 * scaleFactor, y: layer.y + pad, w: size, h: size },
        delete: { x: layer.x + layer.width - size - pad, y: layer.y + pad, w: size, h: size },
    };
}

// Кнопки «настройки» и «удалить» — интерфейс, поэтому рисуем их на overlay-слое,
// чтобы они не попадали в экспорт.
export function drawPlotChrome(ctx, canvasState) {
    if (!canvasState || !Array.isArray(canvasState.selectedLayers)) return;
    const zoom = canvasState.zoom || 1;
    const sf = 1 / zoom;
    const theme = (typeof document !== 'undefined' && document.body.classList.contains('dark-theme')) ? 'dark' : 'light';
    for (const layer of canvasState.selectedLayers) {
        if (!layer || layer.type !== 'plot') continue;
        drawPlotButtons(ctx, layer, theme, sf);
    }
}

function drawPlotButtons(ctx, layer, dark, sf = 1) {
    const buttons = getPlotButtonRects(layer, sf);
    const draw = (rect, color, kind) => {
        ctx.beginPath();
        ctx.arc(rect.x + rect.w / 2, rect.y + rect.h / 2, rect.w / 2, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.fillStyle = '#fff';
        if (kind === 'delete') {
            ctx.lineWidth = 2;
            const cx = rect.x + rect.w / 2;
            const cy = rect.y + rect.h / 2;
            ctx.beginPath();
            ctx.moveTo(cx - 4, cy - 4); ctx.lineTo(cx + 4, cy + 4);
            ctx.moveTo(cx + 4, cy - 4); ctx.lineTo(cx - 4, cy + 4);
            ctx.stroke();
        } else {
            ctx.font = 'bold 12px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('⚙', rect.x + rect.w / 2, rect.y + rect.h / 2 + 1);
        }
    };
    draw(buttons.settings, '#6B7280', 'settings');
    draw(buttons.delete, '#EF4444', 'delete');
}

// ------------------------------------------------------------- создание

export function createPlotLayer(expressions, opts = {}) {
    const list = (Array.isArray(expressions) ? expressions : [expressions])
        .map((e, i) => ({
            raw: String(e && e.raw !== undefined ? e.raw : e).trim(),
            math: (e && e.math) ? e.math : null,
            color: (e && e.color) || PLOT_COLORS[i % PLOT_COLORS.length],
            visible: true,
        }))
        .filter((e) => e.raw);

    return {
        id: `plot_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
        type: 'plot',
        x: Math.round((opts.x || 0) - (opts.width || 520) / 2),
        y: Math.round((opts.y || 0) - (opts.height || 420) / 2),
        width: opts.width || 520,
        height: opts.height || 420,
        expressions: list,
        xMin: Number.isFinite(opts.xMin) ? opts.xMin : -6,
        xMax: Number.isFinite(opts.xMax) ? opts.xMax : 6,
        yAuto: opts.yAuto !== false,
        yMin: opts.yMin,
        yMax: opts.yMax,
        showGrid: opts.showGrid !== false,
        showRoots: opts.showRoots !== false,
        showIntersections: opts.showIntersections !== false,
        showTicks: opts.showTicks !== false,
        showAxisLabels: opts.showAxisLabels !== false,
        showHeader: opts.showHeader !== false,
        rotation: 0,
    };
}

export function insertPlotFromMath(canvasState, math, opts = {}) {
    if (!canvasState) return null;
    const raw = mathToPlain(math);
    const layer = createPlotLayer([{ raw, math }], opts);
    addPlotToBoard(canvasState, layer);
    return layer;
}

export function insertPlotNearScreenPoint(canvasState, math, screenX, screenY) {
    if (!canvasState) return null;
    const worldX = (screenX - canvasState.panX) / canvasState.zoom;
    const worldY = (screenY - canvasState.panY) / canvasState.zoom;
    return insertPlotFromMath(canvasState, math, { x: worldX + 260, y: worldY + 210 });
}

export function addPlotToBoard(canvasState, layer) {
    canvasState.layers.push(layer);

    if (canvasState.spatialGrid) {
        const box = getBoundingBox(layer) || { x: layer.x, y: layer.y, width: layer.width, height: layer.height };
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
    if (canvasState.saveState) canvasState.saveState({ type: 'creation', before: [], after: [layer] });
    canvasState.selectedLayers = [layer];
    if (canvasState.updateFloatingToolbar) canvasState.updateFloatingToolbar();
    if (canvasState.redraw) canvasState.redraw();
    if (canvasState.saveViewState) canvasState.saveViewState();
    return layer;
}

// Пересчёт корней для панели/окна.
export function describeRoots(layer) {
    const data = preparePlot(layer);
    const lines = [];
    for (const group of data.roots) {
        if (!group.values.length) continue;
        const values = group.values.slice(0, 8).map((v) => (Math.round(v * 1000) / 1000));
        lines.push({ raw: group.raw, values });
    }
    return lines;
}

// ------------------------------------------------------- окно настроек

// Открывает окно графика: создать новый или отредактировать существующий.
export function openPlotEditor(canvasState, layer = null, opts = {}) {
    if (!canvasState) return;
    import('./plotDialog.js?v=1.4.19').then(({ openPlotDialog }) => {
        openPlotDialog(layer, (fields) => {
            if (!layer) {
                const target = createPlotLayer(fields.expressions, {
                    x: opts.x !== undefined ? opts.x : 0,
                    y: opts.y !== undefined ? opts.y : 0,
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
                addPlotToBoard(canvasState, target);
                return;
            }

            const before = cloneLayersForAction([layer]);
            layer.expressions = fields.expressions.map((e, i) => ({
                raw: e.raw,
                math: e.math || null,
                color: PLOT_COLORS[i % PLOT_COLORS.length],
                visible: true,
            }));
            layer.xMin = fields.xMin;
            layer.xMax = fields.xMax;
            layer.yAuto = fields.yAuto;
            layer.yMin = fields.yMin;
            layer.yMax = fields.yMax;
            layer.showGrid = fields.showGrid;
            layer.showRoots = fields.showRoots;
            layer.showIntersections = fields.showIntersections;
            layer.showTicks = fields.showTicks;
            layer.showAxisLabels = fields.showAxisLabels;
            layer.showHeader = fields.showHeader;
            layer._plotCache = null;

            if (canvasState.tileManager) canvasState.tileManager.invalidateLayer(layer, canvasState);
            const after = cloneLayersForAction([layer]);
            if (canvasState.saveState) canvasState.saveState({ type: 'update', before, after });
            if (canvasState.redraw) canvasState.redraw();
        });
    }).catch(() => {});
}
// --- END OF FILE js/plotLayer.js ---
