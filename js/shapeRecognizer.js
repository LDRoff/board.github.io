// --- START OF FILE js/shapeRecognizer.js ---

const templates = [];

function distance(p1, p2) {
    return Math.hypot(p1.x - p2.x, p1.y - p2.y);
}

function pathLength(points) {
    let d = 0;
    for (let i = 1; i < points.length; i++) {
        d += distance(points[i - 1], points[i]);
    }
    return d;
}

function resample(points, n) {
    const I = pathLength(points) / (n - 1);
    let D = 0;
    const newPoints = [{ x: points[0].x, y: points[0].y }];
    
    // Copy points array to avoid mutating input points
    const pts = points.map(p => ({ x: p.x, y: p.y }));
    
    let i = 1;
    while (i < pts.length) {
        let p1 = pts[i - 1];
        let p2 = pts[i];
        let d = distance(p1, p2);
        if (D + d >= I) {
            let t = (I - D) / d;
            let q = {
                x: p1.x + t * (p2.x - p1.x),
                y: p1.y + t * (p2.y - p1.y)
            };
            newPoints.push(q);
            pts.splice(i, 0, q);
            D = 0;
        } else {
            D += d;
        }
        i++;
    }
    
    while (newPoints.length < n) {
        newPoints.push({ x: points[points.length - 1].x, y: points[points.length - 1].y });
    }
    if (newPoints.length > n) {
        newPoints.length = n;
    }
    return newPoints;
}

function centroid(points) {
    let x = 0, y = 0;
    for (let i = 0; i < points.length; i++) {
        x += points[i].x;
        y += points[i].y;
    }
    return { x: x / points.length, y: y / points.length };
}

function indicativeAngle(points) {
    const c = centroid(points);
    return Math.atan2(points[0].y - c.y, points[0].x - c.x);
}

function rotateBy(points, radians) {
    const c = centroid(points);
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);
    return points.map(p => {
        let dx = p.x - c.x;
        let dy = p.y - c.y;
        return {
            x: dx * cos - dy * sin + c.x,
            y: dx * sin + dy * cos + c.y
        };
    });
}

function boundingBox(points) {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (let i = 0; i < points.length; i++) {
        minX = Math.min(minX, points[i].x);
        maxX = Math.max(maxX, points[i].x);
        minY = Math.min(minY, points[i].y);
        maxY = Math.max(maxY, points[i].y);
    }
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function scaleTo(points, size) {
    const box = boundingBox(points);
    return points.map(p => ({
        x: p.x * (size / (box.width || 1)),
        y: p.y * (size / (box.height || 1))
    }));
}

function translateTo(points, pt) {
    const c = centroid(points);
    return points.map(p => ({
        x: p.x - c.x + pt.x,
        y: p.y - c.y + pt.y
    }));
}

function distanceAtBestAngle(points, template, a, b, threshold) {
    const phi = 0.5 * (Math.sqrt(5.0) - 1.0);
    let x1 = phi * a + (1.0 - phi) * b;
    let f1 = distanceAtAngle(points, template, x1);
    let x2 = (1.0 - phi) * a + phi * b;
    let f2 = distanceAtAngle(points, template, x2);
    while (Math.abs(b - a) > threshold) {
        if (f1 < f2) {
            b = x2;
            x2 = x1;
            f2 = f1;
            x1 = phi * a + (1.0 - phi) * b;
            f1 = distanceAtAngle(points, template, x1);
        } else {
            a = x1;
            x1 = x2;
            f1 = f2;
            x2 = (1.0 - phi) * a + phi * b;
            f2 = distanceAtAngle(points, template, x2);
        }
    }
    return Math.min(f1, f2);
}

function distanceAtAngle(points, template, radians) {
    const rotated = rotateBy(points, radians);
    return Math.min(
        pathDistance(rotated, template.points),
        pathDistanceReversed(rotated, template.points)
    );
}

function pathDistance(pts1, pts2) {
    let d = 0;
    for (let i = 0; i < pts1.length; i++) {
        d += distance(pts1[i], pts2[i]);
    }
    return d / pts1.length;
}

function pathDistanceReversed(pts1, pts2) {
    let d = 0;
    const len = pts1.length;
    for (let i = 0; i < len; i++) {
        d += distance(pts1[i], pts2[len - 1 - i]);
    }
    return d / len;
}

function preProcessTemplate(name, rawPoints) {
    let pts = resample(rawPoints, 64);
    let radians = indicativeAngle(pts);
    pts = rotateBy(pts, -radians);
    pts = scaleTo(pts, 250);
    pts = translateTo(pts, { x: 0, y: 0 });
    return { name, points: pts };
}

function initTemplates() {
    // 1. Triangle (Equilateral base)
    const triPoints = [];
    for (let i = 0; i <= 21; i++) triPoints.push({ x: 0.5 + 0.5 * (i / 21), y: i / 21 });
    for (let i = 1; i <= 21; i++) triPoints.push({ x: 1.0 - (i / 21), y: 1.0 });
    for (let i = 1; i <= 21; i++) triPoints.push({ x: 0.5 * (1.0 - i / 21), y: 1.0 - (i / 21) });
    templates.push(preProcessTemplate('triangle', triPoints));

    // 2. Rectangle (Square outline)
    const rectPoints = [];
    for (let i = 0; i <= 16; i++) rectPoints.push({ x: i / 16, y: 0.0 });
    for (let i = 1; i <= 16; i++) rectPoints.push({ x: 1.0, y: i / 16 });
    for (let i = 1; i <= 16; i++) rectPoints.push({ x: 1.0 - (i / 16), y: 1.0 });
    for (let i = 1; i <= 15; i++) rectPoints.push({ x: 0.0, y: 1.0 - (i / 16) });
    templates.push(preProcessTemplate('rectangle', rectPoints));

    // 3. Circle (64 points circle)
    const circlePoints = [];
    for (let i = 0; i < 64; i++) {
        let angle = (i / 63) * 2 * Math.PI;
        circlePoints.push({ x: Math.cos(angle), y: Math.sin(angle) });
    }
    templates.push(preProcessTemplate('ellipse', circlePoints));

    // 4. Rhombus (Diamond outline)
    const rhombPoints = [];
    for (let i = 0; i <= 16; i++) rhombPoints.push({ x: 0.5 + 0.5 * (i / 16), y: 0.5 * (i / 16) });
    for (let i = 1; i <= 16; i++) rhombPoints.push({ x: 1.0 - 0.5 * (i / 16), y: 0.5 + 0.5 * (i / 16) });
    for (let i = 1; i <= 16; i++) rhombPoints.push({ x: 0.5 - 0.5 * (i / 16), y: 1.0 - 0.5 * (i / 16) });
    for (let i = 1; i <= 15; i++) rhombPoints.push({ x: 0.5 * (i / 16), y: 0.5 - 0.5 * (i / 16) });
    templates.push(preProcessTemplate('rhombus', rhombPoints));

    // 5. Arrow (Single-stroke line + head barbs)
    const arrowPoints = [];
    // Shaft (32 points)
    for (let i = 0; i < 32; i++) arrowPoints.push({ x: i / 31, y: 0.5 });
    // Left barb (12 points)
    for (let i = 1; i <= 12; i++) arrowPoints.push({ x: 1.0 - 0.3 * (i / 12), y: 0.5 - 0.3 * (i / 12) });
    // Back to head tip (8 points)
    for (let i = 1; i <= 8; i++) arrowPoints.push({ x: 0.7 + 0.3 * (i / 8), y: 0.2 + 0.3 * (i / 8) });
    // Right barb (12 points)
    for (let i = 1; i <= 12; i++) arrowPoints.push({ x: 1.0 - 0.3 * (i / 12), y: 0.5 + 0.3 * (i / 12) });
    templates.push(preProcessTemplate('arrow', arrowPoints));
}

// Run template initialization
initTemplates();

export function recognizeShape(points, hasPressure, heldAtEnd = false) {
    const step = hasPressure ? 3 : 2;
    const rawPoints = [];
    for (let i = 0; i < points.length; i += step) {
        rawPoints.push({ x: points[i], y: points[i + 1] });
    }

    if (rawPoints.length < 5) return null;

    const pathLen = pathLength(rawPoints);
    const firstPt = rawPoints[0];
    const lastPt = rawPoints[rawPoints.length - 1];
    const directDistance = distance(firstPt, lastPt);
    
    const boundingBoxData = boundingBox(rawPoints);
    if (boundingBoxData.width < 15 && boundingBoxData.height < 15) return null;

    // 1. Check for straight line first
    if (pathLen > 0) {
        const straightness = directDistance / pathLen;
        if (heldAtEnd) {
            if (straightness > 0.88) {
                return {
                    type: 'line',
                    x1: firstPt.x, y1: firstPt.y,
                    x2: lastPt.x, y2: lastPt.y,
                    id: Date.now(), rotation: 0, pivot: { x: 0, y: 0 }
                };
            }
        } else {
            if (straightness > 0.992) {
                return {
                    type: 'line',
                    x1: firstPt.x, y1: firstPt.y,
                    x2: lastPt.x, y2: lastPt.y,
                    id: Date.now(), rotation: 0, pivot: { x: 0, y: 0 }
                };
            }
        }
    }

    // 2. Perform $1 Shape Recognition
    let processedPoints = resample(rawPoints, 64);
    const radians = indicativeAngle(processedPoints);
    processedPoints = rotateBy(processedPoints, -radians);
    processedPoints = scaleTo(processedPoints, 250);
    processedPoints = translateTo(processedPoints, { x: 0, y: 0 });

    let bestTemplate = null;
    let highestScore = 0;

    const halfDiagonal = 0.5 * Math.sqrt(250 * 250 + 250 * 250); // 176.78

    for (let i = 0; i < templates.length; i++) {
        const template = templates[i];
        const d = distanceAtBestAngle(processedPoints, template, -45 * Math.PI / 180, 45 * Math.PI / 180, 2 * Math.PI / 180);
        const score = 1.0 - d / halfDiagonal;
        if (score > highestScore) {
            highestScore = score;
            bestTemplate = template;
        }
    }

    // Custom threshold score to avoid false positives for drawing text/scribbles
    if (highestScore > 0.82) {
        const commonProps = { id: Date.now(), rotation: 0, pivot: { x: 0, y: 0 } };
        const x = boundingBoxData.x;
        const y = boundingBoxData.y;
        const width = boundingBoxData.width;
        const height = boundingBoxData.height;

        switch (bestTemplate.name) {
            case 'triangle':
                return {
                    type: 'triangle',
                    p1: { x: x + width / 2, y: y },
                    p2: { x: x + width, y: y + height },
                    p3: { x: x, y: y + height },
                    ...commonProps
                };
            case 'rectangle':
                return {
                    type: 'rect',
                    x: x, y: y,
                    width: width, height: height,
                    ...commonProps
                };
            case 'ellipse':
                return {
                    type: 'ellipse',
                    cx: x + width / 2,
                    cy: y + height / 2,
                    rx: width / 2,
                    ry: height / 2,
                    ...commonProps
                };
            case 'rhombus':
                return {
                    type: 'rhombus',
                    p1: { x: x + width / 2, y: y },
                    p2: { x: x + width, y: y + height / 2 },
                    p3: { x: x + width / 2, y: y + height },
                    p4: { x: x, y: y + height / 2 },
                    ...commonProps
                };
            case 'arrow':
                return {
                    type: 'arrow',
                    x1: firstPt.x, y1: firstPt.y,
                    x2: lastPt.x, y2: lastPt.y,
                    ...commonProps
                };
        }
    }

    return null;
}

// --- END OF FILE js/shapeRecognizer.js ---