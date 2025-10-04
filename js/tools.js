// --- START OF FILE js/tools.js ---

import { snapToGrid } from './utils.js';
import * as hitTest from './hitTest.js';

export function handleBrush(state, pos, e) {
    const pressure = e.pressure > 0 ? e.pressure : 0.5;
    state.layers[state.layers.length - 1].points.push({ ...pos, pressure });
}

export function handleShapeDrawing(ctx, state, pos, event) {
    const { zoom, panX, panY } = state;
    ctx.save();
    ctx.translate(panX, panY);
    ctx.scale(zoom, zoom);
    const isDarkMode = document.body.classList.contains('dark-theme');
    ctx.strokeStyle = isDarkMode ? 'rgba(255, 255, 255, 0.6)' : 'rgba(0, 0, 0, 0.6)';
    ctx.lineWidth = 1.5 / zoom;
    ctx.setLineDash([5 / zoom, 5 / zoom]);
    
    const shouldSnap = (state.snappingMode === 'manual' && event.altKey) || (state.snappingMode === 'auto' && !event.altKey);

    if (state.currentAction && state.currentAction.startsWith('drawing')) {
        let previewPos = pos;
        if (shouldSnap) {
            const SNAP_THRESHOLD = 10 / state.zoom;
            const snappedX = snapToGrid(pos.x);
            const snappedY = snapToGrid(pos.y);
            const finalX = (Math.abs(snappedX - pos.x) < SNAP_THRESHOLD) ? snappedX : pos.x;
            const finalY = (Math.abs(snappedY - pos.y) < SNAP_THRESHOLD) ? snappedY : pos.y;
            previewPos = { x: finalX, y: finalY };
        }

        if (state.tempLayer) {
            if (state.currentAction === 'drawingParallelogramSlant') { const tempLayer = state.tempLayer; const slant = previewPos.x - (tempLayer.x + tempLayer.width / 2); ctx.beginPath(); ctx.moveTo(tempLayer.x, tempLayer.y + tempLayer.height); ctx.lineTo(tempLayer.x + tempLayer.width, tempLayer.y + tempLayer.height); ctx.lineTo(tempLayer.x + tempLayer.width + slant, tempLayer.y); ctx.lineTo(tempLayer.x + slant, tempLayer.y); ctx.closePath(); ctx.stroke(); } 
            else if (state.currentAction === 'drawingTriangleApex') { const tempLayer = state.tempLayer; ctx.beginPath(); ctx.moveTo(tempLayer.p1.x, tempLayer.p1.y); ctx.lineTo(tempLayer.p2.x, tempLayer.p2.y); ctx.lineTo(previewPos.x, previewPos.y); ctx.closePath(); ctx.stroke(); } 
            else if (state.currentAction === 'drawingParallelepipedDepth') { const tempLayer = state.tempLayer; const depth = { x: previewPos.x - (tempLayer.x + tempLayer.width), y: previewPos.y - tempLayer.y }; const p = [ {x: tempLayer.x, y: tempLayer.y}, {x: tempLayer.x + tempLayer.width, y: tempLayer.y}, {x: tempLayer.x + tempLayer.width, y: tempLayer.y + tempLayer.height}, {x: tempLayer.x, y: tempLayer.y + tempLayer.height}, {x: tempLayer.x + depth.x, y: tempLayer.y + depth.y}, {x: tempLayer.x + tempLayer.width + depth.x, y: tempLayer.y + depth.y}, {x: tempLayer.x + tempLayer.width + depth.x, y: tempLayer.y + tempLayer.height + depth.y}, {x: tempLayer.x + depth.x, y: tempLayer.y + tempLayer.height + depth.y} ]; ctx.beginPath(); ctx.moveTo(p[0].x, p[0].y); ctx.lineTo(p[1].x, p[1].y); ctx.lineTo(p[2].x, p[2].y); ctx.lineTo(p[3].x, p[3].y); ctx.closePath(); ctx.moveTo(p[1].x, p[1].y); ctx.lineTo(p[5].x, p[5].y); ctx.moveTo(p[2].x, p[2].y); ctx.lineTo(p[6].x, p[6].y); ctx.moveTo(p[0].x, p[0].y); ctx.lineTo(p[4].x, p[4].y); ctx.moveTo(p[4].x, p[4].y); ctx.lineTo(p[5].x, p[5].y); ctx.lineTo(p[6].x, p[6].y); ctx.lineTo(p[7].x, p[7].y); ctx.closePath(); ctx.stroke(); } 
            else if (state.currentAction === 'drawingPyramidApex' || state.currentAction === 'drawingTruncatedPyramidApex') { const { base } = state.tempLayer; const p = [ base.p1, base.p2, base.p3, base.p4 ]; ctx.beginPath(); ctx.moveTo(p[0].x, p[0].y); ctx.lineTo(p[1].x, p[1].y); ctx.lineTo(p[2].x, p[2].y); ctx.lineTo(p[3].x, p[3].y); ctx.closePath(); ctx.moveTo(p[0].x, p[0].y); ctx.lineTo(previewPos.x, previewPos.y); ctx.moveTo(p[1].x, p[1].y); ctx.lineTo(previewPos.x, previewPos.y); ctx.moveTo(p[2].x, p[2].y); ctx.lineTo(previewPos.x, previewPos.y); ctx.moveTo(p[3].x, p[3].y); ctx.lineTo(previewPos.x, previewPos.y); ctx.stroke(); } 
            else if (state.currentAction === 'drawingTruncatedPyramidTop') {
                const { base, apex } = state.tempLayer;
                const totalHeight = Math.abs(apex.y - base.p1.y);
                const cutHeight = Math.abs(previewPos.y - base.p1.y);
                const ratio = Math.max(0.05, Math.min(0.95, cutHeight / totalHeight));

                const interpolate = (p1, p2) => ({ x: p1.x + (p2.x - p1.x) * ratio, y: p1.y + (p2.y - p1.y) * ratio });
                const t = [ interpolate(base.p1, apex), interpolate(base.p2, apex), interpolate(base.p3, apex), interpolate(base.p4, apex) ];
                const b = [ base.p1, base.p2, base.p3, base.p4 ];

                ctx.beginPath(); ctx.moveTo(b[0].x, b[0].y); ctx.lineTo(b[1].x, b[1].y); ctx.lineTo(b[2].x, b[2].y); ctx.lineTo(b[3].x, b[3].y); ctx.closePath(); ctx.stroke();
                ctx.beginPath(); ctx.moveTo(t[0].x, t[0].y); ctx.lineTo(t[1].x, t[1].y); ctx.lineTo(t[2].x, t[2].y); ctx.lineTo(t[3].x, t[3].y); ctx.closePath(); ctx.stroke();
                for(let i = 0; i < 4; i++) { ctx.beginPath(); ctx.moveTo(b[i].x, b[i].y); ctx.lineTo(t[i].x, t[i].y); ctx.stroke(); }
            }
            else if (state.currentAction === 'drawingTrapezoidP3') { const { p1, p2 } = state.tempLayer; ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.lineTo(previewPos.x, previewPos.y); ctx.stroke(); } 
            else if (state.currentAction === 'drawingTrapezoidP4') { const { p1, p2, p3 } = state.tempLayer; ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.lineTo(p3.x, p3.y); ctx.lineTo(previewPos.x, previewPos.y); ctx.closePath(); ctx.stroke(); } 
            else if (state.currentAction === 'drawingFrustum') { const { cx, baseY, rx1, ry1 } = state.tempLayer; const rx2 = Math.abs(previewPos.x - cx); const ry2 = rx2 * 0.3; ctx.beginPath(); ctx.moveTo(cx - rx1, baseY); ctx.lineTo(cx - rx2, previewPos.y); ctx.moveTo(cx + rx1, baseY); ctx.lineTo(cx + rx2, previewPos.y); ctx.stroke(); ctx.beginPath(); ctx.ellipse(cx, baseY, rx1, ry1, 0, 0, 2 * Math.PI); ctx.stroke(); ctx.beginPath(); ctx.ellipse(cx, previewPos.y, rx2, ry2, 0, 0, 2 * Math.PI); ctx.stroke(); } 
            else if (state.currentAction === 'drawingTruncatedSphere') {
                const { cx, cy, r } = state.tempLayer;
                const cutY = Math.max(cy - r, Math.min(cy + r, previewPos.y));
                const h = Math.abs(cutY - cy);
                const cutRSquared = (r * r) - (h * h);
                const cutR = cutRSquared > 0 ? Math.sqrt(cutRSquared) : 0;
                const cutRy = cutR * 0.3;

                const sinAngle = (cutY - cy) / r;
                const clampedSinAngle = Math.max(-1, Math.min(1, sinAngle));
                const angle = Math.asin(clampedSinAngle);

                ctx.beginPath();
                ctx.arc(cx, cy, r, angle, Math.PI - angle);
                ctx.stroke();

                ctx.beginPath();
                ctx.ellipse(cx, cutY, cutR, cutRy, 0, 0, 2 * Math.PI);
                ctx.stroke();
            }
        }
    }
    else if (state.isDrawing) {
        let start = { ...state.startPos };
        let end = pos;

        if (shouldSnap) {
            const SNAP_THRESHOLD = 10 / state.zoom;
            
            const snappedStartX = snapToGrid(state.startPos.x);
            const snappedStartY = snapToGrid(state.startPos.y);
            start.x = (Math.abs(snappedStartX - state.startPos.x) < SNAP_THRESHOLD) ? snappedStartX : state.startPos.x;
            start.y = (Math.abs(snappedStartY - state.startPos.y) < SNAP_THRESHOLD) ? snappedStartY : state.startPos.y;
            
            const snappedEndX = snapToGrid(pos.x);
            const snappedEndY = snapToGrid(pos.y);
            end.x = (Math.abs(snappedEndX - pos.x) < SNAP_THRESHOLD) ? snappedEndX : pos.x;
            end.y = (Math.abs(snappedEndY - pos.y) < SNAP_THRESHOLD) ? snappedEndY : pos.y;
        }
        
        if (state.activeTool === 'line' && event.shiftKey) {
            const dx = end.x - start.x;
            const dy = end.y - start.y;
            if (Math.abs(dx) > Math.abs(dy)) {
                end.y = start.y;
            } else {
                end.x = start.x;
            }
        }

        if (['rect', 'text', 'parallelogram', 'cone', 'parallelepiped', 'pyramid', 'frustum', 'truncated-pyramid'].includes(state.activeTool)) { 
            ctx.beginPath(); 
            ctx.strokeRect(start.x, start.y, end.x - start.x, end.y - start.y); 
        } 
        else if (state.activeTool === 'rhombus') {
            const x = Math.min(end.x, start.x);
            const y = Math.min(end.y, start.y);
            const width = Math.abs(end.x - start.x);
            const height = Math.abs(end.y - start.y);
            const p1 = {x: x + width / 2, y: y};
            const p2 = {x: x + width, y: y + height / 2};
            const p3 = {x: x + width / 2, y: y + height};
            const p4 = {x: x, y: y + height / 2};
            ctx.beginPath();
            ctx.moveTo(p1.x, p1.y);
            ctx.lineTo(p2.x, p2.y);
            ctx.lineTo(p3.x, p3.y);
            ctx.lineTo(p4.x, p4.y);
            ctx.closePath();
            ctx.stroke();
        } 
        else if (['line', 'triangle', 'trapezoid'].includes(state.activeTool)) { 
            ctx.beginPath(); 
            ctx.moveTo(start.x, start.y); 
            ctx.lineTo(end.x, end.y); 
            ctx.stroke(); 
        } else if (state.activeTool === 'ellipse' || state.activeTool === 'sphere' || state.activeTool === 'truncated-sphere') { 
            const rx = Math.abs(end.x - start.x) / 2; 
            const ry = Math.abs(end.y - start.y) / 2; 
            const cx = start.x + (end.x - start.x) / 2; 
            const cy = start.y + (end.y - start.y) / 2; 
            ctx.beginPath(); 
            ctx.ellipse(cx, cy, rx, ry, 0, 0, 2 * Math.PI); 
            ctx.stroke(); 
        }
    }
    
    ctx.restore();
}