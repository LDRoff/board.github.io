// --- START OF FILE js/mathModel.js ---
// Модель формулы и её отрисовка в HTML.
//
// Формула хранится как дерево «рядов»:
//   row  = { items: [item, ...] }
//   item = { t: 'txt', v: 'x+1' }              — обычный текст (цифры, буквы, знаки)
//        | { t: 'frac', num: row, den: row }    — дробь
//        | { t: 'pow',  base: row, exp: row }   — степень
//        | { t: 'sqrt', body: row }             — квадратный корень
//        | { t: 'root', idx: row, body: row }   — корень n-й степени
//        | { t: 'abs',  body: row }             — модуль
//        | { t: 'func', name: 'sin', arg: row } — функция
//
// HTML собирается с inline-стилями, а не классами. Причина простая: доска
// растеризует содержимое через SVG <foreignObject>, а туда внешний CSS не
// попадает. Один и тот же HTML используется в редакторе, в слое формулы и
// внутри текста — поэтому формула везде выглядит одинаково.

export const MATH_FONT = "'Cambria Math', 'STIX Two Math', 'Times New Roman', 'DejaVu Serif', serif";

// Символы, вокруг которых нужен воздух.
const SPACED = new Set(['+', '-', '−', '=', '<', '>', '≤', '≥', '≠', '±', '·', '×', '÷', ':', '≈']);

// Символы, которые в формуле пишутся прямым шрифтом (не курсивом).
const UPRIGHT = new Set(['π', 'e', '°', '∞', '′', '″']);

export function emptyRow() {
    return { items: [] };
}

export function emptyMath() {
    return emptyRow();
}

export function rowFromText(text) {
    const clean = String(text || '').replace(/\s+/g, ' ').trim();
    return { items: clean ? [{ t: 'txt', v: clean }] : [] };
}

// ---------------------------------------------------------------- проверки

export function isRowEmpty(row) {
    if (!row || !Array.isArray(row.items)) return true;
    return row.items.every((item) => {
        if (item.t === 'txt') return !String(item.v || '').trim();
        return false;
    });
}

export function isMathEmpty(math) {
    return isRowEmpty(math);
}

// Есть ли в формуле переменная (по умолчанию x) — от этого зависит,
// можно ли строить график.
export function mathHasVariable(math, name = 'x') {
    return plainTextOf(math).includes(name);
}

// --------------------------------------------- текстовая версия формулы

// Плоская запись формулы — из неё строятся графики и её удобно копировать.
export function mathToPlain(node, parent) {
    if (!node) return '';
    const items = Array.isArray(node.items) ? node.items : [node];
    const parts = [];

    for (const item of items) {
        if (!item) continue;
        if (item.t === 'txt') {
            parts.push(String(item.v || ''));
        } else if (item.t === 'frac') {
            parts.push(`(${mathToPlain(item.num)})/(${mathToPlain(item.den)})`);
        } else if (item.t === 'pow') {
            parts.push(`(${mathToPlain(item.base)})^(${mathToPlain(item.exp)})`);
        } else if (item.t === 'sub') {
            parts.push(`${mathToPlain(item.base)}_${mathToPlain(item.sub)}`);
        } else if (item.t === 'sqrt') {
            parts.push(`sqrt(${mathToPlain(item.body)})`);
        } else if (item.t === 'root') {
            parts.push(`(${mathToPlain(item.body)})^(1/(${mathToPlain(item.idx)}))`);
        } else if (item.t === 'abs') {
            parts.push(`abs(${mathToPlain(item.body)})`);
        } else if (item.t === 'func') {
            parts.push(`${item.name}(${mathToPlain(item.arg)})`);
        }
    }
    return parts.join('');
}

export function plainTextOf(math) {
    return mathToPlain(math).replace(/\s+/g, ' ');
}

// ------------------------------------------------------------- JSON <-> DOM

export function cloneMath(math) {
    try {
        return JSON.parse(JSON.stringify(math || emptyMath()));
    } catch (e) {
        return emptyMath();
    }
}

// ---------------------------------------------------------------- отрисовка

function escapeHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

// Текст формулы: цифры и буквы обычным шрифтом, переменные — курсивом,
// знаки — с отступами.
function textToHtml(raw) {
    const value = String(raw || '');
    let out = '';
    let i = 0;
    while (i < value.length) {
        const ch = value[i];

        if (SPACED.has(ch)) {
            out += `<span style="margin:0 0.16em;">${escapeHtml(ch)}</span>`;
            i++;
            continue;
        }

        // Группа обычных символов до следующего знака.
        let j = i;
        let group = '';
        while (j < value.length && !SPACED.has(value[j])) {
            group += value[j];
            j++;
        }
        out += renderChars(group);
        i = j;
    }
    return out;
}

function renderChars(group) {
    let html = '';
    for (const ch of group) {
        if (ch === ' ') {
            html += '&nbsp;';
        } else if (UPRIGHT.has(ch)) {
            html += `<span style="font-style:normal;">${escapeHtml(ch)}</span>`;
        } else if (/[a-zA-Zа-яА-Я]/.test(ch)) {
            html += `<span style="font-style:italic;">${escapeHtml(ch)}</span>`;
        } else {
            html += escapeHtml(ch);
        }
    }
    return html;
}

const ROW_BASE = 'display:inline-block;white-space:pre;text-align:left;';

function rowAttrs(editable, slot) {
    let attrs = '';
    if (editable) attrs += ' contenteditable="true" data-row="1"';
    if (slot) attrs += ` data-slot="${slot}"`;
    return attrs;
}

export function rowToHtml(row, opts = {}) {
    const editable = !!opts.editable;
    const slot = opts.slot || '';
    const extra = opts.style || '';
    const items = (row && Array.isArray(row.items)) ? row.items : [];

    let inner = '';
    for (const item of items) {
        if (!item) continue;
        inner += itemToHtml(item, editable);
    }
    return `<span${rowAttrs(editable, slot)} style="${ROW_BASE}${extra}">${inner}</span>`;
}

function itemToHtml(item, editable) {
    const structAttrs = editable ? ` data-struct="${item.t}"` : '';

    if (item.t === 'txt') {
        return textToHtml(item.v);
    }

    if (item.t === 'frac') {
        return `<span${structAttrs} style="display:inline-flex;flex-direction:column;vertical-align:middle;text-align:center;margin:0 0.06em;">`
            + `<span style="display:block;padding:0 0.2em 0.06em;">${rowToHtml(item.num, { editable, slot: 'num' })}</span>`
            + `<span style="display:block;height:1px;background:currentColor;opacity:0.9;"></span>`
            + `<span style="display:block;padding:0.06em 0.2em 0;">${rowToHtml(item.den, { editable, slot: 'den' })}</span>`
            + `</span>`;
    }

    if (item.t === 'pow') {
        return `<span${structAttrs} style="display:inline-block;white-space:nowrap;">`
            + rowToHtml(item.base, { editable, slot: 'base' })
            + `<span style="display:inline-block;font-size:0.7em;vertical-align:0.55em;margin-left:0.04em;">`
            + rowToHtml(item.exp, { editable, slot: 'exp' })
            + `</span>`
            + `</span>`;
    }

    if (item.t === 'sub') {
        return `<span${structAttrs} style="display:inline-block;white-space:nowrap;">`
            + rowToHtml(item.base, { editable, slot: 'base' })
            + `<span style="display:inline-block;font-size:0.66em;vertical-align:-0.28em;margin-left:0.03em;">`
            + rowToHtml(item.sub, { editable, slot: 'sub' })
            + `</span>`
            + `</span>`;
    }

    if (item.t === 'sqrt') {
        return `<span${structAttrs} style="display:inline-flex;align-items:stretch;white-space:nowrap;margin:0 0.04em;">`
            + `<span style="font-size:1.35em;line-height:1;align-self:flex-end;transform:translateY(-0.02em);">√</span>`
            + `<span style="display:inline-block;border-top:1px solid currentColor;padding:0.08em 0.18em 0 0.12em;">`
            + rowToHtml(item.body, { editable, slot: 'body' })
            + `</span>`
            + `</span>`;
    }

    if (item.t === 'root') {
        return `<span${structAttrs} style="display:inline-flex;align-items:flex-start;white-space:nowrap;margin:0 0.04em;">`
            + `<span style="display:inline-block;font-size:0.62em;position:relative;top:-0.5em;margin-right:-0.3em;">`
            + rowToHtml(item.idx, { editable, slot: 'idx' })
            + `</span>`
            + `<span style="font-size:1.35em;line-height:1;align-self:flex-end;">√</span>`
            + `<span style="display:inline-block;border-top:1px solid currentColor;padding:0.08em 0.18em 0 0.12em;">`
            + rowToHtml(item.body, { editable, slot: 'body' })
            + `</span>`
            + `</span>`;
    }

    if (item.t === 'abs') {
        return `<span${structAttrs} style="display:inline-flex;align-items:stretch;white-space:nowrap;">`
            + `<span style="opacity:0.9;">|</span>`
            + `<span style="display:inline-block;padding:0 0.1em;">${rowToHtml(item.body, { editable, slot: 'body' })}</span>`
            + `<span style="opacity:0.9;">|</span>`
            + `</span>`;
    }

    if (item.t === 'func') {
        return `<span${structAttrs} style="display:inline-block;white-space:nowrap;">`
            + `<span data-func-name="1" style="font-style:normal;margin-right:0.04em;">${escapeHtml(item.name)}</span>`
            + `<span style="opacity:0.85;">(</span>`
            + rowToHtml(item.arg, { editable, slot: 'arg' })
            + `<span style="opacity:0.85;">)</span>`
            + `</span>`;
    }

    return '';
}

// Полная формула: обёртка с шрифтом, размером и цветом.
// fontSize может быть числом (пиксели) или строкой ('1em') — строка нужна,
// чтобы формула внутри текста масштабировалась вместе с размером текста.
export function formulaToHtml(math, opts = {}) {
    const rawSize = opts.fontSize === undefined ? 32 : opts.fontSize;
    const fontSize = (typeof rawSize === 'number') ? `${rawSize}px` : (rawSize || '1em');
    const color = opts.color || 'currentColor';
    const editable = !!opts.editable;
    const extra = opts.extraStyle || '';
    return `<span data-math-root="1" style="display:inline-block;font-family:${MATH_FONT};font-size:${fontSize};line-height:1.25;color:${color};${extra}">`
        + rowToHtml(math, { editable })
        + `</span>`;
}

// ------------------------------------------------- чтение обратно из DOM

function rowFromDom(el) {
    const items = [];
    if (!el) return { items };

    let buffer = '';
    const flush = () => {
        if (buffer) {
            items.push({ t: 'txt', v: buffer });
            buffer = '';
        }
    };

    for (const node of Array.from(el.childNodes)) {
        if (node.nodeType === Node.TEXT_NODE) {
            buffer += node.nodeValue.replace(/\u00a0/g, ' ');
        } else if (node.nodeType === Node.ELEMENT_NODE) {
            const tag = node.tagName;
            if (tag === 'BR') continue;
            const kind = node.getAttribute('data-struct');
            if (kind) {
                flush();
                const sub = (slot) => rowFromDom(node.querySelector(`[data-slot="${slot}"]`));
                if (kind === 'frac') items.push({ t: 'frac', num: sub('num'), den: sub('den') });
                else if (kind === 'pow') items.push({ t: 'pow', base: sub('base'), exp: sub('exp') });
                else if (kind === 'sub') items.push({ t: 'sub', base: sub('base'), sub: sub('sub') });
                else if (kind === 'sqrt') items.push({ t: 'sqrt', body: sub('body') });
                else if (kind === 'root') items.push({ t: 'root', idx: sub('idx'), body: sub('body') });
                else if (kind === 'abs') items.push({ t: 'abs', body: sub('body') });
                else if (kind === 'func') {
                    const nameEl = node.querySelector('[data-func-name]');
                    items.push({
                        t: 'func',
                        name: nameEl ? nameEl.textContent.trim() : 'f',
                        arg: sub('arg'),
                    });
                }
            } else {
                buffer += node.textContent.replace(/\u00a0/g, ' ');
            }
        }
    }
    flush();
    return { items };
}

export function readMathFromDom(rootEl) {
    const rowEl = rootEl ? rootEl.querySelector('[data-row]') : null;
    return rowFromDom(rowEl);
}

// ------------------------------------------------------- нормализация

// Убираем лишние пробелы: в модели они не нужны, отступы даёт отрисовка.
export function normalizeRow(row) {
    if (!row || !Array.isArray(row.items)) return { items: [] };
    const items = [];
    for (const item of row.items) {
        if (!item) continue;
        if (item.t === 'txt') {
            const v = String(item.v || '').replace(/\s+/g, ' ').trim();
            if (!v) continue;
            const prev = items[items.length - 1];
            if (prev && prev.t === 'txt') prev.v += v;
            else items.push({ t: 'txt', v });
        } else if (item.t === 'frac') {
            items.push({ t: 'frac', num: normalizeRow(item.num), den: normalizeRow(item.den) });
        } else if (item.t === 'pow') {
            items.push({ t: 'pow', base: normalizeRow(item.base), exp: normalizeRow(item.exp) });
        } else if (item.t === 'sub') {
            items.push({ t: 'sub', base: normalizeRow(item.base), sub: normalizeRow(item.sub) });
        } else if (item.t === 'sqrt') {
            items.push({ t: 'sqrt', body: normalizeRow(item.body) });
        } else if (item.t === 'root') {
            items.push({ t: 'root', idx: normalizeRow(item.idx), body: normalizeRow(item.body) });
        } else if (item.t === 'abs') {
            items.push({ t: 'abs', body: normalizeRow(item.body) });
        } else if (item.t === 'func') {
            items.push({ t: 'func', name: item.name, arg: normalizeRow(item.arg) });
        }
    }
    return { items };
}

// Для хранения внутри текста: компактная JSON-строка в атрибуте.
export function mathToAttr(math) {
    try {
        return encodeURIComponent(JSON.stringify(normalizeRow(math)));
    } catch (e) {
        return '';
    }
}

export function mathFromAttr(value) {
    if (!value) return emptyMath();
    try {
        return normalizeRow(JSON.parse(decodeURIComponent(value)));
    } catch (e) {
        return emptyMath();
    }
}

// Список всех формул, вставленных в HTML текстового слоя.
// Нужен, чтобы «сделать график» прямо из текста.
export function extractFormulasFromHtml(html) {
    const result = [];
    if (!html) return result;
    const div = document.createElement('div');
    div.innerHTML = html;
    div.querySelectorAll('[data-math]').forEach((el) => {
        const math = mathFromAttr(el.getAttribute('data-math'));
        if (!isMathEmpty(math)) result.push({ math, plain: plainTextOf(math) });
    });
    return result;
}
// --------------------------------------------------------------------------
// Автоформат: обычный текст → формула (как в Excel/Photomath).
// Понимает ^ (степень), / (дробь), _ (индекс), sqrt(...), √, |...| и функции.
// --------------------------------------------------------------------------

// --------------------------------------------------------------------------
// Автоформат: обычный текст → формула (как в Excel/Photomath).
// Понимает ^ (степень), / (дробь), _ (индекс), sqrt(...), √, |...| и функции.
// --------------------------------------------------------------------------

const PLAIN_FUNCTIONS = ['sqrt', 'abs', 'sin', 'cos', 'tg', 'ctg', 'arcsin', 'arccos', 'arctg', 'ln', 'lg', 'log'];

function normalizePlainText(input) {
    return String(input || '')
        .replace(/[\u2212\u2013\u2014]/g, '-')
        .replace(/[\u00d7\u00b7\u2219]/g, '*')
        .replace(/\u00f7/g, '/')
        .replace(/\u221a/g, 'sqrt')
        .replace(/\u00a0/g, ' ');
}

export function parsePlainMath(input) {
    const src = normalizePlainText(input);
    let i = 0;

    const row = () => ({ items: [] });
    const text = (v) => ({ t: 'txt', v });
    const skip = () => { while (i < src.length && src[i] === ' ') i++; };
    const peek = () => src[i];

    function pushItem(items, item) {
        if (!item) return;
        const prev = items[items.length - 1];
        if (item.t === 'txt' && prev && prev.t === 'txt') prev.v += item.v;
        else items.push(item);
    }

    function appendRow(target, source) {
        if (!source) return;
        source.items.forEach((it) => pushItem(target.items, it));
    }

    function readNumber() {
        let s = '';
        while (i < src.length && /[0-9.,]/.test(src[i])) { s += src[i]; i++; }
        return s.replace(',', '.');
    }

    function readIdent() {
        let s = '';
        while (i < src.length && /[a-zA-Z\u0430-\u044f\u0410-\u042f\u03c0\u221e]/.test(src[i])) { s += src[i]; i++; }
        return s;
    }

    function parsePrimary() {
        skip();
        const ch = peek();
        if (ch === undefined) return null;

        if (ch === '(') {
            i++;
            const inner = row();
            parseExpr(inner);
            skip();
            if (peek() === ')') i++;
            const out = row();
            pushItem(out.items, text('('));
            inner.items.forEach((it) => pushItem(out.items, it));
            pushItem(out.items, text(')'));
            return out;
        }

        if (ch === '|') {
            i++;
            const body = row();
            parseExpr(body);
            skip();
            if (peek() === '|') i++;
            const out = row();
            pushItem(out.items, { t: 'abs', body });
            return out;
        }

        if (/[0-9.,]/.test(ch)) {
            const out = row();
            pushItem(out.items, text(readNumber()));
            return out;
        }

        if (/[a-zA-Z\u0430-\u044f\u0410-\u042f\u03c0\u221e]/.test(ch)) {
            const name = readIdent();
            const lower = name.toLowerCase();
            skip();
            if (PLAIN_FUNCTIONS.includes(lower) && peek() === '(') {
                i++;
                const arg = row();
                parseExpr(arg);
                skip();
                if (peek() === ')') i++;
                const out = row();
                if (lower === 'sqrt') pushItem(out.items, { t: 'sqrt', body: arg });
                else if (lower === 'abs') pushItem(out.items, { t: 'abs', body: arg });
                else pushItem(out.items, { t: 'func', name: lower, arg });
                return out;
            }
            const out = row();
            pushItem(out.items, text(name));
            return out;
        }

        i++;
        const out = row();
        pushItem(out.items, text(ch));
        return out;
    }

    // Основание степени — это ровно один «первичный» блок:
    // x^2 → x², (x+1)^2 → (x+1)², sin(x)^2 → sin(x)².
    function parsePower(target) {
        const prim = parsePrimary();
        if (!prim) return;
        skip();
        if (peek() === '^') {
            i++;
            const exp = parsePrimary() || row();
            pushItem(target.items, { t: 'pow', base: prim, exp });
            return;
        }
        if (peek() === '_') {
            i++;
            const sub = parsePrimary() || row();
            pushItem(target.items, { t: 'sub', base: prim, sub });
            return;
        }
        appendRow(target, prim);
    }

    function parsePowerRow() {
        const r = row();
        parsePower(r);
        return r;
    }

    function startsPrimary(ch) {
        return !!ch && /[0-9a-zA-Z\u0430-\u044f\u0410-\u042f\u03c0\u221e(|]/.test(ch);
    }

    function parseTerm(target) {
        let acc = parsePowerRow();
        for (;;) {
            skip();
            const ch = peek();
            if (ch === '/') {
                i++;
                const den = parsePowerRow();
                const out = row();
                out.items.push({ t: 'frac', num: acc, den });
                acc = out;
                continue;
            }
            if (ch === '*') {
                i++;
                pushItem(acc.items, text('\u00d7'));
                appendRow(acc, parsePowerRow());
                continue;
            }
            // Неявное умножение: 2x, 3(x+1).
            if (startsPrimary(ch)) {
                appendRow(acc, parsePowerRow());
                continue;
            }
            break;
        }
        appendRow(target, acc);
    }

    function parseExpr(target) {
        parseTerm(target);
        for (;;) {
            skip();
            const ch = peek();
            if (ch === '+' || ch === '-') {
                i++;
                pushItem(target.items, text(ch === '-' ? '\u2212' : '+'));
                parseTerm(target);
                continue;
            }
            break;
        }
    }

    const root = row();
    parseExpr(root);
    return root;
}
export function plainLooksLikeMath(text) {
    const s = String(text || '').trim();
    if (!s) return false;
    return /[\^\/_\u00f7]/.test(s)
        || /sqrt|abs|sin|cos|tg|ctg|log|ln/i.test(s)
        || /\|/.test(s)
        || /[-*]/.test(s);
}
// --- END OF FILE js/mathModel.js ---