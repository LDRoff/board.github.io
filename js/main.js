// --- START OF FILE main.js ---

import { initializeCanvas } from './canvas.js';
import { initializeToolbar } from './toolbar.js';
import { getEditorTextarea } from './text.js';
import helpContent from './help-content.js';
import { redrawCanvas, drawBackground } from './renderer.js';
import * as history from './history.js';
import { initializeEventListeners } from './events.js';
import { initializeFileHandlers } from './file.js';

document.addEventListener('DOMContentLoaded', () => {
    const backgroundCanvas = document.getElementById('backgroundCanvas'); 
    const drawingCanvas = document.getElementById('drawingBoard'); 
    const interactionCanvas = document.getElementById('interactionCanvas');
    const ctx = drawingCanvas.getContext('2d');
    const undoBtn = document.getElementById('undoBtn'); 
    const redoBtn = document.getElementById('redoBtn');
    let canvasState;

    function updateUndoRedoButtons() {
        undoBtn.disabled = !history.canUndo();
        redoBtn.disabled = !history.canRedo();
    }
    
    function performSaveState(layers) {
        history.saveState(layers);
        updateUndoRedoButtons();
    }

    function performUndo() {
        const newLayers = history.undo();
        if (newLayers) {
            canvasState.layers = newLayers;
            canvasState.selectedLayers = [];
            redraw();
            updateUndoRedoButtons();
        }
    }

    function performRedo() {
        const newLayers = history.redo();
        if (newLayers) {
            canvasState.layers = newLayers;
            canvasState.selectedLayers = [];
            redraw();
            updateUndoRedoButtons();
        }
    }

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
        
        const shapes2DOrder = ['rect', 'ellipse', 'line', 'parallelogram', 'triangle', 'trapezoid', 'rhombus'];
        const shapes3DOrder = ['sphere', 'cone', 'parallelepiped', 'pyramid', 'frustum', 'truncated-pyramid', 'truncated-sphere'];
        const drawableTools = ['brush', 'smart-brush', ...shapes2DOrder, ...shapes3DOrder];
        const isDrawingContext = drawableTools.includes(activeTool) || (hasSelection && canvasState.selectedLayers.some(l => l.type !== 'text'));
    
        if (isDrawingContext) {
            drawingSubToolbar.classList.remove('hidden');
    
            if (hasSelection) {
                const layer = canvasState.selectedLayers.find(l => l.hasOwnProperty('lineWidth'));
                if (layer) {
                    document.getElementById('lineWidthSlider').value = layer.lineWidth;
                }
                
                const colorLayer = canvasState.selectedLayers.find(l => l.hasOwnProperty('color'));
                if(colorLayer) {
                    const colorPalette = document.getElementById('colorPalette');
                    colorPalette.querySelectorAll('.active').forEach(el => el.classList.remove('active'));
                    const newActive = colorPalette.querySelector(`[data-color="${colorLayer.color}"]`);
                    if(newActive) newActive.classList.add('active');
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
    }
    
    function loadState(projectData = null) {
        let dataToParse = projectData;

        if (!dataToParse) {
            dataToParse = localStorage.getItem('drawingBoard') || localStorage.getItem('drawingBoardLayers');
        }

        if (!dataToParse) {
            history.resetHistory();
            performSaveState([]);
            return;
        }

        try {
            const loadedData = JSON.parse(dataToParse);
            let layersToLoad;
            let viewState = null;

            if (Array.isArray(loadedData)) {
                layersToLoad = loadedData;
            } else {
                layersToLoad = loadedData.layers;
                viewState = loadedData.viewState;
            }

            if (viewState) {
                canvasState.panX = viewState.panX || 0;
                canvasState.panY = viewState.panY || 0;
                canvasState.zoom = viewState.zoom || 1;
            }

            const imageLoadPromises = [];
            if (layersToLoad) {
                layersToLoad.forEach(layer => {
                    if (layer.type === 'image' && layer.src) {
                        const img = new Image();
                        const promise = new Promise((resolve, reject) => {
                            img.onload = () => {
                                layer.image = img;
                                delete layer.src;
                                resolve();
                            };
                            img.onerror = (err) => {
                                console.error('Не удалось загрузить изображение:', layer.src, err);
                                reject(err);
                            };
                        });
                        img.src = layer.src;
                        imageLoadPromises.push(promise);
                    }
                });
            }

            Promise.all(imageLoadPromises).then(() => {
                canvasState.layers = layersToLoad || [];
                history.resetHistory();
                performSaveState(canvasState.layers);
                redraw();
            }).catch(() => {
                console.error("Не все изображения удалось загрузить.");
                canvasState.layers = layersToLoad.filter(l => l.type !== 'image' || l.image);
                history.resetHistory();
                performSaveState(canvasState.layers);
                redraw();
            });

        } catch (e) {
            console.error("Не удалось загрузить состояние:", e);
            history.resetHistory();
            performSaveState([]);
        }
    }
    
    // --- Initialization ---
    
    initializeFloatingTextToolbar();
    initializeFloatingSelectionToolbar();

    canvasState = initializeCanvas(drawingCanvas, interactionCanvas, ctx, redraw, performSaveState, updateSubToolbarVisibility);
    history.initHistory(canvasState);

    const eventHandlers = {
        performUndo, performRedo, performSaveState,
        redraw, setupCanvases, updateSubToolbarVisibility
    };
    
    initializeToolbar(canvasState, redraw, updateSubToolbarVisibility, eventHandlers);
    initializeCustomTooltips();
    initializeEventListeners(canvasState, eventHandlers);
    initializeFileHandlers(canvasState, loadState);
    
    updateSubToolbarVisibility();
    setupCanvases();
    loadState();
    updateUndoRedoButtons();
    initializeHelpModal();
    initializeSettingsModal();

    function initializeFloatingTextToolbar() {
        const toolbar = document.getElementById('floating-text-toolbar');
        const colorPalette = document.getElementById('colorPalette');
        const floatingPalette = document.getElementById('floatingColorPalette');
        floatingPalette.innerHTML = colorPalette.innerHTML;
        const colorPicker = document.getElementById('floating-color-picker');

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
            if (button) {
                const action = button.dataset.action;
                if (!action) return;

                if (action === 'delete') {
                    performDeleteSelected();
                    return;
                }

                if (action === 'pick-color') return;

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
            }
        });
        
        colorPicker.addEventListener('click', (e) => {
            e.stopPropagation();
            colorPicker.classList.toggle('active');
        });

        floatingPalette.addEventListener('click', e => {
            const colorDot = e.target.closest('.color-dot');
            if (colorDot) {
                const newColor = colorDot.dataset.color;
                applyChange(layer => { 
                    layer.color = newColor;
                });
                 // Update the floating palette's UI directly
                floatingPalette.querySelectorAll('.active').forEach(el => el.classList.remove('active'));
                colorDot.classList.add('active');
            }
        });
        
        document.addEventListener('click', () => {
            if(colorPicker.classList.contains('active')) {
                colorPicker.classList.remove('active');
            }
        });

        document.getElementById('fontFamilySelect').addEventListener('change', e => {
            applyChange(layer => layer.fontFamily = e.target.value);
        });

        document.getElementById('floatingFontSizeInput').addEventListener('input', e => {
            applyChange(layer => layer.fontSize = parseInt(e.target.value, 10) || 30);
        });
    }

    function initializeFloatingSelectionToolbar() {
        const toolbar = document.getElementById('floating-selection-toolbar');
        toolbar.addEventListener('click', e => {
            const button = e.target.closest('button');
            if (button && button.dataset.action === 'delete') {
                performDeleteSelected();
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
            target.dataset.originalTitle = titleText;
            target.removeAttribute('title');

            tooltip.textContent = titleText;
            tooltip.classList.add('visible');
            
            const targetRect = target.getBoundingClientRect();
            tooltip.style.left = `${targetRect.left + targetRect.width / 2}px`;
            tooltip.style.top = `${targetRect.top}px`;
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
        const themeSelect = document.getElementById('theme-select');
        const backgroundStyleSelect = document.getElementById('background-style-select');
        const smoothingSlider = document.getElementById('smoothing-slider');
        const smoothingValue = document.getElementById('smoothing-value');
        const transparencyToggle = document.getElementById('transparency-toggle');
        const animationsToggle = document.getElementById('animations-toggle');
        
        function applyAndSaveSettings() { 
            const theme = themeSelect.value; 
            const backgroundStyle = backgroundStyleSelect.value;
            const smoothing = smoothingSlider.value;
            const transparencyDisabled = transparencyToggle.checked;
            const animationsDisabled = animationsToggle.checked;
            
            document.body.classList.toggle('dark-theme', theme === 'dark'); 
            document.body.classList.toggle('no-transparency', transparencyDisabled);
            document.body.classList.toggle('no-animations', animationsDisabled);
            
            localStorage.setItem('boardTheme', theme); 
            localStorage.setItem('boardBackgroundStyle', backgroundStyle);
            localStorage.setItem('boardSmoothing', smoothing);
            localStorage.setItem('boardTransparencyDisabled', transparencyDisabled);
            localStorage.setItem('boardAnimationsDisabled', animationsDisabled);

            if (canvasState) { canvasState.smoothingAmount = parseInt(smoothing, 10); }
            redraw(); 
        }
        
        function loadSettings() { 
            const savedTheme = localStorage.getItem('boardTheme') || 'light'; 
            const savedStyle = localStorage.getItem('boardBackgroundStyle') || 'dot'; 
            const savedSmoothing = localStorage.getItem('boardSmoothing') || '2';
            const savedTransparency = localStorage.getItem('boardTransparencyDisabled') === 'true';
            const savedAnimations = localStorage.getItem('boardAnimationsDisabled') === 'true';

            themeSelect.value = savedTheme; 
            backgroundStyleSelect.value = savedStyle; 
            smoothingSlider.value = savedSmoothing; 
            smoothingValue.textContent = savedSmoothing;
            transparencyToggle.checked = savedTransparency;
            animationsToggle.checked = savedAnimations;
            
            document.body.classList.toggle('dark-theme', savedTheme === 'dark'); 
            document.body.classList.toggle('no-transparency', savedTransparency);
            document.body.classList.toggle('no-animations', savedAnimations);
            
            if (canvasState) { canvasState.smoothingAmount = parseInt(savedSmoothing, 10); }
            redraw(); 
        }
        
        smoothingSlider.addEventListener('input', () => { smoothingValue.textContent = smoothingSlider.value; });

        function closeModal() { settingsModal.classList.add('hidden'); }
        settingsBtn.addEventListener('click', (e) => { 
            e.preventDefault(); 
            // Load current settings into toggles before showing
            loadSettings();
            settingsModal.classList.remove('hidden'); 
        });
        okBtn.addEventListener('click', () => { 
            applyAndSaveSettings(); 
            closeModal(); 
        });
        cancelBtn.addEventListener('click', () => {
            // Revert changes on cancel
            loadSettings();
            closeModal();
        });
        settingsModal.addEventListener('click', (e) => { 
            if (e.target === settingsModal) { 
                // Revert changes on clicking outside
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
});
// --- END OF FILE main.js ---