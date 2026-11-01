import { processImageFile, processPdfFile, serializeLayers, getMousePos, createTextImage } from './utils.js?v=1.2.5';
import { drawLayer } from './renderer.js?v=1.2.5';

// --- Композитинг стикеров для экспорта -------------------------------------
// Стикеры живут в DOM (#stickers-layer), а экспорт собирается из канвасов,
// поэтому их приходится перерисовывать вручную в том же порядке и с той же
// геометрией, что видит пользователь.

function buildStickerPath(ctx, x, y, w, h, shape, radius) {
    if (shape === 'circle') {
        ctx.ellipse(x + w / 2, y + h / 2, Math.max(1, w / 2), Math.max(1, h / 2), 0, 0, Math.PI * 2);
    } else if (shape === 'rhombus') {
        ctx.moveTo(x + w / 2, y);
        ctx.lineTo(x + w, y + h / 2);
        ctx.lineTo(x + w / 2, y + h);
        ctx.lineTo(x, y + h / 2);
        ctx.closePath();
    } else if (typeof ctx.roundRect === 'function') {
        ctx.roundRect(x, y, w, h, radius);
    } else {
        ctx.rect(x, y, w, h);
    }
}

const stickerImageCache = new Map();
function loadStickerImage(src) {
    if (!src) return Promise.resolve(null);
    if (stickerImageCache.has(src)) return stickerImageCache.get(src);
    const promise = new Promise((resolve) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => resolve(null);
        img.src = src;
    });
    stickerImageCache.set(src, promise);
    return promise;
}

function drawCoverImage(ctx, img, x, y, w, h) {
    const iw = img.naturalWidth || img.width;
    const ih = img.naturalHeight || img.height;
    if (!iw || !ih) return;
    const scale = Math.max(w / iw, h / ih);
    const sw = w / scale;
    const sh = h / scale;
    ctx.drawImage(img, (iw - sw) / 2, (ih - sh) / 2, sw, sh, x, y, w, h);
}

function getPortDirection(side) {
    if (side === 'top') return { x: 0, y: -1 };
    if (side === 'bottom') return { x: 0, y: 1 };
    if (side === 'left') return { x: -1, y: 0 };
    if (side === 'right') return { x: 1, y: 0 };
    return { x: 0, y: 0 };
}

function drawConnectionPath(ctx, x1, y1, side1, x2, y2, side2, color, style) {
    const d1 = getPortDirection(side1);
    const d2 = getPortDirection(side2);
    const dist = Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1)) * 0.5 + 40;

    const cx1 = x1 + d1.x * dist;
    const cy1 = y1 + d1.y * dist;
    const cx2 = x2 + d2.x * dist;
    const cy2 = y2 + d2.y * dist;

    ctx.save();
    ctx.strokeStyle = color || '#a855f7';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    if (style === 'dashed') {
        ctx.setLineDash([8, 6]);
    } else if (style === 'dotted') {
        ctx.setLineDash([2, 6]);
    }
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.bezierCurveTo(cx1, cy1, cx2, cy2, x2, y2);
    ctx.stroke();
    ctx.setLineDash([]);

    // Наконечник стрелки: тот же треугольник 8x6, что в SVG-маркере
    let tx = x2 - cx2;
    let ty = y2 - cy2;
    const len = Math.hypot(tx, ty) || 1;
    tx /= len;
    ty /= len;
    const px = -ty;
    const py = tx;
    const L = 8;
    const W = 3;
    ctx.beginPath();
    ctx.moveTo(x2, y2);
    ctx.lineTo(x2 - tx * L + px * W, y2 - ty * L + py * W);
    ctx.lineTo(x2 - tx * L - px * W, y2 - ty * L - py * W);
    ctx.closePath();
    ctx.fillStyle = color || '#a855f7';
    ctx.fill();
    ctx.restore();
}

async function drawStickersForExport(ctx, canvasState, targetCanvas) {
    const app = window.stickerApp;
    if (!app || !Array.isArray(app.stickers) || app.stickers.length === 0) return;

    const dpr = window.devicePixelRatio || 1;
    const zoom = canvasState.zoom || 1;
    const panX = canvasState.panX || 0;
    const panY = canvasState.panY || 0;
    const viewW = targetCanvas.width / dpr;
    const viewH = targetCanvas.height / dpr;

    // Для drawLayer дочерние слои стикера считаются "локальным" рендером.
    const localState = Object.create(canvasState);
    localState.isLocalRender = true;

    // 1. Связи между стикерами (в DOM они лежат под карточками)
    if (Array.isArray(app.links) && app.links.length > 0) {
        ctx.save();
        ctx.scale(dpr, dpr);
        ctx.translate(panX, panY);
        ctx.scale(zoom, zoom);
        app.links.forEach(link => {
            if (!link || !link.from || !link.to) return;
            const from = link.from.getPortCoords(link.fromSide);
            const to = link.to.getPortCoords(link.toSide);
            drawConnectionPath(ctx, from.x, from.y, link.fromSide, to.x, to.y, link.toSide, link.color, link.style);
        });
        ctx.restore();
    }

    // 2. Карточки в том же порядке, в котором они лежат в DOM
    for (const sticker of app.stickers) {
        const w = sticker.w * zoom;
        const h = sticker.h * zoom;
        if (w < 1 || h < 1) continue;

        const x = sticker.x * zoom + panX;
        const y = sticker.y * zoom + panY;
        if (x + w < 0 || y + h < 0 || x > viewW || y > viewH) continue;

        const shape = sticker.shape || 'rect';
        const radius = 16 * zoom;
        const pad = shape === 'circle' ? Math.min(w, h) * 0.15
            : shape === 'rhombus' ? Math.min(w, h) * 0.25
                : 20 * zoom;

        ctx.save();
        ctx.scale(dpr, dpr);

        // Тень + фон
        ctx.save();
        ctx.shadowColor = 'rgba(0, 0, 0, 0.08)';
        ctx.shadowBlur = 6 * zoom;
        ctx.shadowOffsetY = 4 * zoom;
        ctx.fillStyle = sticker.color || '#fef08a';
        ctx.beginPath();
        buildStickerPath(ctx, x, y, w, h, shape, radius);
        ctx.fill();
        ctx.restore();

        // Рамка
        ctx.beginPath();
        buildStickerPath(ctx, x, y, w, h, shape, radius);
        ctx.strokeStyle = sticker.color === '#ffffff' ? 'rgba(0,0,0,0.1)' : 'rgba(0,0,0,0.08)';
        ctx.lineWidth = 1;
        ctx.stroke();

        // Картинка стикера
        if (sticker.imageSrc) {
            const img = await loadStickerImage(sticker.imageSrc);
            if (img) {
                ctx.save();
                ctx.beginPath();
                buildStickerPath(ctx, x, y, w, h, shape, radius);
                ctx.clip();
                drawCoverImage(ctx, img, x, y, w, h);
                ctx.restore();
            }
        }

        // Текст (на экране он под рисунками: .sticker-content z-index 3, canvas z-index 4)
        if (sticker.content && sticker.content.trim()) {
            const innerW = w - pad * 2;
            const innerH = h - pad * 2;
            if (innerW > 4 && innerH > 4) {
                const textLayer = {
                    width: Math.max(1, innerW / zoom + 20), // внутренние отступы createTextImage = 10px
                    height: Math.max(1, innerH / zoom),
                    content: sticker.content,
                    color: '#334155',
                    fontSize: 15,
                    fontFamily: 'sans-serif',
                    align: shape === 'rect' ? 'left' : 'center',
                    fontWeight: 'normal',
                    fontStyle: 'normal',
                    textDecoration: 'none'
                };

                const textImg = await createTextImage(textLayer, true, 1.5);
                if (textImg) {
                    const iw = (textImg.naturalWidth || textImg.width) * zoom;
                    const ih = (textImg.naturalHeight || textImg.height) * zoom;
                    const drawX = x + pad - 10 * zoom;
                    const drawY = shape === 'rect'
                        ? y + pad - 10 * zoom
                        : y + pad + (innerH - ih) / 2;

                    ctx.save();
                    ctx.beginPath();
                    ctx.rect(x + pad, y + pad, innerW, innerH);
                    ctx.clip();
                    ctx.drawImage(textImg, drawX, drawY, iw, ih);
                    ctx.restore();
                }
            }
        }

        // Рисунки, сделанные внутри стикера (поверх текста, как в DOM)
        const children = canvasState.layers ? canvasState.layers.filter(l => l.parentId === sticker.id) : [];
        if (children.length > 0) {
            ctx.save();
            ctx.beginPath();
            buildStickerPath(ctx, x, y, w, h, shape, radius);
            ctx.clip();
            ctx.translate(panX, panY);
            ctx.scale(zoom, zoom);
            children.forEach(child => drawLayer(ctx, child, localState));
            ctx.restore();
        }

        ctx.restore();
    }
}
// ---------------------------------------------------------------------------

export function initializeFileHandlers(canvasState, loadState, redrawCallback, saveState) {
    const drawingCanvas = canvasState.canvas;
    const backgroundCanvas = document.getElementById('backgroundCanvas');

    // --- Export to JPG / PNG ---
    async function buildBoardExportCanvas() {
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = drawingCanvas.width;
        tempCanvas.height = drawingCanvas.height;
        const tempCtx = tempCanvas.getContext('2d');

        tempCtx.fillStyle = window.getComputedStyle(backgroundCanvas).backgroundColor || '#FFFFFF';
        tempCtx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);

        tempCtx.drawImage(backgroundCanvas, 0, 0);
        tempCtx.drawImage(drawingCanvas, 0, 0);

        // Стикеры и их связи живут в DOM — дорисовываем их поверх холста
        try {
            await drawStickersForExport(tempCtx, canvasState, tempCanvas);
        } catch (err) {
            console.error('Не удалось добавить стикеры в экспорт:', err);
        }

        return tempCanvas;
    }

    function downloadCanvas(canvas, mimeType, fileName, quality) {
        const link = document.createElement('a');
        link.download = fileName;
        link.href = canvas.toDataURL(mimeType, quality);
        link.click();
    }

    const exportJpgBtn = document.getElementById('exportJpgBtn');
    if (exportJpgBtn) {
        exportJpgBtn.addEventListener('click', async (e) => {
            e.preventDefault();
            const canvas = await buildBoardExportCanvas();
            downloadCanvas(canvas, 'image/jpeg', 'my-board.jpg', 0.95);
        });
    }

    const exportPngBtn = document.getElementById('exportPngBtn');
    if (exportPngBtn) {
        exportPngBtn.addEventListener('click', async (e) => {
            e.preventDefault();
            const canvas = await buildBoardExportCanvas();
            downloadCanvas(canvas, 'image/png', 'my-board.png');
        });
    }

    // Печать / PDF: системный диалог печати, где можно выбрать «Сохранить как PDF».
    // Отдельная зависимость не нужна — печатаем уже собранный снимок доски.
    const exportPdfBtn = document.getElementById('exportPdfBtn');
    if (exportPdfBtn) {
        exportPdfBtn.addEventListener('click', async (e) => {
            e.preventDefault();
            const canvas = await buildBoardExportCanvas();
            const imageUrl = canvas.toDataURL('image/png');
            const landscape = canvas.width >= canvas.height;

            const frame = document.createElement('iframe');
            frame.setAttribute('aria-hidden', 'true');
            // Держим реальный размер (за экраном): при печати iframe с нулевым
            // вьюпортом может отмасштабировать картинку в ноль.
            frame.style.cssText = 'position:fixed;left:-10000px;top:0;width:1024px;height:768px;border:0;';
            frame.srcdoc = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>repitorium</title>
                <style>
                    @page { size: ${landscape ? 'landscape' : 'portrait'}; margin: 0; }
                    html, body { margin: 0; padding: 0; background: #fff; }
                    img { display: block; width: 100%; height: auto; }
                </style></head>
                <body><img src="${imageUrl}" alt=""></body></html>`;

            const removeFrame = () => {
                if (frame.parentNode) frame.remove();
            };

            frame.onload = () => {
                try {
                    const win = frame.contentWindow;
                    const img = win.document.querySelector('img');
                    const doPrint = () => {
                        try {
                            win.focus();
                            win.print();
                            win.addEventListener('afterprint', removeFrame, { once: true });
                            setTimeout(removeFrame, 5 * 60 * 1000);
                        } catch (err) {
                            console.error('Не удалось открыть окно печати:', err);
                            removeFrame();
                        }
                    };
                    if (img && !img.complete) {
                        img.addEventListener('load', doPrint, { once: true });
                    } else {
                        setTimeout(doPrint, 50);
                    }
                } catch (err) {
                    console.error('Не удалось подготовить печать:', err);
                    removeFrame();
                }
            };

            document.body.appendChild(frame);
        });
    }

    // --- Save Project ---
    document.getElementById('saveProjectBtn').addEventListener('click', (e) => {
        e.preventDefault();
        
        const projectData = {
            viewState: {
                panX: canvasState.panX,
                panY: canvasState.panY,
                zoom: canvasState.zoom,
                rulers: canvasState.rulers || [],
                stickerLinks: canvasState.viewState ? (canvasState.viewState.stickerLinks || []) : []
            },
            layers: serializeLayers(canvasState.layers)
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

    // --- Open Project ---
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

    // --- Image Upload Logic ---
    const imageUploadInput = document.getElementById('imageUpload');

    imageUploadInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const centerPos = {
            x: (drawingCanvas.width / 2 - canvasState.panX) / canvasState.zoom,
            y: (drawingCanvas.height / 2 - canvasState.panY) / canvasState.zoom
        };

        processImageFile(file, centerPos, canvasState, redrawCallback, saveState);
        
        e.target.value = null;
    });

    // --- PDF Upload Logic ---
    const pdfUploadInput = document.getElementById('pdfUpload');

    pdfUploadInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const centerPos = {
            x: (drawingCanvas.width / 2 - canvasState.panX) / canvasState.zoom,
            y: (drawingCanvas.height / 2 - canvasState.panY) / canvasState.zoom
        };

        processPdfFile(file, centerPos, canvasState, redrawCallback, saveState);

        e.target.value = null;
    });

    // --- Централизованная обработка Drag-and-Drop ---
    const dropZone = document.body; // Слушаем на всем body для удобства

    dropZone.addEventListener('dragenter', (e) => {
        e.preventDefault();
        e.stopPropagation();
        // Показываем оверлей, только если перетаскивается файл
        if (e.dataTransfer.types.includes('Files')) {
            document.body.classList.add('drag-over');
        }
    });

    dropZone.addEventListener('dragleave', (e) => {
        e.preventDefault();
        e.stopPropagation();
        // Убираем подсветку, если курсор покинул окно
        if (e.relatedTarget === null || e.target === document.body) {
             document.body.classList.remove('drag-over');
        }
    });

    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault(); 
        e.stopPropagation();
    });
    
    dropZone.addEventListener('drop', (e) => { 
        e.preventDefault(); 
        e.stopPropagation();
        document.body.classList.remove('drag-over');

        // Используем getMousePos, чтобы координаты были относительно холста
        const pos = getMousePos(e, canvasState); 
        
        let file = null;

        // Приоритет 1: Проверяем e.dataTransfer.items - это часто работает лучше на Android.
        if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
            // Итерируем в поиске первого элемента, который является файлом.
            for (let i = 0; i < e.dataTransfer.items.length; i++) {
                if (e.dataTransfer.items[i].kind === 'file') {
                    file = e.dataTransfer.items[i].getAsFile();
                    break; // Берем только первый найденный файл.
                }
            }
        } 
        // Приоритет 2 (Fallback): Если .items не сработал или пуст, пробуем старый метод .files.
        else if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            file = e.dataTransfer.files[0];
        }

        if (file) {
            if (file.type.startsWith('image/')) {
                processImageFile(file, pos, canvasState, redrawCallback, saveState);
            } else if (file.type === 'application/pdf') {
                processPdfFile(file, pos, canvasState, redrawCallback, saveState);
            }
        }
    });
}