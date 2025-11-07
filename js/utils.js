import { getBoundingBox, rotatePoint } from './geometry.js';

export const mediaCache = {};

const GRID_SPACING = 20;

/**
 * Применяет смещение (dx, dy) к координатам слоя.
 * @param {object} layer - Слой для перемещения.
 * @param {number} dx - Смещение по оси X.
 * @param {number} dy - Смещение по оси Y.
 */
export function translateLayer(layer, dx, dy) {
    if (layer.points && typeof layer.points[0] === 'number') {
        const step = layer.hasPressure ? 3 : 2;
        for (let i = 0; i < layer.points.length; i += step) {
            layer.points[i] += dx;
            layer.points[i + 1] += dy;
        }
    } else if (layer.points) { // Fallback for object-based points if needed
        layer.points.forEach(p => { p.x += dx; p.y += dy; });
    }
    
    const translatePoint = p => { if(p && typeof p.x === 'number') { p.x += dx; p.y += dy; } };
    
    if (typeof layer.x === 'number' && typeof layer.y === 'number') { layer.x += dx; layer.y += dy; }
    if (typeof layer.cx === "number") { layer.cx += dx; }
    if (typeof layer.cy === "number") { layer.cy += dy; }
    if (typeof layer.baseY === 'number') { layer.baseY += dy; }
    if (typeof layer.topY === 'number') { layer.topY += dy; }
    if (typeof layer.cutY === 'number') { layer.cutY += dy; }
    
    if (typeof layer.x1 === 'number') { layer.x1 += dx; layer.y1 += dy; }
    if (typeof layer.x2 === 'number') { layer.x2 += dx; layer.y2 += dy; }

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
            return new Promise((resolve) => {
                const img = new Image();
                img.onload = () => {
                    layer.image = img;
                    mediaCache[layer.id] = { image: img, src: layer.src };
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
                    const bytes = new Uint8Array(binaryString.length);
                    for (let i = 0; i < binaryString.length; i++) {
                        bytes[i] = binaryString.charCodeAt(i);
                    }
                    
                    pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.11.338/pdf.worker.min.js`;
                    const pdfDoc = await pdfjsLib.getDocument({ data: bytes }).promise;
                    
                    layer.pdfDoc = pdfDoc;
                    layer.renderedPages = new Map();
                    mediaCache[layer.id] = { pdfDoc, renderedPages: layer.renderedPages, fileData: layer.fileData };
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
 * Упрощенная функция для подготовки слоев к сохранению.
 * @param {Array<Object>} layers - "Живой" массив слоев.
 * @returns {Array<Object>} "Чистый" массив слоев, готовый к JSON.stringify.
 */
export function serializeLayers(layers) {
    return layers.map(layer => {
        const newLayer = { ...layer };

        delete newLayer.image;
        delete newLayer.pdfDoc;
        delete newLayer.renderedPages;
        
        return newLayer;
    });
}


export function cloneLayersForAction(layers) {
    // Используем structuredClone для настоящего глубокого копирования.
    // Это современный, быстрый и надежный способ, который обрабатывает вложенные объекты.
    try {
        return structuredClone(layers);
    } catch (e) {
        // Fallback для очень старых браузеров, которые не поддерживают structuredClone
        console.warn("structuredClone failed, falling back to JSON method.", e);
        return JSON.parse(JSON.stringify(layers));
    }
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
 * Рендерит указанную страницу PDF-слоя в новый canvas с высоким качеством.
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
                
                finalSrc = canvas.toDataURL(file.type === 'image/png' ? 'image/png' : 'image/jpeg', 0.9);
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

                mediaCache[newLayer.id] = { image: finalImg, src: finalSrc };

                canvasState.layers.push(newLayer);
                canvasState.selectedLayers = [newLayer];
                
                const selectButton = document.querySelector('button[data-tool="select"]');
                if (selectButton) {
                    selectButton.click();
                }

                saveState({ type: 'creation', before: [], after: [newLayer] });
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

            mediaCache[newLayer.id] = { pdfDoc: newLayer.pdfDoc, renderedPages: newLayer.renderedPages, fileData: newLayer.fileData };

            await renderPdfPageToCanvas(newLayer, 1);

            canvasState.layers.push(newLayer);
            canvasState.selectedLayers = [newLayer];
            
            const selectButton = document.querySelector('button[data-tool="select"]');
            if (selectButton) selectButton.click();

            saveState({ type: 'creation', before: [], after: [newLayer] });
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
                const newPoints = [];
                const oldPoints = layer.points;
                const step = layer.hasPressure ? 3 : 2;
                
                for (let i = 0; i < oldPoints.length; i += step) {
                    const tempPoint = { x: oldPoints[i] - dx, y: oldPoints[i + 1] - dy };
                    if (layer.hasPressure) {
                        tempPoint.pressure = oldPoints[i + 2];
                    }

                    const newPointObject = rotatePoint(tempPoint, pivotPoint, rotation);
                    
                    newPoints.push(newPointObject.x, newPointObject.y);
                    if (layer.hasPressure) {
                        newPoints.push(newPointObject.pressure);
                    }
                }
                layer.points = newPoints;
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

/**
 * Вспомогательная функция для `simplifyPath`, работающая с плоскими координатами.
 * @param {number} ptX - X-координата точки.
 * @param {number} ptY - Y-координата точки.
 * @param {number} p1X - X-координата начала отрезка.
 * @param {number} p1Y - Y-координата начала отрезка.
 * @param {number} p2X - X-координата конца отрезка.
 * @param {number} p2Y - Y-координата конца отрезка.
 * @returns {number} Перпендикулярное расстояние.
 */
function perpendicularDistanceFlat(ptX, ptY, p1X, p1Y, p2X, p2Y) {
    const dx = p2X - p1X;
    const dy = p2Y - p1Y;
    const lenSq = dx * dx + dy * dy;
    if (lenSq === 0) return Math.hypot(ptX - p1X, ptY - p1Y);
    return Math.abs(dy * ptX - dx * ptY + p2X * p1Y - p2Y * p1X) / Math.sqrt(lenSq);
}

/**
 * Упрощает путь (линию), представленный плоским массивом чисел, используя алгоритм Рамера-Дугласа-Пойкера.
 * @param {number[]} points - Плоский массив точек [x1, y1, x2, y2, ...].
 * @param {number} tolerance - Порог для упрощения.
 * @returns {number[]} Новый, упрощенный плоский массив точек.
 */
export function simplifyPath(points, tolerance) {
    const len = points.length;
    // Путь должен состоять как минимум из 2-х точек (4-х чисел)
    if (len < 4) {
        return points;
    }

    let dmax = 0;
    let index = 0;
    const p1X = points[0];
    const p1Y = points[1];
    const p2X = points[len - 2];
    const p2Y = points[len - 1];

    // Находим самую удаленную точку от отрезка [начало, конец]
    for (let i = 2; i < len - 2; i += 2) {
        const d = perpendicularDistanceFlat(points[i], points[i+1], p1X, p1Y, p2X, p2Y);
        if (d > dmax) {
            index = i;
            dmax = d;
        }
    }

    // Если максимальное расстояние больше допуска, рекурсивно упрощаем два сегмента
    if (dmax > tolerance) {
        const recResults1 = simplifyPath(points.slice(0, index + 2), tolerance);
        const recResults2 = simplifyPath(points.slice(index), tolerance);
        
        // Объединяем результаты, удаляя дублирующуюся среднюю точку
        return recResults1.slice(0, recResults1.length - 2).concat(recResults2);
    } else {
        // Если все точки достаточно близки, возвращаем только начало и конец
        return [p1X, p1Y, p2X, p2Y];
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