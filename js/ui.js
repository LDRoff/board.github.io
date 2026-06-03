// --- START OF FILE js/ui.js ---

import * as geo from './geometry.js';
import * as layerManager from './layerManager.js';
import { getSelectionRotation } from './hitTest.js';
import { getEditorTextarea, getFormatState } from './text.js';

// --- НАЧАЛО ИЗМЕНЕНИЙ: Новая логика DOM-курсора ---
let cursorHead = null;
let cursorTail = null;

function initEraserCursorElements() {
    if (cursorHead) return;

    // Стили внедряем программно, чтобы не трогать CSS файлы
    const style = document.createElement('style');
    style.innerHTML = `
        .eraser-cursor-element {
            position: fixed;
            top: 0;
            left: 0;
            border-radius: 50%;
            pointer-events: none;
            z-index: 9999;
            transform: translate3d(-50%, -50%, 0);
            will-change: transform;
            display: none;
        }
        #eraser-head {
            background-color: rgba(255, 255, 255, 0.9);
            border: 2px solid #333;
            box-shadow: 0 0 4px rgba(0,0,0,0.3);
        }
        #eraser-tail {
            background-color: rgba(135, 206, 250, 0.4);
            /* Магия производительности: CSS Transition делает интерполяцию на GPU */
            transition: transform 0.08s cubic-bezier(0.2, 0, 0.4, 1); 
        }
        body.dark-theme #eraser-head {
            border-color: #fff;
            background-color: rgba(50, 50, 50, 0.9);
        }
    `;
    document.head.appendChild(style);

    cursorTail = document.createElement('div');
    cursorTail.id = 'eraser-tail';
    cursorTail.className = 'eraser-cursor-element';
    document.body.appendChild(cursorTail);

    cursorHead = document.createElement('div');
    cursorHead.id = 'eraser-head';
    cursorHead.className = 'eraser-cursor-element';
    document.body.appendChild(cursorHead);
}

export function updateEraserCursor(x, y, zoom, visible, eraserWidth = 40) {
    if (!cursorHead) initEraserCursorElements();

    if (!visible) {
        cursorHead.style.display = 'none';
        cursorTail.style.display = 'none';
        return;
    }

    const size = Math.max(10, eraserWidth * zoom);

    // Обновляем размеры
    const sizePx = `${size}px`;
    if (cursorHead.style.width !== sizePx) {
        cursorHead.style.width = sizePx;
        cursorHead.style.height = sizePx;
        // Хвост чуть больше для эффекта "свечения"
        cursorTail.style.width = `${size * 1.2}px`;
        cursorTail.style.height = `${size * 1.2}px`;
    }

    cursorHead.style.display = 'block';
    cursorTail.style.display = 'block';

    // Используем transform translate3d для аппаратного ускорения
    const transform = `translate3d(${x}px, ${y}px, 0) translate(-50%, -50%)`;

    cursorHead.style.transform = transform;
    cursorTail.style.transform = transform;
}

export function hideEraserCursor() {
    if (cursorHead) {
        cursorHead.style.display = 'none';
        cursorTail.style.display = 'none';
    }
}

// Старая функция animateEraserTrail удалена, так как она вызывала лаги.
// --- КОНЕЦ ИЗМЕНЕНИЙ ---

function doRectsIntersect(rect1, rect2) {
    return !(rect2.left > rect1.right ||
        rect2.right < rect1.left ||
        rect2.top > rect1.bottom ||
        rect2.bottom < rect1.top);
}

function positionElement(element, anchorRect, avoidRect = null) {
    const { innerWidth: vpWidth, innerHeight: vpHeight } = window;
    const { offsetWidth: elWidth, offsetHeight: elHeight } = element;
    const margin = 10;

    let left = anchorRect.left + (anchorRect.width / 2) - (elWidth / 2);
    if (left < margin) left = margin;
    if (left + elWidth > vpWidth - margin) left = vpWidth - elWidth - margin;

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

    let placedBelow = false;

    if (!topPositionIsOccupied && spaceAbove > elHeight + margin) {
        top = preferredTop;
    } else if (spaceBelow > elHeight + margin) {
        top = alternativeTop;
        placedBelow = true;
    } else if (spaceBelow > spaceAbove) {
        top = vpHeight - elHeight - margin;
        placedBelow = true;
    } else {
        top = preferredTop;
    }

    if (top < margin) top = margin;
    if (top + elHeight > vpHeight) top = vpHeight - elHeight - margin;

    element.style.left = `${left}px`;
    element.style.top = `${top}px`;

    // Сохраняем позицию тулбара относительно текста, чтобы выпадающие меню
    // знали, в какую сторону открываться
    element.dataset.toolbarPosition = placedBelow ? 'below' : 'above';
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

    if (state.isEditingText) {
        const editorDiv = getEditorTextarea();
        if (!editorDiv || editorDiv.style.display === 'none') return;

        textToolbar.classList.add('visible');

        const rect = editorDiv.getBoundingClientRect();
        const screenRect = {
            left: rect.left,
            top: rect.top,
            width: rect.width,
            height: rect.height,
            right: rect.right,
            bottom: rect.bottom
        };

        positionElement(textToolbar, screenRect);

        const format = getFormatState();
        if (format) {
            textToolbar.querySelector('[data-action="font-bold"]').classList.toggle('active', format.bold);
            textToolbar.querySelector('[data-action="font-italic"]').classList.toggle('active', format.italic);
            textToolbar.querySelector('[data-action="font-underline"]').classList.toggle('active', format.underline);
            
            const strikeBtn = textToolbar.querySelector('[data-action="font-strike"]');
            if (strikeBtn) strikeBtn.classList.toggle('active', format.strikeThrough);

            const superBtn = textToolbar.querySelector('[data-action="font-superscript"]');
            if (superBtn) superBtn.classList.toggle('active', format.superscript);
            
            const subBtn = textToolbar.querySelector('[data-action="font-subscript"]');
            if (subBtn) subBtn.classList.toggle('active', format.subscript);

            const styleDropdownBtn = textToolbar.querySelector('#style-dropdown-btn');
            if (styleDropdownBtn) {
                styleDropdownBtn.classList.toggle('active', format.bold || format.italic || format.underline || format.strikeThrough);
            }

            const indexDropdownBtn = textToolbar.querySelector('#index-dropdown-btn');
            if (indexDropdownBtn) {
                indexDropdownBtn.classList.toggle('active', format.superscript || format.subscript);
            }

            textToolbar.querySelector('[data-action="align-left"]').classList.toggle('active', format.alignLeft);
            textToolbar.querySelector('[data-action="align-center"]').classList.toggle('active', format.alignCenter);
            textToolbar.querySelector('[data-action="align-right"]').classList.toggle('active', format.alignRight);

            const colorButtonSvg = textToolbar.querySelector('[data-action="pick-color"] circle');
            if (colorButtonSvg && format.foreColor) {
                colorButtonSvg.style.fill = format.foreColor;
            }

            const bgColorButtonSvg = textToolbar.querySelector('[data-action="pick-bg-color"] path:first-child');
            if (bgColorButtonSvg && format.backColor && format.backColor !== 'rgba(0, 0, 0, 0)') {
                bgColorButtonSvg.style.stroke = format.backColor;
            } else if (bgColorButtonSvg) {
                bgColorButtonSvg.style.stroke = 'currentColor';
            }

            const fontSizeInput = document.getElementById('floatingFontSizeInput');
            if (fontSizeInput && format.fontSize) {
                fontSizeInput.value = format.fontSize;
            }

            const fontFamilyDisplay = document.getElementById('font-family-display');
            if (fontFamilyDisplay && format.fontName) {
                const cleanFontName = format.fontName.split(',')[0].replace(/['"]/g, '').trim();
                fontFamilyDisplay.textContent = cleanFontName;
            }
        }
        return;
    }

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
            const handleLocalPos = { x: box.x + box.width, y: box.y + box.height + 25 / zoom };
            const handleWorldPos = geo.rotatePoint(handleLocalPos, pivotPoint, rotation);
            const handleScreenX = (handleWorldPos.x * zoom) + state.panX;
            const handleScreenY = (handleWorldPos.y * zoom) + state.panY;
            const handleScreenSize = 24;

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

    if (isSingleTextSelection) {
        textToolbar.classList.add('visible');
        const layer = state.selectedLayers[0];
        const box = geo.getBoundingBox(layer);
        if (box) {
            const fontFamilyDisplay = document.getElementById('font-family-display');
            if (fontFamilyDisplay) {
                const rawFont = layer.fontFamily || 'Arial';
                const cleanFontName = rawFont.split(',')[0].replace(/['"]/g, '').trim();
                fontFamilyDisplay.textContent = cleanFontName;
            }

            document.getElementById('floatingFontSizeInput').value = layer.fontSize || 30;
            const colorButtonCircle = textToolbar.querySelector('[data-action="pick-color"] circle');
            if (colorButtonCircle) colorButtonCircle.style.fill = layer.color || '#000000';

            textToolbar.querySelector('[data-action="align-left"]').classList.toggle('active', !layer.align || layer.align === 'left');
            textToolbar.querySelector('[data-action="align-center"]').classList.toggle('active', layer.align === 'center');
            textToolbar.querySelector('[data-action="align-right"]').classList.toggle('active', layer.align === 'right');
            textToolbar.querySelector('[data-action="font-bold"]').classList.toggle('active', layer.fontWeight === 'bold');
            textToolbar.querySelector('[data-action="font-italic"]').classList.toggle('active', layer.fontStyle === 'italic');
            textToolbar.querySelector('[data-action="font-underline"]').classList.toggle('active', layer.textDecoration === 'underline');
            
            const strikeBtn = textToolbar.querySelector('[data-action="font-strike"]');
            if (strikeBtn) strikeBtn.classList.toggle('active', layer.textDecoration === 'line-through');

            const isSuper = layer.content && layer.content.includes('<sup');
            const isSub = layer.content && layer.content.includes('<sub');
            
            const superBtn = textToolbar.querySelector('[data-action="font-superscript"]');
            if (superBtn) superBtn.classList.toggle('active', isSuper);
            
            const subBtn = textToolbar.querySelector('[data-action="font-subscript"]');
            if (subBtn) subBtn.classList.toggle('active', isSub);

            const styleDropdownBtn = textToolbar.querySelector('#style-dropdown-btn');
            if (styleDropdownBtn) {
                styleDropdownBtn.classList.toggle('active', layer.fontWeight === 'bold' || layer.fontStyle === 'italic' || layer.textDecoration === 'underline' || layer.textDecoration === 'line-through');
            }

            const indexDropdownBtn = textToolbar.querySelector('#index-dropdown-btn');
            if (indexDropdownBtn) {
                indexDropdownBtn.classList.toggle('active', isSuper || isSub);
            }

            const screenRect = {
                left: (box.x * state.zoom) + state.panX,
                top: (box.y * state.zoom) + state.panY,
                width: box.width * state.zoom,
                height: box.height * state.zoom,
                right: ((box.x + box.width) * state.zoom) + state.panX,
                bottom: ((box.y + box.height) * state.zoom) + state.panY,
            };
            positionElement(textToolbar, screenRect, rotationHandleRect);
        }
    } else if (isSinglePdfSelection) {
        pdfToolbar.classList.add('visible');
        const layer = state.selectedLayers[0];
        const box = geo.getBoundingBox(layer);
        if (box) {
            const pageIndicator = document.getElementById('pdf-page-indicator');
            pageIndicator.textContent = `${layer.currentPage} / ${layer.numPages}`;
            const jumpTotalSpan = document.getElementById('pdf-page-jump-total');
            if (jumpTotalSpan) jumpTotalSpan.textContent = layer.numPages;
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
        }
    } else if (isSingleCurveSelection) {
        curveToolbar.classList.add('visible');
        const deleteNodeBtn = curveToolbar.querySelector('[data-action="delete-curve-node"]');
        deleteNodeBtn.disabled = state.selectedCurveNodeIndex === null;

        const box = geo.getGroupBoundingBox(state.selectedLayers);
        if (box) {
            const screenRect = {
                left: (box.x * state.zoom) + state.panX,
                top: (box.y * state.zoom) + state.panY,
                width: box.width * state.zoom,
                height: box.height * state.zoom,
                right: ((box.x + box.width) * state.zoom) + state.panX,
                bottom: ((box.y + box.height) * state.zoom) + state.panY,
            };
            positionElement(curveToolbar, screenRect, rotationHandleRect);
        }
    } else if (isGeneralSelection) {
        selectionToolbar.classList.add('visible');
        const box = geo.getGroupBoundingBox(state.selectedLayers);
        if (box) {
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

    const selectAnnotationsBtns = document.querySelectorAll('button[data-action="select-annotations"]');
    const isCurrentLayerLocked = state.selectedLayers.length === 1 && state.editingAnnotationsLayerId === state.selectedLayers[0].id;

    if (isCurrentLayerLocked) {
        selectAnnotationsBtns.forEach(btn => btn.classList.add('active'));
    } else {
        selectAnnotationsBtns.forEach(btn => btn.classList.remove('active'));
    }
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
    if (state.activeTool === 'eraser') return;

    if (typeof handle === 'object' && handle !== null) {
        let cursor = '';
        if (handle.type === 'curveNode') {
            cursor = 'crosshair';
        } else if (handle.type === 'curveHandle') {
            cursor = 'crosshair';
        }
        state.canvas.style.cursor = cursor;
        return;
    }

    if (handle === 'pivot') {
        const pivotCursor = `url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><g fill="none" stroke="white" stroke-width="3.5" stroke-linecap="round"><circle cx="12" cy="12" r="2.5"/><path d="M12 2 L12 7 M12 22 L12 17 M2 12 L7 12 M22 12 L17 12"/></g><g fill="none" stroke="black" stroke-width="1.5" stroke-linecap="round"><circle cx="12" cy="12" r="2.5"/><path d="M12 2 L12 7 M12 22 L12 17 M2 12 L7 12 M22 12 L17 12"/></g></svg>') 12 12, auto`;
        state.canvas.style.cursor = pivotCursor;
        return;
    }

    if (handle === 'rotate') {
        const rotateCursor = `url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path d="M12 4 A8 8 0 1 1 5.636 5.636" fill="none" stroke="white" stroke-width="4" stroke-linecap="round"/><path d="M12 4 L8 1 M12 4 L15 7" fill="none" stroke="white" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path d="M12 4 A8 8 0 1 1 5.636 5.636" fill="none" stroke="black" stroke-width="2" stroke-linecap="round"/><path d="M12 4 L8 1 M12 4 L15 7" fill="none" stroke="black" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>') 12 12, auto`;
        state.canvas.style.cursor = rotateCursor;
        return;
    }

    const cursors = ['ns-resize', 'nesw-resize', 'ew-resize', 'nwse-resize', 'ns-resize', 'nesw-resize', 'ew-resize', 'nwse-resize'];
    const baseIndexMap = {
        top: 0, topRight: 1, right: 2, bottomRight: 3,
        bottom: 4, bottomLeft: 5, left: 6, topLeft: 7
    };

    const baseIndex = baseIndexMap[handle];
    if (baseIndex === undefined) {
        state.canvas.style.cursor = '';
        return;
    }

    const rotationDegrees = rotation * (180 / Math.PI);
    const rotationIndex = Math.round(rotationDegrees / 45);

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

let activeRulerForSettings = null;
let rulerRedrawCallback = null;
let rulerStateRef = null;

export function getActiveRulerForSettings() {
    return activeRulerForSettings;
}

export function updateRulerColor(color) {
    if (activeRulerForSettings) {
        activeRulerForSettings.color = color;
        const colorBtnSvg = document.querySelector('[data-action="pick-ruler-color"] circle');
        if (colorBtnSvg) {
            colorBtnSvg.style.fill = color;
        }
        if (rulerRedrawCallback) rulerRedrawCallback();
    }
}

export function hideRulerSettings() {
    const menu = document.getElementById('floating-ruler-toolbar');
    if (menu) {
        menu.classList.remove('visible');
    }
    activeRulerForSettings = null;
    if (rulerRedrawCallback) rulerRedrawCallback();
}

export function showRulerSettings(ruler, screenX, screenY, state, redrawCallback) {
    const menu = document.getElementById('floating-ruler-toolbar');
    if (!menu) return;

    activeRulerForSettings = ruler;
    rulerRedrawCallback = redrawCallback;
    rulerStateRef = state;

    // Fill current values
    document.getElementById('ruler-length-select').value = ruler.length.toString();
    
    // Default color is derived from theme if null, but let's show #cccccc or something if null
    const isDarkMode = document.body.classList.contains('dark-theme');
    const currentColor = ruler.color || (isDarkMode ? '#555555' : '#e0e0e0');
    
    const colorBtnSvg = document.querySelector('[data-action="pick-ruler-color"] circle');
    if (colorBtnSvg) {
        colorBtnSvg.style.fill = currentColor;
    }
    
    const snapBtn = document.getElementById('ruler-snap-toggle-btn');
    if (snapBtn) {
        snapBtn.classList.toggle('active', !!ruler.snapEnabled);
        snapBtn.title = 'Магнит угла';
    }
    document.getElementById('ruler-snap-angle').value = ruler.snapAngle;
    
    // Convert angle to degrees for display, wrap nicely
    let deg = Math.round(ruler.angle * 180 / Math.PI);
    while (deg < 0) deg += 360;
    while (deg >= 360) deg -= 360;
    document.getElementById('ruler-current-angle').value = deg;

    // Position menu above the ruler
    menu.classList.add('visible');
    
    // Force layout so offsetWidth/Height are available
    const menuWidth = menu.offsetWidth || 320;
    const menuHeight = menu.offsetHeight || 44;
    const vpWidth = window.innerWidth;
    const vpHeight = window.innerHeight;
    
    // Compute the ruler's top edge in screen coordinates.
    // The ruler center is (ruler.x, ruler.y) in world space.
    // The ruler is rotated by ruler.angle.
    // The 4 corners in local space: (±halfL, ±halfW)
    // We project them to screen: screenX = worldX * zoom + panX
    const zoom = state.zoom || 1;
    const panX = state.panX || 0;
    const panY = state.panY || 0;
    const halfL = ruler.length / 2;
    const halfW = ruler.width / 2;
    const cos = Math.cos(ruler.angle);
    const sin = Math.sin(ruler.angle);
    
    // All 4 corners in world space
    const corners = [
        [-halfL, -halfW], [halfL, -halfW],
        [-halfL,  halfW], [halfL,  halfW]
    ].map(([lx, ly]) => ({
        sx: (ruler.x + lx * cos - ly * sin) * zoom + panX,
        sy: (ruler.y + lx * sin + ly * cos) * zoom + panY,
    }));
    
    // Top-most screen Y of the ruler
    const rulerTopScreenY = Math.min(...corners.map(c => c.sy));
    // Horizontal center of ruler on screen
    const rulerCenterScreenX = (ruler.x * zoom + panX);
    
    let left = rulerCenterScreenX - menuWidth / 2;
    let top = rulerTopScreenY - menuHeight - 10; // 10px gap above ruler

    // Clamp horizontally
    if (left < 10) left = 10;
    if (left + menuWidth > vpWidth - 10) left = vpWidth - menuWidth - 10;
    
    // If no space above, show below ruler
    if (top < 10) {
        const rulerBottomScreenY = Math.max(...corners.map(c => c.sy));
        top = rulerBottomScreenY + 10;
    }
    
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
}

export function syncRulerSettingsAngle() {
    if (!activeRulerForSettings) return;
    const angleInput = document.getElementById('ruler-current-angle');
    if (angleInput && document.activeElement !== angleInput) {
        let deg = Math.round(activeRulerForSettings.angle * 180 / Math.PI);
        while (deg <= -180) deg += 360;
        while (deg > 180) deg -= 360;
        angleInput.value = deg;
    }
}

// Setup listeners once
document.addEventListener('DOMContentLoaded', () => {
    const menu = document.getElementById('floating-ruler-toolbar');
    if (!menu) return;

    document.addEventListener('pointerdown', (e) => {
        if (menu.classList.contains('visible') && !menu.contains(e.target) && !e.target.closest('#floating-ruler-color-picker')) {
            hideRulerSettings();
        }
    });

    document.getElementById('ruler-length-select').addEventListener('change', (e) => {
        if (activeRulerForSettings) {
            activeRulerForSettings.length = parseInt(e.target.value, 10);
            if (rulerRedrawCallback) rulerRedrawCallback();
        }
    });

    // Custom palette logic
    const applyBtn = document.getElementById('ruler-apply-btn');
    if (applyBtn) {
        applyBtn.addEventListener('click', hideRulerSettings);
    }
    
    const deleteBtn = document.getElementById('ruler-delete-btn');
    if (deleteBtn) {
        deleteBtn.addEventListener('click', () => {
            if (activeRulerForSettings && rulerStateRef) {
                rulerStateRef.rulers = rulerStateRef.rulers.filter(r => r.id !== activeRulerForSettings.id);
                if (rulerRedrawCallback) rulerRedrawCallback();
            }
            hideRulerSettings();
        });
    }

    const colorPickerBtn = document.querySelector('#floating-ruler-color-picker button[data-action="pick-ruler-color"]');
    const colorPickerWrapper = document.getElementById('floating-ruler-color-picker');
    const colorPalette = document.getElementById('floatingRulerColorPalette');

    if (colorPickerBtn && colorPickerWrapper) {
        colorPickerBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            colorPickerWrapper.classList.toggle('active');
        });
    }

    if (colorPalette) {
        colorPalette.addEventListener('click', (e) => {
            const dot = e.target.closest('.color-dot');
            if (!dot) return;
            const newColor = dot.dataset.rulerColor || dot.dataset.color;
            if (newColor && activeRulerForSettings) {
                updateRulerColor(newColor);
                colorPickerWrapper.classList.remove('active');
            }
        });
    }

    const snapBtn = document.getElementById('ruler-snap-toggle-btn');
    if (snapBtn) {
        snapBtn.addEventListener('click', () => {
            if (activeRulerForSettings) {
                activeRulerForSettings.snapEnabled = !activeRulerForSettings.snapEnabled;
                snapBtn.classList.toggle('active', activeRulerForSettings.snapEnabled);
                snapBtn.title = 'Магнит угла';
            }
        });
    }

    document.getElementById('ruler-snap-angle').addEventListener('input', (e) => {
        if (activeRulerForSettings) {
            let val = parseFloat(e.target.value);
            if (!isNaN(val) && val > 0) {
                activeRulerForSettings.snapAngle = val;
            }
        }
    });

    document.getElementById('ruler-current-angle').addEventListener('input', (e) => {
        if (activeRulerForSettings) {
            let val = parseFloat(e.target.value);
            if (!isNaN(val)) {
                // Keep the same pivot
                const pWorldX = activeRulerForSettings.x + Math.cos(activeRulerForSettings.angle) * activeRulerForSettings.pivotOffset;
                const pWorldY = activeRulerForSettings.y + Math.sin(activeRulerForSettings.angle) * activeRulerForSettings.pivotOffset;

                const newAngle = val * Math.PI / 180;
                activeRulerForSettings.angle = newAngle;

                activeRulerForSettings.x = pWorldX - Math.cos(newAngle) * activeRulerForSettings.pivotOffset;
                activeRulerForSettings.y = pWorldY - Math.sin(newAngle) * activeRulerForSettings.pivotOffset;

                if (rulerRedrawCallback) rulerRedrawCallback();
            }
        }
    });
});
// --- END OF FILE js/ui.js ---