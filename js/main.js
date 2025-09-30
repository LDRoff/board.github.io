// --- START OF FILE main.js ---

import { initializeCanvas } from './canvas.js';
import { getBoundingBox, getGroupBoundingBox } from './geometry.js';
import { getSelectionRotation } from './hitTest.js';
import { initializeToolbar } from './toolbar.js';
import { getEditorTextarea } from './text.js';
import helpContent from './help-content.js';

const history = []; let historyIndex = -1;
function cloneLayers(layers) { return layers.map(l => { const n = { ...l }; if (l.points) { n.points = l.points.map(p => ({ ...p })); } return n; }); }

let clipboard = null;

document.addEventListener('DOMContentLoaded', () => {
    const backgroundCanvas = document.getElementById('backgroundCanvas'); const drawingCanvas = document.getElementById('drawingBoard'); const ctx = drawingCanvas.getContext('2d');
    const undoBtn = document.getElementById('undoBtn'); const redoBtn = document.getElementById('redoBtn');
    let canvasState;
    function updateUndoRedoButtons() { undoBtn.disabled = historyIndex <= 0; redoBtn.disabled = historyIndex >= history.length - 1; }
    
    function saveState(layers) { 
        if (historyIndex < history.length - 1) { 
            history.splice(historyIndex + 1); 
        } 
        if (history.length > 50) { 
            history.shift(); 
        } 
        history.push(cloneLayers(layers)); 
        historyIndex = history.length - 1; 
        updateUndoRedoButtons(); 

        try {
            const serializableLayers = layers.map(layer => {
                if (layer.type === 'image' && layer.image instanceof HTMLImageElement) {
                    const newLayer = { ...layer };
                    if (!newLayer.src || !newLayer.src.startsWith('data:')) {
                        const tempCanvas = document.createElement('canvas');
                        tempCanvas.width = newLayer.image.naturalWidth;
                        tempCanvas.height = newLayer.image.naturalHeight;
                        const tempCtx = tempCanvas.getContext('2d');
                        tempCtx.drawImage(newLayer.image, 0, 0);
                        newLayer.src = tempCanvas.toDataURL();
                    }
                    delete newLayer.image;
                    return newLayer;
                }
                return layer;
            });
            
            const dataToSave = {
                viewState: {
                    panX: canvasState.panX,
                    panY: canvasState.panY,
                    zoom: canvasState.zoom
                },
                layers: serializableLayers
            };

            localStorage.setItem('drawingBoard', JSON.stringify(dataToSave));
        } catch (e) {
            console.error("Не удалось сохранить состояние доски:", e);
        }
    }

    function undo() { if (historyIndex > 0) { historyIndex--; canvasState.layers = cloneLayers(history[historyIndex]); canvasState.selectedLayers = []; redraw(); updateUndoRedoButtons(); } }
    function redo() { if (historyIndex < history.length - 1) { historyIndex++; canvasState.layers = cloneLayers(history[historyIndex]); canvasState.selectedLayers = []; redraw(); updateUndoRedoButtons(); } }
    const setupCanvases = () => { const width = window.innerWidth, height = window.innerHeight;[backgroundCanvas, drawingCanvas].forEach(c => { c.width = width; c.height = height; }); drawBackground(backgroundCanvas, canvasState); if (canvasState) redraw(); };
    
    const redraw = () => {
        redrawCanvas(canvasState);
        drawBackground(backgroundCanvas, canvasState);
    };

    const shapes2DOrder = ['rect', 'ellipse', 'line', 'parallelogram', 'triangle', 'trapezoid', 'rhombus'];
    const shapes3DOrder = ['sphere', 'cone', 'parallelepiped', 'pyramid', 'frustum', 'truncated-pyramid', 'truncated-sphere'];

    function updateSubToolbarVisibility() {
        if (!canvasState) return;

        const drawingSubToolbar = document.getElementById('drawingSubToolbar');
        drawingSubToolbar.classList.add('hidden');

        const hasSelection = canvasState.selectedLayers.length > 0;
        const activeTool = canvasState.activeTool;
        
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
        }
    }
    
    initializeFloatingTextToolbar();

    canvasState = initializeCanvas(drawingCanvas, ctx, redraw, saveState, updateSubToolbarVisibility);
    initializeToolbar(canvasState, redraw, updateSubToolbarVisibility);
    
    initializeCustomTooltips();

    function loadState(projectData = null) {
        let dataToParse = projectData;

        if (!dataToParse) {
            dataToParse = localStorage.getItem('drawingBoard') || localStorage.getItem('drawingBoardLayers');
        }

        if (!dataToParse) {
            saveState([]);
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
                history.length = 0; 
                historyIndex = -1;
                saveState(canvasState.layers);
                redraw();
            }).catch(() => {
                console.error("Не все изображения удалось загрузить.");
                canvasState.layers = layersToLoad.filter(l => l.type !== 'image' || l.image);
                saveState(canvasState.layers);
                redraw();
            });

        } catch (e) {
            console.error("Не удалось загрузить состояние:", e);
            saveState([]);
        }
    }

    if (canvasState.activeTool === 'brush') {
        canvasState.canvas.classList.add('cursor-brush');
    } else if (canvasState.activeTool === 'eraser') {
        canvasState.canvas.classList.add('cursor-eraser');
    }
    
    updateSubToolbarVisibility();
    
    setupCanvases();
    undoBtn.addEventListener('click', undo);
    redoBtn.addEventListener('click', redo);

    loadState();

    const zoomInBtn = document.getElementById('zoomInBtn');
    const zoomOutBtn = document.getElementById('zoomOutBtn');

    zoomInBtn.addEventListener('click', () => {
        if (canvasState && typeof canvasState.performZoom === 'function') {
            canvasState.performZoom('in');
        }
    });

    zoomOutBtn.addEventListener('click', () => {
        if (canvasState && typeof canvasState.performZoom === 'function') {
            canvasState.performZoom('out');
        }
    });

    document.getElementById('exportJpgBtn').addEventListener('click', (e) => { 
        e.preventDefault(); 
        const tempCanvas = document.createElement('canvas'); 
        tempCanvas.width = drawingCanvas.width; 
        tempCanvas.height = drawingCanvas.height; 
        const tempCtx = tempCanvas.getContext('2d'); 
        
        tempCtx.fillStyle = window.getComputedStyle(backgroundCanvas).backgroundColor || '#FFFFFF';
        tempCtx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);

        tempCtx.drawImage(backgroundCanvas, 0, 0); 
        tempCtx.drawImage(drawingCanvas, 0, 0); 
        const link = document.createElement('a'); 
        link.download = 'my-board.jpg';
        link.href = tempCanvas.toDataURL('image/jpeg', 0.95);
        link.click(); 
    });
    
    document.getElementById('saveProjectBtn').addEventListener('click', (e) => {
        e.preventDefault();
        const serializableLayers = canvasState.layers.map(layer => {
            if (layer.type === 'image' && layer.image instanceof HTMLImageElement) {
                const newLayer = { ...layer };
                if (!newLayer.src || !newLayer.src.startsWith('data:')) {
                    const tempCanvas = document.createElement('canvas');
                    tempCanvas.width = newLayer.image.naturalWidth;
                    tempCanvas.height = newLayer.image.naturalHeight;
                    const tempCtx = tempCanvas.getContext('2d');
                    tempCtx.drawImage(newLayer.image, 0, 0);
                    newLayer.src = tempCanvas.toDataURL();
                }
                delete newLayer.image;
                return newLayer;
            }
            return layer;
        });

        const projectData = {
            viewState: {
                panX: canvasState.panX,
                panY: canvasState.panY,
                zoom: canvasState.zoom
            },
            layers: serializableLayers
        };

        const dataStr = JSON.stringify(projectData);
        const blob = new Blob([dataStr], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.download = 'project.board';
        link.href = url;
        link.click();
        URL.revokeObjectURL(url);
    });

    const projectUploadInput = document.getElementById('projectUpload');
    document.getElementById('openProjectBtn').addEventListener('click', (e) => {
        e.preventDefault();
        projectUploadInput.click();
    });

    projectUploadInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event) => {
            loadState(event.target.result);
        };
        reader.onerror = () => {
            console.error("Не удалось прочитать файл.");
            alert("Ошибка при чтении файла.");
        }
        reader.readAsText(file);
        e.target.value = null;
    });

    window.addEventListener('keydown', (e) => { 
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') {
            return;
        }

        if (e.ctrlKey || e.metaKey) { 
            switch(e.code) {
                case 'KeyZ': e.preventDefault(); undo(); break;
                case 'KeyY': e.preventDefault(); redo(); break;
                case 'KeyC':
                    e.preventDefault();
                    if (canvasState.selectedLayers.length > 0) {
                        clipboard = JSON.stringify(canvasState.selectedLayers.map(layer => {
                           const clonedLayer = {...layer};
                           if (layer.type === 'image' && layer.image instanceof HTMLImageElement) {
                               clonedLayer.src = layer.image.src;
                           }
                           delete clonedLayer.image;
                           return clonedLayer;
                        }));
                    }
                    break;
                case 'KeyX':
                    e.preventDefault();
                    if (canvasState.selectedLayers.length > 0) {
                        clipboard = JSON.stringify(canvasState.selectedLayers.map(layer => {
                           const clonedLayer = {...layer};
                           if (layer.type === 'image' && layer.image instanceof HTMLImageElement) {
                               clonedLayer.src = layer.image.src;
                           }
                           delete clonedLayer.image;
                           return clonedLayer;
                        }));
                        const idsToDelete = new Set(canvasState.selectedLayers.map(l => l.id));
                        canvasState.layers = canvasState.layers.filter(layer => !idsToDelete.has(layer.id));
                        canvasState.selectedLayers = [];
                        saveState(canvasState.layers);
                        redraw();
                        canvasState.updateFloatingToolbar();
                    }
                    break;
            }
            return;
        }

        switch(e.code) {
            case 'Escape':
                e.preventDefault();
                if (canvasState.currentAction.startsWith('drawing')) {
                    canvasState.currentAction = 'none';
                    canvasState.tempLayer = null;
                    redraw();
                } 
                else if (canvasState.isEditingText) {
                    const textarea = getEditorTextarea();
                    if(textarea) textarea.blur();
                }
                else if (canvasState.selectedLayers.length > 0) {
                    canvasState.selectedLayers = [];
                    redraw();
                    canvasState.updateFloatingToolbar();
                }
                break;

            case 'Delete':
            case 'Backspace':
                if (canvasState.selectedLayers.length > 0) {
                    e.preventDefault();
                    const idsToDelete = new Set(canvasState.selectedLayers.map(l => l.id));
                    canvasState.layers = canvasState.layers.filter(layer => !idsToDelete.has(layer.id));
                    canvasState.selectedLayers = [];
                    saveState(canvasState.layers);
                    redraw();
                    canvasState.updateFloatingToolbar();
                }
                break;
            
            case 'KeyV': 
                e.preventDefault();
                document.querySelector('button[data-tool="select"]')?.click();
                drawingCanvas.focus({ preventScroll: true });
                break;
            case 'KeyB':
                e.preventDefault();
                const currentTool = canvasState.activeTool;
                if (currentTool === 'brush') {
                    document.querySelector('button[data-tool="smart-brush"]')?.click();
                } else {
                    document.querySelector('button[data-tool="brush"]')?.click();
                }
                drawingCanvas.focus({ preventScroll: true });
                break;
            case 'KeyE':
                e.preventDefault();
                document.querySelector('button[data-tool="eraser"]')?.click();
                drawingCanvas.focus({ preventScroll: true });
                break;
            case 'KeyT':
                e.preventDefault();
                document.querySelector('button[data-tool="text"]')?.click();
                drawingCanvas.focus({ preventScroll: true });
                break;
            case 'KeyS':
                e.preventDefault();
                const current2DIndex = shapes2DOrder.indexOf(canvasState.activeTool);
                const next2DIndex = (current2DIndex === -1) ? 0 : (current2DIndex + 1) % shapes2DOrder.length;
                const next2DTool = shapes2DOrder[next2DIndex];
                const shape2DLink = document.querySelector(`#shapes2DOptions a[data-tool="${next2DTool}"]`);
                if (shape2DLink) {
                    shape2DLink.click();
                }
                drawingCanvas.focus({ preventScroll: true });
                break;
             case 'KeyD':
                e.preventDefault();
                const current3DIndex = shapes3DOrder.indexOf(canvasState.activeTool);
                const next3DIndex = (current3DIndex === -1) ? 0 : (current3DIndex + 1) % shapes3DOrder.length;
                const next3DTool = shapes3DOrder[next3DIndex];
                const shape3DLink = document.querySelector(`#shapes3DOptions a[data-tool="${next3DTool}"]`);
                if (shape3DLink) {
                    shape3DLink.click();
                }
                drawingCanvas.focus({ preventScroll: true });
                break;
            case 'KeyI':
                e.preventDefault();
                document.getElementById('addImageBtn')?.click();
                drawingCanvas.focus({ preventScroll: true });
                break;
        }
    });

    window.addEventListener('paste', (e) => {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') {
            return;
        }
        e.preventDefault();

        const items = e.clipboardData.items;
        for (const item of items) {
            if (item.kind === 'file' && item.type.startsWith('image/')) {
                const file = item.getAsFile();
                const centerPos = { 
                    x: (drawingCanvas.width / 2 - canvasState.panX) / canvasState.zoom, 
                    y: (drawingCanvas.height / 2 - canvasState.panY) / canvasState.zoom 
                };
                const reader = new FileReader();
                reader.onload = (event) => {
                    const img = new Image();
                    img.onload = () => {
                        const newLayer = { type: 'image', image: img, x: centerPos.x - img.width / 2, y: centerPos.y - img.height / 2, width: img.width, height: img.height, id: Date.now(), rotation: 0, pivot: { x: 0, y: 0 } };
                        canvasState.layers.push(newLayer);
                        canvasState.selectedLayers = [newLayer];
                        const selectButton = document.querySelector('button[data-tool="select"]');
                        if (selectButton) {
                            selectButton.click();
                        }
                        saveState(canvasState.layers);
                        redraw();
                        canvasState.updateFloatingToolbar();
                    };
                    img.src = event.target.result;
                };
                reader.readAsDataURL(file);
                return;
            }
        }
        
        if (clipboard) {
            try {
                const layersToPaste = JSON.parse(clipboard);
                const newLayers = [];

                layersToPaste.forEach(layer => {
                    const newLayer = { ...layer };
                    newLayer.id = Date.now() + Math.random();

                    const offset = 20 / canvasState.zoom;

                    if (newLayer.x !== undefined) { newLayer.x += offset; newLayer.y += offset; }
                    if (newLayer.cx !== undefined) { newLayer.cx += offset; newLayer.cy += offset; }
                    if (newLayer.x1 !== undefined) { newLayer.x1 += offset; newLayer.y1 += offset; newLayer.x2 += offset; newLayer.y2 += offset; }
                    if (newLayer.points) { newLayer.points.forEach(p => { p.x += offset; p.y += offset; }); }
                    if (newLayer.p1) {
                         const points = ['p1', 'p2', 'p3', 'p4', 'base', 'top', 'apex'];
                         for(const key of points){
                             if(newLayer[key]?.x) { newLayer[key].x += offset; newLayer[key].y += offset;}
                             else if(typeof newLayer[key] === 'object'){
                                 for(const subKey in newLayer[key]){
                                     if(newLayer[key][subKey]?.x) { newLayer[key][subKey].x += offset; newLayer[key][subKey].y += offset;}
                                 }
                             }
                         }
                    }
                    
                    if (newLayer.type === 'image' && newLayer.src) {
                        const img = new Image();
                        img.onload = () => {
                            newLayer.image = img;
                            redraw();
                        }
                        img.src = newLayer.src;
                    }
                    
                    canvasState.layers.push(newLayer);
                    newLayers.push(newLayer);
                });
                
                canvasState.selectedLayers = newLayers;

                const selectButton = document.querySelector('button[data-tool="select"]');
                if (selectButton) {
                    selectButton.click();
                }

                saveState(canvasState.layers);
                redraw();
                canvasState.updateFloatingToolbar();

            } catch (err) {
                console.error("Не удалось вставить из буфера обмена:", err);
            }
        }
    });

    // --- НАЧАЛО ИЗМЕНЕНИЙ: Логика сброса позиции панели инструментов при изменении размера окна ---
    window.addEventListener('resize', () => {
        setupCanvases();
        if (canvasState) canvasState.updateFloatingToolbar();

        // Сбрасываем инлайн-стили, чтобы CSS-правило центрирования снова сработало
        const toolbarWrapper = document.getElementById('toolbarWrapper');
        if (toolbarWrapper) {
            toolbarWrapper.style.left = '';
            toolbarWrapper.style.transform = '';
        }
    });
    // --- КОНЕЦ ИЗМЕНЕНИЙ ---

    function initializeFloatingTextToolbar() {
        const toolbar = document.getElementById('floating-text-toolbar');
        const colorPalette = document.getElementById('colorPalette');
        const floatingPalette = document.getElementById('floatingColorPalette');
        const colorPicker = document.getElementById('floating-color-picker');
        floatingPalette.innerHTML = colorPalette.innerHTML;

        toolbar.addEventListener('mousedown', (e) => {
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') {
                return;
            }
            e.preventDefault();
            const textarea = getEditorTextarea();
            if (textarea) {
                textarea.style.pointerEvents = 'none';
            }
        });

        document.addEventListener('mouseup', () => {
            const textarea = getEditorTextarea();
            if (textarea) {
                textarea.style.pointerEvents = 'auto';
            }
        });

        const applyChange = (callback) => {
            if (canvasState) {
                const layer = canvasState.isEditingText 
                    ? canvasState.layers.find(l => l.isEditing) 
                    : (canvasState.selectedLayers.length === 1 && canvasState.selectedLayers[0].type === 'text' ? canvasState.selectedLayers[0] : null);
                
                if (layer) {
                    callback(layer);
                    canvasState.activeFontFamily = layer.fontFamily;
                    canvasState.activeFontSize = layer.fontSize;
                    canvasState.activeFontWeight = layer.fontWeight;
                    canvasState.activeFontStyle = layer.fontStyle;
                    canvasState.activeTextDecoration = layer.textDecoration;
                    canvasState.activeTextAlign = layer.align;
                    canvasState.activeColor = layer.color;
                    saveState(canvasState.layers);
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
                if (!action || action === 'pick-color') return;
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
                    const mainPalette = document.getElementById('colorPalette');
                    mainPalette.querySelectorAll('.active').forEach(el => el.classList.remove('active'));
                    const newActive = mainPalette.querySelector(`[data-color="${newColor}"]`);
                    if (newActive) newActive.classList.add('active');
                });
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
            tooltip.style.left = `${targetRect.left + targetRect.width / 2}px`;
            tooltip.style.top = `${targetRect.top}px`;
        });

        document.body.addEventListener('mouseout', (e) => {
            const target = e.target.closest('[data-original-title]');
            if (!target) return;

            target.setAttribute('title', target.dataset.originalTitle);
            target.removeAttribute('data-original-title');
            
            tooltip.classList.remove('visible');
        });
    }

    function initializeHelpModal() {
        const helpBtn = document.getElementById('helpBtn');
        const helpModal = document.getElementById('helpModal');
        const closeHelpBtn = document.getElementById('closeHelpBtn');

        for (const panelId in helpContent) {
            const panel = document.getElementById(panelId);
            if (panel) {
                panel.innerHTML = helpContent[panelId];
            }
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
    initializeHelpModal();

    const settingsBtn = document.getElementById('settingsBtn');
    const settingsModal = document.getElementById('settingsModal');
    const okBtn = document.getElementById('okSettings');
    const cancelBtn = document.getElementById('cancelSettings');
    const themeSelect = document.getElementById('theme-select');
    const backgroundStyleSelect = document.getElementById('background-style-select');
    const smoothingSlider = document.getElementById('smoothing-slider');
    const smoothingValue = document.getElementById('smoothing-value');

    function applyAndSaveSettings() { 
        const theme = themeSelect.value; 
        const backgroundStyle = backgroundStyleSelect.value;
        const smoothing = smoothingSlider.value;
        
        document.body.classList.toggle('dark-theme', theme === 'dark'); 
        
        localStorage.setItem('boardTheme', theme); 
        localStorage.setItem('boardBackgroundStyle', backgroundStyle);
        localStorage.setItem('boardSmoothing', smoothing);

        if (canvasState) {
            canvasState.smoothingAmount = parseInt(smoothing, 10);
        }
        redraw(); 
    }
    
    function loadSettings() { 
        const savedTheme = localStorage.getItem('boardTheme') || 'light'; 
        const savedStyle = localStorage.getItem('boardBackgroundStyle') || 'dot'; 
        const savedSmoothing = localStorage.getItem('boardSmoothing') || '2';

        themeSelect.value = savedTheme; 
        backgroundStyleSelect.value = savedStyle; 
        smoothingSlider.value = savedSmoothing; 
        smoothingValue.textContent = savedSmoothing;

        document.body.classList.toggle('dark-theme', savedTheme === 'dark'); 
        
        if (canvasState) {
            canvasState.smoothingAmount = parseInt(savedSmoothing, 10);
        }
        redraw(); 
    }
    
    smoothingSlider.addEventListener('input', () => {
        smoothingValue.textContent = smoothingSlider.value;
    });

    function closeModal() { settingsModal.classList.add('hidden'); }
    settingsBtn.addEventListener('click', (e) => { e.preventDefault(); loadSettings(); settingsModal.classList.remove('hidden'); });
    okBtn.addEventListener('click', () => { applyAndSaveSettings(); closeModal(); });
    cancelBtn.addEventListener('click', closeModal);
    settingsModal.addEventListener('click', (e) => { if (e.target === settingsModal) { closeModal(); } });
    
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
});

function rotatePoint(point, pivot, angle) {
    const s = Math.sin(angle);
    const c = Math.cos(angle);
    const px = point.x - pivot.x;
    const py = point.y - pivot.y;
    const xnew = px * c - py * s;
    const ynew = px * s + py * c;
    return {
        x: xnew + pivot.x,
        y: ynew + pivot.y,
    };
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


function drawLayer(ctx, layer) {
    if (!layer || layer.isEditing) return;
    ctx.save();
    
    const rotation = layer.rotation || 0;
    if (rotation) {
        const box = getBoundingBox(layer);
        if (box) {
            const centerX = box.x + box.width / 2;
            const centerY = box.y + box.height / 2;
            
            const pivot = layer.pivot || { x: 0, y: 0 };
            
            const rotatedPivotOffset = rotatePoint(pivot, {x: 0, y: 0}, rotation);
            
            const pivotX = centerX + rotatedPivotOffset.x;
            const pivotY = centerY + rotatedPivotOffset.y;
            
            ctx.translate(pivotX, pivotY);
            ctx.rotate(rotation);
            ctx.translate(-pivotX, -pivotY);
        }
    }

    ctx.strokeStyle = layer.color;
    ctx.fillStyle = layer.color;
    ctx.lineWidth = layer.lineWidth;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    
    if (layer.type === 'path') {
        if (layer.points.length < 1) { ctx.restore(); return; }
        if (layer.points.length === 1) {
            ctx.beginPath();
            const point = layer.points[0];
            const pressure = point.pressure || 0.5;
            const radius = Math.max(0.5, (layer.lineWidth * pressure) / 2);
            ctx.arc(point.x, point.y, radius, 0, 2 * Math.PI);
            ctx.fill();
        } else {
            const points = layer.points;
            if (points.length < 3) {
                ctx.beginPath();
                ctx.moveTo(points[0].x, points[0].y);
                for (let i = 1; i < points.length; i++) {
                    const pressure = points[i-1].pressure || 0.5;
                    ctx.lineWidth = Math.max(1, layer.lineWidth * pressure);
                    ctx.lineTo(points[i].x, points[i].y);
                }
                ctx.stroke();
            } else {
                for (let i = 0; i < points.length - 1; i++) {
                    const p0 = i > 0 ? points[i - 1] : points[i];
                    const p1 = points[i];
                    const p2 = points[i + 1];
                    const p3 = i < points.length - 2 ? points[i + 2] : p2;

                    const cp1 = { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 };
                    const cp2 = { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 };
                    
                    ctx.beginPath();
                    ctx.moveTo(p1.x, p1.y);
                    
                    const pressure = p1.pressure || 0.5;
                    ctx.lineWidth = Math.max(1, layer.lineWidth * pressure);

                    ctx.bezierCurveTo(cp1.x, cp1.y, cp2.x, cp2.y, p2.x, p2.y);
                    ctx.stroke();
                }
            }
        }
    }
    else if (layer.type === 'rect') { ctx.beginPath(); ctx.strokeRect(layer.x, layer.y, layer.width, layer.height); }
    else if (layer.type === 'ellipse') { ctx.beginPath(); ctx.ellipse(layer.cx, layer.cy, layer.rx, layer.ry, 0, 0, 2 * Math.PI); ctx.stroke(); }
    else if (layer.type === 'line') { ctx.beginPath(); ctx.moveTo(layer.x1, layer.y1); ctx.lineTo(layer.x2, layer.y2); ctx.stroke(); }
    else if (layer.type === 'parallelogram') { ctx.beginPath(); ctx.moveTo(layer.x, layer.y + layer.height); ctx.lineTo(layer.x + layer.width, layer.y + layer.height); ctx.lineTo(layer.x + layer.width + layer.slantOffset, layer.y); ctx.lineTo(layer.x + layer.slantOffset, layer.y); ctx.closePath(); ctx.stroke(); }
    else if (layer.type === 'triangle') { ctx.beginPath(); ctx.moveTo(layer.p1.x, layer.p1.y); ctx.lineTo(layer.p2.x, layer.p2.y); ctx.lineTo(layer.p3.x, layer.p3.y); ctx.closePath(); ctx.stroke(); }
    else if (layer.type === 'text') {
        const fontWeight = layer.fontWeight || 'normal';
        const fontStyle = layer.fontStyle || 'normal';
        ctx.font = `${fontStyle} ${fontWeight} ${layer.fontSize}px ${layer.fontFamily}`;
        ctx.textBaseline = 'top';
        
        const lines = wrapText(ctx, layer.content, layer.width);
        
        const align = layer.align || 'left';
        ctx.textAlign = align;
        let x;
        if (align === 'center') {
            x = layer.x + layer.width / 2;
        } else if (align === 'right') {
            x = layer.x + layer.width;
        } else {
            x = layer.x;
        }

        const lineHeight = layer.fontSize * 1.2;
        lines.forEach((line, index) => {
            const y = layer.y + index * lineHeight;
            ctx.fillText(line, x, y);

            if (layer.textDecoration === 'underline') {
                const metrics = ctx.measureText(line);
                const lineY = y + layer.fontSize + 2;
                
                let startX, endX;
                if (align === 'center') {
                    startX = x - metrics.width / 2;
                    endX = x + metrics.width / 2;
                } else if (align === 'right') {
                    startX = x - metrics.width;
                    endX = x;
                } else { // left
                    startX = x;
                    endX = x + metrics.width;
                }
                ctx.beginPath();
                ctx.moveTo(startX, lineY);
                ctx.lineTo(endX, lineY);
                ctx.strokeStyle = layer.color;
                ctx.lineWidth = Math.max(1, layer.fontSize / 15);
                ctx.stroke();
            }
        });
    }
    else if (layer.type === 'sphere') { const { cx, cy, r } = layer; const equatorRy = r * 0.3, meridianRx = r * 0.5; ctx.setLineDash([]); ctx.beginPath(); ctx.arc(cx, cy, r, 0, 2 * Math.PI); ctx.stroke(); ctx.beginPath(); ctx.ellipse(cx, cy, r, equatorRy, 0, 0, Math.PI); ctx.stroke(); ctx.setLineDash([5, 5]); ctx.beginPath(); ctx.ellipse(cx, cy, r, equatorRy, 0, Math.PI, 2 * Math.PI); ctx.stroke(); ctx.setLineDash([5, 5]); ctx.beginPath(); ctx.ellipse(cx, cy, meridianRx, r, 0, -Math.PI / 2, Math.PI / 2); ctx.stroke(); ctx.setLineDash([]); ctx.beginPath(); ctx.ellipse(cx, cy, meridianRx, r, 0, Math.PI / 2, 3 * Math.PI / 2); ctx.stroke(); ctx.setLineDash([]); }
    else if (layer.type === 'cone') { const { cx, baseY, rx, ry, apex } = layer; ctx.setLineDash([]); ctx.beginPath(); ctx.moveTo(cx - rx, baseY); ctx.lineTo(apex.x, apex.y); ctx.lineTo(cx + rx, baseY); ctx.stroke(); ctx.beginPath(); ctx.ellipse(cx, baseY, rx, ry, 0, 0, Math.PI); ctx.stroke(); ctx.setLineDash([5, 5]); ctx.beginPath(); ctx.ellipse(cx, baseY, rx, ry, 0, Math.PI, 2 * Math.PI); ctx.stroke(); ctx.setLineDash([]); }
    else if (layer.type === 'parallelepiped') { const { x, y, width, height, depthOffset } = layer; const dx = depthOffset.x, dy = depthOffset.y; const p = [ {x, y}, {x: x + width, y}, {x: x + width, y: y + height}, {x, y: y + height}, {x: x + dx, y: y + dy}, {x: x + width + dx, y: y + dy}, {x: x + width + dx, y: y + height + dy}, {x: x + dx, y: y + height + dy} ]; ctx.setLineDash([]); ctx.beginPath(); ctx.moveTo(p[0].x, p[0].y); ctx.lineTo(p[1].x, p[1].y); ctx.lineTo(p[2].x, p[2].y); ctx.lineTo(p[3].x, p[3].y); ctx.closePath(); ctx.moveTo(p[1].x, p[1].y); ctx.lineTo(p[5].x, p[5].y); ctx.lineTo(p[6].x, p[6].y); ctx.lineTo(p[2].x, p[2].y); ctx.moveTo(p[0].x, p[0].y); ctx.lineTo(p[4].x, p[4].y); ctx.lineTo(p[5].x, p[5].y); ctx.stroke(); ctx.setLineDash([5, 5]); ctx.beginPath(); ctx.moveTo(p[3].x, p[3].y); ctx.lineTo(p[7].x, p[7].y); ctx.lineTo(p[4].x, p[4].y); ctx.moveTo(p[6].x, p[6].y); ctx.lineTo(p[7].x, p[7].y); ctx.stroke(); ctx.setLineDash([]); }
    else if (layer.type === 'pyramid') {
        const { base, apex } = layer;
        const p = [ base.p1, base.p2, base.p3, base.p4 ];
        
        ctx.setLineDash([5, 5]);
        ctx.beginPath();
        ctx.moveTo(p[3].x, p[3].y); ctx.lineTo(p[0].x, p[0].y); 
        ctx.moveTo(p[3].x, p[3].y); ctx.lineTo(p[2].x, p[2].y); 
        ctx.moveTo(p[3].x, p[3].y); ctx.lineTo(apex.x, apex.y); 
        ctx.stroke();
        
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(p[0].x, p[0].y); ctx.lineTo(p[1].x, p[1].y); 
        ctx.moveTo(p[1].x, p[1].y); ctx.lineTo(p[2].x, p[2].y); 
        ctx.moveTo(p[0].x, p[0].y); ctx.lineTo(apex.x, apex.y); 
        ctx.moveTo(p[1].x, p[1].y); ctx.lineTo(apex.x, apex.y); 
        ctx.moveTo(p[2].x, p[2].y); ctx.lineTo(apex.x, apex.y); 
        ctx.stroke();
    }
    else if (layer.type === 'trapezoid' || layer.type === 'rhombus') { ctx.beginPath(); ctx.moveTo(layer.p1.x, layer.p1.y); ctx.lineTo(layer.p2.x, layer.p2.y); ctx.lineTo(layer.p3.x, layer.p3.y); ctx.lineTo(layer.p4.x, layer.p4.y); ctx.closePath(); ctx.stroke(); }
    else if (layer.type === 'frustum') { const { cx, baseY, topY, rx1, ry1, rx2, ry2 } = layer; ctx.setLineDash([]); ctx.beginPath(); ctx.moveTo(cx - rx1, baseY); ctx.lineTo(cx - rx2, topY); ctx.moveTo(cx + rx1, baseY); ctx.lineTo(cx + rx2, topY); ctx.stroke(); ctx.beginPath(); ctx.ellipse(cx, baseY, rx1, ry1, 0, 0, Math.PI); ctx.stroke(); ctx.setLineDash([5, 5]); ctx.beginPath(); ctx.ellipse(cx, baseY, rx1, ry1, 0, Math.PI, 2 * Math.PI); ctx.stroke(); ctx.setLineDash([]); ctx.beginPath(); ctx.ellipse(cx, topY, rx2, ry2, 0, 0, 2 * Math.PI); ctx.stroke(); ctx.setLineDash([]); }
    else if (layer.type === 'truncated-sphere') { const { cx, cy, r, cutY, cutR, cutRy } = layer; const sinAngle = (cutY - cy) / r; const clampedSinAngle = Math.max(-1, Math.min(1, sinAngle)); const angle = Math.asin(clampedSinAngle); ctx.setLineDash([]); ctx.beginPath(); ctx.arc(cx, cy, r, angle, Math.PI - angle); ctx.stroke(); ctx.beginPath(); ctx.ellipse(cx, cutY, cutR, cutRy, 0, 0, Math.PI); ctx.stroke(); ctx.setLineDash([5, 5]); ctx.beginPath(); ctx.ellipse(cx, cutY, cutR, cutRy, 0, Math.PI, 2 * Math.PI); ctx.stroke(); ctx.setLineDash([]); }
    else if (layer.type === 'truncated-pyramid') {
        const { base, top } = layer;
        const b = [ base.p1, base.p2, base.p3, base.p4 ];
        const t = [ top.p1, top.p2, top.p3, top.p4 ];
        
        ctx.setLineDash([5, 5]);
        ctx.beginPath();
        ctx.moveTo(b[3].x, b[3].y); ctx.lineTo(b[0].x, b[0].y); 
        ctx.moveTo(b[3].x, b[3].y); ctx.lineTo(b[2].x, b[2].y); 
        ctx.moveTo(b[3].x, b[3].y); ctx.lineTo(t[3].x, t[3].y); 
        ctx.stroke();

        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(b[0].x, b[0].y); ctx.lineTo(b[1].x, b[1].y); 
        ctx.lineTo(b[2].x, b[2].y); 
        ctx.moveTo(t[0].x, t[0].y); ctx.lineTo(t[1].x, t[1].y); 
        ctx.lineTo(t[2].x, t[2].y); 
        ctx.moveTo(b[0].x, b[0].y); ctx.lineTo(t[0].x, t[0].y); 
        ctx.moveTo(b[1].x, b[1].y); ctx.lineTo(t[1].x, t[1].y); 
        ctx.moveTo(b[2].x, b[2].y); ctx.lineTo(t[2].x, t[2].y); 
        ctx.moveTo(t[3].x, t[3].y); ctx.lineTo(t[2].x, t[2].y); 
        ctx.moveTo(t[3].x, t[3].y); ctx.lineTo(t[0].x, t[0].y); 
        ctx.stroke();
    }
    else if (layer.type === 'image' && layer.image instanceof HTMLImageElement && layer.image.complete) { 
        ctx.drawImage(layer.image, layer.x, layer.y, layer.width, layer.height); 
    }
    ctx.restore();
}

function redrawCanvas(canvasState) {
    if(!canvasState) return;
    const { ctx, layers, canvas } = canvasState;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.translate(canvasState.panX, canvasState.panY);
    ctx.scale(canvasState.zoom, canvasState.zoom);
    layers.forEach(layer => drawLayer(ctx, layer));
    drawSelectionBox(ctx, canvasState.selectedLayers, canvasState);
    ctx.restore();
}

function drawBackground(bgCanvas, canvasState) {
    const bgCtx = bgCanvas.getContext('2d');
    const style = localStorage.getItem('boardBackgroundStyle') || 'dot';
    const theme = localStorage.getItem('boardTheme') || 'light';
    const color = theme === 'light' ? '#d1d1d1' : '#5a5a5a';
    const spacing = 20;
    bgCtx.clearRect(0, 0, bgCanvas.width, bgCanvas.height);
    if (!canvasState) { if (style === 'dot') { for (let x = 0; x < bgCanvas.width; x += spacing) { for (let y = 0; y < bgCanvas.height; y += spacing) { bgCtx.fillStyle = color; bgCtx.beginPath(); bgCtx.arc(x, y, 1, 0, 2 * Math.PI, false); bgCtx.fill(); } } } else { bgCtx.strokeStyle = color; bgCtx.lineWidth = 0.5; for (let x = 0; x < bgCanvas.width; x += spacing) { bgCtx.beginPath(); bgCtx.moveTo(x, 0); bgCtx.lineTo(x, bgCanvas.height); bgCtx.stroke(); } for (let y = 0; y < bgCanvas.height; y += spacing) { bgCtx.beginPath(); bgCtx.moveTo(0, y); bgCtx.lineTo(bgCanvas.width, y); bgCtx.stroke(); } } return; }
    const { panX, panY, zoom } = canvasState;
    const visualSpacing = spacing * zoom;
    if (visualSpacing < 5) return;
    const startX = panX % visualSpacing;
    const startY = panY % visualSpacing;
    if (style === 'dot') { bgCtx.fillStyle = color; for (let x = startX; x < bgCanvas.width; x += visualSpacing) { for (let y = startY; y < bgCanvas.height; y += visualSpacing) { bgCtx.beginPath(); bgCtx.arc(x, y, 1, 0, 2 * Math.PI, false); bgCtx.fill(); } } } 
    else { bgCtx.strokeStyle = color; bgCtx.lineWidth = 0.5; for (let x = startX; x < bgCanvas.width; x += visualSpacing) { bgCtx.beginPath(); bgCtx.moveTo(x, 0); bgCtx.lineTo(x, bgCanvas.height); bgCtx.stroke(); } for (let y = startY; y < bgCanvas.height; y += visualSpacing) { bgCtx.beginPath(); bgCtx.moveTo(0, y); bgCtx.lineTo(bgCanvas.width, y); bgCtx.stroke(); } }
}

function drawSelectionBox(ctx, selectedLayers, canvasState) {
    if (!selectedLayers || selectedLayers.length === 0 || !canvasState) return;
    if (selectedLayers.some(l => l.isEditing)) return;

    const box = selectedLayers.length > 1 ? getGroupBoundingBox(selectedLayers) : getBoundingBox(selectedLayers[0]);
    if (!box) return;

    const isSingleSelection = selectedLayers.length === 1;
    const layer = isSingleSelection ? selectedLayers[0] : null;
    
    const zoom = canvasState.zoom;
    const scaledLineWidth = 1 / zoom;
    const scaledHandleSize = 8 / zoom;
    const scaledHalfHandle = scaledHandleSize / 2;
    const scaledDash = [5 / zoom, 5 / zoom];
    
    const rotation = getSelectionRotation(selectedLayers, canvasState.groupRotation);
    const centerX = box.x + box.width / 2;
    const centerY = box.y + box.height / 2;
    
    let pivotX = centerX;
    let pivotY = centerY;

    if (isSingleSelection && layer && layer.pivot) {
        const rotatedPivotOffset = rotatePoint(layer.pivot, {x:0, y:0}, rotation);
        pivotX = centerX + rotatedPivotOffset.x;
        pivotY = centerY + rotatedPivotOffset.y;
    }

    ctx.save();
    ctx.translate(pivotX, pivotY);
    ctx.rotate(rotation);
    ctx.translate(-pivotX, -pivotY);

    ctx.strokeStyle = '#007AFF';
    ctx.lineWidth = scaledLineWidth;
    ctx.setLineDash(scaledDash);
    ctx.strokeRect(box.x, box.y, box.width, box.height);
    ctx.setLineDash([]);
    ctx.fillStyle = '#007AFF';

    const handles = [
        { x: box.x, y: box.y }, { x: centerX, y: box.y }, { x: box.x + box.width, y: box.y },
        { x: box.x, y: centerY }, { x: box.x + box.width, y: centerY },
        { x: box.x, y: box.y + box.height }, { x: centerX, y: box.y + box.height }, { x: box.x + box.width, y: box.y + box.height }
    ];
    handles.forEach(handle => {
        ctx.fillRect(handle.x - scaledHalfHandle, handle.y - scaledHalfHandle, scaledHandleSize, scaledHandleSize);
    });
    
    const rotationHandleY = box.y - 20 / zoom;
    ctx.beginPath();
    ctx.moveTo(centerX, box.y);
    ctx.lineTo(centerX, rotationHandleY);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(centerX, rotationHandleY, scaledHalfHandle, 0, 2 * Math.PI);
    ctx.fill();
    
    ctx.restore();

    if (isSingleSelection) {
        ctx.save();
        ctx.strokeStyle = '#007AFF';
        ctx.lineWidth = scaledLineWidth;
        ctx.beginPath();
        ctx.arc(pivotX, pivotY, scaledHalfHandle, 0, 2 * Math.PI);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(pivotX - scaledHalfHandle, pivotY);
        ctx.lineTo(pivotX + scaledHalfHandle, pivotY);
        ctx.moveTo(pivotX, pivotY - scaledHalfHandle);
        ctx.lineTo(pivotX, pivotY + scaledHalfHandle);
        ctx.stroke();
        ctx.restore();
    }
}
// --- END OF FILE main.js ---