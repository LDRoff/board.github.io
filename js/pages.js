// Геометрия листов. Мировые координаты — пиксели при 4.8 px/мм.
const PX_PER_MM = 4.8;
export const PAGE_PX_PER_MM = PX_PER_MM;

export const PAGE_FORMATS = {
    A3: { widthMm: 297, heightMm: 420, label: 'A3' },
    A4: { widthMm: 210, heightMm: 297, label: 'A4' },
    A5: { widthMm: 148, heightMm: 210, label: 'A5' },
    Letter: { widthMm: 215.9, heightMm: 279.4, label: 'Letter' }
};

export const PAGE_GAP = 0;

export function getPageSize(format = 'A4', orientation = 'portrait') {
    const preset = PAGE_FORMATS[format] || PAGE_FORMATS.A4;
    const longSide = Math.max(preset.widthMm, preset.heightMm) * PX_PER_MM;
    const shortSide = Math.min(preset.widthMm, preset.heightMm) * PX_PER_MM;
    return orientation === 'landscape'
        ? { width: longSide, height: shortSide }
        : { width: shortSide, height: longSide };
}

export function getPageLayout(state) {
    const format = (state && state.pageFormat) || 'A4';
    const orientation = (state && state.pageOrientation) || 'portrait';
    const size = getPageSize(format, orientation);
    return {
        format,
        orientation,
        width: size.width,
        height: size.height,
        gap: PAGE_GAP,
        pitch: size.height + PAGE_GAP
    };
}

export function getPageRect(col, row, layout) {
    return {
        col,
        row,
        x: col * layout.width,
        y: row * layout.height,
        width: layout.width,
        height: layout.height
    };
}

export function getPageAt(pos, layout) {
    if (!pos) return null;
    const col = Math.floor(pos.x / layout.width);
    const row = Math.floor(pos.y / layout.height);
    return getPageRect(col, row, layout);
}

export function isInsidePage(pos, layout) {
    return !!getPageAt(pos, layout);
}

export function getVisiblePageRects(state, viewportWidth, viewportHeight) {
    const layout = getPageLayout(state);
    const zoom = state.zoom || 1;
    const panX = state.panX || 0;
    const panY = state.panY || 0;
    const left = -panX / zoom;
    const right = (viewportWidth - panX) / zoom;
    const top = -panY / zoom;
    const bottom = (viewportHeight - panY) / zoom;

    const startCol = Math.floor(left / layout.width) - 1;
    const endCol = Math.floor(right / layout.width) + 1;
    const startRow = Math.floor(top / layout.height) - 1;
    const endRow = Math.floor(bottom / layout.height) + 1;

    const rects = [];
    for (let row = startRow; row <= endRow; row++) {
        for (let col = startCol; col <= endCol; col++) {
            rects.push(getPageRect(col, row, layout));
        }
    }
    return rects;
}

// Тетрадный режим: листы только в одной вертикальной колонке.
export function getNotebookPageRects(state, viewportHeight) {
    const layout = getPageLayout(state);
    const zoom = state.zoom || 1;
    const panY = state.panY || 0;
    const top = -panY / zoom;
    const bottom = (viewportHeight - panY) / zoom;
    const startRow = Math.max(0, Math.floor(top / layout.height) - 1);
    const endRow = Math.max(0, Math.floor(bottom / layout.height) + 1);
    const rects = [];
    for (let row = startRow; row <= endRow; row++) {
        rects.push(getPageRect(0, row, layout));
    }
    return rects;
}

export function isInsideNotebookPage(pos, layout) {
    return !!pos && pos.x >= 0 && pos.x <= layout.width && pos.y >= 0;
}

// Не даёт вертикальной колонке листов полностью уехать за экран.
export function clampNotebookView(state, viewWidth, viewHeight) {
    if (!state || state.canvasMode !== 'notebook') return;
    const layout = getPageLayout(state);
    const zoom = state.zoom || 1;
    const pageWidth = layout.width * zoom;
    const pageHeight = layout.height * zoom;
    const minVisibleX = Math.min(80, pageWidth);
    const minVisibleY = Math.min(80, pageHeight);

    let panX = state.panX || 0;
    let panY = state.panY || 0;

    if (panX + pageWidth < minVisibleX) panX = minVisibleX - pageWidth;
    if (panX > viewWidth - minVisibleX) panX = viewWidth - minVisibleX;

    // Листы начинаются с y = 0. Ниже листов бесконечно много, поэтому
    // ограничиваем только уход выше первого листа.
    if (panY > viewHeight - minVisibleY) panY = viewHeight - minVisibleY;

    state.panX = panX;
    state.panY = panY;
}

export function getPageKey(col, row) {
    return `${col}:${row}`;
}

export function getPageKeyFromRect(rect) {
    return getPageKey(rect.col, rect.row);
}

// Собирает страницы, в которых есть объекты, и нумерует их от левой верхней
// заполненной: сначала вправо, потом вниз. Пустые страницы пропускаются.
export function orderFilledPages(boxes, layout) {
    const filled = new Map();

    boxes.forEach(box => {
        if (!box) return;
        const { x, y, width, height } = box;
        if (![x, y, width, height].every(Number.isFinite)) return;
        if (width <= 0 || height <= 0) return;

        const startCol = Math.floor(x / layout.width);
        const endCol = Math.floor((x + width) / layout.width);
        const startRow = Math.floor(y / layout.height);
        const endRow = Math.floor((y + height) / layout.height);

        for (let row = startRow; row <= endRow; row++) {
            for (let col = startCol; col <= endCol; col++) {
                const page = getPageRect(col, row, layout);
                if (x < page.x + page.width && x + width > page.x &&
                    y < page.y + page.height && y + height > page.y) {
                    filled.set(getPageKey(col, row), page);
                }
            }
        }
    });

    return [...filled.values()]
        .sort((a, b) => (a.row - b.row) || (a.col - b.col))
        .map((page, index) => ({ ...page, order: index + 1 }));
}

export function clampPointToPage(pos, layout) {
    const page = getPageAt(pos, layout);
    if (page) return { x: pos.x, y: pos.y };
    return {
        x: Math.max(page.x, Math.min(page.x + page.width, pos.x)),
        y: Math.max(page.y, Math.min(page.y + page.height, pos.y))
    };
}
