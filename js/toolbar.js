// --- START OF FILE js/toolbar.js ---

import { pasteFromClipboard } from './events.js';
import * as utils from './utils.js';

export function initializeToolbar(canvasState, redrawCallback, updateToolbarCallback, handlers) {
    const toolbarWrapper = document.getElementById('toolbarWrapper');
    const toolbar = document.getElementById('toolbar');

    const drawingSubToolbar = document.getElementById('drawingSubToolbar');
    const colorPalette = document.getElementById('colorPalette');
    const lineStyleOptions = document.getElementById('lineStyleOptions');

    const expandSubToolbarBtn = document.getElementById('expandSubToolbarBtn');

    const shapes2DBtn = document.getElementById('shapes2DBtn');
    const shapes2DOptions = document.getElementById('shapes2DOptions');
    const shapes2DToolContainer = document.getElementById('shapes-2d-tool-container');

    const shapes3DBtn = document.getElementById('shapes3DBtn');
    const shapes3DOptions = document.getElementById('shapes3DOptions');
    const shapes3DToolContainer = document.getElementById('shapes-3d-tool-container');

    const addFileBtn = document.getElementById('addFileBtn');
    const addFileOptions = document.getElementById('addFileOptions');
    const addFileToolContainer = document.getElementById('add-file-tool-container');

    const zoomControls = document.getElementById('zoomControls');

    const mobileDrawingToolbar = document.getElementById('mobileDrawingSubToolbar');
    const mobileColorContainer = document.getElementById('mobile-color-container');
    const mobileWidthContainer = document.getElementById('mobile-width-container');
    const mobileStyleContainer = document.getElementById('mobile-style-container');
    const mobileColorBtn = document.getElementById('mobileColorBtn');
    const mobileWidthBtn = document.getElementById('mobileWidthBtn');
    const mobileStyleBtn = document.getElementById('mobileStyleBtn');
    const mobileColorPalette = document.getElementById('mobileColorPalette');
    const mobileLineStyleOptions = document.getElementById('mobileLineStyleOptions');

    const lineStyleContainer = document.getElementById('lineStyleContainer');
    const lineStyleBtn = document.getElementById('lineStyleBtn');
    const desktopFillColorContainer = document.getElementById('desktopFillColorContainer');
    const desktopFillColorBtn = document.getElementById('desktopFillColorBtn');
    const sliderContainers = document.querySelectorAll('.line-width-slider-container');

    const allSubtoolContainers = [
        shapes2DToolContainer,
        shapes3DToolContainer,
        addFileToolContainer,
        lineStyleContainer,
        desktopFillColorContainer,
        ...sliderContainers
    ].filter(Boolean);

    mobileColorPalette.innerHTML = colorPalette.innerHTML;
    mobileLineStyleOptions.innerHTML = lineStyleOptions.innerHTML;

    const fillColorPalette = document.getElementById('fillColorPalette');
    const mobileFillColorPalette = document.getElementById('mobileFillColorPalette');
    if (fillColorPalette && mobileFillColorPalette) {
        mobileFillColorPalette.innerHTML = fillColorPalette.innerHTML;
    }

    // Added mobileFillColorContainer to fix mobile dropdown toggle
    const mobileDropdowns = [mobileColorContainer, mobileWidthContainer, mobileStyleContainer, document.getElementById('mobile-fill-color-container')].filter(Boolean);

    mobileDrawingToolbar.addEventListener('click', (e) => {
        const button = e.target.closest('button');
        if (!button) return;

        const container = button.closest('.dropdown-container');
        if (!container) return;

        e.stopPropagation();
        const wasActive = container.classList.contains('active');

        mobileDropdowns.forEach(d => d.classList.remove('active'));

        if (!wasActive) {
            container.classList.add('active');
        }
    });

    document.addEventListener('click', (e) => {
        if (!mobileDrawingToolbar.contains(e.target)) {
            mobileDropdowns.forEach(d => d.classList.remove('active'));
        }
    });

    if (expandSubToolbarBtn) {
        expandSubToolbarBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            allSubtoolContainers.forEach(c => c.classList.remove('active'));
            drawingSubToolbar.classList.remove('sub-toolbar-collapsed');
        });
    }

    function cancelInProgressActions() {
        const multiStepActions = [
            'drawingCurve', 'drawingParallelogramSlant', 'drawingTriangleApex', 'drawingParallelepipedDepth',
            'drawingPyramidApex', 'drawingTrapezoidP3', 'drawingTrapezoidP4',
            'drawingFrustum', 'drawingTruncatedSphere', 'drawingTruncatedPyramidApex', 'drawingTruncatedPyramidTop'
        ];
        if (multiStepActions.includes(canvasState.currentAction)) {
            if (canvasState.currentAction === 'drawingCurve' && canvasState.tempLayer && canvasState.tempLayer.nodes.length > 1) {
                const newLayer = utils.cloneLayersForAction([canvasState.tempLayer])[0];
                delete newLayer.isEditing;
                canvasState.layers.push(newLayer);
                if (canvasState.tileManager) canvasState.tileManager.invalidateLayer(newLayer, canvasState);
                if (canvasState.spatialGrid) {
                    const box = geo.getTransformedBoundingBox(newLayer);
                    if (box) {
                        const startCol = Math.floor(box.x / 500); const endCol = Math.floor((box.x + box.width) / 500);
                        const startRow = Math.floor(box.y / 500); const endRow = Math.floor((box.y + box.height) / 500);
                        for (let r = startRow; r <= endRow; r++) {
                            for (let c = startCol; c <= endCol; c++) {
                                const cellKey = `${c}_${r}`;
                                if (!canvasState.spatialGrid.has(cellKey)) canvasState.spatialGrid.set(cellKey, []);
                                canvasState.spatialGrid.get(cellKey).push(newLayer);
                            }
                        }
                    }
                }
                canvasState.saveState({ type: 'creation', before: [], after: [newLayer] });
            }
            canvasState.currentAction = 'none';
            canvasState.tempLayer = null;
            if (canvasState.hideCreationTooltip) {
                canvasState.hideCreationTooltip();
            }
            if (canvasState.redraw) canvasState.redraw();
            redrawCallback();
        }
        if (canvasState.resetMobileShapeState) {
            canvasState.resetMobileShapeState();
        }
    }

    function toggleDropdown(container) {
        const wasActive = container.classList.contains('active');
        allSubtoolContainers.forEach(c => c.classList.remove('active'));
        if (!wasActive) {
            container.classList.add('active');
        }
    }

    shapes2DBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        drawingSubToolbar.classList.add('sub-toolbar-collapsed');
        toggleDropdown(shapes2DToolContainer);
    });

    shapes3DBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        drawingSubToolbar.classList.add('sub-toolbar-collapsed');
        toggleDropdown(shapes3DToolContainer);
    });

    addFileBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        drawingSubToolbar.classList.add('sub-toolbar-collapsed');
        toggleDropdown(addFileToolContainer);
    });

    addFileOptions.addEventListener('click', (e) => {
        e.preventDefault();
        const target = e.target.closest('a');
        if (!target) return;

        if (target.id === 'addImageMenuBtn') {
            document.getElementById('imageUpload').click();
        } else if (target.id === 'addPdfMenuBtn') {
            document.getElementById('pdfUpload').click();
        } else if (target.id === 'pasteFromClipboardBtn') {
            const catcher = document.getElementById('pasteCatcher');
            if (catcher) catcher.focus();
            pasteFromClipboard(canvasState);
        }
        addFileToolContainer.classList.remove('active');
    });

    function handleShapeSelection(e, mainButton, container) {
        e.preventDefault();
        const option = e.target.closest('a');
        if (!option) return;
        const tool = option.dataset.tool;
        if (!tool) return;

        cancelInProgressActions();
        canvasState.currentAction = 'none';
        canvasState.isDrawing = false;
        mainButton.innerHTML = option.querySelector('svg').outerHTML;
        canvasState.activeTool = tool;
        if (canvasState.activeTool !== 'select') {
            canvasState.previousTool = canvasState.activeTool;
        }

        toolbar.querySelectorAll('button').forEach(btn => btn.classList.remove('active'));
        zoomControls.querySelectorAll('button').forEach(btn => btn.classList.remove('active'));
        mainButton.classList.add('active');

        drawingSubToolbar.classList.remove('sub-toolbar-collapsed');

        handlers.performDeselect();
        container.classList.remove('active');

        const canvas = canvasState.canvas;
        canvas.classList.remove('cursor-brush', 'cursor-eraser');
        canvas.style.cursor = 'crosshair';

        updateToolbarCallback();
    }

    shapes2DOptions.addEventListener('click', (e) => handleShapeSelection(e, shapes2DBtn, shapes2DToolContainer));
    shapes3DOptions.addEventListener('click', (e) => handleShapeSelection(e, shapes3DBtn, shapes3DToolContainer));

    toolbar.addEventListener('click', (e) => {
        const button = e.target.closest('button');
        if (!button) return;

        if (button.id === 'undoBtn') {
            handlers.performUndo();
            return;
        }
        if (button.id === 'redoBtn') {
            handlers.performRedo();
            return;
        }

        if (button.dataset.toolGroup === 'shapes' || button.dataset.toolGroup === 'files') return;

        const tool = button.dataset.tool;
        if (!tool) return;
        cancelInProgressActions();
        canvasState.currentAction = 'none';
        canvasState.isDrawing = false;
        if (canvasState.activeTool !== tool && canvasState.activeTool !== 'select') {
            canvasState.previousTool = canvasState.activeTool;
        }
        canvasState.activeTool = tool;

        toolbar.querySelectorAll('button').forEach(btn => btn.classList.remove('active'));
        zoomControls.querySelectorAll('button').forEach(btn => btn.classList.remove('active'));
        if (button.dataset.tool) button.classList.add('active');

        const drawableTools = ['brush', 'smart-brush', 'eraser'];
        if (drawableTools.includes(tool)) {
            drawingSubToolbar.classList.remove('sub-toolbar-collapsed');
        }

        if (tool !== 'select') {
            handlers.performDeselect();
        }

        const canvas = canvasState.canvas;
        canvas.classList.remove('cursor-brush', 'cursor-eraser');
        canvas.style.cursor = '';

        if (tool === 'brush' || tool === 'smart-brush') {
            canvas.classList.add('cursor-brush');
        } else if (tool === 'eraser') {
            canvas.classList.add('cursor-eraser');
            canvas.style.cursor = utils.getEraserCursorStyle(canvasState.activeEraserWidth, canvasState.zoom, document.body.classList.contains('dark-theme'));
        } else if (tool === 'text') {
            canvas.style.cursor = 'text';
        } else {
            canvas.style.cursor = 'default';
        }

        // Sync the width slider visually to the selected tool (but don't trigger a save)
        if (drawableTools.includes(tool) || tool === 'line' || button.dataset.toolGroup === 'shapes') {
            const activeProp = canvasState.activeTool === 'eraser' ? canvasState.activeEraserWidth : canvasState.activeLineWidth;

            // Bypass handleLineWidthChange because we don't want to actually change the state or trigger saves, just update UI
            const widthInputs = document.querySelectorAll('.line-width-input');
            const widthSliders = document.querySelectorAll('.line-width-slider');
            const mobileWidthValue = document.getElementById('mobileWidthValue');
            const allPresets = document.querySelectorAll('.line-width-presets');

            widthInputs.forEach(input => input.value = activeProp);
            widthSliders.forEach(slider => slider.value = activeProp);
            if (mobileWidthValue) mobileWidthValue.textContent = activeProp;

            allPresets.forEach(container => {
                container.querySelectorAll('button').forEach(btn => {
                    let presetValToCheck = parseInt(btn.dataset.preset);
                    if (canvasState.activeTool === 'eraser') {
                        if (presetValToCheck === 2) presetValToCheck = 10;
                        else if (presetValToCheck === 8) presetValToCheck = 40;
                        else if (presetValToCheck === 16) presetValToCheck = 80;
                    }
                    btn.classList.toggle('active', presetValToCheck === activeProp);
                });
            });

            const colorPalette = document.getElementById('colorPalette');
            const lineStyleContainer = document.getElementById('lineStyleContainer');
            const mobileColorContainer = document.getElementById('mobile-color-container');
            const mobileStyleContainer = document.getElementById('mobile-style-container');

            if (canvasState.activeTool === 'eraser') {
                if (colorPalette) colorPalette.style.display = 'none';
                if (lineStyleContainer) lineStyleContainer.style.display = 'none';
                if (mobileColorContainer) mobileColorContainer.style.display = 'none';
                if (mobileStyleContainer) mobileStyleContainer.style.display = 'none';
            } else {
                if (colorPalette) colorPalette.style.display = '';
                if (lineStyleContainer) lineStyleContainer.style.display = '';
                if (mobileColorContainer) mobileColorContainer.style.display = '';
                if (mobileStyleContainer) mobileStyleContainer.style.display = '';
            }
        }

        updateToolbarCallback();
    });

    zoomControls.addEventListener('click', (e) => {
        const button = e.target.closest('button');
        if (!button) return;

        const tool = button.dataset.tool;
        if (tool === 'pan') {
            cancelInProgressActions();
            canvasState.currentAction = 'none';
            canvasState.isDrawing = false;
            canvasState.activeTool = 'pan';

            toolbar.querySelectorAll('button').forEach(btn => btn.classList.remove('active'));
            zoomControls.querySelectorAll('button').forEach(btn => btn.classList.remove('active'));

            button.classList.add('active');

            handlers.performDeselect();
            const canvas = canvasState.canvas;
            canvas.classList.remove('cursor-brush', 'cursor-eraser');
            canvas.style.cursor = 'grab';

            updateToolbarCallback();
        }
    });

    function handleColorChange(newColor) {
        if (canvasState.selectedLayers.length > 0) {
            canvasState.selectedLayers.forEach(layer => {
                if (layer.hasOwnProperty('color') && layer.type !== 'text') {
                    layer.color = newColor;
                    if (canvasState.tileManager) {
                        canvasState.tileManager.invalidateLayer(layer, canvasState);
                    }
                }
            });
            redrawCallback();
            canvasState.saveState(canvasState.layers);
        }

        canvasState.activeColor = newColor;

        [colorPalette, mobileColorPalette].forEach(palette => {
            palette.querySelectorAll('.active').forEach(el => el.classList.remove('active'));
            const activeDot = palette.querySelector(`[data-color="${newColor}"]`);
            if (activeDot) activeDot.classList.add('active');
        });

        const mobileColorSVG = mobileColorBtn.querySelector('circle');
        if (mobileColorSVG) {
            mobileColorSVG.setAttribute('fill', newColor);
        }
    }

    colorPalette.addEventListener('click', (e) => {
        const target = e.target.closest('[data-color]');
        if (target) {
            handleColorChange(target.dataset.color);
        }
    });
    mobileColorPalette.addEventListener('click', (e) => {
        const target = e.target.closest('.color-dot');
        if (target) {
            handleColorChange(target.dataset.color);
            mobileColorContainer.classList.remove('active');
        }
    });

    const mobileFillColorBtn = document.getElementById('mobileFillColorBtn');
    const mobileFillColorContainer = document.getElementById('mobile-fill-color-container');

    function handleFillColorChange(newColor) {
        if (canvasState.selectedLayers.length > 0) {
            canvasState.selectedLayers.forEach(layer => {
                if (['rect', 'ellipse', 'parallelogram', 'triangle', 'trapezoid', 'rhombus'].includes(layer.type)) {
                    layer.fillColor = newColor;
                    if (canvasState.tileManager) {
                        canvasState.tileManager.invalidateLayer(layer, canvasState);
                    }
                }
            });
            redrawCallback();
            canvasState.saveState(canvasState.layers);
        }

        canvasState.activeFillColor = newColor;

        if (fillColorPalette && mobileFillColorPalette) {
            [fillColorPalette, mobileFillColorPalette].forEach(palette => {
                palette.querySelectorAll('.active').forEach(el => el.classList.remove('active'));
                const activeDot = palette.querySelector(`[data-fill="${newColor}"]`);
                if (activeDot) activeDot.classList.add('active');
            });
        }

        // Update desktop fill button icon
        if (desktopFillColorBtn) {
            const desktopFillSVG = desktopFillColorBtn.querySelector('svg');
            if (desktopFillSVG) {
                if (newColor === 'transparent') {
                    desktopFillSVG.innerHTML = '<path d="M19 11l-8-8-8 8a8 8 0 1 0 16 0z"></path>';
                    desktopFillSVG.setAttribute('fill', 'none');
                    desktopFillSVG.setAttribute('stroke', 'currentColor');
                } else {
                    desktopFillSVG.innerHTML = '<path d="M19 11l-8-8-8 8a8 8 0 1 0 16 0z"></path>';
                    desktopFillSVG.setAttribute('fill', newColor);
                    desktopFillSVG.setAttribute('stroke', newColor);
                }
            }
        }

        // Update mobile fill button icon
        if (mobileFillColorBtn) {
            const mobileFillColorSVG = mobileFillColorBtn.querySelector('svg');
            if (mobileFillColorSVG) {
                if (newColor === 'transparent') {
                    mobileFillColorSVG.innerHTML = '<path d="M19 11l-8-8-8 8a8 8 0 1 0 16 0z"></path>';
                    mobileFillColorSVG.setAttribute('fill', 'none');
                    mobileFillColorSVG.setAttribute('stroke', 'currentColor');
                } else {
                    mobileFillColorSVG.innerHTML = '<path d="M19 11l-8-8-8 8a8 8 0 1 0 16 0z"></path>';
                    mobileFillColorSVG.setAttribute('fill', newColor);
                    mobileFillColorSVG.setAttribute('stroke', newColor);
                }
            }
        }
    }

    if (fillColorPalette) {
        fillColorPalette.addEventListener('click', (e) => {
            const target = e.target.closest('[data-fill]');
            if (target) {
                handleFillColorChange(target.dataset.fill);
                const desktopContainer = document.getElementById('desktopFillColorContainer');
                if (desktopContainer) desktopContainer.classList.remove('active');
            }
        });
    }

    if (mobileFillColorPalette) {
        mobileFillColorPalette.addEventListener('click', (e) => {
            const target = e.target.closest('.color-dot');
            if (target) {
                handleFillColorChange(target.dataset.fill);
                if (mobileFillColorContainer) mobileFillColorContainer.classList.remove('active');
            }
        });
    }


    const lineWidthIndicator = document.getElementById('lineWidthIndicator');
    const widthInputs = document.querySelectorAll('.line-width-input');
    const widthSliders = document.querySelectorAll('.line-width-slider');
    const allPresets = document.querySelectorAll('.line-width-presets');

    const mobileWidthValue = document.getElementById('mobileWidthValue');

    let saveStateTimeout = null;

    function handleLineWidthChange(newWidth, save = false) {
        const value = Math.max(1, Math.min(100, parseInt(newWidth, 10) || 1));

        if (canvasState.activeTool === 'eraser') {
            canvasState.activeEraserWidth = value;
            canvasState.canvas.style.cursor = utils.getEraserCursorStyle(value, canvasState.zoom, document.body.classList.contains('dark-theme'));
        } else {
            canvasState.activeLineWidth = value;
        }

        widthInputs.forEach(input => input.value = value);
        widthSliders.forEach(slider => slider.value = value);
        if (mobileWidthValue) mobileWidthValue.textContent = value;

        allPresets.forEach(container => {
            container.querySelectorAll('button').forEach(btn => {
                let presetValToCheck = parseInt(btn.dataset.preset);
                if (canvasState.activeTool === 'eraser') {
                    if (presetValToCheck === 2) presetValToCheck = 10;
                    else if (presetValToCheck === 8) presetValToCheck = 40;
                    else if (presetValToCheck === 16) presetValToCheck = 80;
                }
                btn.classList.toggle('active', presetValToCheck === value);
            });
        });

        if (canvasState.selectedLayers.length > 0) {
            canvasState.selectedLayers.forEach(layer => {
                if (layer.hasOwnProperty('lineWidth')) {
                    layer.lineWidth = value;
                    if (canvasState.tileManager) {
                        canvasState.tileManager.invalidateLayer(layer, canvasState);
                    }
                }
            });
            redrawCallback();
        }

        clearTimeout(saveStateTimeout);
        if (save) {
            saveStateTimeout = setTimeout(() => {
                if (canvasState.selectedLayers.length > 0) handlers.performSaveState(canvasState.layers);
            }, 300);
        }
    }

    document.querySelectorAll('.size-editor-wrapper, .size-editor-wrapper-mobile, .line-width-slider-popup').forEach(wrapper => {
        wrapper.addEventListener('click', e => {
            const button = e.target.closest('button');
            if (!button) return;

            const activeProp = canvasState.activeTool === 'eraser' ? canvasState.activeEraserWidth : canvasState.activeLineWidth;
            if (button.dataset.action === 'increase-width') {
                handleLineWidthChange(activeProp + 1, true);
            } else if (button.dataset.action === 'decrease-width') {
                handleLineWidthChange(activeProp - 1, true);
            } else if (button.dataset.preset) {
                let presetValue = parseInt(button.dataset.preset, 10);
                if (canvasState.activeTool === 'eraser') {
                    // Map S (2) -> 10, M (8) -> 40, L (16) -> 80
                    if (presetValue === 2) presetValue = 10;
                    else if (presetValue === 8) presetValue = 40;
                    else if (presetValue === 16) presetValue = 80;
                }
                handleLineWidthChange(presetValue, true);
            }
        });
    });

    widthInputs.forEach(input => {
        input.addEventListener('change', e => handleLineWidthChange(e.target.value, true));
    });

    sliderContainers.forEach(container => {
        const button = container.querySelector('.line-width-slider-btn');
        if (button) {
            button.addEventListener('click', e => {
                e.stopPropagation();
                toggleDropdown(container);
            });
        }
    });

    const onSliderMove = (e) => {
        const slider = e.target.closest('.line-width-slider') || widthSliders[0];
        const zoom = canvasState.zoom;
        const size = parseFloat(slider.value) * zoom;
        lineWidthIndicator.style.width = `${size}px`;
        lineWidthIndicator.style.height = `${size}px`;
        lineWidthIndicator.style.left = `${e.clientX}px`;
        lineWidthIndicator.style.top = `${e.clientY}px`;
    };

    const onSliderUp = () => {
        lineWidthIndicator.classList.remove('visible');
        document.removeEventListener('pointermove', onSliderMove);
        document.removeEventListener('pointerup', onSliderUp);
    };

    widthSliders.forEach(slider => {
        slider.addEventListener('input', e => handleLineWidthChange(e.target.value, false));
        slider.addEventListener('change', e => handleLineWidthChange(e.target.value, true));
        slider.addEventListener('pointerdown', (e) => {
            lineWidthIndicator.classList.add('visible');
            onSliderMove(e);
            document.addEventListener('pointermove', onSliderMove);
            document.addEventListener('pointerup', onSliderUp);
        });
    });

    window.addEventListener('changeLineWidth', (e) => {
        const activeProp = canvasState.activeTool === 'eraser' ? canvasState.activeEraserWidth : canvasState.activeLineWidth;
        const currentWidth = parseInt(activeProp, 10);
        const step = currentWidth < 10 ? 1 : (currentWidth < 30 ? 2 : 5);
        let newWidth = e.detail.direction === 'increase' ? currentWidth + step : currentWidth - step;
        handleLineWidthChange(newWidth, true);
    });

    function handleLineStyleChange(newStyle, button) {
        canvasState.activeLineStyle = newStyle;

        [lineStyleOptions, mobileLineStyleOptions].forEach(options => {
            options.querySelectorAll('.active').forEach(el => el.classList.remove('active'));
            const newActiveButton = options.querySelector(`[data-style="${newStyle}"]`);
            if (newActiveButton) newActiveButton.classList.add('active');
        });

        if (button) {
            const newIconSVG = button.innerHTML;
            if (lineStyleBtn) lineStyleBtn.innerHTML = newIconSVG;
            if (mobileStyleBtn) mobileStyleBtn.innerHTML = newIconSVG;
        }

        if (canvasState.selectedLayers.length > 0) {
            const shapes3DOrder = ['sphere', 'cone', 'parallelepiped', 'pyramid', 'frustum', 'truncated-pyramid', 'truncated-sphere'];
            canvasState.selectedLayers.forEach(layer => {
                if (layer.hasOwnProperty('lineWidth') && !shapes3DOrder.includes(layer.type)) {
                    layer.lineStyle = newStyle;
                    if (canvasState.tileManager) {
                        canvasState.tileManager.invalidateLayer(layer, canvasState);
                    }
                }
            });
            redrawCallback();
            handlers.performSaveState(canvasState.layers);
        }

        if (lineStyleContainer) lineStyleContainer.classList.remove('active');
    }

    lineStyleOptions.addEventListener('click', (e) => {
        const button = e.target.closest('button');
        if (!button || button.disabled) return;
        handleLineStyleChange(button.dataset.style, button);
    });
    mobileLineStyleOptions.addEventListener('click', (e) => {
        const button = e.target.closest('button');
        if (!button || button.disabled) return;
        handleLineStyleChange(button.dataset.style, button);
        mobileStyleContainer.classList.remove('active');
    });

    if (lineStyleBtn && lineStyleContainer) {
        lineStyleBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleDropdown(lineStyleContainer);
        });
    }

    if (desktopFillColorBtn && desktopFillColorContainer) {
        desktopFillColorBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleDropdown(desktopFillColorContainer);
        });
    }

    document.getElementById('toggleToolbar').addEventListener('click', () => { toolbarWrapper.classList.toggle('collapsed'); });

    const logo = document.getElementById('logo');
    const settingsMenu = document.getElementById('settingsMenu');
    const clearCanvasBtn = document.getElementById('clearCanvas');
    const dragHandle = document.querySelector('.toolbar-drag-handle');
    const confirmClearModal = document.getElementById('confirmClearModal');
    const confirmClearBtn = document.getElementById('confirmClearBtn');
    const cancelClearBtn = document.getElementById('cancelClearBtn');

    logo.addEventListener('click', (e) => {
        e.stopPropagation();
        settingsMenu.classList.toggle('visible');
    });

    const findDrawingsBtn = document.getElementById('findDrawingsBtn');
    if (findDrawingsBtn) {
        findDrawingsBtn.addEventListener('click', (e) => {
            e.preventDefault();
            settingsMenu.classList.remove('visible');
            if (canvasState.layers.length === 0) return;
            if (typeof canvasState.zoomToFit === 'function') {
                canvasState.zoomToFit();
            }
        });
    }

    clearCanvasBtn.addEventListener('click', (e) => {
        e.preventDefault();
        settingsMenu.classList.remove('visible');
        confirmClearModal.classList.remove('hidden');
    });

    function hideConfirmModal() {
        confirmClearModal.classList.add('hidden');
    }

    // --- НАЧАЛО ИЗМЕНЕНИЙ ---
    confirmClearBtn.addEventListener('click', () => {
        if (canvasState.layers.length === 0) {
            hideConfirmModal();
            return;
        }

        // Клонируем все текущие слои для записи в историю как "до" изменения
        const layersToDelete = utils.cloneLayersForAction(canvasState.layers);

        // Создаем корректный объект изменения для системы истории
        const change = {
            type: 'deletion',
            before: layersToDelete,
            after: [], // "После" - это пустой холст
        };

        // Получаем функцию commitChange, привязанную в main.js
        const commitChange = canvasState.saveState;
        if (commitChange) {
            commitChange(change);
        }

        // Обновляем текущее состояние приложения
        canvasState.layers = [];
        canvasState.selectedLayers = [];

        // Очищаем кэш тайлов и пространственную сетку
        if (canvasState.tileManager) {
            canvasState.tileManager.clear();
        }
        if (canvasState.spatialGrid) {
            canvasState.spatialGrid = new Map();
        }
        if (canvasState.layerBBoxCache) {
            canvasState.layerBBoxCache.clear();
        }

        redrawCallback();
        hideConfirmModal();
    });
    // --- КОНЕЦ ИЗМЕНЕНИЙ ---

    cancelClearBtn.addEventListener('click', hideConfirmModal);
    confirmClearModal.addEventListener('click', (e) => {
        if (e.target === confirmClearModal) {
            hideConfirmModal();
        }
    });

    document.addEventListener('click', (e) => {
        if (!settingsMenu.contains(e.target) && e.target !== logo) {
            settingsMenu.classList.remove('visible');
        }

        const clickedInsideSubtool = allSubtoolContainers.some(c => c.contains(e.target));
        if (!clickedInsideSubtool) {
            allSubtoolContainers.forEach(c => c.classList.remove('active'));
        }
    });

    let isDragging = false, offsetX;
    dragHandle.addEventListener('mousedown', (e) => { isDragging = true; const rect = toolbarWrapper.getBoundingClientRect(); offsetX = e.clientX - rect.left; document.body.style.userSelect = 'none'; });
    document.addEventListener('mousemove', (e) => { if (isDragging) { const toolbarWidth = toolbarWrapper.offsetWidth; const windowWidth = window.innerWidth; let newLeft = e.clientX - offsetX; if (newLeft < 0) newLeft = 0; if (newLeft + toolbarWidth > windowWidth) newLeft = windowWidth - toolbarWidth; toolbarWrapper.style.left = `${newLeft}px`; toolbarWrapper.style.transform = 'none'; } });
    document.addEventListener('mouseup', () => { isDragging = false; document.body.style.userSelect = 'auto'; });
}