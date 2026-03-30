// --- START OF FILE js/text.js ---

import { cloneLayersForAction, createTextImage } from './utils.js';

let editorDiv = null;
let currentEditingLayer = null;
let originalLayerStateBeforeEdit = null;
let canvasStateRef = null;
let onFinishCallback = null;

export function getEditorTextarea() {
    return editorDiv;
}

export function getFormatState() {
    if (!editorDiv || document.activeElement !== editorDiv) return null;

    return {
        bold: document.queryCommandState('bold'),
        italic: document.queryCommandState('italic'),
        underline: document.queryCommandState('underline'),
        alignLeft: document.queryCommandState('justifyLeft'),
        alignCenter: document.queryCommandState('justifyCenter'),
        alignRight: document.queryCommandState('justifyRight'),
        fontName: document.queryCommandValue('fontName')?.replace(/['"]/g, ''),
        fontSize: document.queryCommandValue('fontSize'),
        foreColor: document.queryCommandValue('foreColor')
    };
}

export function applyRichTextFormatting(command, value = null) {
    if (!editorDiv) return;
    editorDiv.focus();
    document.execCommand(command, false, value);
    updateEditorSizeAndLayer();
}

export function toggleTextCase() {
    if (!editorDiv) return;
    editorDiv.focus();
    
    const selection = window.getSelection();
    if (!selection.rangeCount) return;
    
    const text = selection.toString();
    if (!text) return;

    const newText = (text === text.toUpperCase()) ? text.toLowerCase() : text.toUpperCase();
    document.execCommand('insertText', false, newText);
    updateEditorSizeAndLayer();
}

function initializeTextEditor() {
    if (editorDiv) return;

    editorDiv = document.createElement('div');
    editorDiv.id = 'text-editor-div';
    editorDiv.contentEditable = "true";
    editorDiv.spellcheck = false;

    document.body.appendChild(editorDiv);

    // --- ВАЖНО: Включаем CSS режим ---
    // Это заставляет браузер генерировать <span style="color: red; text-decoration: underline">
    // вместо <u><font color="red">. Это чинит проблему цвета подчеркивания.
    try {
        document.execCommand('styleWithCSS', false, true);
    } catch (e) {
        console.warn('styleWithCSS not supported', e);
    }
    // --------------------------------

    editorDiv.addEventListener('focusout', (e) => {
        const toolbar = document.getElementById('floating-text-toolbar');
        if (e.relatedTarget && toolbar.contains(e.relatedTarget)) {
            return;
        }
        finishEditing();
    });
    
    editorDiv.addEventListener('input', updateEditorSizeAndLayer);
    
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
}

export function updateEditorStyle(layer) {
    if (!editorDiv || !layer || !canvasStateRef) return;
    
    const { zoom } = canvasStateRef;
    const fontWeight = layer.fontWeight || 'normal';
    const fontStyle = layer.fontStyle || 'normal';

    editorDiv.style.fontSize = `${layer.fontSize * zoom}px`;
    editorDiv.style.fontFamily = layer.fontFamily;
    editorDiv.style.fontWeight = fontWeight;
    editorDiv.style.fontStyle = fontStyle;
    editorDiv.style.textAlign = layer.align || 'left';
    editorDiv.style.textDecoration = layer.textDecoration || 'none';
    editorDiv.style.color = layer.color;
    editorDiv.style.lineHeight = "1.2";
    editorDiv.style.padding = `${10 * zoom}px`;
    editorDiv.style.boxSizing = 'border-box';
    editorDiv.style.wordWrap = 'break-word';

    updateEditorSizeAndLayer();
}

export function updateEditorTransform(layer, canvasState) {
    if (!editorDiv || !layer || !canvasState) return;
    const { panX, panY, zoom } = canvasState;
    
    editorDiv.style.left = `${(layer.x * zoom) + panX}px`;
    editorDiv.style.top = `${(layer.y * zoom) + panY}px`;
    editorDiv.style.width = `${layer.width * zoom}px`;
    editorDiv.style.minHeight = `${50 * zoom}px`;
}

function updateEditorSizeAndLayer() {
    if (!currentEditingLayer || !canvasStateRef) return;
    
    currentEditingLayer.content = editorDiv.innerHTML;
    const zoom = canvasStateRef.zoom;
    
    // Обновляем высоту по реальному контенту
    const newHeight = editorDiv.scrollHeight / zoom;
    if (Math.abs(currentEditingLayer.height - newHeight) > 1) {
        currentEditingLayer.height = newHeight;
    }
    
    if (canvasStateRef.updateFloatingToolbar) {
        canvasStateRef.updateFloatingToolbar();
    }

    if(onFinishCallback) {
        onFinishCallback(true); 
    }
}

export function startEditing(canvasState, layer, onFinish) {
    initializeTextEditor();

    currentEditingLayer = layer;
    originalLayerStateBeforeEdit = cloneLayersForAction([layer]);
    canvasStateRef = canvasState;
    onFinishCallback = onFinish;
    
    editorDiv.style.display = 'block';
    editorDiv.style.visibility = 'visible'; 
    editorDiv.style.pointerEvents = 'auto';
    
    editorDiv.innerHTML = layer.content;
    if (!layer.content) {
        editorDiv.innerHTML = ''; 
    }

    updateEditorStyle(layer);
    updateEditorTransform(layer, canvasState);

    setTimeout(() => {
        editorDiv.focus();
        if (editorDiv.lastChild) {
            const range = document.createRange();
            const sel = window.getSelection();
            range.selectNodeContents(editorDiv);
            range.collapse(false);
            sel.removeAllRanges();
            sel.addRange(range);
        }
        if (canvasStateRef.updateFloatingToolbar) canvasStateRef.updateFloatingToolbar();
    }, 0);
}

// Пытаемся вытащить цвет из HTML для фоллбэка
function extractStylesFromHTML(html) {
    const div = document.createElement('div');
    div.innerHTML = html;
    
    const spans = div.querySelectorAll('span[style]');
    if (spans.length === 1 && div.innerText.trim() === spans[0].innerText.trim()) {
        if (spans[0].style.color) return { color: spans[0].style.color };
    }
    return {};
}

async function finishEditing() {
    if (!currentEditingLayer) return;
    
    updateEditorSizeAndLayer();

    // Синхронизируем базовый цвет слоя, если весь текст перекрашен
    const newStyles = extractStylesFromHTML(currentEditingLayer.content);
    if (newStyles.color) currentEditingLayer.color = newStyles.color;

    const finalLayerState = cloneLayersForAction([currentEditingLayer]);
    let shouldDelete = false;

    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = currentEditingLayer.content;
    if (tempDiv.innerText.trim() === '' && !tempDiv.querySelector('img')) {
         const index = canvasStateRef.layers.findIndex(l => l.id === currentEditingLayer.id);
        if (index > -1) {
            canvasStateRef.layers.splice(index, 1);
        }
        shouldDelete = true;
    } else {
        try {
            // Ждем генерацию картинки перед скрытием редактора, 
            // чтобы избежать моргания/исчезновения текста
            const img = await createTextImage(currentEditingLayer);
            currentEditingLayer.cachedImage = img;
            
            // Обновляем стейт для истории
            if (finalLayerState[0]) {
                 finalLayerState[0].cachedImage = img;
            }
        } catch (e) {
            console.error("Failed to render text image on finish", e);
        }
    }
    
    // Скрываем редактор ТОЛЬКО после генерации картинки
    editorDiv.style.display = 'none';
    
    if (onFinishCallback) {
        if (shouldDelete) {
            onFinishCallback(false, originalLayerStateBeforeEdit, []);
        } else {
            onFinishCallback(false, originalLayerStateBeforeEdit, finalLayerState);
        }
    }
    currentEditingLayer = null;
    originalLayerStateBeforeEdit = null;
    canvasStateRef = null;
    onFinishCallback = null;
}
// --- END OF FILE js/text.js ---