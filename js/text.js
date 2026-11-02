import { cloneLayersForAction, createTextImage } from './utils.js?v=1.4.19';
import { mathFromAttr, isMathEmpty, parsePlainMath, normalizeRow, readMathFromDom, mathToAttr, plainTextOf, formulaToHtml } from './mathModel.js?v=1.4.19';
import { formulaInlineHtml } from './formulaLayer.js?v=1.4.19';
import { openMathEditor } from './mathEditor.js?v=1.4.19';

let editorDiv = null;
let currentEditingLayer = null;
let originalLayerStateBeforeEdit = null;
let canvasStateRef = null;
let onFinishCallback = null;
let onOutsidePressHandler = null;
// The last known good selection range inside the editor.
// Updated on every selectionchange while the editor has focus.
// Also updated after every formatting operation.
let savedSelectionRange = null;
let _isEditing = false;
let editStartTime = 0;

// Автоформат в тексте можно выключить в настройках.
let autoFormatEnabled = true;
try {
    const stored = localStorage.getItem('boardAutoFormatFormulas');
    if (stored !== null) autoFormatEnabled = stored !== 'false';
} catch (e) { /* приватный режим */ }

export function setAutoFormatEnabled(enabled) {
    autoFormatEnabled = enabled !== false;
    try { localStorage.setItem('boardAutoFormatFormulas', autoFormatEnabled); } catch (e) { /* ignore */ }
}

export function isAutoFormatEnabled() {
    return autoFormatEnabled;
}

export function getEditorTextarea() {
    return editorDiv;
}

export function isActivelyEditing() {
    return _isEditing;
}

// Keep savedSelectionRange fresh whenever the user moves the caret inside the editor.
let _isQueryingFormatState = false;
document.addEventListener('selectionchange', () => {
    if (_isQueryingFormatState) return; // ignore synthetic selection changes from getFormatState
    if (editorDiv && document.activeElement === editorDiv) {
        const sel = window.getSelection();
        if (sel && sel.rangeCount > 0) {
            try {
                savedSelectionRange = sel.getRangeAt(0).cloneRange();
            } catch (e) { /* ignore */ }
        }
    }
});

// ----- Helpers -----

/**
 * Restores the saved selection into the editor and focuses it.
 * Call this inside every formatting function before touching the DOM.
 */
function restoreSelectionAndFocus() {
    if (!editorDiv) return;
    // Save the range to a local var BEFORE focus() changes anything
    const rangeToRestore = savedSelectionRange ? savedSelectionRange.cloneRange() : null;
    // Block selectionchange from overwriting savedSelectionRange during focus/addRange
    _isQueryingFormatState = true;
    editorDiv.focus();
    if (rangeToRestore) {
        const sel = window.getSelection();
        sel.removeAllRanges();
        try { sel.addRange(rangeToRestore); } catch (e) {}
        savedSelectionRange = rangeToRestore; // ensure it's correct after the focus
    }
    _isQueryingFormatState = false;
}

/**
 * Snapshots the current selection from the DOM into savedSelectionRange.
 * Call this after every DOM-mutating formatting operation.
 */
function snapshotSelection() {
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) {
        try { savedSelectionRange = sel.getRangeAt(0).cloneRange(); } catch (e) { /* ignore */ }
    }
}

// ----- Public API -----

export function getFormatState() {
    if (!editorDiv || !canvasStateRef || !_isEditing) return null;
    if (!savedSelectionRange) return null;

    // Читаем состояние по вычисленным стилям узла под курсором.
    // queryCommandState больше не используем: он устарел и требует фокуса.
    let node = null;
    const liveSelection = window.getSelection();
    const range = (document.activeElement === editorDiv && liveSelection && liveSelection.rangeCount > 0)
        ? liveSelection.getRangeAt(0)
        : savedSelectionRange;

    if (range) {
        // Для выделения берём стиль первого выделенного символа. Для свёрнутой
        // каретки — символ перед ней: после execCommand каретка часто оказывается
        // сразу ЗА <u>/<strike>, и тогда кнопка ошибочно гасла.
        let container = range.startContainer;
        let offset = range.startOffset;

        if (range.collapsed) {
            if (container.nodeType === 3) {
                node = container.parentElement || container.parentNode;
            } else if (container.nodeType === 1) {
                const before = container.childNodes[Math.max(0, offset - 1)];
                const after = container.childNodes[offset];
                const sample = before || after;
                node = sample
                    ? (sample.nodeType === 3 ? sample.parentElement : sample)
                    : container;
            }
        } else {
            if (container.nodeType === 1) {
                const child = container.childNodes[offset] || container.childNodes[Math.max(0, offset - 1)];
                node = child ? (child.nodeType === 3 ? child.parentElement : child) : container;
            } else {
                node = container;
            }
        }

        if (node && node.nodeType === 3) node = node.parentElement;
    }

    const state = {
        bold: false, italic: false, underline: false, strikeThrough: false,
        superscript: false, subscript: false,
        bulletList: false, numberList: false,
        alignLeft: false, alignCenter: false, alignRight: false,
        fontName: null, fontSize: null, foreColor: null, backColor: null
    };

    // fontSize и выравнивание — свойства всего текстового слоя.
    if (currentEditingLayer) {
        state.fontSize = currentEditingLayer.fontSize;
        const align = currentEditingLayer.align || 'left';
        state.alignLeft = align === 'left';
        state.alignCenter = align === 'center';
        state.alignRight = align === 'right';
    }

    if (node && editorDiv.contains(node)) {
        const computedStyle = window.getComputedStyle(node);
        if (computedStyle) {
            state.fontName = computedStyle.fontFamily.replace(/['"]/g, '').split(',')[0].trim();
            state.foreColor = computedStyle.color;
            state.backColor = computedStyle.backgroundColor;

            const weight = computedStyle.fontWeight;
            state.bold = weight === 'bold' || weight === '700' || parseInt(weight, 10) >= 600;
            state.italic = computedStyle.fontStyle === 'italic';

            const decoration = computedStyle.textDecorationLine || computedStyle.textDecoration || '';
            state.underline = decoration.includes('underline');
            state.strikeThrough = decoration.includes('line-through');

            state.superscript = computedStyle.verticalAlign === 'super';
            state.subscript = computedStyle.verticalAlign === 'sub';
        }

        if (node.closest) {
            const list = node.closest('ul, ol');
            if (list) {
                state.bulletList = list.tagName === 'UL';
                state.numberList = list.tagName === 'OL';
            }
        }
    }

    return state;
}

export function applyRichTextFormatting(command, value = null) {
    if (!editorDiv) return;
    restoreSelectionAndFocus();

    const selection = window.getSelection();
    if (!selection) return;

    let wasCollapsed = false;
    if (selection.isCollapsed) {
        wasCollapsed = true;
        const range = document.createRange();
        range.selectNodeContents(editorDiv);
        selection.removeAllRanges();
        selection.addRange(range);
    }

    document.execCommand(command, false, value);

    if (wasCollapsed) {
        selection.collapseToEnd();
    }
    snapshotSelection();

    updateEditorSizeAndLayer();
}

/**
 * Global property setters for the whole text layer.
 * Стили применяются через Range API (см. applyRichTextProperty), без execCommand.
 */
export function setFontSize(size) {
    if (!currentEditingLayer) return;
    currentEditingLayer.fontSize = size;
    updateEditorStyle(currentEditingLayer);
    applyRichTextProperty('fontSize', size);
}

// Меняет размер шрифта всего слоя, не забирая фокус у поля ввода.
// Нужно для мобильного поля размера: setFontSize фокусирует редактор,
// из-за чего клавиатура закрывалась после каждой цифры.
export function setFontSizeGlobal(size) {
    if (!currentEditingLayer) return;
    currentEditingLayer.fontSize = size;
    updateEditorStyle(currentEditingLayer);
}

export function setFontFamily(font) {
    if (!currentEditingLayer) return;
    currentEditingLayer.fontFamily = font;
    updateEditorStyle(currentEditingLayer);
    applyRichTextProperty('fontFamily', font);
}

export function setTextColor(color) {
    if (!currentEditingLayer) return;
    currentEditingLayer.color = color;
    updateEditorStyle(currentEditingLayer);
    applyRichTextProperty('color', color);
}

export function setTextAlign(align) {
    if (!currentEditingLayer) return;
    restoreSelectionAndFocus();
    currentEditingLayer.align = align;
    updateEditorStyle(currentEditingLayer);
    updateEditorSizeAndLayer();
}

export function clearInlinePropertyFromContent(content, property) {
    if (!content) return content;
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = content;
    const elements = tempDiv.querySelectorAll('*');
    elements.forEach(el => {
        if (el.style && el.style[property]) {
            el.style[property] = '';
            if (el.getAttribute('style') === '') el.removeAttribute('style');
        }
    });
    return tempDiv.innerHTML;
}

function collectTextSegments(root, range) {
    const segments = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    let node;
    while ((node = walker.nextNode())) {
        const text = node.nodeValue;
        if (!text) continue;
        // Внутрь формул не лезем: там своя вёрстка и свои размеры.
        if (node.parentElement && node.parentElement.closest && node.parentElement.closest('[data-math]')) continue;

        let intersects = true;
        try { intersects = range.intersectsNode(node); } catch (e) { intersects = false; }
        if (!intersects) continue;

        let start = 0;
        let end = text.length;
        if (node === range.startContainer) start = range.startOffset;
        if (node === range.endContainer) end = range.endOffset;

        if (end > start) segments.push({ node, start, end });
    }
    return segments;
}

export function applyRichTextProperty(property, value) {
    if (!editorDiv) return;
    restoreSelectionAndFocus();

    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;

    let range = selection.getRangeAt(0);
    const originalRange = range.cloneRange();
    const wasCollapsed = range.collapsed;

    // Как и раньше: при схлопнутой каретке свойство применяется ко всему тексту.
    if (wasCollapsed) {
        range = document.createRange();
        range.selectNodeContents(editorDiv);
    }

    const actualValue = (property === 'fontSize') ? `${value}px` : value;
    const shouldClear = (actualValue === 'transparent' || actualValue === '' || actualValue == null);
    const segments = collectTextSegments(editorDiv, range);

    const restoreCaret = () => {
        selection.removeAllRanges();
        try {
            selection.addRange(originalRange);
        } catch (e) {
            selection.collapseToEnd();
        }
        snapshotSelection();
    };

    if (shouldClear) {
        segments.forEach(({ node }) => {
            let el = node.parentElement;
            while (el && el !== editorDiv) {
                if (el.style && el.style[property]) {
                    el.style[property] = '';
                    if (!el.getAttribute('style')) el.removeAttribute('style');
                }
                el = el.parentElement;
            }
        });
        if (wasCollapsed) restoreCaret();
        updateEditorSizeAndLayer();
        return;
    }

    const spans = [];
    segments.forEach(({ node, start, end }) => {
        if (!node.isConnected) return;

        let target = node;
        if (start > 0) target = target.splitText(start);

        const selectedLength = end - start;
        if (selectedLength > 0 && selectedLength < target.nodeValue.length) {
            target.splitText(selectedLength);
        }

        const parent = target.parentNode;
        if (!parent) return;

        const span = document.createElement('span');
        span.style[property] = actualValue;

        // Сначала вставляем span на место узла, затем переносим узел внутрь.
        parent.insertBefore(span, target);
        span.appendChild(target);

        span.querySelectorAll('*').forEach(desc => {
            if (desc.style && desc.style[property]) {
                desc.style[property] = '';
                if (!desc.getAttribute('style')) desc.removeAttribute('style');
            }
        });

        spans.push(span);
    });

    if (spans.length > 0) {
        const newRange = document.createRange();
        newRange.setStartBefore(spans[0]);
        newRange.setEndAfter(spans[spans.length - 1]);
        selection.removeAllRanges();
        selection.addRange(newRange);
        savedSelectionRange = newRange.cloneRange();
    } else if (wasCollapsed) {
        restoreCaret();
    }

    updateEditorSizeAndLayer();
}

export function transformHTMLCase(html) {
    if (!html) return html;
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = html;
    
    const text = tempDiv.textContent;
    if (!text || !text.trim()) return html;
    
    // If the text is all uppercase, change to lowercase. Otherwise to uppercase.
    const isUpper = (text === text.toUpperCase());
    
    const walk = document.createTreeWalker(tempDiv, NodeFilter.SHOW_TEXT, {
        acceptNode(n) {
            if (n.parentElement && n.parentElement.closest && n.parentElement.closest('[data-math]')) {
                return NodeFilter.FILTER_REJECT;
            }
            return NodeFilter.FILTER_ACCEPT;
        }
    }, false);
    let node;
    while(node = walk.nextNode()) {
        if (isUpper) {
            node.nodeValue = node.nodeValue.toLowerCase();
        } else {
            node.nodeValue = node.nodeValue.toUpperCase();
        }
    }
    return tempDiv.innerHTML;
}

export function toggleTextCase() {
    if (!editorDiv) return;
    restoreSelectionAndFocus();

    const selection = window.getSelection();
    if (!selection || !selection.rangeCount || selection.isCollapsed) return;

    const range = selection.getRangeAt(0);
    const fragment = range.cloneContents();
    const tempDiv = document.createElement('div');
    tempDiv.appendChild(fragment);

    const transformedHTML = transformHTMLCase(tempDiv.innerHTML);

    // Заменяем выделение вручную: execCommand('insertHTML') больше не нужен.
    const holder = document.createElement('div');
    holder.innerHTML = transformedHTML;

    const newFragment = document.createDocumentFragment();
    let lastNode = null;
    while (holder.firstChild) {
        lastNode = holder.firstChild;
        newFragment.appendChild(lastNode);
    }

    range.deleteContents();
    range.insertNode(newFragment);

    if (lastNode) {
        const newRange = document.createRange();
        newRange.setStartAfter(lastNode);
        newRange.collapse(true);
        selection.removeAllRanges();
        selection.addRange(newRange);
        savedSelectionRange = newRange.cloneRange();
    }

    updateEditorSizeAndLayer();
}

// ----- Internal Editor Lifecycle -----

function initializeTextEditor() {
    if (editorDiv) return;

    editorDiv = document.createElement('div');
    editorDiv.id = 'text-editor-div';
    editorDiv.contentEditable = 'true';
    editorDiv.spellcheck = false;

    document.body.appendChild(editorDiv);

    // Update toolbar UI on selection change / key / mouse
    const updateToolbarUI = () => {
        if (canvasStateRef && canvasStateRef.updateFloatingToolbar) {
            canvasStateRef.updateFloatingToolbar();
        }
    };
    editorDiv.addEventListener('mouseup', updateToolbarUI);
    editorDiv.addEventListener('keyup', updateToolbarUI);
    editorDiv.addEventListener('click', updateToolbarUI);

    editorDiv.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' || (e.key === 'Enter' && (e.shiftKey || e.ctrlKey || e.metaKey))) {
            e.preventDefault();
            finishEditing();
        }
        e.stopPropagation();
    });

    const stopPropagation = (e) => e.stopPropagation();
    editorDiv.addEventListener('pointerdown', stopPropagation);
    editorDiv.addEventListener('mousedown', stopPropagation);
    editorDiv.addEventListener('mouseup', stopPropagation);
    editorDiv.addEventListener('click', stopPropagation);
    editorDiv.addEventListener('dblclick', stopPropagation);
    editorDiv.addEventListener('contextmenu', stopPropagation);

    // Клик вплотную к формуле ставит курсор рядом с ней, а не внутрь:
    // иначе каретка «залипает» в показателе степени.
    editorDiv.addEventListener('mousedown', (e) => {
        const mathEl = e.target && e.target.closest ? e.target.closest('[data-math]') : null;
        if (mathEl && editorDiv.contains(mathEl)) {
            const rect = mathEl.getBoundingClientRect();
            const nearLeft = e.clientX <= rect.left + 6;
            const nearRight = e.clientX >= rect.right - 6;
            if (nearLeft || nearRight) {
                e.preventDefault();
                placeCaretBesideMath(mathEl, nearLeft);
                return;
            }
        }

        const near = findMathNearPoint(e.clientX, e.clientY, 8);
        if (!near) return;
        e.preventDefault();
        placeCaretBesideMath(near.el, near.side === 'left');
    });

    // Двойной клик по формуле внутри текста — правка формулы.
    editorDiv.addEventListener('dblclick', (e) => {
        const mathEl = e.target && e.target.closest ? e.target.closest('[data-math]') : null;
        if (!mathEl) return;
        e.preventDefault();
        e.stopPropagation();
        openInlineFormulaEditor(mathEl);
    });

    editorDiv.addEventListener('wheel', (e) => {
        if (canvasStateRef && canvasStateRef.performZoom && canvasStateRef.canvas) {
            e.preventDefault();
            const rect = canvasStateRef.canvas.getBoundingClientRect();
            const mouseX = e.clientX - rect.left;
            const mouseY = e.clientY - rect.top;

            if (e.deltaY < 0) {
                canvasStateRef.performZoom('in', { x: mouseX, y: mouseY });
            } else {
                canvasStateRef.performZoom('out', { x: mouseX, y: mouseY });
            }
        }
    });

    editorDiv.addEventListener('input', () => {
        updateEditorSizeAndLayer();
        scheduleTextAutoFormat();
    });

    // Вставка из буфера: содержимое должно подстроиться под этот блок —
    // цвет, фон, шрифт и кегль берём от окружающего текста.
    editorDiv.addEventListener('paste', () => {
        const known = new Set(Array.from(editorDiv.querySelectorAll('*')));
        setTimeout(() => {
            const fresh = Array.from(editorDiv.querySelectorAll('*')).filter((el) => !known.has(el));
            fresh.forEach((el) => {
                if (el.style) {
                    el.style.fontSize = '';
                    el.style.fontFamily = '';
                    el.style.color = '';
                    el.style.backgroundColor = '';
                    el.style.background = '';
                    el.style.fontWeight = '';
                    el.style.fontStyle = '';
                    el.style.textDecoration = '';
                    el.style.textShadow = '';
                }
                if (el.tagName === 'FONT') {
                    ['size', 'face', 'color'].forEach((attr) => {
                        if (el.getAttribute(attr)) el.removeAttribute(attr);
                    });
                }
                if (el.hasAttribute && el.hasAttribute('bgcolor')) el.removeAttribute('bgcolor');
            });

            editorDiv.querySelectorAll('[data-math]').forEach((span) => {
                if (known.has(span)) return;
                span.setAttribute('contenteditable', 'false');
                span.querySelectorAll('[data-row]').forEach((row) => row.removeAttribute('contenteditable'));
                const root = span.querySelector('[data-math-root]');
                if (root) {
                    root.style.fontSize = '1em';
                    root.style.fontFamily = '';
                    root.style.color = 'currentColor';
                }
            });

            updateEditorSizeAndLayer();
            scheduleTextAutoFormat();
        }, 0);
    });

    // Поставил пробел после «2x-5» — сразу превращаем в формулу (как в Excel).
    editorDiv.addEventListener('keyup', (e) => {
        if (e.key === ' ' || e.key === 'Enter' || e.key === ')') {
            applyTextAutoFormat();
        }
    });
}

// ------------------------------------------------- автоформат формул в тексте
// Пользователь печатает «2x-5» или «1/2» — после паузы это становится
// настоящей формулой прямо в тексте.

let textAutoFormatTimer = null;

function looksLikeTextMath(token) {
    if (!token) return false;
    if (/[А-Яа-яЁё]/.test(token)) return false;          // слова не трогаем
    const hasDigit = /\d/.test(token);
    const hasLetter = /[A-Za-zπ]/.test(token);
    const hasMathSign = /[\^_\/√|]/.test(token);
    if (hasDigit && hasMathSign) return true;
    if (hasDigit && hasLetter) return true;
    if (/\d+\s*\/\s*\d+/.test(token)) return true;
    if (/(sin|cos|tg|ctg|ln|lg|log|sqrt)\s*\(/i.test(token)) return true;
    return false;
}

function scheduleTextAutoFormat() {
    if (!autoFormatEnabled) return;
    if (textAutoFormatTimer) clearTimeout(textAutoFormatTimer);
    textAutoFormatTimer = setTimeout(() => {
        textAutoFormatTimer = null;
        if (!autoFormatEnabled) return;
        applyTextAutoFormat();
        // Плюс превращаем в формулы всё, что уже набрано, но не у курсора.
        convertAllTextMathTokens({ skipCaret: true });
    }, 800);
}

function applyTextAutoFormat() {
    if (!autoFormatEnabled) return false;
    if (!_isEditing || !editorDiv) return false;
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return false;

    const range = selection.getRangeAt(0);
    if (!range.collapsed) return false;

    const node = range.startContainer;
    if (node.nodeType !== Node.TEXT_NODE || !editorDiv.contains(node)) return false;
    // Внутри формулы работает свой автоформат.
    if (node.parentElement && node.parentElement.closest && node.parentElement.closest('[data-math]')) return false;

    const caret = range.startOffset;
    const before = node.nodeValue.slice(0, caret);
    // Токен перед курсором; после него может быть пробел (только что набрали).
    const tail = before.match(/([0-9A-Za-zπ()+\-−×÷*\/^_.,|√]+)(\s*)$/);
    if (!tail) return false;

    const token = tail[1];
    const trailingLen = tail[2] ? tail[2].length : 0;
    if (token.length < 2 || !looksLikeTextMath(token)) return false;
    if (/[+\-−×÷*\/^_]$/.test(token)) return false;

    const parsed = parsePlainMath(token);
    if (!parsed || !parsed.items.length) return false;

    const hasStruct = parsed.items.some((it) => it.t !== 'txt');
    const plainText = parsed.items.filter((it) => it.t === 'txt').map((it) => it.v).join('');
    if (!hasStruct && plainText === token) return false;

    const endOffset = caret - trailingLen;
    const startOffset = endOffset - token.length;
    if (startOffset < 0 || endOffset <= startOffset) return false;

    const tokenRange = document.createRange();
    tokenRange.setStart(node, startOffset);
    tokenRange.setEnd(node, endOffset);

    const holder = document.createElement('div');
    holder.innerHTML = formulaInlineHtml(parsed);
    const formulaNode = holder.firstElementChild;
    if (!formulaNode) return false;

    applyLocalFormulaSize(formulaNode, tokenRange, currentEditingLayer);

    tokenRange.deleteContents();
    tokenRange.insertNode(formulaNode);

    // Ставим курсор на то же место, где он был (после пробелов).
    const remainder = formulaNode.nextSibling;
    const after = document.createRange();
    if (remainder && remainder.nodeType === Node.TEXT_NODE) {
        after.setStart(remainder, Math.min(trailingLen, remainder.nodeValue.length));
    } else {
        after.setStartAfter(formulaNode);
    }
    after.collapse(true);
    selection.removeAllRanges();
    selection.addRange(after);
    savedSelectionRange = after.cloneRange();

    updateEditorSizeAndLayer();
    return true;
}

// Проходим по всему тексту и превращаем в формулы все математические токены.
// Нужно, когда человек печатает быстро и уходит из редактора.
function convertAllTextMathTokens({ skipCaret = false } = {}) {
    if (!autoFormatEnabled) return 0;
    if (!_isEditing || !editorDiv) return 0;

    let caretNode = null;
    let caretOffset = -1;
    if (skipCaret) {
        const sel = window.getSelection();
        if (sel && sel.rangeCount && sel.getRangeAt(0).startContainer.nodeType === Node.TEXT_NODE) {
            caretNode = sel.getRangeAt(0).startContainer;
            caretOffset = sel.getRangeAt(0).startOffset;
        }
    }

    const walker = document.createTreeWalker(editorDiv, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
            if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
            if (node.parentElement && node.parentElement.closest && node.parentElement.closest('[data-math]')) {
                return NodeFilter.FILTER_REJECT;
            }
            return NodeFilter.FILTER_ACCEPT;
        },
    });

    const nodes = [];
    let cur;
    while ((cur = walker.nextNode())) nodes.push(cur);

    let converted = 0;
    for (const textNode of nodes) {
        const text = textNode.nodeValue;
        const re = /[0-9A-Za-zπ()+\-−×÷*\/^_.,|√]+/g;
        const found = [];
        let m;
        while ((m = re.exec(text))) {
            const token = m[0];
            if (token.length < 2 || !looksLikeTextMath(token)) continue;
            if (/[+\-−×÷*\/^_]$/.test(token)) continue;
            if (skipCaret && textNode === caretNode) {
                const start = m.index;
                const end = start + token.length;
                if (caretOffset >= start && caretOffset <= end) continue;
            }
            const parsed = parsePlainMath(token);
            if (!parsed || !parsed.items.length) continue;
            const hasStruct = parsed.items.some((it) => it.t !== 'txt');
            const plainText = parsed.items.filter((it) => it.t === 'txt').map((it) => it.v).join('');
            if (!hasStruct && plainText === token) continue;
            found.push({ start: m.index, end: m.index + token.length, parsed });
        }

        for (let k = found.length - 1; k >= 0; k--) {
            if (!textNode.isConnected) break;
            const { start, end, parsed } = found[k];
            if (end > textNode.nodeValue.length) continue;
            const r = document.createRange();
            r.setStart(textNode, start);
            r.setEnd(textNode, end);

            const holder = document.createElement('div');
            holder.innerHTML = formulaInlineHtml(parsed);
            const el = holder.firstElementChild;
            if (!el) continue;
            applyLocalFormulaSize(el, r, currentEditingLayer);
            r.deleteContents();
            r.insertNode(el);
            converted++;
        }
    }

    if (converted) updateEditorSizeAndLayer();
    return converted;
}

export function updateEditorStyle(layer) {
    if (!editorDiv || !layer || !canvasStateRef) return;

    const fontWeight = layer.fontWeight || 'normal';
    const fontStyle = layer.fontStyle || 'normal';

    editorDiv.style.fontSize = `${layer.fontSize}px`;
    editorDiv.style.fontFamily = layer.fontFamily;
    editorDiv.style.fontWeight = fontWeight;
    editorDiv.style.fontStyle = fontStyle;
    editorDiv.style.textAlign = layer.align || 'left';
    editorDiv.style.textDecoration = layer.textDecoration || 'none';
    editorDiv.style.color = layer.color;
    editorDiv.style.lineHeight = '1.2';
    editorDiv.style.padding = `10px`;
    editorDiv.style.boxSizing = 'border-box';
    editorDiv.style.wordWrap = 'break-word';

    updateEditorSizeAndLayer();
}

export function syncEditorWithCanvas(canvasState) {
    if (!editorDiv || !currentEditingLayer || !canvasState) return;
    const layer = currentEditingLayer;
    const { panX, panY, zoom } = canvasState;

    editorDiv.style.left = `${(layer.x * zoom) + panX}px`;
    editorDiv.style.top = `${(layer.y * zoom) + panY}px`;
    
    // Scale editor content using transform rather than multiplying base properties
    editorDiv.style.transformOrigin = 'left top';
    editorDiv.style.transform = `scale(${zoom})`;
    
    editorDiv.style.width = `${layer.width}px`;
    editorDiv.style.minHeight = `50px`;
    editorDiv.style.fontSize = `${layer.fontSize}px`;
    editorDiv.style.fontFamily = layer.fontFamily || 'sans-serif';
    editorDiv.style.fontWeight = layer.fontWeight || 'normal';
    editorDiv.style.fontStyle = layer.fontStyle || 'normal';
    editorDiv.style.textAlign = layer.align || 'left';
    editorDiv.style.color = layer.color || '#000';
    editorDiv.style.lineHeight = '1.2';
    editorDiv.style.padding = `10px`;
    editorDiv.style.boxSizing = 'border-box';
    editorDiv.style.wordWrap = 'break-word';
}

function updateEditorSizeAndLayer() {
    if (!currentEditingLayer || !canvasStateRef) return;

    currentEditingLayer.content = editorDiv.innerHTML;

    const newHeight = editorDiv.scrollHeight;
    if (Math.abs(currentEditingLayer.height - newHeight) > 1) {
        currentEditingLayer.height = newHeight;
    }

    if (canvasStateRef.updateFloatingToolbar) {
        canvasStateRef.updateFloatingToolbar();
    }

    if (onFinishCallback) {
        onFinishCallback(true);
    }
}

export function startEditing(canvasState, layer, onFinish) {
    initializeTextEditor();

    currentEditingLayer = layer;
    originalLayerStateBeforeEdit = cloneLayersForAction([layer]);
    canvasStateRef = canvasState;
    onFinishCallback = onFinish;
    _isEditing = true;
    editStartTime = Date.now();
    savedSelectionRange = null;

    editorDiv.style.display = 'block';
    editorDiv.style.visibility = 'visible';
    editorDiv.style.pointerEvents = 'auto';
    editorDiv.style.zIndex = '999';

    // Форсируем перерисовку, чтобы браузер понял, что элемент теперь видимый (важно для iOS focus)
    void editorDiv.offsetHeight;

    // Ensure the outside-press handler exists (it's nulled after each finishEditing).
    // Registered on capture phase to consume events before they reach the canvas.
    if (!onOutsidePressHandler) {
        onOutsidePressHandler = (e) => {
            if (!_isEditing) return;

            const toolbar = document.getElementById('floating-text-toolbar');
            const mainToolbar = document.getElementById('toolbar');
            const subToolbar = document.getElementById('drawingSubToolbar');
            const fontSheet = document.getElementById('mobile-font-sheet');
            const fontBackdrop = document.getElementById('mobile-font-backdrop');
            const mathModal = document.getElementById('math-modal');

            if (editorDiv && editorDiv.contains(e.target)) return;
            if (toolbar && toolbar.contains(e.target)) return;
            if (mainToolbar && mainToolbar.contains(e.target)) return;
            if (subToolbar && subToolbar.contains(e.target)) return;
            if (fontSheet && fontSheet.contains(e.target)) return;
            if (fontBackdrop && fontBackdrop.contains(e.target)) return;
            if (mathModal && mathModal.contains(e.target)) return;

            // Consume the event so the canvas doesn't start a selectionBox
            // or any other drawing action, then finish editing.
            e.stopPropagation();
            e.preventDefault();
            finishEditing();
        };
    }
    document.addEventListener('pointerdown', onOutsidePressHandler, true);

    editorDiv.innerHTML = layer.content || '';

    updateEditorStyle(layer);
    syncEditorWithCanvas(canvasState);

    // Фокусируемся на редакторе сразу, чтобы браузер признал это действием пользователя
    // preventScroll: true иногда мешает на iOS, так что уберем его
    editorDiv.focus();
    
    // Выделяем содержимое (ставим курсор в конец, если есть текст, или в начало пустого)
    const range = document.createRange();
    const sel = window.getSelection();
    range.selectNodeContents(editorDiv);
    range.collapse(false); // false = курсор в конец
    sel.removeAllRanges();
    sel.addRange(range);
    
    savedSelectionRange = range.cloneRange();
    
    // Предотвращаем потерю фокуса при переключении инструмента через код (например, на инструмент "Выделение")
    editStartTime = Date.now(); 

    // Даём браузеру время обновить activeElement перед вызовом getFormatState/updateFloatingToolbar
    if (canvasStateRef && canvasStateRef.updateFloatingToolbar) {
        requestAnimationFrame(() => {
            if (_isEditing && canvasStateRef.updateFloatingToolbar) {
                canvasStateRef.updateFloatingToolbar();
            }
        });
    }

    // Решаем проблему потери фокуса при создании новой рамки (когда pointerup/click сбрасывают фокус браузера)
    setTimeout(() => {
        if (_isEditing && editorDiv) {
            editorDiv.focus();
            const currentSel = window.getSelection();
            if (currentSel) {
                currentSel.removeAllRanges();
                currentSel.addRange(range);
            }
        }
    }, 50);
}

function extractStylesFromHTML(html) {
    const div = document.createElement('div');
    div.innerHTML = html;
    const spans = Array.from(div.querySelectorAll('span[style]'))
        .filter((span) => !span.hasAttribute('data-math'));
    if (spans.length === 1 && div.innerText.trim() === spans[0].innerText.trim()) {
        const color = spans[0].style.color;
        if (color && color !== 'currentColor') return { color };
    }
    return {};
}

export async function finishEditing() {
    if (!currentEditingLayer || !_isEditing) return;
    // Дожимаем автоформат, чтобы «2x-5», набранное перед уходом, стало формулой.
    try {
        applyTextAutoFormat();
        convertAllTextMathTokens();
    } catch (e) { /* не критично */ }
    _isEditing = false;
    if (canvasStateRef) {
        canvasStateRef.isEditingText = false;

        // Defensive cleanup: if a race condition caused the canvas to enter
        // selectionBox or another action while we were editing, reset it now.
        if (canvasStateRef.currentAction && canvasStateRef.currentAction !== 'none') {
            canvasStateRef.currentAction = 'none';
        }
        if (canvasStateRef.iCtx && canvasStateRef.interactionCanvas) {
            canvasStateRef.iCtx.setTransform(1, 0, 0, 1, 0, 0);
            canvasStateRef.iCtx.clearRect(0, 0, canvasStateRef.interactionCanvas.width, canvasStateRef.interactionCanvas.height);
        }
    }

    updateEditorSizeAndLayer();

    const newStyles = extractStylesFromHTML(currentEditingLayer.content);
    if (newStyles.color) currentEditingLayer.color = newStyles.color;

    const finalLayerState = cloneLayersForAction([currentEditingLayer]);
    let shouldDelete = false;

    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = currentEditingLayer.content;
    const textContent = tempDiv.innerText.replace(/\u200B/g, '').trim();

    if (textContent === '' && !tempDiv.querySelector('img') && !tempDiv.querySelector('[data-math]')) {
        const index = canvasStateRef.layers.findIndex(l => String(l.id) === String(currentEditingLayer.id));
        if (index > -1) {
            canvasStateRef.layers.splice(index, 1);
            shouldDelete = true;
        }
    } else {
        try {
            const img = await createTextImage(currentEditingLayer);
            currentEditingLayer.cachedImage = img;
            if (finalLayerState[0]) finalLayerState[0].cachedImage = img;
        } catch (e) {
            console.error('Failed to render text image on finish', e);
        }
    }

    editorDiv.style.display = 'none';

    if (onFinishCallback) {
        onFinishCallback(false, originalLayerStateBeforeEdit, shouldDelete ? [] : finalLayerState);
    }

    if (onOutsidePressHandler) {
        document.removeEventListener('pointerdown', onOutsidePressHandler, true);
        onOutsidePressHandler = null;
    }

    currentEditingLayer = null;
    originalLayerStateBeforeEdit = null;
    canvasStateRef = null;
    onFinishCallback = null;
    savedSelectionRange = null;
}

// ------------------------------------------------ формулы внутри текста

// Вставка формулы в каретку редактора.
export function insertFormulaIntoEditor(math) {
    if (!editorDiv || !_isEditing) return false;

    const holder = document.createElement('div');
    holder.innerHTML = formulaInlineHtml(math);
    const node = holder.firstElementChild;
    if (!node) return false;

    restoreSelectionAndFocus();
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return false;

    let range = selection.getRangeAt(0);
    if (!editorDiv.contains(range.commonAncestorContainer)) {
        range = document.createRange();
        range.selectNodeContents(editorDiv);
        range.collapse(false);
    }

    // Если рядом текст с собственным кеглем (после форматирования), формула
    // должна быть ровно того же размера, что и он.
    applyLocalFormulaSize(node, range, currentEditingLayer);

    range.deleteContents();
    range.insertNode(node);

    // Каретка сразу после формулы, чтобы можно было продолжать печатать.
    const spacer = document.createTextNode('\u00a0');
    if (node.after) node.after(spacer);

    const newRange = document.createRange();
    newRange.setStartAfter(spacer);
    newRange.collapse(true);
    selection.removeAllRanges();
    selection.addRange(newRange);
    savedSelectionRange = newRange.cloneRange();

    updateEditorSizeAndLayer();
    return true;
}

// Ближайшая к точке клика формула в редакторе (в пределах pad пикселей).
function findMathNearPoint(x, y, pad = 8) {
    if (!editorDiv) return null;
    let best = null;
    editorDiv.querySelectorAll('[data-math]').forEach((el) => {
        const r = el.getBoundingClientRect();
        if (y < r.top - pad || y > r.bottom + pad) return;
        const dl = Math.abs(x - r.left);
        const dr = Math.abs(x - r.right);
        if (dl <= pad && (!best || dl < best.dist)) best = { el, side: 'left', dist: dl };
        if (dr <= pad && (!best || dr < best.dist)) best = { el, side: 'right', dist: dr };
    });
    return best;
}

// Ставит курсор сразу перед формулой или сразу после неё (снаружи).
function placeCaretBesideMath(mathEl, before) {
    if (!mathEl || !editorDiv) return;
    const selection = window.getSelection();
    if (!selection) return;

    let target = before ? mathEl.previousSibling : mathEl.nextSibling;
    let offset = before ? null : 0;

    if (target && target.nodeType === Node.TEXT_NODE) {
        offset = before ? target.nodeValue.length : 0;
    } else {
        // Нет текстового соседа — вставляем невидимый разделитель.
        const spacer = document.createTextNode('\u200b');
        if (before) mathEl.before(spacer);
        else mathEl.after(spacer);
        target = spacer;
        offset = before ? 1 : 0;
    }

    // Сначала фокус (он может сбросить выделение), потом ставим каретку.
    if (editorDiv.focus) {
        try { editorDiv.focus({ preventScroll: true }); } catch (e) { editorDiv.focus(); }
    }

    const range = document.createRange();
    range.setStart(target, offset);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
    savedSelectionRange = range.cloneRange();
}

// Кегль формулы подстраивается под соседний текст: если рядом текст
// с собственным размером, формула становится ровно такой же.
function applyLocalFormulaSize(node, range, layer) {
    if (!node || !range) return;
    const container = range.startContainer;
    const el = container && container.nodeType === 1 ? container : (container ? container.parentElement : null);
    if (!el) return;

    let local = parseFloat(getComputedStyle(el).fontSize);
    if (!Number.isFinite(local)) local = layer ? (layer.fontSize || 30) : 30;
    const base = layer ? (layer.fontSize || 30) : local;

    const root = node.querySelector ? node.querySelector('[data-math-root]') : null;
    if (!root) return;
    if (Math.abs(local - base) > 1) {
        root.style.fontSize = `${Math.round(local * 100) / 100}px`;
    }
}

// Вставка формулы в конец текстового слоя (слой выделен, но не редактируется).
export function appendFormulaToTextLayer(layer, math) {
    if (!layer || layer.type !== 'text') return false;
    const div = document.createElement('div');
    div.innerHTML = layer.content || '';
    // Формулу ставим в последний абзац, а не отдельным блоком после него.
    const last = div.lastElementChild;
    const target = (last && /^(DIV|P|LI|SPAN)$/i.test(last.tagName)) ? last : div;
    target.insertAdjacentHTML('beforeend', ' ' + formulaInlineHtml(math));
    layer.content = div.innerHTML;
    return true;
}

// Единая точка входа: если текст редактируется — в каретку, иначе — в выделенный слой.
export function insertFormula(math, canvasState) {
    if (_isEditing && editorDiv) return insertFormulaIntoEditor(math);

    const layer = (canvasState && canvasState.selectedLayers && canvasState.selectedLayers.length === 1)
        ? canvasState.selectedLayers[0]
        : null;
    if (!layer || layer.type !== 'text') return false;

    const before = cloneLayersForAction([layer]);
    if (!appendFormulaToTextLayer(layer, math)) return false;

    if (canvasState.tileManager) canvasState.tileManager.invalidateLayer(layer, canvasState);
    if (canvasState.saveState) {
        const after = cloneLayersForAction([layer]);
        canvasState.saveState({ type: 'update', before, after });
    }

    // Старую картинку не обнуляем: доска не мигает, пока рисуется новая.
    createTextImage(layer).then((img) => {
        if (!img) return;
        layer.cachedImage = img;
        if (canvasState.tileManager) canvasState.tileManager.invalidateLayer(layer, canvasState);
        if (canvasState.redraw) canvasState.redraw();
    });

    return true;
}

// Правка формулы по двойному клику внутри текста.
function openInlineFormulaEditor(mathEl) {
    if (!mathEl || !editorDiv) return;
    const math = mathFromAttr(mathEl.getAttribute('data-math'));
    if (isMathEmpty(math)) return;
    const stateAtOpen = canvasStateRef;

    openMathEditor({
        title: 'Формула в тексте',
        math,
        hint: 'Измените формулу или постройте по ней график.',
        onSubmit: ({ math: nextMath, graph }) => {
            const size = currentEditingLayer ? (currentEditingLayer.fontSize || 30) : 30;
            const holder = document.createElement('div');
            holder.innerHTML = formulaInlineHtml(nextMath);
            const node = holder.firstElementChild;
            if (node && mathEl.parentNode) {
                mathEl.parentNode.replaceChild(node, mathEl);
                const range = document.createRange();
                range.setStartAfter(node);
                range.collapse(true);
                const sel = window.getSelection();
                sel.removeAllRanges();
                sel.addRange(range);
                savedSelectionRange = range.cloneRange();
            }
            updateEditorSizeAndLayer();

            if (graph && stateAtOpen) {
                const target = mathEl.getBoundingClientRect();
                import('./plotLayer.js?v=1.4.19').then((plot) => {
                    plot.insertPlotNearScreenPoint(stateAtOpen, nextMath, target.left + 20, target.bottom + 20);
                });
            }
        },
    });
}