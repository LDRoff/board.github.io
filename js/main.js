// --- START OF FILE js/main.js ---

import { initializeCanvas } from './canvas.js';
import { initializeToolbar } from './toolbar.js';
import { getEditorTextarea } from './text.js';
import { redrawCanvas, drawBackground, drawLoadingPlaceholders } from './renderer.js';
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

            requestAnimationFrame(() => {
                redraw();
                updateUndoRedoButtons();
                updateObjectCounter();
                canvasState.updateFloatingToolbar();
            });
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

            requestAnimationFrame(() => {
                redraw();
                updateUndoRedoButtons();
                updateObjectCounter();
                canvasState.updateFloatingToolbar();
            });
        }
    }

    function performDeleteSelected() {
        if (canvasState.selectedLayers.length > 0) {
            // Добавляем дочерние элементы PDF (рисунки, тексты) к удалению
            let allLayersToDelete = new Set();
            canvasState.selectedLayers.forEach(l => {
                if (l.id !== canvasState.editingAnnotationsLayerId) {
                    allLayersToDelete.add(l);
                }
                if (l.type === 'pdf' || l.type === 'image') {
                    if (l.id !== canvasState.editingAnnotationsLayerId) {
                        canvasState.layers.filter(child => child.parentId === l.id).forEach(child => allLayersToDelete.add(child));
                    }
                }
            });
            allLayersToDelete = Array.from(allLayersToDelete);
            if (allLayersToDelete.length === 0) return;

            const layersToDelete = utils.cloneLayersForAction(allLayersToDelete);
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

        const isMobileDevice = window.matchMedia('(max-width: 768px)').matches;
        const mobileTextSubToolbar = document.getElementById('mobileTextSubToolbar');
        const mobileDrawingSubToolbar = document.getElementById('mobileDrawingSubToolbar');

        // На мобильных: показываем саб-тулбар с настройками текста вместо панели рисования
        const isTextContext = canvasState.isEditingText ||
            (hasSelection && canvasState.selectedLayers.length === 1 && canvasState.selectedLayers[0].type === 'text');

        if (isMobileDevice && isTextContext) {
            drawingSubToolbar.classList.remove('hidden');
            drawingSubToolbar.classList.remove('sub-toolbar-collapsed');
            if (mobileTextSubToolbar) mobileTextSubToolbar.style.display = '';
            if (mobileDrawingSubToolbar) mobileDrawingSubToolbar.style.display = 'none';

            const layer = canvasState.selectedLayers[0];
            if (layer) {
                const fontSizeInput = document.getElementById('mobileTextFontSizeInput');
                if (fontSizeInput) fontSizeInput.value = Math.round(layer.fontSize || 30);

                const colorBtn = document.getElementById('mobileTextColorBtn');
                if (colorBtn) {
                    const circle = colorBtn.querySelector('circle');
                    if (circle) circle.setAttribute('fill', layer.color || '#000000');
                }

                const boldBtn = document.getElementById('mobileTextBold');
                if (boldBtn) boldBtn.classList.toggle('active', layer.fontWeight === 'bold');
                const italicBtn = document.getElementById('mobileTextItalic');
                if (italicBtn) italicBtn.classList.toggle('active', layer.fontStyle === 'italic');
                const underlineBtn = document.getElementById('mobileTextUnderline');
                if (underlineBtn) underlineBtn.classList.toggle('active', layer.textDecoration === 'underline');
            }
            return;
        }

        // Обычный режим: показываем панель рисования, скрываем текстовую
        if (mobileTextSubToolbar) mobileTextSubToolbar.style.display = 'none';
        if (mobileDrawingSubToolbar) mobileDrawingSubToolbar.style.display = '';

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

        // Скрыть прелоадер только после того, как все загружено и отрисовано
        if (loader && !loader.classList.contains('hidden')) {
            loader.classList.add('hidden');
            loader.addEventListener('transitionend', () => {
                if (window._preloaderAnimationId) {
                    cancelAnimationFrame(window._preloaderAnimationId);
                }
                loader.remove();
            }, { once: true });
        }
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
    initializeMobileTextSubToolbar();

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
    
    let animationFrameId = null;
    canvasState.startAnimationLoop = () => {
        if (animationFrameId) return; // already running

        // Draw the main canvas once to show the current state
        redraw();

        const loopOnOverlay = () => {
            if (canvasState.loadingFiles && canvasState.loadingFiles.length > 0) {
                // Only clear & redraw the lightweight interaction canvas
                const iCanvas = canvasState.interactionCanvas;
                canvasState.iCtx.setTransform(1, 0, 0, 1, 0, 0);
                canvasState.iCtx.clearRect(0, 0, iCanvas.width, iCanvas.height);
                drawLoadingPlaceholders(canvasState.iCtx, canvasState.loadingFiles, canvasState);
                animationFrameId = requestAnimationFrame(loopOnOverlay);
            } else {
                // Loading done — clear the overlay and do one final full redraw
                const iCanvas = canvasState.interactionCanvas;
                canvasState.iCtx.setTransform(1, 0, 0, 1, 0, 0);
                canvasState.iCtx.clearRect(0, 0, iCanvas.width, iCanvas.height);
                animationFrameId = null;
                redraw();
            }
        };
        loopOnOverlay();
    };

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
        
        const floatingBgPalette = document.getElementById('floatingBgColorPalette');
        const bgColorPicker = document.getElementById('floating-bg-color-picker');

        const mainPalette = document.getElementById('colorPalette');
        if (mainPalette) {
            if (floatingPalette) {
                floatingPalette.innerHTML = mainPalette.innerHTML;
                floatingPalette.querySelectorAll('.color-dot').forEach(dot => {
                    dot.dataset.textColor = dot.dataset.color;
                });
            }
            if (floatingBgPalette) {
                floatingBgPalette.innerHTML = mainPalette.innerHTML;
                floatingBgPalette.querySelectorAll('.color-dot').forEach(dot => {
                    dot.dataset.textColor = dot.dataset.color;
                });
                
                const noColorDot = document.createElement('div');
                noColorDot.className = 'color-dot';
                noColorDot.style.background = 'transparent';
                noColorDot.style.border = '1px solid var(--border-color)';
                noColorDot.style.position = 'relative';
                noColorDot.dataset.textColor = 'transparent';
                noColorDot.title = 'Без фона';
                noColorDot.innerHTML = '<div style="position: absolute; top: 50%; left: 0; right: 0; height: 1.5px; background: #EF4444; transform: rotate(-45deg);"></div>';
                floatingBgPalette.insertBefore(noColorDot, floatingBgPalette.firstChild);
            }
        }

        const styleDropdown = document.getElementById('style-dropdown-container');
        const alignDropdown = document.getElementById('align-dropdown-container');
        const fontFamilyDropdown = document.getElementById('font-family-dropdown-container');
        const listDropdown = document.getElementById('list-dropdown-container');
        const indexDropdown = document.getElementById('index-dropdown-container');
        const dropdowns = [styleDropdown, alignDropdown, fontFamilyDropdown, listDropdown, colorPicker, bgColorPicker, indexDropdown].filter(Boolean);

        // Prevent ANY click inside the toolbar from stealing focus from the editor.
        // For <input> elements we prevent mousedown but let them get focus via the click event.
        toolbar.addEventListener('mousedown', (e) => {
            e.preventDefault();
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
                    layer.cachedImage = null; // Очищаем кэш картинки, чтобы текст сразу отрисовался через стандартный API
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
                'pick-bg-color': bgColorPicker,
                'style-dropdown': styleDropdown,
                'align-dropdown': alignDropdown,
                'list-dropdown': listDropdown,
                'font-family-dropdown': fontFamilyDropdown,
                'index-dropdown': indexDropdown
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

                        // Определяем направление выпадающего меню на основе позиции тулбара:
                        // - Тулбар СВЕРХУ текста → меню открывается вверх (подальше от текста и системного меню)
                        // - Тулбар СНИЗУ текста → меню открывается вниз (подальше от текста и системного меню)
                        const parentToolbar = container.closest('.floating-toolbar');
                        const toolbarPosition = parentToolbar ? parentToolbar.dataset.toolbarPosition : null;

                        if (toolbarPosition === 'below') {
                            // Тулбар под текстом — выпадающие вниз
                            dropdownMenu.classList.add('opens-downward');
                        } else if (toolbarPosition === 'above') {
                            // Тулбар над текстом — выпадающие вверх (CSS по умолчанию, класс не нужен)
                        } else {
                            // Для тулбаров без позиции (например, selection toolbar) — старая логика
                            if (spaceBelow < menuHeight + margin && spaceAbove > menuHeight + margin) {
                                // open upward (default)
                            } else {
                                dropdownMenu.classList.add('opens-downward');
                            }
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
            if (action === 'select-annotations') {
                const pdfOrImage = canvasState.selectedLayers.find(l => l.type === 'pdf' || l.type === 'image');
                if (pdfOrImage) {
                    if (canvasState.editingAnnotationsLayerId === pdfOrImage.id) {
                        // Toggle OFF
                        canvasState.editingAnnotationsLayerId = null;
                        canvasState.selectedLayers = [pdfOrImage];
                    } else {
                        // Toggle ON
                        canvasState.editingAnnotationsLayerId = pdfOrImage.id;
                        canvasState.selectedLayers = [pdfOrImage];
                    }
                    canvasState.updateFloatingToolbar();
                    redraw();
                }
                return;
            }

            applyChange(layer => {
                if (canvasState.isEditingText) {
                    switch (action) {
                        case 'font-bold':    textTool.applyRichTextFormatting('bold'); break;
                        case 'font-italic':  textTool.applyRichTextFormatting('italic'); break;
                        case 'font-underline': textTool.applyRichTextFormatting('underline'); break;
                        case 'font-strike':  textTool.applyRichTextFormatting('strikeThrough'); break;
                        case 'font-superscript': textTool.applyRichTextFormatting('superscript'); break;
                        case 'font-subscript': textTool.applyRichTextFormatting('subscript'); break;
                        case 'text-transform': textTool.toggleTextCase(); break;
                        case 'align-left':   textTool.setTextAlign('left'); break;
                        case 'align-center': textTool.setTextAlign('center'); break;
                        case 'align-right':  textTool.setTextAlign('right'); break;
                        case 'list-bullet':  textTool.applyRichTextFormatting('insertUnorderedList'); break;
                        case 'list-number':  textTool.applyRichTextFormatting('insertOrderedList'); break;
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
                        case 'font-superscript':
                        case 'font-subscript':
                            const tempFormattingDiv = document.createElement('div');
                            tempFormattingDiv.innerHTML = layer.content;
                            const isSuper = tempFormattingDiv.querySelector('sup') !== null;
                            const isSub = tempFormattingDiv.querySelector('sub') !== null;
                            
                            if (action === 'font-superscript') {
                                if (isSuper) {
                                    // Remove superscript
                                    layer.content = tempFormattingDiv.textContent;
                                } else {
                                    // Apply superscript, removing subscript if present
                                    layer.content = `<sup>${tempFormattingDiv.textContent}</sup>`;
                                }
                            } else {
                                if (isSub) {
                                    // Remove subscript
                                    layer.content = tempFormattingDiv.textContent;
                                } else {
                                    // Apply subscript, removing superscript if present
                                    layer.content = `<sub>${tempFormattingDiv.textContent}</sub>`;
                                }
                            }
                            break;
                        case 'text-transform':
                            layer.content = textTool.transformHTMLCase(layer.content);
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
                const displayName = button.textContent;
                if (canvasState.isEditingText) {
                    textTool.setFontFamily(fontName);
                } else {
                    applyChange(layer => {
                        if (layer) {
                            layer.fontFamily = fontName;
                            layer.content = textTool.clearInlinePropertyFromContent(layer.content, 'fontFamily');
                        }
                    });
                }
                document.getElementById('font-family-display').textContent = displayName;
                fontFamilyDropdown.classList.remove('active');
            }
        });

        floatingPalette.addEventListener('click', e => {
            const colorDot = e.target.closest('.color-dot');
            if (colorDot) {
                const newColor = colorDot.dataset.color;
                if (canvasState.isEditingText) {
                    textTool.setTextColor(newColor);
                } else {
                    applyChange(layer => {
                        if (layer) {
                            layer.color = newColor;
                            layer.content = textTool.clearInlinePropertyFromContent(layer.content, 'color');
                        }
                    });
                }
                floatingPalette.querySelectorAll('.active').forEach(el => el.classList.remove('active'));
                colorDot.classList.add('active');
                colorPicker.classList.remove('active');
            }
        });

        if (floatingBgPalette) {
            floatingBgPalette.addEventListener('click', e => {
                const colorDot = e.target.closest('.color-dot');
                if (colorDot) {
                    const newColor = colorDot.dataset.color;
                    applyChange(layer => {
                        if (canvasState.isEditingText) {
                            textTool.applyRichTextProperty('backgroundColor', newColor);
                        } else if (layer) {
                            layer.content = textTool.clearInlinePropertyFromContent(layer.content, 'backgroundColor');
                            if (newColor !== 'transparent') {
                                layer.content = `<span style="background-color: ${newColor};">${layer.content}</span>`;
                            }
                        }
                    });
                    floatingBgPalette.querySelectorAll('.active').forEach(el => el.classList.remove('active'));
                    colorDot.classList.add('active');
                    if (bgColorPicker) bgColorPicker.classList.remove('active');
                }
            });
        }

        document.addEventListener('click', (e) => {
            let clickedInside = dropdowns.some(d => d.contains(e.target));
            if (!clickedInside) {
                dropdowns.forEach(d => d.classList.remove('active'));
            }
        });

        const fontSizeInput = document.getElementById('floatingFontSizeInput');
        const applyFontSize = () => {
            const size = parseInt(fontSizeInput.value, 10);
            if (!size || size < 1 || size > 1000) return;
            if (canvasState.isEditingText) {
                // Apply to the whole layer — simple, no selection needed
                textTool.setFontSize(size);
                redraw();
                canvasState.updateFloatingToolbar();
            } else {
                applyChange(layer => {
                    if (!layer) return;
                    layer.fontSize = size;
                });
            }
        };
        fontSizeInput.addEventListener('input', applyFontSize);
        fontSizeInput.addEventListener('change', applyFontSize);
        // stopPropagation prevents toolbar's e.preventDefault() from firing,
        // so the input remains focusable and typeable.
        fontSizeInput.addEventListener('mousedown', (e) => {
            e.stopPropagation();
        });
    }

    function initializeMobileTextSubToolbar() {
        const mobileTextToolbar = document.getElementById('mobileTextSubToolbar');
        // Предотвращаем потерю фокуса у текстового редактора
        mobileTextToolbar.addEventListener('mousedown', (e) => {
            if (e.target.tagName !== 'INPUT') e.preventDefault();
        });
        
        // На мобильных касание кнопки сбрасывает выделение до потери фокуса, 
        // поэтому нужно предотвращать pointerdown на кнопках
        mobileTextToolbar.addEventListener('pointerdown', (e) => {
            if (e.target.closest('button, .color-dot, .toolbar-select')) {
                e.preventDefault();
            }
        });

        const applyTextChange = (callback) => {
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
                layer.cachedImage = null;
                utils.createTextImage(layer).then(img => { layer.cachedImage = img; redraw(); });
                if (canvasState.tileManager) canvasState.tileManager.invalidateLayer(layer);
                const after = utils.cloneLayersForAction([layer]);
                commitChange({ type: 'update', before, after });
                redraw();
                if (canvasState.isEditingText && canvasState.updateTextEditorStyle) {
                    canvasState.updateTextEditorStyle(layer);
                }
                updateSubToolbarVisibility();
            }
        };

        // Кнопки форматирования и действий
        mobileTextToolbar.addEventListener('pointerup', e => {
            const button = e.target.closest('button');
            if (!button) return;

            // Дропдауны: если кнопка внутри dropdown-container и это кнопка-триггер
            const container = button.closest('.dropdown-container');
            if (container) {
                if (button.id && (button.id.includes('Btn') || button.id.includes('btn'))) {
                    const wasActive = container.classList.contains('active');
                    mobileTextToolbar.querySelectorAll('.dropdown-container').forEach(d => d.classList.remove('active'));
                    if (!wasActive) container.classList.add('active');
                    return; // Действие только для открытия дропдауна
                }
            }

            const action = button.dataset.action;
            if (!action) return;

            // Копировать
            if (action === 'copy') {
                copySelectionToClipboard(canvasState, false);
                return;
            }
            // Удалить
            if (action === 'delete') {
                performDeleteSelected();
                return;
            }

            applyTextChange(layer => {
                if (canvasState.isEditingText) {
                    switch (action) {
                        case 'font-bold':       textTool.applyRichTextFormatting('bold'); break;
                        case 'font-italic':     textTool.applyRichTextFormatting('italic'); break;
                        case 'font-underline':  textTool.applyRichTextFormatting('underline'); break;
                        case 'font-strike':     textTool.applyRichTextFormatting('strikeThrough'); break;
                        case 'font-superscript':textTool.applyRichTextFormatting('superscript'); break;
                        case 'font-subscript':  textTool.applyRichTextFormatting('subscript'); break;
                        case 'text-transform':  textTool.toggleTextCase(); break;
                        case 'align-left':      textTool.setTextAlign('left'); break;
                        case 'align-center':    textTool.setTextAlign('center'); break;
                        case 'align-right':     textTool.setTextAlign('right'); break;
                        case 'list-bullet':     textTool.applyRichTextFormatting('insertUnorderedList'); break;
                        case 'list-number':     textTool.applyRichTextFormatting('insertOrderedList'); break;
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
                        case 'font-strike': layer.textDecoration = layer.textDecoration === 'line-through' ? 'none' : 'line-through'; break;
                        case 'text-transform': layer.content = textTool.transformHTMLCase(layer.content); break;
                    }
                }
            });
        });

        // Выбор шрифта
        const fontOptions = document.getElementById('mobileTextFontOptions');
        if (fontOptions) {
            fontOptions.addEventListener('pointerup', e => {
                const button = e.target.closest('button[data-font]');
                if (!button) return;
                const fontName = button.dataset.font;
                if (canvasState.isEditingText) {
                    textTool.setFontFamily(fontName);
                } else {
                    applyTextChange(layer => {
                        if (layer) {
                            layer.fontFamily = fontName;
                            layer.content = textTool.clearInlinePropertyFromContent(layer.content, 'fontFamily');
                        }
                    });
                }
                const fontContainer = document.getElementById('mobile-text-font-container');
                if (fontContainer) fontContainer.classList.remove('active');
            });
        }

        // Размер шрифта
        const fontSizeInput = document.getElementById('mobileTextFontSizeInput');
        if (fontSizeInput) {
            const applyMobileFontSize = () => {
                const size = parseInt(fontSizeInput.value, 10);
                if (!size || size < 1 || size > 1000) return;
                if (canvasState.isEditingText) {
                    textTool.setFontSize(size);
                    redraw();
                    updateSubToolbarVisibility();
                } else {
                    applyTextChange(layer => { if (layer) layer.fontSize = size; });
                }
            };
            fontSizeInput.addEventListener('input', applyMobileFontSize);
            fontSizeInput.addEventListener('change', applyMobileFontSize);
            fontSizeInput.addEventListener('mousedown', e => e.stopPropagation());
        }

        // Цвет текста
        const colorPalette = document.getElementById('mobileTextColorPalette');
        if (colorPalette) {
            colorPalette.addEventListener('pointerup', e => {
                const colorDot = e.target.closest('.color-dot');
                if (!colorDot) return;
                const newColor = colorDot.dataset.textColor;
                if (!newColor) return;
                if (canvasState.isEditingText) {
                    textTool.setTextColor(newColor);
                } else {
                    applyTextChange(layer => {
                        if (layer) {
                            layer.color = newColor;
                            layer.content = textTool.clearInlinePropertyFromContent(layer.content, 'color');
                        }
                    });
                }
                colorPalette.querySelectorAll('.active').forEach(el => el.classList.remove('active'));
                colorDot.classList.add('active');
                // Обновляем иконку кнопки цвета
                const colorBtn = document.getElementById('mobileTextColorBtn');
                if (colorBtn) {
                    const circle = colorBtn.querySelector('circle');
                    if (circle) circle.setAttribute('fill', newColor);
                }
                const colorContainer = document.getElementById('mobile-text-color-container');
                if (colorContainer) colorContainer.classList.remove('active');
            });
        }

        // Цвет фона текста (маркер)
        const bgColorPalette = document.getElementById('mobileTextBgColorPalette');
        if (bgColorPalette) {
            bgColorPalette.addEventListener('pointerup', e => {
                const colorDot = e.target.closest('.color-dot');
                if (!colorDot) return;
                const newColor = colorDot.dataset.textColor;
                if (!newColor) return;
                applyTextChange((layer) => {
                    if (canvasState.isEditingText) {
                        textTool.applyRichTextProperty('backgroundColor', newColor);
                    } else if (layer) {
                        layer.content = textTool.clearInlinePropertyFromContent(layer.content, 'backgroundColor');
                        if (newColor !== 'transparent') {
                            layer.content = `<span style="background-color: ${newColor};">${layer.content}</span>`;
                        }
                    }
                });
                bgColorPalette.querySelectorAll('.active').forEach(el => el.classList.remove('active'));
                colorDot.classList.add('active');
                const bgContainer = document.getElementById('mobile-text-bg-color-container');
                if (bgContainer) bgContainer.classList.remove('active');
            });
        }

        // Закрытие дропдаунов при клике вне
        document.addEventListener('click', e => {
            if (!mobileTextToolbar.contains(e.target)) {
                mobileTextToolbar.querySelectorAll('.dropdown-container').forEach(d => d.classList.remove('active'));
            }
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
                } else if (action === 'select-annotations') {
                    const pdfOrImage = canvasState.selectedLayers.find(l => l.type === 'pdf' || l.type === 'image');
                    if (pdfOrImage) {
                        if (canvasState.editingAnnotationsLayerId === pdfOrImage.id) {
                            canvasState.editingAnnotationsLayerId = null;
                            canvasState.selectedLayers = [pdfOrImage];
                        } else {
                            canvasState.editingAnnotationsLayerId = pdfOrImage.id;
                            canvasState.selectedLayers = [pdfOrImage];
                        }
                        canvasState.updateFloatingToolbar();
                        redraw();
                    }
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
            } else if (action === 'select-annotations') {
                const pdfOrImage = canvasState.selectedLayers.find(l => l.type === 'pdf' || l.type === 'image');
                if (pdfOrImage) {
                    if (canvasState.editingAnnotationsLayerId === pdfOrImage.id) {
                        canvasState.editingAnnotationsLayerId = null;
                        canvasState.selectedLayers = [pdfOrImage];
                    } else {
                        canvasState.editingAnnotationsLayerId = pdfOrImage.id;
                        canvasState.selectedLayers = [pdfOrImage];
                    }
                    canvasState.updateFloatingToolbar();
                    redraw();
                }
            }
        });

        // --- Page jump popup ---
        const pageIndicatorBtn = document.getElementById('pdf-page-indicator');
        const pageNavGroup = document.getElementById('pdf-page-nav-group');
        const pageJumpGroup = document.getElementById('pdf-page-jump-group');
        const pageJumpInput = document.getElementById('pdf-page-jump-input');
        const pageJumpConfirm = document.getElementById('pdf-page-jump-confirm');

        function showPageJumpPopup() {
            if (canvasState.selectedLayers.length !== 1 || canvasState.selectedLayers[0].type !== 'pdf') return;
            const layer = canvasState.selectedLayers[0];
            pageJumpInput.max = layer.numPages;
            pageJumpInput.value = layer.currentPage;
            
            pageNavGroup.style.display = 'none';
            pageJumpGroup.style.display = 'flex';
            
            pageJumpInput.focus();
            pageJumpInput.select();
        }

        function hidePageJumpPopup() {
            pageNavGroup.style.display = 'flex';
            pageJumpGroup.style.display = 'none';
        }

        async function jumpToPage() {
            if (canvasState.selectedLayers.length !== 1 || canvasState.selectedLayers[0].type !== 'pdf') return;
            const layer = canvasState.selectedLayers[0];
            const targetPage = parseInt(pageJumpInput.value, 10);
            if (isNaN(targetPage) || targetPage < 1 || targetPage > layer.numPages || targetPage === layer.currentPage) {
                hidePageJumpPopup();
                return;
            }

            const before = utils.cloneLayersForAction([layer]);
            if (canvasState.tileManager) canvasState.tileManager.invalidateLayer(layer);

            layer.currentPage = targetPage;
            if (!layer.renderedPages.has(targetPage)) {
                await utils.renderPdfPageToCanvas(layer, targetPage);
            }

            if (canvasState.tileManager) canvasState.tileManager.invalidateLayer(layer);
            const after = utils.cloneLayersForAction([layer]);

            commitChange({ type: 'update', before, after });
            redraw();
            canvasState.updateFloatingToolbar();
            hidePageJumpPopup();
        }

        pageIndicatorBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (pageJumpGroup.style.display === 'flex') {
                hidePageJumpPopup();
            } else {
                showPageJumpPopup();
            }
        });

        pageJumpConfirm.addEventListener('click', (e) => {
            e.stopPropagation();
            jumpToPage();
        });

        pageJumpInput.addEventListener('keydown', (e) => {
            e.stopPropagation();
            if (e.key === 'Enter') jumpToPage();
            if (e.key === 'Escape') hidePageJumpPopup();
        });

        pageJumpInput.addEventListener('mousedown', (e) => e.stopPropagation());
        pageJumpInput.addEventListener('click', (e) => e.stopPropagation());

        // Close popup on outside click
        document.addEventListener('click', (e) => {
            if (!pageJumpGroup.contains(e.target) && e.target !== pageIndicatorBtn && pageJumpGroup.style.display === 'flex') {
                hidePageJumpPopup();
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
        const proportionalScaleToggle = document.getElementById('proportional-scale-toggle');
        const transparencyToggle = document.getElementById('transparency-toggle');
        const animationsToggle = document.getElementById('animations-toggle');

        function applyAndSaveSettings() {
            const theme = selectedTheme;
            const backgroundStyle = bgDropdown.getValue();
            const snappingMode = snapDropdown.getValue();
            const smoothing = smoothingSlider.value;
            const proportionalScale = proportionalScaleToggle.checked;
            const transparencyDisabled = transparencyToggle.checked;
            const animationsDisabled = animationsToggle.checked;

            document.body.classList.toggle('dark-theme', theme === 'dark');
            document.body.classList.toggle('no-transparency', transparencyDisabled);
            document.body.classList.toggle('no-animations', animationsDisabled);

            localStorage.setItem('boardTheme', theme);
            localStorage.setItem('boardBackgroundStyle', backgroundStyle);
            localStorage.setItem('boardSnappingMode', snappingMode);
            localStorage.setItem('boardSmoothing', smoothing);
            localStorage.setItem('boardProportionalScale', proportionalScale);
            localStorage.setItem('boardTransparencyDisabled', transparencyDisabled);
            localStorage.setItem('boardAnimationsDisabled', animationsDisabled);

            if (canvasState) {
                canvasState.smoothingAmount = parseInt(smoothing, 10);
                canvasState.snappingMode = snappingMode;
                canvasState.proportionalScale = proportionalScale;
            }
            redraw();
        }

        function loadSettings() {
            const savedTheme = localStorage.getItem('boardTheme') || 'light';
            const savedStyle = localStorage.getItem('boardBackgroundStyle') || 'grid';
            const savedSnapping = localStorage.getItem('boardSnappingMode') || 'auto';
            const savedSmoothing = localStorage.getItem('boardSmoothing') || '0';
            const savedProportional = localStorage.getItem('boardProportionalScale') !== 'false'; // Default true
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
            proportionalScaleToggle.checked = savedProportional;
            transparencyToggle.checked = savedTransparency;
            animationsToggle.checked = savedAnimations;

            document.body.classList.toggle('dark-theme', savedTheme === 'dark');
            document.body.classList.toggle('no-transparency', savedTransparency);
            document.body.classList.toggle('no-animations', savedAnimations);

            if (canvasState) {
                canvasState.smoothingAmount = parseInt(savedSmoothing, 10);
                canvasState.snappingMode = savedSnapping;
                canvasState.proportionalScale = savedProportional;
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

});
// --- END OF FILE js/main.js ---