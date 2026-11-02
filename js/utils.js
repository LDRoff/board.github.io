// --- START OF FILE js/utils.js ---

import { getBoundingBox, rotatePoint, getTransformedBoundingBox } from './geometry.js?v=1.4.19';
import * as rulerTools from './rulerTools.js?v=1.4.19';

export const mediaCache = {};

const GRID_SPACING = 20;

// Увеличиваем размер ячейки сетки, чтобы уменьшить количество ключей, 
// но сохранить эффективность фильтрации.
const SPATIAL_GRID_CELL_SIZE = 500;

/**
 * Создает динамический курсор-ластик для canvas `style.cursor`.
 */
export function getEraserCursorStyle(eraserWidth, zoom, isDarkTheme) {
    const size = Math.max(10, eraserWidth * zoom);
    const safeSize = Math.min(Math.round(size), 128); // Browser cursor size limits
    const halfSize = safeSize / 2;
    const radius = Math.max(1, halfSize - 1.25);

    // Fallback URL encoded # string because standard `#` isn't processed properly in all browsers' data URIs
    const strokeColor = isDarkTheme ? '%23f0f2f5' : '%23333333';
    const fillStyle = isDarkTheme ? 'rgba(0, 0, 0, 0.5)' : 'rgba(255, 255, 255, 0.5)';

    const svgString = `<svg xmlns="http://www.w3.org/2000/svg" width="${safeSize}" height="${safeSize}" viewBox="0 0 ${safeSize} ${safeSize}"><circle cx="${halfSize}" cy="${halfSize}" r="${radius}" stroke="${strokeColor}" stroke-width="1.5" fill="${fillStyle}"/></svg>`;
    const encodedSvg = svgString.replace(/"/g, "'").replace(/</g, "%3C").replace(/>/g, "%3E").replace(/&/g, "%26").replace(/#/g, "%23");

    return `url("data:image/svg+xml;charset=utf-8,${encodedSvg}") ${halfSize} ${halfSize}, auto`;
}

/**
 * Создает HTML-изображение для текстового слоя.
 */
const LEGACY_FONT_MAP = {
    'arial': "'Roboto', sans-serif",
    'helvetica': "'Roboto', sans-serif",
    'verdana': "'Roboto', sans-serif",
    'tahoma': "'Roboto', sans-serif",
    'system-ui': "'Roboto', sans-serif",
    'sans-serif': "'Roboto', sans-serif",
    'trebuchet ms': "'Montserrat', sans-serif",
    'georgia': "'Lora', serif",
    'times new roman': "'Lora', serif",
    'times': "'Lora', serif",
    'serif': "'Lora', serif",
    'courier new': "'Fira Code', monospace",
    'courier': "'Fira Code', monospace",
    'monospace': "'Fira Code', monospace",
    'impact': "'Oswald', sans-serif",
    'comic sans ms': "'Caveat', cursive",
    'cursive': "'Caveat', cursive",
};

export function normalizeTextFonts(layer) {
    if (!layer || layer.type !== 'text') return layer;

    const firstFamily = (value) => String(value || '').split(',')[0].replace(/['"]/g, '').trim().toLowerCase();
    const layerFamily = firstFamily(layer.fontFamily);
    if (LEGACY_FONT_MAP[layerFamily]) {
        layer.fontFamily = LEGACY_FONT_MAP[layerFamily];
    }

    if (layer.content && /font-family|<font/i.test(layer.content)) {
        const div = document.createElement('div');
        div.innerHTML = layer.content;
        div.querySelectorAll('[style]').forEach(el => {
            const family = firstFamily(el.style.fontFamily);
            if (LEGACY_FONT_MAP[family]) {
                el.style.fontFamily = LEGACY_FONT_MAP[family];
            }
        });
        div.querySelectorAll('font[face]').forEach(el => {
            const family = firstFamily(el.getAttribute('face'));
            if (LEGACY_FONT_MAP[family]) {
                el.setAttribute('face', LEGACY_FONT_MAP[family]);
            }
        });
        layer.content = div.innerHTML;
    }

    return layer;
}

// Формулы в тексте раньше были редактируемыми и имели фиксированный кегль.
// Делаем их неделимыми (править — только в редакторе) и, если нужно,
// переводим размер на 1em, чтобы он наследовался от текста.
export function migrateInlineFormulaSizes(content, { resize = true } = {}) {
    if (!content || content.indexOf('data-math') === -1) return content;
    try {
        const div = document.createElement('div');
        div.innerHTML = content;
        let changed = false;

        div.querySelectorAll('[data-math]').forEach((span) => {
            if (span.getAttribute('contenteditable') !== 'false') {
                span.setAttribute('contenteditable', 'false');
                changed = true;
            }
            span.querySelectorAll('[data-row]').forEach((row) => {
                if (row.hasAttribute('contenteditable')) {
                    row.removeAttribute('contenteditable');
                    changed = true;
                }
            });
            const root = span.querySelector('[data-math-root]');
            if (resize && root && root.style.fontSize !== '1em') {
                root.style.fontSize = '1em';
                changed = true;
            }
        });

        return changed ? div.innerHTML : content;
    } catch (e) {
        return content;
    }
}

export function createTextImage(layer, skipFonts = false, lineHeight = 1.2) {
    normalizeTextFonts(layer);
    if (layer.content && layer.content.indexOf('data-math') !== -1) {
        // При отрисовке только снимаем редактируемость, размер не трогаем.
        layer.content = migrateInlineFormulaSizes(layer.content, { resize: false });
    }
    window.__localFontsCssByFamily = window.__localFontsCssByFamily || {};
    return new Promise((resolve) => {
        (async () => {
        try {
        const { width, height, content, color, fontSize, fontFamily, align, fontWeight, fontStyle, textDecoration } = layer;

        if (!content) {
            resolve(null);
            return;
        }

        // Ждём именно нужное семейство, а не все шрифты документа:
        // document.fonts.ready мог ждать лишние шрифты и тормозить загрузку.
        if (!skipFonts && document.fonts) {
            const withTimeout = (promise, ms) => Promise.race([
                promise,
                new Promise(resolve => setTimeout(resolve, ms))
            ]);
            try {
                const primaryFamily = String(fontFamily || '').split(',')[0].replace(/['"]/g, '').trim();
                if (primaryFamily && document.fonts.load) {
                    await withTimeout(document.fonts.load(`${fontStyle || 'normal'} ${fontWeight || 'normal'} ${fontSize || 16}px "${primaryFamily}"`), 1200);
                }
            } catch (e) { /* ignore */ }
        }

        const measureDiv = document.createElement('div');
        measureDiv.style.cssText = `
            width: ${width}px;
            font-size: ${fontSize}px;
            font-family: ${fontFamily};
            font-weight: ${fontWeight};
            font-style: ${fontStyle};
            text-align: ${align};
            text-decoration: ${textDecoration};
            line-height: ${lineHeight};
            word-wrap: break-word;
            white-space: pre-wrap;
            padding: 10px;
            box-sizing: border-box;
            position: absolute;
            visibility: hidden;
            top: -9999px;
            left: -9999px;
            pointer-events: none;
        `;
        measureDiv.innerHTML = content;
        document.body.appendChild(measureDiv);
        const measuredHeight = measureDiv.scrollHeight;
        // Always update height to match the reflowed text (allow both growth and shrinkage)
        if (measuredHeight && measuredHeight > 10) {
            layer.height = measuredHeight;
        }
        const finalHeight = layer.height;
        document.body.removeChild(measureDiv);

        const tempDiv = document.createElement('div');
        tempDiv.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
        tempDiv.style.cssText = `
            width: 100%;
            height: 100%;
            font-size: ${fontSize}px;
            font-family: ${fontFamily};
            font-weight: ${fontWeight};
            font-style: ${fontStyle};
            text-align: ${align};
            text-decoration: ${textDecoration};
            color: ${color};
            line-height: ${lineHeight};
            word-wrap: break-word;
            white-space: pre-wrap;
            background: transparent;
            margin: 0;
            padding: 10px;
            box-sizing: border-box;
        `;

        tempDiv.innerHTML = content;

        const serializer = new XMLSerializer();
        const xhtml = serializer.serializeToString(tempDiv);
        const pad = 0;

        const primaryFamily = String(fontFamily || '').split(',')[0].replace(/['"]/g, '').trim();
        const familyKey = primaryFamily.toLowerCase();

        if (!skipFonts && primaryFamily) {
            try {
                const cssUrl = new URL('css/fonts.css', document.baseURI).href;
                if (!window.__localFontsRawCssPromise) {
                    window.__localFontsRawCssPromise = fetch(cssUrl).then(r => {
                        if (!r.ok) throw new Error(`HTTP ${r.status}`);
                        return r.text();
                    });
                }
                const rawCss = await window.__localFontsRawCssPromise;
                const blocks = rawCss.match(/@font-face\s*\{[^}]*\}/g) || [];

                // Оставляем только нужное семейство и те unicode-подмножества,
                // символы которых реально есть в тексте: иначе в каждый SVG
                // попадают мегабайты base64 и мобильный браузер его не грузит.
                const textCodePoints = [...(tempDiv.textContent || '')].map(ch => ch.codePointAt(0));
                const rangeMatches = (block) => {
                    const rm = block.match(/unicode-range:\s*([^;]+);/);
                    if (!rm) return true;
                    const ranges = rm[1].split(',').map(part => {
                        const m = part.trim().match(/^U\+([0-9A-F]+)(?:-([0-9A-F]+))?$/i);
                        if (!m) return null;
                        const start = parseInt(m[1], 16);
                        return [start, m[2] ? parseInt(m[2], 16) : start];
                    }).filter(Boolean);
                    if (ranges.length === 0) return true;
                    return textCodePoints.some(cp => ranges.some(([a, b]) => cp >= a && cp <= b));
                };
                const selected = blocks.filter(block => {
                    const match = block.match(/font-family:\s*['"]?([^'";]+)['"]?/);
                    if (!match || match[1].trim().toLowerCase() !== familyKey) return false;
                    return rangeMatches(block);
                });
                if (selected.length === 0) {
                    window.__localFontsCssByFamily[familyKey] = '';
                } else {
                    const cacheKey = familyKey + '|' + selected.map(b => (b.match(/url\('([^']+)'\)/) || [])[1] || '').join(',');
                    window.__localFontsCssCache = window.__localFontsCssCache || {};
                    if (!window.__localFontsCssCache[cacheKey]) {
                        let cssText = selected.join('\n');
                        const urls = [...cssText.matchAll(/url\(['"]?([^)'"]+\.woff2)['"]?\)/g)];
                        for (const match of urls) {
                            const fontUrl = new URL(match[1], cssUrl).href;
                            try {
                                window.__localFontBase64Cache = window.__localFontBase64Cache || {};
                                window.__localFontFetchPromises = window.__localFontFetchPromises || {};
                                let base64 = window.__localFontBase64Cache[fontUrl];
                                if (!base64) {
                                    // Один и тот же шрифт нужен всем текстовым слоям:
                                    // дедуплицируем параллельные загрузки.
                                    if (!window.__localFontFetchPromises[fontUrl]) {
                                        window.__localFontFetchPromises[fontUrl] = (async () => {
                                            const fontRes = await fetch(fontUrl);
                                            const blob = await fontRes.blob();
                                            const safeBlob = new Blob([blob], { type: 'font/woff2' });
                                            return new Promise((res) => {
                                                const reader = new FileReader();
                                                reader.onloadend = () => res(reader.result);
                                                reader.readAsDataURL(safeBlob);
                                            });
                                        })();
                                    }
                                    base64 = await window.__localFontFetchPromises[fontUrl];
                                    window.__localFontBase64Cache[fontUrl] = base64;
                                }
                                cssText = cssText.replace(match[0], `url("${base64}")`);
                            } catch (e) {
                                console.warn('Failed to fetch/encode local font:', fontUrl, e);
                                delete window.__localFontFetchPromises[fontUrl];
                            }
                        }
                        window.__localFontsCssCache[cacheKey] = cssText;
                    }
                    window.__localFontsCssByFamily[familyKey] = window.__localFontsCssCache[cacheKey];
                }
            } catch (e) {
                console.warn('Failed to load local fonts CSS', e);
                window.__localFontsCssByFamily[familyKey] = '';
            }
        }

        const svgString = `
        <svg xmlns="http://www.w3.org/2000/svg" width="${width + pad}" height="${finalHeight + pad}">
            <style>
                ${(!skipFonts && primaryFamily && window.__localFontsCssByFamily && window.__localFontsCssByFamily[familyKey]) || ''}
                span, u, ins, b, i, strong, em { text-decoration-color: currentColor; }
                sup, span[style*="vertical-align: super"] { font-size: 0.5em !important; vertical-align: super !important; }
                sub, span[style*="vertical-align: sub"] { font-size: 0.5em !important; vertical-align: sub !important; }
                sup *, sub * { font-size: inherit !important; }
            </style>
            <foreignObject width="100%" height="100%">
                ${xhtml}
            </foreignObject>
        </svg>`;

        const img = new Image();
        // Use btoa to safely encode the SVG containing massive Base64 strings, avoiding URL encoding issues
        const encodedSvg = btoa(unescape(encodeURIComponent(svgString)));
        const url = `data:image/svg+xml;base64,${encodedSvg}`;

        img.onload = () => {
            resolve(img);
        };

        img.onerror = (e) => {
            console.warn("SVG Gen Error", e);
            resolve(null);
        };

        img.src = url;
        } catch (err) {
            console.error('createTextImage failed:', err);
            resolve(null);
        }
        })();
    });
}

// --- НАЧАЛО ИЗМЕНЕНИЙ: Оптимизация Spatial Grid ---
export function buildSpatialGrid(layers) {
    const grid = new Map();

    // Проходимся по всем слоям и раскладываем их по ячейкам сетки
    for (const layer of layers) {
        // Используем getBoundingBox для скорости, трансформация тут менее важна,
        // так как сетка - это broad-phase (грубая проверка)
        const box = getTransformedBoundingBox(layer);
        if (!box) continue;

        const startCol = Math.floor(box.x / SPATIAL_GRID_CELL_SIZE);
        const endCol = Math.floor((box.x + box.width) / SPATIAL_GRID_CELL_SIZE);
        const startRow = Math.floor(box.y / SPATIAL_GRID_CELL_SIZE);
        const endRow = Math.floor((box.y + box.height) / SPATIAL_GRID_CELL_SIZE);

        for (let row = startRow; row <= endRow; row++) {
            for (let col = startCol; col <= endCol; col++) {
                const key = `${col}_${row}`;
                if (!grid.has(key)) {
                    grid.set(key, []);
                }
                grid.get(key).push(layer);
            }
        }
    }
    return grid;
}

export function getLayersInProximity(grid, pos, zoom) {
    if (!grid) return [];

    // Определяем ячейку, в которой находится курсор
    const col = Math.floor(pos.x / SPATIAL_GRID_CELL_SIZE);
    const row = Math.floor(pos.y / SPATIAL_GRID_CELL_SIZE);

    // Собираем слои из текущей ячейки и соседних (на случай, если объект на границе)
    // При ластике лучше проверять 3x3 ячейки вокруг курсора
    const layersSet = new Set();

    for (let r = row - 1; r <= row + 1; r++) {
        for (let c = col - 1; c <= col + 1; c++) {
            const key = `${c}_${r}`;
            const cellLayers = grid.get(key);
            if (cellLayers) {
                for (let i = 0; i < cellLayers.length; i++) {
                    layersSet.add(cellLayers[i]);
                }
            }
        }
    }

    return Array.from(layersSet);
}
// --- КОНЕЦ ИЗМЕНЕНИЙ ---


export function translateLayer(layer, dx, dy) {
    if (layer.points && typeof layer.points[0] === 'number') {
        const step = layer.hasPressure ? 3 : 2;
        for (let i = 0; i < layer.points.length; i += step) {
            layer.points[i] += dx;
            layer.points[i + 1] += dy;
        }
    } else if (layer.points) {
        layer.points.forEach(p => { p.x += dx; p.y += dy; });
    }

    const translatePoint = p => { if (p && typeof p.x === 'number') { p.x += dx; p.y += dy; } };

    if (typeof layer.x === 'number' && typeof layer.y === 'number') { 
        layer.x += dx; 
        layer.y += dy; 
        if (layer.type === 'sticker' && window.stickerApp && window.stickerApp.stickers) {
            const s = window.stickerApp.stickers.find(st => st.id === layer.id);
            if (s) {
                s.x = layer.x;
                s.y = layer.y;
            }
        }
    }
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

async function preloadFontsForTextLayers(layers) {
    if (!document.fonts || !document.fonts.load) return;
    const specs = new Set();
    for (const layer of layers) {
        const family = String(layer.fontFamily || '').split(',')[0].replace(/['"]/g, '').trim();
        if (!family) continue;
        specs.add(`${layer.fontStyle || 'normal'} ${layer.fontWeight || 'normal'} ${layer.fontSize || 16}px "${family}"`);
    }
    if (specs.size === 0) return;
    await Promise.race([
        Promise.all([...specs].map(spec => {
            try {
                return document.fonts.load(spec).catch(() => null);
            } catch (e) {
                return Promise.resolve(null);
            }
        })),
        new Promise(resolve => setTimeout(resolve, 1200))
    ]);
}

export async function rehydrateLayers(layers) {
    if (!layers) return [];

    const textLayersToRender = [];

    for (const layer of layers) {
        if (layer.type === 'image') {
            if (layer.image) continue;
            if (layer.src) {
                await new Promise((resolve) => {
                    const img = new Image();
                    let resolved = false;
                    const onReady = () => {
                        if (resolved) return;
                        resolved = true;
                        layer.image = img;
                        mediaCache[layer.id] = { image: img, src: layer.src };
                        resolve();
                    };
                    const onError = () => {
                        if (resolved) return;
                        resolved = true;
                        resolve();
                    };

                    img.onload = onReady;
                    img.onerror = onError;
                    img.src = layer.src;

                    if (img.decode) {
                        img.decode().then(onReady).catch(() => {
                            // Fallback to onload/onerror
                        });
                    }
                });
                // Yield to browser to keep animation smooth
                await new Promise(r => requestAnimationFrame(r));
            }
        } else if (layer.type === 'pdf') {
            if (layer.pdfDoc) continue;
            if (layer.fileData) {
                try {
                    const res = await fetch(`data:application/pdf;base64,${layer.fileData}`);
                    const arrayBuffer = await res.arrayBuffer();
                    const bytes = new Uint8Array(arrayBuffer);

                    pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.11.338/pdf.worker.min.js`;
                    const pdfDoc = await pdfjsLib.getDocument({ data: bytes }).promise;

                    layer.pdfDoc = pdfDoc;
                    layer.renderedPages = new Map();
                    mediaCache[layer.id] = { pdfDoc, renderedPages: layer.renderedPages, fileData: layer.fileData };
                    
                    await renderPdfPageToCanvas(layer, layer.currentPage);
                } catch (err) {
                    console.error("Не удалось загрузить PDF слой:", err);
                }
                // Yield to browser
                await new Promise(r => requestAnimationFrame(r));
            }
        } else if (layer.type === 'text') {
            normalizeTextFonts(layer);
            // Формулы внутри текста раньше хранились с фиксированным кеглем —
            // переводим их на «1em», чтобы они жили в размере текста слоя.
            if (layer.content && layer.content.indexOf('data-math') !== -1) {
                layer.content = migrateInlineFormulaSizes(layer.content);
            }
            if (!layer.cachedImage && layer.content) {
                textLayersToRender.push(layer);
            }
        }
    }

    // Текст генерируем параллельно и до первого показа доски: так пользователь
    // не видит сначала системный шрифт, а потом подмену на нужный.
    if (textLayersToRender.length > 0) {
        await preloadFontsForTextLayers(textLayersToRender);
        const generation = Promise.all(textLayersToRender.map(async layer => {
            try {
                layer.cachedImage = await createTextImage(layer);
            } catch (e) { /* слой останется с fallback-отрисовкой */ }
        }));
        // Страховка от вечного прелоадера: если генерация почему-то зависла,
        // показываем доску с fallback-текстом, не блокируя загрузку навсегда.
        await Promise.race([
            generation,
            new Promise(resolve => setTimeout(resolve, 5000))
        ]);
    }

    return layers;
}

export function serializeLayers(layers) {
    return layers.map(layer => {
        const newLayer = { ...layer };

        delete newLayer.image;
        delete newLayer.pdfDoc;
        delete newLayer.renderedPages;
        delete newLayer.cachedImage;
        delete newLayer._plotCache;

        return newLayer;
    });
}

export function cloneLayersForAction(layers) {
    const safeLayers = layers.map(layer => {
        const safe = { ...layer };
        if (safe.image) delete safe.image;
        if (safe.pdfDoc) delete safe.pdfDoc;
        if (safe.renderedPages) delete safe.renderedPages;
        if (safe.cachedImage) delete safe.cachedImage;
        if (safe._plotCache) delete safe._plotCache;
        if ('isEditing' in safe) delete safe.isEditing; // ИЗМЕНЕНИЕ: предотвращает зависание слоев в невидимом состоянии
        
        // Do not structuredClone massive base64 strings to save memory and CPU
        if (safe.fileData) delete safe.fileData;
        if (safe.src) delete safe.src;

        // Do not structuredClone runtime-only parent references (they are non-serializable)
        if (safe._parentRef) delete safe._parentRef;
        
        return safe;
    });

    try {
        const cloned = structuredClone(safeLayers);

        cloned.forEach((clonedLayer, index) => {
            const original = layers[index];

            if (original.type === 'image') {
                if (original.image) clonedLayer.image = original.image;
                if (original.src) clonedLayer.src = original.src;
            }
            if (original.type === 'pdf') {
                if (original.pdfDoc) clonedLayer.pdfDoc = original.pdfDoc;
                if (original.renderedPages) {
                    clonedLayer.renderedPages = new Map(original.renderedPages);
                }
                if (original.fileData) clonedLayer.fileData = original.fileData;
            }
            if (original.type === 'text' && original.cachedImage) {
                clonedLayer.cachedImage = original.cachedImage;
            }
            if (original._parentRef) {
                clonedLayer._parentRef = original._parentRef;
            }
        });

        return cloned;

    } catch (e) {
        console.error("Critical error in cloneLayersForAction:", e);
        return JSON.parse(JSON.stringify(layers));
    }
}

export function snapToGrid(value) {
    return Math.round(value / GRID_SPACING) * GRID_SPACING;
}

export function snapToRulers(pos, rulers, zoom) {
    if (!rulers || rulers.length === 0) return pos;
    const SNAP_THRESHOLD = 20 / zoom;
    
    let closestRuler = null;
    let minDistance = Infinity;
    let snappedLocalX = 0;
    let snappedLocalY = 0;
    let savedCos = 0;
    let savedSin = 0;
    
    for (const ruler of rulers) {
        const cos = Math.cos(-ruler.angle);
        const sin = Math.sin(-ruler.angle);
        const dx = pos.x - ruler.x;
        const dy = pos.y - ruler.y;
        
        const localX = dx * cos - dy * sin;
        const localY = dx * sin + dy * cos;
        
        if (ruler.type === 'protractor') {
            const radius = ruler.radius || 200;
            
            // 1. Snap to bottom flat edge of base bar (localY = baseH)
            const baseH = 45; // world units
            if (localX >= -radius && localX <= radius) {
                const distBase = Math.abs(localY - baseH);
                if (distBase < SNAP_THRESHOLD && distBase < minDistance) {
                    minDistance = distBase;
                    closestRuler = ruler;
                    snappedLocalX = localX;
                    snappedLocalY = baseH;
                    savedCos = Math.cos(ruler.angle);
                    savedSin = Math.sin(ruler.angle);
                }
            }
            
            // 2. Snap to circular arc (radius, localY <= 0)
            const distFromCenter = Math.hypot(localX, localY);
            if (localY <= 5 / zoom) {
                const distArc = Math.abs(distFromCenter - radius);
                if (distArc < SNAP_THRESHOLD && distArc < minDistance) {
                    minDistance = distArc;
                    closestRuler = ruler;
                    
                    const angle = Math.atan2(localY, localX);
                    let clampedAngle = angle;
                    if (clampedAngle > 0) {
                        clampedAngle = (clampedAngle < Math.PI / 2) ? 0 : -Math.PI;
                    }
                    if (clampedAngle < -Math.PI) clampedAngle = -Math.PI;
                    
                    snappedLocalX = radius * Math.cos(clampedAngle);
                    snappedLocalY = radius * Math.sin(clampedAngle);
                    savedCos = Math.cos(ruler.angle);
                    savedSin = Math.sin(ruler.angle);
                }
            }
        } else if (rulerTools.isTriangleRuler(ruler)) {
            // Угольник: прилипаем к любому из трёх рёбер.
            const edges = rulerTools.getTriangleEdgesLocal(ruler);
            for (const edge of edges) {
                const cp = rulerTools.closestPointOnSegment(localX, localY, edge.ax, edge.ay, edge.bx, edge.by);
                const dist = Math.hypot(localX - cp.x, localY - cp.y);
                if (dist < SNAP_THRESHOLD && dist < minDistance) {
                    minDistance = dist;
                    closestRuler = ruler;
                    snappedLocalX = cp.x;
                    snappedLocalY = cp.y;
                    savedCos = Math.cos(ruler.angle);
                    savedSin = Math.sin(ruler.angle);
                }
            }
        } else {
            // Straight ruler logic
            const halfL = ruler.length / 2;
            const halfW = ruler.width / 2;
            if (localX < -halfL || localX > halfL) continue;
            
            const distTop = Math.abs(localY - (-halfW));
            const distBottom = Math.abs(localY - halfW);
            
            if (distTop < SNAP_THRESHOLD && distTop < minDistance) {
                minDistance = distTop;
                closestRuler = ruler;
                snappedLocalX = localX;
                snappedLocalY = -halfW;
                savedCos = Math.cos(ruler.angle);
                savedSin = Math.sin(ruler.angle);
            }
            
            if (distBottom < SNAP_THRESHOLD && distBottom < minDistance) {
                minDistance = distBottom;
                closestRuler = ruler;
                snappedLocalX = localX;
                snappedLocalY = halfW;
                savedCos = Math.cos(ruler.angle);
                savedSin = Math.sin(ruler.angle);
            }
        }
    }
    
    if (closestRuler) {
        return {
            x: snappedLocalX * savedCos - snappedLocalY * savedSin + closestRuler.x,
            y: snappedLocalX * savedSin + snappedLocalY * savedCos + closestRuler.y
        };
    }
    return { ...pos };
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

// Максимальное количество закешированных страниц PDF в памяти
const MAX_CACHED_PDF_PAGES = 3;

export async function renderPdfPageToCanvas(layer, pageNum) {
    if (!layer.pdfDoc) return;
    try {
        const page = await layer.pdfDoc.getPage(pageNum);

        const unscaledViewport = page.getViewport({ scale: 1 });
        let scale = (layer.width / unscaledViewport.width) * 1.0;
        
        // Ограничиваем максимальный размер канваса для PDF
        const MAX_DIMENSION = 2048;
        if (unscaledViewport.width * scale > MAX_DIMENSION || unscaledViewport.height * scale > MAX_DIMENSION) {
            const ratio = Math.min(MAX_DIMENSION / unscaledViewport.width, MAX_DIMENSION / unscaledViewport.height);
            scale = ratio;
        }

        const viewport = page.getViewport({ scale });

        const canvas = document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const ctx = canvas.getContext('2d');

        await page.render({ canvasContext: ctx, viewport: viewport }).promise;

        layer.renderedPages.set(pageNum, canvas);

        // --- LRU-кеш: удаляем самые старые страницы, если их больше лимита ---
        if (layer.renderedPages.size > MAX_CACHED_PDF_PAGES) {
            const keysIter = layer.renderedPages.keys();
            while (layer.renderedPages.size > MAX_CACHED_PDF_PAGES) {
                const oldKey = keysIter.next().value;
                if (oldKey === undefined) break; // итератор исчерпан — защита от вечного цикла
                if (oldKey === pageNum) continue; // не удаляем только что отрендеренную
                const oldCanvas = layer.renderedPages.get(oldKey);
                // Освобождаем GPU-память, обнуляя размер канваса
                if (oldCanvas) { oldCanvas.width = 0; oldCanvas.height = 0; }
                layer.renderedPages.delete(oldKey);
            }
        }

    } catch (err) {
        console.error(`Не удалось отрендерить страницу ${pageNum}:`, err);
    }
}

function _getFileTypeLabel(file) {
    if (!file || !file.type) return 'Файл';
    const t = file.type.toLowerCase();
    if (t === 'image/png') return 'Изображение PNG';
    if (t === 'image/jpeg' || t === 'image/jpg') return 'Изображение JPEG';
    if (t === 'image/gif') return 'Изображение GIF';
    if (t === 'image/webp') return 'Изображение WebP';
    if (t === 'image/svg+xml') return 'Изображение SVG';
    if (t === 'image/bmp') return 'Изображение BMP';
    if (t.startsWith('image/')) return 'Изображение';
    if (t.includes('pdf')) return 'PDF документ';
    return 'Файл';
}

export function processImageFile(file, position, canvasState, redrawCallback, saveState) {
    if (!file.type.startsWith('image/')) return;

    const objectUrl = URL.createObjectURL(file);
    const originalImg = new Image();
    
    originalImg.onload = () => {
        const MAX_IMAGE_DIMENSION = 2000;
        let width = originalImg.naturalWidth;
        let height = originalImg.naturalHeight;

        const dpr = window.devicePixelRatio || 1;
        const viewportW = (canvasState.canvas.width / dpr) / canvasState.zoom;
        const viewportH = (canvasState.canvas.height / dpr) / canvasState.zoom;
        const maxW = viewportW * 0.8;
        const maxH = viewportH * 0.8;

        let imgW = width;
        let imgH = height;
        if (imgW > maxW || imgH > maxH) {
            const ratio = Math.min(maxW / imgW, maxH / imgH);
            imgW = Math.round(imgW * ratio);
            imgH = Math.round(imgH * ratio);
        }

        const centerX = ((canvasState.canvas.width / dpr) / 2 - canvasState.panX) / canvasState.zoom;
        const centerY = ((canvasState.canvas.height / dpr) / 2 - canvasState.panY) / canvasState.zoom;
        
        const finalX = centerX - imgW / 2;
        const finalY = centerY - imgH / 2;

        // Show ghost placeholder
        const loadingId = Date.now() + Math.random();
        if (canvasState && canvasState.loadingFiles) {
            canvasState.loadingFiles.push({
                id: loadingId,
                type: 'image',
                name: _getFileTypeLabel(file),
                x: finalX,
                y: finalY,
                width: imgW,
                height: imgH
            });
            if (canvasState.startAnimationLoop) canvasState.startAnimationLoop();
        }

        // Use requestAnimationFrame to ensure the ghost placeholder is painted first
        requestAnimationFrame(() => {
            // Remove ghost
            if (canvasState && canvasState.loadingFiles) {
                canvasState.loadingFiles = canvasState.loadingFiles.filter(l => l.id !== loadingId);
            }

            // Create layer IMMEDIATELY using the already-loaded originalImg
            const layerId = Date.now();
            const newLayer = {
                type: 'image',
                image: originalImg,
                src: null, // Will be populated lazily for persistence
                x: finalX,
                y: finalY,
                width: imgW,
                height: imgH,
                id: layerId,
                rotation: 0,
                pivot: { x: 0, y: 0 }
            };

            mediaCache[newLayer.id] = { image: originalImg, src: null };

            canvasState.layers.push(newLayer);
            canvasState.selectedLayers = [newLayer];

            if (canvasState.spatialGrid) canvasState.spatialGrid = buildSpatialGrid(canvasState.layers);
            if (canvasState.tileManager) canvasState.tileManager.invalidateLayer(newLayer);

            const selectButton = document.querySelector('button[data-tool="select"]');
            if (selectButton) selectButton.click();

            saveState({ type: 'creation', before: [], after: [newLayer] });
            redrawCallback();
            if (canvasState.updateFloatingToolbar) {
                canvasState.updateFloatingToolbar();
            }

            // --- Lazy background base64 conversion for persistence ---
            setTimeout(() => {
                const needsResize = width > MAX_IMAGE_DIMENSION || height > MAX_IMAGE_DIMENSION;
                
                if (needsResize) {
                    const ratio = MAX_IMAGE_DIMENSION / Math.max(width, height);
                    const newWidth = Math.round(width * ratio);
                    const newHeight = Math.round(height * ratio);

                    const offCanvas = document.createElement('canvas');
                    offCanvas.width = newWidth;
                    offCanvas.height = newHeight;
                    const offCtx = offCanvas.getContext('2d');
                    offCtx.drawImage(originalImg, 0, 0, newWidth, newHeight);

                    // Use toBlob (async) instead of toDataURL (sync, blocking)
                    offCanvas.toBlob((blob) => {
                        const reader = new FileReader();
                        reader.onload = (e) => {
                            const dataUrl = e.target.result;
                            const resizedImg = new Image();
                            resizedImg.onload = () => {
                                newLayer.image = resizedImg;
                                newLayer.src = dataUrl;
                                mediaCache[newLayer.id] = { image: resizedImg, src: dataUrl };
                                URL.revokeObjectURL(objectUrl);
                                redrawCallback();
                            };
                            resizedImg.src = dataUrl;
                        };
                        reader.readAsDataURL(blob);
                    }, file.type === 'image/png' ? 'image/png' : 'image/jpeg', 0.9);
                } else {
                    const reader = new FileReader();
                    reader.onload = (e) => {
                        newLayer.src = e.target.result;
                        mediaCache[newLayer.id] = { image: originalImg, src: e.target.result };
                        URL.revokeObjectURL(objectUrl);
                    };
                    reader.readAsDataURL(file);
                }
            }, 100);
        });
    };
    originalImg.src = objectUrl;
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

            // Scale to fit within 80% of visible viewport in world coordinates
            const dpr = window.devicePixelRatio || 1;
            const viewportW = (canvasState.canvas.width / dpr) / canvasState.zoom;
            const viewportH = (canvasState.canvas.height / dpr) / canvasState.zoom;
            const maxWidth = viewportW * 0.8;
            const maxHeight = viewportH * 0.8;

            let newWidth = initialViewport.width;
            let newHeight = initialViewport.height;

            if (newWidth > maxWidth || newHeight > maxHeight) {
                const ratio = Math.min(maxWidth / newWidth, maxHeight / newHeight);
                newWidth *= ratio;
                newHeight *= ratio;
            }

            // Center on screen
            const centerX = ((canvasState.canvas.width / dpr) / 2 - canvasState.panX) / canvasState.zoom;
            const centerY = ((canvasState.canvas.height / dpr) / 2 - canvasState.panY) / canvasState.zoom;

            const finalX = centerX - newWidth / 2;
            const finalY = centerY - newHeight / 2;

            const loadingId = Date.now() + Math.random();
            if (canvasState && canvasState.loadingFiles) {
                canvasState.loadingFiles.push({
                    id: loadingId,
                    type: 'pdf',
                    name: 'PDF документ',
                    x: finalX,
                    y: finalY,
                    width: newWidth,
                    height: newHeight
                });
                if (canvasState.startAnimationLoop) canvasState.startAnimationLoop();
            }

            // Use requestAnimationFrame to let browser paint the ghost
            requestAnimationFrame(async () => {
                const newLayer = {
                    type: 'pdf',
                    pdfDoc: pdfDoc,
                    renderedPages: new Map(),
                    numPages: pdfDoc.numPages,
                    currentPage: 1,
                    fileData: null, // Populated lazily
                    x: finalX,
                    y: finalY,
                    width: newWidth,
                    height: newHeight,
                    id: Date.now(),
                    rotation: 0,
                    pivot: { x: 0, y: 0 }
                };

                mediaCache[newLayer.id] = { pdfDoc: newLayer.pdfDoc, renderedPages: newLayer.renderedPages, fileData: null };

                await renderPdfPageToCanvas(newLayer, 1);

                if (canvasState && canvasState.loadingFiles) {
                    canvasState.loadingFiles = canvasState.loadingFiles.filter(l => l.id !== loadingId);
                }

                canvasState.layers.push(newLayer);
                canvasState.selectedLayers = [newLayer];

                if (canvasState.spatialGrid) {
                    canvasState.spatialGrid = buildSpatialGrid(canvasState.layers);
                }

                if (canvasState.tileManager) {
                    canvasState.tileManager.invalidateLayer(newLayer);
                }

                const selectButton = document.querySelector('button[data-tool="select"]');
                if (selectButton) selectButton.click();

                saveState({ type: 'creation', before: [], after: [newLayer] });
                redrawCallback();
                if (canvasState.updateFloatingToolbar) {
                    canvasState.updateFloatingToolbar();
                }

                // --- Lazy background base64 conversion for persistence ---
                setTimeout(() => {
                    const b64Reader = new FileReader();
                    b64Reader.onload = (b64e) => {
                        const dataUrl = b64e.target.result;
                        const base64Data = dataUrl.split(',')[1]; // remove data:application/pdf;base64,
                        newLayer.fileData = base64Data;
                        if (mediaCache[newLayer.id]) mediaCache[newLayer.id].fileData = base64Data;
                    };
                    b64Reader.readAsDataURL(file);
                }, 100);
            });

        } catch (error) {
            console.error('Ошибка при обработке PDF:', error);
            if (typeof loadingId !== 'undefined' && canvasState && canvasState.loadingFiles) {
                canvasState.loadingFiles = canvasState.loadingFiles.filter(l => l.id !== loadingId);
                if (redrawCallback) redrawCallback();
            }
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
            case 'arrow':
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
                const newParaCenter = rotatePoint({ x: layer.x + layer.width / 2, y: layer.y + layer.height / 2 }, pivotPoint, rotation);
                layer.x = newParaCenter.x - layer.width / 2;
                layer.y = newParaCenter.y - layer.height / 2;
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

function perpendicularDistanceFlat(ptX, ptY, p1X, p1Y, p2X, p2Y) {
    const dx = p2X - p1X;
    const dy = p2Y - p1Y;
    const lenSq = dx * dx + dy * dy;
    if (lenSq === 0) return Math.hypot(ptX - p1X, ptY - p1Y);
    return Math.abs(dy * ptX - dx * ptY + p2X * p1Y - p2Y * p1X) / Math.sqrt(lenSq);
}

export function simplifyPath(points, tolerance) {
    const len = points.length;
    if (len < 4) {
        return points;
    }

    let dmax = 0;
    let index = 0;
    const p1X = points[0];
    const p1Y = points[1];
    const p2X = points[len - 2];
    const p2Y = points[len - 1];

    for (let i = 2; i < len - 2; i += 2) {
        const d = perpendicularDistanceFlat(points[i], points[i + 1], p1X, p1Y, p2X, p2Y);
        if (d > dmax) {
            index = i;
            dmax = d;
        }
    }

    if (dmax > tolerance) {
        const recResults1 = simplifyPath(points.slice(0, index + 2), tolerance);
        const recResults2 = simplifyPath(points.slice(index), tolerance);

        return recResults1.slice(0, recResults1.length - 2).concat(recResults2);
    } else {
        return [p1X, p1Y, p2X, p2Y];
    }
}

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

/**
 * Полностью завершает временное взаимодействие (построение кривой,
 * многошаговые фигуры) и убирает его визуальные следы: превью живёт
 * на interactionCanvas и само не исчезает, плюс остаются висеть
 * document-слушатели и подсказка о следующем шаге.
 */
export function endTransientInteraction(state) {
    if (!state) return;

    state.currentAction = 'none';
    state.tempLayer = null;
    state.isDrawing = false;
    state.startPos = null;
    state.dragStartPos = null;

    if (state.iCtx && state.interactionCanvas) {
        state.iCtx.setTransform(1, 0, 0, 1, 0, 0);
        state.iCtx.clearRect(0, 0, state.interactionCanvas.width, state.interactionCanvas.height);
    }

    if (typeof state.hideCreationTooltip === 'function') {
        state.hideCreationTooltip();
    }

    if (state.onPointerMove) {
        document.removeEventListener('pointermove', state.onPointerMove);
    }
    if (state.onPointerUp) {
        document.removeEventListener('pointerup', state.onPointerUp);
    }
}


export function bindLayerToParent(state, layer) {
    if (!layer || layer.type === 'pdf' || layer.type === 'image' || layer.type === 'sticker') return;

    if (state && state.editingAnnotationsLayerId && layer.parentId === state.editingAnnotationsLayerId) {
        return;
    }

    // First, clear existing parent association
    delete layer.parentId;
    delete layer.parentPage;
    delete layer._parentRef;

    const box = getTransformedBoundingBox(layer);
    if (!box) return;

    const centerX = box.x + box.width / 2;
    const centerY = box.y + box.height / 2;

    let highestParent = null;
    let highestZ = -1;

    for (let i = 0; i < state.layers.length; i++) {
        const pLayer = state.layers[i];
        if (pLayer.type === 'pdf' || pLayer.type === 'image' || pLayer.type === 'sticker') {
            const pBox = getTransformedBoundingBox(pLayer);
            if (pBox && 
                centerX >= pBox.x && centerX <= pBox.x + pBox.width &&
                centerY >= pBox.y && centerY <= pBox.y + pBox.height) {
                
                // Point/Intersection check to prevent parenting when drawing around/outside the parent card
                let intersects = false;
                if (layer.type === 'path' && layer.points) {
                    const step = layer.hasPressure ? 3 : 2;
                    for (let j = 0; j < layer.points.length; j += step) {
                        const px = layer.points[j];
                        const py = layer.points[j+1];
                        if (px >= pBox.x && px <= pBox.x + pBox.width &&
                            py >= pBox.y && py <= pBox.y + pBox.height) {
                            intersects = true;
                            break;
                        }
                    }
                } else if ((layer.type === 'line' || layer.type === 'arrow') && layer.x1 !== undefined) {
                    const p1Inside = layer.x1 >= pBox.x && layer.x1 <= pBox.x + pBox.width &&
                                     layer.y1 >= pBox.y && layer.y1 <= pBox.y + pBox.height;
                    const p2Inside = layer.x2 >= pBox.x && layer.x2 <= pBox.x + pBox.width &&
                                     layer.y2 >= pBox.y && layer.y2 <= pBox.y + pBox.height;
                    if (p1Inside || p2Inside) {
                        intersects = true;
                    }
                } else {
                    const surrounds = box.x <= pBox.x && box.x + box.width >= pBox.x + pBox.width &&
                                      box.y <= pBox.y && box.y + box.height >= pBox.y + pBox.height;
                    intersects = !surrounds;
                }

                if (intersects && i > highestZ) {
                    highestZ = i;
                    highestParent = pLayer;
                }
            }
        }
    }

    if (highestParent) {
        layer.parentId = highestParent.id;
        layer._parentRef = highestParent;
        if (highestParent.type === 'pdf') {
            layer.parentPage = highestParent.currentPage;
        } else {
            layer.parentPage = 1;
        }

        // Adjust Z-order: make sure the child layer is placed after (rendered on top of) the parent PDF/image
        const parentIdx = state.layers.indexOf(highestParent);
        const childIdx = state.layers.indexOf(layer);
        if (childIdx !== -1 && parentIdx !== -1 && childIdx < parentIdx) {
            state.layers.splice(childIdx, 1);
            const newParentIdx = state.layers.indexOf(highestParent);
            state.layers.splice(newParentIdx + 1, 0, layer);
        }
    }
}
// --- END OF FILE js/utils.js ---