// --- START OF FILE js/utils.js ---

import { getBoundingBox, rotatePoint } from './geometry.js';

// --- НАЧАЛО ИЗМЕНЕНИЙ: Создаем кэш для медиа-данных ---
export const mediaCache = {};
// --- КОНЕЦ ИЗМЕНЕНИЙ ---

const GRID_SPACING = 20;

/**
 * Применяет смещение (dx, dy) к координатам слоя.
 * @param {object} layer - Слой для перемещения.
 * @param {number} dx - Смещение по оси X.
 * @param {number} dy - Смещение по оси Y.
 */
export function translateLayer(layer, dx, dy) {
    const translatePoint = p => { if(p && typeof p.x === 'number') { p.x += dx; p.y += dy; } };
    
    if (typeof layer.x === 'number' && typeof layer.y === 'number') { layer.x += dx; layer.y += dy; }
    if (typeof layer.cx === "number") { layer.cx += dx; }
  if (typeof layer.cy === "number") { layer.cy += dy; }
    if (typeof layer.baseY === 'number') { layer.baseY += dy; }
    if (typeof layer.topY === 'number') { layer.topY += dy; }
    if (typeof layer.cutY === 'number') { layer.cutY += dy; }
    
    if (typeof layer.x1 === 'number') { layer.x1 += dx; layer.y1 += dy; }
    if (typeof layer.x2 === 'number') { layer.x2 += dx; layer.y2 += dy; }

    if (layer.points) { layer.points.forEach(translatePoint); }
    if (layer.nodes) { 
        layer.nodes.forEach(node => {
            translatePoint(node.p);
            translatePoint(node.h1);
            translatePoint(node.h2);
        });
    }
    
    ['p1', 'p2', 'p3', 'p4', 'apex'].forEach(key => translatePoint(layer[key]));

    if (layer.base) { Object.values(layer.base).forEach(translatePoint); }
    if (layer.top) { Object.values(layer.top).forEach(translatePoint); }
}

/**
 * Принимает "чистый" массив слоев и асинхронно загружает их внешние ресурсы (картинки, PDF).
 * @param {Array<Object>} layers - Массив слоев для "оживления".
 * @returns {Promise<Array<Object>>} Промис, который разрешается с массивом "живых" слоев.
 */
export async function rehydrateLayers(layers) {
    if (!layers) return [];
    
    const loadPromises = layers.map(layer => {
        if (layer.type === 'image' && layer.src) {
            return new Promise((resolve, reject) => {
                const img = new Image();
                img.onload = () => {
                    layer.image = img;
                    // --- НАЧАЛО ИЗМЕНЕНИЙ: Кэшируем загруженный ресурс ---
                    mediaCache[layer.id] = { image: img, src: layer.src };
                    // --- КОНЕЦ ИЗМЕНЕНИЙ ---
                    resolve();
                };
                img.onerror = () => {
                    console.error(`Не удалось загрузить изображение: ${layer.src}`);
                    resolve(); 
                };
                img.src = layer.src;
            });
        } else if (layer.type === 'pdf' && layer.fileData) {
            return new Promise(async (resolve) => {
                try {
                    const binaryString = atob(layer.fileData);
                    const len = binaryString.length;
                    const bytes = new Uint8Array(len);
                    for (let i = 0; i < len; i++) {
                        bytes[i] = binaryString.charCodeAt(i);
                    }
                    
                    pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.11.338/pdf.worker.min.js`;
                    const pdfDoc = await pdfjsLib.getDocument({ data: bytes }).promise;
                    
                    layer.pdfDoc = pdfDoc;
                    layer.renderedPages = new Map();
                    // --- НАЧАЛО ИЗМЕНЕНИЙ: Кэшируем загруженный ресурс ---
                    mediaCache[layer.id] = { pdfDoc, renderedPages: layer.renderedPages, fileData: layer.fileData };
                    // --- КОНЕЦ ИЗМЕНЕНИЙ ---
                    await renderPdfPageToCanvas(layer, layer.currentPage);
                    
                } catch (err) {
                    console.error("Не удалось загрузить PDF слой:", err);
                } finally {
                    resolve(); 
                }
            });
        }
        return Promise.resolve(); 
    });

    await Promise.all(loadPromises);
    return layers;
}

/**
 * Централизованная функция для подготовки слоев к сохранению.
 * @param {Array<Object>} layers - "Живой" массив слоев.
 * @returns {Array<Object>} "Чистый" массив слоев, готовый к JSON.stringify.
 */
export function serializeLayers(layers) {
    return layers.map(layer => {
        const newLayer = { ...layer };

        if (layer.type === 'image' && layer.image instanceof HTMLImageElement) {
            if (!newLayer.src || !newLayer.src.startsWith('data:')) {
                const tempCanvas = document.createElement('canvas');
                if (layer.image.naturalWidth > 0 && layer.image.naturalHeight > 0) {
                    tempCanvas.width = newLayer.image.naturalWidth;
                    tempCanvas.height = newLayer.image.naturalHeight;
                    const tempCtx = tempCanvas.getContext('2d');
                    tempCtx.drawImage(newLayer.image, 0, 0);
                    newLayer.src = tempCanvas.toDataURL();
                }
            }
            delete newLayer.image;
        }
        
        if (layer.type === 'pdf') {
            delete newLayer.pdfDoc;
            delete newLayer.renderedPages;
        }
        return newLayer;
    });
}


export function cloneLayersForAction(layers) {
    return layers.map(layer => {
        const clonedLayer = { ...layer };

        if (layer.points) {
            clonedLayer.points = layer.points.map(p => ({ ...p }));
        }
        if (layer.nodes) {
            clonedLayer.nodes = layer.nodes.map(node => ({
                p: { ...node.p },
                h1: node.h1 ? { ...node.h1 } : null,
                h2: node.h2 ? { ...node.h2 } : null,
                type: node.type
            }));
        }
        if (layer.p1) clonedLayer.p1 = { ...layer.p1 };
        if (layer.p2) clonedLayer.p2 = { ...layer.p2 };
        if (layer.p3) clonedLayer.p3 = { ...layer.p3 };
        if (layer.p4) clonedLayer.p4 = { ...layer.p4 };

        if (layer.apex) clonedLayer.apex = { ...layer.apex };

        const clonePointsObject = (obj) => {
            if (!obj) return null;
            const newObj = {};
            for (const key in obj) {
                if (obj[key] && typeof obj[key].x !== 'undefined') {
                    newObj[key] = { ...obj[key] };
                }
            }
            return newObj;
        };

        if (layer.base) {
            clonedLayer.base = clonePointsObject(layer.base);
        }
        if (layer.top) {
            clonedLayer.top = clonePointsObject(layer.top);
        }
        
        return clonedLayer;
    });
}


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
        
        const unscaledViewport = page.getViewport({ scale: 1 });
        const scale = (layer.width / unscaledViewport.width) * 1.5;
        const viewport = page.getViewport({ scale });

        const canvas = document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const ctx = canvas.getContext('2d');

        await page.render({ canvasContext: ctx, viewport: viewport }).promise;
        
        layer.renderedPages.set(pageNum, canvas);

    } catch (err) {
        console.error(`Не удалось отрендерить страницу ${pageNum}:`, err);
    }
}

export function processImageFile(file, position, canvasState, redrawCallback, saveState) {
    if (!file.type.startsWith('image/')) return;

    const reader = new FileReader();
    reader.onload = (e) => {
        const originalImg = new Image();
        originalImg.onload = () => {
            const MAX_IMAGE_DIMENSION = 2000;
            let width = originalImg.naturalWidth;
            let height = originalImg.naturalHeight;
            let finalSrc = e.target.result;

            if (width > MAX_IMAGE_DIMENSION || height > MAX_IMAGE_DIMENSION) {
                const ratio = MAX_IMAGE_DIMENSION / Math.max(width, height);
                const newWidth = Math.round(width * ratio);
                const newHeight = Math.round(height * ratio);

                const canvas = document.createElement('canvas');
                canvas.width = newWidth;
                canvas.height = newHeight;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(originalImg, 0, 0, newWidth, newHeight);
                
                if (file.type === 'image/png') {
                    finalSrc = canvas.toDataURL('image/png');
                } else {
                    finalSrc = canvas.toDataURL('image/jpeg', 0.9);
                }
            }

            const finalImg = new Image();
            finalImg.onload = () => {
                const newLayer = { 
                    type: 'image', 
                    image: finalImg,
                    src: finalSrc, 
                    x: position.x - finalImg.width / 2, 
                    y: position.y - finalImg.height / 2, 
                    width: finalImg.width, 
                    height: finalImg.height, 
                    id: Date.now(), 
                    rotation: 0, 
                    pivot: { x: 0, y: 0 } 
                };

                // --- НАЧАЛО ИЗМЕНЕНИЙ: Кэшируем ресурс при создании ---
                mediaCache[newLayer.id] = { image: finalImg, src: finalSrc };
                // --- КОНЕЦ ИЗМЕНЕНИЙ ---

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
            finalImg.src = finalSrc;
        };
        originalImg.src = e.target.result;
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

            // --- НАЧАЛО ИЗМЕНЕНИЙ: Кэшируем ресурс при создании ---
            mediaCache[newLayer.id] = { pdfDoc: newLayer.pdfDoc, renderedPages: newLayer.renderedPages, fileData: newLayer.fileData };
            // --- КОНЕЦ ИЗМЕНЕНИЙ ---

            await renderPdfPageToCanvas(newLayer, 1);

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

    const pivotPoint = {
        x: centerX + pivot.x,
        y: centerY + pivot.y,
    };
    
    const newCenter = rotatePoint({ x: centerX, y: centerY }, pivotPoint, rotation);
    const dx = newCenter.x - centerX;
    const dy = newCenter.y - centerY;

    const typesThatPreserveRotation = new Set([
        'rect', 'image', 'text', 'pdf',
        'ellipse', 'sphere', 'cone', 'parallelepiped',
        'frustum', 'truncated-sphere', 'parallelogram'
    ]);
    const shouldBakeRotation = !typesThatPreserveRotation.has(layer.type) && rotation !== 0;

    translateLayer(layer, dx, dy);

    if (shouldBakeRotation) {
        const rotate = (p) => rotatePoint(p, newCenter, rotation);
        
        const correctAndRotate = (p) => {
            const correctedPoint = { x: p.x - dx, y: p.y - dy };
            return rotatePoint(correctedPoint, pivotPoint, rotation);
        };

        switch (layer.type) {
            case 'line':
                layer.x1 -= dx; layer.y1 -= dy;
                layer.x2 -= dx; layer.y2 -= dy;
                const newP1 = rotatePoint({ x: layer.x1, y: layer.y1 }, pivotPoint, rotation);
                const newP2 = rotatePoint({ x: layer.x2, y: layer.y2 }, pivotPoint, rotation);
                layer.x1 = newP1.x; layer.y1 = newP1.y;
                layer.x2 = newP2.x; layer.y2 = newP2.y;
                break;
            case 'path':
                layer.points = layer.points.map(p => correctAndRotate(p));
                break;
            case 'curve':
                layer.nodes.forEach(node => {
                    node.p = correctAndRotate(node.p);
                    if (node.h1) node.h1 = correctAndRotate(node.h1);
                    if (node.h2) node.h2 = correctAndRotate(node.h2);
                });
                break;
            case 'triangle':
                layer.p1 = correctAndRotate(layer.p1);
                layer.p2 = correctAndRotate(layer.p2);
                layer.p3 = correctAndRotate(layer.p3);
                break;
            case 'trapezoid':
            case 'rhombus':
                layer.p1 = correctAndRotate(layer.p1);
                layer.p2 = correctAndRotate(layer.p2);
                layer.p3 = correctAndRotate(layer.p3);
                layer.p4 = correctAndRotate(layer.p4);
                break;
             case 'parallelogram':
                 layer.x -= dx; layer.y -= dy;
                 const newParaCenter = rotatePoint({ x: layer.x + layer.width/2, y: layer.y + layer.height/2}, pivotPoint, rotation);
                 layer.x = newParaCenter.x - layer.width/2;
                 layer.y = newParaCenter.y - layer.height/2;
                 break;
            case 'cone':
                layer.apex = correctAndRotate(layer.apex);
                const newBaseCenter = rotatePoint({ x: layer.cx - dx, y: layer.baseY - dy }, pivotPoint, rotation);
                layer.cx = newBaseCenter.x;
                layer.baseY = newBaseCenter.y;
                break;
            case 'parallelepiped':
                layer.depthOffset = rotatePoint(layer.depthOffset, { x: 0, y: 0 }, rotation);
                break;
            case 'pyramid':
                layer.apex = correctAndRotate(layer.apex);
                layer.base.p1 = correctAndRotate(layer.base.p1);
                layer.base.p2 = correctAndRotate(layer.base.p2);
                layer.base.p3 = correctAndRotate(layer.base.p3);
                layer.base.p4 = correctAndRotate(layer.base.p4);
                break;
            case 'frustum':
                 const newBaseCenterF = rotatePoint({ x: layer.cx - dx, y: layer.baseY - dy }, pivotPoint, rotation);
                 const newTopCenterF = rotatePoint({ x: layer.cx - dx, y: layer.topY - dy }, pivotPoint, rotation);
                 layer.cx = newBaseCenterF.x;
                 layer.baseY = newBaseCenterF.y;
                 layer.topY = newTopCenterF.y;
                 break;
            case 'truncated-pyramid':
                layer.base.p1 = correctAndRotate(layer.base.p1);
                layer.base.p2 = correctAndRotate(layer.base.p2);
                layer.base.p3 = correctAndRotate(layer.base.p3);
                layer.base.p4 = correctAndRotate(layer.base.p4);
                layer.top.p1 = correctAndRotate(layer.top.p1);
                layer.top.p2 = correctAndRotate(layer.top.p2);
                layer.top.p3 = correctAndRotate(layer.top.p3);
                layer.top.p4 = correctAndRotate(layer.top.p4);
                break;
        }
    }
    
    if (shouldBakeRotation) {
        layer.rotation = 0;
    }
    
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

/**
 * Рассчитывает управляющие точки для массива узлов, чтобы создать плавную кривую.
 * @param {Array<Object>} nodes - Массив узлов, содержащих только точки 'p'.
 */
export function smoothCurveHandles(nodes) {
    if (nodes.length < 2) return;
    const tension = 0.2;

    for (let i = 0; i < nodes.length; i++) {
        const p0 = nodes[i - 1]?.p || nodes[i].p;
        const p1 = nodes[i].p;
        const p2 = nodes[i + 1]?.p || nodes[i].p;

        const angle = Math.atan2(p2.y - p0.y, p2.x - p0.x);
        const dist1 = Math.hypot(p1.x - p0.x, p1.y - p0.y);
        const dist2 = Math.hypot(p2.x - p1.x, p2.y - p1.y);

        nodes[i].h1 = {
            x: p1.x + Math.cos(angle) * dist2 * tension,
            y: p1.y + Math.sin(angle) * dist2 * tension
        };
        nodes[i].h2 = {
            x: p1.x - Math.cos(angle) * dist1 * tension,
            y: p1.y - Math.sin(angle) * dist1 * tension
        };
        nodes[i].type = 'smooth';
    }

    nodes[0].h2 = null;
    nodes[nodes.length - 1].h1 = null;

    if (nodes.length === 2) {
        nodes[1].h2 = {
            x: nodes[1].p.x - (nodes[0].h1.x - nodes[0].p.x),
            y: nodes[1].p.y - (nodes[0].h1.y - nodes[0].p.y)
        };
    }
}
