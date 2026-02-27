// --- START OF FILE js/renderer.js ---

import { getBoundingBox, getGroupBoundingBox, getGroupLogicalBoundingBox, rotatePoint, getTransformedBoundingBox, doBoxesIntersect, getRotationCenter } from './geometry.js';
import { getSelectionRotation } from './hitTest.js';
import { buildSpatialGrid, createTextImage } from './utils.js';

function drawWavyPath(ctx, points, closed = false) {
    if (points.length < 2) return;

    const amplitude = Math.max(3, ctx.lineWidth * 1.5);
    const wavelength = Math.max(20, ctx.lineWidth * 10);

    // Build a list of path segments with cumulative distance
    const pathPoints = closed ? [...points, points[0]] : points;
    let totalLength = 0;
    const segLengths = [];
    for (let i = 1; i < pathPoints.length; i++) {
        const len = Math.hypot(pathPoints[i].x - pathPoints[i - 1].x, pathPoints[i].y - pathPoints[i - 1].y);
        segLengths.push(len);
        totalLength += len;
    }
    if (totalLength < 1) return;

    // Walk along the path at small uniform steps, applying sine wave perpendicular to the direction
    const stepSize = Math.max(1, wavelength / 20);
    ctx.beginPath();

    let segIdx = 0;
    let segUsed = 0; // how much of current segment we've consumed
    let dist = 0;

    // Starting point
    const startWave = amplitude * Math.sin((2 * Math.PI * dist) / wavelength);
    const firstDx = pathPoints[1].x - pathPoints[0].x;
    const firstDy = pathPoints[1].y - pathPoints[0].y;
    const firstLen = Math.hypot(firstDx, firstDy) || 1;
    ctx.moveTo(
        pathPoints[0].x + startWave * (-firstDy / firstLen),
        pathPoints[0].y + startWave * (firstDx / firstLen)
    );

    while (segIdx < segLengths.length) {
        const segLen = segLengths[segIdx];
        if (segLen < 0.01) { segIdx++; segUsed = 0; continue; }

        const remaining = segLen - segUsed;
        const advance = Math.min(stepSize, remaining);
        segUsed += advance;
        dist += advance;

        const t = segUsed / segLen;
        const p1 = pathPoints[segIdx];
        const p2 = pathPoints[segIdx + 1];
        const baseX = p1.x + (p2.x - p1.x) * t;
        const baseY = p1.y + (p2.y - p1.y) * t;

        // Direction and normal
        const dx = p2.x - p1.x;
        const dy = p2.y - p1.y;
        const nx = -dy / segLen; // perpendicular normal
        const ny = dx / segLen;

        const waveOffset = amplitude * Math.sin((2 * Math.PI * dist) / wavelength);
        ctx.lineTo(baseX + waveOffset * nx, baseY + waveOffset * ny);

        if (segUsed >= segLen - 0.01) {
            segIdx++;
            segUsed = 0;
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

export function drawLayer(ctx, layer, canvasState) {
    if (!layer) return;
    const zoom = canvasState ? canvasState.zoom : 1;

    ctx.save();

    const rotation = layer.rotation || 0;
    if (rotation) {
        const center = getRotationCenter(layer);
        if (center) {
            const pivot = layer.pivot || { x: 0, y: 0 };

            const pivotX = center.x + pivot.x;
            const pivotY = center.y + pivot.y;

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
        const dash = layer.lineWidth * 4;
        const gap = layer.lineWidth * 4;
        ctx.setLineDash([dash, gap]);
    } else if (layer.lineStyle === 'dash-dot') {
        const dash = layer.lineWidth * 4;
        const gap = layer.lineWidth * 2.5;
        const dot = layer.lineWidth;
        ctx.setLineDash([dash, gap, dot, gap]);
    }

    if (layer.isEditing) {
        ctx.globalAlpha = 0;
    }

    const hasShadow = layer.type === 'image' || layer.type === 'pdf';
    if (hasShadow) {
        ctx.save();
        const theme = localStorage.getItem('boardTheme') || 'light';
        ctx.shadowColor = theme === 'dark' ? 'rgba(0, 0, 0, 0.6)' : 'rgba(0, 0, 0, 0.3)';
        ctx.shadowBlur = 15 / zoom;
        ctx.shadowOffsetX = 4 / zoom;
        ctx.shadowOffsetY = 4 / zoom;
    }

    if (layer.type === 'curve') {
        const nodes = layer.nodes;
        if (nodes && nodes.length > 1) {
            ctx.beginPath();
            ctx.moveTo(nodes[0].p.x, nodes[0].p.y);
            for (let i = 1; i < nodes.length; i++) {
                const prevNode = nodes[i - 1];
                const currNode = nodes[i];
                ctx.bezierCurveTo(
                    prevNode.h1.x, prevNode.h1.y,
                    currNode.h2.x, currNode.h2.y,
                    currNode.p.x, currNode.p.y
                );
            }
            ctx.stroke();
        }
    }
    else if (layer.type === 'path') {
        const points = layer.points;
        if (!points || points.length < 2) { ctx.restore(); return; }

        const hasPressure = layer.hasPressure;
        const step = hasPressure ? 3 : 2;

        if (layer.lineStyle === 'wavy') {
            // Resample the path at uniform intervals so the wave pattern
            // depends on line width, not drawing speed
            const rawPoints = [];
            for (let i = 0; i < points.length; i += step) {
                rawPoints.push({ x: points[i], y: points[i + 1] });
            }
            // Uniform interval tied to line width
            const sampleInterval = Math.max(3, layer.lineWidth * 2);
            const objectPoints = [rawPoints[0]];
            let distAccum = 0;
            for (let i = 1; i < rawPoints.length; i++) {
                const dx = rawPoints[i].x - rawPoints[i - 1].x;
                const dy = rawPoints[i].y - rawPoints[i - 1].y;
                const segLen = Math.hypot(dx, dy);
                distAccum += segLen;
                while (distAccum >= sampleInterval) {
                    const overshoot = distAccum - sampleInterval;
                    const t = 1 - overshoot / segLen;
                    objectPoints.push({
                        x: rawPoints[i - 1].x + dx * t,
                        y: rawPoints[i - 1].y + dy * t
                    });
                    distAccum -= sampleInterval;
                }
            }
            // Always include the last point
            const last = rawPoints[rawPoints.length - 1];
            if (objectPoints.length === 0 || objectPoints[objectPoints.length - 1].x !== last.x || objectPoints[objectPoints.length - 1].y !== last.y) {
                objectPoints.push(last);
            }
            drawWavyPath(ctx, objectPoints, false);
        } else {
            if (hasPressure) {
                ctx.lineCap = 'round';
                ctx.lineJoin = 'round';

                if (points.length < 6) {
                    const radius = Math.max(0.5, (layer.lineWidth * (points[2] || 0.5)) / 2);
                    ctx.fillStyle = layer.color;
                    ctx.beginPath();
                    ctx.arc(points[0], points[1], radius, 0, 2 * Math.PI);
                    ctx.fill();
                    ctx.restore(); return;
                }

                let p1x = points[0], p1y = points[1], p1p = points[2];
                let p2x = points[3], p2y = points[4], p2p = points[5];

                ctx.strokeStyle = layer.color;
                ctx.beginPath();
                ctx.moveTo(p1x, p1y);

                for (let i = step; i < points.length - step; i += step) {
                    const midX = (p1x + p2x) / 2;
                    const midY = (p1y + p2y) / 2;
                    const pressure = (p1p + p2p) / 2 || 0.5;
                    ctx.lineWidth = Math.max(0.5, layer.lineWidth * pressure);

                    ctx.quadraticCurveTo(p1x, p1y, midX, midY);
                    ctx.stroke();

                    ctx.beginPath();
                    ctx.moveTo(midX, midY);

                    p1x = points[i]; p1y = points[i + 1]; p1p = points[i + 2];
                    p2x = points[i + step]; p2y = points[i + step + 1]; p2p = points[i + step + 2];
                }

                const pressure = (p1p + p2p) / 2 || 0.5;
                ctx.lineWidth = Math.max(0.5, layer.lineWidth * pressure);
                ctx.quadraticCurveTo(p1x, p1y, p2x, p2y);
                ctx.stroke();

            } else {
                ctx.beginPath();
                ctx.moveTo(points[0], points[1]);

                if (points.length < 6) {
                    if (points.length === 2) {
                        const radius = Math.max(0.5, (layer.lineWidth) / 2);
                        ctx.arc(points[0], points[1], radius, 0, 2 * Math.PI);
                        ctx.fill();
                    } else {
                        ctx.lineTo(points[2], points[3]);
                        ctx.stroke();
                    }
                } else {
                    let i;
                    for (i = 2; i < points.length - 4; i += 2) {
                        const xc = (points[i] + points[i + 2]) / 2;
                        const yc = (points[i + 1] + points[i + 3]) / 2;
                        ctx.quadraticCurveTo(points[i], points[i + 1], xc, yc);
                    }
                    ctx.quadraticCurveTo(points[i], points[i + 1], points[i + 2], points[i + 3]);
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
            if (layer.fillColor && layer.fillColor !== 'transparent') {
                ctx.beginPath();
                ctx.rect(layer.x, layer.y, layer.width, layer.height);
                ctx.fillStyle = layer.fillColor;
                ctx.fill();
            }
            drawWavyPath(ctx, points, true);
        } else {
            ctx.beginPath();
            ctx.rect(layer.x, layer.y, layer.width, layer.height);
            if (layer.fillColor && layer.fillColor !== 'transparent') {
                ctx.fillStyle = layer.fillColor;
                ctx.fill();
            }
            ctx.stroke();
        }
    }
    else if (layer.type === 'ellipse') {
        if (layer.lineStyle === 'wavy') {
            const points = [];
            const numSegments = 72;
            for (let i = 0; i <= numSegments; i++) {
                const angle = (i / numSegments) * 2 * Math.PI;
                const x = layer.cx + layer.rx * Math.cos(angle);
                const y = layer.cy + layer.ry * Math.sin(angle);
                points.push({ x, y });
            }
            if (layer.fillColor && layer.fillColor !== 'transparent') {
                ctx.beginPath();
                ctx.ellipse(layer.cx, layer.cy, layer.rx, layer.ry, 0, 0, 2 * Math.PI);
                ctx.fillStyle = layer.fillColor;
                ctx.fill();
            }
            drawWavyPath(ctx, points, true);
        } else {
            ctx.beginPath();
            ctx.ellipse(layer.cx, layer.cy, layer.rx, layer.ry, 0, 0, 2 * Math.PI);
            if (layer.fillColor && layer.fillColor !== 'transparent') {
                ctx.fillStyle = layer.fillColor;
                ctx.fill();
            }
            ctx.stroke();
        }
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
        let points;
        if (layer.p1 && layer.p2 && layer.p3 && layer.p4) {
            points = [layer.p1, layer.p2, layer.p3, layer.p4];
        } else {
            points = [
                { x: layer.x, y: layer.y + layer.height },
                { x: layer.x + layer.width, y: layer.y + layer.height },
                { x: layer.x + layer.width + layer.slantOffset, y: layer.y },
                { x: layer.x + layer.slantOffset, y: layer.y }
            ];
        }

        if (layer.lineStyle === 'wavy') {
            if (layer.fillColor && layer.fillColor !== 'transparent') {
                ctx.beginPath();
                ctx.moveTo(points[0].x, points[0].y);
                for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
                ctx.closePath();
                ctx.fillStyle = layer.fillColor;
                ctx.fill();
            }
            drawWavyPath(ctx, points, true);
        } else {
            ctx.beginPath();
            ctx.moveTo(points[0].x, points[0].y);
            for (let i = 1; i < points.length; i++) {
                ctx.lineTo(points[i].x, points[i].y);
            }
            ctx.closePath();
            if (layer.fillColor && layer.fillColor !== 'transparent') {
                ctx.fillStyle = layer.fillColor;
                ctx.fill();
            }
            ctx.stroke();
        }
    }
    else if (layer.type === 'triangle') {
        const points = [layer.p1, layer.p2, layer.p3];
        if (layer.lineStyle === 'wavy') {
            if (layer.fillColor && layer.fillColor !== 'transparent') {
                ctx.beginPath();
                ctx.moveTo(layer.p1.x, layer.p1.y);
                ctx.lineTo(layer.p2.x, layer.p2.y);
                ctx.lineTo(layer.p3.x, layer.p3.y);
                ctx.closePath();
                ctx.fillStyle = layer.fillColor;
                ctx.fill();
            }
            drawWavyPath(ctx, points, true);
        } else {
            ctx.beginPath();
            ctx.moveTo(layer.p1.x, layer.p1.y);
            ctx.lineTo(layer.p2.x, layer.p2.y);
            ctx.lineTo(layer.p3.x, layer.p3.y);
            ctx.closePath();
            if (layer.fillColor && layer.fillColor !== 'transparent') {
                ctx.fillStyle = layer.fillColor;
                ctx.fill();
            }
            ctx.stroke();
        }
    }
    else if (layer.type === 'curve') {
        if (layer.nodes && layer.nodes.length > 1) {
            ctx.beginPath();
            ctx.moveTo(layer.nodes[0].p.x, layer.nodes[0].p.y);
            for (let i = 1; i < layer.nodes.length; i++) {
                const prevNode = layer.nodes[i - 1];
                const currNode = layer.nodes[i];
                ctx.bezierCurveTo(prevNode.h1.x, prevNode.h1.y, currNode.h2.x, currNode.h2.y, currNode.p.x, currNode.p.y);
            }
            ctx.stroke();
        }
    }
    else if (layer.type === 'text') {
        // Проверяем, что cachedImage существует, загружен и имеет размер
        if (layer.cachedImage && (layer.cachedImage instanceof HTMLImageElement || layer.cachedImage instanceof ImageBitmap) && layer.cachedImage.complete && layer.cachedImage.naturalWidth !== 0) {
            ctx.drawImage(layer.cachedImage, layer.x, layer.y, layer.width, layer.height);
        } else {
            // Fallback: если картинки нет, пробуем сгенерировать, но не блокируем отрисовку
            if (!layer.isGeneratingImage && !layer.isEditing) {
                layer.isGeneratingImage = true;
                createTextImage(layer).then(img => {
                    layer.cachedImage = img;
                    layer.isGeneratingImage = false;
                }).catch(e => {
                    layer.isGeneratingImage = false;
                });
            }

            // Рисуем текст через стандартный API для временного отображения
            const fontWeight = layer.fontWeight || 'normal';
            const fontStyle = layer.fontStyle || 'normal';
            ctx.font = `${fontStyle} ${fontWeight} ${layer.fontSize}px ${layer.fontFamily || 'Arial'}`;
            ctx.textBaseline = 'top';
            ctx.textAlign = layer.align || 'left';
            ctx.fillStyle = layer.color;

            // Упрощенный вывод текста (без тегов)
            const plainText = layer.content ? layer.content.replace(/<[^>]*>?/gm, '') : '';
            const lines = plainText.split('\n');
            let x;
            if (layer.align === 'center') {
                x = layer.x + layer.width / 2;
            } else if (layer.align === 'right') {
                x = layer.x + layer.width;
            } else {
                x = layer.x;
            }
            lines.forEach((line, i) => {
                ctx.fillText(line, x, layer.y + i * layer.fontSize * 1.2);
            });
        }
    }
    else if (layer.type === 'sphere') {
        const { cx, cy, rx, ry } = layer;
        const hiddenLineDash = [layer.lineWidth * 2, layer.lineWidth * 2];
        const equatorRy = (ry ?? rx) * 0.3;
        const meridianRx = (rx ?? ry) * 0.5;
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.ellipse(cx, cy, rx, ry, 0, 0, 2 * Math.PI);
        ctx.stroke();
        ctx.beginPath();
        ctx.ellipse(cx, cy, rx, equatorRy, 0, 0, Math.PI);
        ctx.stroke();
        ctx.setLineDash(hiddenLineDash);
        ctx.beginPath();
        ctx.ellipse(cx, cy, rx, equatorRy, 0, Math.PI, 2 * Math.PI);
        ctx.stroke();
        ctx.beginPath();
        ctx.ellipse(cx, cy, meridianRx, ry, 0, -Math.PI / 2, Math.PI / 2);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.ellipse(cx, cy, meridianRx, ry, 0, Math.PI / 2, 3 * Math.PI / 2);
        ctx.stroke();
    }
    else if (layer.type === 'cone') {
        const { cx, baseY, rx, ry, apex } = layer;
        const hiddenLineDash = [layer.lineWidth * 2, layer.lineWidth * 2];
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(cx - rx, baseY);
        ctx.lineTo(apex.x, apex.y);
        ctx.lineTo(cx + rx, baseY);
        ctx.stroke();
        ctx.beginPath();
        ctx.ellipse(cx, baseY, rx, ry, 0, 0, Math.PI);
        ctx.stroke();
        ctx.setLineDash(hiddenLineDash);
        ctx.beginPath();
        ctx.ellipse(cx, baseY, rx, ry, 0, Math.PI, 2 * Math.PI);
        ctx.stroke();
        ctx.setLineDash([]);
    }
    else if (layer.type === 'parallelepiped') {
        const { x, y, width, height, depthOffset } = layer;
        const hiddenLineDash = [layer.lineWidth * 2, layer.lineWidth * 2];
        const dx = depthOffset.x, dy = depthOffset.y;
        const p = [{ x, y }, { x: x + width, y }, { x: x + width, y: y + height }, { x, y: y + height }, { x: x + dx, y: y + dy }, { x: x + width + dx, y: y + dy }, { x: x + width + dx, y: y + height + dy }, { x: x + dx, y: y + height + dy }];
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(p[0].x, p[0].y); ctx.lineTo(p[1].x, p[1].y); ctx.lineTo(p[2].x, p[2].y); ctx.lineTo(p[3].x, p[3].y); ctx.closePath();
        ctx.moveTo(p[1].x, p[1].y); ctx.lineTo(p[5].x, p[5].y); ctx.lineTo(p[6].x, p[6].y); ctx.lineTo(p[2].x, p[2].y);
        ctx.moveTo(p[0].x, p[0].y); ctx.lineTo(p[4].x, p[4].y); ctx.lineTo(p[5].x, p[5].y);
        ctx.stroke();
        ctx.setLineDash(hiddenLineDash);
        ctx.beginPath();
        ctx.moveTo(p[3].x, p[3].y); ctx.lineTo(p[7].x, p[7].y); ctx.lineTo(p[4].x, p[4].y);
        ctx.moveTo(p[6].x, p[6].y); ctx.lineTo(p[7].x, p[7].y);
        ctx.stroke();
        ctx.setLineDash([]);
    }
    else if (layer.type === 'pyramid') {
        const { base, apex } = layer;
        const hiddenLineDash = [layer.lineWidth * 2, layer.lineWidth * 2];
        const p = [base.p1, base.p2, base.p3, base.p4];

        ctx.setLineDash(hiddenLineDash);
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
            if (layer.fillColor && layer.fillColor !== 'transparent') {
                ctx.beginPath();
                ctx.moveTo(layer.p1.x, layer.p1.y);
                ctx.lineTo(layer.p2.x, layer.p2.y);
                ctx.lineTo(layer.p3.x, layer.p3.y);
                ctx.lineTo(layer.p4.x, layer.p4.y);
                ctx.closePath();
                ctx.fillStyle = layer.fillColor;
                ctx.fill();
            }
            drawWavyPath(ctx, points, true);
        } else {
            ctx.beginPath();
            ctx.moveTo(layer.p1.x, layer.p1.y);
            ctx.lineTo(layer.p2.x, layer.p2.y);
            ctx.lineTo(layer.p3.x, layer.p3.y);
            ctx.lineTo(layer.p4.x, layer.p4.y);
            ctx.closePath();
            if (layer.fillColor && layer.fillColor !== 'transparent') {
                ctx.fillStyle = layer.fillColor;
                ctx.fill();
            }
            ctx.stroke();
        }
    }
    else if (layer.type === 'frustum') {
        const { cx, baseY, topY, rx1, ry1, rx2, ry2 } = layer;
        const hiddenLineDash = [layer.lineWidth * 2, layer.lineWidth * 2];
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(cx - rx1, baseY); ctx.lineTo(cx - rx2, topY);
        ctx.moveTo(cx + rx1, baseY); ctx.lineTo(cx + rx2, topY);
        ctx.stroke();
        ctx.beginPath();
        ctx.ellipse(cx, baseY, rx1, ry1, 0, 0, Math.PI);
        ctx.stroke();
        ctx.setLineDash(hiddenLineDash);
        ctx.beginPath();
        ctx.ellipse(cx, baseY, rx1, ry1, 0, Math.PI, 2 * Math.PI);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.ellipse(cx, topY, rx2, ry2, 0, 0, 2 * Math.PI);
        ctx.stroke();
    }
    else if (layer.type === 'truncated-sphere') {
        const { cx, cy, rx, ry, cutY, cutR, cutRy } = layer;
        const angle = Math.asin((cutY - cy) / ry);
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.ellipse(cx, cy, rx, ry, 0, angle, Math.PI - angle);
        ctx.stroke();
        ctx.beginPath();
        ctx.ellipse(cx, cutY, cutR, cutRy, 0, 0, 2 * Math.PI);
        ctx.stroke();
    }
    else if (layer.type === 'truncated-pyramid') {
        const { base, top } = layer;
        const hiddenLineDash = [layer.lineWidth * 2, layer.lineWidth * 2];
        const b = [base.p1, base.p2, base.p3, base.p4];
        const t = [top.p1, top.p2, top.p3, top.p4];

        ctx.setLineDash(hiddenLineDash);
        ctx.beginPath();
        ctx.moveTo(b[3].x, b[3].y); ctx.lineTo(b[0].x, b[0].y);
        ctx.moveTo(b[3].x, b[3].y); ctx.lineTo(b[2].x, b[2].y);
        ctx.moveTo(b[3].x, b[3].y); ctx.lineTo(t[3].x, t[3].y);
        ctx.stroke();

        ctx.setLineDash([]);
        ctx.beginPath();
        // Visible base
        ctx.moveTo(b[0].x, b[0].y); ctx.lineTo(b[1].x, b[1].y);
        ctx.moveTo(b[1].x, b[1].y); ctx.lineTo(b[2].x, b[2].y);
        // Visible top
        ctx.moveTo(t[0].x, t[0].y); ctx.lineTo(t[1].x, t[1].y);
        ctx.moveTo(t[1].x, t[1].y); ctx.lineTo(t[2].x, t[2].y);
        ctx.moveTo(t[2].x, t[2].y); ctx.lineTo(t[3].x, t[3].y);
        ctx.moveTo(t[3].x, t[3].y); ctx.lineTo(t[0].x, t[0].y);
        // Visible pillars
        ctx.moveTo(b[0].x, b[0].y); ctx.lineTo(t[0].x, t[0].y);
        ctx.moveTo(b[1].x, b[1].y); ctx.lineTo(t[1].x, t[1].y);
        ctx.moveTo(b[2].x, b[2].y); ctx.lineTo(t[2].x, t[2].y);
        ctx.stroke();
    }
    else if (layer.type === 'pdf') {
        const pageCanvas = layer.renderedPages.get(layer.currentPage);
        if (pageCanvas) {
            ctx.drawImage(pageCanvas, layer.x, layer.y, layer.width, layer.height);
        }
    }
    else if (layer.type === 'image' && layer.image instanceof HTMLImageElement && layer.image.complete) {
        ctx.drawImage(layer.image, layer.x, layer.y, layer.width, layer.height);
    }

    if (hasShadow) {
        ctx.restore();
    }

    ctx.restore();
}

export function drawSelectionBox(ctx, selectedLayers, canvasState) {
    if (!selectedLayers || selectedLayers.length === 0 || !canvasState) return;

    const isSingleSelection = selectedLayers.length === 1;
    const layer = isSingleSelection ? selectedLayers[0] : null;

    if (isSingleSelection && layer.type === 'curve') {
        const zoom = canvasState.zoom;
        const nodeSize = 8 / zoom;
        const handleSize = 6 / zoom;
        const isDarkMode = document.body.classList.contains('dark-theme');

        ctx.save();

        layer.nodes.forEach((node, i) => {
            ctx.strokeStyle = '#888';
            ctx.lineWidth = 1 / zoom;
            ctx.beginPath();
            if (node.h1) {
                ctx.moveTo(node.p.x, node.p.y);
                ctx.lineTo(node.h1.x, node.h1.y);
            }
            if (node.h2) {
                ctx.moveTo(node.p.x, node.p.y);
                ctx.lineTo(node.h2.x, node.h2.y);
            }
            ctx.stroke();

            ctx.fillStyle = '#007AFF';
            if (node.h1) {
                ctx.beginPath();
                ctx.arc(node.h1.x, node.h1.y, handleSize / 2, 0, 2 * Math.PI);
                ctx.fill();
            }
            if (node.h2) {
                ctx.beginPath();
                ctx.arc(node.h2.x, node.h2.y, handleSize / 2, 0, 2 * Math.PI);
                ctx.fill();
            }

            const isSelected = i === canvasState.selectedCurveNodeIndex;

            if (isSelected) {
                ctx.strokeStyle = '#EF4444';
                ctx.fillStyle = isDarkMode ? '#4a2d3c' : '#fee2e2';
                ctx.lineWidth = 2 / zoom;
            } else {
                ctx.strokeStyle = '#007AFF';
                ctx.fillStyle = isDarkMode ? '#1c2333' : '#FFFFFF';
                ctx.lineWidth = 1.5 / zoom;
            }
            ctx.beginPath();
            ctx.rect(node.p.x - nodeSize / 2, node.p.y - nodeSize / 2, nodeSize, nodeSize);
            ctx.fill();
            ctx.stroke();
        });

        ctx.restore();
        return;
    }

    const box = getGroupLogicalBoundingBox(selectedLayers);
    if (!box) return;

    const zoom = canvasState.zoom;
    const scaledLineWidth = 1 / zoom;
    const scaledHandleSize = 8 / zoom;
    const scaledHalfHandle = scaledHandleSize / 2;
    const scaledRotationHandleSize = 12 / zoom;
    const scaledHalfRotationHandle = scaledRotationHandleSize / 2;
    const scaledDash = [5 / zoom, 5 / zoom];

    const rotation = getSelectionRotation(selectedLayers, canvasState.groupRotation);
    const centerX = box.x + box.width / 2;
    const centerY = box.y + box.height / 2;

    let pivotX = centerX;
    let pivotY = centerY;

    if (isSingleSelection && layer && layer.pivot) {
        pivotX = centerX + layer.pivot.x;
        pivotY = centerY + layer.pivot.y;
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

    const rotationHandleY = box.y + box.height + 25 / zoom;
    const cornerX = box.x + box.width;
    const cornerY = box.y + box.height;

    ctx.beginPath();
    ctx.moveTo(cornerX, cornerY);
    ctx.lineTo(cornerX, rotationHandleY);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cornerX, rotationHandleY, scaledHalfRotationHandle, 0, 2 * Math.PI);
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
    if (!canvasState) return;
    if (canvasState.isInteracting) return;

    const { ctx, canvas, layers, selectedLayers, layersToErase, tileManager } = canvasState;

    const dpr = window.devicePixelRatio || 1;

    // Очищаем ВЕСЬ холст.
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    ctx.save();

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    ctx.scale(dpr, dpr);

    ctx.translate(canvasState.panX, canvasState.panY);
    ctx.scale(canvasState.zoom, canvasState.zoom);

    if (tileManager) {
        tileManager.drawVisibleTiles(ctx, canvasState, drawLayer);
    } else {
        layers.forEach(layer => {
            if (layersToErase.has(layer)) return;
            drawLayer(ctx, layer, canvasState);
        });
    }

    // Интерфейс выделения
    drawSelectionBox(ctx, selectedLayers, canvasState);
    ctx.restore();
}

export function drawBackground(bgCanvas, canvasState) {
    const bgCtx = bgCanvas.getContext('2d');
    const style = localStorage.getItem('boardBackgroundStyle') || 'dot';
    const theme = localStorage.getItem('boardTheme') || 'light';
    const color = theme === 'light' ? '#d1d1d1' : '#5a5a5a';
    const spacing = 20;
    const dpr = window.devicePixelRatio || 1;

    bgCtx.setTransform(1, 0, 0, 1, 0, 0);
    bgCtx.clearRect(0, 0, bgCanvas.width, bgCanvas.height);

    bgCtx.scale(dpr, dpr);

    const logicalWidth = bgCanvas.width / dpr;
    const logicalHeight = bgCanvas.height / dpr;

    if (!canvasState) {
        if (style === 'dot') {
            for (let x = 0; x < logicalWidth; x += spacing) {
                for (let y = 0; y < logicalHeight; y += spacing) {
                    bgCtx.fillStyle = color;
                    bgCtx.beginPath();
                    bgCtx.arc(x, y, 1, 0, 2 * Math.PI, false);
                    bgCtx.fill();
                }
            }
        } else {
            bgCtx.strokeStyle = color;
            bgCtx.lineWidth = 0.5;
            for (let x = 0; x < logicalWidth; x += spacing) {
                bgCtx.beginPath();
                bgCtx.moveTo(x, 0);
                bgCtx.lineTo(x, logicalHeight);
                bgCtx.stroke();
            }
            for (let y = 0; y < logicalHeight; y += spacing) {
                bgCtx.beginPath();
                bgCtx.moveTo(0, y);
                bgCtx.lineTo(logicalWidth, y);
                bgCtx.stroke();
            }
        }
        return;
    }

    const { panX, panY, zoom } = canvasState;
    // Adaptively increase spacing so background never disappears at low zoom.
    // Each doubling halves the number of drawn elements, keeping performance stable.
    let effectiveSpacing = spacing;
    while (effectiveSpacing * zoom < 5) {
        effectiveSpacing *= 2;
    }
    const visualSpacing = effectiveSpacing * zoom;

    const startX = panX % visualSpacing;
    const startY = panY % visualSpacing;

    if (style === 'dot') {
        bgCtx.fillStyle = color;
        // Use fillRect instead of arc — no beginPath/fill per dot, vastly faster
        for (let x = startX; x < logicalWidth; x += visualSpacing) {
            for (let y = startY; y < logicalHeight; y += visualSpacing) {
                bgCtx.fillRect(x - 0.5, y - 0.5, 1, 1);
            }
        }
    }
    else {
        bgCtx.strokeStyle = color;
        bgCtx.lineWidth = 0.5;
        // Batch all lines into a single path — one stroke() call
        bgCtx.beginPath();
        for (let x = startX; x < logicalWidth; x += visualSpacing) {
            bgCtx.moveTo(x, 0);
            bgCtx.lineTo(x, logicalHeight);
        }
        for (let y = startY; y < logicalHeight; y += visualSpacing) {
            bgCtx.moveTo(0, y);
            bgCtx.lineTo(logicalWidth, y);
        }
        bgCtx.stroke();
    }
}
// --- END OF FILE js/renderer.js ---