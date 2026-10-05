import * as ort from "onnxruntime-web";
import type { Stroke } from "../App";
import type { StrokeInfo } from "../math/segmentation";

export interface RenderedSymbol {
    canvas?: HTMLCanvasElement | OffscreenCanvas;
    /** [1, 3, 32, 32] NCHW Float32 tensor data for LaTeX symbolizer (1.0=white bg, 0.0=black stroke) */
    data: Float32Array;
    /** [1, 1, 28, 28] Float32 tensor data for MNIST digit classifier (0.0=black bg, 1.0=white stroke) */
    mnistData: Float32Array;
}

const IMAGE_SIZE = 32;
const PADDING = 3;

/**
 * Render stroke group into a 28x28 normalized grayscale Float32 tensor for MNIST.
 * In MNIST standard: 0.0 is background (black), 1.0 is stroke (white).
 * Fitted into 20x20 bounding box with 4px margin.
 */
function renderMnistTensor(strokes: Stroke[]): Float32Array {
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;

    for (const stroke of strokes) {
        for (const point of stroke.points) {
            minX = Math.min(minX, point.x);
            maxX = Math.max(maxX, point.x);
            minY = Math.min(minY, point.y);
            maxY = Math.max(maxY, point.y);
        }
    }

    const rawW = Math.max(maxX - minX, 1);
    const rawH = Math.max(maxY - minY, 1);
    const scale = 20 / Math.max(rawW, rawH);
    const destW = rawW * scale;
    const destH = rawH * scale;
    const offsetX = (28 - destW) / 2;
    const offsetY = (28 - destH) / 2;

    const grid = new Float32Array(28 * 28).fill(0.0);

    const drawLine = (x0: number, y0: number, x1: number, y1: number, radius: number) => {
        const dist = Math.hypot(x1 - x0, y1 - y0);
        const steps = Math.max(Math.ceil(dist * 2), 1);
        for (let s = 0; s <= steps; s++) {
            const cx = x0 + (x1 - x0) * (s / steps);
            const cy = y0 + (y1 - y0) * (s / steps);
            const minPx = Math.max(0, Math.floor(cx - radius));
            const maxPx = Math.min(27, Math.ceil(cx + radius));
            const minPy = Math.max(0, Math.floor(cy - radius));
            const maxPy = Math.min(27, Math.ceil(cy + radius));

            for (let py = minPy; py <= maxPy; py++) {
                for (let px = minPx; px <= maxPx; px++) {
                    const d = Math.hypot(px - cx, py - cy);
                    if (d <= radius) {
                        const intensity = Math.max(0, 1 - d / radius);
                        const idx = py * 28 + px;
                        if (intensity > grid[idx]) {
                            grid[idx] = intensity;
                        }
                    }
                }
            }
        }
    };

    for (const stroke of strokes) {
        const points = stroke.points;
        if (points.length === 0) continue;
        if (points.length === 1) {
            const x = (points[0].x - minX) * scale + offsetX;
            const y = (points[0].y - minY) * scale + offsetY;
            drawLine(x, y, x, y, 1.4);
            continue;
        }

        for (let i = 1; i < points.length; i++) {
            const p0 = points[i - 1];
            const p1 = points[i];
            const x0 = (p0.x - minX) * scale + offsetX;
            const y0 = (p0.y - minY) * scale + offsetY;
            const x1 = (p1.x - minX) * scale + offsetX;
            const y1 = (p1.y - minY) * scale + offsetY;
            drawLine(x0, y0, x1, y1, 1.4);
        }
    }

    return grid;
}

/**
 * Render a group of strokes into a 32x32 RGB image suitable for the Residual CNN model,
 * and a 28x28 grayscale image for MNIST.
 */
export function renderSymbol(
    group: StrokeInfo[]
): RenderedSymbol | null {
    if (group.length === 0) {
        return null;
    }

    const strokes: Stroke[] = group.map((info) => info.stroke);

    /*
     * 1. Find bounding box of the entire stroke group
     */
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;

    for (const stroke of strokes) {
        for (const point of stroke.points) {
            minX = Math.min(minX, point.x);
            maxX = Math.max(maxX, point.x);
            minY = Math.min(minY, point.y);
            maxY = Math.max(maxY, point.y);
        }
    }

    if (
        !Number.isFinite(minX) ||
        !Number.isFinite(maxX) ||
        !Number.isFinite(minY) ||
        !Number.isFinite(maxY)
    ) {
        return null;
    }

    const rawWidth = Math.max(maxX - minX, 1);
    const rawHeight = Math.max(maxY - minY, 1);

    /*
     * Enforce a minimum bounding size to prevent flat/thin strokes
     * (like '-' or '1') from collapsing into sub-pixel slivers.
     */
    const symbolWidth = Math.max(rawWidth, 16);
    const symbolHeight = Math.max(rawHeight, 16);

    const extraX = (symbolWidth - rawWidth) / 2;
    const extraY = (symbolHeight - rawHeight) / 2;

    /*
     * 2. Setup high-resolution temporary canvas for smooth rasterization
     */
    const renderScale = 4;
    const tempWidth = Math.ceil(symbolWidth + PADDING * 2);
    const tempHeight = Math.ceil(symbolHeight + PADDING * 2);

    const tempWrapper = typeof OffscreenCanvas !== "undefined"
        ? (() => {
            const c = new OffscreenCanvas(tempWidth * renderScale, tempHeight * renderScale);
            return { canvas: c, ctx: c.getContext("2d") };
          })()
        : (() => {
            const c = document.createElement("canvas");
            c.width = tempWidth * renderScale;
            c.height = tempHeight * renderScale;
            return { canvas: c, ctx: c.getContext("2d") };
          })();

    const tempCanvas = tempWrapper.canvas;
    const tempCtx = tempWrapper.ctx;
    if (!tempCtx) {
        return null;
    }

    // Clean white background
    tempCtx.fillStyle = "white";
    tempCtx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);

    /*
     * 3. Compute scale & normalized stroke width
     * We want the final stroke on the 32x32 canvas to be ~2.8 pixels thick.
     */
    const availableSize = IMAGE_SIZE - PADDING * 2;
    const scale = Math.min(
        availableSize / tempWidth,
        availableSize / tempHeight
    );

    const targetStrokeIn32 = 2.8;
    const effectiveLineWidth = Math.max(
        (targetStrokeIn32 / scale) * renderScale,
        3 * renderScale
    );

    tempCtx.strokeStyle = "black";
    tempCtx.fillStyle = "black";
    tempCtx.lineCap = "round";
    tempCtx.lineJoin = "round";
    tempCtx.lineWidth = effectiveLineWidth;

    const offsetXTemp = (PADDING + extraX - minX) * renderScale;
    const offsetYTemp = (PADDING + extraY - minY) * renderScale;

    for (const stroke of strokes) {
        const points = stroke.points;
        if (points.length === 0) continue;

        if (points.length === 1) {
            const point = points[0];
            const x = point.x * renderScale + offsetXTemp;
            const y = point.y * renderScale + offsetYTemp;
            const radius = Math.max(effectiveLineWidth / 2, 2 * renderScale);

            tempCtx.beginPath();
            tempCtx.arc(x, y, radius, 0, Math.PI * 2);
            tempCtx.fill();
            continue;
        }

        tempCtx.beginPath();
        const first = points[0];
        tempCtx.moveTo(
            first.x * renderScale + offsetXTemp,
            first.y * renderScale + offsetYTemp
        );

        for (let i = 1; i < points.length; i++) {
            const current = points[i];
            tempCtx.lineTo(
                current.x * renderScale + offsetXTemp,
                current.y * renderScale + offsetYTemp
            );
        }

        tempCtx.stroke();
    }

    /*
     * 4. Downscale to 32x32 canvas
     */
    const finalWidth = tempWidth * scale;
    const finalHeight = tempHeight * scale;

    const destX = (IMAGE_SIZE - finalWidth) / 2;
    const destY = (IMAGE_SIZE - finalHeight) / 2;

    const downscaleWrapper = typeof OffscreenCanvas !== "undefined"
        ? (() => {
            const c = new OffscreenCanvas(IMAGE_SIZE, IMAGE_SIZE);
            return { canvas: c, ctx: c.getContext("2d", { willReadFrequently: true }) };
          })()
        : (() => {
            const c = document.createElement("canvas");
            c.width = IMAGE_SIZE;
            c.height = IMAGE_SIZE;
            return { canvas: c, ctx: c.getContext("2d", { willReadFrequently: true }) };
          })();

    const canvas = downscaleWrapper.canvas;
    const ctx = downscaleWrapper.ctx;
    if (!ctx) {
        return null;
    }

    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, IMAGE_SIZE, IMAGE_SIZE);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";

    ctx.drawImage(
        tempCanvas,
        0,
        0,
        tempCanvas.width,
        tempCanvas.height,
        destX,
        destY,
        finalWidth,
        finalHeight
    );

    /*
     * 5. Extract pixel data, apply contrast thresholding & pack into [1, 3, 32, 32] NCHW
     */
    const imageData = ctx.getImageData(0, 0, IMAGE_SIZE, IMAGE_SIZE);
    const rgba = imageData.data;
    const data = new Float32Array(3 * IMAGE_SIZE * IMAGE_SIZE);

    const threshold = 210;
    const pixelCount = IMAGE_SIZE * IMAGE_SIZE;

    for (let i = 0; i < pixelCount; i++) {
        const r = rgba[i * 4];
        const g = rgba[i * 4 + 1];
        const b = rgba[i * 4 + 2];
        const gray = (r + g + b) / 3;

        // Binarize stroke: solid black (0.0) or clean white (1.0)
        const val = gray < threshold ? 0.0 : 1.0;

        // Channel 0 (Red)
        data[i] = val;
        // Channel 1 (Green)
        data[i + pixelCount] = val;
        // Channel 2 (Blue)
        data[i + pixelCount * 2] = val;

        // Update preview canvas with crisp black and white pixels
        const previewColor = val * 255;
        rgba[i * 4] = previewColor;
        rgba[i * 4 + 1] = previewColor;
        rgba[i * 4 + 2] = previewColor;
        rgba[i * 4 + 3] = 255;
    }

    ctx.putImageData(imageData, 0, 0);

    const mnistData = renderMnistTensor(strokes);

    return {
        canvas,
        data,
        mnistData,
    };
}

export interface SymbolMapping {
    symbol: string;
    unicode: string;
    svg: string;
}

const MNIST_MODEL_PATH = "/models/mnist-12.onnx";
const SYMBOLIZER_MODEL_PATH = "/models/residualcnn_augment_int8.onnx";
const MAPPINGS_PATH = "/models/mappings.json";

ort.env.wasm.wasmPaths = "/ort/";

let mnistSession: ort.InferenceSession | null = null;
let symbolizerSession: ort.InferenceSession | null = null;
let mappings: Record<string, SymbolMapping> | null = null;

export async function loadModel(): Promise<void> {
    if (mnistSession && symbolizerSession && mappings) {
        console.log("All models and mappings are already loaded.");
        return;
    }

    console.log("Loading Pretrained Models (MNIST Digit Classifier + Symbolizer ResNet)...");

    const [loadedMnist, loadedSymbolizer, mappingsResp] = await Promise.all([
        ort.InferenceSession.create(MNIST_MODEL_PATH, { executionProviders: ["wasm"] }),
        ort.InferenceSession.create(SYMBOLIZER_MODEL_PATH, { executionProviders: ["wasm"] }),
        fetch(MAPPINGS_PATH),
    ]);

    mnistSession = loadedMnist;
    symbolizerSession = loadedSymbolizer;

    if (!mappingsResp.ok) {
        throw new Error("Could not load mappings.json");
    }
    mappings = await mappingsResp.json();

    console.log("All pretrained models loaded successfully.");
    console.log("MNIST inputs:", mnistSession.inputNames, "outputs:", mnistSession.outputNames);
    console.log("Symbolizer inputs:", symbolizerSession.inputNames, "outputs:", symbolizerSession.outputNames);
}

/** Numerically stable softmax */
function softmax(logits: Float32Array): number[] {
    let max = -Infinity;
    for (let i = 0; i < logits.length; i++) {
        if (logits[i] > max) max = logits[i];
    }

    const exps = new Float32Array(logits.length);
    let sum = 0;
    for (let i = 0; i < logits.length; i++) {
        const v = Math.exp(logits[i] - max);
        exps[i] = v;
        sum += v;
    }

    const probs = new Array<number>(logits.length).fill(0);
    const denom = sum > 0 ? sum : 1;
    for (let i = 0; i < logits.length; i++) {
        probs[i] = exps[i] / denom;
    }
    return probs;
}

/**
 * Standard LaTeX to calculator character alias mapping.
 */
const SYMBOL_ALIASES: Record<string, string> = {
    // Decimal point / Dot
    "\\cdot": ".",
    "\\bullet": ".",
    "\\dotsc": ".",
    "\\dots": ".",
    ".": ".",

    // Plus
    "\\pm": "+",
    "\\perp": "+",
    "\\bot": "+",
    "\\mp": "+",
    "\\dagger": "+",
    "\\oplus": "+",

    // Minus
    "\\vdash": "-",
    "\\dashv": "-",
    "\\neg": "-",
    "\\horizbar": "-",
    "\\minus": "-",
    "\\textemdash": "-",
    "\\textendash": "-",
    "\\Xi": "-",

    // Digit 1
    "|": "1",
    "\\vert": "1",
    "\\mid": "1",
    "\\nmid": "1",
    "\\prime": "1",
    "l": "1",
    "I": "1",

    // Digit 0
    "\\circ": "0",
    "\\square": "0",
    "\\degree": "0",
    "\\emptyset": "0",
    "O": "0",
    "o": "0",

    // Digit 2
    "Z": "2",
    "z": "2",

    // Multiply
    "\\times": "*",
    "\\ast": "*",

    // Divide
    "\\div": "/",
    "\\slash": "/",
    "÷": "/",

    // Parentheses
    "\\left(": "(",
    "\\right)": ")",
    "\\lbrack": "(",
    "\\rbrack": ")",
    "(": "(",
    ")": ")",

    // Equals
    "\\doteq": "=",
    "\\equiv": "=",
    "=": "=",

    // Exponent / Caret
    "\\wedge": "^",
    "\\barwedge": "^",
    "\\hat": "^",
    "^": "^",
};

const OPERATOR_TOKENS = new Set(["+", "-", "*", "/", "=", "(", ")", "."]);

/**
 * Fast deterministic geometric checks for simple primitive shapes.
 */
function checkGeometricHeuristics(group: StrokeInfo[]): string | null {
    // 1 single stroke
    if (group.length === 1) {
        const feat = group[0].features;
        const box = feat.boundingBox;
        const pts = group[0].stroke.points;

        // 1. Tiny dot or single-tap -> Decimal point '.'
        const maxDim = Math.max(box.width, box.height);
        const minDim = Math.min(box.width, box.height);
        if (pts.length <= 3 || (maxDim <= 20 && feat.length <= 35)) {
            if (minDim === 0 || maxDim <= minDim * 3.5) {
                return ".";
            }
        }

        // 2. Flat horizontal stroke -> '-'
        if (feat.aspectRatio > 2.6 && box.width > 20) {
            return "-";
        }

        // 3. Very vertical straight line -> '1'
        if (feat.aspectRatio < 0.22 && feat.length > 25 && box.height > 25) {
            return "1";
        }

        // 4. Slanted straight slash '/'
        const dx = feat.end.x - feat.start.x;
        const dy = feat.end.y - feat.start.y;
        const straightDist = Math.hypot(dx, dy);
        const isStraight = straightDist > 20 && feat.length / straightDist < 1.35;
        const isSlashSlant = (dx > 8 && dy < -12) || (dx < -8 && dy > 12);
        if (isStraight && isSlashSlant && feat.aspectRatio >= 0.28 && feat.aspectRatio <= 1.25) {
            return "/";
        }

        // 5. Inverted V shape -> Caret '^'
        if (
            feat.length > 20 &&
            box.width > 12 &&
            box.height > 10 &&
            feat.start.y > box.minY + 0.3 * box.height &&
            feat.end.y > box.minY + 0.3 * box.height &&
            feat.start.x < box.centerX &&
            feat.end.x > box.centerX
        ) {
            return "^";
        }
    }

    // 2 strokes
    if (group.length === 2) {
        const s1 = group[0].features;
        const s2 = group[1].features;
        const a1 = s1.aspectRatio;
        const a2 = s2.aspectRatio;

        // 2 parallel horizontal lines -> Equals '='
        if (a1 > 1.8 && a2 > 1.8) {
            const overlapX =
                Math.max(0, Math.min(s1.boundingBox.maxX, s2.boundingBox.maxX) -
                            Math.max(s1.boundingBox.minX, s2.boundingBox.minX));
            const minW = Math.min(s1.boundingBox.width, s2.boundingBox.width);
            if (minW > 0 && overlapX / minW > 0.5) {
                return "=";
            }
        }

        // 2 perpendicular intersecting strokes -> '+'
        const horiz = a1 > 1.6 && a2 < 0.65;
        const vert = a2 > 1.6 && a1 < 0.65;
        if (horiz || vert) {
            return "+";
        }

        // 2 crossing diagonal strokes -> 'x' or 'y'
        const d1 = Math.abs(Math.abs(s1.direction) - Math.PI / 4) < 0.4 ||
                   Math.abs(Math.abs(s1.direction) - (3 * Math.PI) / 4) < 0.4;
        const d2 = Math.abs(Math.abs(s2.direction) - Math.PI / 4) < 0.4 ||
                   Math.abs(Math.abs(s2.direction) - (3 * Math.PI) / 4) < 0.4;
        if (d1 && d2) {
            const yDescender = Math.abs(s1.boundingBox.maxY - s2.boundingBox.maxY);
            const maxH = Math.max(s1.boundingBox.height, s2.boundingBox.height);
            if (yDescender > 0.30 * maxH) {
                return "y";
            }
            return "x";
        }
    }

    // 3 strokes: division sign ÷ (1 horizontal line + 2 dots)
    if (group.length === 3) {
        const lineStroke = group.find((s) => s.features.boundingBox.width > s.features.boundingBox.height * 2.2);
        const otherStrokes = group.filter((s) => s !== lineStroke);
        if (lineStroke && otherStrokes.length === 2) {
            const lineY = lineStroke.features.boundingBox.centerY;
            const y1 = otherStrokes[0].features.boundingBox.centerY;
            const y2 = otherStrokes[1].features.boundingBox.centerY;
            const isDot1 = otherStrokes[0].features.boundingBox.width <= otherStrokes[0].features.boundingBox.height * 2.5 &&
                           otherStrokes[0].features.boundingBox.height <= otherStrokes[0].features.boundingBox.width * 2.5;
            const isDot2 = otherStrokes[1].features.boundingBox.width <= otherStrokes[1].features.boundingBox.height * 2.5 &&
                           otherStrokes[1].features.boundingBox.height <= otherStrokes[1].features.boundingBox.width * 2.5;
            if (isDot1 && isDot2 && ((y1 < lineY && y2 > lineY) || (y2 < lineY && y1 > lineY))) {
                return "/";
            }
        }
    }

    return null;
}

export async function recognizeSymbol(
    group: StrokeInfo[]
): Promise<string> {
    if (!mnistSession || !symbolizerSession || !mappings) {
        await loadModel();
    }

    if (!mnistSession || !symbolizerSession || !mappings) {
        throw new Error("Models or mappings failed to load.");
    }

    // 1. High-precision geometric checks first
    const heuristic = checkGeometricHeuristics(group);
    if (heuristic) {
        console.log(`[Geometric Heuristic]: Recognized '${heuristic}'`);
        return heuristic;
    }

    // 2. Render stroke representations
    const rendered = renderSymbol(group);
    if (!rendered) {
        throw new Error("Could not render symbol.");
    }

    // 3. Run Pretrained MNIST Model (Optimized for 0-9 digits)
    const mnistInputName = mnistSession.inputNames[0];
    const mnistOutputName = mnistSession.outputNames[0];
    const mnistTensor = new ort.Tensor("float32", rendered.mnistData, [1, 1, 28, 28]);
    let mnistLogits: Float32Array;
    try {
        const mnistResults = await mnistSession.run({ [mnistInputName]: mnistTensor });
        mnistLogits = new Float32Array(mnistResults[mnistOutputName].data as Float32Array);
        mnistResults[mnistOutputName]?.dispose?.();
    } finally {
        mnistTensor.dispose?.();
    }
    const mnistProbs = softmax(mnistLogits);

    const mnistRanked = mnistProbs
        .map((prob, digit) => ({ digit: String(digit), prob }))
        .sort((a, b) => b.prob - a.prob);

    const topMnist = mnistRanked[0];
    console.log(
        `[MNIST Top]: '${topMnist.digit}' (${(topMnist.prob * 100).toFixed(1)}%), ` +
        `2nd: '${mnistRanked[1].digit}' (${(mnistRanked[1].prob * 100).toFixed(1)}%)`
    );

    // 4. Run Pretrained Symbolizer ResNet Model (Optimized for LaTeX math & operators)
    const symbInputName = symbolizerSession.inputNames[0] || "input";
    const symbOutputName = symbolizerSession.outputNames[0] || "logits";
    const symbTensor = new ort.Tensor("float32", rendered.data, [1, 3, 32, 32]);
    let symbLogits: Float32Array;
    try {
        const symbResults = await symbolizerSession.run({ [symbInputName]: symbTensor });
        symbLogits = new Float32Array(symbResults[symbOutputName].data as Float32Array);
        symbResults[symbOutputName]?.dispose?.();
    } finally {
        symbTensor.dispose?.();
    }
    const symbProbs = softmax(symbLogits);

    const localMappings = mappings;
    const symbRanked = symbProbs
        .map((prob, index) => {
            if (index === 0) return null;
            const entry = localMappings[String(index)];
            const rawSymbol = entry?.symbol ?? "";
            let resolvedSymbol = SYMBOL_ALIASES[rawSymbol] ?? rawSymbol;
            if (resolvedSymbol === "X") {
                resolvedSymbol = "x";
            }
            return {
                index,
                prob,
                rawSymbol,
                symbol: resolvedSymbol,
                isOperator: OPERATOR_TOKENS.has(resolvedSymbol),
            };
        })
        .filter((p): p is NonNullable<typeof p> => p !== null)
        .sort((a, b) => b.prob - a.prob);

    console.log("--- TOP 5 Symbolizer Predictions ---");
    for (const pred of symbRanked.slice(0, 5)) {
        console.log(
            `  [${pred.index}] '${pred.rawSymbol}' -> '${pred.symbol}' (${(pred.prob * 100).toFixed(1)}%)`
        );
    }

    // 5. Intelligent Ensemble Decision:
    // A. If Symbolizer predicts a dot/period '.' with strong probability (> 35%),
    // it is definitely a decimal point (MNIST has no dot class and tries to guess a digit):
    const topSymb = symbRanked[0];
    if (topSymb.symbol === "." && topSymb.prob > 0.35) {
        console.log(`[Ensemble]: Decimal point '.' recognized via Symbolizer (${(topSymb.prob * 100).toFixed(1)}%).`);
        return ".";
    }

    // B. If Symbolizer strongly predicts an operator (+, -, *, /, =), give it precedence:
    if (topSymb.isOperator && topSymb.prob > 0.40) {
        console.log(`[Ensemble]: Operator '${topSymb.symbol}' selected from Symbolizer.`);
        return topSymb.symbol;
    }

    // C. Check if an operator or decimal is in the top 3 with decent probability:
    const candidateOperator = symbRanked.slice(0, 3).find((p) => p.isOperator);
    if (candidateOperator && candidateOperator.prob > 0.25 && topMnist.prob < 0.85) {
        console.log(`[Ensemble]: Operator '${candidateOperator.symbol}' prioritized.`);
        return candidateOperator.symbol;
    }

    // D. If Symbolizer predicts variable 'x', 'y', or caret '^' with significant probability:
    if (topSymb.symbol === "x" || topSymb.symbol === "y" || topSymb.symbol === "^") {
        if (topSymb.prob > 0.22) {
            console.log(`[Ensemble]: Algebraic variable/symbol '${topSymb.symbol}' selected from Symbolizer (${(topSymb.prob * 100).toFixed(1)}%).`);
            return topSymb.symbol;
        }
    }

    // Also check top 2 candidates for variable 'x' or 'y'
    const candidateVar = symbRanked.slice(0, 2).find((p) => p.symbol === "x" || p.symbol === "y");
    if (candidateVar && candidateVar.prob > 0.30 && topMnist.prob < 0.85) {
        console.log(`[Ensemble]: Candidate variable '${candidateVar.symbol}' prioritized.`);
        return candidateVar.symbol;
    }

    // D. For all digits (0-9): MNIST has >99% accuracy on human handwriting:
    if (topMnist.prob >= 0.20) {
        console.log(`[Ensemble]: Digit '${topMnist.digit}' selected from MNIST (${(topMnist.prob * 100).toFixed(1)}%).`);
        return topMnist.digit;
    }

    // Fallback to top Symbolizer token
    return topSymb.symbol || topMnist.digit;
}

export function getModelSession(): ort.InferenceSession | null {
    return symbolizerSession;
}
