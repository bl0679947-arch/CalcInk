import type { Stroke } from "../App";
import type { StrokeFeatures } from "./geometry";
import { extractStrokeFeatures } from "./geometry";

export interface StrokeInfo {
    stroke: Stroke;
    features: StrokeFeatures;
}

/*
 * How close two strokes must be before we consider
 * them candidates for belonging to the same symbol.
 *
 * This is relative to the size of the strokes rather
 * than using a fixed number of pixels.
 */
const GAP_FACTOR = 0.45;


/*
 * ----------------------------------------------------
 * Create stroke information
 * ----------------------------------------------------
 */

function createStrokeInfos(
    strokes: Stroke[]
): StrokeInfo[] {

    return strokes.map((stroke) => ({
        stroke,
        features: extractStrokeFeatures(stroke)
    }));
}


/*
 * ----------------------------------------------------
 * Calculate the horizontal gap between two bounding
 * boxes.
 *
 * 0 means they overlap horizontally.
 * ----------------------------------------------------
 */

function horizontalGap(
    a: StrokeFeatures,
    b: StrokeFeatures
): number {

    const boxA = a.boundingBox;
    const boxB = b.boundingBox;

    if (boxA.maxX < boxB.minX) {
        return boxB.minX - boxA.maxX;
    }

    if (boxB.maxX < boxA.minX) {
        return boxA.minX - boxB.maxX;
    }

    return 0;
}


/*
 * ----------------------------------------------------
 * Calculate the vertical gap between two bounding
 * boxes.
 *
 * 0 means they overlap vertically.
 * ----------------------------------------------------
 */

function verticalGap(
    a: StrokeFeatures,
    b: StrokeFeatures
): number {

    const boxA = a.boundingBox;
    const boxB = b.boundingBox;

    if (boxA.maxY < boxB.minY) {
        return boxB.minY - boxA.maxY;
    }

    if (boxB.maxY < boxA.minY) {
        return boxA.minY - boxB.maxY;
    }

    return 0;
}


/*
 * ----------------------------------------------------
 * Check whether two bounding boxes overlap vertically.
 * ----------------------------------------------------
 */

function verticalOverlap(
    a: StrokeFeatures,
    b: StrokeFeatures
): boolean {

    const boxA = a.boundingBox;
    const boxB = b.boundingBox;

    return !(
        boxA.maxY < boxB.minY ||
        boxB.maxY < boxA.minY
    );
}


/*
 * ----------------------------------------------------
 * Check whether two bounding boxes overlap
 * horizontally.
 * ----------------------------------------------------
 */

function horizontalOverlap(
    a: StrokeFeatures,
    b: StrokeFeatures
): boolean {

    const boxA = a.boundingBox;
    const boxB = b.boundingBox;

    return !(
        boxA.maxX < boxB.minX ||
        boxB.maxX < boxA.minX
    );
}


/*
 * ----------------------------------------------------
 * Estimate the characteristic size of a stroke.
 *
 * We use the smaller of width and height, with a
 * minimum of 1 to avoid division problems.
 * ----------------------------------------------------
 */

function getStrokeScale(
    stroke: StrokeInfo
): number {

    const box =
        stroke.features.boundingBox;

    return Math.max(
        Math.min(
            box.width,
            box.height
        ),
        1
    );
}


/*
 * ----------------------------------------------------
 * Determine whether two strokes probably belong to
 * the SAME SYMBOL.
 * ----------------------------------------------------
 */

function shouldMerge(
    a: StrokeInfo,
    b: StrokeInfo
): boolean {

    const featuresA = a.features;
    const featuresB = b.features;

    const boxA =
        featuresA.boundingBox;

    const boxB =
        featuresB.boundingBox;


    /*
     * ------------------------------------------------
     * Case 1:
     * Bounding boxes overlap.
     *
     * This is a strong indication that the strokes
     * belong to the same symbol.
     *
     * Examples:
     *
     * +
     * ×
     * 4
     * 8
     * ------------------------------------------------
     */

    const boxesOverlap =
        horizontalOverlap(
            featuresA,
            featuresB
        ) &&
        verticalOverlap(
            featuresA,
            featuresB
        );

    if (boxesOverlap) {
        return true;
    }


    /*
     * ------------------------------------------------
     * Calculate adaptive gap threshold.
     * ------------------------------------------------
     */

    const scaleA =
        getStrokeScale(a);

    const scaleB =
        getStrokeScale(b);

    const scale =
        Math.min(
            scaleA,
            scaleB
        );

    const allowedGap =
        scale * GAP_FACTOR;


    /*
     * ------------------------------------------------
     * Case 2:
     * Horizontal strokes that are vertically close.
     *
     * This is important for symbols such as:
     *
     * =
     *
     * where the two strokes don't touch.
     * ------------------------------------------------
     */

    const hGap =
        horizontalGap(
            featuresA,
            featuresB
        );

    const vGap =
        verticalGap(
            featuresA,
            featuresB
        );

    if (
        horizontalOverlap(
            featuresA,
            featuresB
        ) &&
        vGap <= allowedGap
    ) {
        return true;
    }

    /*
 * Special case for symbols made from
 * separated horizontal strokes.
 *
 * Example:
 *
 * -------
 * -------
 *
 * This allows "=" to remain one symbol.
 */

const heightA = boxA.height;
const heightB = boxB.height;

const widthA = boxA.width;
const widthB = boxB.width;

/*
 * Both strokes must clearly be horizontal.
 */
const horizontalStrokeA =
    widthA > heightA * 2;

const horizontalStrokeB =
    widthB > heightB * 2;

/*
 * The two lines of "=" should have
 * approximately the same length.
 */
const similarWidth =
    Math.abs(widthA - widthB) <=
    Math.max(widthA, widthB) * 0.5;

/*
 * The strokes should overlap horizontally.
 */
const sameHorizontalRegion =
    horizontalOverlap(
        featuresA,
        featuresB
    );

/*
 * Allow a larger vertical gap for "=".
 *
 * We use both stroke thickness and line width:
 *
 *   thin strokes → enough tolerance
 *   extremely large separation → still rejected
 */
const equalSignGap =
    Math.min(
        Math.min(widthA, widthB) * 0.35,
        Math.max(heightA, heightB) * 10
    );

if (
    horizontalStrokeA &&
    horizontalStrokeB &&
    similarWidth &&
    sameHorizontalRegion &&
    vGap <= equalSignGap
) {
    return true;
}

/*
 * ------------------------------------------------
 * Special case for division sign ÷
 *
 *     •
 *   -----
 *     •
 *
 * The three components are separate strokes,
 * so they need to be explicitly grouped.
 * ------------------------------------------------
 */

const isHorizontalStrokeA =
    boxA.width > boxA.height * 2;

const isHorizontalStrokeB =
    boxB.width > boxB.height * 2;

const isDotLikeA =
    boxA.width <= boxA.height * 2 &&
    boxA.height <= boxA.width * 2;

const isDotLikeB =
    boxB.width <= boxB.height * 2 &&
    boxB.height <= boxB.width * 2;


/*
 * Check whether the two components are
 * vertically aligned.
 */
const centerXDifference =
    Math.abs(
        boxA.centerX -
        boxB.centerX
    );


/*
 * The horizontal line of ÷ can be much wider
 * than the dots.
 *
 * Therefore use the line width to determine
 * how much horizontal alignment is allowed.
 */
const divisionAlignmentTolerance =
    Math.min(
        Math.max(boxA.width, boxB.width) * 0.25,
        20
    );


/*
 * Gap between the components.
 *
 * Use the horizontal stroke's height as the
 * basic scale, but allow a reasonable amount
 * for handwritten spacing.
 */
const divisionGap =
    Math.max(
        Math.min(
            boxA.width,
            boxB.width
        ) * 0.35,
        Math.max(
            boxA.height,
            boxB.height
        ) * 4
    );


/*
 * Horizontal line + dot
 */
const lineAndDot =
    (
        isHorizontalStrokeA &&
        isDotLikeB
    ) ||
    (
        isHorizontalStrokeB &&
        isDotLikeA
    );


if (
    lineAndDot &&
    centerXDifference <=
        divisionAlignmentTolerance &&
    vGap <= divisionGap
) {
    return true;
}

    /*
     * ------------------------------------------------
     * Case 3:
     * Vertically arranged strokes.
     *
     * Useful for multi-stroke symbols such as digits.
     * ------------------------------------------------
     */

    if (
        verticalOverlap(
            featuresA,
            featuresB
        ) &&
        hGap <= allowedGap
    ) {
        return true;
    }


    /*
     * ------------------------------------------------
     * Case 4:
     * Diagonal/crossing strokes.
     *
     * If both horizontal and vertical gaps are small,
     * they probably belong together.
     * ------------------------------------------------
     */

    if (
        hGap <= allowedGap &&
        vGap <= allowedGap
    ) {
        return true;
    }


    /*
     * Otherwise they are probably separate symbols.
     */

    return false;
}


/*
 * ----------------------------------------------------
 * Sort a group from left to right.
 * ----------------------------------------------------
 */

function sortLeftToRight(
    strokes: StrokeInfo[]
): StrokeInfo[] {

    return [...strokes].sort(
        (a, b) =>
            a.features.boundingBox.centerX -
            b.features.boundingBox.centerX
    );
}


/*
 * ----------------------------------------------------
 * Group strokes into symbols.
 *
 * We construct a graph:
 *
 * stroke A ---- stroke B
 *       \
 *        \
 *         stroke C
 *
 * Connected components become symbols.
 * ----------------------------------------------------
 */

/*
 * ----------------------------------------------------
 * Helpers for detecting the three components of ÷
 * ----------------------------------------------------
 */

/*
 * A horizontal stroke should be considerably wider
 * than it is tall.
 */
function isHorizontalLine(
    info: StrokeInfo
): boolean {

    const box =
        info.features.boundingBox;

    return (
        box.width > box.height * 3
    );
}


/*
 * A dot should be relatively small and compact.
 */
function isDot(
    info: StrokeInfo
): boolean {

    const box =
        info.features.boundingBox;

    const maxDimension =
        Math.max(
            box.width,
            box.height
        );

    const minDimension =
        Math.min(
            box.width,
            box.height
        );

    return (
        maxDimension <= minDimension * 2.5
    );
}


/*
 * Check whether a dot is vertically aligned
 * with the horizontal line.
 */
function isVerticallyAlignedWithLine(
    dot: StrokeInfo,
    line: StrokeInfo
): boolean {

    const dotBox =
        dot.features.boundingBox;

    const lineBox =
        line.features.boundingBox;

    const difference =
        Math.abs(
            dotBox.centerX -
            lineBox.centerX
        );

    /*
     * Allow some handwriting variation.
     */
    const tolerance =
        lineBox.width * 0.35;

    return difference <= tolerance;
}


/*
 * Determine whether a dot is close enough to
 * the horizontal line to be part of ÷.
 */
function isCloseToDivisionLine(
    dot: StrokeInfo,
    line: StrokeInfo
): boolean {

    const dotBox =
        dot.features.boundingBox;

    const lineBox =
        line.features.boundingBox;

    let gap: number;

    /*
     * Dot above the line
     */
    if (
        dotBox.centerY <
        lineBox.centerY
    ) {

        gap =
            lineBox.minY -
            dotBox.maxY;

    }

    /*
     * Dot below the line
     */
    else {

        gap =
            dotBox.minY -
            lineBox.maxY;
    }

    /*
     * If they overlap vertically, it isn't
     * the normal geometry of ÷.
     */
    if (gap < 0) {
        return false;
    }

    /*
     * Use the width of the division line as
     * the scale.
     *
     * This is much more stable than using the
     * tiny height of the dot.
     */
    const maxGap =
        lineBox.width * 0.5;

    return gap <= maxGap;
}

export function groupStrokes(
    strokes: Stroke[]
): StrokeInfo[][] {

    if (strokes.length === 0) {
        return [];
    }


    const infos =
        createStrokeInfos(strokes);

    const n =
        infos.length;


    /*
     * Graph adjacency list.
     */
    const graph: number[][] =
        Array.from(
            { length: n },
            () => []
        );


    /*
     * Compare every pair of strokes.
     */

    for (let i = 0; i < n; i++) {

        for (let j = i + 1; j < n; j++) {

            if (
                shouldMerge(
                    infos[i],
                    infos[j]
                )
            ) {

                graph[i].push(j);
                graph[j].push(i);
            }
        }
    }

    /*
 * ----------------------------------------------------
 * Dedicated division-sign grouping
 *
 * Look for:
 *
 *          dot
 *
 *       --------
 *
 *          dot
 *
 * and explicitly connect all three components.
 * ----------------------------------------------------
 */

for (let i = 0; i < n; i++) {

    const line = infos[i];

    /*
     * The central component of ÷ must be
     * a horizontal line.
     */
    if (!isHorizontalLine(line)) {
        continue;
    }


    let topDotIndex: number | null = null;
    let bottomDotIndex: number | null = null;

    let topDistance = Infinity;
    let bottomDistance = Infinity;


    /*
     * Search for dots around this line.
     */
    for (let j = 0; j < n; j++) {

        if (i === j) {
            continue;
        }

        const candidate =
            infos[j];

        if (!isDot(candidate)) {
            continue;
        }

        /*
         * The dot must be horizontally aligned
         * with the line.
         */
        if (
            !isVerticallyAlignedWithLine(
                candidate,
                line
            )
        ) {
            continue;
        }

        /*
         * It must also be reasonably close.
         */
        if (
            !isCloseToDivisionLine(
                candidate,
                line
            )
        ) {
            continue;
        }


        const lineY =
            line.features
                .boundingBox
                .centerY;

        const dotY =
            candidate.features
                .boundingBox
                .centerY;


        /*
         * Dot ABOVE the line
         */
        if (dotY < lineY) {

            const distance =
                lineY - dotY;

            if (
                distance < topDistance
            ) {

                topDistance =
                    distance;

                topDotIndex =
                    j;
            }
        }


        /*
         * Dot BELOW the line
         */
        else {

            const distance =
                dotY - lineY;

            if (
                distance < bottomDistance
            ) {

                bottomDistance =
                    distance;

                bottomDotIndex =
                    j;
            }
        }
    }


    /*
     * We found both dots.
     *
     * Therefore:
     *
     *      dot
     *       |
     *      line
     *       |
     *      dot
     *
     * is definitely one ÷ symbol.
     */
    if (
        topDotIndex !== null &&
        bottomDotIndex !== null
    ) {

        graph[i].push(
            topDotIndex
        );

        graph[topDotIndex].push(
            i
        );


        graph[i].push(
            bottomDotIndex
        );

        graph[bottomDotIndex].push(
            i
        );
    }
}


    /*
     * ------------------------------------------------
     * Find connected components using DFS.
     * ------------------------------------------------
     */

    const visited =
        new Set<number>();

    const groups:
        StrokeInfo[][] = [];


    for (let i = 0; i < n; i++) {

        if (visited.has(i)) {
            continue;
        }


        const group:
            StrokeInfo[] = [];

        const stack:
            number[] = [i];

        visited.add(i);


        while (stack.length > 0) {

            const current =
                stack.pop()!;

            group.push(
                infos[current]
            );


            for (
                const neighbour
                of graph[current]
            ) {

                if (
                    !visited.has(
                        neighbour
                    )
                ) {

                    visited.add(
                        neighbour
                    );

                    stack.push(
                        neighbour
                    );
                }
            }
        }


        /*
         * Keep strokes inside the symbol
         * ordered from left to right.
         */

        groups.push(
            sortLeftToRight(group)
        );
    }


    /*
     * ------------------------------------------------
     * Sort the final symbols from left to right.
     * ------------------------------------------------
     */

    groups.sort(
        (a, b) => {

            const centerA =
                a.reduce(
                    (sum, stroke) =>
                        sum +
                        stroke.features
                            .boundingBox
                            .centerX,
                    0
                ) / a.length;

            const centerB =
                b.reduce(
                    (sum, stroke) =>
                        sum +
                        stroke.features
                            .boundingBox
                            .centerX,
                    0
                ) / b.length;

            return centerA - centerB;
        }
    );


    return groups;
}