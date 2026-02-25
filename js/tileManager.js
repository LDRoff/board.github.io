// --- START OF FILE js/tileManager.js ---

import { getTransformedBoundingBox, doBoxesIntersect } from './geometry.js';

// Размер одной плитки в ЛОГИЧЕСКИХ пикселях
const TILE_SIZE = 1024;
// Размер ячейки сетки (должен совпадать с utils.js, но здесь для расчетов)
const SPATIAL_CELL = 500;

export class TileManager {
    constructor() {
        this.tiles = new Map();
        this.cachedZoom = 1;
        this.renderQueue = new Map();
        this.isProcessingQueue = false;
        this.updateTimeout = null;
        // Базовый бюджет времени. Для ластика будем его динамически повышать.
        this.frameBudget = 16;
        this.isColdStart = true; // First render gets a higher budget
    }

    clear() {
        this.tiles.clear();
        this.renderQueue.clear();
    }

    invalidateLayer(layer, state) {
        const box = getTransformedBoundingBox(layer);

        if (state && state.layerBBoxCache) {
            if (box) {
                state.layerBBoxCache.set(layer.id, box);
            } else {
                state.layerBBoxCache.delete(layer.id);
            }
        }

        if (!box) return;

        const startCol = Math.floor(box.x / TILE_SIZE);
        const endCol = Math.floor((box.x + box.width) / TILE_SIZE);
        const startRow = Math.floor(box.y / TILE_SIZE);
        const endRow = Math.floor((box.y + box.height) / TILE_SIZE);

        for (let row = startRow; row <= endRow; row++) {
            for (let col = startCol; col <= endCol; col++) {
                const key = `${col}_${row}`;
                if (this.tiles.has(key)) {
                    this.tiles.get(key).isDirty = true;
                }
                // Если плитка помечена грязной, удаляем её из очереди, 
                // чтобы она была добавлена заново с актуальными параметрами при отрисовке
                if (this.renderQueue.has(key)) {
                    this.renderQueue.delete(key);
                }
            }
        }
    }

    // skipRedraw: если true — не вызывать state.redraw() после обработки
    // (используется когда processQueue вызывается из drawVisibleTiles)
    processQueue(state, drawLayerCallback, skipRedraw = false) {
        const isEraser = state.activeTool === 'eraser';
        const isPerformanceCriticalAction = (state.isInteracting || state.isPanning || state.isMultiTouching || (state.isDrawing && !isEraser));

        if (isPerformanceCriticalAction) {
            this.isProcessingQueue = false;
            setTimeout(() => {
                if (this.renderQueue.size > 0 && !this.isProcessingQueue) {
                    this.processQueue(state, drawLayerCallback);
                }
            }, 100);
            return;
        }

        if (this.renderQueue.size === 0) {
            this.isProcessingQueue = false;
            return;
        }

        this.isProcessingQueue = true;

        const startTime = performance.now();
        // Cold start: render tiles faster to reduce initial load freeze
        const currentBudget = this.isColdStart ? 32 : (isEraser ? 48 : this.frameBudget);

        const viewportCenterCol = Math.floor((-state.panX / state.zoom + (state.canvas.width / state.zoom) / 2) / TILE_SIZE);
        const viewportCenterRow = Math.floor((-state.panY / state.zoom + (state.canvas.height / state.zoom) / 2) / TILE_SIZE);

        const queueEntries = Array.from(this.renderQueue.entries());

        queueEntries.sort((a, b) => {
            const distA = Math.abs(a[1].col - viewportCenterCol) + Math.abs(a[1].row - viewportCenterRow);
            const distB = Math.abs(b[1].col - viewportCenterCol) + Math.abs(b[1].row - viewportCenterRow);
            return distA - distB;
        });

        let processedCount = 0;

        for (const [key, params] of queueEntries) {
            if (performance.now() - startTime > currentBudget) {
                break;
            }

            if ((state.isInteracting || state.isPanning) && !isEraser) {
                break;
            }

            this.renderQueue.delete(key);
            processedCount++;

            this._renderTile(key, params, state, drawLayerCallback);
        }

        // Вызываем redraw только если это фоновая обработка (не из drawVisibleTiles)
        if (processedCount > 0 && state.redraw && !skipRedraw) {
            requestAnimationFrame(() => {
                if (state.redraw) state.redraw();
            });
        }

        if (this.renderQueue.size > 0) {
            // Use setTimeout to yield to the UI event loop between batches
            // This prevents frame-stacking that causes sustained freeze
            setTimeout(() => this.processQueue(state, drawLayerCallback), 0);
        } else {
            this.isProcessingQueue = false;
            // Cold start is over once all initial tiles are rendered
            if (this.isColdStart) this.isColdStart = false;
        }
    }

    _renderTile(key, params, state, drawLayerCallback) {
        const { col, row, scaleFactor, dpr } = params;

        // Размер текстуры: ограничиваем 4096px чтобы не превышать лимит GPU
        const textureSize = Math.min(4096, Math.ceil(TILE_SIZE * scaleFactor * dpr));

        const c = document.createElement('canvas');
        c.width = textureSize;
        c.height = textureSize;

        const tCtx = c.getContext('2d', { alpha: true });

        // realScale учитывает clamp: если текстура была ограничена 4096px,
        // масштаб уменьшается пропорционально, чтобы контент не вылезал за границы
        const realScale = textureSize / TILE_SIZE;
        tCtx.scale(realScale, realScale);
        tCtx.translate(-col * TILE_SIZE, -row * TILE_SIZE);

        tCtx.imageSmoothingEnabled = true;
        tCtx.imageSmoothingQuality = 'high';

        const tileRect = {
            x: col * TILE_SIZE,
            y: row * TILE_SIZE,
            width: TILE_SIZE,
            height: TILE_SIZE
        };

        let layersToRender;
        if (state.spatialGrid && state.spatialGrid.size > 0) {
            layersToRender = new Set();
            const startGridCol = Math.floor(tileRect.x / SPATIAL_CELL);
            const endGridCol = Math.floor((tileRect.x + tileRect.width) / SPATIAL_CELL);
            const startGridRow = Math.floor(tileRect.y / SPATIAL_CELL);
            const endGridRow = Math.floor((tileRect.y + tileRect.height) / SPATIAL_CELL);

            for (let r = startGridRow; r <= endGridRow; r++) {
                for (let cc = startGridCol; cc <= endGridCol; cc++) {
                    const cellKey = `${cc}_${r}`;
                    const cellLayers = state.spatialGrid.get(cellKey);
                    if (cellLayers) {
                        for (let i = 0; i < cellLayers.length; i++) {
                            layersToRender.add(cellLayers[i]);
                        }
                    }
                }
            }
        } else {
            layersToRender = state.layers;
        }

        layersToRender.forEach(layer => {
            if (state.layersToErase.has(layer)) {
                return;
            }

            let box = state.layerBBoxCache ? state.layerBBoxCache.get(layer.id) : null;
            if (!box) {
                box = getTransformedBoundingBox(layer);
                if (box && state.layerBBoxCache) state.layerBBoxCache.set(layer.id, box);
            }

            if (box && !doBoxesIntersect(box, tileRect)) {
                return;
            }

            drawLayerCallback(tCtx, layer, { zoom: 1 });
        });

        this.tiles.set(key, {
            canvas: c,
            ctx: tCtx,
            isDirty: false,
            zoom: scaleFactor,
            dpr: dpr
        });
    }

    drawVisibleTiles(ctx, state, drawLayerCallback) {
        const { panX, panY, zoom, canvas, isInteracting, isMultiTouching, isPanning, isDrawing } = state;
        const dpr = window.devicePixelRatio || 1;

        const isEraser = state.activeTool === 'eraser';
        const isActionActive = isMultiTouching || isPanning || (isDrawing && !isEraser) || isInteracting;

        const zoomDiff = Math.abs(zoom - this.cachedZoom);
        if (zoomDiff > this.cachedZoom * 0.2 && !isActionActive) {
            if (this.updateTimeout) clearTimeout(this.updateTimeout);
            this.updateTimeout = setTimeout(() => {
                this.cachedZoom = zoom;
                if (state.redraw) state.redraw();
                this.updateTimeout = null;
            }, 300);
        }

        const logicalCanvasWidth = canvas.width / dpr;
        const logicalCanvasHeight = canvas.height / dpr;

        const worldLeft = -panX / zoom;
        const worldTop = -panY / zoom;
        const worldRight = (logicalCanvasWidth - panX) / zoom;
        const worldBottom = (logicalCanvasHeight - panY) / zoom;

        const startCol = Math.floor(worldLeft / TILE_SIZE);
        const endCol = Math.floor(worldRight / TILE_SIZE);
        const startRow = Math.floor(worldTop / TILE_SIZE);
        const endRow = Math.floor(worldBottom / TILE_SIZE);

        const targetZoom = this.cachedZoom;

        // --- ШАГ 1: Собираем грязные тайлы в очередь ---
        for (let row = startRow; row <= endRow; row++) {
            for (let col = startCol; col <= endCol; col++) {
                const key = `${col}_${row}`;
                const tile = this.tiles.get(key);

                const needsUpdate = !tile || tile.isDirty || tile.zoom !== targetZoom || tile.dpr !== dpr;

                if (needsUpdate && !this.renderQueue.has(key)) {
                    if (!isActionActive) {
                        const renderingScale = Math.min(targetZoom, zoom);
                        this.renderQueue.set(key, {
                            col, row, scaleFactor: renderingScale, dpr
                        });
                    }
                }
            }
        }

        // --- ШАГ 2: Обрабатываем очередь СИНХРОННО, но БЕЗ вызова state.redraw() ---
        // skipRedraw=true предотвращает рекурсивный вход в redrawCanvas
        if (this.renderQueue.size > 0 && !isActionActive) {
            this.processQueue(state, drawLayerCallback, true);
        }

        // --- ШАГ 3: Рисуем ВСЕ тайлы (включая свежеотрендеренные) ---
        for (let row = startRow; row <= endRow; row++) {
            for (let col = startCol; col <= endCol; col++) {
                const key = `${col}_${row}`;
                const tile = this.tiles.get(key);

                if (tile) {
                    // Рисуем тайл даже если у него устаревший zoom/dpr — 
                    // тайл со старым масштабом лучше чем пустое место.
                    // Грязные (isDirty) тайлы с неактуальным содержимым слоёв — пропускаем.
                    ctx.drawImage(
                        tile.canvas,
                        col * TILE_SIZE,
                        row * TILE_SIZE,
                        TILE_SIZE,
                        TILE_SIZE
                    );
                }
            }
        }

        // Фоновая обработка оставшихся тайлов (если не успели за бюджет)
        if (this.renderQueue.size > 0 && !this.isProcessingQueue) {
            requestAnimationFrame(() => {
                if (this.renderQueue.size > 0 && !this.isProcessingQueue) {
                    this.processQueue(state, drawLayerCallback);
                }
            });
        }

        if (this.tiles.size > 150) {
            for (const [key, tile] of this.tiles) {
                const [c, r] = key.split('_').map(Number);
                if (c < startCol - 3 || c > endCol + 3 || r < startRow - 3 || r > endRow + 3) {
                    this.tiles.delete(key);
                }
            }
        }
    }
}
// --- END OF FILE js/tileManager.js ---