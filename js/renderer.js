// --- START OF FILE js/renderer.js ---

import { getBoundingBox, getGroupBoundingBox, rotatePoint } from './geometry.js';
import { getSelectionRotation } from './hitTest.js';

function drawWavyPath(ctx, points, closed = false) {
    if (points.length < 2) return;

    const amplitude = Math.max(2, ctx.lineWidth * 1.5); 
    const wavelength = Math.max(15, ctx.lineWidth * 8); 
    
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);

    const pathPoints = closed ? [...points, points[0]] : points;

    for (let i = 0; i < pathPoints.length - 1; i++) {
        const p1 = pathPoints[i];
        const p2 = pathPoints[i+1];

        const dx = p2.x - p1.x;
        const dy = p2.y - p1.y;
        const distance = Math.hypot(dx, dy);
        if (distance < 1) {
            ctx.lineTo(p2.x, p2.y);
            continue;
        };

        const angle = Math.atan2(dy, dx);
        const normalAngle = angle + Math.PI / 2;

        const segments = Math.max(10, Math.floor(distance / 5));

        for (let j = 1; j <= segments; j++) {
            const t = j / segments;
            const lineX = p1.x + dx * t;
            const lineY = p1.y + dy * t;

            const waveOffset = amplitude * Math.cos((t * distance / wavelength) * Math.PI - Math.PI/2);

            const waveX = lineX + waveOffset * Math.cos(normalAngle);
            const waveY = lineY + waveOffset * Math.sin(normalAngle);
            
            ctx.lineTo(waveX, waveY);
        }
    }
    ctx.stroke();
}


function wrapText(ctx, text, maxWidth) {
    const manualLines = text.split('\n');
    let allLines = [];

    manualLines.forEach(manualLine => {
        if (manualLine === '') {
            allLines.push('');
            return;
        }
        const words = manualLine.split(' ');
        let currentLine = '';
        for (const word of words) {
            const testLine = currentLine === '' ? word : `${currentLine} ${word}`;
            const metrics = ctx.measureText(testLine);

            if (metrics.width > maxWidth && currentLine !== '') {
                allLines.push(currentLine);
                currentLine = word;
            } else {
                currentLine = testLine;
            }
        }
        allLines.push(currentLine);
    });

    return allLines;
}

export function drawLayer(ctx, layer) {
    if (!layer) return;
    ctx.save();
    
    const rotation = layer.rotation || 0;
    if (rotation) {
        const box = getBoundingBox(layer);
        if (box) {
            const centerX = box.x + box.width / 2;
            const centerY = box.y + box.height / 2;
            
            const pivot = layer.pivot || { x: 0, y: 0 };
            
            const rotatedPivotOffset = rotatePoint(pivot, {x: 0, y: 0}, rotation);
            
            const pivotX = centerX + rotatedPivotOffset.x;
            const pivotY = centerY + rotatedPivotOffset.y;
            
            ctx.translate(pivotX, pivotY);
            ctx.rotate(rotation);
            ctx.translate(-pivotX, -pivotY);
        }
    }

    ctx.strokeStyle = layer.color;
    ctx.fillStyle = layer.color;
    ctx.lineWidth = layer.lineWidth;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    
    ctx.setLineDash([]);
    if (layer.lineStyle === 'dashed') {
        const dash = Math.max(4, layer.lineWidth * 2.5); 
        const gap = Math.max(4, layer.lineWidth * 2);   
        ctx.setLineDash([dash, gap]);
    } else if (layer.lineStyle === 'dash-dot') {
        const dash = Math.max(4, layer.lineWidth * 2.5);
        const gap = Math.max(4, layer.lineWidth * 1.5);
        const dot = Math.max(1, layer.lineWidth * 0.2); 
        ctx.setLineDash([dash, gap, dot, gap]);
    }

    if (layer.isEditing) {
        ctx.globalAlpha = 0; 
    }

    if (layer.type === 'path') {
        if (layer.lineStyle === 'wavy') {
             drawWavyPath(ctx, layer.points, false);
        } else { 
            if (layer.points.length < 1) { ctx.restore(); return; }
            if (layer.points.length === 1) {
                ctx.beginPath();
                const point = layer.points[0];
                const radius = Math.max(0.5, (layer.lineWidth) / 2);
                ctx.arc(point.x, point.y, radius, 0, 2 * Math.PI);
                ctx.fill();
            } else {
                const points = layer.points;
                ctx.lineWidth = layer.lineWidth; 
                if (points.length < 3) {
                    ctx.beginPath();
                    ctx.moveTo(points[0].x, points[0].y);
                    for (let i = 1; i < points.length; i++) {
                        ctx.lineTo(points[i].x, points[i].y);
                    }
                    ctx.stroke();
                } else {
                    ctx.beginPath();
                    ctx.moveTo(points[0].x, points[0].y);
                    for (let i = 0; i < points.length - 1; i++) {
                        const p0 = i > 0 ? points[i - 1] : points[i];
                        const p1 = points[i];
                        const p2 = points[i + 1];
                        const p3 = i < points.length - 2 ? points[i + 2] : p2;

                        const cp1 = { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 };
                        const cp2 = { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 };
                        
                        ctx.bezierCurveTo(cp1.x, cp1.y, cp2.x, cp2.y, p2.x, p2.y);
                    }
                    ctx.stroke();
                }
            }
        }
    }
    else if (layer.type === 'rect') {
        if (layer.lineStyle === 'wavy') {
            const points = [
                { x: layer.x, y: layer.y },
                { x: layer.x + layer.width, y: layer.y },
                { x: layer.x + layer.width, y: layer.y + layer.height },
                { x: layer.x, y: layer.y + layer.height }
            ];
            drawWavyPath(ctx, points, true);
        } else {
            ctx.beginPath(); 
            ctx.strokeRect(layer.x, layer.y, layer.width, layer.height); 
        }
    }
    else if (layer.type === 'ellipse') { 
        ctx.beginPath(); 
        ctx.ellipse(layer.cx, layer.cy, layer.rx, layer.ry, 0, 0, 2 * Math.PI); 
        ctx.stroke(); 
    }
    else if (layer.type === 'line') {
        if (layer.lineStyle === 'wavy') {
            const points = [{ x: layer.x1, y: layer.y1 }, { x: layer.x2, y: layer.y2 }];
            drawWavyPath(ctx, points, false);
        } else {
            ctx.beginPath(); 
            ctx.moveTo(layer.x1, layer.y1); 
            ctx.lineTo(layer.x2, layer.y2); 
            ctx.stroke(); 
        }
    }
    else if (layer.type === 'parallelogram') {
        const points = [
            { x: layer.x, y: layer.y + layer.height },
            { x: layer.x + layer.width, y: layer.y + layer.height },
            { x: layer.x + layer.width + layer.slantOffset, y: layer.y },
            { x: layer.x + layer.slantOffset, y: layer.y }
        ];
        if (layer.lineStyle === 'wavy') {
            drawWavyPath(ctx, points, true);
        } else {
            ctx.beginPath(); 
            ctx.moveTo(points[0].x, points[0].y); 
            ctx.lineTo(points[1].x, points[1].y); 
            ctx.lineTo(points[2].x, points[2].y); 
            ctx.lineTo(points[3].x, points[3].y); 
            ctx.closePath(); 
            ctx.stroke();
        }
    }
    else if (layer.type === 'triangle') { 
        const points = [layer.p1, layer.p2, layer.p3];
        if (layer.lineStyle === 'wavy') {
            drawWavyPath(ctx, points, true);
        } else {
            ctx.beginPath(); 
            ctx.moveTo(layer.p1.x, layer.p1.y); 
            ctx.lineTo(layer.p2.x, layer.p2.y); 
            ctx.lineTo(layer.p3.x, layer.p3.y); 
            ctx.closePath(); 
            ctx.stroke(); 
        }
    }
    else if (layer.type === 'text') {
        const fontWeight = layer.fontWeight || 'normal';
        const fontStyle = layer.fontStyle || 'normal';
        ctx.font = `${fontStyle} ${fontWeight} ${layer.fontSize}px ${layer.fontFamily}`;
        ctx.textBaseline = 'top';
        
        const lines = wrapText(ctx, layer.content, layer.width);
        
        const align = layer.align || 'left';
        ctx.textAlign = align;
        let x;
        if (align === 'center') {
            x = layer.x + layer.width / 2;
        } else if (align === 'right') {
            x = layer.x + layer.width;
        } else {
            x = layer.x;
        }

        const lineHeight = layer.fontSize * 1.2;
        lines.forEach((line, index) => {
            const y = layer.y + index * lineHeight;
            ctx.fillText(line, x, y);

            if (layer.textDecoration === 'underline') {
                const metrics = ctx.measureText(line);
                const lineY = y + layer.fontSize + 2;
                
                let startX, endX;
                if (align === 'center') {
                    startX = x - metrics.width / 2;
                    endX = x + metrics.width / 2;
                } else if (align === 'right') {
                    startX = x - metrics.width;
                    endX = x;
                } else { // left
                    startX = x;
                    endX = x + metrics.width;
                }
                ctx.beginPath();
                ctx.moveTo(startX, lineY);
                ctx.lineTo(endX, lineY);
                ctx.strokeStyle = layer.color;
                ctx.lineWidth = Math.max(1, layer.fontSize / 15);
                ctx.stroke();
            }
        });
    }
    else if (layer.type === 'sphere') { const { cx, cy, r } = layer; const equatorRy = r * 0.3, meridianRx = r * 0.5; ctx.setLineDash([]); ctx.beginPath(); ctx.arc(cx, cy, r, 0, 2 * Math.PI); ctx.stroke(); ctx.beginPath(); ctx.ellipse(cx, cy, r, equatorRy, 0, 0, Math.PI); ctx.stroke(); ctx.setLineDash([5, 5]); ctx.beginPath(); ctx.ellipse(cx, cy, r, equatorRy, 0, Math.PI, 2 * Math.PI); ctx.stroke(); ctx.setLineDash([5, 5]); ctx.beginPath(); ctx.ellipse(cx, cy, meridianRx, r, 0, -Math.PI / 2, Math.PI / 2); ctx.stroke(); ctx.setLineDash([]); ctx.beginPath(); ctx.ellipse(cx, cy, meridianRx, r, 0, Math.PI / 2, 3 * Math.PI / 2); ctx.stroke(); ctx.setLineDash([]); }
    else if (layer.type === 'cone') { const { cx, baseY, rx, ry, apex } = layer; ctx.setLineDash([]); ctx.beginPath(); ctx.moveTo(cx - rx, baseY); ctx.lineTo(apex.x, apex.y); ctx.lineTo(cx + rx, baseY); ctx.stroke(); ctx.beginPath(); ctx.ellipse(cx, baseY, rx, ry, 0, 0, Math.PI); ctx.stroke(); ctx.setLineDash([5, 5]); ctx.beginPath(); ctx.ellipse(cx, baseY, rx, ry, 0, Math.PI, 2 * Math.PI); ctx.stroke(); ctx.setLineDash([]); }
    else if (layer.type === 'parallelepiped') { const { x, y, width, height, depthOffset } = layer; const dx = depthOffset.x, dy = depthOffset.y; const p = [ {x, y}, {x: x + width, y}, {x: x + width, y: y + height}, {x, y: y + height}, {x: x + dx, y: y + dy}, {x: x + width + dx, y: y + dy}, {x: x + width + dx, y: y + height + dy}, {x: x + dx, y: y + height + dy} ]; ctx.setLineDash([]); ctx.beginPath(); ctx.moveTo(p[0].x, p[0].y); ctx.lineTo(p[1].x, p[1].y); ctx.lineTo(p[2].x, p[2].y); ctx.lineTo(p[3].x, p[3].y); ctx.closePath(); ctx.moveTo(p[1].x, p[1].y); ctx.lineTo(p[5].x, p[5].y); ctx.lineTo(p[6].x, p[6].y); ctx.lineTo(p[2].x, p[2].y); ctx.moveTo(p[0].x, p[0].y); ctx.lineTo(p[4].x, p[4].y); ctx.lineTo(p[5].x, p[5].y); ctx.stroke(); ctx.setLineDash([5, 5]); ctx.beginPath(); ctx.moveTo(p[3].x, p[3].y); ctx.lineTo(p[7].x, p[7].y); ctx.lineTo(p[4].x, p[4].y); ctx.moveTo(p[6].x, p[6].y); ctx.lineTo(p[7].x, p[7].y); ctx.stroke(); ctx.setLineDash([]); }
    else if (layer.type === 'pyramid') {
        const { base, apex } = layer;
        const p = [ base.p1, base.p2, base.p3, base.p4 ];
        
        ctx.setLineDash([5, 5]);
        ctx.beginPath();
        ctx.moveTo(p[3].x, p[3].y); ctx.lineTo(p[0].x, p[0].y); 
        ctx.moveTo(p[3].x, p[3].y); ctx.lineTo(p[2].x, p[2].y); 
        ctx.moveTo(p[3].x, p[3].y); ctx.lineTo(apex.x, apex.y); 
        ctx.stroke();
        
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(p[0].x, p[0].y); ctx.lineTo(p[1].x, p[1].y); 
        ctx.moveTo(p[1].x, p[1].y); ctx.lineTo(p[2].x, p[2].y); 
        ctx.moveTo(p[0].x, p[0].y); ctx.lineTo(apex.x, apex.y); 
        ctx.moveTo(p[1].x, p[1].y); ctx.lineTo(apex.x, apex.y); 
        ctx.moveTo(p[2].x, p[2].y); ctx.lineTo(apex.x, apex.y); 
        ctx.stroke();
    }
    else if (layer.type === 'trapezoid' || layer.type === 'rhombus') {
        const points = [layer.p1, layer.p2, layer.p3, layer.p4];
        if (layer.lineStyle === 'wavy') {
            drawWavyPath(ctx, points, true);
        } else {
            ctx.beginPath(); 
            ctx.moveTo(layer.p1.x, layer.p1.y); 
            ctx.lineTo(layer.p2.x, layer.p2.y); 
            ctx.lineTo(layer.p3.x, layer.p3.y); 
            ctx.lineTo(layer.p4.x, layer.p4.y); 
            ctx.closePath(); 
            ctx.stroke(); 
        }
    }
    else if (layer.type === 'frustum') { const { cx, baseY, topY, rx1, ry1, rx2, ry2 } = layer; ctx.setLineDash([]); ctx.beginPath(); ctx.moveTo(cx - rx1, baseY); ctx.lineTo(cx - rx2, topY); ctx.moveTo(cx + rx1, baseY); ctx.lineTo(cx + rx2, topY); ctx.stroke(); ctx.beginPath(); ctx.ellipse(cx, baseY, rx1, ry1, 0, 0, Math.PI); ctx.stroke(); ctx.setLineDash([5, 5]); ctx.beginPath(); ctx.ellipse(cx, baseY, rx1, ry1, 0, Math.PI, 2 * Math.PI); ctx.stroke(); ctx.setLineDash([]); ctx.beginPath(); ctx.ellipse(cx, topY, rx2, ry2, 0, 0, 2 * Math.PI); ctx.stroke(); ctx.setLineDash([]); }
    else if (layer.type === 'truncated-sphere') { const { cx, cy, r, cutY, cutR, cutRy } = layer; const sinAngle = (cutY - cy) / r; const clampedSinAngle = Math.max(-1, Math.min(1, sinAngle)); const angle = Math.asin(clampedSinAngle); ctx.setLineDash([]); ctx.beginPath(); ctx.arc(cx, cy, r, angle, Math.PI - angle); ctx.stroke(); ctx.beginPath(); ctx.ellipse(cx, cutY, cutR, cutRy, 0, 0, Math.PI); ctx.stroke(); ctx.setLineDash([5, 5]); ctx.beginPath(); ctx.ellipse(cx, cutY, cutR, cutRy, 0, Math.PI, 2 * Math.PI); ctx.stroke(); ctx.setLineDash([]); }
    else if (layer.type === 'truncated-pyramid') {
        const { base, top } = layer;
        const b = [ base.p1, base.p2, base.p3, base.p4 ];
        const t = [ top.p1, top.p2, top.p3, top.p4 ];
        
        ctx.setLineDash([5, 5]);
        ctx.beginPath();
        ctx.moveTo(b[3].x, b[3].y); ctx.lineTo(b[0].x, b[0].y); 
        ctx.moveTo(b[3].x, b[3].y); ctx.lineTo(b[2].x, b[2].y); 
        ctx.moveTo(b[3].x, b[3].y); ctx.lineTo(t[3].x, t[3].y); 
        ctx.stroke();

        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(b[0].x, b[0].y); ctx.lineTo(b[1].x, b[1].y); 
        ctx.lineTo(b[2].x, b[2].y); 
        ctx.moveTo(t[0].x, t[0].y); ctx.lineTo(t[1].x, t[1].y); 
        ctx.lineTo(t[2].x, t[2].y); 
        ctx.moveTo(b[0].x, b[0].y); ctx.lineTo(t[0].x, t[0].y); 
        ctx.moveTo(b[1].x, b[1].y); ctx.lineTo(t[1].x, t[1].y); 
        ctx.moveTo(b[2].x, b[2].y); ctx.lineTo(t[2].x, t[2].y); 
        ctx.moveTo(t[3].x, t[3].y); ctx.lineTo(t[2].x, t[2].y); 
        ctx.moveTo(t[3].x, t[3].y); ctx.lineTo(t[0].x, t[0].y); 
        ctx.stroke();
    }
    // --- НАЧАЛО ИЗМЕНЕНИЙ: Добавляем отрисовку для PDF-слоя ---
    else if (layer.type === 'pdf') {
        const pageCanvas = layer.renderedPages.get(layer.currentPage);
        if (pageCanvas) {
            ctx.drawImage(pageCanvas, layer.x, layer.y, layer.width, layer.height);
        }
    }
    // --- КОНЕЦ ИЗМЕНЕНИЙ ---
    else if (layer.type === 'image' && layer.image instanceof HTMLImageElement && layer.image.complete) { 
        ctx.drawImage(layer.image, layer.x, layer.y, layer.width, layer.height); 
    }
    ctx.restore();
}

function drawSelectionBox(ctx, selectedLayers, canvasState) {
    if (!selectedLayers || selectedLayers.length === 0 || !canvasState) return;

    const box = selectedLayers.length > 1 ? getGroupBoundingBox(selectedLayers) : getBoundingBox(selectedLayers[0]);
    if (!box) return;

    const isSingleSelection = selectedLayers.length === 1;
    const layer = isSingleSelection ? selectedLayers[0] : null;
    
    const zoom = canvasState.zoom;
    const scaledLineWidth = 1 / zoom;
    const scaledHandleSize = 8 / zoom;
    const scaledHalfHandle = scaledHandleSize / 2;
    const scaledDash = [5 / zoom, 5 / zoom];
    
    const rotation = getSelectionRotation(selectedLayers, canvasState.groupRotation);
    const centerX = box.x + box.width / 2;
    const centerY = box.y + box.height / 2;
    
    let pivotX = centerX;
    let pivotY = centerY;

    if (isSingleSelection && layer && layer.pivot) {
        const rotatedPivotOffset = rotatePoint(layer.pivot, {x:0, y:0}, rotation);
        pivotX = centerX + rotatedPivotOffset.x;
        pivotY = centerY + rotatedPivotOffset.y;
    }

    ctx.save();
    ctx.translate(pivotX, pivotY);
    ctx.rotate(rotation);
    ctx.translate(-pivotX, -pivotY);

    ctx.strokeStyle = '#007AFF';
    ctx.lineWidth = scaledLineWidth;
    ctx.setLineDash(scaledDash);
    ctx.strokeRect(box.x, box.y, box.width, box.height);
    ctx.setLineDash([]);
    ctx.fillStyle = '#007AFF';

    const handles = [
        { x: box.x, y: box.y }, { x: centerX, y: box.y }, { x: box.x + box.width, y: box.y },
        { x: box.x, y: centerY }, { x: box.x + box.width, y: centerY },
        { x: box.x, y: box.y + box.height }, { x: centerX, y: box.y + box.height }, { x: box.x + box.width, y: box.y + box.height }
    ];
    handles.forEach(handle => {
        ctx.fillRect(handle.x - scaledHalfHandle, handle.y - scaledHalfHandle, scaledHandleSize, scaledHandleSize);
    });
    
    const rotationHandleY = box.y - 20 / zoom;
    ctx.beginPath();
    ctx.moveTo(centerX, box.y);
    ctx.lineTo(centerX, rotationHandleY);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(centerX, rotationHandleY, scaledHalfHandle, 0, 2 * Math.PI);
    ctx.fill();
    
    ctx.restore();

    if (isSingleSelection) {
        ctx.save();
        ctx.strokeStyle = '#007AFF';
        ctx.lineWidth = scaledLineWidth;
        ctx.beginPath();
        ctx.arc(pivotX, pivotY, scaledHalfHandle, 0, 2 * Math.PI);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(pivotX - scaledHalfHandle, pivotY);
        ctx.lineTo(pivotX + scaledHalfHandle, pivotY);
        ctx.moveTo(pivotX, pivotY - scaledHalfHandle);
        ctx.lineTo(pivotX, pivotY + scaledHalfHandle);
        ctx.stroke();
        ctx.restore();
    }
}

export function redrawCanvas(canvasState) {
    if(!canvasState) return;
    const { ctx, layers, canvas, layersToErase } = canvasState;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.translate(canvasState.panX, canvasState.panY);
    ctx.scale(canvasState.zoom, canvasState.zoom);
    
    layers.forEach(layer => {
        if (!layersToErase.has(layer)) {
            drawLayer(ctx, layer);
        }
    });

    drawSelectionBox(ctx, canvasState.selectedLayers, canvasState);
    ctx.restore();
}

export function drawBackground(bgCanvas, canvasState) {
    const bgCtx = bgCanvas.getContext('2d');
    const style = localStorage.getItem('boardBackgroundStyle') || 'dot';
    const theme = localStorage.getItem('boardTheme') || 'light';
    const color = theme === 'light' ? '#d1d1d1' : '#5a5a5a';
    const spacing = 20;
    bgCtx.clearRect(0, 0, bgCanvas.width, bgCanvas.height);
    if (!canvasState) { if (style === 'dot') { for (let x = 0; x < bgCanvas.width; x += spacing) { for (let y = 0; y < bgCanvas.height; y += spacing) { bgCtx.fillStyle = color; bgCtx.beginPath(); bgCtx.arc(x, y, 1, 0, 2 * Math.PI, false); bgCtx.fill(); } } } else { bgCtx.strokeStyle = color; bgCtx.lineWidth = 0.5; for (let x = 0; x < bgCanvas.width; x += spacing) { bgCtx.beginPath(); bgCtx.moveTo(x, 0); bgCtx.lineTo(x, bgCanvas.height); bgCtx.stroke(); } for (let y = 0; y < bgCanvas.height; y += spacing) { bgCtx.beginPath(); bgCtx.moveTo(0, y); bgCtx.lineTo(bgCanvas.width, y); bgCtx.stroke(); } } return; }
    const { panX, panY, zoom } = canvasState;
    const visualSpacing = spacing * zoom;
    if (visualSpacing < 5) return;
    const startX = panX % visualSpacing;
    const startY = panY % visualSpacing;
    if (style === 'dot') { bgCtx.fillStyle = color; for (let x = startX; x < bgCanvas.width; x += visualSpacing) { for (let y = startY; y < bgCanvas.height; y += visualSpacing) { bgCtx.beginPath(); bgCtx.arc(x, y, 1, 0, 2 * Math.PI, false); bgCtx.fill(); } } } 
    else { bgCtx.strokeStyle = color; bgCtx.lineWidth = 0.5; for (let x = startX; x < bgCanvas.width; x += visualSpacing) { bgCtx.beginPath(); bgCtx.moveTo(x, 0); bgCtx.lineTo(x, bgCanvas.height); bgCtx.stroke(); } for (let y = startY; y < bgCanvas.height; y += visualSpacing) { bgCtx.beginPath(); bgCtx.moveTo(0, y); bgCtx.lineTo(bgCanvas.width, y); bgCtx.stroke(); } }
}