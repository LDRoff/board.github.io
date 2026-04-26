import { cloneLayersForAction, createTextImage } from './utils.js';

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

    // Get the node at the cursor to read computed styles from.
    // Use the live selection if the editor is currently focused, otherwise fall back to saved range.
    let node;
    const liveSelection = window.getSelection();
    if (document.activeElement === editorDiv && liveSelection && liveSelection.rangeCount > 0) {
        node = liveSelection.anchorNode;
    } else {
        node = savedSelectionRange.commonAncestorContainer;
    }
    if (node && node.nodeType === 3) node = node.parentNode;

    // For queryCommandState we need the editor to be focused with the active selection.
    const previousActive = document.activeElement;
    let bold = false, italic = false, underline = false, strikeThrough = false;
    let superscript = false, subscript = false;
    let alignLeft = false, alignCenter = false, alignRight = false;

    if (editorDiv.isConnected) {
        if (previousActive === editorDiv) {
            // Editor already has focus — read state directly from current selection
            // DO NOT touch sel or savedSelectionRange here (would break cursor position while typing)
            bold = document.queryCommandState('bold');
            italic = document.queryCommandState('italic');
            underline = document.queryCommandState('underline');
            strikeThrough = document.queryCommandState('strikeThrough');
            superscript = document.queryCommandState('superscript');
            subscript = document.queryCommandState('subscript');
            alignLeft = document.queryCommandState('justifyLeft');
            alignCenter = document.queryCommandState('justifyCenter');
            alignRight = document.queryCommandState('justifyRight');
        } else {
            // Another element has focus (e.g. font-size input) — temporarily restore
            // editor focus to query state, then give focus back.
            _isQueryingFormatState = true;
            editorDiv.focus();
            const sel = window.getSelection();
            sel.removeAllRanges();
            try { sel.addRange(savedSelectionRange.cloneRange()); } catch (e) {}

            bold = document.queryCommandState('bold');
            italic = document.queryCommandState('italic');
            underline = document.queryCommandState('underline');
            strikeThrough = document.queryCommandState('strikeThrough');
            superscript = document.queryCommandState('superscript');
            subscript = document.queryCommandState('subscript');
            alignLeft = document.queryCommandState('justifyLeft');
            alignCenter = document.queryCommandState('justifyCenter');
            alignRight = document.queryCommandState('justifyRight');

            // Возвращаем фокус только если previousActive это реальный элемент (не body/html)
            // Это предотвращает потерю фокуса editorDiv когда он только что появился
            if (previousActive && previousActive.focus && previousActive !== document.body && previousActive !== document.documentElement) {
                previousActive.focus({ preventScroll: true });
            }
            _isQueryingFormatState = false;
        }
    }

    const state = {
        bold, italic, underline, strikeThrough, superscript, subscript,
        alignLeft, alignCenter, alignRight,
        fontName: null, fontSize: null, foreColor: null, backColor: null
    };

    // fontSize is a global layer property, read directly from the layer
    if (currentEditingLayer) {
        state.fontSize = currentEditingLayer.fontSize;
    }

    if (node && editorDiv.contains(node)) {
        const computedStyle = window.getComputedStyle(node);
        if (computedStyle) {
            state.fontName = computedStyle.fontFamily.replace(/['"]/g, '').split(',')[0].trim();
            state.foreColor = computedStyle.color;
            state.backColor = computedStyle.backgroundColor;
            if (computedStyle.fontWeight === '700' || computedStyle.fontWeight === 'bold') state.bold = true;
            if (computedStyle.fontStyle === 'italic') state.italic = true;
            if (computedStyle.textDecorationLine.includes('underline')) state.underline = true;
            if (computedStyle.textDecorationLine.includes('line-through')) state.strikeThrough = true;
            if (computedStyle.verticalAlign === 'super') state.superscript = true;
            if (computedStyle.verticalAlign === 'sub') state.subscript = true;
        }
    }

    return state;
}

export function applyRichTextFormatting(command, value = null) {
    if (!editorDiv) return;
    restoreSelectionAndFocus();
    
    const selection = window.getSelection();
    let wasCollapsed = false;
    if (selection && selection.isCollapsed) {
        wasCollapsed = true;
        document.execCommand('selectAll', false, null);
    }
    
    document.execCommand(command, false, value);
    
    if (wasCollapsed && selection) {
        selection.collapseToEnd();
    }
    
    updateEditorSizeAndLayer();
}

/**
 * Global property setters for the whole text layer.
 * These are more stable than execCommand for color/font/align.
 */
export function setFontSize(size) {
    if (!currentEditingLayer) return;
    currentEditingLayer.fontSize = size;
    updateEditorStyle(currentEditingLayer);
    applyRichTextProperty('fontSize', size);
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

export function applyRichTextProperty(property, value) {
    if (!editorDiv) return;
    restoreSelectionAndFocus();

    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;

    let actualValue = value;
    if (property === 'fontSize' && canvasStateRef) {
        // Remove zoom multiplier because editorDiv will be scaled using CSS transform
        actualValue = `${value}px`;
    }

    let wasCollapsed = false;
    if (selection.isCollapsed) {
        wasCollapsed = true;
        document.execCommand('selectAll', false, null);
    }

    // Use fontName trick to mark selected nodes, then restyle them.
    const marker = 'TEMP_M_' + Math.random().toString(36).substr(2, 9);
    document.execCommand('fontName', false, marker);

        const elements = Array.from(editorDiv.querySelectorAll('*'));
        let firstModifiedNode = null;
        let lastModifiedNode = null;

        elements.forEach(el => {
            const faceMatch = el.getAttribute && el.getAttribute('face') === marker;
            const styleMatch = el.style && el.style.fontFamily && el.style.fontFamily.includes(marker);
            if (!faceMatch && !styleMatch) return;

            let resultingNode = el;
            if (el.tagName.toLowerCase() === 'font') {
                const span = document.createElement('span');
                while (el.firstChild) span.appendChild(el.firstChild);
                if (el.style.cssText) span.style.cssText = el.style.cssText;
                span.style.fontFamily = '';
                span.style[property] = actualValue;
                el.parentNode.replaceChild(span, el);
                resultingNode = span;
            } else {
                el.style.fontFamily = '';
                if (el.getAttribute('style') === '') el.removeAttribute('style');
                el.style[property] = actualValue;
            }

            // Очищаем это же свойство у всех вложенных элементов, 
            // чтобы они не перекрывали новый цвет/шрифт
            const descendants = resultingNode.querySelectorAll('*');
            descendants.forEach(desc => {
                if (desc.style && desc.style[property]) {
                    desc.style[property] = '';
                    if (desc.getAttribute('style') === '') desc.removeAttribute('style');
                }
            });

            if (!firstModifiedNode) firstModifiedNode = resultingNode;
            lastModifiedNode = resultingNode;
        });

        // Restore visual selection over the modified nodes
        if (firstModifiedNode && lastModifiedNode) {
            const newRange = document.createRange();
            newRange.setStartBefore(firstModifiedNode);
            newRange.setEndAfter(lastModifiedNode);
            const sel = window.getSelection();
            sel.removeAllRanges();
            sel.addRange(newRange);
            savedSelectionRange = newRange.cloneRange();
        }

        if (wasCollapsed) {
            const sel = window.getSelection();
            if (sel) sel.collapseToEnd();
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

    document.execCommand('insertHTML', false, transformedHTML);

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

    try { document.execCommand('styleWithCSS', false, true); } catch (e) {}

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
    editorDiv.style.padding = `10px`;
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
        const index = canvasStateRef.layers.findIndex(l => l.id === currentEditingLayer.id);
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