// --- START OF FILE js/tools.js ---

import { snapToGrid } from './utils.js';
import * as hitTest from './hitTest.js';

export function handleBrush(state, pos, e) {
    const pressure = e.pressure > 0 ? e.pressure : 0.5;
    state.layers[state.layers.length - 1].points.push({ ...pos, pressure });
}

export function handleEraser(state, pos) {
    const layerToDelete = hitTest.getLayerAtPosition(pos, state.layers);
    if (layerToDelete) {
        state.layers = state.layers.filter(l => l.id !== layerToDelete.id);
        state.didErase = true;
        return true;
    }
    return false;
}

export function handleShapeDrawing(ctx, state, pos, event) {
    const { zoom, panX, panY } = state;
    ctx.save();
    ctx.translate(panX, panY);
    ctx.scale(zoom, zoom);
    // --- НАЧАЛО ИЗМЕНЕНИЙ: Стили для превью ---
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.lineWidth = 1.5 / zoom;
    // --- КОНЕЦ ИЗМЕНЕНИЙ ---
    ctx.setLineDash([5 / zoom, 5 / zoom]);
    
    if (state.isDrawing) {
        let start = { ...state.startPos };
        let end = pos;

        if (event.altKey) {
            start = { x: snapToGrid(state.startPos.x), y: snapToGrid(state.startPos.y) };
            end = { x: snapToGrid(pos.x), y: snapToGrid(pos.y) };
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

export function handleMultiStepDrawing(iCtx, state, pos, event) {
    const { zoom, panX, panY } = state;
    iCtx.save();
    iCtx.translate(panX, panY);
    iCtx.scale(zoom, zoom);
    // --- НАЧАЛО ИЗМЕНЕНИЙ: Стили для превью ---
    iCtx.strokeStyle = 'rgba(0, 0, 0, 0.6)';
    iCtx.lineWidth = 1.5 / zoom;
    // --- КОНЕЦ ИЗМЕНЕНИЙ ---
    iCtx.setLineDash([5 / zoom, 5 / zoom]);
    
    let previewPos = pos;
    if (event.altKey) {
        previewPos = { x: snapToGrid(pos.x), y: snapToGrid(pos.y) };
    }

    if (state.tempLayer) {
        if (state.currentAction === 'drawingParallelogramSlant') { const tempLayer = state.tempLayer; const slant = previewPos.x - (tempLayer.x + tempLayer.width / 2); iCtx.beginPath(); iCtx.moveTo(tempLayer.x, tempLayer.y + tempLayer.height); iCtx.lineTo(tempLayer.x + tempLayer.width, tempLayer.y + tempLayer.height); iCtx.lineTo(tempLayer.x + tempLayer.width + slant, tempLayer.y); iCtx.lineTo(tempLayer.x + slant, tempLayer.y); iCtx.closePath(); iCtx.stroke(); } 
        else if (state.currentAction === 'drawingTriangleApex') { const tempLayer = state.tempLayer; iCtx.beginPath(); iCtx.moveTo(tempLayer.p1.x, tempLayer.p1.y); iCtx.lineTo(tempLayer.p2.x, tempLayer.p2.y); iCtx.lineTo(previewPos.x, previewPos.y); iCtx.closePath(); iCtx.stroke(); } 
        else if (state.currentAction === 'drawingParallelepipedDepth') { const tempLayer = state.tempLayer; const depth = { x: previewPos.x - (tempLayer.x + tempLayer.width), y: previewPos.y - tempLayer.y }; const p = [ {x: tempLayer.x, y: tempLayer.y}, {x: tempLayer.x + tempLayer.width, y: tempLayer.y}, {x: tempLayer.x + tempLayer.width, y: tempLayer.y + tempLayer.height}, {x: tempLayer.x, y: tempLayer.y + tempLayer.height}, {x: tempLayer.x + depth.x, y: tempLayer.y + depth.y}, {x: tempLayer.x + tempLayer.width + depth.x, y: tempLayer.y + depth.y}, {x: tempLayer.x + tempLayer.width + depth.x, y: tempLayer.y + tempLayer.height + depth.y}, {x: tempLayer.x + depth.x, y: tempLayer.y + tempLayer.height + depth.y} ]; iCtx.beginPath(); iCtx.moveTo(p[0].x, p[0].y); iCtx.lineTo(p[1].x, p[1].y); iCtx.lineTo(p[2].x, p[2].y); iCtx.lineTo(p[3].x, p[3].y); iCtx.closePath(); iCtx.moveTo(p[1].x, p[1].y); iCtx.lineTo(p[5].x, p[5].y); iCtx.moveTo(p[2].x, p[2].y); iCtx.lineTo(p[6].x, p[6].y); iCtx.moveTo(p[0].x, p[0].y); iCtx.lineTo(p[4].x, p[4].y); iCtx.moveTo(p[4].x, p[4].y); iCtx.lineTo(p[5].x, p[5].y); iCtx.lineTo(p[6].x, p[6].y); iCtx.lineTo(p[7].x, p[7].y); iCtx.closePath(); iCtx.stroke(); } 
        else if (state.currentAction === 'drawingPyramidApex' || state.currentAction === 'drawingTruncatedPyramidApex') { const { base } = state.tempLayer; const p = [ base.p1, base.p2, base.p3, base.p4 ]; iCtx.beginPath(); iCtx.moveTo(p[0].x, p[0].y); iCtx.lineTo(p[1].x, p[1].y); iCtx.lineTo(p[2].x, p[2].y); iCtx.lineTo(p[3].x, p[3].y); iCtx.closePath(); iCtx.moveTo(p[0].x, p[0].y); iCtx.lineTo(previewPos.x, previewPos.y); iCtx.moveTo(p[1].x, p[1].y); iCtx.lineTo(previewPos.x, previewPos.y); iCtx.moveTo(p[2].x, p[2].y); iCtx.lineTo(previewPos.x, previewPos.y); iCtx.moveTo(p[3].x, p[3].y); iCtx.lineTo(previewPos.x, previewPos.y); iCtx.stroke(); } 
        else if (state.currentAction === 'drawingTruncatedPyramidTop') {
            const { base, apex } = state.tempLayer;
            const totalHeight = Math.abs(apex.y - base.p1.y);
            const cutHeight = Math.abs(previewPos.y - base.p1.y);
            const ratio = Math.max(0.05, Math.min(0.95, cutHeight / totalHeight));

            const interpolate = (p1, p2) => ({ x: p1.x + (p2.x - p1.x) * ratio, y: p1.y + (p2.y - p1.y) * ratio });
            const t = [ interpolate(base.p1, apex), interpolate(base.p2, apex), interpolate(base.p3, apex), interpolate(base.p4, apex) ];
            const b = [ base.p1, base.p2, base.p3, base.p4 ];

            iCtx.beginPath(); iCtx.moveTo(b[0].x, b[0].y); iCtx.lineTo(b[1].x, b[1].y); iCtx.lineTo(b[2].x, b[2].y); iCtx.lineTo(b[3].x, b[3].y); iCtx.closePath(); iCtx.stroke();
            iCtx.beginPath(); iCtx.moveTo(t[0].x, t[0].y); iCtx.lineTo(t[1].x, t[1].y); iCtx.lineTo(t[2].x, t[2].y); iCtx.lineTo(t[3].x, t[3].y); iCtx.closePath(); iCtx.stroke();
            for(let i = 0; i < 4; i++) { iCtx.beginPath(); iCtx.moveTo(b[i].x, b[i].y); iCtx.lineTo(t[i].x, t[i].y); iCtx.stroke(); }
        }
        else if (state.currentAction === 'drawingTrapezoidP3') { const { p1, p2 } = state.tempLayer; iCtx.beginPath(); iCtx.moveTo(p1.x, p1.y); iCtx.lineTo(p2.x, p2.y); iCtx.lineTo(previewPos.x, previewPos.y); iCtx.stroke(); } 
        else if (state.currentAction === 'drawingTrapezoidP4') { const { p1, p2, p3 } = state.tempLayer; iCtx.beginPath(); iCtx.moveTo(p1.x, p1.y); iCtx.lineTo(p2.x, p2.y); iCtx.lineTo(p3.x, p3.y); iCtx.lineTo(previewPos.x, previewPos.y); iCtx.closePath(); iCtx.stroke(); } 
        else if (state.currentAction === 'drawingFrustum') { const { cx, baseY, rx1, ry1 } = state.tempLayer; const rx2 = Math.abs(previewPos.x - cx); const ry2 = rx2 * 0.3; iCtx.beginPath(); iCtx.moveTo(cx - rx1, baseY); iCtx.lineTo(cx - rx2, previewPos.y); iCtx.moveTo(cx + rx1, baseY); iCtx.lineTo(cx + rx2, previewPos.y); iCtx.stroke(); iCtx.beginPath(); iCtx.ellipse(cx, baseY, rx1, ry1, 0, 0, 2 * Math.PI); iCtx.stroke(); iCtx.beginPath(); iCtx.ellipse(cx, previewPos.y, rx2, ry2, 0, 0, 2 * Math.PI); iCtx.stroke(); } 
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

            iCtx.beginPath();
            iCtx.arc(cx, cy, r, angle, Math.PI - angle);
            iCtx.stroke();

            iCtx.beginPath();
            iCtx.ellipse(cx, cutY, cutR, cutRy, 0, 0, 2 * Math.PI);
            iCtx.stroke();
        }
    }
    
    iCtx.restore();
}
// --- END OF FILE js/tools.js ---