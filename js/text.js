// --- START OF FILE js/text.js ---

let editorTextarea = null;
let currentEditingLayer = null;
let canvasStateRef = null;
let onFinishCallback = null;

export function getEditorTextarea() {
    return editorTextarea;
}

function initializeTextEditor() {
    if (editorTextarea) return;

    editorTextarea = document.createElement('textarea');
    editorTextarea.id = 'text-editor-textarea';
    editorTextarea.wrap = 'soft'; 

    document.body.appendChild(editorTextarea);

    editorTextarea.addEventListener('focusout', (e) => {
        const toolbar = document.getElementById('floating-text-toolbar');
        if (e.relatedTarget && toolbar.contains(e.relatedTarget)) {
            return;
        }
        finishEditing();
    });
    
    editorTextarea.addEventListener('input', updateEditorSizeAndLayer);
    editorTextarea.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' || (e.key === 'Enter' && (e.shiftKey || e.ctrlKey || e.metaKey))) {
            e.preventDefault();
            finishEditing();
        }
    });

    // --- НАЧАЛО ИЗМЕНЕНИЙ: Добавляем прослушиватель для перенаправления кликов на холст ---
    editorTextarea.addEventListener('pointerdown', (e) => {
        // Если идёт редактирование, перенаправляем событие нажатия мыши на холст.
        // Это позволяет холсту обрабатывать трансформации (перемещение, масштабирование) текстового блока,
        // даже если нажатие начинается внутри самого текстового поля.
        if (currentEditingLayer && canvasStateRef && canvasStateRef.canvas) {
            // Диспетчеризация этого события запускает функцию 'startDrawing' в canvas.js,
            // которая содержит логику для инициации действия 'переместить' или 'масштабировать'.
            canvasStateRef.canvas.dispatchEvent(new PointerEvent('pointerdown', e));
        }
    });
    // --- КОНЕЦ ИЗМЕНЕНИЙ ---
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

export function updateEditorTransform(layer, canvasState) {
    if (!editorTextarea || !layer || !canvasState) return;
    const { panX, panY, zoom } = canvasState;
    editorTextarea.style.left = `${(layer.x * zoom) + panX}px`;
    editorTextarea.style.top = `${(layer.y * zoom) + panY}px`;
    editorTextarea.style.width = `${layer.width * zoom}px`;
    editorTextarea.style.height = `${layer.height * zoom}px`;
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
    
    editorTextarea.style.position = 'fixed';
    editorTextarea.style.zIndex = '1000';
    editorTextarea.style.display = 'block';
    editorTextarea.style.border = `none`; 
    editorTextarea.style.pointerEvents = 'auto';
    
    editorTextarea.value = layer.content;

    updateEditorStyle(layer);
    updateEditorTransform(layer, canvasState);

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
    
    if (onFinishCallback) {
        onFinishCallback(false);
    }
    currentEditingLayer = null;
    canvasStateRef = null;
    onFinishCallback = null;
}
// --- END OF FILE js/text.js ---