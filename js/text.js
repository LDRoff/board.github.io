import { cloneLayersForAction, createTextImage } from './utils.js?v=1.1.8';

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
    let node;
    const liveSelection = window.getSelection();
    if (document.activeElement === editorDiv && liveSelection && liveSelection.rangeCount > 0) {
        node = liveSelection.anchorNode;
    } else {
        node = savedSelectionRange.commonAncestorContainer;
    }
    if (node && node.nodeType === 3) node = node.parentNode;

    const state = {
        bold: false, italic: false, underline: false, strikeThrough: false,
        superscript: false, subscript: false,
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
    
    const walk = document.createTreeWalker(tempDiv, NodeFilter.SHOW_TEXT, null, false);
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

    editorDiv.addEventListener('input', updateEditorSizeAndLayer);
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

            if (editorDiv && editorDiv.contains(e.target)) return;
            if (toolbar && toolbar.contains(e.target)) return;
            if (mainToolbar && mainToolbar.contains(e.target)) return;
            if (subToolbar && subToolbar.contains(e.target)) return;

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
    const spans = div.querySelectorAll('span[style]');
    if (spans.length === 1 && div.innerText.trim() === spans[0].innerText.trim()) {
        if (spans[0].style.color) return { color: spans[0].style.color };
    }
    return {};
}

export async function finishEditing() {
    if (!currentEditingLayer || !_isEditing) return;
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

    if (textContent === '' && !tempDiv.querySelector('img')) {
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