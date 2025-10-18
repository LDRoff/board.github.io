// --- START OF FILE js/ui.js ---

import * as geo from './geometry.js';
import * as layerManager from './layerManager.js';
import { getSelectionRotation } from './hitTest.js';

const NUM_TRAIL_NODES = 10;
const EASING_FACTOR = 0.3;

/**
 * Вспомогательная функция для проверки пересечения двух прямоугольников.
 */
function doRectsIntersect(rect1, rect2) {
    return !(rect2.left > rect1.right || 
             rect2.right < rect1.left || 
             rect2.top > rect1.bottom || 
             rect2.bottom < rect1.top);
}

/**
 * Позиционирует элемент относительно "якоря" (anchorRect),
 * гарантируя, что элемент останется в пределах видимой области и не будет перекрывать avoidRect.
 * @param {HTMLElement} element - Элемент для позиционирования.
 * @param {DOMRect} anchorRect - Прямоугольник якоря (от getBoundingClientRect).
 * @param {DOMRect} [avoidRect=null] - Опциональный прямоугольник, которого нужно избегать.
 */
function positionElement(element, anchorRect, avoidRect = null) {
    const { innerWidth: vpWidth, innerHeight: vpHeight } = window;
    const { offsetWidth: elWidth, offsetHeight: elHeight } = element;
    const margin = 10;

    // Горизонтальное позиционирование: центрируем относительно якоря
    let left = anchorRect.left + (anchorRect.width / 2) - (elWidth / 2);

    // Коррекция, если выходит за края
    if (left < margin) left = margin;
    if (left + elWidth > vpWidth - margin) left = vpWidth - elWidth - margin;

    // Вертикальное позиционирование:
    const spaceAbove = anchorRect.top;
    const spaceBelow = vpHeight - anchorRect.bottom;
    let top;

    const preferredTop = anchorRect.top - elHeight - margin;
    const alternativeTop = anchorRect.bottom + margin;

    let topPositionIsOccupied = false;
    if (avoidRect) {
        const proposedRect = { left, top: preferredTop, right: left + elWidth, bottom: preferredTop + elHeight };
        if (doRectsIntersect(proposedRect, avoidRect)) {
            topPositionIsOccupied = true;
        }
    }

    // Предпочитаем место сверху, если оно свободно и его достаточно
    if (!topPositionIsOccupied && spaceAbove > elHeight + margin) {
        top = preferredTop;
    } 
    // Иначе пробуем снизу, если там есть место
    else if (spaceBelow > elHeight + margin) {
        top = alternativeTop;
    } 
    // Если не помещается нигде, прижимаем к нижнему краю, если он лучше верхнего
    else if (spaceBelow > spaceAbove) {
        top = vpHeight - elHeight - margin;
    }
    // В крайнем случае используем верх
    else {
        top = preferredTop;
    }
    
    // Финальная проверка, чтобы не уйти за верхний край
    if (top < margin) top = margin;

    element.style.left = `${left}px`;
    element.style.top = `${top}px`;
}


export function updateFloatingToolbar(state) {
    const textToolbar = document.getElementById('floating-text-toolbar');
    const selectionToolbar = document.getElementById('floating-selection-toolbar');
    const pdfToolbar = document.getElementById('floating-pdf-toolbar');
    const curveToolbar = document.getElementById('floating-curve-toolbar');

    textToolbar.classList.remove('visible');
    selectionToolbar.classList.remove('visible');
    pdfToolbar.classList.remove('visible');
    curveToolbar.classList.remove('visible');

    const hasSelection = state.selectedLayers.length > 0;
    const isSingleSelection = hasSelection && state.selectedLayers.length === 1;
    const isSingleTextSelection = isSingleSelection && state.selectedLayers[0].type === 'text';
    const isSinglePdfSelection = isSingleSelection && state.selectedLayers[0].type === 'pdf';
    const isSingleCurveSelection = isSingleSelection && state.selectedLayers[0].type === 'curve';
    const isGeneralSelection = hasSelection && !isSingleTextSelection && !isSinglePdfSelection && !isSingleCurveSelection;
    
    let rotationHandleRect = null;
    if (hasSelection) {
        const box = geo.getGroupLogicalBoundingBox(state.selectedLayers);
        if (box) {
            const rotation = getSelectionRotation(state.selectedLayers, state.groupRotation);
            const zoom = state.zoom;
            
            const centerX = box.x + box.width / 2;
            const centerY = box.y + box.height / 2;
            
            let pivotX = centerX;
            let pivotY = centerY;

            if (isSingleSelection && state.selectedLayers[0] && state.selectedLayers[0].pivot) {
                pivotX = centerX + state.selectedLayers[0].pivot.x;
                pivotY = centerY + state.selectedLayers[0].pivot.y;
            }

            const pivotPoint = { x: pivotX, y: pivotY };

            // Координаты маркера в локальной системе координат объекта (до поворота)
            const handleLocalPos = { 
                x: box.x + box.width, 
                y: box.y + box.height + 25 / zoom 
            }; 
            
            // Поворачиваем маркер вместе с объектом
            const handleWorldPos = geo.rotatePoint(handleLocalPos, pivotPoint, rotation);

            // Преобразуем мировые координаты в экранные
            const handleScreenX = (handleWorldPos.x * zoom) + state.panX;
            const handleScreenY = (handleWorldPos.y * zoom) + state.panY;
            const handleScreenSize = 24; // Размер области, которую нужно избегать

            rotationHandleRect = {
                left: handleScreenX - handleScreenSize / 2,
                top: handleScreenY - handleScreenSize / 2,
                right: handleScreenX + handleScreenSize / 2,
                bottom: handleScreenY + handleScreenSize / 2,
                width: handleScreenSize,
                height: handleScreenSize
            };
        }
    }
    
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
        
        const screenRect = {
            left: (box.x * state.zoom) + state.panX,
            top: (box.y * state.zoom) + state.panY,
            width: box.width * state.zoom,
            height: box.height * state.zoom,
            right: ((box.x + box.width) * state.zoom) + state.panX,
            bottom: ((box.y + box.height) * state.zoom) + state.panY,
        };

        positionElement(textToolbar, screenRect, rotationHandleRect);

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

        const screenRect = {
            left: (box.x * state.zoom) + state.panX,
            top: (box.y * state.zoom) + state.panY,
            width: box.width * state.zoom,
            height: box.height * state.zoom,
            right: ((box.x + box.width) * state.zoom) + state.panX,
            bottom: ((box.y + box.height) * state.zoom) + state.panY,
        };

        positionElement(pdfToolbar, screenRect, rotationHandleRect);

    } else if (isSingleCurveSelection) {
        curveToolbar.classList.add('visible');
        const deleteNodeBtn = curveToolbar.querySelector('[data-action="delete-curve-node"]');
        deleteNodeBtn.disabled = state.selectedCurveNodeIndex === null;

        const box = geo.getGroupBoundingBox(state.selectedLayers);
        if (!box) {
            curveToolbar.classList.remove('visible');
            return;
        }

        const screenRect = {
            left: (box.x * state.zoom) + state.panX,
            top: (box.y * state.zoom) + state.panY,
            width: box.width * state.zoom,
            height: box.height * state.zoom,
            right: ((box.x + box.width) * state.zoom) + state.panX,
            bottom: ((box.y + box.height) * state.zoom) + state.panY,
        };

        positionElement(curveToolbar, screenRect, rotationHandleRect);
        
    } else if (isGeneralSelection) {
        selectionToolbar.classList.add('visible');
        const box = geo.getGroupBoundingBox(state.selectedLayers);
        if (!box) {
            selectionToolbar.classList.remove('visible');
            return;
        }

        const screenRect = {
            left: (box.x * state.zoom) + state.panX,
            top: (box.y * state.zoom) + state.panY,
            width: box.width * state.zoom,
            height: box.height * state.zoom,
            right: ((box.x + box.width) * state.zoom) + state.panX,
            bottom: ((box.y + box.height) * state.zoom) + state.panY,
        };
        
        positionElement(selectionToolbar, screenRect, rotationHandleRect);
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

export function updateCursor(state, handle, rotation = 0) {
    // Сначала обрабатываем особые случаи (маркеры, не связанные с масштабированием)
    if (typeof handle === 'object' && handle !== null) {
        let cursor = '';
        // --- НАЧАЛО ИЗМЕНЕНИЙ: Меняем курсор для основного узла ---
        if (handle.type === 'curveNode') {
            cursor = 'crosshair';
        } else if (handle.type === 'curveHandle') {
            cursor = 'crosshair';
        }
        // --- КОНЕЦ ИЗМЕНЕНИЙ ---
        state.canvas.style.cursor = cursor;
        return;
    }

    if (handle === 'pivot') {
        const pivotCursor = `url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><g fill="none" stroke="white" stroke-width="3.5" stroke-linecap="round"><circle cx="12" cy="12" r="2.5"/><path d="M12 2 L12 7 M12 22 L12 17 M2 12 L7 12 M22 12 L17 12"/></g><g fill="none" stroke="black" stroke-width="1.5" stroke-linecap="round"><circle cx="12" cy="12" r="2.5"/><path d="M12 2 L12 7 M12 22 L12 17 M2 12 L7 12 M22 12 L17 12"/></g></svg>') 12 12, auto`;
        state.canvas.style.cursor = pivotCursor;
        return;
    }
    
    if (handle === 'rotate') {
        // SVG-иконка курсора для вращения. Состоит из двух слоев (белый контур, черная стрелка) для видимости на любом фоне.
        const rotateCursor = `url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path d="M12 4 A8 8 0 1 1 5.636 5.636" fill="none" stroke="white" stroke-width="4" stroke-linecap="round"/><path d="M12 4 L8 1 M12 4 L15 7" fill="none" stroke="white" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path d="M12 4 A8 8 0 1 1 5.636 5.636" fill="none" stroke="black" stroke-width="2" stroke-linecap="round"/><path d="M12 4 L8 1 M12 4 L15 7" fill="none" stroke="black" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>') 12 12, auto`;
        state.canvas.style.cursor = rotateCursor;
        return;
    }

    // Это маркер масштабирования, вычисляем повернутый курсор
    const cursors = ['ns-resize', 'nesw-resize', 'ew-resize', 'nwse-resize', 'ns-resize', 'nesw-resize', 'ew-resize', 'nwse-resize'];
    const baseIndexMap = {
        top: 0, topRight: 1, right: 2, bottomRight: 3,
        bottom: 4, bottomLeft: 5, left: 6, topLeft: 7
    };

    const baseIndex = baseIndexMap[handle];
    if (baseIndex === undefined) {
        state.canvas.style.cursor = ''; // Запасной вариант
        return;
    }
    
    const rotationDegrees = rotation * (180 / Math.PI);
    const rotationIndex = Math.round(rotationDegrees / 45);
    
    // +8 для корректной обработки отрицательного остатка от деления
    const finalIndex = (baseIndex + rotationIndex + 8) % 8; 
    state.canvas.style.cursor = cursors[finalIndex];
}

const creationTooltip = document.getElementById('mobile-creation-tooltip');

export function showCreationTooltip(message, position, canvasState) {
    if (!creationTooltip || !position || !canvasState) return;

    const { panX, panY, zoom } = canvasState;
    const screenX = (position.x * zoom) + panX;
    const screenY = (position.y * zoom) + panY;

    creationTooltip.textContent = message;
    creationTooltip.style.left = `${screenX}px`;
    creationTooltip.style.top = `${screenY}px`;
    creationTooltip.classList.add('visible');
}

export function hideCreationTooltip() {
    if (!creationTooltip) return;
    creationTooltip.classList.remove('visible');
}
// --- END OF FILE js/ui.js ---