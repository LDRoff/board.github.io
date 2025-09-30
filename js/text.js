// --- START OF FILE js/text.js ---

let editorTextarea = null;
let currentEditingLayer = null;
let canvasStateRef = null;
let onFinishCallback = null;

// --- НАЧАЛО ИЗМЕНЕНИЙ: Новая функция для доступа к полю ввода из других файлов ---
export function getEditorTextarea() {
    return editorTextarea;
}
// --- КОНЕЦ ИЗМЕНЕНИЙ ---

function initializeTextEditor() {
    if (editorTextarea) return;

    editorTextarea = document.createElement('textarea');
    editorTextarea.id = 'text-editor-textarea';
    editorTextarea.wrap = 'soft'; 

    document.body.appendChild(editorTextarea);

    // --- НАЧАЛО ИЗМЕНЕНИЙ: Исправлена логика закрытия редактора ---
    // Используем 'focusout', чтобы определить, куда переместился фокус
    editorTextarea.addEventListener('focusout', (e) => {
        const toolbar = document.getElementById('floating-text-toolbar');
        // e.relatedTarget — это элемент, который ПОЛУЧАЕТ фокус.
        // Если этот элемент находится внутри нашей плавающей панели, значит,
        // пользователь хочет изменить настройки, а не закончить редактирование.
        if (e.relatedTarget && toolbar.contains(e.relatedTarget)) {
            // В этом случае просто ничего не делаем и оставляем редактор активным.
            return;
        }
        // Если же фокус ушел в любое другое место, завершаем редактирование.
        finishEditing();
    });
    // --- КОНЕЦ ИЗМЕНЕНИЙ ---
    
    editorTextarea.addEventListener('input', updateEditorSizeAndLayer);
    editorTextarea.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' || (e.key === 'Enter' && (e.shiftKey || e.ctrlKey || e.metaKey))) {
            e.preventDefault();
            finishEditing();
        }
    });
}

function wrapText(ctx, text, maxWidth) {
    const manualLines = text.split('\n');
    let allLines = [];

    manualLines.forEach(manualLine => {
        if (manualLine === '') {
            allLines.push('');
            return;
        }
        const words = manualLine.split(' ');
        let currentLine = '';
        for (const word of words) {
            const testLine = currentLine === '' ? word : `${currentLine} ${word}`;
            const metrics = ctx.measureText(testLine);

            if (metrics.width > maxWidth && currentLine !== '') {
                allLines.push(currentLine);
                currentLine = word;
            } else {
                currentLine = testLine;
            }
        }
        allLines.push(currentLine);
    });

    return allLines;
}

/**
 * Обновляет CSS-стили текстового редактора в соответствии со свойствами слоя.
 * @param {object} layer - Слой текста, чьи свойства нужно применить.
 */
export function updateEditorStyle(layer) {
    if (!editorTextarea || !layer || !canvasStateRef) return;
    
    const { zoom } = canvasStateRef;
    const fontWeight = layer.fontWeight || 'normal';
    const fontStyle = layer.fontStyle || 'normal';

    editorTextarea.style.fontSize = `${layer.fontSize * zoom}px`;
    editorTextarea.style.fontFamily = layer.fontFamily;
    editorTextarea.style.fontWeight = fontWeight;
    editorTextarea.style.fontStyle = fontStyle;
    editorTextarea.style.textAlign = layer.align || 'left';
    editorTextarea.style.textDecoration = layer.textDecoration || 'none';
    editorTextarea.style.color = layer.color;
    editorTextarea.style.lineHeight = `${layer.fontSize * 1.2 * zoom}px`;

    updateEditorSizeAndLayer();
}

function updateEditorSizeAndLayer() {
    if (!currentEditingLayer || !canvasStateRef) return;
    
    currentEditingLayer.content = editorTextarea.value;

    const { ctx, zoom } = canvasStateRef;
    const fontWeight = currentEditingLayer.fontWeight || 'normal';
    const fontStyle = currentEditingLayer.fontStyle || 'normal';
    ctx.font = `${fontStyle} ${fontWeight} ${currentEditingLayer.fontSize}px ${currentEditingLayer.fontFamily}`;
    
    const lines = wrapText(ctx, currentEditingLayer.content, currentEditingLayer.width);
    const newHeight = lines.length * (currentEditingLayer.fontSize * 1.2);
    currentEditingLayer.height = newHeight > 0 ? newHeight : (currentEditingLayer.fontSize * 1.2);
    
    editorTextarea.style.height = `${currentEditingLayer.height * zoom}px`;
    
    if(onFinishCallback) {
        onFinishCallback(true); 
    }
}

export function startEditing(canvasState, layer, onFinish) {
    initializeTextEditor();

    currentEditingLayer = layer;
    canvasStateRef = canvasState;
    onFinishCallback = onFinish;

    const { panX, panY, zoom } = canvasState;
    
    editorTextarea.style.width = `${layer.width * zoom}px`;
    
    editorTextarea.style.position = 'fixed';
    editorTextarea.style.zIndex = '1000';
    editorTextarea.style.display = 'block';
    editorTextarea.style.border = `1px dashed #007AFF`;
    editorTextarea.style.left = `${(layer.x * zoom) + panX}px`;
    editorTextarea.style.top = `${(layer.y * zoom) + panY}px`;
    
    editorTextarea.value = layer.content;

    updateEditorStyle(layer);

    setTimeout(() => {
        editorTextarea.focus();
        if (layer.content === '') {
            editorTextarea.select();
        }
    }, 0);
}

function finishEditing() {
    if (!currentEditingLayer) return;
    
    updateEditorSizeAndLayer();

    if (currentEditingLayer.content.trim() === '') {
        const index = canvasStateRef.layers.findIndex(l => l.id === currentEditingLayer.id);
        if (index > -1) {
            canvasStateRef.layers.splice(index, 1);
        }
    }
    
    editorTextarea.style.display = 'none';
    currentEditingLayer = null;

    if (onFinishCallback) {
        onFinishCallback(false);
    }
}
// --- END OF FILE js/text.js ---