// --- START OF FILE js/main.js ---

import { initializeCanvas } from './canvas.js';
import { initializeToolbar } from './toolbar.js';
import { getEditorTextarea } from './text.js';
import helpContent from './help-content.js';
import { redrawCanvas, drawBackground } from './renderer.js';
import * as history from './history.js';
import { initializeEventListeners, copySelectionToClipboard, pasteFromClipboard } from './events.js';
import { initializeFileHandlers } from './file.js';
// --- НАЧАЛО ИЗМЕНЕНИЙ: Импортируем кэш и rehydrate ---
import * as utils from './utils.js';
import { mediaCache } from './utils.js';
// --- КОНЕЦ ИЗМЕНЕНИЙ ---

document.addEventListener('DOMContentLoaded', () => {
    const loader = document.getElementById('loader-overlay'); 
    const backgroundCanvas = document.getElementById('backgroundCanvas'); 
    const drawingCanvas = document.getElementById('drawingBoard'); 
    const interactionCanvas = document.getElementById('interactionCanvas');
    const ctx = drawingCanvas.getContext('2d');
    const undoBtn = document.getElementById('undoBtn'); 
    const redoBtn = document.getElementById('redoBtn');
    let canvasState;

    let saveStateTimer = null;
    let saveViewStateTimer = null;

    function debouncedSaveState(layers, addToHistory = true) {
        clearTimeout(saveStateTimer);
        saveStateTimer = setTimeout(() => {
            performSaveState(layers, addToHistory);
        }, 500); 
    }

    function debouncedSaveViewState() {
        clearTimeout(saveViewStateTimer);
        saveViewStateTimer = setTimeout(() => {
            if (canvasState) {
                performSaveState(canvasState.layers, false); 
            }
        }, 500);
    }

    function updateUndoRedoButtons() {
        undoBtn.disabled = !history.canUndo();
        redoBtn.disabled = !history.canRedo();
    }
    
    function performSaveState(layers, addToHistory = true) {
        history.saveState(layers, addToHistory);
        updateUndoRedoButtons();
    }

    // --- НАЧАЛО ИЗМЕНЕНИЙ: Переписываем Undo/Redo для использования кэша ---
    async function performUndo() {
        const lightweightLayers = history.undo();
        if (lightweightLayers) {
            lightweightLayers.forEach(layer => {
                if (mediaCache[layer.id]) {
                    Object.assign(layer, mediaCache[layer.id]);
                }
            });
            canvasState.layers = lightweightLayers;
            canvasState.selectedLayers = [];
            redraw();
            updateUndoRedoButtons();
        }
    }

    async function performRedo() {
        const lightweightLayers = history.redo();
        if (lightweightLayers) {
            lightweightLayers.forEach(layer => {
                if (mediaCache[layer.id]) {
                    Object.assign(layer, mediaCache[layer.id]);
                }
            });
            canvasState.layers = lightweightLayers;
            canvasState.selectedLayers = [];
            redraw();
            updateUndoRedoButtons();
        }
    }
    // --- КОНЕЦ ИЗМЕНЕНИЙ ---

    function performDeleteSelected() {
        if (canvasState.selectedLayers.length > 0) {
            const idsToDelete = new Set(canvasState.selectedLayers.map(l => l.id));
            canvasState.layers = canvasState.layers.filter(layer => !idsToDelete.has(layer.id));
            canvasState.selectedLayers = [];
            performSaveState(canvasState.layers);
            redraw();
            canvasState.updateFloatingToolbar();
        }
    }

    function performDeleteSelectedCurveNode() {
        if (canvasState.selectedLayers.length !== 1 || canvasState.selectedLayers[0].type !== 'curve') return;
        if (canvasState.selectedCurveNodeIndex === null) return;
    
        const curve = canvasState.selectedLayers[0];
        if (curve.nodes.length <= 2) return;
    
        curve.nodes.splice(canvasState.selectedCurveNodeIndex, 1);
        
        utils.smoothCurveHandles(curve.nodes);
    
        canvasState.selectedCurveNodeIndex = null;
        performSaveState(canvasState.layers);
        redraw();
        canvasState.updateFloatingToolbar();
    }

    const setupCanvases = () => { 
        const width = window.innerWidth, height = window.innerHeight;
        [backgroundCanvas, drawingCanvas, interactionCanvas].forEach(c => { c.width = width; c.height = height; }); 
        drawBackground(backgroundCanvas, canvasState); 
        if (canvasState) redraw(); 
    };
    
    const redraw = () => {
        redrawCanvas(canvasState);
        drawBackground(backgroundCanvas, canvasState);
    };

    function updateSubToolbarVisibility() {
        if (!canvasState) return;
    
        const drawingSubToolbar = document.getElementById('drawingSubToolbar');
        const hasSelection = canvasState.selectedLayers.length > 0;
        const activeTool = canvasState.activeTool;
        
        const shapes2DOrder = ['rect', 'ellipse', 'line', 'curve', 'parallelogram', 'triangle', 'trapezoid', 'rhombus'];
        const shapes3DOrder = ['sphere', 'cone', 'parallelepiped', 'pyramid', 'frustum', 'truncated-pyramid', 'truncated-sphere'];
        const drawableTools = ['brush', 'smart-brush', ...shapes2DOrder, ...shapes3DOrder];
        
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
                if(colorLayer) {
                    const colorPalette = document.getElementById('colorPalette');
                    colorPalette.querySelectorAll('.active').forEach(el => el.classList.remove('active'));
                    const newActive = colorPalette.querySelector(`[data-color="${colorLayer.color}"]`);
                    if(newActive) newActive.classList.add('active');
                }
            } else {
                updateLineWidthControls(canvasState.activeLineWidth);
                
                const colorPalette = document.getElementById('colorPalette');
                colorPalette.querySelectorAll('.active').forEach(el => el.classList.remove('active'));
                const newActive = colorPalette.querySelector(`[data-color="${canvasState.activeColor}"]`);
                if(newActive) newActive.classList.add('active');
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
    }
    
    async function loadState(projectData = null) {
        let dataToParse = projectData;

        if (!dataToParse) {
            dataToParse = localStorage.getItem('drawingBoard');
        }

        if (!dataToParse) {
            history.resetHistory();
            performSaveState([], true);
            return;
        }

        try {
            const loadedData = JSON.parse(dataToParse);
            const layersToLoad = loadedData.layers || [];
            const viewState = loadedData.viewState;

            if (viewState) {
                canvasState.panX = viewState.panX || 0;
                canvasState.panY = viewState.panY || 0;
                canvasState.zoom = viewState.zoom || 1;
            }
            
            const liveLayers = await utils.rehydrateLayers(layersToLoad);
            
            canvasState.layers = liveLayers;
            
            history.resetHistory();
            performSaveState(canvasState.layers, true);
            
            redraw();

        } catch (e) {
            console.error("Не удалось загрузить состояние:", e);
            history.resetHistory();
            performSaveState([]);
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

    canvasState = initializeCanvas(drawingCanvas, interactionCanvas, ctx, redraw, performSaveState, updateToolbarCallback, debouncedSaveViewState, debouncedSaveState);
    history.initHistory(canvasState);
    canvasState.redraw = redraw;

    const eventHandlers = {
        performUndo, performRedo, performSaveState,
        redraw, setupCanvases, updateSubToolbarVisibility,
        performDeselect: () => {
            if (canvasState.selectedLayers.length > 0) {
                canvasState.selectedLayers.forEach(layer => utils.applyTransformations(layer));
                performSaveState(canvasState.layers);
                canvasState.selectedLayers = [];
                canvasState.selectedCurveNodeIndex = null;
                redraw();
                canvasState.updateFloatingToolbar();
            }
        }
    };
    
    initializeToolbar(canvasState, redraw, updateSubToolbarVisibility, eventHandlers);
    initializeCustomTooltips();
    initializeEventListeners(canvasState, { ...eventHandlers, performDeleteSelectedCurveNode });
    initializeFileHandlers(canvasState, loadState, redraw, performSaveState);
    
    updateSubToolbarVisibility();
    setupCanvases();
    loadState(); 
    updateUndoRedoButtons();
    initializeHelpModal();
    initializeSettingsModal();

    window.addEventListener('resize', checkUiLayout);
    checkUiLayout();

    function initializeFloatingTextToolbar() {
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
            if (canvasState) {
                const layer = canvasState.isEditingText 
                    ? canvasState.layers.find(l => l.isEditing) 
                    : (canvasState.selectedLayers.length === 1 && canvasState.selectedLayers[0].type === 'text' ? canvasState.selectedLayers[0] : null);
                
                if (layer) {
                    callback(layer);
                    Object.assign(canvasState, {
                        activeFontFamily: layer.fontFamily, activeFontSize: layer.fontSize,
                        activeFontWeight: layer.fontWeight, activeFontStyle: layer.fontStyle,
                        activeTextDecoration: layer.textDecoration, activeTextAlign: layer.align,
                        activeTextColor: layer.color
                    });
                    performSaveState(canvasState.layers);
                    redraw();

                    if (canvasState.isEditingText && canvasState.updateTextEditorStyle) {
                        canvasState.updateTextEditorStyle(layer);
                    }
                    canvasState.updateFloatingToolbar();
                }
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
                switch(action) {
                    case 'align-left': layer.align = 'left'; break;
                    case 'align-center': layer.align = 'center'; break;
                    case 'align-right': layer.align = 'right'; break;
                    case 'font-bold': layer.fontWeight = layer.fontWeight === 'bold' ? 'normal' : 'bold'; break;
                    case 'font-italic': layer.fontStyle = layer.fontStyle === 'italic' ? 'normal' : 'italic'; break;
                    case 'font-underline': layer.textDecoration = layer.textDecoration === 'underline' ? 'none' : 'underline'; break;
                }
            });

            if (button.closest('.dropdown-options')) {
                dropdowns.forEach(d => d.classList.remove('active'));
            }
        });

        document.getElementById('font-family-options').addEventListener('click', e => {
            const button = e.target.closest('button[data-font]');
            if (button) {
                applyChange(layer => layer.fontFamily = button.dataset.font);
                document.getElementById('font-family-display').textContent = button.dataset.font;
                fontFamilyDropdown.classList.remove('active');
            }
        });

        floatingPalette.addEventListener('click', e => {
            const colorDot = e.target.closest('.color-dot');
            if (colorDot) {
                const newColor = colorDot.dataset.color;
                applyChange(layer => { 
                    layer.color = newColor;
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
            applyChange(layer => layer.fontSize = parseInt(e.target.value, 10) || 30);
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

            layer.currentPage = newPageNum;

            if (!layer.renderedPages.has(newPageNum)) {
                await utils.renderPdfPageToCanvas(layer, newPageNum);
            }
            
            performSaveState(canvasState.layers);
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
        const helpModal = document.getElementById('helpModal');
        const closeHelpBtn = document.getElementById('closeHelpBtn');

        for (const panelId in helpContent) {
            const panel = document.getElementById(panelId);
            if (panel) { panel.innerHTML = helpContent[panelId]; }
        }

        function openModal() { helpModal.classList.remove('hidden'); }
        function closeModal() { helpModal.classList.add('hidden'); }

        helpBtn.addEventListener('click', (e) => { e.preventDefault(); openModal(); });
        closeHelpBtn.addEventListener('click', closeModal);
        helpModal.addEventListener('click', (e) => { if (e.target === helpModal) { closeModal(); } });

        const sidebarButtons = helpModal.querySelectorAll('.sidebar-button');
        const panels = helpModal.querySelectorAll('.modal-panel');
        sidebarButtons.forEach(button => {
            button.addEventListener('click', () => {
                sidebarButtons.forEach(btn => btn.classList.remove('active'));
                panels.forEach(panel => panel.classList.remove('active'));
                button.classList.add('active');
                const panelId = button.getAttribute('data-panel');
                document.getElementById(panelId).classList.add('active');
            });
        });
    }

    function initializeSettingsModal() {
        const settingsBtn = document.getElementById('settingsBtn');
        const settingsModal = document.getElementById('settingsModal');
        const okBtn = document.getElementById('okSettings');
        const cancelBtn = document.getElementById('cancelSettings');
        
        const themeDropdownContainer = document.getElementById('theme-dropdown-container');
        const themeBtn = document.getElementById('theme-select-btn');
        const themeOptions = themeDropdownContainer.querySelector('.ps-dropdown-options');

        const bgDropdownContainer = document.getElementById('background-style-dropdown-container');
        const bgBtn = document.getElementById('background-style-select-btn');
        const bgOptions = bgDropdownContainer.querySelector('.ps-dropdown-options');
        
        const snappingDropdownContainer = document.getElementById('snapping-dropdown-container');
        const snappingBtn = document.getElementById('snapping-select-btn');
        const snappingOptions = snappingDropdownContainer.querySelector('.ps-dropdown-options');
        
        const settingsDropdowns = [themeDropdownContainer, bgDropdownContainer, snappingDropdownContainer];

        themeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            bgDropdownContainer.classList.remove('active');
            snappingDropdownContainer.classList.remove('active');
            themeDropdownContainer.classList.toggle('active');
        });

        bgBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            themeDropdownContainer.classList.remove('active');
            snappingDropdownContainer.classList.remove('active');
            bgDropdownContainer.classList.toggle('active');
        });

        snappingBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            themeDropdownContainer.classList.remove('active');
            bgDropdownContainer.classList.remove('active');
            snappingDropdownContainer.classList.toggle('active');
        });

        themeOptions.addEventListener('click', (e) => {
            const option = e.target.closest('.ps-dropdown-option');
            if (option) {
                const value = option.dataset.value;
                themeBtn.textContent = option.textContent;
                themeBtn.dataset.value = value;
                themeOptions.querySelectorAll('.active').forEach(el => el.classList.remove('active'));
                option.classList.add('active');
            }
        });

        bgOptions.addEventListener('click', (e) => {
            const option = e.target.closest('.ps-dropdown-option');
            if (option) {
                const value = option.dataset.value;
                bgBtn.textContent = option.textContent;
                bgBtn.dataset.value = value;
                bgOptions.querySelectorAll('.active').forEach(el => el.classList.remove('active'));
                option.classList.add('active');
            }
        });

        snappingOptions.addEventListener('click', (e) => {
            const option = e.target.closest('.ps-dropdown-option');
            if (option) {
                const value = option.dataset.value;
                snappingBtn.textContent = option.textContent;
                snappingBtn.dataset.value = value;
                snappingOptions.querySelectorAll('.active').forEach(el => el.classList.remove('active'));
                option.classList.add('active');
            }
        });

        settingsModal.addEventListener('click', (e) => {
            if (!themeDropdownContainer.contains(e.target) && !bgDropdownContainer.contains(e.target) && !snappingDropdownContainer.contains(e.target)) {
                settingsDropdowns.forEach(d => d.classList.remove('active'));
            }
        });

        const smoothingSlider = document.getElementById('smoothing-slider');
        const smoothingValue = document.getElementById('smoothing-value');
        const transparencyToggle = document.getElementById('transparency-toggle');
        const animationsToggle = document.getElementById('animations-toggle');
        
        function applyAndSaveSettings() { 
            const theme = themeBtn.dataset.value; 
            const backgroundStyle = bgBtn.dataset.value;
            const snappingMode = snappingBtn.dataset.value;
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
            const savedStyle = localStorage.getItem('boardBackgroundStyle') || 'dot'; 
            const savedSnapping = localStorage.getItem('boardSnappingMode') || 'auto';
            const savedSmoothing = localStorage.getItem('boardSmoothing') || '2';
            const savedTransparency = localStorage.getItem('boardTransparencyDisabled') === 'true';
            const savedAnimations = localStorage.getItem('boardAnimationsDisabled') === 'true';
            
            const themeOption = themeOptions.querySelector(`[data-value="${savedTheme}"]`);
            if (themeOption) {
                themeBtn.textContent = themeOption.textContent;
                themeBtn.dataset.value = savedTheme;
                themeOptions.querySelectorAll('.active').forEach(el => el.classList.remove('active'));
                themeOption.classList.add('active');
            }

            const bgOption = bgOptions.querySelector(`[data-value="${savedStyle}"]`);
            if (bgOption) {
                bgBtn.textContent = bgOption.textContent;
                bgBtn.dataset.value = savedStyle;
                bgOptions.querySelectorAll('.active').forEach(el => el.classList.remove('active'));
                bgOption.classList.add('active');
            }

            const snappingOption = snappingOptions.querySelector(`[data-value="${savedSnapping}"]`);
            if (snappingOption) {
                snappingBtn.textContent = snappingOption.textContent;
                snappingBtn.dataset.value = savedSnapping;
                snappingOptions.querySelectorAll('.active').forEach(el => el.classList.remove('active'));
                snappingOption.classList.add('active');
            }
            
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
            settingsDropdowns.forEach(d => d.classList.remove('active'));
        }
        settingsBtn.addEventListener('click', (e) => { 
            e.preventDefault(); 
            loadSettings();
            settingsModal.classList.remove('hidden'); 
        });
        okBtn.addEventListener('click', () => { 
            applyAndSaveSettings(); 
            closeModal(); 
        });
        cancelBtn.addEventListener('click', () => {
            loadSettings();
            closeModal();
        });
        settingsModal.addEventListener('click', (e) => { 
            if (e.target === settingsModal) { 
                loadSettings();
                closeModal(); 
            } 
        });
        
        const settingsSidebarButtons = settingsModal.querySelectorAll('.sidebar-button');
        const settingsPanels = settingsModal.querySelectorAll('.modal-panel');
        settingsSidebarButtons.forEach(button => { 
            button.addEventListener('click', () => { 
                settingsSidebarButtons.forEach(btn => btn.classList.remove('active')); 
                settingsPanels.forEach(panel => panel.classList.remove('active')); 
                button.classList.add('active'); 
                const panelId = button.getAttribute('data-panel'); 
                document.getElementById(panelId).classList.add('active'); 
            }); 
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
