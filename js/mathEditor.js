// --- START OF FILE js/mathEditor.js ---
// Окно ввода формулы: «2D-редактор» с курсором внутри дробей и степеней
// плюс экранная клавиатура с вкладками.
//
// Как это устроено: каждая часть формулы (строка, числитель, знаменатель,
// показатель, индекс) — обычный contenteditable-элемент. Поэтому курсор,
// выделение и ввод работают штатно, а кнопки клавиатуры просто вставляют
// символы и шаблоны в текущую позицию.

import {
    formulaToHtml, readMathFromDom, normalizeRow, emptyMath, emptyRow,
    isMathEmpty, mathHasVariable, parsePlainMath, plainLooksLikeMath,
} from './mathModel.js?v=1.4.19';

let modalEl = null;
let hostEl = null;
let keypadEl = null;
let handler = null;
let activeRow = null;
let activeTab = 'num';
let isTouchDevice = false;
let systemKeyboardWanted = false;
const listenersAttached = { modal: false };

// ------------------------------------------------------------ клавиатура

const TABS = [
    {
        id: 'num',
        label: '123',
        caption: 'Числа и знаки',
        cols: 5,
        keys: [
            { l: '7', i: '7' }, { l: '8', i: '8' }, { l: '9', i: '9' }, { l: '÷', i: '÷', t: 'Деление' }, { l: '⌫', cmd: 'backspace', t: 'Стереть', action: true },
            { l: '4', i: '4' }, { l: '5', i: '5' }, { l: '6', i: '6' }, { l: '×', i: '×', t: 'Умножение' }, { l: '(', i: '(' },
            { l: '1', i: '1' }, { l: '2', i: '2' }, { l: '3', i: '3' }, { l: '−', i: '−', t: 'Минус' }, { l: ')', i: ')' },
            { l: '0', i: '0' }, { l: ',', i: ',', t: 'Десятичная запятая' }, { l: '.', i: '.', t: 'Точка' }, { l: '+', i: '+' }, { l: '=', i: '=' },
            { l: 'x', i: 'x', var: true }, { l: 'y', i: 'y', var: true }, { l: '≠', i: '≠' }, { l: '≤', i: '≤' }, { l: '≥', i: '≥' },
            { l: '←', cmd: 'left', t: 'Курсор влево', action: true }, { l: '→', cmd: 'right', t: 'Курсор вправо', action: true },
            { l: 'Очистить', cmd: 'clear', action: true, wide: 3 },
        ],
    },
    {
        id: 'func',
        label: 'ƒ(x)',
        caption: 'Функции и константы',
        cols: 4,
        keys: [
            { l: 'sin', struct: 'func', name: 'sin' }, { l: 'cos', struct: 'func', name: 'cos' },
            { l: 'tg', struct: 'func', name: 'tg' }, { l: 'ctg', struct: 'func', name: 'ctg' },
            { l: 'arcsin', struct: 'func', name: 'arcsin' }, { l: 'arccos', struct: 'func', name: 'arccos' },
            { l: 'arctg', struct: 'func', name: 'arctg' }, { l: 'ln', struct: 'func', name: 'ln' },
            { l: 'lg', struct: 'func', name: 'lg' }, { l: 'log', struct: 'func', name: 'log' },
            { l: '√', struct: 'sqrt', t: 'Квадратный корень' }, { l: 'ⁿ√', struct: 'root', t: 'Корень n-й степени' },
            { l: 'π', i: 'π' }, { l: 'e', i: 'e' }, { l: '∞', i: '∞' }, { l: '°', i: '°' },
            { l: '±', i: '±' }, { l: '·', i: '·', t: 'Умножение' }, { l: '|x|', struct: 'abs', t: 'Модуль' }, { l: 'x²', struct: 'pow', t: 'Степень' },
        ],
    },
    {
        id: 'tpl',
        label: 'Шаблоны',
        caption: 'Дроби, степени, индексы',
        cols: 4,
        keys: [
            { l: 'a⁄b', struct: 'frac', t: 'Дробь' }, { l: 'x□', html: 'x<sup>□</sup>', struct: 'pow', t: 'Степень' },
            { l: '√□', struct: 'sqrt', t: 'Корень' }, { l: 'ⁿ√□', struct: 'root', t: 'Корень n-й степени' },
            { l: '|□|', struct: 'abs', t: 'Модуль' }, { l: 'xₙ', html: 'x<sub>n</sub>', struct: 'sub', t: 'Индекс' },
            { l: 'x₁', html: 'x<sub>1</sub>', preset: ['x', '1'], t: 'Икс первое' }, { l: 'x₂', html: 'x<sub>2</sub>', preset: ['x', '2'], t: 'Икс второе' },
            { l: 'y₁', html: 'y<sub>1</sub>', preset: ['y', '1'] }, { l: 'y₂', html: 'y<sub>2</sub>', preset: ['y', '2'] },
            { l: 'a₁', html: 'a<sub>1</sub>', preset: ['a', '1'] }, { l: 'a₂', html: 'a<sub>2</sub>', preset: ['a', '2'] },
        ],
    },
];

function buildKeypad() {
    if (!keypadEl) return;
    keypadEl.innerHTML = '';

    const tabs = document.createElement('div');
    tabs.className = 'math-keypad-tabs';

    const body = document.createElement('div');
    body.className = 'math-keypad-body';

    for (const tab of TABS) {
        const tabBtn = document.createElement('button');
        tabBtn.type = 'button';
        tabBtn.className = 'math-tab';
        tabBtn.textContent = tab.label;
        tabBtn.dataset.tab = tab.id;
        tabBtn.classList.toggle('active', tab.id === activeTab);
        tabBtn.addEventListener('pointerdown', (e) => e.preventDefault());
        tabBtn.addEventListener('click', (e) => {
            e.preventDefault();
            activeTab = tab.id;
            buildKeypad();
        });
        tabs.appendChild(tabBtn);
    }
    keypadEl.appendChild(tabs);

    // Быстрый ряд: самое нужное всегда под рукой, без переключения вкладок.
    const quick = document.createElement('div');
    quick.className = 'math-keypad-quick';
    [
        { l: 'a⁄b', struct: 'frac', t: 'Дробь' },
        { l: 'x□', html: 'x<sup>□</sup>', struct: 'pow', t: 'Степень' },
        { l: '√□', struct: 'sqrt', t: 'Корень' },
        { l: '|□|', struct: 'abs', t: 'Модуль' },
        { l: 'xₙ', html: 'x<sub>n</sub>', struct: 'sub', t: 'Индекс' },
        { l: 'π', i: 'π' },
    ].forEach((key) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'math-key math-key-quick';
        if (key.html) btn.innerHTML = `<span class="k-label">${key.html}</span>`;
        else btn.textContent = key.l;
        btn.title = key.t;
        btn.addEventListener('pointerdown', (e) => {
            e.preventDefault();
            e.stopPropagation();
        });
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            handleKey(key);
        });
        quick.appendChild(btn);
    });
    keypadEl.appendChild(quick);

    const current = TABS.find((t) => t.id === activeTab) || TABS[0];

    const caption = document.createElement('div');
    caption.className = 'math-keypad-caption';
    caption.textContent = current.caption;
    body.appendChild(caption);

    const grid = document.createElement('div');
    grid.className = 'math-keypad-grid';
    grid.style.gridTemplateColumns = `repeat(${current.cols}, minmax(0, 1fr))`;

    for (const key of current.keys) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'math-key';
        if (key.html) btn.innerHTML = `<span class="k-label">${key.html}</span>`;
        else btn.textContent = key.l;
        if (key.t) btn.title = key.t;
        if (key.cmd === 'backspace') btn.classList.add('math-key-del');
        if (key.cmd === 'left' || key.cmd === 'right') btn.classList.add('math-key-nav');
        if (key.var) btn.classList.add('math-key-var');
        if (key.action) btn.classList.add('math-key-action');
        else if (/^[0-9.,]$/.test(key.l)) btn.classList.add('math-key-num');
        else if (/^[+\-−×÷=<>≤≥≠()]$/.test(key.l)) btn.classList.add('math-key-op');
        else if (!key.var) btn.classList.add('math-key-fn');
        if (key.wide) btn.style.gridColumn = `span ${key.wide}`;

        btn.addEventListener('pointerdown', (e) => {
            // Не даём кнопке забрать фокус у редактора.
            e.preventDefault();
            e.stopPropagation();
        });
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            handleKey(key);
        });
        grid.appendChild(btn);
    }

    body.appendChild(grid);
    keypadEl.appendChild(body);
}

function handleKey(key) {
    if (key.cmd === 'backspace') doBackspace();
    else if (key.cmd === 'clear') clearAll();
    else if (key.cmd === 'left') moveCaret(-1);
    else if (key.cmd === 'right') moveCaret(1);
    else if (key.cmd === 'up') moveRow(-1);
    else if (key.cmd === 'down') moveRow(1);
    else if (key.struct) insertStructure(key.struct, { name: key.name });
    else if (key.preset) insertSubscriptPreset(key.preset[0], key.preset[1]);
    else if (key.i !== undefined) insertText(key.i);
}

// ------------------------------------------------------------- работа с DOM

function editorRoot() {
    return hostEl ? hostEl.querySelector('[data-math-root]') : null;
}

function allRows() {
    const root = editorRoot();
    return root ? Array.from(root.querySelectorAll('[data-row]')) : [];
}

function markActiveRow(row) {
    if (!hostEl) return;
    hostEl.querySelectorAll('.is-active-row').forEach((el) => el.classList.remove('is-active-row'));
    if (row) row.classList.add('is-active-row');
}

function focusRow(row, where = 'start') {
    if (!row) return;
    activeRow = row;
    markActiveRow(row);
    if (isTouchDevice && !systemKeyboardWanted) {
        row.setAttribute('inputmode', 'none');
        row.setAttribute('virtualkeyboardpolicy', 'manual');
    }
    row.focus();
    const range = document.createRange();
    range.selectNodeContents(row);
    range.collapse(where !== 'end');
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
}

function currentRow() {
    const sel = window.getSelection();
    if (sel && sel.rangeCount) {
        const node = sel.getRangeAt(0).startContainer;
        const el = node.nodeType === 1 ? node : node.parentElement;
        if (el && hostEl && hostEl.contains(el)) {
            const row = el.closest('[data-row]');
            if (row) {
                activeRow = row;
                return row;
            }
        }
    }
    if (activeRow && hostEl && hostEl.contains(activeRow)) return activeRow;
    return editorRoot() ? editorRoot().querySelector('[data-row]') : null;
}

function currentRange() {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return null;
    const range = sel.getRangeAt(0);
    if (!hostEl || !hostEl.contains(range.commonAncestorContainer)) return null;
    return range;
}

function ensureRange(row, where = 'end') {
    let range = currentRange();
    if (range) return range;
    focusRow(row, where);
    range = currentRange();
    return range;
}

function insertText(text) {
    const row = currentRow();
    if (!row) return;
    const range = ensureRange(row, 'end');
    if (!range) return;

    // Если каретка в конце текстового узла — дописываем в него, а не создаём
    // новый узел: иначе формула распадается на пустые текстовые узлы и
    // каретка на них не рисуется.
    if (range.collapsed
        && range.startContainer.nodeType === Node.TEXT_NODE
        && range.startOffset === range.startContainer.nodeValue.length) {
        const tn = range.startContainer;
        tn.nodeValue += text;
        const r = document.createRange();
        r.setStart(tn, tn.nodeValue.length);
        r.collapse(true);
        const s = window.getSelection();
        s.removeAllRanges();
        s.addRange(r);
        activeRow = row;
        updatePlaceholder();
        scheduleAutoFormat();
        return;
    }

    range.deleteContents();
    const node = document.createTextNode(text);
    range.insertNode(node);
    // Каретку ставим ВНУТРЬ узла в его конец: тогда следующий символ
    // допишется в тот же узел, и не будет двух позиций на одном месте.
    range.setStart(node, node.nodeValue.length);
    range.collapse(true);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    activeRow = row;
    updatePlaceholder();
    // Программная вставка не вызывает событие input — планируем автоформат сами.
    scheduleAutoFormat();
}

function doBackspace() {
    const row = currentRow();
    if (!row) return;
    const range = ensureRange(row, 'end');
    if (!range) return;
    if (!range.collapsed) {
        range.deleteContents();
        range.collapse(true);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        updatePlaceholder();
        return;
    }

    // Курсор в пустой части конструкции (степень, индекс, корень…):
    // стираем только эту часть, основание остаётся.
    const struct = structOfRow(row);
    if (struct && rowIsEmpty(row)) {
        stepOutOfStruct(struct);
        return;
    }

    // Удаляем символ слева; если слева структура — «схлопываем» её умно.
    const container = range.startContainer;
    const offset = range.startOffset;
    if (container.nodeType === Node.TEXT_NODE && offset > 0) {
        container.nodeValue = container.nodeValue.slice(0, offset - 1) + container.nodeValue.slice(offset);
        range.setStart(container, offset - 1);
        range.collapse(true);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
    } else if (container.nodeType === Node.ELEMENT_NODE && offset > 0) {
        const prev = container.childNodes[offset - 1];
        if (prev && prev.nodeType === 1 && prev.getAttribute && prev.getAttribute('data-struct')) {
            deleteIntoStruct(prev);
        } else if (prev && prev.remove) {
            prev.remove();
        }
    } else if (container.nodeType === Node.TEXT_NODE && offset === 0) {
        const prev = container.previousSibling;
        if (prev && prev.nodeType === 1 && prev.getAttribute && prev.getAttribute('data-struct')) {
            deleteIntoStruct(prev);
        }
    }
    updatePlaceholder();
}

// Ближайшая конструкция (дробь, степень…), внутри которой стоит строка.
function structOfRow(row) {
    let el = row.parentElement;
    while (el && el !== hostEl) {
        if (el.hasAttribute && el.hasAttribute('data-struct')) return el;
        el = el.parentElement;
    }
    return null;
}

function rowIsEmpty(row) {
    return !row.textContent.trim() && !row.querySelector('[data-struct]');
}

function slotEl(structEl, name) {
    return structEl.querySelector(`[data-slot="${name}"]`);
}

// Удаление части конструкции с сохранением осмысленного содержимого:
// x² → x, x₁ → x, √x → x, sin(x) → x.
function collapseStruct(structEl, removeAll = false) {
    const kind = structEl.getAttribute('data-struct');
    let keep = '';
    if (!removeAll) {
        if (kind === 'pow' || kind === 'sub') keep = (slotEl(structEl, 'base') || {}).textContent || '';
        else if (kind === 'sqrt' || kind === 'abs' || kind === 'root') keep = (slotEl(structEl, 'body') || {}).textContent || '';
        else if (kind === 'func') keep = (slotEl(structEl, 'arg') || {}).textContent || '';
        else if (kind === 'frac') keep = '';
    }

    const parentRow = structEl.parentElement ? structEl.parentElement.closest('[data-row]') : null;
    if (!parentRow) return false;

    const node = document.createTextNode(keep);
    structEl.replaceWith(node);

    // Фокус — на родительскую строку, чтобы каретка не осталась в удалённой части.
    setCaretAt(node, keep.length, parentRow);
    updatePlaceholder();
    return true;
}

// Выход из пустой части конструкции: у степени/индекса основание сохраняется,
// дробь удаляется целиком, корень и функция оставляют своё содержимое.
function stepOutOfStruct(structEl) {
    const kind = structEl.getAttribute('data-struct');
    if (kind === 'frac') {
        return collapseStruct(structEl, true);
    }
    return collapseStruct(structEl, false);
}

// Backspace у конструкции: сначала заходим в её последнюю часть и стираем там
// символ. Так степень/индекс теряют цифру, а не исчезают целиком.
function lastSlotOf(structEl) {
    const kind = structEl.getAttribute('data-struct');
    const name = kind === 'frac' ? 'den'
        : kind === 'pow' ? 'exp'
            : kind === 'sub' ? 'sub'
                : kind === 'func' ? 'arg'
                    : 'body';
    return structEl.querySelector(`[data-slot="${name}"]`);
}

function deleteCharBeforeCaret() {
    const row = currentRow();
    if (!row) return;
    const range = currentRange();
    if (!range || !range.collapsed) return;

    const container = range.startContainer;
    const offset = range.startOffset;

    if (container.nodeType === Node.TEXT_NODE && offset > 0) {
        container.nodeValue = container.nodeValue.slice(0, offset - 1) + container.nodeValue.slice(offset);
        const r = document.createRange();
        r.setStart(container, offset - 1);
        r.collapse(true);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(r);
    } else if (container.nodeType === Node.ELEMENT_NODE && offset > 0) {
        const prev = container.childNodes[offset - 1];
        if (prev && prev.nodeType === 1 && prev.hasAttribute && prev.hasAttribute('data-struct')) {
            collapseStruct(prev, false);
        } else if (prev && prev.remove) {
            prev.remove();
        }
    }
    updatePlaceholder();
}

function deleteIntoStruct(structEl) {
    const slot = lastSlotOf(structEl);
    if (slot) {
        const hasContent = slot.textContent.trim() || slot.querySelector('[data-struct]');
        if (hasContent) {
            focusRow(slot, 'end');
            deleteCharBeforeCaret();
            return true;
        }
    }
    return collapseStruct(structEl, false);
}

function clearAll() {
    const root = editorRoot();
    if (!root) return;
    const row = root.querySelector('[data-row]');
    if (!row) return;
    row.innerHTML = '';
    focusRow(row);
    updatePlaceholder();
}

// Стрелки двигают курсор по символам. Selection.modify делает это правильно,
// но упирается в границу части формулы (например, в конце показателя степени),
// поэтому при «нет сдвига» выходим из вложенной части наружу.
// Перемещение каретки по символам. Идём по текстовым узлам в порядке
// документа: для наших конструкций он совпадает с визуальным порядком
// (основание → показатель → текст справа). Так каретка всегда попадает
// в реальный текст и рисуется в основной строке.
// Перемещение каретки по символам. Идём по текстовым узлам в порядке
// документа: для наших конструкций он совпадает с визуальным порядком
// (основание → показатель → текст справа). Так каретка всегда попадает
// в реальный текст и рисуется в основной строке.
function collectTextNodes(root) {
    const nodes = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    let node;
    while ((node = walker.nextNode())) {
        if (!isEmptyTextNode(node)) nodes.push(node);
    }
    return nodes;
}

// Если каретка стоит «на элементе», ищем ближайшую текстовую позицию.
function resolveTextPosition(container, offset, delta, nodes) {
    if (delta > 0) {
        let child = container.childNodes[offset];
        while (child && isEmptyTextNode(child)) child = child.nextSibling;
        if (child) {
            const t = firstTextIn(child);
            if (t) return { node: t, offset: 0 };
        }
        for (const t of nodes) {
            if (container.contains && container.contains(t)) continue;
            if (container.compareDocumentPosition(t) & Node.DOCUMENT_POSITION_FOLLOWING) {
                return { node: t, offset: 0 };
            }
        }
        return null;
    }

    let child = container.childNodes[offset - 1];
    while (child && isEmptyTextNode(child)) child = child.previousSibling;
    if (child) {
        const t = lastTextIn(child);
        if (t) return { node: t, offset: t.nodeValue.length };
    }
    let prev = null;
    for (const t of nodes) {
        if (container.contains && container.contains(t)) continue;
        if (container.compareDocumentPosition(t) & Node.DOCUMENT_POSITION_PRECEDING) prev = t;
        else break;
    }
    if (prev) return { node: prev, offset: prev.nodeValue.length };
    return null;
}

// ------------------------------------------------------------------
// Позиции каретки. Строим список «остановок» по текстовым узлам в порядке
// документа. Стык двух соседних текстовых узлов в одной строке — это ОДНА
// позиция (иначе стрелка останавливается дважды на одном месте), а граница
// между строкой и вложенной частью (показатель, дробь) — разные позиции.
// ------------------------------------------------------------------
function caretRectAt(node, offset) {
    const r = document.createRange();
    const len = node.nodeValue.length;
    const at = Math.max(0, Math.min(len, offset));
    r.setStart(node, at);
    r.setEnd(node, at);
    let rect = r.getBoundingClientRect();
    if (rect && (rect.width || rect.height)) return rect;
    if (at > 0) {
        r.setStart(node, at - 1);
        r.setEnd(node, at);
        rect = r.getBoundingClientRect();
        if (rect && (rect.width || rect.height)) return rect;
    }
    if (at < len) {
        r.setStart(node, at);
        r.setEnd(node, at + 1);
        rect = r.getBoundingClientRect();
        if (rect && (rect.width || rect.height)) return rect;
    }
    return null;
}

function buildCaretStops(root) {
    const stops = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    let node;
    while ((node = walker.nextNode())) {
        if (!node.nodeValue) continue;
        for (let i = 0; i <= node.nodeValue.length; i++) stops.push({ node, offset: i });
    }

    // На стыке двух текстовых узлов в одной строке позиции визуально
    // совпадают — оставляем только левую, иначе стрелка «стоит дважды».
    const rowOf = (s) => (s.node.parentElement ? s.node.parentElement.closest('[data-row]') : null);
    const merged = [];
    for (const stop of stops) {
        const prev = merged[merged.length - 1];
        if (prev && prev.node !== stop.node && prev.offset === prev.node.nodeValue.length
            && stop.offset === 0 && rowOf(prev) === rowOf(stop) && rowOf(stop)) {
            const r1 = caretRectAt(prev.node, prev.offset);
            const r2 = caretRectAt(stop.node, stop.offset);
            if (r1 && r2 && Math.abs(r1.left - r2.left) < 12 && Math.abs(r1.top - r2.top) < 4) {
                continue;
            }
        }
        merged.push(stop);
    }
    return merged;
}

function moveCaret(delta) {
    const root = editorRoot();
    if (!root) return false;

    cleanEmptyTextNodes(root);

    const row = currentRow();
    if (!row) return false;

    const range = currentRange();
    if (!range) return false;

    const stops = buildCaretStops(root);
    if (!stops.length) return false;

    const container = range.startContainer;
    const offset = range.startOffset;

    const place = (stop) => {
        const textRow = stop.node.parentElement ? stop.node.parentElement.closest('[data-row]') : row;
        return setCaretAt(stop.node, stop.offset, textRow || row);
    };

    let index = -1;
    if (container.nodeType === Node.TEXT_NODE) {
        index = stops.findIndex((s) => s.node === container && s.offset === offset);
    }

    if (index >= 0) {
        const target = stops[index + delta];
        if (target) return place(target);
        // Упёрлись в край: если стоим внутри конструкции — выходим наружу.
        if (structOfRow(row)) return exitToParent(delta > 0);
        return false;
    }

    // Каретка стоит «на элементе» — ищем ближайшую остановку в нужную сторону.
    const probe = document.createRange();
    try {
        probe.setStart(container, offset);
    } catch (e) {
        return false;
    }
    probe.collapse(true);

    let target = null;
    if (delta > 0) {
        for (const stop of stops) {
            if (probe.comparePoint(stop.node, stop.offset) > 0) {
                target = stop;
                break;
            }
        }
    } else {
        for (const stop of stops) {
            if (probe.comparePoint(stop.node, stop.offset) < 0) target = stop;
            else break;
        }
    }

    if (target) return place(target);
    if (structOfRow(row)) return exitToParent(delta > 0);
    return false;
}

function buildStructElement(mathItem, fontSize) {
    const html = formulaToHtml({ items: [mathItem] }, { editable: true, fontSize, color: 'inherit' });
    const tmp = document.createElement('div');
    tmp.innerHTML = html;
    const rootRow = tmp.querySelector('[data-math-root] > [data-row]');
    return rootRow ? rootRow.firstElementChild : null;
}

function makeStruct(kind, opts = {}) {
    const fontSize = parseInt(getComputedStyle(hostEl).fontSize, 10) || 30;
    if (kind === 'frac') return buildStructElement({ t: 'frac', num: emptyRow(), den: emptyRow() }, fontSize);
    if (kind === 'pow') return buildStructElement({ t: 'pow', base: emptyRow(), exp: emptyRow() }, fontSize);
    if (kind === 'sqrt') return buildStructElement({ t: 'sqrt', body: emptyRow() }, fontSize);
    if (kind === 'root') return buildStructElement({ t: 'root', idx: emptyRow(), body: emptyRow() }, fontSize);
    if (kind === 'abs') return buildStructElement({ t: 'abs', body: emptyRow() }, fontSize);
    if (kind === 'sub') return buildStructElement({ t: 'sub', base: emptyRow(), sub: emptyRow() }, fontSize);
    if (kind === 'func') return buildStructElement({ t: 'func', name: opts.name || 'sin', arg: emptyRow() }, fontSize);
    return null;
}

function structPrimaryRow(el, kind) {
    const slot = (kind === 'frac') ? 'num'
        : (kind === 'pow') ? 'exp'
            : (kind === 'func') ? 'arg'
                : (kind === 'sub') ? 'sub'
                    : 'body';
    return el.querySelector(`[data-slot="${slot}"]`) || el.querySelector('[data-slot]');
}

function insertNodeAtCaret(el) {
    const row = currentRow();
    if (!row) return null;
    let range = currentRange();
    if (!range) {
        focusRow(row, 'end');
        range = currentRange();
    }
    if (!range) return null;
    range.insertNode(el);
    activeRow = row;
    return { row, range };
}

function insertStructure(kind, opts = {}) {
    const row = currentRow();
    if (!row) return;
    let range = currentRange();

    // Если каретка не в редакторе (например, только что открыли окно) — ставим её в конец.
    if (!range) {
        focusRow(row, 'end');
        range = currentRange();
    }

    // Переносить в шаблон можно только выделение внутри одной строки.
    let fragment = null;
    if (range && !range.collapsed) {
        const ancestor = range.commonAncestorContainer;
        const ancestorEl = ancestor.nodeType === 1 ? ancestor : ancestor.parentElement;
        const rangeRow = ancestorEl ? ancestorEl.closest('[data-row]') : null;
        if (rangeRow === row) fragment = range.extractContents();
        else range.collapse(false);
    }

    const el = makeStruct(kind, opts);
    if (!el) return;

    if (!range) {
        range = document.createRange();
        range.selectNodeContents(row);
        range.collapse(false);
    }

    range.insertNode(el);

    // Переносим выделенный текст в «главную» часть шаблона.
    if (fragment) {
        let targetSlot = 'num';
        if (kind === 'pow') targetSlot = 'base';
        else if (kind === 'sqrt' || kind === 'root' || kind === 'abs') targetSlot = 'body';
        else if (kind === 'func') targetSlot = 'arg';
        else if (kind === 'sub') targetSlot = 'base';
        const target = el.querySelector(`[data-slot="${targetSlot}"]`);
        if (target) {
            target.innerHTML = '';
            target.appendChild(fragment);
        }
    } else if (kind === 'pow') {
        // Символ слева от шаблона переносим в основание степени.
        const base = el.querySelector('[data-slot="base"]');
        const prev = el.previousSibling;
        if (base && prev && prev.nodeType === Node.TEXT_NODE && prev.nodeValue) {
            const ch = prev.nodeValue.slice(-1);
            prev.nodeValue = prev.nodeValue.slice(0, -1);
            base.textContent = ch;
        } else if (base) {
            const container = range.startContainer;
            const offset = range.startOffset;
            if (container.nodeType === Node.TEXT_NODE && offset > 0) {
                base.textContent = container.nodeValue.slice(offset - 1, offset);
                container.nodeValue = container.nodeValue.slice(0, offset - 1) + container.nodeValue.slice(offset);
            }
        }
    }

    // Курсор — в незаполненную часть шаблона.
    let target = structPrimaryRow(el, kind);
    if (kind === 'pow') {
        const base = el.querySelector('[data-slot="base"]');
        const exp = el.querySelector('[data-slot="exp"]');
        target = (base && !base.textContent && !base.querySelector('[data-struct]')) ? base : exp;
    }
    if (target) focusRow(target, 'start');
    updatePlaceholder();
}

// Готовый индекс: x₁, x₂ и т.п.
function insertSubscriptPreset(base, sub) {
    const row = currentRow();
    if (!row) return;
    const el = makeStruct('sub');
    if (!el) return;
    const baseSlot = el.querySelector('[data-slot="base"]');
    const subSlot = el.querySelector('[data-slot="sub"]');
    if (baseSlot) baseSlot.textContent = base;
    if (subSlot) subSlot.textContent = sub;

    const placed = insertNodeAtCaret(el);
    if (!placed) return;

    // Курсор сразу после индекса, чтобы продолжать печатать.
    const range = document.createRange();
    range.setStartAfter(el);
    range.collapse(true);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    activeRow = placed.row;
    updatePlaceholder();
}

function updatePlaceholder() {
    if (!hostEl) return;
    const root = editorRoot();
    const row = root ? root.querySelector('[data-row]') : null;
    const empty = !row || (!row.textContent.trim() && !row.querySelector('[data-struct]'));
    hostEl.classList.toggle('is-empty', !!empty);
}

// -------------------------------------------- автоформат (как в Excel)

let autoFormatTimer = 0;

// Превращает набранный текст в структуры: x^2 → x², a/b → дробь, x_1 → x₁.
function convertRow(row, { focus = false } = {}) {
    if (!row || !row.isConnected) return false;
    if (row.querySelector('[data-struct]')) return false;

    const raw = row.textContent;
    if (!raw || !plainLooksLikeMath(raw)) return false;
    // Строка заканчивается оператором — пользователь ещё печатает.
    if (/[\^\/_]\s*$/.test(raw)) return false;

    const parsed = parsePlainMath(raw);
    if (!parsed || !parsed.items.length) return false;

    const hasStruct = parsed.items.some((it) => it.t !== 'txt');
    const plainPart = parsed.items.filter((it) => it.t === 'txt').map((it) => it.v).join('');
    if (!hasStruct && plainPart === raw) return false;

    const holder = document.createElement('div');
    holder.innerHTML = formulaToHtml(parsed, { editable: true, fontSize: 1 });
    const inner = holder.querySelector('[data-math-root] > [data-row]');
    if (!inner) return false;

    row.innerHTML = '';
    while (inner.firstChild) row.appendChild(inner.firstChild);
    if (focus) focusRow(row, 'end');
    updatePlaceholder();
    return true;
}

function scheduleAutoFormat() {
    if (autoFormatTimer) clearTimeout(autoFormatTimer);
    autoFormatTimer = setTimeout(() => {
        autoFormatTimer = 0;
        const row = currentRow();
        if (!row) return;
        convertRow(row, { focus: true });
    }, 700);
}

function autoFormatAllRows() {
    const rows = allRows();
    for (let k = rows.length - 1; k >= 0; k--) {
        const row = rows[k];
        if (!row.isConnected) continue;
        convertRow(row, { focus: false });
    }
}

// ------------------------------------------- навигация между частями формулы

// Ставит каретку в ближайшую позицию строки по координате X.
// Нужно для кликов по знакам и скобкам: там браузер промахивается мимо.
function placeCaretByPoint(row, clientX) {
    if (!row) return;
    // Пустые текстовые узлы ломают поиск позиции — убираем их.
    cleanEmptyTextNodes(editorRoot());

    const candidates = [];
    const pushElementSides = (el, index) => {
        const rect = el.getBoundingClientRect();
        if (!rect.width && !rect.height) return;
        candidates.push({ x: rect.left, node: row, offset: index });
        candidates.push({ x: rect.right, node: row, offset: index + 1 });
    };

    const children = Array.from(row.childNodes);
    children.forEach((child, index) => {
        if (child.nodeType === Node.TEXT_NODE) {
            if (!child.nodeValue) return;
            // Позиции внутри текста — по символам (формулы короткие).
            for (let i = 0; i <= child.nodeValue.length; i++) {
                const r = document.createRange();
                r.setStart(child, i);
                r.setEnd(child, Math.min(i + 1, child.nodeValue.length));
                let rect = r.getBoundingClientRect();
                if ((!rect || (!rect.width && !rect.height)) && i === child.nodeValue.length) {
                    const prev = document.createRange();
                    prev.setStart(child, Math.max(0, i - 1));
                    prev.setEnd(child, i);
                    rect = prev.getBoundingClientRect();
                }
                if (!rect) continue;
                const x = i === child.nodeValue.length ? rect.right : rect.left;
                candidates.push({ x, node: child, offset: i });
            }
        } else if (child.nodeType === Node.ELEMENT_NODE) {
            pushElementSides(child, index);
        }
    });

    if (!candidates.length) return;

    let best = candidates[0];
    for (const c of candidates) {
        if (Math.abs(c.x - clientX) < Math.abs(best.x - clientX)) best = c;
    }

    // Позиция «между элементами» рисуется не там, где ждёт человек:
    // превращаем её в позицию внутри соседнего текста.
    let node = best.node;
    let offset = best.offset;
    if (node === row) {
        let next = row.childNodes[offset];
        while (isEmptyTextNode(next)) next = next.nextSibling;
        let prev = row.childNodes[offset - 1];
        while (isEmptyTextNode(prev)) prev = prev.previousSibling;
        const nextText = next ? firstTextIn(next) : null;
        const prevText = prev ? lastTextIn(prev) : null;
        if (nextText) {
            node = nextText;
            offset = 0;
        } else if (prevText) {
            node = prevText;
            offset = prevText.nodeValue.length;
        } else {
            // Совсем нет текста рядом — добавляем пробел, иначе каретка
            // рисуется внутри соседней конструкции.
            const spacer = document.createTextNode('\u00a0');
            if (next) row.insertBefore(spacer, next);
            else row.appendChild(spacer);
            node = spacer;
            offset = 0;
        }
    }

    setCaretAt(node, offset, row);
}

// Каретка в самом начале/конце строки. Сравнение позиций через Range
// ненадёжно на границе «текст ↔ вложенный элемент», поэтому проверяем
// вручную: контейнер-строка, последний/первый текстовый узел или соседей.
function caretAtEdge(where) {
    const range = currentRange();
    const row = currentRow();
    if (!range || !range.collapsed || !row) return false;

    const container = range.startContainer;
    const offset = range.startOffset;

    if (container === row) {
        return where === 'end'
            ? offset >= row.childNodes.length
            : offset <= 0;
    }

    if (container.nodeType !== Node.TEXT_NODE) return false;
    const text = container;
    const atTextEdge = where === 'end' ? offset >= text.nodeValue.length : offset <= 0;
    if (!atTextEdge) return false;

    // Проверяем, что после (или до) узла в строке больше ничего нет.
    let node = text;
    while (node && node !== row) {
        let sibling = where === 'end' ? node.nextSibling : node.previousSibling;
        while (isEmptyTextNode(sibling)) {
            sibling = where === 'end' ? sibling.nextSibling : sibling.previousSibling;
        }
        if (sibling) return false;
        node = node.parentElement;
    }
    return true;
}

function isEmptyTextNode(node) {
    return node && node.nodeType === Node.TEXT_NODE && !node.nodeValue;
}

// Убирает пустые текстовые узлы: они не имеют размеров и мешают ставить каретку.
function cleanEmptyTextNodes(root) {
    if (!root) return;
    const empties = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    let n;
    while ((n = walker.nextNode())) {
        if (isEmptyTextNode(n)) empties.push(n);
    }
    empties.forEach((t) => t.remove());
}

// Первый непустой текстовый узел внутри элемента (для позиции каретки).
function firstTextIn(el) {
    if (!el) return null;
    if (el.nodeType === Node.TEXT_NODE) return isEmptyTextNode(el) ? null : el;
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
    let n;
    while ((n = walker.nextNode())) {
        if (!isEmptyTextNode(n)) return n;
    }
    return null;
}

// Последний непустой текстовый узел внутри элемента.
function lastTextIn(el) {
    if (!el) return null;
    if (el.nodeType === Node.TEXT_NODE) return isEmptyTextNode(el) ? null : el;
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
    let last = null;
    let n;
    while ((n = walker.nextNode())) {
        if (!isEmptyTextNode(n)) last = n;
    }
    return last;
}

// Ставит каретку и переносит фокус на нужную строку: иначе браузер рисует
// мигающую каретку там, где остался фокус, хотя ввод уже идёт в другое место.
function setCaretAt(node, offset, rowEl) {
    if (!node) return false;
    const target = rowEl || (node.nodeType === Node.TEXT_NODE ? node.parentElement : node);
    if (target && target.focus) {
        try { target.focus({ preventScroll: true }); } catch (e) { target.focus(); }
    }
    const range = document.createRange();
    try {
        range.setStart(node, offset);
    } catch (e) {
        return false;
    }
    range.collapse(true);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    if (target && target.closest) {
        const row = target.closest('[data-row]');
        if (row) {
            activeRow = row;
            markActiveRow(row);
        }
    }
    return true;
}

function exitToParent(after, explicitStruct) {
    const row = currentRow();
    if (!row) return false;
    // Ищем ближайшую конструкцию (дробь, степень…), внутри которой стоит строка.
    let struct = explicitStruct || null;
    if (!struct) {
        struct = row.parentElement;
        while (struct && !struct.hasAttribute('data-struct')) struct = struct.parentElement;
    }
    if (!struct) return false;
    const parentRow = struct.parentElement ? struct.parentElement.closest('[data-row]') : null;
    if (!parentRow) return false;

    // Каретку ставим в текст, а не «между элементами»: на границе элементов
    // браузер рисует её внутри соседней конструкции (мелкую, в степени).
    if (after) {
        const text = textNodeAfter(struct);
        return setCaretAt(text, 0, parentRow);
    }
    const text = textNodeBefore(struct);
    return setCaretAt(text, text.nodeValue.length, parentRow);
}

// Текстовый узел сразу после элемента; если его нет — добавляем пробел.
function textNodeAfter(el) {
    let next = el.nextSibling;
    while (isEmptyTextNode(next)) next = next.nextSibling;
    if (next) {
        if (next.nodeType === Node.TEXT_NODE) return next;
        const t = firstTextIn(next);
        if (t) return t;
    }
    const spacer = document.createTextNode('\u00a0');
    el.after(spacer);
    return spacer;
}

// Текстовый узел сразу перед элементом; если его нет — добавляем пробел.
function textNodeBefore(el) {
    let prev = el.previousSibling;
    while (isEmptyTextNode(prev)) prev = prev.previousSibling;
    if (prev) {
        if (prev.nodeType === Node.TEXT_NODE) return prev;
        const t = lastTextIn(prev);
        if (t) return t;
    }
    const spacer = document.createTextNode('\u00a0');
    el.before(spacer);
    return spacer;
}

function moveRow(delta) {
    const rows = allRows();
    const idx = rows.indexOf(currentRow());
    if (idx < 0) return false;
    const next = rows[idx + delta];
    if (!next) return exitToParent(delta > 0);
    focusRow(next, delta > 0 ? 'start' : 'end');
    return true;
}

// -------------------------------------------------- системная клавиатура

function applyKeyboardMode() {
    if (!hostEl) return;
    const wantSystem = systemKeyboardWanted;
    hostEl.querySelectorAll('[data-row]').forEach((row) => {
        row.setAttribute('inputmode', wantSystem ? 'text' : 'none');
        row.setAttribute('virtualkeyboardpolicy', wantSystem ? 'auto' : 'manual');
    });
    const btn = document.getElementById('math-keyboard-toggle');
    if (btn) {
        btn.classList.toggle('active', wantSystem);
        btn.title = wantSystem ? 'Скрыть системную клавиатуру' : 'Показать системную клавиатуру';
    }
}

function toggleSystemKeyboard() {
    systemKeyboardWanted = !systemKeyboardWanted;
    applyKeyboardMode();
    const row = currentRow();
    if (systemKeyboardWanted && row) {
        row.focus();
    } else if (row) {
        focusRow(row, 'end');
        if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    }
}

// ------------------------------------------------------------- открытие/закрытие

function onDocumentKeydown(e) {
    if (!modalEl || modalEl.classList.contains('hidden')) return;
    if (e.key === 'Escape') {
        e.preventDefault();
        close();
        return;
    }
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        submit(false);
        return;
    }
    if (!e.target || !hostEl || !hostEl.contains(e.target)) return;

    // Навигация между частями формулы.
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        moveRow(e.key === 'ArrowDown' ? 1 : -1);
        return;
    }

    // Стрелки влево/вправо ведём сами: браузер на границе конструкций
    // перепрыгивает позицию «сразу после степени, перед знаком».
    if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        moveCaret(e.key === 'ArrowRight' ? 1 : -1);
        return;
    }

    // Пробел или Tab в конце степени/индекса — быстрый выход из неё.
    const activeRowNow = currentRow();
    if ((e.key === ' ' || e.key === 'Tab') && activeRowNow && structOfRow(activeRowNow) && caretAtEdge('end')) {
        e.preventDefault();
        exitToParent(true);
        return;
    }

    // Tab внутри формулы всегда выводит на уровень выше.
    if (e.key === 'Tab' && activeRowNow && structOfRow(activeRowNow)) {
        e.preventDefault();
        exitToParent(true);
        return;
    }

    // Печатные символы вставляем вручную, чтобы попадать точно в каретку.
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const ch = e.key;
        if (!/[0-9a-zA-Zа-яА-Я+\-*/^=<>(){}[\].,:;|π°√∞]/.test(ch)) return;
        e.preventDefault();
        insertText(ch === '*' ? '×' : ch === '/' ? '÷' : ch);
        return;
    }
    if (e.key === 'Backspace') {
        e.preventDefault();
        doBackspace();
    }
}

export function openMathEditor(opts = {}) {
    modalEl = document.getElementById('math-modal');
    hostEl = document.getElementById('math-editor-host');
    keypadEl = document.getElementById('math-keypad');
    if (!modalEl || !hostEl) return;

    handler = { onSubmit: opts.onSubmit || null };
    isTouchDevice = !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
    systemKeyboardWanted = false;

    const titleEl = document.getElementById('math-modal-title');
    if (titleEl) titleEl.textContent = opts.title || 'Формула';

    const math = opts.math || emptyMath();
    hostEl.innerHTML = formulaToHtml(math, { editable: true, fontSize: opts.fontSize || 30, color: 'currentColor' });
    applyKeyboardMode();

    buildKeypad();
    updatePlaceholder();

    const hint = document.getElementById('math-hint');
    if (hint) {
        hint.textContent = opts.hint
            || 'Кнопки — ввод, текст тоже можно печатать: x^2, a/b и x_1 сами станут формулой. → в конце степени — выйти из неё';
    }

    const graphBtn = document.getElementById('math-graph');
    if (graphBtn) graphBtn.style.display = opts.showGraph === false ? 'none' : '';

    const kbBtn = document.getElementById('math-keyboard-toggle');
    if (kbBtn) kbBtn.style.display = isTouchDevice ? '' : 'none';

    modalEl.classList.remove('hidden');
    modalEl.classList.add('visible');
    document.body.classList.add('math-modal-open');

    // На телефоне не открываем системную клавиатуру автоматически.
    if (!isTouchDevice) {
        const firstRow = editorRoot() ? editorRoot().querySelector('[data-row]') : null;
        setTimeout(() => focusRow(firstRow, 'end'), 30);
    }

    if (!listenersAttached.modal) {
        listenersAttached.modal = true;
        document.addEventListener('keydown', onDocumentKeydown, true);
        // Подсветка активной части формулы по положению каретки.
        document.addEventListener('selectionchange', () => {
            if (!hostEl || !modalEl || modalEl.classList.contains('hidden')) return;
            const sel = window.getSelection();
            if (!sel || !sel.rangeCount) return;
            const node = sel.getRangeAt(0).startContainer;
            const el = node.nodeType === 1 ? node : node.parentElement;
            if (!el || !hostEl.contains(el)) return;
            const row = el.closest('[data-row]');
            if (!row) return;
            activeRow = row;
            markActiveRow(row);
        });
        hostEl.addEventListener('focusin', (e) => {
            const row = e.target.closest ? e.target.closest('[data-row]') : null;
            if (row && hostEl.contains(row)) {
                activeRow = row;
                markActiveRow(row);
            }
        });
        hostEl.addEventListener('input', () => {
            updatePlaceholder();
            scheduleAutoFormat();
        });
        hostEl.addEventListener('pointerdown', (e) => {
            if (e.target.closest && e.target.closest('[data-row]')) return;
            e.preventDefault();
            const root = editorRoot();
            if (root) focusRow(root.querySelector('[data-row]'), 'end');
        });

        // Клик по оформлению (знак, скобка) браузер ставит в ближайшую
        // редактируемую строку — из-за этого каретка «залипает» в степени.
        // Ставим её сами по координате клика.
        hostEl.addEventListener('mousedown', (e) => {
            const root = editorRoot();
            const row = root ? root.querySelector('[data-row]') : null;
            if (!row) return;
            const rowEl = e.target.closest ? e.target.closest('[data-row]') : null;

            // Клик по вложенной части (числитель, показатель) — пусть браузер
            // ставит сам. Но если кликнули ниже показателя (там, где строка
            // уже основная), ставим каретку сразу после конструкции.
            if (rowEl && rowEl !== row) {
                const struct = structOfRow(rowEl);
                if (struct) {
                    const rect = rowEl.getBoundingClientRect();
                    const belowPart = e.clientY > rect.top + rect.height * 0.6;
                    if (belowPart) {
                        e.preventDefault();
                        if (e.clientX > rect.right - 2) {
                            exitToParent(true, struct);
                        } else {
                            placeCaretByPoint(row, e.clientX);
                        }
                        return;
                    }
                }
                return;
            }

            // Клик по оформлению (знак, скобка) браузер ставит не туда — ставим сами.
            e.preventDefault();
            placeCaretByPoint(row, e.clientX);
        });
        document.getElementById('math-done').addEventListener('click', () => submit(false));
        document.getElementById('math-cancel').addEventListener('click', () => close());
        document.getElementById('math-modal-close').addEventListener('click', () => close());
        const graphBtnEl = document.getElementById('math-graph');
        if (graphBtnEl) graphBtnEl.addEventListener('click', () => submit(true));
        const kbBtnEl = document.getElementById('math-keyboard-toggle');
        if (kbBtnEl) kbBtnEl.addEventListener('pointerdown', (e) => e.preventDefault());
        if (kbBtnEl) kbBtnEl.addEventListener('click', (e) => {
            e.preventDefault();
            toggleSystemKeyboard();
        });
    }
}

export function close() {
    if (!modalEl) return;
    modalEl.classList.add('hidden');
    modalEl.classList.remove('visible');
    document.body.classList.remove('math-modal-open');
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    hostEl = null;
    keypadEl = null;
    handler = null;
    activeRow = null;
}

function submit(graphRequested) {
    if (!hostEl) return;
    // Перед сохранением дожимаем автоформат во всех строках.
    autoFormatAllRows();
    const math = normalizeRow(readMathFromDom(hostEl));
    const hint = document.getElementById('math-hint');

    if (isMathEmpty(math)) {
        if (hint) {
            hint.textContent = 'Формула пока пустая — введите выражение';
            hint.classList.add('math-hint-error');
            setTimeout(() => hint.classList.remove('math-hint-error'), 900);
        }
        return;
    }

    if (graphRequested && !mathHasVariable(math)) {
        if (hint) {
            hint.textContent = 'Для графика нужна переменная x';
            hint.classList.add('math-hint-error');
            setTimeout(() => hint.classList.remove('math-hint-error'), 1200);
        }
        return;
    }

    const cb = handler;
    const payload = { math, graph: !!graphRequested };
    close();
    if (cb && cb.onSubmit) cb.onSubmit(payload);
}
// --- END OF FILE js/mathEditor.js ---
