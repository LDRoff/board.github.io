// --- START OF FILE js/toolbar.js ---

export function initializeToolbar(canvasState, redrawCallback, updateToolbarCallback) {
    const toolbarWrapper = document.getElementById('toolbarWrapper');
    const toolbar = document.getElementById('toolbar');
    
    // --- НАЧАЛО ИЗМЕНЕНИЙ: Удалены ссылки на старую текстовую панель ---
    const drawingSubToolbar = document.getElementById('drawingSubToolbar');
    const colorPalette = document.getElementById('colorPalette');
    const lineWidthSlider = document.getElementById('lineWidthSlider');
    // --- КОНЕЦ ИЗМЕНЕНИЙ ---

    const lineWidthIndicator = document.getElementById('lineWidthIndicator');
    
    const shapes2DBtn = document.getElementById('shapes2DBtn');
    const shapes2DOptions = document.getElementById('shapes2DOptions');
    const shapes2DToolContainer = document.getElementById('shapes-2d-tool-container');

    const shapes3DBtn = document.getElementById('shapes3DBtn');
    const shapes3DOptions = document.getElementById('shapes3DOptions');
    const shapes3DToolContainer = document.getElementById('shapes-3d-tool-container');

    const zoomControls = document.getElementById('zoomControls');

    function cancelInProgressActions() {
        const multiStepActions = [
            'drawingParallelogramSlant', 'drawingTriangleApex', 'drawingParallelepipedDepth',
            'drawingPyramidApex', 'drawingTrapezoidP3', 'drawingTrapezoidP4', 
            'drawingFrustum', 'drawingTruncatedSphere', 'drawingTruncatedPyramidApex', 'drawingTruncatedPyramidTop'
        ];
        if (multiStepActions.includes(canvasState.currentAction)) {
            canvasState.currentAction = 'none';
            canvasState.tempLayer = null;
            redrawCallback();
        }
    }

    shapes2DBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        shapes2DToolContainer.classList.toggle('active');
        shapes3DToolContainer.classList.remove('active');
    });

    shapes3DBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        shapes3DToolContainer.classList.toggle('active');
        shapes2DToolContainer.classList.remove('active');
    });

    function handleShapeSelection(e, mainButton, container) {
        e.preventDefault();
        const option = e.target.closest('a');
        if (!option) return;
        const tool = option.dataset.tool;
        if (!tool) return;
        
        cancelInProgressActions();
        mainButton.innerHTML = option.querySelector('svg').outerHTML;
        canvasState.activeTool = tool;
        if (canvasState.activeTool !== 'select') {
            canvasState.previousTool = canvasState.activeTool;
        }
        
        toolbar.querySelectorAll('button').forEach(btn => btn.classList.remove('active'));
        zoomControls.querySelectorAll('button').forEach(btn => btn.classList.remove('active'));
        mainButton.classList.add('active');
        
        canvasState.selectedLayers = [];
        redrawCallback();
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
        if (!button || button.dataset.toolGroup === 'shapes') return;
        if (button.id === 'addImageBtn' || button.id === 'undoBtn' || button.id === 'redoBtn') {
            if (button.id === 'addImageBtn') document.getElementById('imageUpload').click();
            return;
        }
        const tool = button.dataset.tool;
        if (!tool) return;
        cancelInProgressActions();
        if (canvasState.activeTool !== tool && canvasState.activeTool !== 'select') {
            canvasState.previousTool = canvasState.activeTool;
        }
        canvasState.activeTool = tool;
        
        toolbar.querySelectorAll('button').forEach(btn => btn.classList.remove('active'));
        zoomControls.querySelectorAll('button').forEach(btn => btn.classList.remove('active'));
        if (button.dataset.tool) button.classList.add('active');
        
        if (tool !== 'select') { 
            canvasState.selectedLayers = []; 
            redrawCallback(); 
            canvasState.updateFloatingToolbar();
        }
        
        const canvas = canvasState.canvas;
        canvas.classList.remove('cursor-brush', 'cursor-eraser');
        canvas.style.cursor = '';

        if (tool === 'brush' || tool === 'smart-brush') {
            canvas.classList.add('cursor-brush');
        } else if (tool === 'eraser') {
            canvas.classList.add('cursor-eraser');
        } else if (tool === 'text') {
            canvas.style.cursor = 'text';
        } else {
            canvas.style.cursor = 'default';
        }

        updateToolbarCallback();
    });

    zoomControls.addEventListener('click', (e) => {
        const button = e.target.closest('button');
        if (!button) return;

        const tool = button.dataset.tool;
        if (tool === 'pan') {
            cancelInProgressActions();
            canvasState.activeTool = 'pan';

            toolbar.querySelectorAll('button').forEach(btn => btn.classList.remove('active'));
            zoomControls.querySelectorAll('button').forEach(btn => btn.classList.remove('active'));
            
            button.classList.add('active');

            canvasState.selectedLayers = [];
            redrawCallback();
            const canvas = canvasState.canvas;
            canvas.classList.remove('cursor-brush', 'cursor-eraser');
            canvas.style.cursor = 'grab';

            updateToolbarCallback();
        }
    });

    function handleColorChange(newColor) {
        if (canvasState.selectedLayers.length > 0) {
            canvasState.selectedLayers.forEach(layer => {
                if (layer.hasOwnProperty('color') && layer.type !== 'text') { // Не меняем цвет текста здесь
                    layer.color = newColor;
                }
            });
            redrawCallback();
            canvasState.saveState(canvasState.layers);
        }

        canvasState.activeColor = newColor; 

        colorPalette.querySelectorAll('.active').forEach(el => el.classList.remove('active')); 
        const activeDot = colorPalette.querySelector(`[data-color="${newColor}"]`);
        if (activeDot) activeDot.classList.add('active');
    }

    colorPalette.addEventListener('click', (e) => { 
        const target = e.target.closest('[data-color]'); 
        if (target) { 
            handleColorChange(target.dataset.color);
        } 
    });

    lineWidthSlider.addEventListener('input', (e) => { 
        const newWidth = parseInt(e.target.value, 10);

        if (canvasState.activeTool === 'select' && canvasState.selectedLayers.length > 0) {
            canvasState.selectedLayers.forEach(layer => {
                if (layer.hasOwnProperty('lineWidth')) {
                    layer.lineWidth = newWidth;
                }
            });
            redrawCallback();
        }
        
        canvasState.activeLineWidth = newWidth; 
    });

    lineWidthSlider.addEventListener('change', () => {
        if (canvasState.activeTool === 'select' && canvasState.selectedLayers.length > 0) {
            canvasState.saveState(canvasState.layers);
        }
    });

    document.getElementById('toggleToolbar').addEventListener('click', () => { toolbarWrapper.classList.toggle('collapsed'); });
    const logo = document.getElementById('logo'), settingsMenu = document.getElementById('settingsMenu'), clearCanvasBtn = document.getElementById('clearCanvas'), dragHandle = document.querySelector('.toolbar-drag-handle');
    logo.addEventListener('click', (e) => { e.stopPropagation(); settingsMenu.style.display = settingsMenu.style.display === 'block' ? 'none' : 'block'; });
    clearCanvasBtn.addEventListener('click', (e) => { e.preventDefault(); if (confirm('Вы уверены, что хотите очистить всю доску?')) { canvasState.layers = []; canvasState.selectedLayers = []; const externalSaveState = canvasState.saveState; if(externalSaveState) externalSaveState(canvasState.layers); redrawCallback(); } });
    
    document.addEventListener('click', (e) => {
        if (!settingsMenu.contains(e.target) && e.target !== logo) { settingsMenu.style.display = 'none'; }
        if (!shapes2DToolContainer.contains(e.target)) { shapes2DToolContainer.classList.remove('active'); }
        if (!shapes3DToolContainer.contains(e.target)) { shapes3DToolContainer.classList.remove('active'); }
    });
    
    let isDragging = false, offsetX;
    dragHandle.addEventListener('mousedown', (e) => { isDragging = true; const rect = toolbarWrapper.getBoundingClientRect(); offsetX = e.clientX - rect.left; document.body.style.userSelect = 'none'; });
    document.addEventListener('mousemove', (e) => { if (isDragging) { const toolbarWidth = toolbarWrapper.offsetWidth; const windowWidth = window.innerWidth; let newLeft = e.clientX - offsetX; if (newLeft < 0) newLeft = 0; if (newLeft + toolbarWidth > windowWidth) newLeft = windowWidth - toolbarWidth; toolbarWrapper.style.left = `${newLeft}px`; toolbarWrapper.style.transform = 'none'; } });
    document.addEventListener('mouseup', () => { isDragging = false; document.body.style.userSelect = 'auto'; });

    function updateIndicatorPosition() {
        const slider = lineWidthSlider;
        const indicator = lineWidthIndicator;
        
        const min = parseFloat(slider.min);
        const max = parseFloat(slider.max);
        const val = parseFloat(slider.value);

        const percentage = (val - min) / (max - min);
        
        const sliderRect = slider.getBoundingClientRect();
        const thumbX = sliderRect.left + (sliderRect.width * percentage);
        const thumbY = sliderRect.top;

        indicator.style.width = `${val}px`;
        indicator.style.height = `${val}px`;
        indicator.style.left = `${thumbX}px`;
        indicator.style.top = `${thumbY}px`;
    }

    function showIndicator(e) {
        if (e.pointerType === 'touch') {
            e.preventDefault();
        }
        lineWidthIndicator.classList.add('visible');
        updateIndicatorPosition();
    }

    function hideIndicator() {
        lineWidthIndicator.classList.remove('visible');
    }

    lineWidthSlider.addEventListener('input', updateIndicatorPosition);
    lineWidthSlider.addEventListener('pointerdown', showIndicator);
    document.addEventListener('pointerup', hideIndicator);
}
// --- END OF FILE toolbar.js ---