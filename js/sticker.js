// --- START OF FILE js/sticker.js ---

import * as utils from './utils.js?v=1.2.3';
import * as hitTest from './hitTest.js?v=1.2.3';
import { drawLayer, drawSelectionBox } from './renderer.js?v=1.2.3';
import { positionElement } from './ui.js?v=1.2.3';

export class Sticker {
    constructor(stickerApp, canvasState, layer) {
        this.stickerApp = stickerApp;
        this.canvasState = canvasState;
        this.layer = layer;
        this.id = layer.id;
        
        // Logical canvas coordinates and dimensions
        this.w = layer.width || 220;
        this.h = layer.height || 160;
        this.x = layer.x;
        this.y = layer.y;
        this.color = layer.color || '#fef08a'; // yellow default
        this.type = layer.stickerType || 'text'; // 'text' or 'image'
        this.shape = layer.shape || 'rect'; // 'rect', 'circle', 'rhombus'
        this.content = layer.content || '';
        this.imageSrc = layer.imageSrc || null;
        
        this.scaleX = 1;
        this.scaleY = 1;
        this.velX = 0;
        this.velY = 0;
        
        this.isDragging = false;
        this.isSelected = false;
        this.isEditing = false;
        
        this.element = this.createDOM();

        this.resizeObserver = new ResizeObserver(entries => {
            for (let entry of entries) {
                const newW = entry.contentRect.width;
                const newH = entry.contentRect.height;
                if (newW === 0 || newH === 0) continue;
                this.w = newW;
                this.h = newH;
                
                // Update layers array info
                const stateLayer = this.canvasState.layers.find(l => String(l.id) === String(this.id));
                if (stateLayer) {
                    stateLayer.width = newW;
                    stateLayer.height = newH;
                }

                if (this.isSelected || this.stickerApp.selectedSticker === this) {
                    this.stickerApp.toolbarNeedsUpdate = true;
                }
            }
        });
        this.resizeObserver.observe(this.element);
    }

    createDOM() {
        const el = document.createElement('div');
        el.className = 'sticker-card';
        el.id = this.id;
        el.dataset.shape = this.shape;
        el.style.width = this.w + 'px';
        el.style.height = this.h + 'px';
        el.style.left = this.x + 'px';
        el.style.top = this.y + 'px';

        const bg = document.createElement('div');
        bg.className = 'sticker-bg';
        bg.style.backgroundColor = this.color;
        if (this.color === '#ffffff') {
            bg.style.border = '1px solid rgba(0,0,0,0.1)';
        }
        el.appendChild(bg);
        this.bgElement = bg;

        // Local Canvas for drawings on the sticker card
        const canvas = document.createElement('canvas');
        canvas.className = 'sticker-canvas';
        el.appendChild(canvas);
        this.canvasElement = canvas;
        this.ctx = canvas.getContext('2d');

        if (this.imageSrc) {
            el.classList.add('has-image');
        }

        // Resizer Handle
        const resizer = document.createElement('div');
        resizer.className = 'resize-handle';
        resizer.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v6h-6M21 21l-7-7M15 3H3v12M3 3l7 7"/></svg>`;
        resizer.addEventListener('mousedown', (e) => {
            e.stopPropagation();
            this.stickerApp.selectSticker(this);
            this.stickerApp.startResize(this, e);
        });
        resizer.addEventListener('touchstart', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.stickerApp.selectSticker(this);
            this.stickerApp.startResize(this, e.touches[0]);
        }, { passive: false });
        el.appendChild(resizer);

        // Circular Ports for connection lines
        ['top', 'right', 'bottom', 'left'].forEach(side => {
            const port = document.createElement('div');
            port.className = 'port';
            port.dataset.side = side;
            
            const onPortDown = (e, point) => {
                if (e.type === 'mousedown' && e.sourceCapabilities && e.sourceCapabilities.firesTouchEvents) {
                    return;
                }
                if (e.type === 'mousedown' && this.stickerApp.lastTouchTime && (Date.now() - this.stickerApp.lastTouchTime < 1000)) {
                    return;
                }
                e.stopPropagation();
                if (typeof e.preventDefault === 'function') e.preventDefault();

                // Check if a link already lands on this port and move it
                const existingLinkIdx = this.stickerApp.links.findIndex(l => l.to === this && l.toSide === side);
                if (existingLinkIdx > -1) {
                    const link = this.stickerApp.links[existingLinkIdx];
                    this.stickerApp.links.splice(existingLinkIdx, 1);
                    this.stickerApp.startConnection(link.from, link.fromSide, point, link.color, link.style);
                } else {
                    this.stickerApp.startConnection(this, side, point);
                }
            };

            port.addEventListener('mousedown', (e) => onPortDown(e, e));
            port.addEventListener('touchstart', (e) => {
                this.stickerApp.lastTouchTime = Date.now();
                e.preventDefault();
                e.stopPropagation();
                onPortDown(e, e.touches[0]);
            }, { passive: false });

            port.addEventListener('mouseup', (e) => {
                if (e.sourceCapabilities && e.sourceCapabilities.firesTouchEvents) {
                    return;
                }
                // Always handle connection finish on mouseup regardless of lastTouchTime
                e.stopPropagation();
                this.stickerApp.finishConnection(this, side);
            });
            port.addEventListener('touchend', (e) => {
                this.stickerApp.lastTouchTime = Date.now();
                e.preventDefault();
                // На тач touchend приходит на исходный порт, поэтому не завершаем
                // связь здесь: window.touchend определит конечный порт по координатам.
            }, { passive: false });

            port.addEventListener('mouseenter', () => port.classList.add('active'));
            port.addEventListener('mouseleave', () => port.classList.remove('active'));
            el.appendChild(port);
        });

        // Content Area (Rich text HTML editor)
        const content = document.createElement('div');
        content.className = 'sticker-content no-outline';
        content.contentEditable = false; 
        content.innerHTML = this.content; 
        
        const handleDblClick = (e) => {
            if (this.canvasState.activeTool === 'select' && !this.canvasState.editingAnnotationsLayerId) {
                content.contentEditable = true;
                this.isEditing = true;
                content.focus();
                
                const selection = window.getSelection();
                const range = document.createRange();
                range.selectNodeContents(content);
                selection.removeAllRanges();
                selection.addRange(range);
                
                this.stickerApp.updateToolbarPosition();
            }
        };

        el.addEventListener('dblclick', handleDblClick);
        
        // Custom tap hold or fast double tap on mobile
        let lastTap = 0;
        el.addEventListener('touchend', (e) => {
            const now = Date.now();
            if (now - lastTap < 300) {
                handleDblClick(e);
            }
            lastTap = now;
        });

        content.addEventListener('blur', () => {
            content.contentEditable = false;
            this.isEditing = false;
            window.getSelection().removeAllRanges();
            if(content.innerHTML === '<br>') content.innerHTML = '';
            this.content = content.innerHTML;
            
            // Update standard layer object content
            const stateLayer = this.canvasState.layers.find(l => String(l.id) === String(this.id));
            if (stateLayer) {
                stateLayer.content = this.content;
            }
            
            this.stickerApp.updateToolbarPosition();
            this.canvasState.saveState(this.canvasState.layers);
        });

        content.addEventListener('input', () => {
            if(content.innerHTML === '<br>') content.innerHTML = '';
            this.content = content.innerHTML;
            
            const stateLayer = this.canvasState.layers.find(l => String(l.id) === String(this.id));
            if (stateLayer) {
                stateLayer.content = this.content;
            }
            this.stickerApp.updateToolbarPosition();
        });
        el.appendChild(content);
        this.contentElement = content;
        
        // Image element
        const img = document.createElement('img');
        img.className = 'sticker-image';
        if (this.imageSrc) {
            img.src = this.imageSrc;
            img.style.display = 'block';
        }
        el.appendChild(img);
        this.imageElement = img;

        // Mouse Down logic for moving
        const onDown = (e) => {
            const point = (e.touches && e.touches[0]) ? e.touches[0] : e;
            const target = e.target || point.target;
            if (point.button !== undefined && point.button !== 0) return;
            if (this.canvasState.activeTool !== 'select' || this.canvasState.editingAnnotationsLayerId) return;
            if (target.classList.contains('port') || target.closest('.resize-handle') || target.tagName === 'INPUT') return;
            if (this.isEditing) {
                e.stopPropagation();
                return;
            }
            e.preventDefault(); // Prevent text selection/native drag
            this.stickerApp.selectSticker(this);
            this.stickerApp.startDrag(this, point);
        };

        el.addEventListener('mousedown', onDown);
        el.addEventListener('touchstart', (e) => {
            onDown(e);
        }, { passive: false });

        document.getElementById('stickers-layer').appendChild(el);
        return el;
    }

    setImage(imgSrc) {
        this.type = 'image';
        this.imageSrc = imgSrc;
        if (this.imageElement) {
            this.imageElement.src = imgSrc;
            this.imageElement.style.display = 'block';
        }
        if (this.element) {
            this.element.classList.add('has-image');
        }
        const stateLayer = this.canvasState.layers.find(l => String(l.id) === String(this.id));
        if (stateLayer) {
            stateLayer.stickerType = 'image';
            stateLayer.imageSrc = imgSrc;
        }
        this.canvasState.saveState(this.canvasState.layers);
    }

    removeImage() {
        this.type = 'text';
        this.imageSrc = null;
        if (this.imageElement) {
            this.imageElement.src = '';
            this.imageElement.style.display = 'none';
        }
        if (this.element) {
            this.element.classList.remove('has-image');
        }
        const stateLayer = this.canvasState.layers.find(l => String(l.id) === String(this.id));
        if (stateLayer) {
            stateLayer.stickerType = 'text';
            stateLayer.imageSrc = null;
        }
        this.canvasState.saveState(this.canvasState.layers);
    }

    triggerJelly(axis, intensity = 0.12) {
        if (axis === 'x') {
            this.velX -= intensity;
            this.velY += intensity * 0.8;
        } else {
            this.velY -= intensity;
            this.velX += intensity * 0.8;
        }
    }

    updatePhysics() {
        const spring = 0.2;
        const friction = 0.7;

        this.velX += (1 - this.scaleX) * spring;
        this.velY += (1 - this.scaleY) * spring;
        this.velX *= friction;
        this.velY *= friction;
        
        this.scaleX += this.velX;
        this.scaleY += this.velY;

        this.scaleX = Math.max(0.6, Math.min(1.4, this.scaleX));
        this.scaleY = Math.max(0.6, Math.min(1.4, this.scaleY));

        this.element.style.left = `${this.x}px`;
        this.element.style.top = `${this.y}px`;
        this.element.style.transform = `scale(${this.scaleX}, ${this.scaleY})`;
    }

    getPortCoords(side) {
        const cx = this.x + this.w / 2;
        const cy = this.y + this.h / 2;
        if(side === 'top') return { x: cx, y: this.y };
        if(side === 'bottom') return { x: cx, y: this.y + this.h };
        if(side === 'left') return { x: this.x, y: cy };
        if(side === 'right') return { x: this.x + this.w, y: cy };
        return { x: cx, y: cy };
    }

    setShape(shape) {
        if(this.shape === shape) return;
        this.shape = shape;
        this.element.dataset.shape = shape;
        
        if (shape === 'circle' || shape === 'rhombus') {
            const size = Math.max(this.w, this.h);
            this.w = size;
            this.h = size;
        }
        
        this.element.style.width = this.w + 'px';
        this.element.style.height = this.h + 'px';

        const stateLayer = this.canvasState.layers.find(l => String(l.id) === String(this.id));
        if (stateLayer) {
            stateLayer.shape = shape;
            stateLayer.width = this.w;
            stateLayer.height = this.h;
        }

        this.triggerJelly('x', 0.25);
        this.triggerJelly('y', -0.25);
        this.canvasState.saveState(this.canvasState.layers);
    }

    setColor(color) {
        this.color = color;
        this.bgElement.style.backgroundColor = color;
        if(color === '#ffffff') {
            this.bgElement.style.border = '1px solid rgba(0,0,0,0.1)';
        } else {
            this.bgElement.style.border = '1px solid rgba(0,0,0,0.08)';
        }
        const stateLayer = this.canvasState.layers.find(l => String(l.id) === String(this.id));
        if (stateLayer) {
            stateLayer.color = color;
        }
        this.canvasState.saveState(this.canvasState.layers);
    }

    renderDrawing() {
        if (!this.canvasElement || !this.ctx) return;
        
        const children = this.canvasState.layers.filter(l => l.parentId === this.id && (!this.canvasState.layersToErase || !this.canvasState.layersToErase.has(l)));
        const tempLayer = this.canvasState.tempLayer;
        if (tempLayer && tempLayer.parentId === this.id) {
            children.push(tempLayer);
        }
        
        const hasChildren = children.length > 0;
        if (hasChildren) {
            this.element.classList.add('has-drawing');
        } else {
            this.element.classList.remove('has-drawing');
        }

        const dpr = window.devicePixelRatio || 1;
        const zoom = this.canvasState.zoom || 1;
        const displayW = this.w;
        const displayH = this.h;
        
        const targetW = Math.floor(displayW * dpr * zoom);
        const targetH = Math.floor(displayH * dpr * zoom);
        
        if (this.canvasElement.width !== targetW || 
            this.canvasElement.height !== targetH) {
            this.canvasElement.width = targetW;
            this.canvasElement.height = targetH;
            this.canvasElement.style.width = displayW + 'px';
            this.canvasElement.style.height = displayH + 'px';
        }
        
        this.ctx.clearRect(0, 0, this.canvasElement.width, this.canvasElement.height);
        
        if (!hasChildren) return;
        
        this.ctx.save();
        this.ctx.scale(dpr * zoom, dpr * zoom);
        this.ctx.translate(-this.x, -this.y);
        
        children.forEach(child => {
            drawLayer(this.ctx, child, { ...this.canvasState, zoom: 1, isLocalRender: true });
        });
        
        if (this.canvasState.editingAnnotationsLayerId === this.id) {
            const selectedChildren = this.canvasState.selectedLayers.filter(l => l.parentId === this.id);
            if (selectedChildren.length > 0) {
                drawSelectionBox(this.ctx, selectedChildren, this.canvasState);
            }

            // Draw the selection marquee box if active!
            if (this.canvasState.currentAction === 'selectionBox' && this.canvasState.selectionBox && this.canvasState.startPos) {
                this.ctx.save();
                this.ctx.strokeStyle = 'rgba(0, 122, 255, 0.8)';
                this.ctx.fillStyle = 'rgba(0, 122, 255, 0.1)';
                this.ctx.lineWidth = 1 / zoom;
                this.ctx.beginPath();
                this.ctx.rect(
                    this.canvasState.startPos.x, 
                    this.canvasState.startPos.y, 
                    this.canvasState.selectionBox.width, 
                    this.canvasState.selectionBox.height
                );
                this.ctx.fill();
                this.ctx.stroke();
                this.ctx.restore();
            }
        }
        
        this.ctx.restore();
    }

    remove() {
        this.resizeObserver.disconnect();
        this.element.remove();
    }
}

export class StickerApp {
    constructor(canvasState) {
        this.canvasState = canvasState;
        this.stickers = [];
        this.links = [];
        this.selectedSticker = null;
        this.selectedLinkIndex = null;
        
        this.dragState = null;
        this.resizeState = null;
        this.connectionState = null;
        this.hoveredLinkForInsert = null;
        this.toolbarNeedsUpdate = false;
        
        this.lastTouchTime = 0;
        
        this.stickersLayer = document.getElementById('stickers-layer');
        this.connectionsLayer = document.getElementById('connectionsLayer');
        this.toolbar = document.getElementById('floatingStickerToolbar');
        this.linkToolbar = document.getElementById('floatingLinkToolbar');

        this.initEvents();
        this.startPhysicsLoop();
    }

    addSticker(stickerType = 'text', x = null, y = null, imgSrc = null, id = null, save = true) {
        const palette = ['#ffffff', '#fef08a', '#a7f3d0', '#bfdbfe', '#fbcfe8'];
        const usedColors = this.stickers.map(s => s.color);
        const availableColors = palette.filter(c => !usedColors.includes(c));
        
        let color;
        if (availableColors.length > 0) {
            color = availableColors[Math.floor(Math.random() * availableColors.length)];
        } else {
            color = palette[Math.floor(Math.random() * palette.length)];
        }

        // Place in canvas coordinates
        if (x === null || y === null) {
            const dpr = window.devicePixelRatio || 1;
            x = ((this.canvasState.canvas.width / dpr) / 2 - this.canvasState.panX) / this.canvasState.zoom;
            y = ((this.canvasState.canvas.height / dpr) / 2 - this.canvasState.panY) / this.canvasState.zoom;
        }
        
        const stickerId = id || 'sticker_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
        
        // Check if layer already exists in layers (for imports/loads)
        let layerObj = this.canvasState.layers.find(l => String(l.id) === String(stickerId));
        if (!layerObj) {
            layerObj = {
                id: stickerId,
                type: 'sticker',
                stickerType: stickerType,
                x: x - 110, // Center the sticker (width = 220, height = 160)
                y: y - 80,
                width: 220,
                height: 160,
                color: color,
                shape: 'rect',
                content: '',
                imageSrc: imgSrc,
                hasDrawing: false,
                drawingData: null
            };
            this.canvasState.layers.push(layerObj);
        }

        const sticker = new Sticker(this, this.canvasState, layerObj);
        this.stickers.push(sticker);
        
        sticker.scaleX = 0.5;
        sticker.scaleY = 0.5;
        
        this.selectSticker(sticker);
        
        if (save) {
            this.canvasState.saveState(this.canvasState.layers);
        }
        
        return sticker;
    }

    handleImageUpload(event) {
        const file = event.target.files[0];
        if (file && this.selectedSticker) {
            const reader = new FileReader();
            reader.onload = (e) => {
                this.selectedSticker.setImage(e.target.result);
            };
            reader.readAsDataURL(file);
        }
        event.target.value = '';
    }

    selectLink(index) {
        this.selectedLinkIndex = index;
        if (index !== null) {
            if (this.selectedSticker) {
                this.selectedSticker.isSelected = false;
                this.selectedSticker.element.classList.remove('selected');
                this.selectedSticker = null;
            }
            this.updateToolbarPosition();
        } else if (!this.selectedSticker) {
            this.toolbar.classList.remove('visible');
            this.toolbar.style.display = 'none';
            if (this.linkToolbar) {
                this.linkToolbar.classList.remove('visible');
                this.linkToolbar.style.display = 'none';
            }
        }
    }

    selectSticker(sticker) {
        if (sticker === null) {
            if (this.selectedSticker) {
                this.selectedSticker.isSelected = false;
                this.selectedSticker.element.classList.remove('selected');
                const activeEl = document.activeElement;
                if (activeEl && activeEl.classList.contains('sticker-content')) activeEl.blur();
            }
            this.selectedSticker = null;
            this.canvasState.editingAnnotationsLayerId = null;
            this.toolbarNeedsUpdate = false;
            this.toolbar.classList.remove('visible');
            this.toolbar.style.display = 'none';
            if (this.selectedLinkIndex === null && this.linkToolbar) {
                this.linkToolbar.classList.remove('visible');
                this.linkToolbar.style.display = 'none';
            }
            this.canvasState.selectedLayers = (this.canvasState.selectedLayers || []).filter(l => l && l.type !== 'sticker');
            this.stickers.forEach(s => s.element.classList.remove('editing-annotations'));
            if (this.canvasState.redraw) {
                this.canvasState.redraw();
            }
            if (this.canvasState.updateFloatingToolbar) {
                this.canvasState.updateFloatingToolbar();
            }
            return;
        }

        if (this.selectedSticker === sticker) {
            this.toolbarNeedsUpdate = true;
            this.updateToolbarPosition();
            return;
        }

        if (this.selectedSticker) {
            this.selectedSticker.isSelected = false;
            this.selectedSticker.element.classList.remove('selected');
            const activeEl = document.activeElement;
            if (activeEl && activeEl.classList.contains('sticker-content')) activeEl.blur();
        }
        
        this.selectedSticker = sticker;
        this.toolbarNeedsUpdate = true;
        
        if (sticker) {
            this.canvasState.editingAnnotationsLayerId = null;
            this.stickers.forEach(s => s.element.classList.remove('editing-annotations'));
            
            this.selectedLinkIndex = null;
            sticker.isSelected = true;
            sticker.element.classList.add('selected');
            
            // Move DOM to front
            const index = this.stickers.indexOf(sticker);
            this.stickers.splice(index, 1);
            this.stickers.push(sticker);
            this.stickersLayer.appendChild(sticker.element);

            // Порядок в canvasState.layers не трогаем: стикеры рисуются в DOM,
            // а скрытая перестановка массива рассинхронизировала историю.

            if (!sticker.layer) {
                sticker.layer = this.canvasState.layers.find(l => String(l.id) === String(sticker.id));
            }
            this.canvasState.selectedLayers = [sticker.layer];
            this.canvasState.selectedCurveNodeIndex = null;
            
            this.updateToolbarPosition();
            if (this.canvasState.updateFloatingToolbar) {
                this.canvasState.updateFloatingToolbar();
            }
        }
    }

    handleImageBtnClick(e) {
        if (this.selectedSticker) {
            if (this.selectedSticker.imageSrc) {
                e.preventDefault();
                e.stopPropagation();
                this.selectedSticker.removeImage();
                this.updateToolbarPosition();
            } else {
                const fileInput = document.getElementById('stickerFileInput');
                if (fileInput) {
                    fileInput.click();
                }
            }
        }
    }

    updateToolbarPosition() {
        const isDragging = this.dragState && this.dragState.hasMoved;
        if (isDragging) {
            this.toolbar.classList.remove('visible');
            this.toolbar.style.display = 'none';
            if (this.linkToolbar) {
                this.linkToolbar.classList.remove('visible');
                this.linkToolbar.style.display = 'none';
            }
            return;
        }

        let targetSticker = this.selectedSticker;
        if (!targetSticker && this.canvasState.editingAnnotationsLayerId) {
            targetSticker = this.stickers.find(s => String(s.id) === String(this.canvasState.editingAnnotationsLayerId));
        }

        if (targetSticker) {
            this.toolbar.classList.add('visible');
            this.toolbar.style.display = 'flex';
            if (this.linkToolbar) {
                this.linkToolbar.classList.remove('visible');
                this.linkToolbar.style.display = 'none';
            }
            
            const s = targetSticker;
            const rect = s.element.getBoundingClientRect();
            
            positionElement(this.toolbar, rect);

            if (this.toolbar.offsetWidth === 0 || this.toolbar.offsetHeight === 0) {
                this.toolbarNeedsUpdate = true;
            }

            // Highlight the image button in red if an image is loaded, and adjust tooltips
            const imgIcon = document.getElementById('stickerImageIcon');
            const imgBtn = document.getElementById('stickerImageBtn');
            if (imgIcon && imgBtn) {
                if (s.imageSrc) {
                    imgIcon.style.filter = 'hue-rotate(320deg) saturate(3)'; // Red highlights
                    imgBtn.title = 'Удалить фото';
                } else {
                    imgIcon.style.filter = 'none';
                    imgBtn.title = 'Добавить фото';
                }
            }

            const editBtn = document.getElementById('stickerEditBtn');
            if (editBtn) {
                const editIcon = editBtn.querySelector('svg');
                if (editIcon) {
                    if (this.canvasState.editingAnnotationsLayerId === s.id) {
                        editIcon.style.color = '#3b82f6'; // active blue highlight
                        editBtn.title = 'Выйти из редактирования';
                    } else {
                        editIcon.style.color = 'var(--text-secondary)';
                        editBtn.title = 'Редактировать нарисованное';
                    }
                }
            }

            // Update active color circle on dropdown trigger
            const stickerColorCircle = document.getElementById('stickerColorDropdownCircle');
            if (stickerColorCircle) {
                stickerColorCircle.style.fill = s.color;
                if (s.color.toLowerCase() === '#ffffff') {
                    stickerColorCircle.style.stroke = 'rgba(0, 0, 0, 0.2)';
                } else {
                    stickerColorCircle.style.stroke = '#888';
                }
            }

            // Update color dots active state inside sticker options
            const stickerColorDots = this.toolbar.querySelectorAll('.color-dot');
            stickerColorDots.forEach(dot => {
                const dotColor = dot.getAttribute('data-color');
                if (dotColor && dotColor.toLowerCase() === s.color.toLowerCase()) {
                    dot.classList.add('active');
                } else {
                    dot.classList.remove('active');
                }
            });
        } else if (this.selectedLinkIndex !== null && this.links[this.selectedLinkIndex]) {
            this.toolbar.classList.remove('visible');
            this.toolbar.style.display = 'none';
            if (this.linkToolbar) {
                this.linkToolbar.classList.add('visible');
                this.linkToolbar.style.display = 'flex';
            }
            
            const link = this.links[this.selectedLinkIndex];
            const p1 = link.from.getPortCoords(link.fromSide);
            const p2 = link.to.getPortCoords(link.toSide);
            
            const zoom = this.canvasState.zoom;
            const panX = this.canvasState.panX;
            const panY = this.canvasState.panY;
            
            const midX = (((p1.x + p2.x) / 2) * zoom) + panX;
            const midY = (((p1.y + p2.y) / 2) * zoom) + panY;
            
            if (this.linkToolbar) {
                const anchorRect = {
                    left: midX,
                    top: midY,
                    width: 0,
                    height: 0,
                    right: midX,
                    bottom: midY
                };
                positionElement(this.linkToolbar, anchorRect);
            }

            // Update active color circle on dropdown trigger for links
            const linkColorCircle = document.getElementById('linkColorDropdownCircle');
            if (linkColorCircle) {
                linkColorCircle.style.fill = link.color;
                if (link.color.toLowerCase() === '#ffffff') {
                    linkColorCircle.style.stroke = 'rgba(0, 0, 0, 0.2)';
                } else {
                    linkColorCircle.style.stroke = '#888';
                }
            }

            // Update link color dots active state inside link options
            if (this.linkToolbar) {
                const linkColorDots = this.linkToolbar.querySelectorAll('.color-dot');
                linkColorDots.forEach(dot => {
                    const dotColor = dot.getAttribute('data-color');
                    if (dotColor && dotColor.toLowerCase() === link.color.toLowerCase()) {
                        dot.classList.add('active');
                    } else {
                        dot.classList.remove('active');
                    }
                });
            }
        } else {
            this.toolbar.classList.remove('visible');
            this.toolbar.style.display = 'none';
            if (this.linkToolbar) {
                this.linkToolbar.classList.remove('visible');
                this.linkToolbar.style.display = 'none';
            }
        }
    }

    changeStickerColor(color) {
        let s = this.selectedSticker;
        if (!s && this.canvasState.editingAnnotationsLayerId) {
            s = this.stickers.find(st => String(st.id) === String(this.canvasState.editingAnnotationsLayerId));
        }
        if (s) {
            s.setColor(color);
            this.updateToolbarPosition();
        }
    }

    changeStickerShape(shape) {
        let s = this.selectedSticker;
        if (!s && this.canvasState.editingAnnotationsLayerId) {
            s = this.stickers.find(st => String(st.id) === String(this.canvasState.editingAnnotationsLayerId));
        }
        if (s) {
            s.setShape(shape);
            this.updateToolbarPosition();
        }
    }

    toggleStickerAnnotationsEditing(event) {
        if (event) {
            event.stopPropagation();
            event.preventDefault();
        }
        
        let targetSticker = this.selectedSticker;
        if (!targetSticker && this.canvasState.editingAnnotationsLayerId) {
            targetSticker = this.stickers.find(s => String(s.id) === String(this.canvasState.editingAnnotationsLayerId));
        }
        
        if (!targetSticker) return;
        
        const stateLayer = this.canvasState.layers.find(l => String(l.id) === String(targetSticker.id));
        if (!stateLayer) return;
        
        if (this.canvasState.editingAnnotationsLayerId === stateLayer.id) {
            this.canvasState.editingAnnotationsLayerId = null;
            targetSticker.element.classList.remove('editing-annotations');
            this.selectSticker(targetSticker); // re-select sticker
        } else {
            this.selectSticker(null); // deselect sticker (clears editingAnnotationsLayerId and removes classes)
            this.canvasState.editingAnnotationsLayerId = stateLayer.id;
            targetSticker.element.classList.add('editing-annotations');
        }
        
        this.updateToolbarPosition();
        if (this.canvasState.updateFloatingToolbar) {
            this.canvasState.updateFloatingToolbar();
        }
        if (this.canvasState.redraw) {
            this.canvasState.redraw();
        }
    }

    changeLinkColor(color) {
        if(this.selectedLinkIndex !== null && this.links[this.selectedLinkIndex]) {
            this.links[this.selectedLinkIndex].color = color;
            this.saveLinksState();
            if (this.canvasState.redraw) {
                this.canvasState.redraw();
            }
            this.updateToolbarPosition();
        }
    }

    changeLinkStyle(style) {
        if(this.selectedLinkIndex !== null && this.links[this.selectedLinkIndex]) {
            this.links[this.selectedLinkIndex].style = style;
            this.saveLinksState();
            if (this.canvasState.redraw) {
                this.canvasState.redraw();
            }
        }
    }

    deleteSelectedLink() {
        if (this.selectedLinkIndex !== null) {
            this.links.splice(this.selectedLinkIndex, 1);
            this.saveLinksState();
            this.selectLink(null);
        }
    }

    deleteSelectedSticker() {
        let s = this.selectedSticker;
        if (!s && this.canvasState.editingAnnotationsLayerId) {
            s = this.stickers.find(st => String(st.id) === String(this.canvasState.editingAnnotationsLayerId));
        }
        if (!s) return;
        
        if (String(this.canvasState.editingAnnotationsLayerId) === String(s.id)) {
            this.canvasState.editingAnnotationsLayerId = null;
        }

        // Remove DOM element
        s.remove();
        
        // Remove from memory stickers array
        this.stickers = this.stickers.filter(st => st !== s);
        
        // Remove from layers list
        const stateLayerIdx = this.canvasState.layers.findIndex(l => String(l.id) === String(s.id));
        if (stateLayerIdx > -1) {
            this.canvasState.layers.splice(stateLayerIdx, 1);
        }
        
        // Remove child layers
        this.canvasState.layers = this.canvasState.layers.filter(l => String(l.parentId) !== String(s.id));
        
        // Filter out connected links
        this.links = this.links.filter(l => l.from !== s && l.to !== s);
        
        // Deselect
        this.selectSticker(null);
        
        // Sync structures
        this.syncStickersAndLinks(this.canvasState.layers);
        
        // Save both layers and links state at once
        this.saveLinksState();
        
        if (this.canvasState.redraw) {
            this.canvasState.redraw();
        }
    }

    initEvents() {
        // Upgrade inline button handlers to clean event listeners that stop propagation
        if (this.toolbar) {
            // Upgrade changeStickerShape buttons
            this.toolbar.querySelectorAll('button[onclick*="changeStickerShape"]').forEach(btn => {
                const attr = btn.getAttribute('onclick');
                const match = attr ? attr.match(/'([^']+)'/) : null;
                if (match) {
                    const shape = match[1];
                    btn.removeAttribute('onclick');
                    btn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        this.changeStickerShape(shape);
                    });
                }
            });

            // Upgrade changeStickerColor buttons
            this.toolbar.querySelectorAll('button[onclick*="changeStickerColor"]').forEach(btn => {
                const attr = btn.getAttribute('onclick');
                const match = attr ? attr.match(/'([^']+)'/) : null;
                if (match) {
                    const color = match[1];
                    btn.removeAttribute('onclick');
                    btn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        this.changeStickerColor(color);
                    });
                }
            });

            // Upgrade image button
            const imgBtn = this.toolbar.querySelector('#stickerImageBtn') || this.toolbar.querySelector('button[onclick*="handleImageBtnClick"]');
            if (imgBtn) {
                imgBtn.removeAttribute('onclick');
                imgBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.handleImageBtnClick(e);
                });
            }

            // Upgrade file input change handler
            const fileInput = this.toolbar.querySelector('#stickerFileInput') || this.toolbar.querySelector('input[onchange*="handleImageUpload"]');
            if (fileInput) {
                fileInput.removeAttribute('onchange');
                fileInput.addEventListener('change', (e) => {
                    this.handleImageUpload(e);
                });
            }

            // Upgrade edit annotations button
            const editAnnotationsBtn = this.toolbar.querySelector('#stickerEditBtn') || this.toolbar.querySelector('button[onclick*="toggleStickerAnnotationsEditing"]');
            if (editAnnotationsBtn) {
                editAnnotationsBtn.removeAttribute('onclick');
                editAnnotationsBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.toggleStickerAnnotationsEditing(e);
                });
            }

            // Upgrade delete sticker button
            const deleteStickerBtn = this.toolbar.querySelector('button[onclick*="deleteSelectedSticker"]') || this.toolbar.querySelector('button[data-action="delete"]');
            if (deleteStickerBtn) {
                deleteStickerBtn.removeAttribute('onclick');
                deleteStickerBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.deleteSelectedSticker();
                });
            }
        }

        if (this.linkToolbar) {
            // Upgrade changeLinkStyle buttons
            this.linkToolbar.querySelectorAll('button[onclick*="changeLinkStyle"]').forEach(btn => {
                const attr = btn.getAttribute('onclick');
                const match = attr ? attr.match(/'([^']+)'/) : null;
                if (match) {
                    const style = match[1];
                    btn.removeAttribute('onclick');
                    btn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        this.changeLinkStyle(style);
                    });
                }
            });

            // Upgrade changeLinkColor buttons
            this.linkToolbar.querySelectorAll('button[onclick*="changeLinkColor"]').forEach(btn => {
                const attr = btn.getAttribute('onclick');
                const match = attr ? attr.match(/'([^']+)'/) : null;
                if (match) {
                    const color = match[1];
                    btn.removeAttribute('onclick');
                    btn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        this.changeLinkColor(color);
                    });
                }
            });

            // Upgrade delete link button
            const deleteLinkBtn = this.linkToolbar.querySelector('button[onclick*="deleteSelectedLink"]') || this.linkToolbar.querySelector('button[data-action="delete"]');
            if (deleteLinkBtn) {
                deleteLinkBtn.removeAttribute('onclick');
                deleteLinkBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.deleteSelectedLink();
                });
            }
        }

        // Clicking on canvas deselects sticker/link
        this.canvasState.canvas.addEventListener('mousedown', (e) => {
            if (e.target.id === 'drawingBoard') {
                if (this.canvasState.editingAnnotationsLayerId) {
                    return; // Do NOT deselect if drawing edit mode is active!
                }
                this.selectSticker(null);
                this.selectLink(null);
            }
        });
        this.canvasState.canvas.addEventListener('touchstart', (e) => {
            if (e.target.id === 'drawingBoard') {
                if (this.canvasState.editingAnnotationsLayerId) {
                    return; // Do NOT deselect if drawing edit mode is active!
                }
                this.selectSticker(null);
                this.selectLink(null);
            }
        }, { passive: true });

        this.connectionsLayer.addEventListener('mousedown', (e) => {
            const index = e.target.getAttribute('data-index');
            if (index !== null) {
                this.selectLink(parseInt(index));
            } else {
                this.selectLink(null);
            }
        });
        this.connectionsLayer.addEventListener('touchstart', (e) => {
            const index = e.target.getAttribute('data-index');
            if (index !== null) {
                this.selectLink(parseInt(index));
            } else {
                this.selectLink(null);
            }
        }, { passive: true });

        // Handle window keydown for delete/backspace keys
        window.addEventListener('keydown', (e) => {
            if (e.target.isContentEditable || e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || this.canvasState.isEditingText) return;

            if (e.key === 'Delete' || e.key === 'Backspace') {
                if (this.selectedSticker) {
                    this.deleteSelectedSticker();
                } else if (this.selectedLinkIndex !== null) {
                    this.deleteSelectedLink();
                }
            }
        });

        // Dropdown toggling inside floatingStickerToolbar & floatingLinkToolbar
        const handleDropdownClick = (toolbarEl, e) => {
            const btn = e.target.closest('.dropdown-trigger-btn');
            if (btn) {
                e.stopPropagation();
                const container = btn.closest('.dropdown-container');
                if (container) {
                    const wasActive = container.classList.contains('active');
                    toolbarEl.querySelectorAll('.dropdown-container').forEach(d => d.classList.remove('active'));
                    if (!wasActive) {
                        container.classList.add('active');
                    }
                }
            } else {
                const optionBtn = e.target.closest('.dropdown-options button');
                if (optionBtn) {
                    toolbarEl.querySelectorAll('.dropdown-container').forEach(d => d.classList.remove('active'));
                }
            }
        };

        this.toolbar.addEventListener('click', (e) => handleDropdownClick(this.toolbar, e));
        if (this.linkToolbar) {
            this.linkToolbar.addEventListener('click', (e) => handleDropdownClick(this.linkToolbar, e));
        }

        // Close dropdowns when clicking outside
        document.addEventListener('click', (e) => {
            if (!this.toolbar.contains(e.target)) {
                this.toolbar.querySelectorAll('.dropdown-container').forEach(d => d.classList.remove('active'));
            }
            if (this.linkToolbar && !this.linkToolbar.contains(e.target)) {
                this.linkToolbar.querySelectorAll('.dropdown-container').forEach(d => d.classList.remove('active'));
            }
        });

        // Mouse listeners on window to handle active moves/drags/resizes
        window.addEventListener('mousemove', (e) => this.onMouseMove(e));
        window.addEventListener('touchmove', (e) => this.onMouseMove(e.touches[0]), { passive: true });

        window.addEventListener('mouseup', (e) => this.onMouseUp(e));
        window.addEventListener('touchstart', () => {
            this.lastTouchTime = Date.now();
        }, { passive: true });
        window.addEventListener('touchend', (e) => {
            this.lastTouchTime = Date.now();
            if (this.dragState || this.resizeState || this.connectionState) {
                e.preventDefault();
            }
            this.onMouseUp(e);
        }, { passive: false });

        // Safety net: clear connectionState if window loses focus (tab switch, alt-tab, etc.)
        window.addEventListener('blur', () => {
            if (this.connectionState) {
                this.connectionState = null;
                this.setConnectingState(false);
                this.updateToolbarPosition();
            }
        });

        // Safety net: clear connectionState on any mousedown that's NOT on a port
        // This handles the case where events are swallowed and mouseup never arrives
        document.addEventListener('mousedown', (e) => {
            if (this.connectionState && !e.target.classList.contains('port')) {
                this.connectionState = null;
                this.setConnectingState(false);
                this.updateToolbarPosition();
            }
        }, true); // capture phase so it fires before stopPropagation
    }


    startDrag(sticker, e) {
        sticker.isDragging = true;
        sticker.element.classList.add('dragging');
        this.dragState = {
            sticker: sticker,
            offsetX: e.clientX - (sticker.x * this.canvasState.zoom),
            offsetY: e.clientY - (sticker.y * this.canvasState.zoom),
            hasMoved: false
        };
        // Don't call updateToolbarPosition() here — the toolbar was just shown by selectSticker.
        // It will be hidden on first actual mouse movement in onMouseMove.
    }

    startResize(sticker, e) {
        const children = this.canvasState.layers.filter(child => child.parentId === sticker.id);
        this.resizeState = {
            sticker: sticker,
            startX: e.clientX,
            startY: e.clientY,
            startW: sticker.w,
            startH: sticker.h,
            children: children,
            originalChildren: utils.cloneLayersForAction(children)
        };
        this.updateToolbarPosition();
    }

    setConnectingState(on) {
        const layer = document.getElementById('stickers-layer');
        if (layer) layer.classList.toggle('connecting', !!on);
    }

    startConnection(sticker, side, e, color = '#a855f7', style = 'solid') {
        this.setConnectingState(true);
        this.connectionState = {
            from: sticker,
            fromSide: side,
            mouseX: (e.clientX - this.canvasState.panX) / this.canvasState.zoom,
            mouseY: (e.clientY - this.canvasState.panY) / this.canvasState.zoom,
            color: color,
            style: style
        };
        this.updateToolbarPosition();
    }

    finishConnection(sticker, side) {
        try {
            if (this.connectionState && this.connectionState.from !== sticker) {
                const exists = this.links.some(l => 
                    (l.from === this.connectionState.from && l.to === sticker) ||
                    (l.from === sticker && l.to === this.connectionState.from)
                );
                
                if (!exists) {
                    this.links.push({
                        from: this.connectionState.from,
                        fromSide: this.connectionState.fromSide,
                        to: sticker,
                        toSide: side,
                        color: this.connectionState.color || '#a855f7',
                        style: this.connectionState.style || 'solid'
                    });
                    sticker.triggerJelly('x', 0.15);
                    this.connectionState.from.triggerJelly('x', 0.15);
                    this.saveLinksState();
                }
            }
        } finally {
            // ALWAYS clear connectionState, even if an error occurred above
            this.connectionState = null;
            this.setConnectingState(false);
            this.renderLinks(); // immediately update SVG to remove ghost arrow
            this.updateToolbarPosition();
        }
    }

    onMouseMove(e) {
        if (this.dragState) {
            const s = this.dragState.sticker;
            const newX = (e.clientX - this.dragState.offsetX) / this.canvasState.zoom;
            const newY = (e.clientY - this.dragState.offsetY) / this.canvasState.zoom;
            
            const dx = newX - s.x;
            const dy = newY - s.y;
            
            // Hide toolbar on first actual movement (threshold: any movement)
            if (!this.dragState.hasMoved && (Math.abs(dx) > 1 || Math.abs(dy) > 1)) {
                this.dragState.hasMoved = true;
                this.toolbar.classList.remove('visible');
                this.toolbar.style.display = 'none';
                if (this.linkToolbar) {
                    this.linkToolbar.classList.remove('visible');
                    this.linkToolbar.style.display = 'none';
                }
            }
            
            s.x = newX;
            s.y = newY;

            // Sync with layers list
            const stateLayer = this.canvasState.layers.find(l => String(l.id) === String(s.id));
            if (stateLayer) {
                stateLayer.x = newX;
                stateLayer.y = newY;
            }

            // Move child annotations
            if (dx !== 0 || dy !== 0) {
                const children = this.canvasState.layers.filter(child => child.parentId === s.id);
                children.forEach(child => {
                    utils.translateLayer(child, dx, dy);
                    if (this.canvasState.tileManager) {
                        this.canvasState.tileManager.invalidateLayer(child, this.canvasState);
                    }
                });
                if (children.length > 0) {
                    this.canvasState.redraw();
                }
            }

            this.hoveredLinkForInsert = null;
            const cx = s.x + s.w / 2;
            const cy = s.y + s.h / 2;

            for (let i = 0; i < this.links.length; i++) {
                const link = this.links[i];
                if (link.from === s || link.to === s) continue;

                const p1 = link.from.getPortCoords(link.fromSide);
                const p2 = link.to.getPortCoords(link.toSide);
                const d1 = this.getDirVector(link.fromSide);
                const d2 = this.getDirVector(link.toSide);
                const distCurve = Math.max(Math.abs(p2.x - p1.x), Math.abs(p2.y - p1.y)) * 0.5 + 40;
                
                const cx1 = p1.x + d1.x * distCurve;
                const cy1 = p1.y + d1.y * distCurve;
                const cx2 = p2.x + d2.x * distCurve;
                const cy2 = p2.y + d2.y * distCurve;

                const distToCurve = this.getDistanceToBezier(cx, cy, p1.x, p1.y, cx1, cy1, cx2, cy2, p2.x, p2.y);
                
                if (distToCurve < 35) {
                    this.hoveredLinkForInsert = link;
                    break;
                }
            }
        }
        
        if (this.resizeState) {
            const s = this.resizeState.sticker;
            const dx = (e.clientX - this.resizeState.startX) / this.canvasState.zoom;
            const dy = (e.clientY - this.resizeState.startY) / this.canvasState.zoom;
            
            const startW = this.resizeState.startW;
            const startH = this.resizeState.startH;
            
            if (s.shape === 'circle' || s.shape === 'rhombus') {
                const size = Math.max(120, Math.max(startW + dx, startH + dy));
                s.w = size;
                s.h = size;
            } else {
                s.w = Math.max(120, startW + dx);
                s.h = Math.max(80, startH + dy);
            }
            
            s.element.style.width = s.w + 'px';
            s.element.style.height = s.h + 'px';
            
            const stateLayer = this.canvasState.layers.find(l => String(l.id) === String(s.id));
            if (stateLayer) {
                stateLayer.width = s.w;
                stateLayer.height = s.h;
            }

            // Scale child annotations
            const scaleX = startW > 0 ? s.w / startW : 1;
            const scaleY = startH > 0 ? s.h / startH : 1;
            
            if (this.resizeState.children && this.resizeState.children.length > 0) {
                const oBox = { x: s.x, y: s.y, width: startW, height: startH };
                this.resizeState.children.forEach((child, index) => {
                    const originalChild = this.resizeState.originalChildren[index];
                    if (!originalChild) return;
                    
                    const originalRx = originalChild.rx ?? originalChild.r;
                    const originalRy = originalChild.ry ?? originalChild.r;
                    const newChildProps = {
                        x: oBox.x + (originalChild.x - oBox.x) * scaleX,
                        y: oBox.y + (originalChild.y - oBox.y) * scaleY,
                        width: originalChild.width * scaleX,
                        height: originalChild.height * scaleY,
                        cx: oBox.x + (originalChild.cx - oBox.x) * scaleX,
                        cy: oBox.y + (originalChild.cy - oBox.y) * scaleY,
                        rx: originalRx * scaleX,
                        ry: originalRy * scaleY,
                    };
                    
                    if (child.type === 'text') {
                        child.x = newChildProps.x;
                        child.y = newChildProps.y;
                        const avgScale = (scaleX + scaleY) / 2;
                        child.fontSize = originalChild.fontSize * avgScale;
                        child.width = newChildProps.width;
                        child.height = newChildProps.height;
                        if (originalChild.content) {
                            const tempDiv = document.createElement('div');
                            tempDiv.innerHTML = originalChild.content;
                            const elementsWithFont = tempDiv.querySelectorAll('*');
                            elementsWithFont.forEach(el => {
                                if (el.style.fontSize) {
                                    const currentPx = parseFloat(el.style.fontSize);
                                    if (!isNaN(currentPx)) {
                                        el.style.fontSize = (currentPx * avgScale) + 'px';
                                    }
                                }
                            });
                            child.content = tempDiv.innerHTML;
                        }
                        updateTextImageLive(child, this.canvasState);
                    } else if (['rect', 'image', 'pdf'].includes(child.type)) {
                        Object.assign(child, { x: newChildProps.x, y: newChildProps.y, width: newChildProps.width, height: newChildProps.height });
                    } else if (child.type === 'parallelogram') {
                        Object.assign(child, { x: newChildProps.x, y: newChildProps.y, width: newChildProps.width, height: newChildProps.height, slantOffset: originalChild.slantOffset * scaleX });
                    } else if (child.type === 'parallelepiped') {
                        Object.assign(child, { x: newChildProps.x, y: newChildProps.y, width: newChildProps.width, height: newChildProps.height, depthOffset: { x: originalChild.depthOffset.x * scaleX, y: originalChild.depthOffset.y * scaleY } });
                    } else if (child.type === 'cone') {
                        child.baseY = oBox.y + (originalChild.baseY - oBox.y) * scaleY;
                        child.apex.y = oBox.y + (originalChild.apex.y - oBox.y) * scaleY;
                        child.cx = newChildProps.cx;
                        child.apex.x = newChildProps.cx;
                        child.rx = newChildProps.rx;
                        child.ry = newChildProps.ry;
                    } else if (child.type === 'frustum') {
                        child.baseY = oBox.y + (originalChild.baseY - oBox.y) * scaleY;
                        child.topY = oBox.y + (originalChild.topY - oBox.y) * scaleY;
                        child.cx = newChildProps.cx;
                        child.rx1 = originalChild.rx1 * scaleX;
                        child.ry1 = originalChild.ry1 * scaleY;
                        child.rx2 = originalChild.rx2 * scaleX;
                        child.ry2 = originalChild.ry2 * scaleY;
                    } else if (child.type === 'sphere') {
                        Object.assign(child, { cx: newChildProps.cx, cy: newChildProps.cy, rx: newChildProps.rx, ry: newChildProps.ry });
                        delete child.r;
                    } else if (child.type === 'ellipse') {
                        Object.assign(child, { cx: newChildProps.cx, cy: newChildProps.cy, rx: newChildProps.rx, ry: newChildProps.ry });
                    } else if (child.type === 'truncated-sphere') {
                        const scaledLayer = {
                            cx: newChildProps.cx,
                            cy: newChildProps.cy,
                            rx: newChildProps.rx,
                            ry: newChildProps.ry,
                            cutY: oBox.y + (originalChild.cutY - oBox.y) * scaleY,
                        };
                        const h = Math.abs(scaledLayer.cutY - scaledLayer.cy);
                        if (h >= scaledLayer.ry) {
                            scaledLayer.cutR = 0;
                            scaledLayer.cutRy = 0;
                        } else {
                            const ratioY = h / scaledLayer.ry;
                            scaledLayer.cutR = scaledLayer.rx * Math.sqrt(1 - (ratioY * ratioY));
                            scaledLayer.cutRy = scaledLayer.cutR * 0.3;
                        }
                        Object.assign(child, scaledLayer);
                        delete child.r;
                    } else if (['triangle', 'trapezoid', 'rhombus'].includes(child.type)) {
                        ['p1', 'p2', 'p3', 'p4'].forEach(p => {
                            if (child[p]) {
                                child[p] = {
                                    x: oBox.x + (originalChild[p].x - oBox.x) * scaleX,
                                    y: oBox.y + (originalChild[p].y - oBox.y) * scaleY
                                };
                            }
                        });
                    } else if (child.type === 'path') {
                        const newPoints = [];
                        const step = originalChild.hasPressure ? 3 : 2;
                        for (let i = 0; i < originalChild.points.length; i += step) {
                            const originalX = originalChild.points[i];
                            const originalY = originalChild.points[i + 1];
                            const newX = oBox.x + (originalX - oBox.x) * scaleX;
                            const newY = oBox.y + (originalY - oBox.y) * scaleY;
                            newPoints.push(newX, newY);
                            if (originalChild.hasPressure) {
                                newPoints.push(originalChild.points[i + 2]);
                            }
                        }
                        child.points = newPoints;
                    } else if (child.type === 'curve') {
                        child.nodes = originalChild.nodes.map(node => ({
                            p: { x: oBox.x + (node.p.x - oBox.x) * scaleX, y: oBox.y + (node.p.y - oBox.y) * scaleY },
                            h1: node.h1 ? { x: oBox.x + (node.h1.x - oBox.x) * scaleX, y: oBox.y + (node.h1.y - oBox.y) * scaleY } : null,
                            h2: node.h2 ? { x: oBox.x + (node.h2.x - oBox.x) * scaleX, y: oBox.y + (node.h2.y - oBox.y) * scaleY } : null,
                            type: node.type
                        }));
                    } else if (child.type === 'line' || child.type === 'arrow') {
                        child.x1 = oBox.x + (originalChild.x1 - oBox.x) * scaleX;
                        child.y1 = oBox.y + (originalChild.y1 - oBox.y) * scaleY;
                        child.x2 = oBox.x + (originalChild.x2 - oBox.x) * scaleX;
                        child.y2 = oBox.y + (originalChild.y2 - oBox.y) * scaleY;
                    } else if (['pyramid', 'truncated-pyramid'].includes(child.type)) {
                        if (child.apex) {
                            child.apex = {
                                x: oBox.x + (originalChild.apex.x - oBox.x) * scaleX,
                                y: oBox.y + (originalChild.apex.y - oBox.y) * scaleY
                            };
                        }
                        ['base', 'top'].forEach(part => {
                            if (child[part]) {
                                Object.keys(child[part]).forEach(p => {
                                    child[part][p] = {
                                        x: oBox.x + (originalChild[part][p].x - oBox.x) * scaleX,
                                        y: oBox.y + (originalChild[part][p].y - oBox.y) * scaleY
                                    };
                                });
                            }
                        });
                    }
                    
                    if (this.canvasState.tileManager) {
                        this.canvasState.tileManager.invalidateLayer(child, this.canvasState);
                    }
                });
                
                this.canvasState.redraw();
            }
        }

        if (this.connectionState) {
            this.connectionState.mouseX = (e.clientX - this.canvasState.panX) / this.canvasState.zoom;
            this.connectionState.mouseY = (e.clientY - this.canvasState.panY) / this.canvasState.zoom;
        }
    }

    getClosestPortSide(sticker, targetX, targetY) {
        const sides = ['top', 'right', 'bottom', 'left'];
        let bestSide = 'left';
        let minDist = Infinity;
        sides.forEach(side => {
            const p = sticker.getPortCoords(side);
            const dist = Math.hypot(p.x - targetX, p.y - targetY);
            if (dist < minDist) {
                minDist = dist;
                bestSide = side;
            }
        });
        return bestSide;
    }

    onMouseUp(e) {
        // Helper: unconditionally clean up all interaction states
        const cleanupAllStates = () => {
            try {
                if (this.dragState) {
                    const s = this.dragState.sticker;
                    s.isDragging = false;
                    s.element.classList.remove('dragging');
                    this.dragState = null;
                    this.hoveredLinkForInsert = null;
                    if (this.canvasState.spatialGrid) {
                        this.canvasState.spatialGrid = utils.buildSpatialGrid(this.canvasState.layers);
                    }
                }
                if (this.resizeState) {
                    this.resizeState = null;
                    if (this.canvasState.spatialGrid) {
                        this.canvasState.spatialGrid = utils.buildSpatialGrid(this.canvasState.layers);
                    }
                }
                if (this.connectionState) {
                    this.connectionState = null;
                    this.setConnectingState(false);
                    this.renderLinks();
                }
            } catch (err) {
                console.error("Error in cleanupAllStates:", err);
            } finally {
                this.toolbarNeedsUpdate = true;
                this.updateToolbarPosition();
            }
        };

        try {
            // Guard: ignore simulated mouse events from touch
            if (e.sourceCapabilities && e.sourceCapabilities.firesTouchEvents) {
                cleanupAllStates();
                return;
            }
            if (e.type === 'mouseup' && this.lastTouchTime && (Date.now() - this.lastTouchTime < 1000)) {
                cleanupAllStates();
                return;
            }

            // --- Normal mouseup handling ---
            if (this.dragState) {
                const s = this.dragState.sticker;
                
                if (this.hoveredLinkForInsert) {
                    const oldLink = this.hoveredLinkForInsert;
                    const linkIndex = this.links.indexOf(oldLink);
                    
                    if (linkIndex > -1) {
                        this.links.splice(linkIndex, 1);
                        
                        const pFrom = oldLink.from.getPortCoords(oldLink.fromSide);
                        const pTo = oldLink.to.getPortCoords(oldLink.toSide);
                        
                        let inSide = this.getClosestPortSide(s, pFrom.x, pFrom.y);
                        let outSide = this.getClosestPortSide(s, pTo.x, pTo.y);
                        
                        if (inSide === outSide) {
                            const opposites = { 'top': 'bottom', 'bottom': 'top', 'left': 'right', 'right': 'left' };
                            outSide = opposites[inSide];
                        }
                        
                        this.links.push({
                            from: oldLink.from, fromSide: oldLink.fromSide,
                            to: s, toSide: inSide,
                            color: oldLink.color, style: oldLink.style
                        });
                        this.links.push({
                            from: s, fromSide: outSide,
                            to: oldLink.to, toSide: oldLink.toSide,
                            color: oldLink.color, style: oldLink.style
                        });
                        s.triggerJelly('x', 0.3);
                        this.saveLinksState();
                    }
                }

                s.isDragging = false;
                s.element.classList.remove('dragging');
                this.dragState = null;
                this.hoveredLinkForInsert = null;
                if (this.canvasState.spatialGrid) {
                    this.canvasState.spatialGrid = utils.buildSpatialGrid(this.canvasState.layers);
                }
                this.canvasState.saveState(this.canvasState.layers);
            }
            
            if (this.resizeState) {
                this.resizeState = null;
                if (this.canvasState.spatialGrid) {
                    this.canvasState.spatialGrid = utils.buildSpatialGrid(this.canvasState.layers);
                }
                this.canvasState.saveState(this.canvasState.layers);
            }
            if (this.connectionState) {
                let clientX, clientY;
                if (e.changedTouches && e.changedTouches.length > 0) {
                    clientX = e.changedTouches[0].clientX;
                    clientY = e.changedTouches[0].clientY;
                } else if (e.clientX !== undefined) {
                    clientX = e.clientX;
                    clientY = e.clientY;
                }
                
                if (clientX !== undefined && clientY !== undefined) {
                    const element = document.elementFromPoint(clientX, clientY);
                    const portEl = element && element.closest ? element.closest('.port') : null;
                    const cardEl = element && element.closest ? element.closest('.sticker-card') : null;
                    if (cardEl) {
                        const destSticker = this.stickers.find(s => String(s.id) === String(cardEl.id));
                        if (destSticker && destSticker !== this.connectionState.from) {
                            // На тач палец редко попадает точно в 14-пиксельный порт:
                            // если отпустили на карточке — цепляем к ближайшей стороне.
                            let side = portEl ? portEl.dataset.side : null;
                            if (!side) {
                                const worldX = (clientX - this.canvasState.panX) / this.canvasState.zoom;
                                const worldY = (clientY - this.canvasState.panY) / this.canvasState.zoom;
                                side = this.getClosestPortSide(destSticker, worldX, worldY);
                            }
                            this.finishConnection(destSticker, side);
                            return; // finishConnection handles cleanup + renderLinks
                        }
                    }
                }
                this.connectionState = null;
                this.setConnectingState(false);
                this.renderLinks(); // immediately clear ghost arrow from SVG
            }
        } catch (err) {
            console.error("Error in onMouseUp:", err);
        } finally {
            this.toolbarNeedsUpdate = true;
            this.updateToolbarPosition();
        }
    }

    getDistanceToBezier(px, py, x1, y1, cx1, cy1, cx2, cy2, x2, y2) {
        let minDist = Infinity;
        for (let i = 0; i <= 12; i++) {
            const t = i / 12;
            const bx = Math.pow(1-t, 3)*x1 + 3*Math.pow(1-t, 2)*t*cx1 + 3*(1-t)*Math.pow(t, 2)*cx2 + Math.pow(t, 3)*x2;
            const by = Math.pow(1-t, 3)*y1 + 3*Math.pow(1-t, 2)*t*cy1 + 3*(1-t)*Math.pow(t, 2)*cy2 + Math.pow(t, 3)*y2;
            const dist = Math.hypot(px - bx, py - by);
            if (dist < minDist) minDist = dist;
        }
        return minDist;
    }

    startPhysicsLoop() {
        let lastSignature = null;

        const loop = () => {
            // Позиции/размеры, состав связей и их оформление в одной строке:
            // если ничего не изменилось и «желе» уже успокоилось, кадр можно
            // не считать — это снимает O(n²·3) коллизий и пересборку SVG на простое.
            let signature = `${this.stickers.length}|${this.links.length}|${this.selectedLinkIndex}|${this.connectionState ? 1 : 0}`;
            for (const s of this.stickers) {
                signature += `|${Math.round(s.x * 100)},${Math.round(s.y * 100)},${Math.round(s.w * 100)},${Math.round(s.h * 100)}`;
            }
            const hoveredIndex = this.hoveredLinkForInsert ? this.links.indexOf(this.hoveredLinkForInsert) : -1;
            signature += `|h${hoveredIndex}`;
            for (const l of this.links) {
                signature += `|${l.from ? l.from.id : ''},${l.fromSide},${l.to ? l.to.id : ''},${l.toSide},${l.color || ''},${l.style || ''}`;
            }

            const isInteracting = !!(this.dragState || this.resizeState || this.connectionState);
            const isJellyAnimating = this.stickers.some(s =>
                Math.abs(s.scaleX - 1) > 0.001 || Math.abs(s.scaleY - 1) > 0.001 ||
                Math.abs(s.velX) > 0.001 || Math.abs(s.velY) > 0.001
            );

            if (isInteracting || isJellyAnimating || signature !== lastSignature) {
                lastSignature = signature;
                this.applyPhysics();
                this.renderLinks();
            }

            requestAnimationFrame(loop);
        };
        loop();
    }

    shiftSticker(sticker, dx, dy, shiftedStickers) {
        if (dx === 0 && dy === 0) return;
        sticker.x += dx;
        sticker.y += dy;
        if (shiftedStickers) {
            shiftedStickers.add(sticker);
        }

        // Sync with layers list
        const stateLayer = this.canvasState.layers.find(l => String(l.id) === String(sticker.id));
        if (stateLayer) {
            stateLayer.x = sticker.x;
            stateLayer.y = sticker.y;
        }

        // Move child annotations
        const children = this.canvasState.layers.filter(child => child.parentId === sticker.id);
        children.forEach(child => {
            utils.translateLayer(child, dx, dy);
            if (this.canvasState.tileManager) {
                this.canvasState.tileManager.invalidateLayer(child, this.canvasState);
            }
        });
    }

    applyPhysics() {
        const iterations = 3; 
        const shiftedStickers = new Set();
        
        for(let iter = 0; iter < iterations; iter++) {
            for (let i = 0; i < this.stickers.length; i++) {
                for (let j = i + 1; j < this.stickers.length; j++) {
                    const a = this.stickers[i];
                    const b = this.stickers[j];

                    const aCX = a.x + a.w / 2;
                    const aCY = a.y + a.h / 2;
                    const bCX = b.x + b.w / 2;
                    const bCY = b.y + b.h / 2;

                    const dx = aCX - bCX;
                    const dy = aCY - bCY;

                    const absDx = Math.abs(dx);
                    const absDy = Math.abs(dy);
                    const combinedHalfW = a.w / 2 + b.w / 2;
                    const combinedHalfH = a.h / 2 + b.h / 2;

                    const overlapX = combinedHalfW - absDx;
                    const overlapY = combinedHalfH - absDy;

                    if (overlapX > 0 && overlapY > 0) {
                        if (overlapX < overlapY) {
                            const sign = Math.sign(dx) || 1;
                            const pushX = overlapX / 2;
                            
                            if (!a.isDragging && !b.isDragging) {
                                this.shiftSticker(a, pushX * sign, 0, shiftedStickers);
                                this.shiftSticker(b, -pushX * sign, 0, shiftedStickers);
                            } else if (a.isDragging && !b.isDragging) {
                                this.shiftSticker(b, -overlapX * sign, 0, shiftedStickers);
                            } else if (!a.isDragging && b.isDragging) {
                                this.shiftSticker(a, overlapX * sign, 0, shiftedStickers);
                            }

                            if (iter === 0 && overlapX > 2) {
                                if(!a.isDragging) a.triggerJelly('x');
                                if(!b.isDragging) b.triggerJelly('x');
                            }
                        } else {
                            const sign = Math.sign(dy) || 1;
                            const pushY = overlapY / 2;

                            if (!a.isDragging && !b.isDragging) {
                                this.shiftSticker(a, 0, pushY * sign, shiftedStickers);
                                this.shiftSticker(b, 0, -pushY * sign, shiftedStickers);
                            } else if (a.isDragging && !b.isDragging) {
                                this.shiftSticker(b, 0, -overlapY * sign, shiftedStickers);
                            } else if (!a.isDragging && b.isDragging) {
                                this.shiftSticker(a, 0, overlapY * sign, shiftedStickers);
                            }

                            if (iter === 0 && overlapY > 2) {
                                if(!a.isDragging) a.triggerJelly('y');
                                if(!b.isDragging) b.triggerJelly('y');
                            }
                        }
                    } 
                    else if (iter === 0) { 
                        const magnetRange = 30;
                        const inMagnetZoneX = absDx < combinedHalfW + magnetRange;
                        const inMagnetZoneY = absDy < combinedHalfH + magnetRange;

                        if (inMagnetZoneX && inMagnetZoneY) {
                            const force = 1.0;
                            if (overlapX < overlapY) { 
                                if(!a.isDragging) this.shiftSticker(a, -Math.sign(dx) * force, 0, shiftedStickers);
                                if(!b.isDragging) this.shiftSticker(b, Math.sign(dx) * force, 0, shiftedStickers);
                            } else {
                                if(!a.isDragging) this.shiftSticker(a, 0, -Math.sign(dy) * force, shiftedStickers);
                                if(!b.isDragging) this.shiftSticker(b, 0, Math.sign(dy) * force, shiftedStickers);
                            }
                        }
                    }
                }
            }
        }

        const selectedStickersInState = (this.canvasState.selectedLayers || []).filter(l => l && l.type === 'sticker');
        if (selectedStickersInState.length === 1) {
            const singleSticker = this.stickers.find(s => String(s.id) === String(selectedStickersInState[0].id));
            if (singleSticker && this.selectedSticker !== singleSticker) {
                this.selectedSticker = singleSticker;
                this.toolbarNeedsUpdate = true;
            }
        } else {
            if (this.selectedSticker) {
                const stillSelected = selectedStickersInState.some(l => String(l.id) === String(this.selectedSticker.id));
                if (!stillSelected) {
                    this.selectedSticker = null;
                    this.toolbarNeedsUpdate = true;
                }
            }
        }

        const selectedIds = new Set((this.canvasState.selectedLayers || []).map(l => l.id));
        this.stickers.forEach(s => {
            const isSel = selectedIds.has(s.id) || (this.selectedSticker === s);
            if (s.isSelected !== isSel) {
                s.isSelected = isSel;
                if (isSel) {
                    s.element.classList.add('selected');
                } else {
                    s.element.classList.remove('selected');
                    const activeEl = document.activeElement;
                    if (activeEl && activeEl.classList.contains('sticker-content') && activeEl.closest('.sticker-card') === s.element) {
                        activeEl.blur();
                    }
                }
            }
            s.updatePhysics();
        });

        const hasSelectedSticker = this.selectedSticker || (this.canvasState.editingAnnotationsLayerId && this.stickers.find(st => String(st.id) === String(this.canvasState.editingAnnotationsLayerId)));

        if (shiftedStickers.size > 0) {
            shiftedStickers.forEach(s => s.renderDrawing());
            this.updateToolbarPosition();
            if (this.canvasState.spatialGrid) {
                this.canvasState.spatialGrid = utils.buildSpatialGrid(this.canvasState.layers);
            }
        } else if (this.toolbarNeedsUpdate || (hasSelectedSticker && (Math.abs(hasSelectedSticker.velX) > 0.001 || Math.abs(hasSelectedSticker.velY) > 0.001 || Math.abs(1 - hasSelectedSticker.scaleX) > 0.001 || Math.abs(1 - hasSelectedSticker.scaleY) > 0.001))) {
            this.updateToolbarPosition();
            this.toolbarNeedsUpdate = false;
        }
    }

    renderLinks() {
        const usedColors = new Set(this.links.map(l => l.color || '#a855f7'));
        usedColors.add('#ef4444');
        if (this.connectionState && this.connectionState.color) {
            usedColors.add(this.connectionState.color);
        }
        
        let defsHTML = `<defs>`;
        usedColors.forEach(color => {
            const idColor = color.replace('#', '');
            defsHTML += `
            <marker id="arrowhead-sticker-${idColor}" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
                <polygon points="0 0, 8 3, 0 6" fill="${color}" />
            </marker>`;
        });
        defsHTML += `</defs>`;
        let svgContent = defsHTML;

        if (this.hoveredLinkForInsert) {
            const l = this.hoveredLinkForInsert;
            const fromPos = l.from.getPortCoords(l.fromSide);
            const toPos = l.to.getPortCoords(l.toSide);
            svgContent += this.createPath(fromPos.x, fromPos.y, l.fromSide, toPos.x, toPos.y, l.toSide, false, false, -1, l.color, 'solid', true);
        }

        this.links.forEach((link, index) => {
            const fromPos = link.from.getPortCoords(link.fromSide);
            const toPos = link.to.getPortCoords(link.toSide);
            const isSelected = (this.selectedLinkIndex === index);
            svgContent += this.createPath(fromPos.x, fromPos.y, link.fromSide, toPos.x, toPos.y, link.toSide, false, isSelected, index, link.color, link.style);
        });

        if (this.connectionState) {
            const fromPos = this.connectionState.from.getPortCoords(this.connectionState.fromSide);
            svgContent += this.createPath(
                fromPos.x, fromPos.y, this.connectionState.fromSide, 
                this.connectionState.mouseX, this.connectionState.mouseY, null, 
                true, false, -1, this.connectionState.color || '#a855f7', this.connectionState.style
            );
        }

        this.connectionsLayer.innerHTML = svgContent;
    }

    getDirVector(side) {
        if (side === 'top') return { x: 0, y: -1 };
        if (side === 'bottom') return { x: 0, y: 1 };
        if (side === 'left') return { x: -1, y: 0 };
        if (side === 'right') return { x: 1, y: 0 };
        return { x: 0, y: 0 };
    }

    createPath(x1, y1, side1, x2, y2, side2, isActive, isSelected = false, index = -1, linkColor = '#a855f7', style = 'solid', isGlow = false) {
        const d1 = this.getDirVector(side1);
        const d2 = isActive ? {x: 0, y: 0} : this.getDirVector(side2); 

        const dist = Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1)) * 0.5 + 40;
        
        const cx1 = x1 + d1.x * dist;
        const cy1 = y1 + d1.y * dist;
        const cx2 = x2 + d2.x * dist;
        const cy2 = y2 + d2.y * dist;

        const actualColor = linkColor;
        const markerId = `arrowhead-sticker-${actualColor.replace('#', '')}`;

        let classPath = isActive ? 'link link-active' : 'link';
        if (isGlow) classPath = 'link link-insert-glow';
        
        let strokeStyle = `stroke: ${actualColor};`;
        if (!isActive && !isGlow) {
            if (style === 'dashed') strokeStyle += ' stroke-dasharray: 8 6;';
            if (style === 'dotted') strokeStyle += ' stroke-dasharray: 2 6; stroke-linecap: round;';
        }

        let pathHTML = '';
        if (index !== -1 && !isGlow) {
            pathHTML += `<path d="M ${x1} ${y1} C ${cx1} ${cy1}, ${cx2} ${cy2}, ${x2} ${y2}" class="link-hitbox" data-index="${index}" />`;
        }
        
        if (isSelected && !isGlow) {
            pathHTML += `<path d="M ${x1} ${y1} C ${cx1} ${cy1}, ${cx2} ${cy2}, ${x2} ${y2}" style="fill: none; stroke: #ef4444; stroke-width: 8; opacity: 0.5; stroke-dasharray: 6 4; stroke-linecap: round; pointer-events: none;" />`;
        }
        
        const markerAttr = isGlow ? '' : `marker-end="url(#${markerId})"`;
        pathHTML += `<path d="M ${x1} ${y1} C ${cx1} ${cy1}, ${cx2} ${cy2}, ${x2} ${y2}" class="${classPath}" style="${strokeStyle}" ${markerAttr} data-index="${index}" />`;

        return pathHTML;
    }

    saveLinksState() {
        // Map links to serializable format: { fromId, fromSide, toId, toSide, color, style }
        const serializableLinks = this.links.map(l => ({
            fromId: l.from.id,
            fromSide: l.fromSide,
            toId: l.to.id,
            toSide: l.toSide,
            color: l.color,
            style: l.style
        }));
        
        if (!this.canvasState.viewState) {
            this.canvasState.viewState = {};
        }
        this.canvasState.viewState.stickerLinks = serializableLinks;
        this.canvasState.saveState(this.canvasState.layers);
    }

    loadStickersAndLinks(layers, linksData) {
        // Clear current elements
        this.stickers.forEach(s => s.remove());
        this.stickers = [];
        this.links = [];
        
        // Load stickers from layers list
        const stickerLayers = layers.filter(l => l.type === 'sticker');
        stickerLayers.forEach(layer => {
            const s = new Sticker(this, this.canvasState, layer);
            this.stickers.push(s);
            s.renderDrawing();
        });
        
        // Rebuild links
        if (linksData && Array.isArray(linksData)) {
            linksData.forEach(lData => {
                const fromSticker = this.stickers.find(s => String(s.id) === String(lData.fromId));
                const toSticker = this.stickers.find(s => String(s.id) === String(lData.toId));
                if (fromSticker && toSticker) {
                    this.links.push({
                        from: fromSticker,
                        fromSide: lData.fromSide,
                        to: toSticker,
                        toSide: lData.toSide,
                        color: lData.color || '#a855f7',
                        style: lData.style || 'solid'
                    });
                }
            });
        }
        
        this.updateToolbarPosition();
    }

    clear() {
        this.stickers.forEach(s => s.remove());
        this.stickers = [];
        this.links = [];
        this.connectionsLayer.innerHTML = '';
        this.toolbar.classList.remove('visible');
        this.toolbar.style.display = 'none';
        if (this.linkToolbar) {
            this.linkToolbar.classList.remove('visible');
            this.linkToolbar.style.display = 'none';
        }
        this.selectedSticker = null;
        this.selectedLinkIndex = null;
    }

    syncStickersAndLinks(layers) {
        const stickerLayers = (layers || []).filter(l => l.type === 'sticker');
        const stickerLayerIds = new Set(stickerLayers.map(l => String(l.id)));

        // 1. Remove stickers that are no longer in layers
        let selectedStickerRemoved = false;
        let editingStickerRemoved = false;
        this.stickers = this.stickers.filter(s => {
            if (!stickerLayerIds.has(String(s.id))) {
                s.remove();
                if (this.selectedSticker === s) {
                    selectedStickerRemoved = true;
                }
                if (String(this.canvasState.editingAnnotationsLayerId) === String(s.id)) {
                    editingStickerRemoved = true;
                }
                return false;
            }
            return true;
        });

        if (selectedStickerRemoved || editingStickerRemoved) {
            this.selectSticker(null);
        }

        // 2. Add new stickers for layers that don't have one, and update existing ones
        stickerLayers.forEach(layer => {
            let s = this.stickers.find(st => String(st.id) === String(layer.id));
            if (!s) {
                s = new Sticker(this, this.canvasState, layer);
                this.stickers.push(s);
            } else {
                s.layer = layer;
                s.x = layer.x;
                s.y = layer.y;
                s.w = layer.width;
                s.h = layer.height;
                s.color = layer.color;
                s.shape = layer.shape || 'rect';
                s.imageSrc = layer.imageSrc;

                s.element.style.left = `${s.x}px`;
                s.element.style.top = `${s.y}px`;
                s.element.style.width = `${s.w}px`;
                s.element.style.height = `${s.h}px`;
                s.element.dataset.shape = s.shape;
                s.bgElement.style.backgroundColor = s.color;
                if (s.color === '#ffffff') {
                    s.bgElement.style.border = '1px solid rgba(0,0,0,0.1)';
                } else {
                    s.bgElement.style.border = '1px solid rgba(0,0,0,0.08)';
                }

                const contentEl = s.element.querySelector('.sticker-content');
                if (contentEl && contentEl.innerHTML !== layer.content) {
                    contentEl.innerHTML = layer.content;
                }

                if (s.imageElement) {
                    if (s.imageSrc) {
                        s.imageElement.src = s.imageSrc;
                        s.imageElement.style.display = 'block';
                        s.element.classList.add('has-image');
                    } else {
                        s.imageElement.src = '';
                        s.imageElement.style.display = 'none';
                        s.element.classList.remove('has-image');
                    }
                }
            }
            s.renderDrawing();
        });

        // 3. Remove links where from or to sticker is no longer present
        const stickerIds = new Set(this.stickers.map(s => s.id));
        this.links = this.links.filter(link => {
            return stickerIds.has(link.from.id) && stickerIds.has(link.to.id);
        });

        this.updateToolbarPosition();
    }
}

export function syncStickersWithCanvas(canvasState) {
    const stickersLayer = document.getElementById('stickers-layer');
    if (stickersLayer) {
        const { panX, panY, zoom } = canvasState;
        stickersLayer.style.transform = `translate(${panX}px, ${panY}px) scale(${zoom})`;
        stickersLayer.style.transformOrigin = '0 0';
        
        if (canvasState.activeTool !== 'select' || canvasState.editingAnnotationsLayerId) {
            stickersLayer.classList.add('pan-mode');
        } else {
            stickersLayer.classList.remove('pan-mode');
        }
    }
}

function updateTextImageLive(layer, canvasState) {
    if (layer.isGeneratingLiveImage) return;
    layer.isGeneratingLiveImage = true;

    utils.createTextImage(layer, true).then(img => {
        layer.isGeneratingLiveImage = false;
        if (img) {
            layer.cachedImage = img;
            if (canvasState.tileManager) canvasState.tileManager.invalidateLayer(layer, canvasState);
            canvasState.redraw();
        }
    }).catch(() => {
        layer.isGeneratingLiveImage = false;
    });
}
