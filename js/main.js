// --- START OF FILE js/main.js ---

import { initializeCanvas } from './canvas.js?v=1.4.19';
import { initializeToolbar } from './toolbar.js?v=1.4.19';
import { getEditorTextarea } from './text.js?v=1.4.19';
import { redrawCanvas, drawBackground, drawLoadingPlaceholders, drawRulers, drawSelectionBox } from './renderer.js?v=1.4.19';
import * as history from './history.js?v=1.4.19';
import { initializeEventListeners, copySelectionToClipboard, pasteFromClipboard } from './events.js?v=1.4.19';
import { initializeFileHandlers } from './file.js?v=1.4.19';
import * as utils from './utils.js?v=1.4.19';
import { mediaCache } from './utils.js?v=1.4.19';
import { loadStateFromDB } from './persist.js?v=1.4.19';
import * as textTool from './text.js?v=1.4.19';
import { updateCursor, loadIconCursors } from './ui.js?v=1.4.19';
import helpContent from './help-content.js?v=1.4.19';
import { StickerApp, syncStickersWithCanvas } from './sticker.js?v=1.4.19';
import { getBoundingBox } from './geometry.js?v=1.4.19';
import { getPageLayout, orderFilledPages, getPageKey, getPageAt, clampNotebookView } from './pages.js?v=1.4.19';
import * as formulaLayer from './formulaLayer.js?v=1.4.19';
import { openMathEditor } from './mathEditor.js?v=1.4.19';

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

    let historyOperationPromise = Promise.resolve();

    function performUndo() {
        historyOperationPromise = historyOperationPromise.then(async () => {
            const { layers: newLayers, selectedIds } = history.undo(canvasState.layers);
            if (newLayers) {
                canvasState.layers = await utils.rehydrateLayers(newLayers);
                canvasState.selectedLayers = canvasState.layers.filter(l => selectedIds.includes(l.id));

                // Rebuild grid on undo
                canvasState.spatialGrid = utils.buildSpatialGrid(canvasState.layers);

                if (canvasState.tileManager) canvasState.tileManager.clear();
                if (canvasState.layerBBoxCache) canvasState.layerBBoxCache.clear();

                if (window.stickerApp) {
                    window.stickerApp.syncStickersAndLinks(canvasState.layers);
                }

                requestAnimationFrame(() => {
                    redraw();
                    updateUndoRedoButtons();
                    updateObjectCounter();
                    canvasState.updateFloatingToolbar();
                });
            }
        });
    }

    function performRedo() {
        historyOperationPromise = historyOperationPromise.then(async () => {
            const { layers: newLayers, selectedIds } = history.redo(canvasState.layers);
            if (newLayers) {
                canvasState.layers = await utils.rehydrateLayers(newLayers);
                canvasState.selectedLayers = canvasState.layers.filter(l => selectedIds.includes(l.id));

                // Rebuild grid on redo
                canvasState.spatialGrid = utils.buildSpatialGrid(canvasState.layers);

                if (canvasState.tileManager) canvasState.tileManager.clear();
                if (canvasState.layerBBoxCache) canvasState.layerBBoxCache.clear();

                if (window.stickerApp) {
                    window.stickerApp.syncStickersAndLinks(canvasState.layers);
                }

                requestAnimationFrame(() => {
                    redraw();
                    updateUndoRedoButtons();
                    updateObjectCounter();
                    canvasState.updateFloatingToolbar();
                });
            }
        });
    }

    function performDeleteSelected() {
        if (canvasState.selectedLayers.length > 0) {
            // Добавляем дочерние элементы PDF (рисунки, тексты) к удалению
            let allLayersToDelete = new Set();
            canvasState.selectedLayers.forEach(l => {
                if (l.id !== canvasState.editingAnnotationsLayerId) {
                    allLayersToDelete.add(l);
                }
                if (l.type === 'pdf' || l.type === 'image' || l.type === 'sticker') {
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

            canvasState.layers = canvasState.layers.filter(layer => !idsToDelete.has(layer.id));
            canvasState.selectedLayers = [];

            commitChange({
                type: 'deletion',
                before: layersToDelete,
                after: [],
            });

            if (window.stickerApp) {
                window.stickerApp.syncStickersAndLinks(canvasState.layers);
            }

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
        const overlayCanvas = document.getElementById('overlayCanvas');

        [backgroundCanvas, drawingCanvas, interactionCanvas, cacheCanvas, overlayCanvas].forEach(c => {
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

    let pageNavPages = [];
    let pageNavIndex = 0;

    function reflowToNotebook() {
        if (!canvasState || canvasState.canvasMode !== 'notebook' || canvasState._notebookReflowed) return;
        const layout = getPageLayout(canvasState);
        const pages = getFilledPagesForNavigator();
        if (pages.length === 0) {
            canvasState._notebookReflowed = true;
            return;
        }

        // Каждая заполненная страница из двумерной сетки получает свой
        // вертикальный лист. Объекты этой страницы сдвигаются на новый лист.
        const targets = new Map();
        pages.forEach((page, index) => {
            targets.set(getPageKey(page.col, page.row), index * layout.height);
        });
        const layerOffsets = new Map();

        const offsetForBox = (box) => {
            const source = getPageAt({ x: box.x + box.width / 2, y: box.y + box.height / 2 }, layout);
            if (!source) return null;
            const targetY = targets.get(getPageKey(source.col, source.row));
            if (targetY === undefined) return null;
            return { dx: -source.x, dy: targetY - source.y };
        };

        (canvasState.layers || []).forEach(layer => {
            if (layer.isEditing) return;
            const box = getBoundingBox(layer);
            if (!box) return;
            const offset = offsetForBox(box);
            if (!offset || (!offset.dx && !offset.dy)) return;
            utils.translateLayer(layer, offset.dx, offset.dy);
            layerOffsets.set(layer.id, offset);
        });

        if (window.stickerApp && Array.isArray(window.stickerApp.stickers)) {
            window.stickerApp.stickers.forEach(s => {
                const offset = layerOffsets.get(s.id);
                if (!offset) return;
                s.x += offset.dx;
                s.y += offset.dy;
                if (s.element) {
                    s.element.style.left = `${s.x}px`;
                    s.element.style.top = `${s.y}px`;
                }
            });
        }

        if (canvasState.tileManager) canvasState.tileManager.clear();
        if (canvasState.spatialGrid) canvasState.spatialGrid = utils.buildSpatialGrid(canvasState.layers);
        if (canvasState.layerBBoxCache) canvasState.layerBBoxCache.clear();
        canvasState._notebookReflowed = true;
    }

    function getFilledPagesForNavigator() {
        const boxes = [];
        (canvasState.layers || []).forEach(layer => {
            if (layer.isEditing) return;
            const box = getBoundingBox(layer);
            if (box) boxes.push(box);
        });
        if (window.stickerApp && Array.isArray(window.stickerApp.stickers)) {
            window.stickerApp.stickers.forEach(s => boxes.push({ x: s.x, y: s.y, width: s.w, height: s.h }));
        }
        return orderFilledPages(boxes, getPageLayout(canvasState));
    }

    function centerNotebookPage(page, fit = true) {
        if (!canvasState || canvasState.canvasMode !== 'notebook') return;
        const dpr = window.devicePixelRatio || 1;
        const viewW = canvasState.canvas.width / dpr;
        const viewH = canvasState.canvas.height / dpr;
        let zoom = canvasState.zoom;
        if (fit) {
            const fitZoom = Math.min((viewW - 60) / page.width, (viewH - 150) / page.height);
            zoom = Math.max(0.2, Math.min(1.8, fitZoom));
        }
        canvasState.zoom = zoom;
        canvasState.panX = viewW / 2 - (page.x + page.width / 2) * zoom;
        canvasState.panY = viewH / 2 - (page.y + page.height / 2) * zoom;
        if (canvasState.saveViewState) canvasState.saveViewState();
        redraw();
    }

    function updatePageNavigator() {
        const nav = document.getElementById('page-navigator');
        if (!nav || !canvasState) return;
        if (canvasState.canvasMode !== 'notebook') {
            nav.classList.add('hidden');
            return;
        }
        pageNavPages = getFilledPagesForNavigator();
        const dpr = window.devicePixelRatio || 1;
        const viewW = canvasState.canvas.width / dpr;
        const viewH = canvasState.canvas.height / dpr;
        const center = {
            x: (viewW / 2 - canvasState.panX) / canvasState.zoom,
            y: (viewH / 2 - canvasState.panY) / canvasState.zoom
        };
        let idx = pageNavPages.findIndex(p =>
            center.x >= p.x && center.x <= p.x + p.width &&
            center.y >= p.y && center.y <= p.y + p.height
        );
        if (idx === -1 && pageNavPages.length > 0) {
            idx = 0;
            let best = Infinity;
            pageNavPages.forEach((p, i) => {
                const dx = Math.max(p.x - center.x, 0, center.x - (p.x + p.width));
                const dy = Math.max(p.y - center.y, 0, center.y - (p.y + p.height));
                const dist = Math.hypot(dx, dy);
                if (dist < best) { best = dist; idx = i; }
            });
        }
        pageNavIndex = Math.max(0, idx);
        const indicator = document.getElementById('pageIndicator');
        if (indicator) {
            indicator.textContent = pageNavPages.length
                ? `${pageNavIndex + 1} / ${pageNavPages.length}`
                : '0 / 0';
        }
        nav.classList.remove('hidden');
        const prev = document.getElementById('pagePrevBtn');
        const next = document.getElementById('pageNextBtn');
        if (prev) prev.disabled = pageNavPages.length === 0;
        if (next) next.disabled = pageNavPages.length === 0;
    }

    function ensureNotebookPageVisible() {
        if (!canvasState || canvasState.canvasMode !== 'notebook') return;
        const pages = getFilledPagesForNavigator();
        if (pages.length === 0) return;
        const dpr = window.devicePixelRatio || 1;
        const viewW = canvasState.canvas.width / dpr;
        const viewH = canvasState.canvas.height / dpr;
        const left = -canvasState.panX / canvasState.zoom;
        const right = (viewW - canvasState.panX) / canvasState.zoom;
        const top = -canvasState.panY / canvasState.zoom;
        const bottom = (viewH - canvasState.panY) / canvasState.zoom;
        const visible = pages.some(p =>
            p.x < right && p.x + p.width > left &&
            p.y < bottom && p.y + p.height > top
        );
        if (!visible) centerNotebookPage(pages[0]);
    }

    function initializePageNavigator() {
        const first = document.getElementById('pageFirstBtn');
        const prev = document.getElementById('pagePrevBtn');
        const next = document.getElementById('pageNextBtn');
        const fit = document.getElementById('pageFitBtn');

        if (first) first.addEventListener('click', () => {
            if (pageNavPages.length) centerNotebookPage(pageNavPages[0]);
        });
        if (prev) prev.addEventListener('click', () => {
            if (!pageNavPages.length) return;
            pageNavIndex = (pageNavIndex - 1 + pageNavPages.length) % pageNavPages.length;
            centerNotebookPage(pageNavPages[pageNavIndex]);
        });
        if (next) next.addEventListener('click', () => {
            if (!pageNavPages.length) return;
            pageNavIndex = (pageNavIndex + 1) % pageNavPages.length;
            centerNotebookPage(pageNavPages[pageNavIndex]);
        });
        if (fit) fit.addEventListener('click', () => {
            if (pageNavPages.length) centerNotebookPage(pageNavPages[pageNavIndex]);
        });
    }

    const redraw = () => {
        if (canvasState.canvasMode === 'notebook') {
            const dpr = window.devicePixelRatio || 1;
            clampNotebookView(canvasState, canvasState.canvas.width / dpr, canvasState.canvas.height / dpr);
        }
        redrawCanvas(canvasState);
        drawBackground(backgroundCanvas, canvasState);
        syncStickersWithCanvas(canvasState);
        if (window.stickerApp) {
            window.stickerApp.stickers.forEach(s => s.renderDrawing());
            window.stickerApp.updateToolbarPosition();
        }
    };

    function updateSubToolbarVisibility() {
        // ... (код функции без изменений) ...
        if (!canvasState) return;
        syncStickersWithCanvas(canvasState);

        const drawingSubToolbar = document.getElementById('drawingSubToolbar');
        const hasSelection = canvasState.selectedLayers.length > 0;
        const activeTool = canvasState.activeTool;

        const shapes2DOrder = ['rect', 'ellipse', 'line', 'curve', 'parallelogram', 'triangle', 'trapezoid', 'rhombus'];
        const shapes3DOrder = ['sphere', 'cone', 'parallelepiped', 'pyramid', 'frustum', 'truncated-pyramid', 'truncated-sphere'];
        const drawableTools = ['brush', 'smart-brush', 'eraser', 'laser', ...shapes2DOrder, ...shapes3DOrder];

        const nonDrawableSelectionTypes = ['image', 'pdf', 'text', 'sticker'];
        const selectionHasDrawableObject = hasSelection && canvasState.selectedLayers.some(l => !nonDrawableSelectionTypes.includes(l.type));
        const isDrawingContext = drawableTools.includes(activeTool) || selectionHasDrawableObject;

        const isMobileDevice = window.matchMedia('(max-width: 768px)').matches || document.body.classList.contains('force-mobile-ui');
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
                if (fontSizeInput && document.activeElement !== fontSizeInput) {
                    fontSizeInput.value = Math.round(layer.fontSize || 30);
                }

                const colorBtn = document.getElementById('mobileTextColorBtn');
                if (colorBtn) {
                    const circle = colorBtn.querySelector('circle');
                    if (circle) circle.setAttribute('fill', layer.color || '#000000');
                }

                const format = canvasState.isEditingText && textTool.getFormatState
                    ? textTool.getFormatState()
                    : null;
                const isBold = format ? format.bold : layer.fontWeight === 'bold';
                const isItalic = format ? format.italic : layer.fontStyle === 'italic';
                const isUnderline = format ? format.underline : layer.textDecoration === 'underline';
                const isStrike = format ? format.strikeThrough : layer.textDecoration === 'line-through';
                const isSuper = format ? format.superscript : !!(layer.content && layer.content.includes('<sup'));
                const isSub = format ? format.subscript : !!(layer.content && layer.content.includes('<sub'));

                const boldBtn = document.getElementById('mobileTextBold');
                if (boldBtn) boldBtn.classList.toggle('active', isBold);
                const italicBtn = document.getElementById('mobileTextItalic');
                if (italicBtn) italicBtn.classList.toggle('active', isItalic);
                const underlineBtn = document.getElementById('mobileTextUnderline');
                if (underlineBtn) underlineBtn.classList.toggle('active', isUnderline);
                const strikeBtn = document.getElementById('mobileTextStrike');
                if (strikeBtn) strikeBtn.classList.toggle('active', isStrike);
                const superBtn = document.getElementById('mobileTextSuperscript');
                if (superBtn) superBtn.classList.toggle('active', isSuper);
                const subBtn = document.getElementById('mobileTextSubscript');
                if (subBtn) subBtn.classList.toggle('active', isSub);

                const styleBtn = document.getElementById('mobileTextStyleBtn');
                if (styleBtn) {
                    styleBtn.classList.toggle('active', isBold || isItalic || isUnderline || isStrike);
                }
                const indexBtn = document.getElementById('mobileTextIndexBtn');
                if (indexBtn) {
                    indexBtn.classList.toggle('active', isSuper || isSub);
                }

                const align = format
                    ? (format.alignCenter ? 'center' : format.alignRight ? 'right' : 'left')
                    : (layer.align || 'left');
                const alignContainer = document.getElementById('mobile-text-align-container');
                if (alignContainer) {
                    alignContainer.querySelectorAll('[data-action^="align-"]').forEach(btn => {
                        btn.classList.toggle('active', btn.dataset.action === `align-${align}`);
                    });
                }
                const alignTrigger = document.getElementById('mobileTextAlignBtn');
                if (alignTrigger) {
                    const img = alignTrigger.querySelector('img');
                    if (img) {
                        img.src = align === 'center'
                            ? 'icons_bord/icon-center.webp'
                            : align === 'right'
                                ? 'icons_bord/icon-rightravn.webp'
                                : 'icons_bord/icon-leftravn.webp';
                    }
                    alignTrigger.classList.add('active');
                }

                const isBullet = format ? format.bulletList : /<ul[\s>]/i.test(layer.content || '');
                const isNumber = format ? format.numberList : /<ol[\s>]/i.test(layer.content || '');
                document.querySelectorAll('#mobileTextListOptions [data-action]').forEach(btn => {
                    btn.classList.toggle('active',
                        btn.dataset.action === 'list-bullet' ? isBullet :
                        btn.dataset.action === 'list-number' ? isNumber : false);
                });
                const listBtn = document.getElementById('mobileTextListBtn');
                if (listBtn) listBtn.classList.toggle('active', isBullet || isNumber);
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

        const sizeEditorWrapper = document.querySelector('.size-editor-wrapper');
        const mobileWidthContainer = document.getElementById('mobile-width-container');

        if (activeTool === 'eraser') {
            if (colorPalette) colorPalette.style.display = 'none';
            if (lineStyleContainer) lineStyleContainer.style.display = 'none';
            if (mobileColorContainer) mobileColorContainer.style.display = 'none';
            if (mobileStyleContainer) mobileStyleContainer.style.display = 'none';
            if (desktopFillColorContainer) desktopFillColorContainer.style.display = 'none';
            if (mobileFillColorContainer) mobileFillColorContainer.style.display = 'none';
            if (sizeEditorWrapper) sizeEditorWrapper.style.display = '';
            if (mobileWidthContainer) mobileWidthContainer.style.display = '';
        } else if (activeTool === 'laser') {
            if (colorPalette) colorPalette.style.display = '';
            if (lineStyleContainer) lineStyleContainer.style.display = 'none';
            if (mobileColorContainer) mobileColorContainer.style.display = '';
            if (mobileStyleContainer) mobileStyleContainer.style.display = 'none';
            if (desktopFillColorContainer) desktopFillColorContainer.style.display = 'none';
            if (mobileFillColorContainer) mobileFillColorContainer.style.display = 'none';
            if (sizeEditorWrapper) sizeEditorWrapper.style.display = 'none';
            if (mobileWidthContainer) mobileWidthContainer.style.display = 'none';
        } else {
            if (colorPalette) colorPalette.style.display = '';
            if (lineStyleContainer) lineStyleContainer.style.display = '';
            if (mobileColorContainer) mobileColorContainer.style.display = '';
            if (mobileStyleContainer) mobileStyleContainer.style.display = '';
            if (sizeEditorWrapper) sizeEditorWrapper.style.display = '';
            if (mobileWidthContainer) mobileWidthContainer.style.display = '';

            if (shouldShowFillPalette) {
                if (desktopFillColorContainer) desktopFillColorContainer.style.display = '';
                if (mobileFillColorContainer) mobileFillColorContainer.style.display = '';
            } else {
                if (desktopFillColorContainer) desktopFillColorContainer.style.display = 'none';
                if (mobileFillColorContainer) mobileFillColorContainer.style.display = 'none';
            }
        }

        // Sync smart brush toggle visibility and state
        const isBrushTool = activeTool === 'brush' || activeTool === 'smart-brush';
        const desktopSmartToggle = document.getElementById('desktopSmartBrushToggle');
        const mobileSmartToggle = document.getElementById('mobileSmartBrushToggle');
        const desktopSmartWrapper = document.getElementById('desktopSmartBrushWrapper');
        if (desktopSmartToggle) {
            desktopSmartToggle.classList.toggle('active', canvasState.smartBrushEnabled);
            if (desktopSmartWrapper) desktopSmartWrapper.style.display = isBrushTool ? '' : 'none';
        }
        if (mobileSmartToggle) {
            mobileSmartToggle.classList.toggle('active', canvasState.smartBrushEnabled);
            mobileSmartToggle.style.display = isBrushTool ? '' : 'none';
        }
    }

    async function loadState(projectData = null) {
        let loadedData = null;

        if (projectData) {
            try {
                loadedData = JSON.parse(projectData);
            } catch (e) {
                console.error("Не удалось разобрать данные проекта:", e);
                alert('Не удалось открыть файл: повреждённый формат проекта. Текущая доска не изменена.');
                return;
            }

            if (!loadedData || typeof loadedData !== 'object' || !Array.isArray(loadedData.layers)) {
                alert('Файл не похож на проект доски: в нём нет данных слоёв. Текущая доска не изменена.');
                return;
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
                const viewState = loadedData.viewState || {};

                canvasState.viewState = viewState;

                canvasState.panX = viewState.panX || 0;
                canvasState.panY = viewState.panY || 0;
                canvasState.zoom = viewState.zoom || 1;
                canvasState.rulers = viewState.rulers || [];
                canvasState.canvasMode = viewState.canvasMode || localStorage.getItem('boardCanvasMode') || 'infinite';
                canvasState.pageFormat = viewState.pageFormat || localStorage.getItem('boardPageFormat') || 'A4';
                canvasState.pageOrientation = viewState.pageOrientation || localStorage.getItem('boardPageOrientation') || 'portrait';
                canvasState.showPageGuides = viewState.showPageGuides !== false && localStorage.getItem('boardShowPageGuides') !== 'false';
                canvasState._notebookReflowed = false;

                const rehydratePromise = utils.rehydrateLayers(layersToLoad);
                liveLayers = await Promise.race([
                    rehydratePromise,
                    new Promise(resolve => setTimeout(() => resolve(layersToLoad), 8000))
                ]);
            } catch (e) {
                console.error("Не удалось загрузить и обработать состояние:", e);
                liveLayers = [];
            }
        } else {
            canvasState.viewState = {};
        }

        canvasState.layers = liveLayers;

        // Формулы хранятся как дерево, картинка-кэш пересобирается при загрузке.
        formulaLayer.ensureFormulaImages(canvasState);

        if (canvasState.tileManager) {
            canvasState.tileManager.clear();
        }

        // --- ИЗМЕНЕНИЕ: Инициализация Spatial Grid при загрузке ---
        canvasState.spatialGrid = utils.buildSpatialGrid(liveLayers);
        // -----------------------------------------------------------
        if (canvasState.canvasMode === 'notebook') {
            canvasState._notebookReflowed = false;
            reflowToNotebook();
        }

        if (window.stickerApp) {
            window.stickerApp.loadStickersAndLinks(canvasState.layers, loadedData?.viewState?.stickerLinks);
        }

        history.initHistory(canvasState, liveLayers);
        redraw();
        if (canvasState.canvasMode === 'notebook') ensureNotebookPageVisible();
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

        setTimeout(() => {
            if (typeof showCanvasOnboarding === 'function') showCanvasOnboarding();
        }, 500);
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
    initializeFloatingFormulaToolbar();
    initializeFloatingPlotToolbar();
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
    window.canvasState = canvasState;
    window.stickerApp = new StickerApp(canvasState);

    const addStickerBtn = document.getElementById('addStickerBtn');
    if (addStickerBtn) {
        addStickerBtn.addEventListener('click', () => {
            if (canvasState.selectedLayers.length > 0) {
                canvasState.selectedLayers = [];
                canvasState.selectedCurveNodeIndex = null;
                redraw();
                canvasState.updateFloatingToolbar();
            }
            window.stickerApp.addSticker('text');
        });
    }
    
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

    let laserAnimationFrameId = null;
    canvasState.startLaserPointerLoop = () => {
        if (laserAnimationFrameId) return; // already running

        const loop = () => {
            const hasLaserTool = canvasState.activeTool === 'laser';
            const hasLaserPointer = hasLaserTool && !!canvasState.laserPointerPos;
            const hasLaserStrokes = canvasState.laserStrokes && canvasState.laserStrokes.some(s => s.points && s.points.length > 0);

            if (hasLaserPointer || hasLaserStrokes) {
                const iCanvas = canvasState.overlayCanvas;
                const iCtx = canvasState.oCtx;
                if (!iCanvas || !iCtx) {
                    laserAnimationFrameId = null;
                    return;
                }
                const dpr = window.devicePixelRatio || 1;

                iCtx.setTransform(1, 0, 0, 1, 0, 0);
                iCtx.clearRect(0, 0, iCanvas.width, iCanvas.height);

                iCtx.save();
                iCtx.scale(dpr, dpr);
                iCtx.translate(canvasState.panX, canvasState.panY);
                iCtx.scale(canvasState.zoom, canvasState.zoom);

                // Лазер живёт на том же слое, что линейки и рамка выделения,
                // поэтому перерисовываем их каждый кадр, чтобы не потерять.
                drawRulers(iCtx, canvasState);
                drawSelectionBox(iCtx, canvasState.selectedLayers, canvasState);

                const now = Date.now();
                const HOLD_MS = 800;
                const FADE_MS = 500;
                const MAX_AGE = HOLD_MS + FADE_MS;

                const alphaForTime = (time) => {
                    const age = now - time;
                    if (age <= HOLD_MS) return 1;
                    return Math.max(0, 1 - (age - HOLD_MS) / FADE_MS);
                };

                // Старые штрихи не стираем сразу: даём им полежать и плавно растаять.
                if (canvasState.laserStrokes) {
                    canvasState.laserStrokes = canvasState.laserStrokes.filter(stroke => {
                        stroke.points = (stroke.points || []).filter(p => now - p.time < MAX_AGE);
                        return stroke.points.length > 0;
                    });
                }

                const baseLineWidth = 2.5 / canvasState.zoom;
                const laserColor = canvasState.activeColor || '#ef4444';

                for (const stroke of canvasState.laserStrokes || []) {
                    const points = stroke.points;
                    if (!points || points.length < 2) continue;

                    // Лёгкое сглаживание: убирает дрожание при быстром движении,
                    // особенно заметное на внешней стороне поворота.
                    const smooth = points.map((p, i) => {
                        if (i === 0 || i === points.length - 1) return p;
                        return {
                            x: (points[i - 1].x + 2 * p.x + points[i + 1].x) / 4,
                            y: (points[i - 1].y + 2 * p.y + points[i + 1].y) / 4,
                            time: p.time
                        };
                    });

                    iCtx.lineCap = 'round';
                    iCtx.lineJoin = 'round';
                    iCtx.strokeStyle = laserColor;

                    for (let i = 0; i < smooth.length - 1; i++) {
                        const p0 = smooth[i];
                        const p1 = smooth[i + 1];
                        const alpha = Math.min(alphaForTime(p0.time), alphaForTime(p1.time));
                        if (alpha <= 0) continue;

                        const prev = i > 0 ? smooth[i - 1] : p0;
                        const start = { x: (prev.x + p0.x) / 2, y: (prev.y + p0.y) / 2 };
                        const end = (i === smooth.length - 2)
                            ? p1
                            : { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 };

                        // Мягкое свечение под основной линией.
                        iCtx.beginPath();
                        iCtx.moveTo(start.x, start.y);
                        iCtx.quadraticCurveTo(p0.x, p0.y, end.x, end.y);
                        iCtx.globalAlpha = alpha * 0.10;
                        iCtx.lineWidth = baseLineWidth * 1.8;
                        iCtx.stroke();

                        iCtx.beginPath();
                        iCtx.moveTo(start.x, start.y);
                        iCtx.quadraticCurveTo(p0.x, p0.y, end.x, end.y);
                        iCtx.globalAlpha = alpha;
                        iCtx.lineWidth = baseLineWidth;
                        iCtx.stroke();
                    }
                }
                iCtx.globalAlpha = 1.0;

                // Draw pointer dot
                if (canvasState.laserPointerPos && hasLaserTool) {
                    const radius = 4 / canvasState.zoom;
                    const glowRadius = 6 / canvasState.zoom;

                    iCtx.beginPath();
                    iCtx.arc(canvasState.laserPointerPos.x, canvasState.laserPointerPos.y, radius, 0, Math.PI * 2);
                    iCtx.fillStyle = canvasState.activeColor || '#ef4444';
                    iCtx.fill();

                    iCtx.beginPath();
                    iCtx.arc(canvasState.laserPointerPos.x, canvasState.laserPointerPos.y, glowRadius, 0, Math.PI * 2);
                    iCtx.save();
                    iCtx.globalAlpha = 0.3;
                    iCtx.fillStyle = canvasState.activeColor || '#ef4444';
                    iCtx.fill();
                    iCtx.restore();
                }

                iCtx.restore();

                laserAnimationFrameId = requestAnimationFrame(loop);
            } else {
                // Лазер закончился — очищаем overlay и возвращаем линейки/рамку.
                const iCanvas = canvasState.overlayCanvas;
                const iCtx = canvasState.oCtx;
                if (iCtx && iCanvas) {
                    iCtx.setTransform(1, 0, 0, 1, 0, 0);
                    iCtx.clearRect(0, 0, iCanvas.width, iCanvas.height);
                }
                laserAnimationFrameId = null;
                if (canvasState.redraw) canvasState.redraw();
            }
        };
        loop();
    };

    history.setCanvasStateRef(canvasState);
    canvasState.redraw = redraw;
    canvasState.saveViewState = debouncedSaveViewState;

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
    canvasState.showCanvasOnboarding = showCanvasOnboarding;
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
    updateCursor(canvasState, null);
    // Загружаем иконку кисти как курсор (асинхронно, как только загрузится — применяется автоматически)
    loadIconCursors(canvasState);

    // ... (остальные функции initializeFloatingTextToolbar и т.д. без изменений) ...
    // Формула в тексте: окно ввода, затем вставка в каретку (или отдельным объектом).
    function openTextFormulaDialog() {
        // Из режима текста график не строим: окно закрывалось бы вместе с
        // редактированием. График можно построить потом кнопкой у формулы.
        openMathEditor({
            title: 'Формула в тексте',
            hint: 'Формула вставится в текст на место курсора.',
            showGraph: false,
            onSubmit: ({ math }) => {
                const inserted = textTool.insertFormula(math, canvasState);
                if (!inserted) {
                    const dpr = window.devicePixelRatio || 1;
                    const cx = ((canvasState.canvas.width / dpr) / 2 - canvasState.panX) / canvasState.zoom;
                    const cy = ((canvasState.canvas.height / dpr) / 2 - canvasState.panY) / canvasState.zoom;
                    formulaLayer.insertFormulaLayer(canvasState, math, { x: cx, y: cy });
                }
            },
        });
    }

    function initializeFloatingTextToolbar() {
        // ... (код функции) ...
        const toolbar = document.getElementById('floating-text-toolbar');
        const floatingPalette = document.getElementById('floatingColorPalette');
        const colorPicker = document.getElementById('floating-color-picker');
        
        const floatingBgPalette = document.getElementById('floatingBgColorPalette');
        const bgColorPicker = document.getElementById('floating-bg-color-picker');

        const floatingRulerPalette = document.getElementById('floatingRulerColorPalette');
        const rulerColorPicker = document.getElementById('floating-ruler-color-picker');

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
            if (floatingRulerPalette) {
                floatingRulerPalette.innerHTML = mainPalette.innerHTML;
                floatingRulerPalette.querySelectorAll('.color-dot').forEach(dot => {
                    dot.dataset.rulerColor = dot.dataset.color;
                });
            }
        }

        const styleDropdown = document.getElementById('style-dropdown-container');
        const alignDropdown = document.getElementById('align-dropdown-container');
        const fontFamilyDropdown = document.getElementById('font-family-dropdown-container');
        const listDropdown = document.getElementById('list-dropdown-container');
        const indexDropdown = document.getElementById('index-dropdown-container');
        const dropdowns = [styleDropdown, alignDropdown, fontFamilyDropdown, listDropdown, colorPicker, bgColorPicker, indexDropdown, rulerColorPicker].filter(Boolean);

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
                        if (canvasState.tileManager) canvasState.tileManager.invalidateLayer(layer);
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
                let pdfOrImage = canvasState.selectedLayers.find(l => l.type === 'pdf' || l.type === 'image' || l.type === 'sticker');
                if (!pdfOrImage && canvasState.editingAnnotationsLayerId) {
                    pdfOrImage = canvasState.layers.find(l => l.id === canvasState.editingAnnotationsLayerId);
                }
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

            if (action === 'insert-formula') {
                e.preventDefault();
                openTextFormulaDialog();
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
                        case 'font-strike': layer.textDecoration = layer.textDecoration === 'line-through' ? 'none' : 'line-through'; break;
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
                    const newColor = colorDot.dataset.textColor;
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
        const applyFontSize = (commit = false) => {
            const size = parseInt(fontSizeInput.value, 10);
            if (!size || size < 1 || size > 1000) return;
            if (canvasState.isEditingText) {
                // Пока набирают число — не забираем фокус у поля ввода.
                if (commit) {
                    textTool.setFontSize(size);
                } else {
                    textTool.setFontSizeGlobal(size);
                }
                redraw();
                canvasState.updateFloatingToolbar();
            } else {
                applyChange(layer => {
                    if (!layer) return;
                    layer.fontSize = size;
                });
            }
        };
        fontSizeInput.addEventListener('input', () => applyFontSize(false));
        fontSizeInput.addEventListener('change', () => applyFontSize(true));
        fontSizeInput.addEventListener('keydown', (e) => {
            e.stopPropagation();
            if (e.key === 'Enter') {
                e.preventDefault();
                fontSizeInput.blur();
            }
        });
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
                utils.createTextImage(layer).then(img => {
                    layer.cachedImage = img;
                    if (canvasState.tileManager) canvasState.tileManager.invalidateLayer(layer);
                    redraw();
                });
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

            if (action === 'insert-formula') {
                e.preventDefault();
                openTextFormulaDialog();
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
            // Пересчитываем подсветку кнопок: bold/strike/align/list и т.д.
            updateSubToolbarVisibility();
        });

        // Выбор шрифта
        const applyFontChoice = (fontName) => {
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
        };

        const fontOptions = document.getElementById('mobileTextFontOptions');
        if (fontOptions) {
            fontOptions.addEventListener('pointerup', e => {
                const button = e.target.closest('button[data-font]');
                if (!button) return;
                applyFontChoice(button.dataset.font);
                const fontContainer = document.getElementById('mobile-text-font-container');
                if (fontContainer) fontContainer.classList.remove('active');
            });
        }

        // На телефоне штатный выпадающий список шрифтов оказывается слишком
        // низким и с невидимыми подписями. Открываем отдельную понятную
        // нижнюю панель со списком шрифтов.
        let mobileFontSheet = null;
        let mobileFontBackdrop = null;
        const closeMobileFontSheet = () => {
            if (mobileFontSheet) mobileFontSheet.style.display = 'none';
            if (mobileFontBackdrop) mobileFontBackdrop.style.display = 'none';
        };
        const openMobileFontSheet = () => {
            if (!fontOptions) return;
            if (!mobileFontSheet) {
                mobileFontBackdrop = document.createElement('div');
                mobileFontBackdrop.id = 'mobile-font-backdrop';
                mobileFontBackdrop.addEventListener('pointerdown', (e) => {
                    e.preventDefault();
                    closeMobileFontSheet();
                });

                mobileFontSheet = document.createElement('div');
                mobileFontSheet.id = 'mobile-font-sheet';

                const title = document.createElement('div');
                title.className = 'mobile-font-title';
                title.textContent = 'Выберите шрифт';
                mobileFontSheet.appendChild(title);

                fontOptions.querySelectorAll('button[data-font]').forEach(sourceBtn => {
                    const btn = document.createElement('button');
                    btn.type = 'button';
                    btn.dataset.font = sourceBtn.dataset.font;
                    btn.textContent = sourceBtn.textContent.trim();
                    btn.style.fontFamily = sourceBtn.style.fontFamily;
                    mobileFontSheet.appendChild(btn);
                });

                mobileFontSheet.addEventListener('click', (e) => {
                    const btn = e.target.closest('button[data-font]');
                    if (!btn) return;
                    applyFontChoice(btn.dataset.font);
                    closeMobileFontSheet();
                });

                document.body.appendChild(mobileFontBackdrop);
                document.body.appendChild(mobileFontSheet);
            }

            const toolbar = document.getElementById('mobileTextSubToolbar');
            const rect = toolbar ? toolbar.getBoundingClientRect() : { top: window.innerHeight - 120 };
            const viewportBottom = window.innerHeight;
            mobileFontSheet.style.bottom = `${Math.max(8, viewportBottom - rect.top + 8)}px`;
            mobileFontSheet.style.maxHeight = `${Math.max(160, Math.min(window.innerHeight * 0.52, rect.top - 16))}px`;

            const layer = canvasState && canvasState.selectedLayers && canvasState.selectedLayers[0];
            const currentFamily = layer && layer.fontFamily
                ? String(layer.fontFamily).split(',')[0].replace(/['"]/g, '').trim().toLowerCase()
                : '';
            mobileFontSheet.querySelectorAll('button[data-font]').forEach(btn => {
                const family = String(btn.dataset.font || '').split(',')[0].replace(/['"]/g, '').trim().toLowerCase();
                btn.classList.toggle('active', !!currentFamily && family === currentFamily);
            });

            mobileFontBackdrop.style.display = 'block';
            mobileFontSheet.style.display = 'block';
        };

        const mobileFontBtn = document.getElementById('mobileTextFontBtn');
        if (mobileFontBtn) {
            mobileFontBtn.addEventListener('pointerup', (e) => {
                e.preventDefault();
                e.stopPropagation();
                openMobileFontSheet();
            }, { passive: false });
        }

        // Размер шрифта
        const fontSizeInput = document.getElementById('mobileTextFontSizeInput');
        if (fontSizeInput) {
            const applyMobileFontSize = (commit = false) => {
                const size = parseInt(fontSizeInput.value, 10);
                if (!size || size < 1 || size > 1000) return;
                if (canvasState.isEditingText) {
                    // Пока пользователь набирает цифры, не забираем фокус у поля:
                    // иначе мобильная клавиатура закрывается после каждого символа.
                    if (commit) {
                        textTool.setFontSize(size);
                    } else {
                        textTool.setFontSizeGlobal(size);
                    }
                    redraw();
                    updateSubToolbarVisibility();
                } else {
                    applyTextChange(layer => { if (layer) layer.fontSize = size; });
                }
            };
            fontSizeInput.addEventListener('input', () => applyMobileFontSize(false));
            fontSizeInput.addEventListener('change', () => applyMobileFontSize(true));
            fontSizeInput.addEventListener('mousedown', e => e.stopPropagation());
            fontSizeInput.addEventListener('keydown', (e) => {
                e.stopPropagation();
                if (e.key === 'Enter') {
                    e.preventDefault();
                    fontSizeInput.blur();
                }
            });
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

    // Панель выделенной формулы: изменить, построить график, удалить.
    function initializeFloatingFormulaToolbar() {
        const toolbar = document.getElementById('floating-formula-toolbar');
        if (!toolbar) return;

        toolbar.addEventListener('click', (e) => {
            const button = e.target.closest('button');
            if (!button) return;
            const action = button.dataset.action;

            const layer = (canvasState.selectedLayers.length === 1 && canvasState.selectedLayers[0].type === 'formula')
                ? canvasState.selectedLayers[0]
                : null;
            if (!layer) return;

            if (action === 'edit-formula') {
                formulaLayer.openEditFormulaDialog(canvasState, layer);
                return;
            }

            if (action === 'graph-formula') {
                import('./plotLayer.js?v=1.4.19').then((plot) => {
                    plot.insertPlotFromMath(canvasState, layer.math, {
                        x: layer.x + (layer.width || 200) + 320,
                        y: layer.y + 210,
                    });
                }).catch(() => {});
                return;
            }

            if (action === 'copy') {
                copySelectionToClipboard(canvasState, false);
                return;
            }

            if (action === 'delete') {
                canvasState.layers = canvasState.layers.filter((l) => l.id !== layer.id);
                canvasState.selectedLayers = [];
                if (canvasState.tileManager) canvasState.tileManager.clear();
                if (canvasState.saveState) canvasState.saveState({ type: 'deletion', before: [layer], after: [] });
                if (canvasState.saveViewState) canvasState.saveViewState();
                if (canvasState.updateFloatingToolbar) canvasState.updateFloatingToolbar();
                redraw();
            }
        });
    }

    // Панель выделенного графика: настройки, копирование, удаление.
    function initializeFloatingPlotToolbar() {
        const toolbar = document.getElementById('floating-plot-toolbar');
        if (!toolbar) return;

        toolbar.addEventListener('click', (e) => {
            const button = e.target.closest('button');
            if (!button) return;
            const action = button.dataset.action;

            const layer = (canvasState.selectedLayers.length === 1 && canvasState.selectedLayers[0].type === 'plot')
                ? canvasState.selectedLayers[0]
                : null;
            if (!layer) return;

            if (action === 'plot-settings') {
                import('./plotLayer.js?v=1.4.19').then((plot) => plot.openPlotEditor(canvasState, layer)).catch(() => {});
                return;
            }

            if (action === 'copy') {
                copySelectionToClipboard(canvasState, false);
                return;
            }

            if (action === 'delete') {
                canvasState.layers = canvasState.layers.filter((l) => l.id !== layer.id);
                canvasState.selectedLayers = [];
                if (canvasState.tileManager) canvasState.tileManager.clear();
                if (canvasState.saveState) canvasState.saveState({ type: 'deletion', before: [layer], after: [] });
                if (canvasState.saveViewState) canvasState.saveViewState();
                if (canvasState.updateFloatingToolbar) canvasState.updateFloatingToolbar();
                redraw();
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
                    let pdfOrImage = canvasState.selectedLayers.find(l => l.type === 'pdf' || l.type === 'image' || l.type === 'sticker');
                    if (!pdfOrImage && canvasState.editingAnnotationsLayerId) {
                        pdfOrImage = canvasState.layers.find(l => l.id === canvasState.editingAnnotationsLayerId);
                    }
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

        function getActivePdfLayer() {
            if (canvasState.selectedLayers.length === 1 && canvasState.selectedLayers[0].type === 'pdf') {
                return canvasState.selectedLayers[0];
            } else if (canvasState.editingAnnotationsLayerId) {
                return canvasState.layers.find(l => l.id === canvasState.editingAnnotationsLayerId && l.type === 'pdf');
            }
            return null;
        }

        async function changePage(direction) {
            const layer = getActivePdfLayer();
            if (!layer) return;

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
                let pdfOrImage = canvasState.selectedLayers.find(l => l.type === 'pdf' || l.type === 'image' || l.type === 'sticker');
                if (!pdfOrImage && canvasState.editingAnnotationsLayerId) {
                    pdfOrImage = canvasState.layers.find(l => l.id === canvasState.editingAnnotationsLayerId);
                }
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
            const layer = getActivePdfLayer();
            if (!layer) return;
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
            const layer = getActivePdfLayer();
            if (!layer) return;
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

        let tooltipTimeout = null;
        let activeTarget = null;

        function clearTooltip() {
            if (tooltipTimeout) {
                clearTimeout(tooltipTimeout);
                tooltipTimeout = null;
            }
            tooltip.classList.remove('visible');
        }

        document.body.addEventListener('mouseover', (e) => {
            const target = e.target.closest('[title]');
            if (!target) return;

            if (activeTarget === target) return;
            
            clearTooltip();
            activeTarget = target;

            const titleText = target.getAttribute('title');
            if (!titleText) return;

            target.dataset.originalTitle = titleText;
            target.removeAttribute('title');

            tooltipTimeout = setTimeout(() => {
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
            }, 1200);
        });

        document.body.addEventListener('mouseout', (e) => {
            const target = e.target.closest('[data-original-title]');
            if (target) {
                target.setAttribute('title', target.dataset.originalTitle);
                target.removeAttribute('data-original-title');
            }
            if (target === activeTarget) {
                activeTarget = null;
            }
            clearTooltip();
        });

        document.body.addEventListener('mousedown', () => {
            clearTooltip();
        });

        document.body.addEventListener('pointerdown', () => {
            clearTooltip();
        });
    }

    function initializeHelpModal() {
        const helpBtn = document.getElementById('helpBtn');
        const helpModal = document.getElementById('help-modal');
        const closeHelpBtnTop = document.getElementById('closeHelpBtnTop');
        const helpSearch = document.getElementById('help-search');
        const helpSearchClear = document.getElementById('help-search-clear');

        function openModal() {
            helpModal.classList.remove('hidden');
            helpModal.classList.add('active');
            if (helpSearch) {
                setTimeout(() => helpSearch.focus(), 150);
            }
        }
        function closeModal() {
            helpModal.classList.add('hidden');
            helpModal.classList.remove('active');
            if (helpSearch) {
                helpSearch.value = '';
                performSearch();
            }
        }

        helpBtn.addEventListener('click', (e) => { 
            e.preventDefault(); 
            const settingsMenu = document.getElementById('settingsMenu');
            if (settingsMenu) settingsMenu.classList.remove('visible');
            openModal(); 
        });
        if (closeHelpBtnTop) closeHelpBtnTop.addEventListener('click', closeModal);
        
        helpModal.addEventListener('mousedown', (e) => { 
            if (e.target === helpModal) { closeModal(); } 
        });

        // Dynamically populate help content from helpContent object
        const helpPanelsContainer = document.getElementById('helpPanelsContainer') || (helpModal && helpModal.querySelector('.help-panels'));
        if (helpPanelsContainer && helpContent) {
            const noResultsPanel = document.getElementById('tab-no-results');
            helpPanelsContainer.innerHTML = '';
            Object.keys(helpContent).forEach(key => {
                const panel = document.createElement('div');
                panel.id = key;
                panel.className = 'help-panel' + (key === 'tab-intro' ? ' active' : '');
                if (key !== 'tab-intro') {
                    panel.style.display = 'none';
                }
                panel.innerHTML = helpContent[key];
                helpPanelsContainer.appendChild(panel);
            });
            if (noResultsPanel) {
                noResultsPanel.style.display = 'none';
                noResultsPanel.classList.remove('active');
                helpPanelsContainer.appendChild(noResultsPanel);
            }
        }

        const helpTabs = helpModal.querySelectorAll('.help-tab');
        const helpPanels = helpModal.querySelectorAll('.help-panel');

        // Auto-detect touch screen support to set initial view
        const hasTouch = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0) || (navigator.msMaxTouchPoints > 0);
        let activeDevice = hasTouch ? 'touch' : 'desktop';

        const deviceBtns = helpModal.querySelectorAll('.device-btn');
        deviceBtns.forEach(btn => {
            const btnDevice = btn.getAttribute('data-device');
            btn.classList.toggle('active', btnDevice === activeDevice);
            
            btn.addEventListener('click', () => {
                deviceBtns.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                activeDevice = btn.getAttribute('data-device');
                updateDeviceView();
            });
        });

        function updateDeviceView() {
            const specifics = helpModal.querySelectorAll('.device-specific');
            specifics.forEach(el => {
                const dev = el.getAttribute('data-device');
                if (dev === activeDevice) {
                    el.style.display = '';
                } else {
                    el.style.display = 'none';
                }
            });
        }

        // Apply initial device view
        updateDeviceView();
        
        helpTabs.forEach(tab => {
            tab.addEventListener('click', () => {
                helpTabs.forEach(t => t.classList.remove('active'));
                helpPanels.forEach(p => {
                    p.classList.remove('active');
                    p.style.display = 'none';
                });
                
                tab.classList.add('active');
                const panelId = tab.getAttribute('data-panel');
                const targetPanel = document.getElementById(panelId);
                if (targetPanel) {
                    targetPanel.classList.add('active');
                    targetPanel.style.display = 'block';
                }
            });
        });

        function performSearch() {
            const query = helpSearch.value.toLowerCase().trim();
            const noResultsPanel = document.getElementById('tab-no-results');
            
            if (query === '') {
                if (helpSearchClear) helpSearchClear.classList.add('hidden');
                
                helpTabs.forEach(tab => {
                    tab.style.display = '';
                });
                
                if (noResultsPanel) {
                    noResultsPanel.classList.remove('active');
                    noResultsPanel.style.display = 'none';
                }
                
                const activeTab = helpModal.querySelector('.help-tab.active');
                if (activeTab) {
                    const panelId = activeTab.getAttribute('data-panel');
                    helpPanels.forEach(p => {
                        if (p.id === panelId) {
                            p.classList.add('active');
                            p.style.display = 'block';
                        } else {
                            p.classList.remove('active');
                            p.style.display = 'none';
                        }
                    });
                }
                return;
            }
            
            if (helpSearchClear) helpSearchClear.classList.remove('hidden');
            
            let firstVisibleTab = null;
            let visibleCount = 0;
            
            helpTabs.forEach(tab => {
                const panelId = tab.getAttribute('data-panel');
                if (panelId === 'tab-no-results') return;
                const panel = document.getElementById(panelId);
                if (!panel) return;
                
                const tabText = tab.textContent.toLowerCase();
                const panelText = panel.textContent.toLowerCase();
                const isMatch = tabText.includes(query) || panelText.includes(query);
                
                if (isMatch) {
                    tab.style.display = '';
                    visibleCount++;
                    if (!firstVisibleTab) {
                        firstVisibleTab = tab;
                    }
                } else {
                    tab.style.display = 'none';
                }
            });
            
            if (visibleCount > 0) {
                if (noResultsPanel) {
                    noResultsPanel.classList.remove('active');
                    noResultsPanel.style.display = 'none';
                }
                
                const activeTab = helpModal.querySelector('.help-tab.active');
                if (!activeTab || activeTab.style.display === 'none') {
                    helpTabs.forEach(t => t.classList.remove('active'));
                    helpPanels.forEach(p => {
                        p.classList.remove('active');
                        p.style.display = 'none';
                    });
                    
                    if (firstVisibleTab) {
                        firstVisibleTab.classList.add('active');
                        const panelId = firstVisibleTab.getAttribute('data-panel');
                        const targetPanel = document.getElementById(panelId);
                        if (targetPanel) {
                            targetPanel.classList.add('active');
                            targetPanel.style.display = 'block';
                        }
                    }
                } else {
                    const panelId = activeTab.getAttribute('data-panel');
                    helpPanels.forEach(p => {
                        if (p.id === panelId) {
                            p.classList.add('active');
                            p.style.display = 'block';
                        } else {
                            p.classList.remove('active');
                            p.style.display = 'none';
                        }
                    });
                }
            } else {
                helpPanels.forEach(p => {
                    p.classList.remove('active');
                    p.style.display = 'none';
                });
                
                if (noResultsPanel) {
                    noResultsPanel.classList.add('active');
                    noResultsPanel.style.display = 'block';
                }
            }
        }

        if (helpSearch) {
            helpSearch.addEventListener('input', performSearch);
        }
        if (helpSearchClear) {
            helpSearchClear.addEventListener('click', () => {
                helpSearch.value = '';
                performSearch();
                helpSearch.focus();
            });
        }
    }

    function showCanvasOnboarding(options = {}) {
        const modal = document.getElementById('canvas-onboarding');
        if (!modal) return;
        const fromClear = !!options.fromClear;
        if (!fromClear && localStorage.getItem('boardOnboardingDone') === 'true') return;

        const cards = modal.querySelectorAll('.onboarding-card');
        const bgSelect = document.getElementById('onboardingBg');
        const formatSelect = document.getElementById('onboardingFormat');
        const orientationSelect = document.getElementById('onboardingOrientation');
        const createBtn = document.getElementById('onboardingCreate');
        const clearOption = document.getElementById('onboardingClearOption');
        const showOnClear = document.getElementById('onboardingShowOnClear');
        const showGuidesRow = document.getElementById('onboardingShowGuidesRow');
        const showGuides = document.getElementById('onboardingShowGuides');
        const headerTitle = modal.querySelector('.onboarding-header h3');
        const headerText = modal.querySelector('.onboarding-header p');

        if (fromClear) {
            if (headerTitle) headerTitle.textContent = 'Какой холст создать?';
            if (headerText) headerText.textContent = 'Доска очищена. Выберите формат нового холста.';
            if (clearOption) clearOption.style.display = 'flex';
            if (showOnClear) showOnClear.checked = localStorage.getItem('boardShowCanvasOnClear') !== 'false';
        } else {
            if (headerTitle) headerTitle.textContent = 'Какой холст вам нужен?';
            if (headerText) headerText.textContent = 'Это можно изменить позже в настройках.';
            if (clearOption) clearOption.style.display = 'none';
        }

        let selectedMode = (canvasState && canvasState.canvasMode) || localStorage.getItem('boardCanvasMode') || 'infinite';
        if (bgSelect) bgSelect.value = localStorage.getItem('boardBackgroundStyle') || 'grid';
        if (formatSelect) formatSelect.value = (canvasState && canvasState.pageFormat) || localStorage.getItem('boardPageFormat') || 'A4';
        if (orientationSelect) orientationSelect.value = (canvasState && canvasState.pageOrientation) || localStorage.getItem('boardPageOrientation') || 'portrait';
        if (showGuides) showGuides.checked = (canvasState ? canvasState.showPageGuides !== false : true) &&
            localStorage.getItem('boardShowPageGuides') !== 'false';

        const selectMode = (mode) => {
            selectedMode = mode;
            cards.forEach(card => card.classList.toggle('active', card.dataset.mode === mode));
            if (showGuidesRow) showGuidesRow.style.display = mode === 'infinite' ? 'flex' : 'none';
        };
        cards.forEach(card => {
            card.onclick = () => selectMode(card.dataset.mode);
        });
        selectMode(selectedMode);

        const close = () => {
            modal.classList.add('hidden');
            modal.classList.remove('active');
        };

        createBtn.onclick = () => {
            if (!canvasState) return;
            canvasState.canvasMode = selectedMode;
            canvasState.pageFormat = formatSelect.value;
            canvasState.pageOrientation = orientationSelect.value;
            localStorage.setItem('boardCanvasMode', canvasState.canvasMode);
            localStorage.setItem('boardPageFormat', canvasState.pageFormat);
            localStorage.setItem('boardPageOrientation', canvasState.pageOrientation);
            localStorage.setItem('boardBackgroundStyle', bgSelect.value);
            if (selectedMode === 'infinite' && showGuides) {
                canvasState.showPageGuides = showGuides.checked;
                localStorage.setItem('boardShowPageGuides', showGuides.checked ? 'true' : 'false');
            }
            localStorage.setItem('boardOnboardingDone', 'true');
            if (fromClear && showOnClear) {
                localStorage.setItem('boardShowCanvasOnClear', showOnClear.checked ? 'true' : 'false');
            }
            if (canvasState.canvasMode === 'notebook') {
                canvasState._notebookReflowed = false;
                reflowToNotebook();
            } else {
                canvasState._notebookReflowed = false;
            }
            if (canvasState.saveViewState) canvasState.saveViewState();
            redraw();
            if (canvasState.canvasMode === 'notebook') ensureNotebookPageVisible();
            close();
        };

        modal.classList.remove('hidden');
        modal.classList.add('active');
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
            document.body.classList.remove('dark-theme');
            if (canvasState && canvasState.tileManager) canvasState.tileManager.clear();
            redraw();
        });

        themeDark.addEventListener('click', () => {
            themeDark.classList.add('active');
            themeLight.classList.remove('active');
            selectedTheme = 'dark';
            document.body.classList.add('dark-theme');
            if (canvasState && canvasState.tileManager) canvasState.tileManager.clear();
            redraw();
        });

        // Settings Tab Switcher
        const settingsTabs = settingsModal.querySelectorAll('.settings-tab');
        const settingsPanels = settingsModal.querySelectorAll('.settings-panel');
        
        settingsTabs.forEach(tab => {
            tab.addEventListener('click', () => {
                settingsTabs.forEach(t => t.classList.remove('active'));
                settingsPanels.forEach(p => {
                    p.classList.remove('active');
                    p.style.display = 'none';
                });
                
                tab.classList.add('active');
                const panelId = tab.getAttribute('data-panel');
                const targetPanel = document.getElementById(panelId);
                if (targetPanel) {
                    targetPanel.classList.add('active');
                    targetPanel.style.display = 'block';
                }
            });
        });

        // Setup Custom Dropdown
        function closeAllDropdownPortals() {
            document.querySelectorAll('.dropdown-list.dropdown-portal').forEach(list => {
                const owner = list._ownerDropdown;
                if (owner) {
                    owner.classList.remove('open');
                    owner.appendChild(list);
                }
                list.classList.remove('dropdown-portal');
                list.style.cssText = '';
            });
        }

        function setupDropdown(dropdownId, defaultVal) {
            const dropdown = document.getElementById(dropdownId);
            if (!dropdown) return { getValue: () => defaultVal, setValue: () => {} };
            
            const header = dropdown.querySelector('.dropdown-header');
            const label = header.querySelector('.dropdown-label');
            const list = dropdown.querySelector('.dropdown-list');
            const items = dropdown.querySelectorAll('.dropdown-item');
            
            let currentValue = defaultVal;

            const close = () => {
                dropdown.classList.remove('open');
                if (list.parentNode !== dropdown) dropdown.appendChild(list);
                list.classList.remove('dropdown-portal');
                list.style.cssText = '';
            };

            const open = () => {
                closeAllDropdownPortals();
                dropdown.classList.add('open');
                list._ownerDropdown = dropdown;
                document.body.appendChild(list);
                list.classList.add('dropdown-portal');

                const rect = header.getBoundingClientRect();
                const width = Math.max(rect.width, 170);
                list.style.width = `${width}px`;
                list.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - width - 8))}px`;
                list.style.right = 'auto';
                list.style.top = '0px';
                const listHeight = list.offsetHeight;
                let top = rect.bottom + 8;
                if (top + listHeight > window.innerHeight - 8) {
                    top = rect.top - listHeight - 8;
                }
                list.style.top = `${Math.max(8, top)}px`;
            };

            header.addEventListener('click', (e) => {
                e.stopPropagation();
                if (dropdown.classList.contains('open')) close();
                else open();
            });

            items.forEach(item => {
                item.addEventListener('click', (e) => {
                    e.stopPropagation();
                    items.forEach(i => i.classList.remove('active'));
                    item.classList.add('active');
                    currentValue = item.dataset.value;
                    label.textContent = item.textContent;
                    close();
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
        const canvasModeSelect = setupDropdown('settingsCanvasModeDropdown', 'infinite');
        const pageFormatSelect = setupDropdown('settingsPageFormatDropdown', 'A4');
        const pageOrientationSelect = setupDropdown('settingsPageOrientationDropdown', 'portrait');
        const showPageGuidesToggle = document.getElementById('settingsShowPageGuides');
        const askCanvasOnClearToggle = document.getElementById('settingsAskCanvasOnClear');
        const snapDropdown = setupDropdown('dropdown-snap', 'auto');

        // Close dropdowns on outside click
        document.addEventListener('click', () => {
            document.querySelectorAll('.custom-dropdown').forEach(d => d.classList.remove('open'));
            closeAllDropdownPortals();
        });
        window.addEventListener('resize', closeAllDropdownPortals);
        window.addEventListener('scroll', closeAllDropdownPortals, true);

        const smoothingSlider = document.getElementById('smoothing-slider');
        const smoothingValue = document.getElementById('smoothing-value');
        const autoFormulaToggle = document.getElementById('auto-formula-toggle');
        const proportionalScaleToggle = document.getElementById('proportional-scale-toggle');
        const snapToRulerToggle = document.getElementById('snap-to-ruler-toggle');
        const transparencyToggle = document.getElementById('transparency-toggle');
        const animationsToggle = document.getElementById('animations-toggle');

        function applyAndSaveSettings() {
            const theme = selectedTheme;
            const backgroundStyle = bgDropdown.getValue();
            const snappingMode = snapDropdown.getValue();
            const smoothing = smoothingSlider.value;
            const proportionalScale = proportionalScaleToggle.checked;
            const snapToRuler = snapToRulerToggle.checked;
            const transparencyDisabled = transparencyToggle.checked;
            const animationsDisabled = animationsToggle.checked;
            const canvasMode = canvasModeSelect.getValue();
            const pageFormat = pageFormatSelect.getValue();
            const pageOrientation = pageOrientationSelect.getValue();
            const showPageGuides = showPageGuidesToggle ? showPageGuidesToggle.checked : true;
            const askCanvasOnClear = askCanvasOnClearToggle ? askCanvasOnClearToggle.checked : true;
            const autoFormulaInText = autoFormulaToggle ? autoFormulaToggle.checked : true;

            const themeWillBeDark = theme === 'dark';
            const themeChanged = document.body.classList.contains('dark-theme') !== themeWillBeDark;
            document.body.classList.toggle('dark-theme', themeWillBeDark);
            document.body.classList.toggle('no-transparency', transparencyDisabled);
            document.body.classList.toggle('no-animations', animationsDisabled);

            localStorage.setItem('boardTheme', theme);
            localStorage.setItem('boardBackgroundStyle', backgroundStyle);
            localStorage.setItem('boardSnappingMode', snappingMode);
            localStorage.setItem('boardSmoothing', smoothing);
            localStorage.setItem('boardProportionalScale', proportionalScale);
            localStorage.setItem('boardSnapToRuler', snapToRuler);
            localStorage.setItem('boardTransparencyDisabled', transparencyDisabled);
            localStorage.setItem('boardAnimationsDisabled', animationsDisabled);
            localStorage.setItem('boardCanvasMode', canvasMode);
            localStorage.setItem('boardPageFormat', pageFormat);
            localStorage.setItem('boardPageOrientation', pageOrientation);
            localStorage.setItem('boardShowPageGuides', showPageGuides);
            localStorage.setItem('boardShowCanvasOnClear', askCanvasOnClear);
            localStorage.setItem('boardAutoFormatFormulas', autoFormulaInText);
            if (textTool.setAutoFormatEnabled) textTool.setAutoFormatEnabled(autoFormulaInText);

            if (canvasState) {
                const wasNotebook = canvasState.canvasMode === 'notebook';
                canvasState.smoothingAmount = parseInt(smoothing, 10);
                canvasState.snappingMode = snappingMode;
                canvasState.proportionalScale = proportionalScale;
                canvasState.snapToRuler = snapToRuler;
                canvasState.canvasMode = canvasMode;
                canvasState.pageFormat = pageFormat;
                canvasState.pageOrientation = pageOrientation;
                canvasState.showPageGuides = showPageGuides;
                if (!wasNotebook && canvasMode === 'notebook') {
                    canvasState._notebookReflowed = false;
                    reflowToNotebook();
                } else if (canvasMode === 'infinite') {
                    canvasState._notebookReflowed = false;
                }
                if (canvasState.saveViewState) canvasState.saveViewState();
                // Тема влияет на фон карточек графиков — сбрасываем кэш тайлов.
                if (themeChanged && canvasState.tileManager) canvasState.tileManager.clear();
            }
            redraw();
            if (canvasState && canvasState.canvasMode === 'notebook') ensureNotebookPageVisible();
        }

        function loadSettings() {
            if (settingsTabs && settingsPanels) {
                settingsTabs.forEach(t => t.classList.remove('active'));
                settingsPanels.forEach(p => {
                    p.classList.remove('active');
                    p.style.display = 'none';
                });
                const defaultTab = settingsModal.querySelector('.settings-tab[data-panel="settings-tab-appearance"]');
                if (defaultTab) {
                    defaultTab.classList.add('active');
                    const targetPanel = document.getElementById('settings-tab-appearance');
                    if (targetPanel) {
                        targetPanel.classList.add('active');
                        targetPanel.style.display = 'block';
                    }
                }
            }

            const savedTheme = localStorage.getItem('boardTheme') || 'light';
            const savedStyle = localStorage.getItem('boardBackgroundStyle') || 'grid';
            const savedSnapping = localStorage.getItem('boardSnappingMode') || 'auto';
            const savedSmoothing = localStorage.getItem('boardSmoothing') || '0';
            const savedProportional = localStorage.getItem('boardProportionalScale') !== 'false'; // Default true
            const savedSnapToRuler = localStorage.getItem('boardSnapToRuler') !== 'false'; // Default true
            const savedTransparency = localStorage.getItem('boardTransparencyDisabled') === 'true';
            const savedAnimations = localStorage.getItem('boardAnimationsDisabled') === 'true';
            const savedCanvasMode = (canvasState && canvasState.canvasMode) || localStorage.getItem('boardCanvasMode') || 'infinite';
            const savedPageFormat = (canvasState && canvasState.pageFormat) || localStorage.getItem('boardPageFormat') || 'A4';
            const savedPageOrientation = (canvasState && canvasState.pageOrientation) || localStorage.getItem('boardPageOrientation') || 'portrait';
            const savedShowPageGuides = (canvasState ? canvasState.showPageGuides !== false : true) && localStorage.getItem('boardShowPageGuides') !== 'false';
            const savedAskCanvasOnClear = localStorage.getItem('boardShowCanvasOnClear') !== 'false';

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
            canvasModeSelect.setValue(savedCanvasMode);
            pageFormatSelect.setValue(savedPageFormat);
            pageOrientationSelect.setValue(savedPageOrientation);
            if (showPageGuidesToggle) showPageGuidesToggle.checked = savedShowPageGuides;
            if (askCanvasOnClearToggle) askCanvasOnClearToggle.checked = savedAskCanvasOnClear;

            smoothingSlider.value = savedSmoothing;
            smoothingValue.textContent = savedSmoothing;
            proportionalScaleToggle.checked = savedProportional;
            if (snapToRulerToggle) snapToRulerToggle.checked = savedSnapToRuler;
            const savedAutoFormula = localStorage.getItem('boardAutoFormatFormulas') !== 'false';
            if (autoFormulaToggle) autoFormulaToggle.checked = savedAutoFormula;
            if (textTool.setAutoFormatEnabled) textTool.setAutoFormatEnabled(savedAutoFormula);
            transparencyToggle.checked = savedTransparency;
            animationsToggle.checked = savedAnimations;

            document.body.classList.toggle('dark-theme', savedTheme === 'dark');
            document.body.classList.toggle('no-transparency', savedTransparency);
            document.body.classList.toggle('no-animations', savedAnimations);

            if (canvasState) {
                canvasState.smoothingAmount = parseInt(savedSmoothing, 10);
                canvasState.snappingMode = savedSnapping;
                canvasState.proportionalScale = savedProportional;
                canvasState.snapToRuler = savedSnapToRuler;
                canvasState.canvasMode = savedCanvasMode;
                canvasState.pageFormat = savedPageFormat;
                canvasState.pageOrientation = savedPageOrientation;
                canvasState.showPageGuides = savedShowPageGuides;
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

    // --- NEW: Universal positioning observer for dropdown menus ---
    (function() {
        function adjustDropdown(container) {
            const menu = container.querySelector('.dropdown-options, .sub-toolbar-dropdown, .floating-palette, .color-palette, .dropdown-list');
            if (!menu) return;

            // Reset styles first
            menu.style.marginLeft = '';
            menu.classList.remove('opens-downward');

            const containerRect = container.getBoundingClientRect();
            
            // Temporarily make visible to measure dimensions if hidden
            const wasHidden = window.getComputedStyle(menu).visibility === 'hidden' || window.getComputedStyle(menu).display === 'none';
            let originalDisplay = menu.style.display;
            let originalVisibility = menu.style.visibility;
            if (wasHidden) {
                menu.style.display = 'block';
                menu.style.visibility = 'visible';
            }

            const menuRect = menu.getBoundingClientRect();
            const menuWidth = menuRect.width || menu.offsetWidth;
            const menuHeight = menuRect.height || menu.offsetHeight;

            if (wasHidden) {
                menu.style.display = originalDisplay;
                menu.style.visibility = originalVisibility;
            }

            const margin = 10;
            const spaceAbove = containerRect.top;
            const spaceBelow = window.innerHeight - containerRect.bottom;

            // Decide vertical direction (only if positioned vertically, not side-to-side on desktop)
            const computedStyle = window.getComputedStyle(menu);
            const isVertical = computedStyle.position === 'absolute' && (computedStyle.bottom !== 'auto' || computedStyle.top !== 'auto' || container.classList.contains('dropdown-container') || container.classList.contains('custom-dropdown'));

            if (isVertical) {
                // Check if it's currently set to open upward
                let wantsDownward = false;
                
                // Check if parent toolbar has a specific toolbar position
                const parentToolbar = container.closest('.floating-toolbar');
                const toolbarPosition = parentToolbar ? parentToolbar.dataset.toolbarPosition : null;

                if (toolbarPosition === 'below') {
                    wantsDownward = true;
                }

                if (!wantsDownward) {
                    if (spaceAbove < menuHeight + margin && spaceBelow > spaceAbove) {
                        wantsDownward = true;
                    }
                } else {
                    if (spaceBelow < menuHeight + margin && spaceAbove > spaceBelow) {
                        wantsDownward = false;
                    }
                }

                if (wantsDownward) {
                    menu.classList.add('opens-downward');
                } else {
                    menu.classList.remove('opens-downward');
                }
            }

            // Measure coordinates again for horizontal screen bounds shift
            if (wasHidden) {
                menu.style.display = 'block';
                menu.style.visibility = 'visible';
            }
            const finalRect = menu.getBoundingClientRect();
            if (wasHidden) {
                menu.style.display = originalDisplay;
                menu.style.visibility = originalVisibility;
            }

            const expectedLeft = finalRect.left;
            const expectedRight = finalRect.right;

            let shiftX = 0;
            if (expectedLeft < margin) {
                shiftX = margin - expectedLeft;
            } else if (expectedRight > window.innerWidth - margin) {
                shiftX = (window.innerWidth - margin) - expectedRight;
            }

            if (shiftX !== 0) {
                menu.style.marginLeft = `${shiftX}px`;
            }
        }

        const observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
                    const target = mutation.target;
                    const isActive = target.classList.contains('active') || target.classList.contains('open');
                    if (isActive) {
                        adjustDropdown(target);
                    } else {
                        const menu = target.querySelector('.dropdown-options, .sub-toolbar-dropdown, .floating-palette, .color-palette, .dropdown-list');
                        if (menu) {
                            menu.style.marginLeft = '';
                            menu.classList.remove('opens-downward');
                        }
                    }
                }
            });
        });

        // We observe all elements that can act as dropdown containers
        function startObserving() {
            const containers = document.querySelectorAll('.dropdown-container, .custom-dropdown, .color-picker-wrapper');
            containers.forEach(container => {
                observer.observe(container, { attributes: true, attributeFilter: ['class'] });
            });
        }

        // Initialize observer
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', startObserving);
        } else {
            startObserving();
        }
    })();
    // ---------------------------------------------------------------

});
// --- END OF FILE js/main.js ---