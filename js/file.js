import { processImageFile, processPdfFile, serializeLayers, getMousePos, createTextImage } from './utils.js?v=1.4.19';
import { drawLayer } from './renderer.js?v=1.4.19';
import { getBoundingBox } from './geometry.js?v=1.4.19';
import { getPageLayout, orderFilledPages, PAGE_PX_PER_MM } from './pages.js?v=1.4.19';

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

async function drawStickersForExport(ctx, canvasState, targetCanvas, dprOverride = null) {
    const app = window.stickerApp;
    if (!app || !Array.isArray(app.stickers) || app.stickers.length === 0) return;

    const dpr = dprOverride || window.devicePixelRatio || 1;
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

function dataUrlToBytes(dataUrl) {
    const base64 = String(dataUrl || '').split(',')[1] || '';
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
}

// Простой PDF-генератор: каждая страница — отдельная страница PDF.
// Картинка встраивается как JPEG (DCTDecode), поэтому не нужен внешний CDN.
function createPdfFromCanvases(canvases, widthPt, heightPt) {
    const chunks = [];
    let length = 0;
    const offsets = [];
    const encoder = new TextEncoder();

    const push = (data) => {
        const bytes = typeof data === 'string' ? encoder.encode(data) : data;
        chunks.push(bytes);
        length += bytes.length;
    };
    const startObject = (id) => {
        offsets[id] = length;
        push(`${id} 0 obj\n`);
    };

    push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');

    startObject(1);
    push('<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');

    const kids = canvases.map((_, i) => `${3 + i * 3} 0 R`).join(' ');
    startObject(2);
    push(`<< /Type /Pages /Kids [${kids}] /Count ${canvases.length} >>\nendobj\n`);

    canvases.forEach((canvas, i) => {
        const pageId = 3 + i * 3;
        const imageId = 4 + i * 3;
        const contentId = 5 + i * 3;
        const image = dataUrlToBytes(canvas.toDataURL('image/jpeg', 0.93));
        const content = `q\n${widthPt} 0 0 ${heightPt} 0 0 cm\n/Im0 Do\nQ\n`;

        startObject(pageId);
        push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${widthPt} ${heightPt}] ` +
            `/Resources << /XObject << /Im0 ${imageId} 0 R >> >> /Contents ${contentId} 0 R >>\nendobj\n`);

        startObject(imageId);
        push(`<< /Type /XObject /Subtype /Image /Width ${canvas.width} /Height ${canvas.height} ` +
            `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${image.length} >>\nstream\n`);
        push(image);
        push('\nendstream\nendobj\n');

        startObject(contentId);
        push(`<< /Length ${content.length} >>\nstream\n${content}endstream\nendobj\n`);
    });

    const xrefStart = length;
    const objectCount = 2 + canvases.length * 3;
    push(`xref\n0 ${objectCount + 1}\n0000000000 65535 f \n`);
    for (let id = 1; id <= objectCount; id++) {
        push(`${String(offsets[id] || 0).padStart(10, '0')} 00000 n \n`);
    }
    push(`trailer\n<< /Size ${objectCount + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`);

    return new Blob(chunks, { type: 'application/pdf' });
}

function downloadBlob(blob, fileName) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
}

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

    function collectFilledPages() {
        const layout = getPageLayout(canvasState);
        const boxes = [];

        (canvasState.layers || []).forEach(layer => {
            if (layer.isEditing) return;
            const box = getBoundingBox(layer);
            if (box) boxes.push(box);
        });

        const app = window.stickerApp;
        if (app && Array.isArray(app.stickers)) {
            app.stickers.forEach(s => boxes.push({ x: s.x, y: s.y, width: s.w, height: s.h }));
        }

        return orderFilledPages(boxes, layout);
    }

    async function buildPageExportCanvas(page, scale = 3, includeGrid = true) {
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(page.width * scale);
        canvas.height = Math.round(page.height * scale);
        const ctx = canvas.getContext('2d');

        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        ctx.save();
        ctx.scale(scale, scale);
        ctx.translate(-page.x, -page.y);
        ctx.beginPath();
        ctx.rect(page.x, page.y, page.width, page.height);
        ctx.clip();

        // Лёгкая клетка/точки страницы, как на экране.
        const style = localStorage.getItem('boardBackgroundStyle') || 'grid';
        ctx.strokeStyle = 'rgba(100, 116, 139, 0.16)';
        ctx.fillStyle = 'rgba(100, 116, 139, 0.22)';
        ctx.lineWidth = 0.7 / scale;
        const step = 20;
        if (!includeGrid) {
            // Для PDF сетку не рисуем: меньше лишних линий и вес файла.
        } else if (style === 'lined') {
            ctx.strokeStyle = 'rgba(96, 165, 250, 0.45)';
            ctx.lineWidth = 0.8 / scale;
            ctx.beginPath();
            for (let y = page.y + 24; y < page.y + page.height; y += 24) {
                ctx.moveTo(page.x, y);
                ctx.lineTo(page.x + page.width, y);
            }
            ctx.stroke();
            ctx.strokeStyle = 'rgba(96, 165, 250, 0.26)';
            ctx.beginPath();
            const slant = Math.tan(65 * Math.PI / 180);
            for (let offset = page.x - page.height * slant; offset <= page.x + page.width; offset += 72) {
                ctx.moveTo(offset, page.y + page.height);
                ctx.lineTo(offset + page.height * slant, page.y);
            }
            ctx.stroke();
        } else if (style === 'dot') {
            for (let x = page.x; x <= page.x + page.width; x += step) {
                for (let y = page.y; y <= page.y + page.height; y += step) {
                    ctx.fillRect(x - 0.5 / scale, y - 0.5 / scale, 1 / scale, 1 / scale);
                }
            }
        } else {
            ctx.beginPath();
            for (let x = page.x; x <= page.x + page.width; x += step) {
                ctx.moveTo(x, page.y);
                ctx.lineTo(x, page.y + page.height);
            }
            for (let y = page.y; y <= page.y + page.height; y += step) {
                ctx.moveTo(page.x, y);
                ctx.lineTo(page.x + page.width, y);
            }
            ctx.stroke();
        }

        const localState = Object.create(canvasState);
        localState.zoom = 1;
        localState.isLocalRender = false;
        localState.layers = canvasState.layers;

        (canvasState.layers || []).forEach(layer => {
            if (layer.isEditing) return;
            drawLayer(ctx, layer, localState);
        });
        ctx.restore();

        // Стикеры и связи — отдельным проходом, но на той же странице.
        try {
            const stickerState = Object.create(canvasState);
            stickerState.zoom = scale;
            stickerState.panX = -page.x * scale;
            stickerState.panY = -page.y * scale;
            await drawStickersForExport(ctx, stickerState, canvas, 1);
        } catch (err) {
            console.error('Не удалось добавить стикеры на страницу:', err);
        }

        return canvas;
    }

    async function downloadPageCanvas(canvas, fileName) {
        const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
        if (!blob) return;
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = fileName;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    // --- Export dialog ---
    const exportBtn = document.getElementById('exportBtn');
    const exportModal = document.getElementById('export-modal');
    const exportFileName = document.getElementById('exportFileName');
    const exportPdfQualityRow = document.getElementById('exportPdfQualityRow');
    const exportHint = document.getElementById('exportHint');
    const exportStartBtn = document.getElementById('exportStartBtn');

    const setupExportDropdown = (id, defaultValue) => {
        const root = document.getElementById(id);
        if (!root) return { getValue: () => defaultValue, setValue: () => {} };
        const label = root.querySelector('.dropdown-label');
        const list = root.querySelector('.dropdown-list');
        const items = root.querySelectorAll('.dropdown-item');
        let value = defaultValue;

        const setValue = (next) => {
            value = next;
            items.forEach(item => {
                const active = item.dataset.value === next;
                item.classList.toggle('active', active);
                if (active && label) label.textContent = item.textContent.trim();
            });
        };
        setValue(defaultValue);

        const close = () => {
            root.classList.remove('open');
            if (list.parentNode !== root) root.appendChild(list);
            list.classList.remove('dropdown-portal');
            list.style.cssText = '';
        };

        const closeOtherPortals = () => {
            document.querySelectorAll('.dropdown-list.dropdown-portal').forEach(other => {
                if (other === list) return;
                const owner = other._ownerDropdown;
                if (owner) {
                    owner.classList.remove('open');
                    owner.appendChild(other);
                }
                other.classList.remove('dropdown-portal');
                other.style.cssText = '';
            });
        };

        const open = () => {
            closeOtherPortals();
            root.classList.add('open');
            list._ownerDropdown = root;
            document.body.appendChild(list);
            list.classList.add('dropdown-portal');

            const header = root.querySelector('.dropdown-header');
            const rect = header.getBoundingClientRect();
            const width = Math.max(rect.width, 220);
            list.style.width = `${width}px`;
            list.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - width - 8))}px`;
            list.style.right = 'auto';
            list.style.top = '0px';
            const listHeight = list.offsetHeight;
            let top = rect.bottom + 8;
            if (top + listHeight > window.innerHeight - 8) top = rect.top - listHeight - 8;
            list.style.top = `${Math.max(8, top)}px`;
        };

        const header = root.querySelector('.dropdown-header');
        if (header) {
            header.addEventListener('click', (e) => {
                e.stopPropagation();
                if (root.classList.contains('open')) close();
                else open();
            });
        }
        items.forEach(item => {
            item.addEventListener('click', (e) => {
                e.stopPropagation();
                setValue(item.dataset.value);
                close();
                if (id === 'exportFormatDropdown') updateExportUi();
            });
        });
        document.addEventListener('click', close);
        return { getValue: () => value, setValue };
    };

    const exportFormatDropdown = setupExportDropdown('exportFormatDropdown', 'png-pages');
    const exportPdfQualityDropdown = setupExportDropdown('exportPdfQualityDropdown', '2');

    const safeBaseName = () => {
        const raw = (exportFileName && exportFileName.value || 'my-board').trim();
        return (raw.replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim() || 'my-board');
    };

    const updateExportUi = () => {
        const format = exportFormatDropdown.getValue();
        if (exportPdfQualityRow) {
            exportPdfQualityRow.style.display = format === 'pdf-pages' ? 'flex' : 'none';
        }
        if (exportHint) {
            if (format === 'pdf-pages') {
                exportHint.textContent = 'Каждая заполненная страница станет отдельной страницей PDF.';
            } else if (format === 'png-pages') {
                exportHint.textContent = 'Будут сохранены только заполненные страницы, по одному PNG на страницу.';
            } else if (format === 'jpg-view') {
                exportHint.textContent = 'Будет сохранён текущий вид холста одной картинкой JPG.';
            } else if (format === 'png-view') {
                exportHint.textContent = 'Будет сохранён текущий вид холста одной картинкой PNG без сжатия.';
            } else {
                exportHint.textContent = 'Проект .board можно снова открыть в редакторе.';
            }
        }
    };

    const openExportModal = () => {
        if (!exportModal) return;
        const settingsMenu = document.getElementById('settingsMenu');
        if (settingsMenu) settingsMenu.classList.remove('visible');
        exportModal.classList.remove('hidden');
        exportModal.classList.add('active');
        updateExportUi();
    };

    const closeExportModal = () => {
        if (!exportModal) return;
        exportModal.classList.add('hidden');
        exportModal.classList.remove('active');
    };

    if (exportBtn) {
        exportBtn.addEventListener('click', (e) => {
            e.preventDefault();
            openExportModal();
        });
    }
    const exportCloseBtn = document.getElementById('exportCloseBtn');
    const exportCancelBtn = document.getElementById('exportCancelBtn');
    if (exportCloseBtn) exportCloseBtn.addEventListener('click', closeExportModal);
    if (exportCancelBtn) exportCancelBtn.addEventListener('click', closeExportModal);
    if (exportModal) {
        exportModal.addEventListener('click', (e) => {
            if (e.target === exportModal) closeExportModal();
        });
    }

    if (exportStartBtn) {
        exportStartBtn.addEventListener('click', async () => {
            const format = exportFormatDropdown.getValue();
            const baseName = safeBaseName();

            if (format === 'board') {
                window.__pendingProjectName = baseName;
                closeExportModal();
                const saveBtn = document.getElementById('saveProjectBtn');
                if (saveBtn) saveBtn.click();
                return;
            }

            if (format === 'jpg-view' || format === 'png-view') {
                const canvas = await buildBoardExportCanvas();
                if (format === 'jpg-view') {
                    downloadCanvas(canvas, 'image/jpeg', `${baseName}.jpg`, 0.95);
                } else {
                    downloadCanvas(canvas, 'image/png', `${baseName}.png`);
                }
                closeExportModal();
                return;
            }

            const pages = collectFilledPages();
            if (pages.length === 0) {
                alert('На страницах пока ничего не нарисовано.');
                return;
            }

            if (format === 'pdf-pages') {
                const scale = parseFloat(exportPdfQualityDropdown.getValue()) || 2;
                const canvases = [];
                for (const page of pages) {
                    canvases.push(await buildPageExportCanvas(page, scale));
                }
                const layout = getPageLayout(canvasState);
                const widthPt = (layout.width / PAGE_PX_PER_MM) * (72 / 25.4);
                const heightPt = (layout.height / PAGE_PX_PER_MM) * (72 / 25.4);
                const pdf = createPdfFromCanvases(canvases, widthPt.toFixed(2), heightPt.toFixed(2));
                downloadBlob(pdf, `${baseName}.pdf`);
                closeExportModal();
                return;
            }

            for (let i = 0; i < pages.length; i++) {
                const page = pages[i];
                const canvas = await buildPageExportCanvas(page, 3);
                await downloadPageCanvas(canvas, `${baseName}-${String(page.order).padStart(2, '0')}.png`);
                await new Promise(resolve => setTimeout(resolve, 250));
            }
            closeExportModal();
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
                canvasMode: canvasState.canvasMode || 'infinite',
                pageFormat: canvasState.pageFormat || 'A4',
                pageOrientation: canvasState.pageOrientation || 'portrait',
                showPageGuides: canvasState.showPageGuides !== false,
                rulers: canvasState.rulers || [],
                stickerLinks: canvasState.viewState ? (canvasState.viewState.stickerLinks || []) : []
            },
            layers: serializeLayers(canvasState.layers)
        };

        const dataStr = JSON.stringify(projectData);
        const blob = new Blob([dataStr], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.download = `${window.__pendingProjectName || 'project'}.board`;
        window.__pendingProjectName = null;
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