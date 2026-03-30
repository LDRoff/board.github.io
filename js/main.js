// --- START OF FILE js/main.js ---

import { initializeCanvas } from './canvas.js';
import { initializeToolbar } from './toolbar.js';
import { getEditorTextarea } from './text.js';
import { redrawCanvas, drawBackground } from './renderer.js';
import * as history from './history.js';
import { initializeEventListeners, copySelectionToClipboard, pasteFromClipboard } from './events.js';
import { initializeFileHandlers } from './file.js';
import * as utils from './utils.js';
import { mediaCache } from './utils.js';
import { loadStateFromDB } from './persist.js';
import * as textTool from './text.js';

document.addEventListener('DOMContentLoaded', () => {
    // ... (без изменений до loadState) ...
    const loader = document.getElementById('loader-overlay');
    const backgroundCanvas = document.getElementById('backgroundCanvas');
    const drawingCanvas = document.getElementById('drawingBoard');
    const interactionCanvas = document.getElementById('interactionCanvas');
    const ctx = drawingCanvas.getContext('2d');
    const undoBtn = document.getElementById('undoBtn');
    const redoBtn = document.getElementById('redoBtn');
    const objectCounter = document.getElementById('object-counter');
    let canvasState;

    function commitChange(change) {
        history.addHistoryEntry(change);
        updateUndoRedoButtons();
        updateObjectCounter();
    }

    let viewStateSaveTimer = null;
    function debouncedSaveViewState() {
        clearTimeout(viewStateSaveTimer);
        viewStateSaveTimer = setTimeout(() => {
            if (canvasState) {
                history.scheduleDirectDBUpdate();
            }
        }, 500);
    }

    function updateObjectCounter() {
        if (!canvasState) return;
        const count = canvasState.layers.length;
        if (count > 0) {
            objectCounter.textContent = `Объектов: ${count}`;
            objectCounter.classList.remove('hidden');
        } else {
            objectCounter.classList.add('hidden');
        }
    }

    function updateUndoRedoButtons() {
        undoBtn.disabled = !history.canUndo();
        redoBtn.disabled = !history.canRedo();
    }

    async function performUndo() {
        const { layers: newLayers, selectedIds } = history.undo(canvasState.layers);
        if (newLayers) {
            canvasState.layers = await utils.rehydrateLayers(newLayers);
            canvasState.selectedLayers = canvasState.layers.filter(l => selectedIds.includes(l.id));

            // Rebuild grid on undo
            canvasState.spatialGrid = utils.buildSpatialGrid(canvasState.layers);


            if (canvasState.tileManager) canvasState.tileManager.clear();
            if (canvasState.layerBBoxCache) canvasState.layerBBoxCache.clear();

            redraw();
            updateUndoRedoButtons();
            updateObjectCounter();
            canvasState.updateFloatingToolbar();
        }
    }

    async function performRedo() {
        const { layers: newLayers, selectedIds } = history.redo(canvasState.layers);
        if (newLayers) {
            canvasState.layers = await utils.rehydrateLayers(newLayers);
            canvasState.selectedLayers = canvasState.layers.filter(l => selectedIds.includes(l.id));

            // Rebuild grid on redo
            canvasState.spatialGrid = utils.buildSpatialGrid(canvasState.layers);

            if (canvasState.tileManager) canvasState.tileManager.clear();
            if (canvasState.layerBBoxCache) canvasState.layerBBoxCache.clear();

            redraw();
            updateUndoRedoButtons();
            updateObjectCounter();
            canvasState.updateFloatingToolbar();
        }
    }

    function performDeleteSelected() {
        if (canvasState.selectedLayers.length > 0) {
            const layersToDelete = utils.cloneLayersForAction(canvasState.selectedLayers);
            const idsToDelete = new Set(layersToDelete.map(l => l.id));

            if (canvasState.tileManager) {
                layersToDelete.forEach(layer => canvasState.tileManager.invalidateLayer(layer));
            }

            commitChange({
                type: 'deletion',
                before: layersToDelete,
                after: [],
            });

            canvasState.layers = canvasState.layers.filter(layer => !idsToDelete.has(layer.id));
            canvasState.selectedLayers = [];

            // Rebuild grid on delete
            canvasState.spatialGrid = utils.buildSpatialGrid(canvasState.layers);

            redraw();
            canvasState.updateFloatingToolbar();
        }
    }

    function performDeleteSelectedCurveNode() {
        // ... (без изменений, перестроение сетки тут не критично, но желательно) ...
        if (canvasState.selectedLayers.length !== 1 || canvasState.selectedLayers[0].type !== 'curve') return;
        if (canvasState.selectedCurveNodeIndex === null) return;

        const curve = canvasState.selectedLayers[0];
        if (curve.nodes.length <= 2) return;

        const curveBefore = utils.cloneLayersForAction([curve]);

        if (canvasState.tileManager) canvasState.tileManager.invalidateLayer(curve);

        curve.nodes.splice(canvasState.selectedCurveNodeIndex, 1);
        utils.smoothCurveHandles(curve.nodes);

        if (canvasState.tileManager) canvasState.tileManager.invalidateLayer(curve);

        const curveAfter = utils.cloneLayersForAction([curve]);

        commitChange({
            type: 'update',
            before: curveBefore,
            after: curveAfter,
        });

        canvasState.selectedCurveNodeIndex = null;
        redraw();
        canvasState.updateFloatingToolbar();
    }

    // ... (setupCanvases, redraw, updateSubToolbarVisibility без изменений) ...
    const setupCanvases = () => {
        const width = window.innerWidth;
        const height = window.innerHeight;
        const dpr = window.devicePixelRatio || 1;
        const cacheCanvas = document.getElementById('cacheCanvas');

        [backgroundCanvas, drawingCanvas, interactionCanvas, cacheCanvas].forEach(c => {
            c.width = width * dpr;
            c.height = height * dpr;
            c.style.width = `${width}px`;
            c.style.height = `${height}px`;
        });

        if (canvasState && canvasState.tileManager) {
            canvasState.tileManager.clear();
        }

        drawBackground(backgroundCanvas, canvasState);
        if (canvasState) redraw();
    };

    const redraw = () => {
        redrawCanvas(canvasState);
        drawBackground(backgroundCanvas, canvasState);
    };

    function updateSubToolbarVisibility() {
        // ... (код функции без изменений) ...
        if (!canvasState) return;

        const drawingSubToolbar = document.getElementById('drawingSubToolbar');
        const hasSelection = canvasState.selectedLayers.length > 0;
        const activeTool = canvasState.activeTool;

        const shapes2DOrder = ['rect', 'ellipse', 'line', 'curve', 'parallelogram', 'triangle', 'trapezoid', 'rhombus'];
        const shapes3DOrder = ['sphere', 'cone', 'parallelepiped', 'pyramid', 'frustum', 'truncated-pyramid', 'truncated-sphere'];
        const drawableTools = ['brush', 'smart-brush', 'eraser', ...shapes2DOrder, ...shapes3DOrder];

        const nonDrawableSelectionTypes = ['image', 'pdf', 'text'];
        const selectionHasDrawableObject = hasSelection && canvasState.selectedLayers.some(l => !nonDrawableSelectionTypes.includes(l.type));
        const isDrawingContext = drawableTools.includes(activeTool) || selectionHasDrawableObject;

        if (isDrawingContext) {
            drawingSubToolbar.classList.remove('hidden');

            const updateLineWidthControls = (width) => {
                document.querySelectorAll('.line-width-input').forEach(input => input.value = width);
                document.querySelectorAll('.line-width-slider').forEach(slider => slider.value = width);
                const mobileWidthValue = document.getElementById('mobileWidthValue');
                if (mobileWidthValue) mobileWidthValue.textContent = width;
            };

            if (hasSelection) {
                const layer = canvasState.selectedLayers.find(l => l.hasOwnProperty('lineWidth'));
                if (layer) {
                    updateLineWidthControls(layer.lineWidth);
                }

                const colorLayer = canvasState.selectedLayers.find(l => l.hasOwnProperty('color') && l.type !== 'text');
                if (colorLayer) {
                    const colorPalette = document.getElementById('colorPalette');
                    colorPalette.querySelectorAll('.active').forEach(el => el.classList.remove('active'));
                    const newActive = colorPalette.querySelector(`[data-color="${colorLayer.color}"]`);
                    if (newActive) newActive.classList.add('active');
                }

                const fillLayer = canvasState.selectedLayers.find(l => l.hasOwnProperty('fillColor'));
                if (fillLayer) {
                    const fillColorPalette = document.getElementById('fillColorPalette');
                    const mobileFillColorPalette = document.getElementById('mobileFillColorPalette');
                    if (fillColorPalette && mobileFillColorPalette) {
                        [fillColorPalette, mobileFillColorPalette].forEach(palette => {
                            palette.querySelectorAll('.active').forEach(el => el.classList.remove('active'));
                            const newActive = palette.querySelector(`[data-fill="${fillLayer.fillColor}"]`);
                            if (newActive) newActive.classList.add('active');
                        });
                    }
                    // Sync desktop fill button icon
                    const desktopFillBtn = document.getElementById('desktopFillColorBtn');
                    if (desktopFillBtn) {
                        const svg = desktopFillBtn.querySelector('svg');
                        if (svg) {
                            if (fillLayer.fillColor === 'transparent') {
                                svg.setAttribute('fill', 'none');
                                svg.setAttribute('stroke', 'currentColor');
                            } else {
                                svg.setAttribute('fill', fillLayer.fillColor);
                                svg.setAttribute('stroke', fillLayer.fillColor);
                            }
                        }
                    }
                    // Sync mobile fill button icon
                    const mobileFillColorBtn = document.getElementById('mobileFillColorBtn');
                    if (mobileFillColorBtn) {
                        const mobileFillColorSVG = mobileFillColorBtn.querySelector('svg');
                        if (mobileFillColorSVG) {
                            if (fillLayer.fillColor === 'transparent') {
                                mobileFillColorSVG.innerHTML = '<path d="M19 11l-8-8-8 8a8 8 0 1 0 16 0z"></path>';
                                mobileFillColorSVG.setAttribute('fill', 'none');
                                mobileFillColorSVG.setAttribute('stroke', 'currentColor');
                            } else {
                                mobileFillColorSVG.innerHTML = '<path d="M19 11l-8-8-8 8a8 8 0 1 0 16 0z"></path>';
                                mobileFillColorSVG.setAttribute('fill', fillLayer.fillColor);
                                mobileFillColorSVG.setAttribute('stroke', fillLayer.fillColor);
                            }
                        }
                    }
                }

            } else {
                if (activeTool === 'eraser') {
                    updateLineWidthControls(canvasState.activeEraserWidth);
                } else {
                    updateLineWidthControls(canvasState.activeLineWidth);
                }

                const colorPalette = document.getElementById('colorPalette');
                colorPalette.querySelectorAll('.active').forEach(el => el.classList.remove('active'));
                const newActive = colorPalette.querySelector(`[data-color="${canvasState.activeColor}"]`);
                if (newActive) newActive.classList.add('active');

                const fillColorPalette = document.getElementById('fillColorPalette');
                const mobileFillColorPalette = document.getElementById('mobileFillColorPalette');
                if (fillColorPalette && mobileFillColorPalette) {
                    [fillColorPalette, mobileFillColorPalette].forEach(palette => {
                        palette.querySelectorAll('.active').forEach(el => el.classList.remove('active'));
                        const newActive = palette.querySelector(`[data-fill="${canvasState.activeFillColor || 'transparent'}"]`);
                        if (newActive) newActive.classList.add('active');
                    });
                }
            }
        } else {
            drawingSubToolbar.classList.add('hidden');
        }

        const is3DContext = shapes3DOrder.includes(activeTool) || (hasSelection && canvasState.selectedLayers.some(l => shapes3DOrder.includes(l.type)));
        const lineStyleOptions = document.getElementById('lineStyleOptions');
        if (lineStyleOptions) {
            const styleButtons = lineStyleOptions.querySelectorAll('button');
            styleButtons.forEach(btn => {
                btn.disabled = is3DContext;
            });

            if (hasSelection && !is3DContext) {
                const layer = canvasState.selectedLayers.find(l => l.hasOwnProperty('lineStyle'));
                if (layer) {
                    styleButtons.forEach(btn => btn.classList.remove('active'));
                    const newActive = lineStyleOptions.querySelector(`[data-style="${layer.lineStyle || 'solid'}"]`);
                    if (newActive) newActive.classList.add('active');
                }
            } else if (!hasSelection) {
                styleButtons.forEach(btn => btn.classList.remove('active'));
                const newActive = lineStyleOptions.querySelector(`[data-style="${canvasState.activeLineStyle || 'solid'}"]`);
                if (newActive) newActive.classList.add('active');
            }
        }

        const colorPalette = document.getElementById('colorPalette');
        const lineStyleContainer = document.getElementById('lineStyleContainer');
        const mobileColorContainer = document.getElementById('mobile-color-container');
        const mobileStyleContainer = document.getElementById('mobile-style-container');
        const desktopFillColorContainer = document.getElementById('desktopFillColorContainer');
        const mobileFillColorContainer = document.getElementById('mobile-fill-color-container');

        const isFillableTool = ['ellipse', 'parallelogram', 'triangle', 'trapezoid', 'rhombus', 'rect'].includes(activeTool);
        const hasFillableSelection = hasSelection && canvasState.selectedLayers.some(l => ['ellipse', 'parallelogram', 'triangle', 'trapezoid', 'rhombus', 'rect'].includes(l.type));
        const shouldShowFillPalette = isFillableTool || hasFillableSelection;

        if (activeTool === 'eraser') {
            if (colorPalette) colorPalette.style.display = 'none';
            if (lineStyleContainer) lineStyleContainer.style.display = 'none';
            if (mobileColorContainer) mobileColorContainer.style.display = 'none';
            if (mobileStyleContainer) mobileStyleContainer.style.display = 'none';
            if (desktopFillColorContainer) desktopFillColorContainer.style.display = 'none';
            if (mobileFillColorContainer) mobileFillColorContainer.style.display = 'none';
        } else {
            if (colorPalette) colorPalette.style.display = '';
            if (lineStyleContainer) lineStyleContainer.style.display = '';
            if (mobileColorContainer) mobileColorContainer.style.display = '';
            if (mobileStyleContainer) mobileStyleContainer.style.display = '';

            if (shouldShowFillPalette) {
                if (desktopFillColorContainer) desktopFillColorContainer.style.display = '';
                if (mobileFillColorContainer) mobileFillColorContainer.style.display = '';
            } else {
                if (desktopFillColorContainer) desktopFillColorContainer.style.display = 'none';
                if (mobileFillColorContainer) mobileFillColorContainer.style.display = 'none';
            }
        }
    }

    async function loadState(projectData = null) {
        let loadedData = null;

        if (projectData) {
            try {
                loadedData = JSON.parse(projectData);
            } catch (e) {
                console.error("Не удалось разобрать данные проекта:", e);
            }
        } else {
            loadedData = await loadStateFromDB();

            if (!loadedData) {
                const lsData = localStorage.getItem('drawingBoard');
                if (lsData) {
                    console.log("Миграция данных из localStorage в IndexedDB...");
                    try {
                        loadedData = JSON.parse(lsData);
                        localStorage.removeItem('drawingBoard');
                    } catch (e) {
                        console.error("Не удалось разобрать данные из localStorage:", e);
                    }
                }
            }
        }

        let liveLayers = [];
        if (loadedData) {
            try {
                const layersToLoad = loadedData.layers || [];
                const viewState = loadedData.viewState;

                if (viewState) {
                    canvasState.panX = viewState.panX || 0;
                    canvasState.panY = viewState.panY || 0;
                    canvasState.zoom = viewState.zoom || 1;
                }

                liveLayers = await utils.rehydrateLayers(layersToLoad);
            } catch (e) {
                console.error("Не удалось загрузить и обработать состояние:", e);
                liveLayers = [];
            }
        }

        canvasState.layers = liveLayers;

        if (canvasState.tileManager) {
            canvasState.tileManager.clear();
        }

        // --- ИЗМЕНЕНИЕ: Инициализация Spatial Grid при загрузке ---
        canvasState.spatialGrid = utils.buildSpatialGrid(liveLayers);
        // -----------------------------------------------------------

        history.initHistory(canvasState, liveLayers);
        redraw();
        updateUndoRedoButtons();
    }

    function checkUiLayout() {
        const minHeightForVerticalLayout = 600;

        if (window.innerWidth >= 769) {
            if (window.innerHeight < minHeightForVerticalLayout) {
                document.body.classList.add('force-mobile-ui');
            } else {
                document.body.classList.remove('force-mobile-ui');
            }
        } else {
            document.body.classList.remove('force-mobile-ui');
        }
    }

    initializeFloatingTextToolbar();
    initializeFloatingSelectionToolbar();
    initializeFloatingPdfToolbar();
    initializeFloatingCurveToolbar();

    canvasState = initializeCanvas(
        drawingCanvas,
        interactionCanvas,
        ctx,
        redraw,
        commitChange,
        updateSubToolbarVisibility,
        debouncedSaveViewState,
        () => drawBackground(backgroundCanvas, canvasState)
    );
    history.setCanvasStateRef(canvasState);
    canvasState.redraw = redraw;

    const eventHandlers = {
        performUndo, performRedo, commitChange,
        redraw, setupCanvases, updateSubToolbarVisibility,
        performDeselect: () => {
            if (canvasState.selectedLayers.length > 0) {
                canvasState.selectedLayers = [];
                canvasState.selectedCurveNodeIndex = null;
                redraw();
                canvasState.updateFloatingToolbar();
            }
        },
        // --- ИЗМЕНЕНИЕ: Добавляем performSaveState для toolbar.js ---
        performSaveState: (layers) => {
            // Rebuild grid after modifications
            canvasState.spatialGrid = utils.buildSpatialGrid(layers);
            commitChange({ type: 'update', before: [], after: layers }); // Simplified
        }
    };

    initializeToolbar(canvasState, redraw, updateSubToolbarVisibility, { ...eventHandlers, performDeleteSelected, performDeleteSelectedCurveNode });
    initializeCustomTooltips();
    initializeEventListeners(canvasState, { ...eventHandlers, performDeleteSelected, performDeleteSelectedCurveNode });
    initializeFileHandlers(canvasState, loadState, redraw, commitChange);

    updateSubToolbarVisibility();
    setupCanvases();
    loadState();
    updateObjectCounter();
    initializeHelpModal();
    initializeSettingsModal(canvasState, redraw, updateSubToolbarVisibility);

    window.addEventListener('resize', checkUiLayout);
    checkUiLayout();

    // ... (остальные функции initializeFloatingTextToolbar и т.д. без изменений) ...
    function initializeFloatingTextToolbar() {
        // ... (код функции) ...
        const toolbar = document.getElementById('floating-text-toolbar');
        const floatingPalette = document.getElementById('floatingColorPalette');
        const colorPicker = document.getElementById('floating-color-picker');

        const mainPalette = document.getElementById('colorPalette');
        if (mainPalette && floatingPalette) {
            floatingPalette.innerHTML = mainPalette.innerHTML;
        }

        const styleDropdown = document.getElementById('style-dropdown-container');
        const alignDropdown = document.getElementById('align-dropdown-container');
        const fontFamilyDropdown = document.getElementById('font-family-dropdown-container');
        const dropdowns = [styleDropdown, alignDropdown, fontFamilyDropdown, colorPicker];

        toolbar.addEventListener('mousedown', (e) => {
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') { return; }
            e.preventDefault();
            const textarea = getEditorTextarea();
            if (textarea) { textarea.style.pointerEvents = 'none'; }
        });

        document.addEventListener('mouseup', () => {
            const textarea = getEditorTextarea();
            if (textarea) { textarea.style.pointerEvents = 'auto'; }
        });

        const applyChange = (callback) => {
            if (!canvasState) return;

            if (canvasState.isEditingText) {
                callback(null);
                return;
            }

            const layer = (canvasState.selectedLayers.length === 1 && canvasState.selectedLayers[0].type === 'text' ? canvasState.selectedLayers[0] : null);

            if (layer) {
                const before = utils.cloneLayersForAction([layer]);

                if (canvasState.tileManager) canvasState.tileManager.invalidateLayer(layer);

                callback(layer);

                if (!canvasState.isEditingText) {
                    utils.createTextImage(layer).then(img => {
                        layer.cachedImage = img;
                        redraw();
                    });
                }

                if (canvasState.tileManager) canvasState.tileManager.invalidateLayer(layer);

                const after = utils.cloneLayersForAction([layer]);

                Object.assign(canvasState, {
                    activeFontFamily: layer.fontFamily, activeFontSize: layer.fontSize,
                    activeFontWeight: layer.fontWeight, activeFontStyle: layer.fontStyle,
                    activeTextDecoration: layer.textDecoration, activeTextAlign: layer.align,
                    activeTextColor: layer.color
                });

                commitChange({ type: 'update', before, after });
                redraw();

                if (canvasState.isEditingText && canvasState.updateTextEditorStyle) {
                    canvasState.updateTextEditorStyle(layer);
                }
                canvasState.updateFloatingToolbar();
            }
        };

        toolbar.addEventListener('click', e => {
            const button = e.target.closest('button');
            if (!button) return;

            const action = button.dataset.action;
            if (!action) return;

            const dropdownActionMap = {
                'pick-color': colorPicker,
                'style-dropdown': styleDropdown,
                'align-dropdown': alignDropdown,
                'font-family-dropdown': fontFamilyDropdown
            };

            if (Object.keys(dropdownActionMap).includes(action)) {
                e.stopPropagation();
                const container = dropdownActionMap[action];
                const wasActive = container.classList.contains('active');

                dropdowns.forEach(d => {
                    d.classList.remove('active');
                    const menu = d.querySelector('.dropdown-options, .floating-palette');
                    if (menu) {
                        menu.classList.remove('opens-downward');
                        menu.style.transform = '';
                    }
                });

                if (!wasActive) {
                    container.classList.add('active');

                    const dropdownMenu = container.querySelector('.dropdown-options, .floating-palette');
                    if (dropdownMenu) {
                        dropdownMenu.style.transform = '';
                        dropdownMenu.classList.remove('opens-downward');

                        const containerRect = container.getBoundingClientRect();
                        const menuWidth = dropdownMenu.offsetWidth;
                        const menuHeight = dropdownMenu.offsetHeight;
                        const margin = 10;

                        const spaceAbove = containerRect.top;
                        const spaceBelow = window.innerHeight - containerRect.bottom;

                        if (spaceBelow < menuHeight + margin && spaceAbove > menuHeight + margin) {
                        } else {
                            dropdownMenu.classList.add('opens-downward');
                        }

                        const expectedLeft = containerRect.left + (containerRect.width / 2) - (menuWidth / 2);
                        const expectedRight = expectedLeft + menuWidth;

                        let shiftX = 0;
                        if (expectedLeft < margin) {
                            shiftX = margin - expectedLeft;
                        } else if (expectedRight > window.innerWidth - margin) {
                            shiftX = (window.innerWidth - margin) - expectedRight;
                        }

                        dropdownMenu.style.transform = `translateX(calc(-50% + ${shiftX}px))`;
                    }
                }
                return;
            }

            if (action === 'delete') {
                performDeleteSelected();
                return;
            }
            if (action === 'copy') {
                copySelectionToClipboard(canvasState, false);
                return;
            }

            applyChange(layer => {
                if (canvasState.isEditingText) {
                    switch (action) {
                        case 'font-bold': textTool.applyRichTextFormatting('bold'); break;
                        case 'font-italic': textTool.applyRichTextFormatting('italic'); break;
                        case 'font-underline': textTool.applyRichTextFormatting('underline'); break;
                        case 'text-transform': textTool.toggleTextCase(); break;
                        case 'align-left': textTool.applyRichTextFormatting('justifyLeft'); break;
                        case 'align-center': textTool.applyRichTextFormatting('justifyCenter'); break;
                        case 'align-right': textTool.applyRichTextFormatting('justifyRight'); break;
                    }
                } else {
                    if (!layer) return;
                    switch (action) {
                        case 'align-left': layer.align = 'left'; break;
                        case 'align-center': layer.align = 'center'; break;
                        case 'align-right': layer.align = 'right'; break;
                        case 'font-bold': layer.fontWeight = layer.fontWeight === 'bold' ? 'normal' : 'bold'; break;
                        case 'font-italic': layer.fontStyle = layer.fontStyle === 'italic' ? 'normal' : 'italic'; break;
                        case 'font-underline': layer.textDecoration = layer.textDecoration === 'underline' ? 'none' : 'underline'; break;
                        case 'text-transform':
                            const tempDiv = document.createElement('div');
                            tempDiv.innerHTML = layer.content;
                            const text = tempDiv.innerText;
                            const newText = (text === text.toUpperCase()) ? text.toLowerCase() : text.toUpperCase();
                            layer.content = newText;
                            break;
                    }
                }
            });

            if (button.closest('.dropdown-options')) {
                dropdowns.forEach(d => d.classList.remove('active'));
            }
        });

        document.getElementById('font-family-options').addEventListener('click', e => {
            const button = e.target.closest('button[data-font]');
            if (button) {
                const fontName = button.dataset.font;
                applyChange(layer => {
                    if (canvasState.isEditingText) {
                        textTool.applyRichTextFormatting('fontName', fontName);
                    } else if (layer) {
                        layer.fontFamily = fontName;
                    }
                });
                document.getElementById('font-family-display').textContent = fontName;
                fontFamilyDropdown.classList.remove('active');
            }
        });

        floatingPalette.addEventListener('click', e => {
            const colorDot = e.target.closest('.color-dot');
            if (colorDot) {
                const newColor = colorDot.dataset.color;
                applyChange(layer => {
                    if (canvasState.isEditingText) {
                        textTool.applyRichTextFormatting('foreColor', newColor);
                    } else if (layer) {
                        layer.color = newColor;
                    }
                });
                floatingPalette.querySelectorAll('.active').forEach(el => el.classList.remove('active'));
                colorDot.classList.add('active');
                colorPicker.classList.remove('active');
            }
        });

        document.addEventListener('click', (e) => {
            let clickedInside = dropdowns.some(d => d.contains(e.target));
            if (!clickedInside) {
                dropdowns.forEach(d => d.classList.remove('active'));
            }
        });

        document.getElementById('floatingFontSizeInput').addEventListener('input', e => {
            const size = parseInt(e.target.value, 10) || 30;
            applyChange(layer => {
                if (canvasState.isEditingText) {
                    if (canvasState.updateTextEditorStyle) {
                        textTool.updateEditorStyle({ ...canvasState.layers.find(l => l.isEditing), fontSize: size });
                    }
                } else if (layer) {
                    layer.fontSize = size;
                }
            });
        });
    }

    function initializeFloatingSelectionToolbar() {
        const toolbar = document.getElementById('floating-selection-toolbar');
        toolbar.addEventListener('click', e => {
            const button = e.target.closest('button');
            if (button) {
                const action = button.dataset.action;
                if (action === 'delete') {
                    performDeleteSelected();
                } else if (action === 'copy') {
                    copySelectionToClipboard(canvasState, false);
                }
            }
        });
    }

    function initializeFloatingCurveToolbar() {
        const toolbar = document.getElementById('floating-curve-toolbar');
        toolbar.addEventListener('click', e => {
            const button = e.target.closest('button');
            if (!button) return;

            const action = button.dataset.action;
            if (action === 'delete') {
                performDeleteSelected();
            } else if (action === 'delete-curve-node') {
                performDeleteSelectedCurveNode();
            } else if (action === 'copy') {
                copySelectionToClipboard(canvasState, false);
            }
        });
    }

    function initializeFloatingPdfToolbar() {
        const toolbar = document.getElementById('floating-pdf-toolbar');

        async function changePage(direction) {
            if (canvasState.selectedLayers.length !== 1 || canvasState.selectedLayers[0].type !== 'pdf') return;

            const layer = canvasState.selectedLayers[0];
            const newPageNum = layer.currentPage + direction;

            if (newPageNum < 1 || newPageNum > layer.numPages) return;

            const before = utils.cloneLayersForAction([layer]);
            if (canvasState.tileManager) canvasState.tileManager.invalidateLayer(layer);

            layer.currentPage = newPageNum;

            if (!layer.renderedPages.has(newPageNum)) {
                await utils.renderPdfPageToCanvas(layer, newPageNum);
            }

            if (canvasState.tileManager) canvasState.tileManager.invalidateLayer(layer);
            const after = utils.cloneLayersForAction([layer]);

            commitChange({ type: 'update', before, after });
            redraw();
            canvasState.updateFloatingToolbar();
        }

        toolbar.addEventListener('click', e => {
            const button = e.target.closest('button');
            if (!button) return;

            const action = button.dataset.action;
            if (action === 'prev-page') {
                changePage(-1);
            } else if (action === 'next-page') {
                changePage(1);
            } else if (action === 'delete') {
                performDeleteSelected();
            } else if (action === 'copy') {
                copySelectionToClipboard(canvasState, false);
            }
        });
    }

    function initializeCustomTooltips() {
        const tooltip = document.getElementById('custom-tooltip');
        if (!tooltip) return;

        document.body.addEventListener('mouseover', (e) => {
            const target = e.target.closest('[title]');
            if (!target) return;

            const titleText = target.getAttribute('title');
            if (!titleText) return;

            target.dataset.originalTitle = titleText;
            target.removeAttribute('title');

            tooltip.textContent = titleText;
            tooltip.classList.add('visible');

            const targetRect = target.getBoundingClientRect();
            const tooltipWidth = tooltip.offsetWidth;
            const tooltipHeight = tooltip.offsetHeight;
            const margin = 10;

            let left = targetRect.left + targetRect.width / 2;
            const halfTipWidth = tooltipWidth / 2;

            if (left - halfTipWidth < margin) {
                left = margin + halfTipWidth;
            }
            if (left + halfTipWidth > window.innerWidth - margin) {
                left = window.innerWidth - margin - halfTipWidth;
            }

            tooltip.style.left = `${left}px`;

            tooltip.classList.remove('flipped-v');
            let top = targetRect.top;

            if (targetRect.top < tooltipHeight + margin + 5) {
                top = targetRect.bottom;
                tooltip.classList.add('flipped-v');
            }

            tooltip.style.top = `${top}px`;
        });

        document.body.addEventListener('mouseout', (e) => {
            const target = e.target.closest('[data-original-title]');
            if (target) {
                target.setAttribute('title', target.dataset.originalTitle);
                target.removeAttribute('data-original-title');
            }
            tooltip.classList.remove('visible');
        });
    }

    function initializeHelpModal() {
        const helpBtn = document.getElementById('helpBtn');
        const helpModal = document.getElementById('help-modal');
        const closeHelpBtn = document.getElementById('closeHelpBtn');
        const closeHelpBtnTop = document.getElementById('closeHelpBtnTop');

        function openModal() {
            helpModal.classList.remove('hidden');
            helpModal.classList.add('active');
        }
        function closeModal() {
            helpModal.classList.add('hidden');
            helpModal.classList.remove('active');
        }

        helpBtn.addEventListener('click', (e) => { 
            e.preventDefault(); 
            const settingsMenu = document.getElementById('settingsMenu');
            if (settingsMenu) settingsMenu.classList.remove('visible');
            openModal(); 
        });
        if (closeHelpBtn) closeHelpBtn.addEventListener('click', closeModal);
        if (closeHelpBtnTop) closeHelpBtnTop.addEventListener('click', closeModal);
        
        helpModal.addEventListener('mousedown', (e) => { 
            if (e.target === helpModal) { closeModal(); } 
        });

        const helpTabs = helpModal.querySelectorAll('.help-tab');
        const helpPanels = helpModal.querySelectorAll('.help-panel');
        
        helpTabs.forEach(tab => {
            tab.addEventListener('click', () => {
                helpTabs.forEach(t => t.classList.remove('active'));
                helpPanels.forEach(p => p.classList.remove('active'));
                
                tab.classList.add('active');
                const panelId = tab.getAttribute('data-panel');
                const targetPanel = document.getElementById(panelId);
                if (targetPanel) {
                    targetPanel.classList.add('active');
                }
            });
        });
    }

    function initializeSettingsModal(canvasState, redraw, updateSubToolbarVisibility) {
        const settingsBtn = document.getElementById('settingsBtn');
        const settingsModal = document.getElementById('settings-modal');
        const okBtn = document.getElementById('okSettings');
        const cancelBtn = document.getElementById('cancelSettings');
        const closeXBtn = document.getElementById('settings-close-x');

        // Theme Cards
        const themeLight = document.getElementById('theme-light');
        const themeDark = document.getElementById('theme-dark');
        let selectedTheme = 'light';

        themeLight.addEventListener('click', () => {
            themeLight.classList.add('active');
            themeDark.classList.remove('active');
            selectedTheme = 'light';
        });

        themeDark.addEventListener('click', () => {
            themeDark.classList.add('active');
            themeLight.classList.remove('active');
            selectedTheme = 'dark';
        });

        // Setup Custom Dropdown
        function setupDropdown(dropdownId, defaultVal) {
            const dropdown = document.getElementById(dropdownId);
            if (!dropdown) return { getValue: () => defaultVal, setValue: () => {} };
            
            const header = dropdown.querySelector('.dropdown-header');
            const label = header.querySelector('.dropdown-label');
            const itemsContainer = dropdown.querySelector('.dropdown-list');
            const items = dropdown.querySelectorAll('.dropdown-item');
            
            let currentValue = defaultVal;

            header.addEventListener('click', (e) => {
                e.stopPropagation();
                // Close others
                document.querySelectorAll('.custom-dropdown').forEach(d => {
                    if (d !== dropdown) d.classList.remove('open');
                });
                dropdown.classList.toggle('open');
            });

            items.forEach(item => {
                item.addEventListener('click', (e) => {
                    e.stopPropagation();
                    items.forEach(i => i.classList.remove('active'));
                    item.classList.add('active');
                    currentValue = item.dataset.value;
                    label.textContent = item.textContent;
                    dropdown.classList.remove('open');
                });
            });

            return {
                getValue: () => currentValue,
                setValue: (val) => {
                    const targetItem = Array.from(items).find(i => i.dataset.value === val);
                    if (targetItem) {
                        items.forEach(i => i.classList.remove('active'));
                        targetItem.classList.add('active');
                        label.textContent = targetItem.textContent;
                        currentValue = val;
                    }
                }
            };
        }

        const bgDropdown = setupDropdown('dropdown-bg', 'grid');
        const snapDropdown = setupDropdown('dropdown-snap', 'auto');

        // Close dropdowns on outside click
        document.addEventListener('click', () => {
            document.querySelectorAll('.custom-dropdown').forEach(d => d.classList.remove('open'));
        });

        const smoothingSlider = document.getElementById('smoothing-slider');
        const smoothingValue = document.getElementById('smoothing-value');
        const transparencyToggle = document.getElementById('transparency-toggle');
        const animationsToggle = document.getElementById('animations-toggle');

        function applyAndSaveSettings() {
            const theme = selectedTheme;
            const backgroundStyle = bgDropdown.getValue();
            const snappingMode = snapDropdown.getValue();
            const smoothing = smoothingSlider.value;
            const transparencyDisabled = transparencyToggle.checked;
            const animationsDisabled = animationsToggle.checked;

            document.body.classList.toggle('dark-theme', theme === 'dark');
            document.body.classList.toggle('no-transparency', transparencyDisabled);
            document.body.classList.toggle('no-animations', animationsDisabled);

            localStorage.setItem('boardTheme', theme);
            localStorage.setItem('boardBackgroundStyle', backgroundStyle);
            localStorage.setItem('boardSnappingMode', snappingMode);
            localStorage.setItem('boardSmoothing', smoothing);
            localStorage.setItem('boardTransparencyDisabled', transparencyDisabled);
            localStorage.setItem('boardAnimationsDisabled', animationsDisabled);

            if (canvasState) {
                canvasState.smoothingAmount = parseInt(smoothing, 10);
                canvasState.snappingMode = snappingMode;
            }
            redraw();
        }

        function loadSettings() {
            const savedTheme = localStorage.getItem('boardTheme') || 'light';
            const savedStyle = localStorage.getItem('boardBackgroundStyle') || 'grid';
            const savedSnapping = localStorage.getItem('boardSnappingMode') || 'auto';
            const savedSmoothing = localStorage.getItem('boardSmoothing') || '0';
            const savedTransparency = localStorage.getItem('boardTransparencyDisabled') === 'true';
            const savedAnimations = localStorage.getItem('boardAnimationsDisabled') === 'true';

            selectedTheme = savedTheme;
            if (savedTheme === 'dark') {
                themeDark.classList.add('active');
                themeLight.classList.remove('active');
            } else {
                themeLight.classList.add('active');
                themeDark.classList.remove('active');
            }

            bgDropdown.setValue(savedStyle);
            snapDropdown.setValue(savedSnapping);

            smoothingSlider.value = savedSmoothing;
            smoothingValue.textContent = savedSmoothing;
            transparencyToggle.checked = savedTransparency;
            animationsToggle.checked = savedAnimations;

            document.body.classList.toggle('dark-theme', savedTheme === 'dark');
            document.body.classList.toggle('no-transparency', savedTransparency);
            document.body.classList.toggle('no-animations', savedAnimations);

            if (canvasState) {
                canvasState.smoothingAmount = parseInt(savedSmoothing, 10);
                canvasState.snappingMode = savedSnapping;
            }
            redraw();
        }

        smoothingSlider.addEventListener('input', () => { smoothingValue.textContent = smoothingSlider.value; });

        function closeModal() {
            settingsModal.classList.add('hidden');
            settingsModal.classList.remove('active');
            document.querySelectorAll('.custom-dropdown').forEach(d => d.classList.remove('open'));
        }
        
        settingsBtn.addEventListener('click', (e) => {
            e.preventDefault();
            const settingsMenu = document.getElementById('settingsMenu');
            if (settingsMenu) settingsMenu.classList.remove('visible');
            loadSettings();
            settingsModal.classList.remove('hidden');
            settingsModal.classList.add('active');
        });
        
        if (okBtn) okBtn.addEventListener('click', () => {
            applyAndSaveSettings();
            closeModal();
        });
        
        if (cancelBtn) cancelBtn.addEventListener('click', () => {
            loadSettings();
            closeModal();
        });
        
        if (closeXBtn) closeXBtn.addEventListener('click', () => {
            loadSettings();
            closeModal();
        });
        
        settingsModal.addEventListener('mousedown', (e) => {
            if (e.target === settingsModal) {
                loadSettings();
                closeModal();
            }
        });

        loadSettings();
    }

    if (loader) {
        loader.classList.add('hidden');
        loader.addEventListener('transitionend', () => {
            loader.remove();
        }, { once: true });
    }
});
// --- END OF FILE js/main.js ---