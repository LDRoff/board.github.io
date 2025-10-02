// --- START OF FILE js/utils.js ---

import { getBoundingBox, rotatePoint } from './geometry.js';

const GRID_SPACING = 20;

export function snapToGrid(value) {
    return Math.round(value / GRID_SPACING) * GRID_SPACING;
}

export function getMousePos(e, state) {
    const rect = state.canvas.getBoundingClientRect();
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;
    return {
        x: (screenX - state.panX) / state.zoom,
        y: (screenY - state.panY) / state.zoom,
    };
}

// --- НАЧАЛО ИЗМЕНЕНИЙ: Новая переиспользуемая функция для рендеринга PDF ---
/**
 * Рендерит указанную страницу PDF-слоя в новый canvas с высоким качеством,
 * основанным на текущем размере слоя, и кэширует результат.
 * @param {object} layer - Слой PDF.
 * @param {number} pageNum - Номер страницы для рендеринга.
 * @returns {Promise<void>}
 */
export async function renderPdfPageToCanvas(layer, pageNum) {
    if (!layer.pdfDoc) return;
    try {
        const page = await layer.pdfDoc.getPage(pageNum);
        
        // Рассчитываем необходимый масштаб для качественного рендеринга.
        // Берем ширину слоя и умножаем на коэффициент плотности пикселей (например, 1.5) для четкости.
        const unscaledViewport = page.getViewport({ scale: 1 });
        const scale = (layer.width / unscaledViewport.width) * 1.5;
        const viewport = page.getViewport({ scale });

        const canvas = document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const ctx = canvas.getContext('2d');

        await page.render({ canvasContext: ctx, viewport: viewport }).promise;
        
        // Обновляем кэш отрисованных страниц
        layer.renderedPages.set(pageNum, canvas);

    } catch (err) {
        console.error(`Не удалось отрендерить страницу ${pageNum}:`, err);
    }
}
// --- КОНЕЦ ИЗМЕНЕНИЙ ---

export function processImageFile(file, position, canvasState, redrawCallback, saveState) {
    if (!file.type.startsWith('image/')) return;

    const reader = new FileReader();
    reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
            const viewportWidth = canvasState.canvas.width;
            const viewportHeight = canvasState.canvas.height;
            
            const maxWidth = viewportWidth * 0.9;
            const maxHeight = viewportHeight * 0.9;
            
            let newWidth = img.naturalWidth;
            let newHeight = img.naturalHeight;

            if (newWidth > maxWidth || newHeight > maxHeight) {
                const widthRatio = maxWidth / newWidth;
                const heightRatio = maxHeight / newHeight;
                
                const scaleRatio = Math.min(widthRatio, heightRatio);
                
                newWidth *= scaleRatio;
                newHeight *= scaleRatio;
            }

            const newLayer = { 
                type: 'image', 
                image: img, 
                x: position.x - newWidth / 2, 
                y: position.y - newHeight / 2, 
                width: newWidth, 
                height: newHeight, 
                id: Date.now(), 
                rotation: 0, 
                pivot: { x: 0, y: 0 } 
            };

            canvasState.layers.push(newLayer);
            canvasState.selectedLayers = [newLayer];
            
            const selectButton = document.querySelector('button[data-tool="select"]');
            if (selectButton) {
                selectButton.click();
            }

            saveState(canvasState.layers);
            redrawCallback();
            if (canvasState.updateFloatingToolbar) {
                canvasState.updateFloatingToolbar();
            }
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
}

export function processPdfFile(file, position, canvasState, redrawCallback, saveState) {
    if (!file.type.includes('pdf')) return;

    const reader = new FileReader();
    reader.onload = async (e) => {
        const fileData = e.target.result;
        const typedarray = new Uint8Array(fileData);
        
        pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.11.338/pdf.worker.min.js`;

        try {
            const pdfDoc = await pdfjsLib.getDocument({ data: typedarray }).promise;
            const firstPage = await pdfDoc.getPage(1);
            
            const initialViewport = firstPage.getViewport({ scale: 1.0 });

            const viewportWidth = canvasState.canvas.width;
            const viewportHeight = canvasState.canvas.height;
            const maxWidth = viewportWidth * 0.9;
            const maxHeight = viewportHeight * 0.9;
            
            let newWidth = initialViewport.width;
            let newHeight = initialViewport.height;

            if (newWidth > maxWidth || newHeight > maxHeight) {
                const ratio = Math.min(maxWidth / newWidth, maxHeight / newHeight);
                newWidth *= ratio;
                newHeight *= ratio;
            }

            const newLayer = {
                type: 'pdf',
                pdfDoc: pdfDoc,
                renderedPages: new Map(),
                numPages: pdfDoc.numPages,
                currentPage: 1,
                fileData: btoa(String.fromCharCode.apply(null, new Uint8Array(fileData))), 
                x: position.x - newWidth / 2,
                y: position.y - newHeight / 2,
                width: newWidth,
                height: newHeight,
                id: Date.now(),
                rotation: 0,
                pivot: { x: 0, y: 0 }
            };

            // --- НАЧАЛО ИЗМЕНЕНИЙ: Используем новую функцию для первого рендеринга ---
            await renderPdfPageToCanvas(newLayer, 1);
            // --- КОНЕЦ ИЗМЕНЕНИЙ ---

            canvasState.layers.push(newLayer);
            canvasState.selectedLayers = [newLayer];
            
            const selectButton = document.querySelector('button[data-tool="select"]');
            if (selectButton) selectButton.click();

            saveState(canvasState.layers);
            redrawCallback();
            if (canvasState.updateFloatingToolbar) {
                canvasState.updateFloatingToolbar();
            }

        } catch (error) {
            console.error('Ошибка при обработке PDF:', error);
            alert('Не удалось загрузить или обработать PDF файл.');
        }
    };
    reader.readAsArrayBuffer(file);
}

export function applyTransformations(layer) {
    if (!layer || (!layer.rotation && (!layer.pivot || (layer.pivot.x === 0 && layer.pivot.y === 0)))) {
        return;
    }

    const rotation = layer.rotation || 0;
    const pivot = layer.pivot || { x: 0, y: 0 };
    const box = getBoundingBox(layer);
    if (!box) return;

    const centerX = box.x + box.width / 2;
    const centerY = box.y + box.height / 2;

    const rotatedPivotOffset = rotatePoint(pivot, { x: 0, y: 0 }, rotation);
    const pivotPoint = {
        x: centerX + rotatedPivotOffset.x,
        y: centerY + rotatedPivotOffset.y,
    };

    const rotate = (p) => rotatePoint(p, pivotPoint, rotation);

    const layerProps = Object.keys(layer);
    for (const prop of layerProps) {
        if (layer[prop] && typeof layer[prop] === 'object' && layer[prop].hasOwnProperty('x') && layer[prop].hasOwnProperty('y')) {
             const newPoint = rotate(layer[prop]);
             layer[prop].x = newPoint.x;
             layer[prop].y = newPoint.y;
        }
    }

    if (layer.points) {
        layer.points.forEach(p => {
            const newPoint = rotate(p);
            p.x = newPoint.x;
            p.y = newPoint.y;
        });
    }

    if (layer.hasOwnProperty('x') && layer.hasOwnProperty('y')) {
        const newCenter = rotate({ x: centerX, y: centerY });
        const dx = newCenter.x - centerX;
        const dy = newCenter.y - centerY;
        layer.x += dx;
        layer.y += dy;
    }
    if (layer.hasOwnProperty('cx') && layer.hasOwnProperty('cy')) {
        const newCenter = rotate({ x: layer.cx, y: layer.cy });
        layer.cx = newCenter.x;
        layer.cy = newCenter.y;
    }
     if (layer.hasOwnProperty('x1') && layer.hasOwnProperty('y1')) {
        const newP1 = rotate({ x: layer.x1, y: layer.y1 });
        const newP2 = rotate({ x: layer.x2, y: layer.y2 });
        layer.x1 = newP1.x; layer.y1 = newP1.y;
        layer.x2 = newP2.x; layer.y2 = newP2.y;
    }
     if (layer.baseY) {
        const newBaseCenter = rotate({ x: layer.cx, y: layer.baseY });
        const dy = newBaseCenter.y - layer.baseY;
        layer.baseY += dy;
        if(layer.topY) layer.topY += dy;
     }

    layer.rotation = 0;
    layer.pivot = { x: 0, y: 0 };
}

function perpendicularDistance(pt, p1, p2) {
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const lenSq = dx * dx + dy * dy;
    if (lenSq === 0) {
        return Math.hypot(pt.x - p1.x, pt.y - p1.y);
    }
    const t = ((pt.x - p1.x) * dx + (pt.y - p1.y) * dy) / lenSq;
    const clampedT = Math.max(0, Math.min(1, t));
    const closestX = p1.x + clampedT * dx;
    const closestY = p1.y + clampedT * dy;
    return Math.hypot(pt.x - closestX, pt.y - closestY);
}

export function simplifyPath(points, tolerance) {
    if (points.length < 3) {
        return points;
    }

    let dmax = 0;
    let index = 0;
    const end = points.length - 1;

    for (let i = 1; i < end; i++) {
        const d = perpendicularDistance(points[i], points[0], points[end]);
        if (d > dmax) {
            index = i;
            dmax = d;
        }
    }

    if (dmax > tolerance) {
        const recResults1 = simplifyPath(points.slice(0, index + 1), tolerance);
        const recResults2 = simplifyPath(points.slice(index), tolerance);
        
        return recResults1.slice(0, recResults1.length - 1).concat(recResults2);
    } else {
        return [points[0], points[end]];
    }
}