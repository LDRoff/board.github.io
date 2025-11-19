import { getTransformedBoundingBox, doBoxesIntersect } from './geometry.js';

// Размер одной плитки в ЛОГИЧЕСКИХ пикселях
const TILE_SIZE = 1024;

export class TileManager {
    constructor() {
        this.tiles = new Map();
        this.cachedZoom = 1;
        this.renderQueue = new Map();
        this.isProcessingQueue = false;
        this.updateTimeout = null;
        // Лимит времени на отрисовку плиток в одном кадре (мс)
        this.frameBudget = 10; 
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
                if (this.renderQueue.has(key)) {
                    this.renderQueue.delete(key);
                }
            }
        }
    }

    processQueue(state, drawLayerCallback) {
        // Отмена обработки, если идет взаимодействие, чтобы ресурсы не тратились на фон
        if (state.isInteracting) {
            this.isProcessingQueue = false;
            return;
        }

        if (this.renderQueue.size === 0) {
            this.isProcessingQueue = false;
            return;
        }

        this.isProcessingQueue = true;
        
        const startTime = performance.now();

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
            if (performance.now() - startTime > this.frameBudget) {
                break;
            }

            this.renderQueue.delete(key);
            processedCount++;

            const { col, row, scaleFactor, dpr } = params;
            
            const textureSize = Math.min(4096, TILE_SIZE * dpr * scaleFactor);
            const c = document.createElement('canvas');
            c.width = textureSize;
            c.height = textureSize;
            
            const tCtx = c.getContext('2d', { alpha: true });
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

            state.layers.forEach(layer => {
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

        if (processedCount > 0 && state.redraw) {
            state.redraw();
        }

        if (this.renderQueue.size > 0) {
            requestAnimationFrame(() => this.processQueue(state, drawLayerCallback));
        } else {
            this.isProcessingQueue = false;
        }
    }

    drawVisibleTiles(ctx, state, drawLayerCallback) {
        const { panX, panY, zoom, canvas, isInteracting, isMultiTouching, isPanning } = state;
        const dpr = window.devicePixelRatio || 1;
        const isZoomingOrPanning = isMultiTouching || isPanning;

        const zoomDiff = Math.abs(zoom - this.cachedZoom);
        if (zoomDiff > this.cachedZoom * 0.2 && !isZoomingOrPanning) {
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

        for (let row = startRow; row <= endRow; row++) {
            for (let col = startCol; col <= endCol; col++) {
                const key = `${col}_${row}`;
                let tile = this.tiles.get(key);
                
                const needsUpdate = !tile || tile.isDirty || tile.zoom !== targetZoom || tile.dpr !== dpr;

                if (needsUpdate && !this.renderQueue.has(key)) {
                    const renderingScale = Math.min(targetZoom, zoom);

                    this.renderQueue.set(key, {
                        col, row, scaleFactor: renderingScale, dpr
                    });
                    
                    if (!this.isProcessingQueue) {
                        this.processQueue(state, drawLayerCallback);
                    }
                }

                if (tile) {
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
        
        if (this.tiles.size > 100) {
             for (const [key, tile] of this.tiles) {
                 const [c, r] = key.split('_').map(Number);
                 if (c < startCol - 3 || c > endCol + 3 || r < startRow - 3 || r > endRow + 3) {
                     this.tiles.delete(key);
                 }
             }
        }
    }
}