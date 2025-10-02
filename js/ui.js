// --- START OF FILE js/ui.js ---

import * as geo from './geometry.js';
import * as layerManager from './layerManager.js';

const NUM_TRAIL_NODES = 10;
const EASING_FACTOR = 0.3;

export function updateFloatingToolbar(state) {
    const textToolbar = document.getElementById('floating-text-toolbar');
    const selectionToolbar = document.getElementById('floating-selection-toolbar');
    // --- НАЧАЛО ИЗМЕНЕНИЙ: Получаем новую панель для PDF ---
    const pdfToolbar = document.getElementById('floating-pdf-toolbar');
    // --- КОНЕЦ ИЗМЕНЕНИЙ ---

    textToolbar.classList.remove('visible');
    selectionToolbar.classList.remove('visible');
    // --- НАЧАЛО ИЗМЕНЕНИЙ: Скрываем панель PDF по умолчанию ---
    pdfToolbar.classList.remove('visible');
    // --- КОНЕЦ ИЗМЕНЕНИЙ ---

    const hasSelection = state.selectedLayers.length > 0;
    const isSingleSelection = hasSelection && state.selectedLayers.length === 1;
    // --- НАЧАЛО ИЗМЕНЕНИЙ: Добавляем проверку на тип 'pdf' ---
    const isSingleTextSelection = isSingleSelection && state.selectedLayers[0].type === 'text';
    const isSinglePdfSelection = isSingleSelection && state.selectedLayers[0].type === 'pdf';
    const isGeneralSelection = hasSelection && !isSingleTextSelection && !isSinglePdfSelection;
    // --- КОНЕЦ ИЗМЕНЕНИЙ ---
    
    if (state.isEditingText || isSingleTextSelection) {
        textToolbar.classList.add('visible'); 

        const layer = state.isEditingText 
            ? state.layers.find(l => l.isEditing) 
            : state.selectedLayers[0];

        if (!layer) {
            textToolbar.classList.remove('visible');
            return;
        }

        const box = geo.getBoundingBox(layer);
        if (!box) {
            textToolbar.classList.remove('visible');
            return;
        }
        
        const fontFamilyDisplay = document.getElementById('font-family-display');
        if (fontFamilyDisplay) {
            fontFamilyDisplay.textContent = layer.fontFamily || 'Arial';
        }
        
        document.getElementById('floatingFontSizeInput').value = layer.fontSize || 30;
        const colorButtonCircle = textToolbar.querySelector('[data-action="pick-color"] circle');
        if (colorButtonCircle) {
            colorButtonCircle.style.fill = layer.color || '#000000';
        }
        
        textToolbar.querySelector('[data-action="align-left"]').classList.toggle('active', !layer.align || layer.align === 'left');
        textToolbar.querySelector('[data-action="align-center"]').classList.toggle('active', layer.align === 'center');
        textToolbar.querySelector('[data-action="align-right"]').classList.toggle('active', layer.align === 'right');
        textToolbar.querySelector('[data-action="font-bold"]').classList.toggle('active', layer.fontWeight === 'bold');
        textToolbar.querySelector('[data-action="font-italic"]').classList.toggle('active', layer.fontStyle === 'italic');
        textToolbar.querySelector('[data-action="font-underline"]').classList.toggle('active', layer.textDecoration === 'underline');
        
        const screenX = (box.x * state.zoom) + state.panX;
        const screenY = (box.y * state.zoom) + state.panY;
        const screenHeight = box.height * state.zoom;
        
        textToolbar.style.left = `${screenX}px`;

        const toolbarHeight = textToolbar.offsetHeight;
        const spaceAbove = screenY;
        
        if (spaceAbove > toolbarHeight + 10) {
            textToolbar.style.top = `${screenY - toolbarHeight - 10}px`;
        } else {
            textToolbar.style.top = `${screenY + screenHeight + 10}px`;
        }
    // --- НАЧАЛО ИЗМЕНЕНИЙ: Логика для отображения панели PDF ---
    } else if (isSinglePdfSelection) {
        pdfToolbar.classList.add('visible');
        const layer = state.selectedLayers[0];
        const box = geo.getBoundingBox(layer);
        if (!box) {
            pdfToolbar.classList.remove('visible');
            return;
        }

        // Обновляем индикатор страниц
        const pageIndicator = document.getElementById('pdf-page-indicator');
        pageIndicator.textContent = `${layer.currentPage} / ${layer.numPages}`;

        // Включаем/выключаем кнопки
        pdfToolbar.querySelector('[data-action="prev-page"]').disabled = layer.currentPage <= 1;
        pdfToolbar.querySelector('[data-action="next-page"]').disabled = layer.currentPage >= layer.numPages;

        const screenX = (box.x * state.zoom) + state.panX;
        const screenY = (box.y * state.zoom) + state.panY;
        const screenHeight = box.height * state.zoom;

        pdfToolbar.style.left = `${screenX + (box.width * state.zoom / 2) - (pdfToolbar.offsetWidth / 2)}px`;

        const toolbarHeight = pdfToolbar.offsetHeight;
        const spaceAbove = screenY;
        
        if (spaceAbove > toolbarHeight + 20) {
            pdfToolbar.style.top = `${screenY - toolbarHeight - 10}px`;
        } else {
            pdfToolbar.style.top = `${screenY + screenHeight + 10}px`;
        }
    // --- КОНЕЦ ИЗМЕНЕНИЙ ---
    } else if (isGeneralSelection) {
        selectionToolbar.classList.add('visible');
        const box = geo.getGroupBoundingBox(state.selectedLayers);
        if (!box) {
            selectionToolbar.classList.remove('visible');
            return;
        }

        const screenX = (box.x * state.zoom) + state.panX;
        const screenY = (box.y * state.zoom) + state.panY;
        const screenHeight = box.height * state.zoom;

        selectionToolbar.style.left = `${screenX + (box.width * state.zoom / 2) - (selectionToolbar.offsetWidth / 2)}px`;

        const toolbarHeight = selectionToolbar.offsetHeight;
        const spaceAbove = screenY;
        
        if (spaceAbove > toolbarHeight + 20) {
            selectionToolbar.style.top = `${screenY - toolbarHeight - 10}px`;
        } else {
            selectionToolbar.style.top = `${screenY + screenHeight + 10}px`;
        }
    }
}

export function animateEraserTrail(state) {
    state.eraserAnimationId = requestAnimationFrame(() => animateEraserTrail(state));
    
    const { zoom, panX, panY, eraserTrailNodes, lastEraserPos, iCtx, interactionCanvas } = state;
    
    let target = lastEraserPos;
    for (const node of eraserTrailNodes) {
        node.x += (target.x - node.x) * EASING_FACTOR;
        node.y += (target.y - node.y) * EASING_FACTOR;
        target = node;
    }

    iCtx.clearRect(0, 0, interactionCanvas.width, interactionCanvas.height);
    iCtx.save();
    iCtx.translate(panX, panY);
    iCtx.scale(zoom, zoom);
    iCtx.lineCap = 'round';
    iCtx.lineJoin = 'round';
    
    for (let i = 1; i < eraserTrailNodes.length; i++) {
        const p1 = eraserTrailNodes[i - 1];
        const p2 = eraserTrailNodes[i];
        
        const ratio = i / eraserTrailNodes.length;
        const alpha = 1 - ratio;
        const lineWidth = alpha * 20 / zoom;

        if (lineWidth < 0.1 || alpha <= 0) continue;

        iCtx.lineWidth = lineWidth;
        iCtx.strokeStyle = `rgba(135, 206, 250, ${alpha * 0.75})`;

        iCtx.beginPath();
        iCtx.moveTo(p1.x, p1.y);
        iCtx.lineTo(p2.x, p2.y);
        iCtx.stroke();
    }

    iCtx.restore();
}

export function setupContextMenu(state, callbacks) {
    const { redrawCallback, saveState } = callbacks;
    const contextMenu = document.getElementById('contextMenu');

    function hideContextMenu() {
        contextMenu.classList.remove('visible');
    }

    document.addEventListener('click', (e) => {
        if (!contextMenu.contains(e.target)) {
            hideContextMenu();
        }
    });

    contextMenu.addEventListener('click', (e) => {
        const action = e.target.dataset.action;
        if (!action || state.selectedLayers.length === 0) return;
        
        let newLayers;
        switch (action) {
            case 'bringForward': newLayers = layerManager.bringForward(state.layers, state.selectedLayers); break;
            case 'sendBackward': newLayers = layerManager.sendBackward(state.layers, state.selectedLayers); break;
            case 'bringToFront': newLayers = layerManager.bringToFront(state.layers, state.selectedLayers); break;
            case 'sendToBack': newLayers = layerManager.sendToBack(state.layers, state.selectedLayers); break;
        }

        if (newLayers) {
            state.layers = newLayers;
            saveState(state.layers);
            redrawCallback();
        }
        hideContextMenu();
    });

    return hideContextMenu;
}

export function updateCursor(state, handle) {
    let cursor = '';
    if (handle) {
        switch (handle) {
            case 'pivot': cursor = 'grab'; break;
            case 'rotate': cursor = 'crosshair'; break;
            case 'topLeft': case 'bottomRight': cursor = 'nwse-resize'; break;
            case 'topRight': case 'bottomLeft': cursor = 'nesw-resize'; break;
            case 'top': case 'bottom': cursor = 'ns-resize'; break;
            case 'left': case 'right': cursor = 'ew-resize'; break;
        }
    }
    state.canvas.style.cursor = cursor;
}