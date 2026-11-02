// --- START OF FILE js/renderer.js ---

import { getBoundingBox, getGroupBoundingBox, getGroupLogicalBoundingBox, rotatePoint, getTransformedBoundingBox, doBoxesIntersect, getRotationCenter } from './geometry.js?v=1.4.19';
import { getSelectionRotation } from './hitTest.js?v=1.4.19';
import { buildSpatialGrid, createTextImage } from './utils.js?v=1.4.19';
import { getActiveRulerForSettings } from './ui.js?v=1.4.19';
import { getPageLayout, getNotebookPageRects, getPageKeyFromRect, getPageAt, orderFilledPages } from './pages.js?v=1.4.19';
import * as rulerTools from './rulerTools.js?v=1.4.19';
import { renderFormulaImage } from './formulaLayer.js?v=1.4.19';
import { drawPlotLayer, drawPlotChrome } from './plotLayer.js?v=1.4.19';

// --- PDF navigation icon cache ---
const _pdfNavIcons = { prev: null, next: null };
function loadPdfNavIcon(key, src) {
    if (_pdfNavIcons[key]) return _pdfNavIcons[key];
    const img = new Image();
    img.src = src;
    _pdfNavIcons[key] = img;
    return img;
}
// ----------------------------------

export function drawRulers(ctx, canvasState) {
    if (!canvasState || !canvasState.rulers || canvasState.rulers.length === 0) return;
    const zoom = canvasState.zoom || 1;
    const isDarkMode = document.body.classList.contains('dark-theme');
    const scaleFactor = 1 / zoom;

    ctx.save();
    
    canvasState.rulers.forEach(ruler => {
        ctx.save();
        ctx.translate(ruler.x, ruler.y);
        ctx.rotate(ruler.angle);

        if (rulerTools.isTriangleRuler(ruler)) {
            drawTriangleRuler(ctx, ruler, isDarkMode, scaleFactor);
            ctx.restore();
            return;
        }

        if (ruler.type === 'protractor') {
            const radius = ruler.radius || 200;
            const baseH = 45; // world units
            const pivotOffset = ruler.pivotOffset || 0;
            const pivotOffsetY = ruler.pivotOffsetY || 0;

            const innerR = radius - 45; // world units
            const innerH = 10; // world units

            // Draw body (semi-transparent arched shape with a hollow center)
            let bodyColor = isDarkMode ? 'rgba(40, 40, 40, 0.8)' : 'rgba(255, 255, 255, 0.8)';
            if (ruler.color) {
                bodyColor = ruler.color + 'CC'; // 80% opacity
            }
            ctx.fillStyle = bodyColor;
            ctx.strokeStyle = isDarkMode ? '#555' : '#ccc';
            ctx.lineWidth = 1 * scaleFactor;

            ctx.beginPath();
            // 1. Outer boundary (clockwise)
            ctx.moveTo(-radius, baseH);
            ctx.lineTo(-radius, 0);
            ctx.arc(0, 0, radius, Math.PI, 0, false);
            ctx.lineTo(radius, baseH);
            ctx.closePath();

            // 2. Inner hole boundary (counter-clockwise, closed)
            ctx.moveTo(-innerR, innerH);
            ctx.lineTo(innerR, innerH);
            ctx.lineTo(innerR, 0);
            ctx.arc(0, 0, innerR, 0, Math.PI, true);
            ctx.closePath();

            ctx.fill('evenodd');
            ctx.stroke();

            // Draw base ruler reference lines on the wings
            ctx.beginPath();
            ctx.strokeStyle = isDarkMode ? '#555' : '#ccc';
            ctx.lineWidth = 1 * scaleFactor;
            ctx.moveTo(-radius, 0);
            ctx.lineTo(-innerR, 0);
            ctx.moveTo(innerR, 0);
            ctx.lineTo(radius, 0);
            ctx.stroke();

            // Draw center alignment notch at the bottom (triangle pointing down)
            // This is the reference point to align to when measuring angles
            const notchW = 6 * scaleFactor; // half-width
            const notchH = 9 * scaleFactor; // depth
            ctx.fillStyle = isDarkMode ? '#888' : '#555';
            ctx.strokeStyle = isDarkMode ? '#aaa' : '#333';
            ctx.lineWidth = 0.8 * scaleFactor;
            ctx.beginPath();
            ctx.moveTo(0, baseH);             // bottom tip (the alignment point)
            ctx.lineTo(-notchW, baseH - notchH);
            ctx.lineTo(notchW, baseH - notchH);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();

            // Center cross-hair dot at the arc origin (0,0) for precise placement
            ctx.fillStyle = isDarkMode ? '#aaa' : '#555';
            ctx.beginPath();
            ctx.arc(0, 0, 3 * scaleFactor, 0, Math.PI * 2);
            ctx.fill();

            // Draw ticks along the outer circular arc
            ctx.fillStyle = isDarkMode ? '#ccc' : '#333';
            ctx.strokeStyle = isDarkMode ? '#ccc' : '#333';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            
            const mmVisualSize = 4 / scaleFactor;
            const showMm = mmVisualSize >= 3;
            const showHalfCm = mmVisualSize * 5 >= 3;

            // 180 degrees ticks loop
            for (let deg = 0; deg <= 180; deg++) {
                const angleRad = (180 - deg) * Math.PI / 180;
                const cos = Math.cos(angleRad);
                const sin = -Math.sin(angleRad);

                let tickLen = 6 * scaleFactor;
                let drawTick = false;
                let showLabel = false;

                if (deg % 10 === 0) {
                    tickLen = 15 * scaleFactor;
                    drawTick = true;
                    showLabel = true;
                } else if (deg % 5 === 0) {
                    tickLen = 9 * scaleFactor;
                    drawTick = showHalfCm;
                } else {
                    tickLen = 5 * scaleFactor;
                    drawTick = showMm;
                }

                if (drawTick) {
                    ctx.beginPath();
                    ctx.moveTo(radius * cos, radius * sin);
                    ctx.lineTo((radius - tickLen) * cos, (radius - tickLen) * sin);
                    ctx.stroke();
                }

                if (showLabel && scaleFactor <= 3) {
                    // Dual labels
                    ctx.save();
                    ctx.font = `${10.5 * scaleFactor}px Arial`;

                    // Outer row
                    const outerDist = radius - tickLen - 9 * scaleFactor;
                    ctx.fillText((180 - deg).toString(), outerDist * cos, outerDist * sin);

                    // Inner row
                    const innerDist = radius - tickLen - 26 * scaleFactor;
                    ctx.fillStyle = isDarkMode ? '#888' : '#666';
                    ctx.fillText(deg.toString(), innerDist * cos, innerDist * sin);

                    ctx.restore();
                }
            }

            // Draw base ruler ticks along bottom edge
            const baseTickStartX = -radius;
            const maxBaseMm = Math.floor((2 * radius) / 4);
            ctx.textBaseline = 'bottom';
            ctx.font = `${12 * scaleFactor}px Arial`;

            for (let mm = 0; mm <= maxBaseMm; mm++) {
                const tx = baseTickStartX + mm * 4;
                let tickHeight = 4 * scaleFactor;
                let drawTick = false;

                if (mm % 10 === 0) {
                    tickHeight = 11 * scaleFactor;
                    drawTick = true;
                    const cmVal = mm / 10;
                    let showNumber = true;
                    if (scaleFactor > 3 && cmVal % 5 !== 0 && cmVal !== 0) showNumber = false;
                    
                    if (showNumber && scaleFactor <= 3) {
                        ctx.fillText(cmVal.toString(), tx, baseH - tickHeight - 3 * scaleFactor);
                    }
                } else if (mm % 5 === 0) {
                    tickHeight = 7 * scaleFactor;
                    drawTick = showHalfCm;
                } else {
                    tickHeight = 4 * scaleFactor;
                    drawTick = showMm;
                }

                if (drawTick) {
                    ctx.beginPath();
                    ctx.moveTo(tx, baseH);
                    ctx.lineTo(tx, baseH - tickHeight);
                    ctx.stroke();
                }
            }

            // Draw Rotate Handles and UI Buttons
            if (scaleFactor <= 3) {
                const handleY = baseH / 2;
                ctx.fillStyle = '#007AFF';
                ctx.beginPath();
                ctx.arc(-radius - 10 * scaleFactor, handleY, 8 * scaleFactor, 0, 2 * Math.PI);
                ctx.fill();
                ctx.beginPath();
                ctx.arc(radius + 10 * scaleFactor, handleY, 8 * scaleFactor, 0, 2 * Math.PI);
                ctx.fill();

                const iconSize = 18 * scaleFactor;
                const isActive = getActiveRulerForSettings() === ruler;

                if (!isActive) {
                    const btnY = -25; // world units
                    const btnXOffset = 45; // world units
                    
                    ctx.fillStyle = '#EF4444';
                    ctx.beginPath();
                    ctx.arc(-btnXOffset, btnY, iconSize / 2, 0, 2 * Math.PI);
                    ctx.fill();
                    ctx.strokeStyle = '#fff';
                    ctx.lineWidth = 2 * scaleFactor;
                    ctx.beginPath();
                    ctx.moveTo(-btnXOffset - 4 * scaleFactor, btnY - 4 * scaleFactor);
                    ctx.lineTo(-btnXOffset + 4 * scaleFactor, btnY + 4 * scaleFactor);
                    ctx.moveTo(-btnXOffset + 4 * scaleFactor, btnY - 4 * scaleFactor);
                    ctx.lineTo(-btnXOffset - 4 * scaleFactor, btnY + 4 * scaleFactor);
                    ctx.stroke();

                    ctx.fillStyle = '#6B7280';
                    ctx.beginPath();
                    ctx.arc(btnXOffset, btnY, iconSize / 2, 0, 2 * Math.PI);
                    ctx.fill();
                    ctx.fillStyle = '#fff';
                    ctx.font = `bold ${12 * scaleFactor}px sans-serif`;
                    ctx.textBaseline = 'middle';
                    ctx.textAlign = 'center';
                    ctx.fillText('⚙', btnXOffset, btnY + 1 * scaleFactor);
                }

                if (getActiveRulerForSettings() === ruler) {
                    ctx.fillStyle = '#10B981';
                    ctx.beginPath();
                    ctx.arc(pivotOffset, pivotOffsetY, 10 * scaleFactor, 0, 2 * Math.PI);
                    ctx.fill();
                    ctx.strokeStyle = '#fff';
                    ctx.lineWidth = 1.5 * scaleFactor;
                    ctx.beginPath();
                    ctx.moveTo(pivotOffset - 5 * scaleFactor, pivotOffsetY);
                    ctx.lineTo(pivotOffset + 5 * scaleFactor, pivotOffsetY);
                    ctx.moveTo(pivotOffset, pivotOffsetY - 5 * scaleFactor);
                    ctx.lineTo(pivotOffset, pivotOffsetY + 5 * scaleFactor);
                    ctx.stroke();

                    ctx.strokeStyle = 'rgba(16, 185, 129, 0.3)';
                    ctx.lineWidth = 1.5 * scaleFactor;
                    ctx.setLineDash([4 * scaleFactor, 4 * scaleFactor]);
                    
                    ctx.beginPath();
                    ctx.arc(0, 0, radius, Math.PI, 0, false);
                    ctx.stroke();
                    
                    ctx.beginPath();
                    ctx.moveTo(-radius, 0);
                    ctx.lineTo(radius, 0);
                    ctx.stroke();
                    
                    ctx.setLineDash([]);
                }
            }

            ctx.restore();
            return;
        }

        const halfL = ruler.length / 2;
        const halfW = ruler.width / 2;
        const pivotOffset = ruler.pivotOffset || 0;

        // Draw body
        let bodyColor = isDarkMode ? 'rgba(40, 40, 40, 0.8)' : 'rgba(255, 255, 255, 0.8)';
        if (ruler.color) {
            // Apply slight transparency to custom color
            bodyColor = ruler.color + 'CC'; // 80% opacity
        }
        ctx.fillStyle = bodyColor;
        ctx.strokeStyle = isDarkMode ? '#555' : '#ccc';
        ctx.lineWidth = 1 * scaleFactor;
        
        ctx.beginPath();
        const r = 5 * scaleFactor;
        if (ctx.roundRect) {
            ctx.roundRect(-halfL, -halfW, ruler.length, ruler.width, r);
        } else {
            ctx.rect(-halfL, -halfW, ruler.length, ruler.width);
        }
        ctx.fill();
        ctx.stroke();

        // Adaptive zoom logic (LOD)
        // 1 mm = 4 units. So 4 / scaleFactor gives visual pixels.
        const mmVisualSize = 4 / scaleFactor;
        const showMm = mmVisualSize >= 3;
        const showHalfCm = mmVisualSize * 5 >= 3;
        
        const padding = 10;
        const tickStartX = -halfL + padding;
        const tickLengthMax = ruler.length - 2 * padding;
        
        ctx.fillStyle = isDarkMode ? '#ccc' : '#333';
        ctx.strokeStyle = isDarkMode ? '#ccc' : '#333';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.font = `${10 * scaleFactor}px Arial`;
        
        ctx.beginPath();
        const maxMm = Math.floor(tickLengthMax / 4);
        
        for (let mm = 0; mm <= maxMm; mm++) {
            const tx = tickStartX + mm * 4;
            let tickHeight = 5; 
            let drawTick = false;
            
            if (mm % 10 === 0) {
                tickHeight = 15; // cm mark
                drawTick = true;
                const cmVal = mm / 10;
                
                // Show numbers logic
                let showNumber = true;
                if (scaleFactor > 3 && cmVal % 5 !== 0 && cmVal !== 0) showNumber = false;
                if (scaleFactor > 8 && cmVal % 10 !== 0 && cmVal !== 0) showNumber = false;
                
                if (showNumber) {
                    ctx.fillText(cmVal.toString(), tx, -halfW + tickHeight + 2);
                }
            } else if (mm % 5 === 0) {
                tickHeight = 10; // half cm mark
                drawTick = showHalfCm;
            } else {
                drawTick = showMm;
            }
            
            if (drawTick) {
                ctx.moveTo(tx, -halfW);
                ctx.lineTo(tx, -halfW + tickHeight);
                ctx.moveTo(tx, halfW);
                ctx.lineTo(tx, halfW - tickHeight);
            }
        }
        ctx.stroke();

        // Hide UI buttons if zoom is too far out
        if (scaleFactor <= 3) {
            // Draw rotate handles
            const handleColor = '#007AFF';
            ctx.fillStyle = handleColor;
            ctx.beginPath();
            ctx.arc(-halfL - 10 * scaleFactor, 0, 8 * scaleFactor, 0, 2 * Math.PI);
            ctx.fill();
            ctx.beginPath();
            ctx.arc(halfL + 10 * scaleFactor, 0, 8 * scaleFactor, 0, 2 * Math.PI);
            ctx.fill();

            const iconSize = 18 * scaleFactor;
            
            const isActive = getActiveRulerForSettings() === ruler;
            
            if (!isActive) {
                // Delete button
                ctx.fillStyle = '#EF4444';
                ctx.beginPath();
                ctx.arc(-20 * scaleFactor, 0, iconSize/2, 0, 2 * Math.PI);
                ctx.fill();
                ctx.strokeStyle = '#fff';
                ctx.lineWidth = 2 * scaleFactor;
                ctx.beginPath();
                ctx.moveTo(-20 * scaleFactor - 4 * scaleFactor, -4 * scaleFactor);
                ctx.lineTo(-20 * scaleFactor + 4 * scaleFactor, 4 * scaleFactor);
                ctx.moveTo(-20 * scaleFactor + 4 * scaleFactor, -4 * scaleFactor);
                ctx.lineTo(-20 * scaleFactor - 4 * scaleFactor, 4 * scaleFactor);
                ctx.stroke();

                // Settings button
                ctx.fillStyle = '#6B7280';
                ctx.beginPath();
                ctx.arc(20 * scaleFactor, 0, iconSize/2, 0, 2 * Math.PI);
                ctx.fill();
                ctx.fillStyle = '#fff';
                ctx.font = `bold ${12 * scaleFactor}px sans-serif`;
                ctx.textBaseline = 'middle';
                ctx.textAlign = 'center';
                ctx.fillText('⚙', 20 * scaleFactor, 1 * scaleFactor);
            }

            if (getActiveRulerForSettings() === ruler) {
                const pivotOffsetY = ruler.pivotOffsetY || 0;
                // Pivot slider
                ctx.fillStyle = '#10B981'; // Greenish
                ctx.beginPath();
                ctx.arc(pivotOffset, pivotOffsetY, 10 * scaleFactor, 0, 2 * Math.PI);
                ctx.fill();
                ctx.strokeStyle = '#fff';
                ctx.lineWidth = 1.5 * scaleFactor;
                ctx.beginPath();
                ctx.moveTo(pivotOffset - 5 * scaleFactor, pivotOffsetY);
                ctx.lineTo(pivotOffset + 5 * scaleFactor, pivotOffsetY);
                ctx.moveTo(pivotOffset, pivotOffsetY - 5 * scaleFactor);
                ctx.lineTo(pivotOffset, pivotOffsetY + 5 * scaleFactor);
                ctx.stroke();
                
                // Draw track for pivot faintly
                ctx.strokeStyle = 'rgba(16, 185, 129, 0.3)';
                ctx.lineWidth = 2 * scaleFactor;
                ctx.beginPath();
                ctx.moveTo(-halfL, pivotOffsetY);
                ctx.lineTo(halfL, pivotOffsetY);
                ctx.stroke();
            }
        }

        ctx.restore();
    });

    ctx.restore();
}

// Круглая кнопка на корпусе инструмента — та же, что у линейки и транспортира:
// красная с крестиком для удаления, серая с шестерёнкой для настроек.
function drawRulerToolButton(ctx, x, y, sf, kind) {
    ctx.fillStyle = kind === 'delete' ? '#EF4444' : '#6B7280';
    ctx.beginPath();
    ctx.arc(x, y, 9 * sf, 0, Math.PI * 2);
    ctx.fill();

    if (kind === 'delete') {
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2 * sf;
        ctx.beginPath();
        ctx.moveTo(x - 4 * sf, y - 4 * sf);
        ctx.lineTo(x + 4 * sf, y + 4 * sf);
        ctx.moveTo(x + 4 * sf, y - 4 * sf);
        ctx.lineTo(x - 4 * sf, y + 4 * sf);
        ctx.stroke();
    } else {
        ctx.fillStyle = '#fff';
        ctx.font = `bold ${12 * sf}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('⚙', x, y + 1 * sf);
    }
}

// Стрелки «наружу-внутрь» на синей ручке изменения размера.
function drawRulerScaleGlyph(ctx, x, y, ux, uy, sf) {
    const px = -uy;
    const py = ux;

    ctx.strokeStyle = '#fff';
    ctx.fillStyle = '#fff';
    ctx.lineWidth = 1.6 * sf;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x - ux * 2.5 * sf, y - uy * 2.5 * sf);
    ctx.lineTo(x + ux * 2.5 * sf, y + uy * 2.5 * sf);
    ctx.stroke();

    const arrow = (ax, ay, dirX, dirY) => {
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(ax - dirX * 4 * sf + px * 2.4 * sf, ay - dirY * 4 * sf + py * 2.4 * sf);
        ctx.lineTo(ax - dirX * 4 * sf - px * 2.4 * sf, ay - dirY * 4 * sf - py * 2.4 * sf);
        ctx.closePath();
        ctx.fill();
    };
    arrow(x + ux * 6 * sf, y + uy * 6 * sf, ux, uy);
    arrow(x - ux * 6 * sf, y - uy * 6 * sf, -ux, -uy);
    ctx.lineCap = 'butt';
}

// Угольник 45–45–90 или 30–60–90. Рисуем в локальных координатах инструмента
// (ctx уже сдвинут в (x, y) и повёрнут на angle), в том же стиле, что линейка.
function drawTriangleRuler(ctx, ruler, isDarkMode, sf) {
    const g = rulerTools.getTriangleGeometry(ruler);
    const { A, B, H, O, P, Q } = g;
    const n = g.normal;

    // --- Полупрозрачный корпус с чёткой окантовкой ---
    let bodyColor = isDarkMode ? 'rgba(40, 40, 40, 0.8)' : 'rgba(255, 255, 255, 0.8)';
    if (ruler.color) bodyColor = ruler.color + 'CC'; // 80% opacity, как у остальных

    ctx.lineJoin = 'round';
    ctx.fillStyle = bodyColor;
    ctx.strokeStyle = isDarkMode ? '#555' : '#ccc';
    ctx.lineWidth = 1 * sf;

    ctx.beginPath();
    ctx.moveTo(O.x, O.y);
    ctx.lineTo(P.x, P.y);
    ctx.lineTo(Q.x, Q.y);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // --- Деления в миллиметрах/сантиметрах ---
    // 1 см = 10 * rulerTools.MM мировых единиц. При отдалении мелкие
    // деления и подписи убираем — как у простой линейки.
    const mmVisual = rulerTools.MM / sf;
    const showMm = mmVisual >= 3;
    const showHalfCm = mmVisual * 5 >= 3;
    const showLabels = sf <= 3;
    const tickColor = isDarkMode ? '#ccc' : '#333';
    const softColor = isDarkMode ? '#888' : '#666';

    const tickLenFor = (mm) => {
        if (mm % 10 === 0) return 14 * sf;        // сантиметр
        if (mm % 5 === 0) return showHalfCm ? 9 * sf : 0;  // полсантиметра
        return showMm ? 5 * sf : 0;               // миллиметр
    };

    ctx.strokeStyle = tickColor;
    ctx.lineWidth = 1 * sf;

    ctx.beginPath();
    const stepsX = Math.floor((A - 2 * sf) / rulerTools.MM);
    for (let mm = 0; mm <= stepsX; mm++) {
        const len = tickLenFor(mm);
        if (!len) continue;
        const ts = mm * rulerTools.MM;
        const room = B * (1 - ts / A); // высота корпуса над катетом
        const l = Math.min(len, room * 0.6);
        if (l < 1) continue;
        ctx.moveTo(ts, 0);
        ctx.lineTo(ts, -l);
    }
    ctx.stroke();

    ctx.beginPath();
    const stepsY = Math.floor((B - 2 * sf) / rulerTools.MM);
    for (let mm = 0; mm <= stepsY; mm++) {
        const len = tickLenFor(mm);
        if (!len) continue;
        const ts = mm * rulerTools.MM;
        const room = A * (1 - ts / B); // ширина корпуса у второго катета
        const l = Math.min(len, room * 0.6);
        if (l < 1) continue;
        ctx.moveTo(0, -ts);
        ctx.lineTo(l, -ts);
    }
    ctx.stroke();

    // Гипотенуза: короткие деления внутрь корпуса.
    const inward = { x: -n.x, y: -n.y };
    ctx.beginPath();
    const stepsH = Math.floor((H - 2 * sf) / rulerTools.MM);
    for (let mm = 1; mm <= stepsH; mm++) {
        const len = tickLenFor(mm) * 0.75;
        if (!len) continue;
        const s = mm * rulerTools.MM;
        const px = P.x + g.tangent.x * s;
        const py = P.y + g.tangent.y * s;
        ctx.moveTo(px, py);
        ctx.lineTo(px + inward.x * len, py + inward.y * len);
    }
    ctx.stroke();

    // --- Цифры вдоль сторон ---
    // Каждая подпись проверяется по углам: она должна целиком лежать внутри
    // корпуса и не пересекаться с уже поставленными подписями. Так цифры
    // не наезжают друг на друга и не вылезают за остриё.
    if (showLabels) {
        const placedBoxes = [];
        const h = 10 * sf;

        const insideAll = (corners) => corners.every((c) => rulerTools.isPointInTriangle(c.x, c.y, g));

        const reserveBox = (corners) => {
            const pad = 1.5 * sf;
            const xs = corners.map((c) => c.x);
            const ys = corners.map((c) => c.y);
            const box = {
                x0: Math.min(...xs) - pad,
                y0: Math.min(...ys) - pad,
                x1: Math.max(...xs) + pad,
                y1: Math.max(...ys) + pad,
            };
            const overlaps = placedBoxes.some((b) =>
                !(box.x1 < b.x0 || box.x0 > b.x1 || box.y1 < b.y0 || box.y0 > b.y1));
            if (overlaps) return false;
            placedBoxes.push(box);
            return true;
        };

        ctx.fillStyle = tickColor;
        ctx.font = `${10 * sf}px Arial`;
        ctx.textAlign = 'center';

        // Нижний катет.
        ctx.textBaseline = 'bottom';
        for (let cm = 1; cm <= 100; cm++) {
            const ts = cm * 10 * rulerTools.MM;
            if (ts > A) break;
            const txt = String(cm);
            const w = ctx.measureText(txt).width;
            const corners = [
                { x: ts - w / 2, y: -17 * sf }, { x: ts + w / 2, y: -17 * sf },
                { x: ts - w / 2, y: -17 * sf - h }, { x: ts + w / 2, y: -17 * sf - h },
            ];
            if (!insideAll(corners) || !reserveBox(corners)) continue;
            ctx.fillText(txt, ts, -17 * sf);
        }

        // Второй катет: цифры повёрнуты вдоль стороны.
        for (let cm = 1; cm <= 100; cm++) {
            const ts = cm * 10 * rulerTools.MM;
            if (ts > B) break;
            const txt = String(cm);
            const w = ctx.measureText(txt).width;
            // После поворота на -90°: x — от 17sf до 17sf + h, y — вокруг -ts.
            const corners = [
                { x: 17 * sf, y: -ts - w / 2 }, { x: 17 * sf + h, y: -ts - w / 2 },
                { x: 17 * sf, y: -ts + w / 2 }, { x: 17 * sf + h, y: -ts + w / 2 },
            ];
            if (!insideAll(corners) || !reserveBox(corners)) continue;
            ctx.save();
            ctx.translate(17 * sf, -ts);
            ctx.rotate(-Math.PI / 2);
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';
            ctx.fillText(txt, 0, 0);
            ctx.restore();
        }

        // Гипотенуза: цифры идут от вершины P вдоль стороны.
        const along = Math.atan2(B, A); // направление от Q к P
        const ux = Math.cos(along);
        const uy = Math.sin(along);
        for (let cm = 1; cm <= 100; cm++) {
            const s = cm * 10 * rulerTools.MM;
            if (s > H) break;
            const txt = String(cm);
            const w = ctx.measureText(txt).width;
            const ox = P.x + g.tangent.x * s + inward.x * 16 * sf;
            const oy = P.y + g.tangent.y * s + inward.y * 16 * sf;
            const corners = [];
            for (const sw of [-w / 2, w / 2]) {
                for (const sh of [0, h]) {
                    corners.push({ x: ox + ux * sw + inward.x * sh, y: oy + uy * sw + inward.y * sh });
                }
            }
            if (!insideAll(corners) || !reserveBox(corners)) continue;
            ctx.save();
            ctx.translate(ox, oy);
            ctx.rotate(along);
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';
            ctx.fillText(txt, 0, 0);
            ctx.restore();
        }

        // --- Подписи углов: 90° и два фиксированных ---
        ctx.fillStyle = softColor;
        ctx.font = `${11 * sf}px Arial`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const ah = 11 * sf;
        rulerTools.getTriangleAngleLabels(ruler).forEach((label) => {
            const w = ctx.measureText(label.text).width;
            const corners = [
                { x: label.x - w / 2, y: label.y - ah / 2 }, { x: label.x + w / 2, y: label.y - ah / 2 },
                { x: label.x - w / 2, y: label.y + ah / 2 }, { x: label.x + w / 2, y: label.y + ah / 2 },
            ];
            if (!insideAll(corners)) return;
            if (!reserveBox(corners)) return;
            ctx.fillText(label.text, label.x, label.y);
        });
    }

    // Дальше — только экранные элементы управления, как у линейки:
    // при сильном отдалении они прячутся.
    if (sf > 3) return;

    const handles = rulerTools.getTriangleHandles(ruler, sf);
    const isActive = getActiveRulerForSettings() === ruler;

    // Ручки поворота на концах катетов.
    ctx.fillStyle = '#007AFF';
    ctx.beginPath();
    ctx.arc(handles.rotateP.x, handles.rotateP.y, 8 * sf, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(handles.rotateQ.x, handles.rotateQ.y, 8 * sf, 0, Math.PI * 2);
    ctx.fill();

    // Ручка изменения размера на середине гипотенузы.
    ctx.fillStyle = '#007AFF';
    ctx.beginPath();
    ctx.arc(handles.resize.x, handles.resize.y, 9 * sf, 0, Math.PI * 2);
    ctx.fill();
    drawRulerScaleGlyph(ctx, handles.resize.x, handles.resize.y, n.x, n.y, sf);

    if (!isActive) {
        drawRulerToolButton(ctx, handles.delete.x, handles.delete.y, sf, 'delete');
        drawRulerToolButton(ctx, handles.settings.x, handles.settings.y, sf, 'settings');
    } else {
        // Активный инструмент подсвечивается зелёным пунктиром — как транспортир.
        ctx.strokeStyle = 'rgba(16, 185, 129, 0.3)';
        ctx.lineWidth = 1.5 * sf;
        ctx.setLineDash([4 * sf, 4 * sf]);
        ctx.beginPath();
        ctx.moveTo(O.x, O.y);
        ctx.lineTo(P.x, P.y);
        ctx.lineTo(Q.x, Q.y);
        ctx.closePath();
        ctx.stroke();
        ctx.setLineDash([]);
    }
}

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


let entityDecoder = null;
function decodeHTMLEntities(text) {
    if (!entityDecoder) {
        entityDecoder = document.createElement('textarea');
    }
    entityDecoder.innerHTML = text;
    return entityDecoder.value;
}

function wrapParagraph(ctx, text, maxWidth) {
    const lines = [];
    let currentLine = '';
    const tokens = text.split(/(\s+)/);
    
    for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i];
        if (!token) continue;
        
        if (/^\s+$/.test(token)) {
            currentLine += token;
            continue;
        }
        
        const testLine = currentLine + token;
        if (ctx.measureText(testLine).width <= maxWidth) {
            currentLine = testLine;
        } else {
            if (currentLine.trimEnd()) {
                lines.push(currentLine.trimEnd());
            }
            currentLine = '';
            
            if (ctx.measureText(token).width <= maxWidth) {
                currentLine = token;
            } else {
                let tempToken = token;
                while (tempToken.length > 0) {
                    let cutIndex = 0;
                    let low = 1;
                    let high = tempToken.length;
                    
                    while (low <= high) {
                        const mid = Math.floor((low + high) / 2);
                        const testPart = tempToken.slice(0, mid);
                        if (ctx.measureText(testPart).width <= maxWidth) {
                            cutIndex = mid;
                            low = mid + 1;
                        } else {
                            high = mid - 1;
                        }
                    }
                    
                    if (cutIndex === 0) {
                        cutIndex = 1;
                    }
                    
                    const part = tempToken.slice(0, cutIndex);
                    
                    if (tempToken.length === token.length) {
                        lines.push(part);
                    } else {
                        if (tempToken.slice(cutIndex).length > 0) {
                            lines.push(part);
                        } else {
                            currentLine = part;
                        }
                    }
                    tempToken = tempToken.slice(cutIndex);
                }
            }
        }
    }
    
    if (currentLine.trimEnd()) {
        lines.push(currentLine.trimEnd());
    }
    
    return lines;
}

function wrapText(ctx, text, maxWidth) {
    const paragraphs = text.split('\n');
    const allLines = [];
    
    paragraphs.forEach(para => {
        const wrapped = wrapParagraph(ctx, para, maxWidth);
        if (wrapped.length === 0) {
            allLines.push('');
        } else {
            allLines.push(...wrapped);
        }
    });
    
    return allLines;
}


export function drawLayer(ctx, layer, canvasState) {
    if (!layer) return;
    if (layer.isEditing) return;

    if (layer.parentId) {
        if (!layer._parentRef && canvasState && canvasState.layers) {
            // Кэш нельзя инвалидировать только по длине: после undo/redo массив
            // заменяется объектами с теми же id, и старая Map выдала бы ссылки
            // на уже не существующие объекты.
            if (!canvasState._layersMap ||
                canvasState._layersMapSource !== canvasState.layers ||
                canvasState._layersMapSize !== canvasState.layers.length) {
                canvasState._layersMap = new Map(canvasState.layers.map(l => [l.id, l]));
                canvasState._layersMapSource = canvasState.layers;
                canvasState._layersMapSize = canvasState.layers.length;
            }
            layer._parentRef = canvasState._layersMap.get(layer.parentId);
        }
        if (layer._parentRef && layer._parentRef.type === 'pdf') {
            if (layer._parentRef.currentPage !== layer.parentPage) {
                return;
            }
        }
        if (layer._parentRef && layer._parentRef.type === 'sticker') {
            if (!canvasState || !canvasState.isLocalRender) {
                return;
            }
        }
    }
    
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
    else if (layer.type === 'line' || layer.type === 'arrow') {
        if (layer.lineStyle === 'wavy') {
            const points = [{ x: layer.x1, y: layer.y1 }, { x: layer.x2, y: layer.y2 }];
            drawWavyPath(ctx, points, false);
        } else {
            ctx.beginPath();
            ctx.moveTo(layer.x1, layer.y1);
            ctx.lineTo(layer.x2, layer.y2);
            ctx.stroke();
        }

        if (layer.type === 'arrow') {
            const angle = Math.atan2(layer.y2 - layer.y1, layer.x2 - layer.x1);
            const barbLength = Math.max(12, Math.min(25, Math.hypot(layer.x2 - layer.x1, layer.y2 - layer.y1) * 0.2));
            const barbAngle = 30 * Math.PI / 180;

            ctx.beginPath();
            ctx.moveTo(layer.x2 - barbLength * Math.cos(angle - barbAngle), layer.y2 - barbLength * Math.sin(angle - barbAngle));
            ctx.lineTo(layer.x2, layer.y2);
            ctx.lineTo(layer.x2 - barbLength * Math.cos(angle + barbAngle), layer.y2 - barbLength * Math.sin(angle + barbAngle));
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
    else if (layer.type === 'formula') {
        // Формула рисуется так же, как текст: готовый растр в рамке слоя.
        const image = layer.cachedImage;
        const ready = image && (
            (typeof ImageBitmap !== 'undefined' && image instanceof ImageBitmap) ||
            (image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0)
        );
        if (ready) {
            ctx.drawImage(image, layer.x, layer.y, layer.width, layer.height);
        } else if (!layer.isGeneratingFormula && (!canvasState || !canvasState.isInteracting)) {
            layer.isGeneratingFormula = true;
            renderFormulaImage(layer).then((img) => {
                layer.isGeneratingFormula = false;
                layer.cachedImage = img;
                if (canvasState && canvasState.tileManager) canvasState.tileManager.invalidateLayer(layer, canvasState);
                if (canvasState && canvasState.redraw) canvasState.redraw();
            });
        }
    }
    else if (layer.type === 'plot') {
        const theme = (document.body && document.body.classList.contains('dark-theme')) ? 'dark' : 'light';
        drawPlotLayer(ctx, layer, theme);
    }
    else if (layer.type === 'text') {
        // Не рисуем текст на canvas, если он сейчас редактируется через DOM-редактор
        if (layer.isEditing) return;
        
        // Проверяем, что cachedImage существует, загружен и имеет размер
        if (layer.cachedImage && (layer.cachedImage instanceof HTMLImageElement || layer.cachedImage instanceof ImageBitmap) && layer.cachedImage.complete && layer.cachedImage.naturalWidth !== 0) {
            ctx.drawImage(layer.cachedImage, layer.x, layer.y, layer.width, layer.height);
        } else {
            // Fallback: если картинки нет, пробуем сгенерировать, но не блокируем отрисовку (не генерируем при перетаскивании/масштабировании)
            if (!layer.isGeneratingImage && !layer.isEditing && (!canvasState || !canvasState.isInteracting)) {
                layer.isGeneratingImage = true;
                createTextImage(layer).then(img => {
                    layer.cachedImage = img;
                    layer.isGeneratingImage = false;
                    if (canvasState) {
                        if (canvasState.tileManager) canvasState.tileManager.invalidateLayer(layer, canvasState);
                        if (canvasState.redraw) canvasState.redraw();
                    }
                }).catch(e => {
                    layer.isGeneratingImage = false;
                });
            }

            // Рисуем текст через стандартный API для временного отображения с переносом строк
            const PADDING = 10;
            const lineHeight = layer.fontSize * 1.2;
            const maxW = Math.max(1, layer.width - PADDING * 2);

            const fontWeight = layer.fontWeight || 'normal';
            const fontStyle = layer.fontStyle || 'normal';
            ctx.font = `${fontStyle} ${fontWeight} ${layer.fontSize}px ${layer.fontFamily || "'Roboto', sans-serif"}`;
            ctx.textBaseline = 'top';
            ctx.textAlign = layer.align || 'left';
            ctx.fillStyle = layer.color;

            // Разбираем HTML контент с сохранением абзацев
            let plainText = '';
            if (layer.content) {
                let text = layer.content
                    .replace(/<\/p>/gi, '\n')
                    .replace(/<\/div>/gi, '\n')
                    .replace(/<br\s*\/?>/gi, '\n');
                text = text.replace(/<[^>]*>?/gm, '');
                plainText = decodeHTMLEntities(text);
            }

            const lines = wrapText(ctx, plainText, maxW);
            
            // Вычисляем и обновляем высоту слоя в реальном времени, чтобы selection box
            // адаптировался под новую высоту рамки текста
            const calculatedHeight = lines.length * lineHeight + PADDING * 2;
            if (calculatedHeight > 10) {
                layer.height = calculatedHeight;
            }

            let drawX;
            if (layer.align === 'center') {
                drawX = layer.x + layer.width / 2;
            } else if (layer.align === 'right') {
                drawX = layer.x + layer.width - PADDING;
            } else {
                drawX = layer.x + PADDING;
            }

            lines.forEach((line, i) => {
                ctx.fillText(line, drawX, layer.y + PADDING + i * lineHeight);
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
        const pageCanvas = layer.renderedPages ? layer.renderedPages.get(layer.currentPage) : null;
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
    if (!canvasState) return;

    // Draw red dashed border around the locked parent PDF/image if in annotation editing mode
    if (canvasState.editingAnnotationsLayerId) {
        const parentLayer = canvasState.layers.find(l => l.id === canvasState.editingAnnotationsLayerId);
        if (parentLayer && parentLayer.type !== 'sticker') {
            const parentBox = getGroupLogicalBoundingBox([parentLayer]);
            if (parentBox) {
                const parentRotation = parentLayer.rotation || 0;
                const parentCenterX = parentBox.x + parentBox.width / 2;
                const parentCenterY = parentBox.y + parentBox.height / 2;
                let parentPivotX = parentCenterX;
                let parentPivotY = parentCenterY;
                if (parentLayer.pivot) {
                    parentPivotX = parentCenterX + parentLayer.pivot.x;
                    parentPivotY = parentCenterY + parentLayer.pivot.y;
                }
                ctx.save();
                ctx.translate(parentPivotX, parentPivotY);
                ctx.rotate(parentRotation);
                ctx.translate(-parentPivotX, -parentPivotY);

                ctx.strokeStyle = '#EF4444';
                ctx.lineWidth = 1 / canvasState.zoom;
                ctx.setLineDash([5 / canvasState.zoom, 5 / canvasState.zoom]);
                ctx.strokeRect(parentBox.x, parentBox.y, parentBox.width, parentBox.height);
                ctx.restore();
            }
        }
    }

    if (!selectedLayers || selectedLayers.length === 0) return;

    const displayLayers = selectedLayers.filter(l => l && l.type !== 'sticker');
    if (displayLayers.length === 0) return;

    const isSingleSelection = displayLayers.length === 1;
    const layer = isSingleSelection ? displayLayers[0] : null;

    if (isSingleSelection && layer && canvasState.editingAnnotationsLayerId === layer.id) {
        return;
    }

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

    const box = getGroupLogicalBoundingBox(displayLayers);
    if (!box) return;

    const zoom = canvasState.zoom;
    const scaledLineWidth = 1 / zoom;
    const scaledHandleSize = 8 / zoom;
    const scaledHalfHandle = scaledHandleSize / 2;
    const scaledRotationHandleSize = 12 / zoom;
    const scaledHalfRotationHandle = scaledRotationHandleSize / 2;
    const scaledDash = [5 / zoom, 5 / zoom];

    const rotation = getSelectionRotation(displayLayers, canvasState.groupRotation);
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

    const isEditingModeActive = canvasState.editingAnnotationsLayerId && isSingleSelection && layer && layer.id === canvasState.editingAnnotationsLayerId;
    ctx.strokeStyle = isEditingModeActive ? '#EF4444' : '#007AFF';
    ctx.lineWidth = scaledLineWidth;
    ctx.setLineDash(scaledDash);
    ctx.strokeRect(box.x, box.y, box.width, box.height);
    ctx.setLineDash([]);
    ctx.fillStyle = '#007AFF';

    const handles = isEditingModeActive ? [] : [
        { x: box.x, y: box.y }, { x: centerX, y: box.y }, { x: box.x + box.width, y: box.y },
        { x: box.x, y: centerY }, { x: box.x + box.width, y: centerY },
        { x: box.x, y: box.y + box.height }, { x: centerX, y: box.y + box.height }, { x: box.x + box.width, y: box.y + box.height }
    ];
    handles.forEach(handle => {
        ctx.fillRect(handle.x - scaledHalfHandle, handle.y - scaledHalfHandle, scaledHandleSize, scaledHandleSize);
    });

    if (!isEditingModeActive) {
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
    }

    ctx.restore();

    const pivotlessSelection = isSingleSelection && layer && (layer.type === 'formula' || layer.type === 'plot');
    if (isSingleSelection && !isEditingModeActive && !pivotlessSelection) {
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

    // --- Overlay: Ghost Navigation Buttons для PDF (поверх тайлов, в экранном масштабе) ---
    const zoom = canvasState.zoom;
    layers.forEach(layer => {
        if (layer.type !== 'pdf' || !layer.numPages || layer.numPages <= 1) return;
        if (layersToErase.has(layer)) return;
        const pageCanvas = layer.renderedPages ? layer.renderedPages.get(layer.currentPage) : null;
        if (!pageCanvas) return;

        ctx.save();
        const rotation = layer.rotation || 0;
        if (rotation) {
            const cx = layer.x + layer.width / 2 + (layer.pivot ? layer.pivot.x : 0);
            const cy = layer.y + layer.height / 2 + (layer.pivot ? layer.pivot.y : 0);
            ctx.translate(cx, cy);
            ctx.rotate(rotation);
            ctx.translate(-cx, -cy);
        }

        const btnSize = 24 / zoom;
        const padding = 6 / zoom;

        const rightX = layer.x + layer.width - btnSize - padding;
        const leftX = rightX - btnSize - padding;
        const btnY = layer.y + layer.height - btnSize - padding;

        ctx.setLineDash([]);

        const prevIcon = loadPdfNavIcon('prev', 'icons_bord/icon-previouspage.webp');
        const nextIcon = loadPdfNavIcon('next', 'icons_bord/icon-nextpage.webp');

        // < button
        ctx.globalAlpha = layer.currentPage === 1 ? 0.15 : 0.45;
        ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
        ctx.beginPath();
        if (ctx.roundRect) { ctx.roundRect(leftX, btnY, btnSize, btnSize, 4 / zoom); }
        else { ctx.rect(leftX, btnY, btnSize, btnSize); }
        ctx.fill();
        if (prevIcon.complete && prevIcon.naturalWidth > 0) {
            const pad = btnSize * 0.15;
            ctx.globalAlpha = layer.currentPage === 1 ? 0.15 : 0.9;
            ctx.drawImage(prevIcon, leftX + pad, btnY + pad, btnSize - pad * 2, btnSize - pad * 2);
        } else {
            ctx.fillStyle = 'white';
            ctx.font = `bold ${14 / zoom}px Arial`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('‹', leftX + btnSize / 2, btnY + btnSize / 2);
        }

        // > button
        ctx.globalAlpha = layer.currentPage === layer.numPages ? 0.15 : 0.45;
        ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
        ctx.beginPath();
        if (ctx.roundRect) { ctx.roundRect(rightX, btnY, btnSize, btnSize, 4 / zoom); }
        else { ctx.rect(rightX, btnY, btnSize, btnSize); }
        ctx.fill();
        if (nextIcon.complete && nextIcon.naturalWidth > 0) {
            const pad = btnSize * 0.15;
            ctx.globalAlpha = layer.currentPage === layer.numPages ? 0.15 : 0.9;
            ctx.drawImage(nextIcon, rightX + pad, btnY + pad, btnSize - pad * 2, btnSize - pad * 2);
        } else {
            ctx.fillStyle = 'white';
            ctx.font = `bold ${14 / zoom}px Arial`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('›', rightX + btnSize / 2, btnY + btnSize / 2);
        }

        ctx.restore();
    });

    if (!canvasState.oCtx) {
        drawRulers(ctx, canvasState);
        drawSelectionBox(ctx, selectedLayers, canvasState);
        drawPlotChrome(ctx, canvasState);
    }
    ctx.restore();

    // Линейки и рамка выделения — на отдельном прозрачном слое выше стикеров.
    const oCtx = canvasState.oCtx;
    const overlayCanvas = canvasState.overlayCanvas;
    if (oCtx && overlayCanvas) {
        oCtx.setTransform(1, 0, 0, 1, 0, 0);
        oCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
        oCtx.save();
        oCtx.scale(dpr, dpr);
        oCtx.translate(canvasState.panX, canvasState.panY);
        oCtx.scale(canvasState.zoom, canvasState.zoom);
        drawRulers(oCtx, canvasState);
        drawSelectionBox(oCtx, selectedLayers, canvasState);
        drawPlotChrome(oCtx, canvasState);
        drawOffPageHighlights(oCtx, canvasState);
        oCtx.restore();
    }

    if (canvasState.syncTextEditorWithCanvas) {
        canvasState.syncTextEditorWithCanvas(canvasState);
    }
}

export function drawBackground(bgCanvas, canvasState) {
    const bgCtx = bgCanvas.getContext('2d');
    const style = localStorage.getItem('boardBackgroundStyle') || 'grid';
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

    if (canvasState.canvasMode === 'notebook') {
        drawNotebookBackground(bgCtx, canvasState, logicalWidth, logicalHeight, style, color, theme);
        return;
    }

    // Adaptively increase spacing so background never disappears at low zoom.
    // Each doubling halves the number of drawn elements, keeping performance stable.
    let effectiveSpacing = spacing;
    while (effectiveSpacing * zoom < 5) {
        effectiveSpacing *= 2;
    }
    const visualSpacing = effectiveSpacing * zoom;

    const startX = panX % visualSpacing;
    const startY = panY % visualSpacing;

    if (style === 'lined') {
        let lineStep = 24;
        while (lineStep * zoom < 8) lineStep *= 2;
        const visualLine = lineStep * zoom;
        const slantStep = Math.max(28, 72 * zoom);
        const slant = Math.tan(65 * Math.PI / 180);
        const startLineY = panY % visualLine;

        bgCtx.strokeStyle = 'rgba(96, 165, 250, 0.40)';
        bgCtx.lineWidth = 0.8;
        bgCtx.beginPath();
        for (let y = startLineY; y < logicalHeight; y += visualLine) {
            bgCtx.moveTo(0, y);
            bgCtx.lineTo(logicalWidth, y);
        }
        bgCtx.stroke();

        bgCtx.strokeStyle = 'rgba(96, 165, 250, 0.20)';
        bgCtx.beginPath();
        for (let offset = (panX % slantStep) - logicalHeight * slant; offset < logicalWidth; offset += slantStep) {
            bgCtx.moveTo(offset, logicalHeight);
            bgCtx.lineTo(offset + logicalHeight * slant, 0);
        }
        bgCtx.stroke();
    }
    else if (style === 'dot') {
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

    drawPageGuides(bgCtx, canvasState, logicalWidth, logicalHeight);
}

function drawPageGrid(ctx, x, y, width, height, style, color, zoom) {
    let step = 20;
    while (step * zoom < 8) step *= 2;
    const visualStep = step * zoom;
    if (visualStep < 4) return;

    if (style === 'lined') {
        // Тетрадь в линейку: горизонтальные строки и наклонные направляющие.
        const lineStep = Math.max(10, 24 * zoom);
        const slantStep = Math.max(28, 72 * zoom);
        const slant = Math.tan(65 * Math.PI / 180);
        ctx.strokeStyle = 'rgba(96, 165, 250, 0.45)';
        ctx.lineWidth = 0.8;

        ctx.beginPath();
        for (let py = y + lineStep; py < y + height; py += lineStep) {
            ctx.moveTo(x, py);
            ctx.lineTo(x + width, py);
        }
        ctx.stroke();

        ctx.strokeStyle = 'rgba(96, 165, 250, 0.26)';
        ctx.beginPath();
        for (let offset = x - height * slant; offset <= x + width; offset += slantStep) {
            ctx.moveTo(offset, y + height);
            ctx.lineTo(offset + height * slant, y);
        }
        ctx.stroke();
        return;
    }

    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 0.5;

    if (style === 'dot') {
        for (let px = x; px <= x + width; px += visualStep) {
            for (let py = y; py <= y + height; py += visualStep) {
                ctx.fillRect(px - 0.5, py - 0.5, 1, 1);
            }
        }
        return;
    }

    ctx.beginPath();
    for (let px = x; px <= x + width; px += visualStep) {
        ctx.moveTo(px, y);
        ctx.lineTo(px, y + height);
    }
    for (let py = y; py <= y + height; py += visualStep) {
        ctx.moveTo(x, py);
        ctx.lineTo(x + width, py);
    }
    ctx.stroke();
}

function getPageOrderMap(state) {
    const boxes = [];
    (state.layers || []).forEach(layer => {
        if (layer.isEditing) return;
        const box = getBoundingBox(layer);
        if (box) boxes.push(box);
    });
    const app = window.stickerApp;
    if (app && Array.isArray(app.stickers)) {
        app.stickers.forEach(s => boxes.push({ x: s.x, y: s.y, width: s.w, height: s.h }));
    }
    const map = new Map();
    orderFilledPages(boxes, getPageLayout(state)).forEach(page => {
        map.set(getPageKeyFromRect(page), page.order);
    });
    return map;
}

function drawNotebookBackground(ctx, state, logicalWidth, logicalHeight, style, color, theme) {
    const dark = theme === 'dark';
    const layout = getPageLayout(state);
    const zoom = state.zoom || 1;
    const panX = state.panX || 0;
    const panY = state.panY || 0;
    const pageOrder = getPageOrderMap(state);

    ctx.fillStyle = dark ? '#141a24' : '#e8ecf2';
    ctx.fillRect(0, 0, logicalWidth, logicalHeight);

    getNotebookPageRects(state, logicalHeight).forEach(page => {
        const x = panX + page.x * zoom;
        const y = panY + page.y * zoom;
        const width = page.width * zoom;
        const height = page.height * zoom;
        if (y > logicalHeight || y + height < 0 || x > logicalWidth || x + width < 0) return;

        // Тень и лист
        ctx.fillStyle = dark ? 'rgba(0, 0, 0, 0.45)' : 'rgba(40, 52, 70, 0.16)';
        ctx.fillRect(x + 2, y + 3, width, height);

        ctx.fillStyle = dark ? '#273142' : '#ffffff';
        ctx.fillRect(x, y, width, height);

        // Клетка/линейка только внутри листа
        ctx.save();
        ctx.beginPath();
        ctx.rect(x, y, width, height);
        ctx.clip();
        drawPageGrid(ctx, x, y, width, height, style, dark ? '#3b4658' : '#dfe3e8', zoom);
        ctx.restore();

        if (state.showPageGuides !== false) {
            ctx.strokeStyle = dark ? 'rgba(255,255,255,0.12)' : 'rgba(30, 41, 59, 0.16)';
            ctx.lineWidth = 1;
            ctx.strokeRect(x + 0.5, y + 0.5, Math.max(0, width - 1), Math.max(0, height - 1));
        }

        const order = pageOrder.get(getPageKeyFromRect(page));
        if (order && width > 60 && height > 40) {
            ctx.fillStyle = dark ? '#6b7280' : '#94a3b8';
            ctx.font = '12px Arial, sans-serif';
            ctx.textAlign = 'right';
            ctx.textBaseline = 'bottom';
            ctx.fillText(String(order), x + width - 10, y + height - 8);
        }
    });
}

function drawPageGuides(ctx, state, logicalWidth, logicalHeight) {
    if (!state || state.canvasMode !== 'infinite' || state.showPageGuides === false) return;
    const layout = getPageLayout(state);
    const zoom = state.zoom || 1;
    const panX = state.panX || 0;
    const panY = state.panY || 0;
    const dark = document.body.classList.contains('dark-theme');

    ctx.save();
    ctx.strokeStyle = dark ? 'rgba(148, 163, 184, 0.18)' : 'rgba(100, 116, 139, 0.18)';
    ctx.lineWidth = 1;

    // Вертикальные и горизонтальные границы страниц.
    const leftWorld = -panX / zoom;
    const rightWorld = (logicalWidth - panX) / zoom;
    const topWorld = -panY / zoom;
    const bottomWorld = (logicalHeight - panY) / zoom;
    const startCol = Math.floor(leftWorld / layout.width) - 1;
    const endCol = Math.floor(rightWorld / layout.width) + 1;
    const startRow = Math.floor(topWorld / layout.height) - 1;
    const endRow = Math.floor(bottomWorld / layout.height) + 1;

    for (let col = startCol; col <= endCol; col++) {
        const x = panX + col * layout.width * zoom;
        if (x < 0 || x > logicalWidth) continue;
        ctx.beginPath();
        ctx.moveTo(x + 0.5, 0);
        ctx.lineTo(x + 0.5, logicalHeight);
        ctx.stroke();
    }
    for (let row = startRow; row <= endRow; row++) {
        const y = panY + row * layout.height * zoom;
        if (y < 0 || y > logicalHeight) continue;
        ctx.beginPath();
        ctx.moveTo(0, y + 0.5);
        ctx.lineTo(logicalWidth, y + 0.5);
        ctx.stroke();
    }

    ctx.restore();
}

// Объекты, оказавшиеся вне листов, не скрываем — только помечаем янтарной рамкой.
export function drawOffPageHighlights(ctx, state) {
    if (!state || state.canvasMode !== 'notebook') return;
    const layout = getPageLayout(state);
    const zoom = state.zoom || 1;

    ctx.save();
    ctx.setLineDash([6 / zoom, 4 / zoom]);
    ctx.lineWidth = 1.5 / zoom;
    ctx.strokeStyle = 'rgba(245, 158, 11, 0.95)';

    (state.layers || []).forEach(layer => {
        if (layer.isEditing) return;
        const box = getBoundingBox(layer);
        if (!box) return;
        const page = getPageAt({ x: box.x + box.width / 2, y: box.y + box.height / 2 }, layout);
        if (!page) return;
        const inside = box.x >= page.x &&
            box.x + box.width <= page.x + page.width &&
            box.y >= page.y &&
            box.y + box.height <= page.y + page.height;
        if (inside) return;
        const pad = 3 / zoom;
        ctx.strokeRect(box.x - pad, box.y - pad, box.width + pad * 2, box.height + pad * 2);
    });
    ctx.restore();
}
// --- END OF FILE js/renderer.js ---


export function drawLoadingPlaceholders(ctx, loadingFiles, canvasState) {
    if (!loadingFiles || loadingFiles.length === 0) return;

    ctx.save();
    const dpr = window.devicePixelRatio || 1;
    ctx.scale(dpr, dpr);
    ctx.translate(canvasState.panX, canvasState.panY);
    const zoom = canvasState.zoom || 1;
    ctx.scale(zoom, zoom);
    
    const time = Date.now();
    const pulse = 0.5 + 0.15 * Math.sin(time / 400);
    const isDark = document.body.classList.contains('dark-theme');

    loadingFiles.forEach(file => {
        const w = file.width;
        const h = file.height;
        const cx = w / 2;
        const cy = h / 2;
        const r = Math.min(12 / zoom, Math.min(w, h) * 0.05); // corner radius

        ctx.save();
        ctx.translate(file.x, file.y);

        // --- Rounded rectangle path ---
        ctx.beginPath();
        ctx.moveTo(r, 0);
        ctx.lineTo(w - r, 0);
        ctx.quadraticCurveTo(w, 0, w, r);
        ctx.lineTo(w, h - r);
        ctx.quadraticCurveTo(w, h, w - r, h);
        ctx.lineTo(r, h);
        ctx.quadraticCurveTo(0, h, 0, h - r);
        ctx.lineTo(0, r);
        ctx.quadraticCurveTo(0, 0, r, 0);
        ctx.closePath();

        // --- Fill: subtle gradient ---
        const bgAlpha = isDark ? 0.15 : 0.06;
        const grad = ctx.createLinearGradient(0, 0, w, h);
        grad.addColorStop(0, `rgba(99, 140, 255, ${bgAlpha})`);
        grad.addColorStop(1, `rgba(160, 120, 255, ${bgAlpha})`);
        ctx.fillStyle = grad;
        ctx.fill();

        // --- Dashed border ---
        const borderAlpha = isDark ? (pulse * 0.6) : (pulse * 0.45);
        ctx.strokeStyle = `rgba(99, 140, 255, ${borderAlpha})`;
        ctx.lineWidth = 1.5 / zoom;
        ctx.setLineDash([8 / zoom, 6 / zoom]);
        ctx.stroke();
        ctx.setLineDash([]);

        // --- Spinner ring ---
        const spinnerR = Math.min(w, h) * 0.07;
        const spinnerY = cy - 14 / zoom;
        if (spinnerR > 5 / zoom) {
            const angle = (time / 600) * Math.PI * 2;
            const arcLen = Math.PI * 1.2;

            // Track (faded ring)
            ctx.beginPath();
            ctx.arc(cx, spinnerY, spinnerR, 0, Math.PI * 2);
            ctx.strokeStyle = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(99, 140, 255, 0.12)';
            ctx.lineWidth = 2.5 / zoom;
            ctx.lineCap = 'round';
            ctx.stroke();

            // Active arc
            ctx.beginPath();
            ctx.arc(cx, spinnerY, spinnerR, angle, angle + arcLen);
            ctx.strokeStyle = `rgba(99, 140, 255, ${0.6 + 0.2 * Math.sin(time / 300)})`;
            ctx.lineWidth = 2.5 / zoom;
            ctx.lineCap = 'round';
            ctx.stroke();
        }

        // --- Label ---
        const fontSize = Math.max(Math.min(14 / zoom, h * 0.06), 9);
        ctx.fillStyle = isDark ? `rgba(180, 200, 255, 0.75)` : `rgba(70, 100, 180, 0.7)`;
        ctx.font = `500 ${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        const labelY = spinnerR > 5 / zoom ? spinnerY + spinnerR + 8 / zoom : cy - fontSize / 2;
        ctx.fillText(file.name, cx, labelY);

        // --- File type icon above spinner ---
        const iconSize = Math.min(w, h) * 0.06;
        if (iconSize > 8 / zoom && spinnerR > 5 / zoom) {
            const iconY = spinnerY - spinnerR - iconSize - 6 / zoom;
            ctx.save();
            ctx.translate(cx, iconY);
            ctx.strokeStyle = isDark ? 'rgba(180,200,255,0.35)' : 'rgba(99,140,255,0.35)';
            ctx.lineWidth = 1.2 / zoom;
            ctx.fillStyle = 'transparent';

            if (file.type === 'pdf') {
                // PDF icon: rectangle with folded corner
                const iw = iconSize * 0.7, ih = iconSize;
                const fold = iw * 0.3;
                ctx.beginPath();
                ctx.moveTo(-iw/2, -ih/2);
                ctx.lineTo(iw/2 - fold, -ih/2);
                ctx.lineTo(iw/2, -ih/2 + fold);
                ctx.lineTo(iw/2, ih/2);
                ctx.lineTo(-iw/2, ih/2);
                ctx.closePath();
                ctx.stroke();
                // Fold line
                ctx.beginPath();
                ctx.moveTo(iw/2 - fold, -ih/2);
                ctx.lineTo(iw/2 - fold, -ih/2 + fold);
                ctx.lineTo(iw/2, -ih/2 + fold);
                ctx.stroke();
            } else {
                // Image icon: rectangle with mountain/sun
                const iw = iconSize, ih = iconSize * 0.75;
                ctx.strokeRect(-iw/2, -ih/2, iw, ih);
                // Sun
                ctx.beginPath();
                ctx.arc(-iw/2 + iw * 0.3, -ih/2 + ih * 0.35, ih * 0.12, 0, Math.PI * 2);
                ctx.stroke();
                // Mountain
                ctx.beginPath();
                ctx.moveTo(-iw/2 + iw * 0.15, ih/2);
                ctx.lineTo(-iw/2 + iw * 0.5, -ih/2 + ih * 0.45);
                ctx.lineTo(-iw/2 + iw * 0.85, ih/2);
                ctx.stroke();
            }
            ctx.restore();
        }

        ctx.restore();
    });

    ctx.restore();
}
