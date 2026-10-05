import type { Point, Stroke } from "../App";

export interface BoundingBox {
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;

    width: number;
    height: number;

    centerX: number;
    centerY: number;
}

export interface StrokeFeatures {
    boundingBox: BoundingBox;

    length: number;

    start: Point;
    end: Point;

    aspectRatio: number;

    direction: number;
}

export function getBoundingBox(stroke: Stroke): BoundingBox {
    const points = stroke.points;

    if (points.length === 0) {
        return {
            minX: 0,
            maxX: 0,
            minY: 0,
            maxY: 0,
            width: 0,
            height: 0,
            centerX: 0,
            centerY: 0
        };
    }

    let minX = points[0].x;
    let maxX = points[0].x;
    let minY = points[0].y;
    let maxY = points[0].y;

    for (const point of points) {
        minX = Math.min(minX, point.x);
        maxX = Math.max(maxX, point.x);

        minY = Math.min(minY, point.y);
        maxY = Math.max(maxY, point.y);
    }

    const width = maxX - minX;
    const height = maxY - minY;

    return {
        minX,
        maxX,
        minY,
        maxY,

        width,
        height,

        centerX: (minX + maxX) / 2,
        centerY: (minY + maxY) / 2
    };
}

export function getStrokeLength(stroke: Stroke): number {
    const points = stroke.points;

    if (points.length < 2) {
        return 0;
    }

    let length = 0;

    for (let i = 1; i < points.length; i++) {
        const dx = points[i].x - points[i - 1].x;
        const dy = points[i].y - points[i - 1].y;

        length += Math.sqrt(dx * dx + dy * dy);
    }

    return length;
}

export function getStrokeDirection(stroke: Stroke): number {
    const points = stroke.points;

    if (points.length < 2) {
        return 0;
    }

    const first = points[0];
    const last = points[points.length - 1];

    return Math.atan2(
        last.y - first.y,
        last.x - first.x
    );
}

export function extractStrokeFeatures(
    stroke: Stroke
): StrokeFeatures {

    const boundingBox = getBoundingBox(stroke);

    const length = getStrokeLength(stroke);

    const direction = getStrokeDirection(stroke);

    const start = stroke.points[0];
    const end = stroke.points[stroke.points.length - 1];

    const aspectRatio =
        boundingBox.height === 0
            ? Infinity
            : boundingBox.width / boundingBox.height;

    return {
        boundingBox,

        length,

        start,
        end,

        aspectRatio,

        direction
    };
}

/**
 * Counts the number of times a stroke crosses its own horizontal (X) and vertical (Y) centerlines.
 * Scratch-out scribble gestures repeatedly oscillate across the centerline, whereas standard digits
 * and mathematical operators do not.
 */
export function countCenterlineCrossings(stroke: Stroke): { xCrossings: number; yCrossings: number } {
  const box = getBoundingBox(stroke);
  if (box.width < 10 && box.height < 10) return { xCrossings: 0, yCrossings: 0 };

  const midX = (box.minX + box.maxX) / 2;
  const deadbandX = Math.max(3, box.width * 0.12);

  const midY = (box.minY + box.maxY) / 2;
  const deadbandY = Math.max(3, box.height * 0.12);

  let xCrossings = 0;
  let xSide: -1 | 0 | 1 = 0;

  let yCrossings = 0;
  let ySide: -1 | 0 | 1 = 0;

  for (const p of stroke.points) {
    if (p.x < midX - deadbandX) {
      if (xSide === 1) xCrossings++;
      xSide = -1;
    } else if (p.x > midX + deadbandX) {
      if (xSide === -1) xCrossings++;
      xSide = 1;
    }

    if (p.y < midY - deadbandY) {
      if (ySide === 1) yCrossings++;
      ySide = -1;
    } else if (p.y > midY + deadbandY) {
      if (ySide === -1) yCrossings++;
      ySide = 1;
    }
  }

  return { xCrossings, yCrossings };
}

/**
 * Counts the directional reversals in X and Y along the stroke path.
 */
export function countDirectionReversals(stroke: Stroke): { xReversals: number; yReversals: number } {
  if (stroke.points.length < 5) return { xReversals: 0, yReversals: 0 };

  let xReversals = 0;
  let yReversals = 0;

  let lastDxSign = 0;
  let lastDySign = 0;
  const threshold = 3;

  for (let i = 1; i < stroke.points.length; i++) {
    const dx = stroke.points[i].x - stroke.points[i - 1].x;
    const dy = stroke.points[i].y - stroke.points[i - 1].y;

    if (Math.abs(dx) >= threshold) {
      const currentDxSign = Math.sign(dx);
      if (lastDxSign !== 0 && currentDxSign !== lastDxSign) {
        xReversals++;
      }
      lastDxSign = currentDxSign;
    }

    if (Math.abs(dy) >= threshold) {
      const currentDySign = Math.sign(dy);
      if (lastDySign !== 0 && currentDySign !== lastDySign) {
        yReversals++;
      }
      lastDySign = currentDySign;
    }
  }

  return { xReversals, yReversals };
}

/**
 * Determines whether a given stroke is a scratch-out / scribble-to-erase gesture.
 * Distinguishes scribbles from valid math symbols (like 8, 3, 0, M, W, Σ, etc.)
 * by analyzing path density, directional reversals, and midline crossings.
 */
export function isScribbleStroke(stroke: Stroke): boolean {
  if (stroke.points.length < 10) return false;

  const box = getBoundingBox(stroke);
  const diag = Math.hypot(box.width, box.height);
  if (diag < 16) return false;
  if (box.width < 12 && box.height < 12) return false;

  const length = getStrokeLength(stroke);
  const density = length / diag;
  if (density < 2.0) return false;

  const { xCrossings, yCrossings } = countCenterlineCrossings(stroke);
  const { xReversals, yReversals } = countDirectionReversals(stroke);

  // Horizontal scribble (back and forth along X)
  const isHorizontalScribble =
    (xCrossings >= 4 && xReversals >= 3) ||
    (xCrossings >= 3 && density >= 2.4 && xReversals >= 3);

  // Vertical scribble (up and down along Y, with safeguards against M, W)
  const isVerticalScribble =
    (yCrossings >= 5 && yReversals >= 4) ||
    (yCrossings >= 4 && density >= 2.8 && yReversals >= 4);

  // Diagonal scribble
  const isDiagonalScribble =
    xCrossings >= 3 && yCrossings >= 3 && (xReversals + yReversals >= 6) && density >= 2.4;

  return isHorizontalScribble || isVerticalScribble || isDiagonalScribble;
}

/**
 * Identifies which existing strokes are covered/intersected by the scratch-out scribble.
 * Returns the IDs of the strokes to be erased.
 */
export function findScratchedStrokes(
  scribble: Stroke,
  existingStrokes: Stroke[]
): number[] {
  const sBox = getBoundingBox(scribble);
  const pad = 16;
  const padded = {
    minX: sBox.minX - pad,
    maxX: sBox.maxX + pad,
    minY: sBox.minY - pad,
    maxY: sBox.maxY + pad,
  };

  const matchedIds: number[] = [];

  for (const stroke of existingStrokes) {
    if (stroke.points.length === 0) continue;

    const strokeBox = getBoundingBox(stroke);
    const overlaps = !(
      strokeBox.maxX < padded.minX ||
      strokeBox.minX > padded.maxX ||
      strokeBox.maxY < padded.minY ||
      strokeBox.minY > padded.maxY
    );

    if (!overlaps) continue;

    let insideCount = 0;
    for (const pt of stroke.points) {
      if (
        pt.x >= padded.minX &&
        pt.x <= padded.maxX &&
        pt.y >= padded.minY &&
        pt.y <= padded.maxY
      ) {
        insideCount++;
      }
    }

    const ratio = insideCount / stroke.points.length;
    const centerInside =
      strokeBox.centerX >= padded.minX &&
      strokeBox.centerX <= padded.maxX &&
      strokeBox.centerY >= padded.minY &&
      strokeBox.centerY <= padded.maxY;

    // Stroke is covered if at least 30% of its points are inside the scribble bounds,
    // or if its center is inside and at least 3 points are inside
    if (ratio >= 0.30 || (centerInside && insideCount >= 3)) {
      matchedIds.push(stroke.id);
    }
  }

  return matchedIds;
}