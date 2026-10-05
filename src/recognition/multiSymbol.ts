import type { Stroke } from "../App";
import { groupStrokes, type StrokeInfo } from "../math/segmentation";
import { recognizeSymbol } from "./model";
import { evaluateExpression, formatNumber, type EvaluationResult } from "../math/evaluator";

export interface RecognizedSymbolItem {
    id: number;
    symbol: string;
    strokes: Stroke[];
    boundingBox: {
        minX: number;
        maxX: number;
        minY: number;
        maxY: number;
        width: number;
        height: number;
        centerX: number;
        centerY: number;
    };
}

export interface LineStage {
    stageIndex: number;
    symbols: RecognizedSymbolItem[];
    rawTokens: string[];
    assembledTokens: string[];
    evaluation: EvaluationResult;
    hasTerminalEquals: boolean;
    terminalEqualsSymbol?: RecognizedSymbolItem;
    skipDisplayAnswer?: boolean;
}

export interface LineResult {
    lineIndex: number;
    symbols: RecognizedSymbolItem[];
    rawTokens: string[];
    assembledTokens: string[];
    evaluation: EvaluationResult;
    stages?: LineStage[];
    boundingBox: {
        minX: number;
        maxX: number;
        minY: number;
        maxY: number;
        width: number;
        height: number;
        centerX: number;
        centerY: number;
    };
    hasTerminalEquals: boolean;
}

export interface MultiSymbolResult {
    lines: LineResult[];
    symbols: RecognizedSymbolItem[];
    rawTokens: string[];
    assembledTokens: string[];
    evaluation: EvaluationResult;
    executionTimeMs: number;
    variables: Record<string, number>;
}

/**
 * Calculates the bounding box that encompasses all strokes in a group.
 */
function getGroupBoundingBox(group: StrokeInfo[]): RecognizedSymbolItem["boundingBox"] {
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;

    for (const info of group) {
        const box = info.features.boundingBox;
        if (box.minX < minX) minX = box.minX;
        if (box.maxX > maxX) maxX = box.maxX;
        if (box.minY < minY) minY = box.minY;
        if (box.maxY > maxY) maxY = box.maxY;
    }

    if (minX === Infinity) {
        return { minX: 0, maxX: 0, minY: 0, maxY: 0, width: 0, height: 0, centerX: 0, centerY: 0 };
    }

    return {
        minX,
        maxX,
        minY,
        maxY,
        width: maxX - minX,
        height: maxY - minY,
        centerX: (minX + maxX) / 2,
        centerY: (minY + maxY) / 2,
    };
}

/**
 * Clusters recognized symbols into horizontal lines based on vertical spatial overlap and baseline proximity.
 * Symbols inside each line are sorted strictly from left to right.
 */
export function clusterSymbolsIntoLines(symbols: RecognizedSymbolItem[]): RecognizedSymbolItem[][] {
    if (symbols.length === 0) return [];

    // Sort symbols by vertical center to process top-to-bottom
    const sorted = [...symbols].sort((a, b) => a.boundingBox.centerY - b.boundingBox.centerY);

    interface WorkingLine {
        symbols: RecognizedSymbolItem[];
        minY: number;
        maxY: number;
        minX: number;
        maxX: number;
        height: number;
        centerY: number;
    }

    const lines: WorkingLine[] = [];

    for (const sym of sorted) {
        const box = sym.boundingBox;
        let bestLine: WorkingLine | null = null;
        let maxOverlap = 0;

        for (const line of lines) {
            const vOverlap = Math.max(0, Math.min(line.maxY, box.maxY) - Math.max(line.minY, box.minY));
            const overlapRatio = vOverlap / Math.min(box.height, line.height);
            const centerDiff = Math.abs(box.centerY - line.centerY);
            const centerInside =
                box.centerY >= line.minY - 0.25 * line.height &&
                box.centerY <= line.maxY + 0.25 * line.height;

            if (
                overlapRatio >= 0.35 ||
                centerInside ||
                centerDiff <= 0.45 * Math.max(box.height, line.height)
            ) {
                if (vOverlap > maxOverlap || (vOverlap === maxOverlap && bestLine === null)) {
                    maxOverlap = vOverlap;
                    bestLine = line;
                }
            }
        }

        if (bestLine) {
            bestLine.symbols.push(sym);
            bestLine.minY = Math.min(bestLine.minY, box.minY);
            bestLine.maxY = Math.max(bestLine.maxY, box.maxY);
            bestLine.minX = Math.min(bestLine.minX, box.minX);
            bestLine.maxX = Math.max(bestLine.maxX, box.maxX);
            bestLine.height = bestLine.maxY - bestLine.minY;
            bestLine.centerY = (bestLine.minY + bestLine.maxY) / 2;
        } else {
            lines.push({
                symbols: [sym],
                minY: box.minY,
                maxY: box.maxY,
                minX: box.minX,
                maxX: box.maxX,
                height: box.height,
                centerY: box.centerY,
            });
        }
    }

    // Merge lines that have significant vertical overlap (e.g. multi-stroke tall symbols)
    let merged = true;
    while (merged) {
        merged = false;
        for (let i = 0; i < lines.length; i++) {
            for (let j = i + 1; j < lines.length; j++) {
                const l1 = lines[i];
                const l2 = lines[j];
                const vOverlap = Math.max(0, Math.min(l1.maxY, l2.maxY) - Math.max(l1.minY, l2.minY));
                const overlapRatio = vOverlap / Math.min(l1.height, l2.height);
                if (overlapRatio >= 0.4) {
                    l1.symbols.push(...l2.symbols);
                    l1.minY = Math.min(l1.minY, l2.minY);
                    l1.maxY = Math.max(l1.maxY, l2.maxY);
                    l1.minX = Math.min(l1.minX, l2.minX);
                    l1.maxX = Math.max(l1.maxX, l2.maxX);
                    l1.height = l1.maxY - l1.minY;
                    l1.centerY = (l1.minY + l1.maxY) / 2;
                    lines.splice(j, 1);
                    merged = true;
                    break;
                }
            }
            if (merged) break;
        }
    }

    // Sort lines top to bottom by vertical center
    lines.sort((a, b) => a.centerY - b.centerY);

    // Sort symbols left-to-right within each line
    return lines.map((line) => {
        line.symbols.sort((a, b) => a.boundingBox.centerX - b.boundingBox.centerX);
        return line.symbols;
    });
}

/**
 * Creates a combined multi-line evaluation result for KaTeX display and history.
 */
function createCombinedEvaluation(lines: LineResult[]): EvaluationResult {
    if (lines.length === 0) {
        return evaluateExpression([]);
    }

    if (lines.length === 1) {
        return lines[0].evaluation;
    }

    const anyError = lines.some((l) => l.evaluation.isError);
    const anyUndefined = lines.some((l) => l.evaluation.isUndefined);
    const allSuccess = lines.every((l) => l.evaluation.success || l.evaluation.isUndefined);

    // Format stacked equations cleanly in KaTeX aligned environment
    const latexLines = lines
        .map((l) => {
            const raw = l.evaluation.latex || l.rawTokens.join(" ");
            return raw;
        })
        .filter((l) => l.trim().length > 0);

    const fullLatex = `\\begin{aligned} ${latexLines.join(" \\\\[6pt] ")} \\end{aligned}`;
    const resultStrings = lines
        .map((l) => {
            if (l.evaluation.isAssignment && l.evaluation.assignedVariable) {
                return `${l.evaluation.assignedVariable} = ${l.evaluation.resultString}`;
            }
            return l.evaluation.resultString;
        })
        .filter((s) => s.length > 0);

    return {
        success: allSuccess,
        isUndefined: anyUndefined,
        isError: anyError,
        resultString: resultStrings.join(", "),
        value: lines[lines.length - 1].evaluation.value,
        latex: fullLatex,
        formulaLatex: lines.map((l) => l.evaluation.formulaLatex).join("; "),
        rawTokens: lines.flatMap((l) => l.rawTokens),
        assembledTokens: lines.flatMap((l) => l.assembledTokens),
        errorMessage: lines.find((l) => l.evaluation.isError)?.evaluation.errorMessage,
    };
}

/**
 * Converts recognized symbols on a line into raw tokens, detecting elevated superscript exponents (e.g. x^2, x^3).
 */
export function extractLineTokensWithSuperscripts(symbols: RecognizedSymbolItem[]): string[] {
    const tokens: string[] = [];
    for (let i = 0; i < symbols.length; i++) {
        const sym = symbols[i];
        if (i > 0) {
            const prev = symbols[i - 1];
            const isPrevBase =
                prev.symbol === "x" ||
                prev.symbol === "y" ||
                prev.symbol === ")" ||
                /^\d+$/.test(prev.symbol);

            const isElevated =
                sym.boundingBox.centerY < prev.boundingBox.centerY - 0.20 * prev.boundingBox.height;
            const isHorizontallyAdjacent =
                sym.boundingBox.minX >= prev.boundingBox.centerX &&
                sym.boundingBox.minX <= prev.boundingBox.maxX + prev.boundingBox.width * 1.5;
            const isDigitOrVar = /^\d+$/.test(sym.symbol) || sym.symbol === "x" || sym.symbol === "y";

            if (
                isPrevBase &&
                isElevated &&
                isHorizontallyAdjacent &&
                isDigitOrVar &&
                sym.symbol !== "^" &&
                sym.symbol !== "+" &&
                sym.symbol !== "-" &&
                sym.symbol !== "="
            ) {
                tokens.push("^");
            }
        }
        tokens.push(sym.symbol);
    }
    return tokens;
}

/**
 * Recognizes all symbols written on the canvas, clusters them into distinct lines,
 * and calculates mathematical expressions line-by-line while propagating variable memory scope.
 */
export async function recognizeAndEvaluateExpression(
    strokes: Stroke[],
    initialScope?: Record<string, number>
): Promise<MultiSymbolResult> {
    const startTime = performance.now();

    if (strokes.length === 0) {
        const emptyEval = evaluateExpression([]);
        return {
            lines: [],
            symbols: [],
            rawTokens: [],
            assembledTokens: [],
            evaluation: emptyEval,
            executionTimeMs: 0,
            variables: { ...(initialScope || {}) },
        };
    }

    // 1. Segment and group strokes into individual symbol units
    const groups = groupStrokes(strokes);

    // 2. Perform parallel recognition on all symbol groups
    const symbolPromises = groups.map(async (group, index) => {
        const symbol = await recognizeSymbol(group);
        const bbox = getGroupBoundingBox(group);
        return {
            id: index + 1,
            symbol,
            strokes: group.map((s) => s.stroke),
            boundingBox: bbox,
        };
    });

    const symbols = await Promise.all(symbolPromises);

    // 3. Cluster symbols into horizontal lines (top-to-bottom, each line left-to-right)
    const lineSymbolGroups = clusterSymbolsIntoLines(symbols);

    // 4. Evaluate each line sequentially, propagating variable scope and carrying over answers
    const runningScope: Record<string, number> = { ...(initialScope || {}) };
    const lines: LineResult[] = [];

    for (let index = 0; index < lineSymbolGroups.length; index++) {
        const lineSymbols = lineSymbolGroups[index];
        const lineRawTokens = extractLineTokensWithSuperscripts(lineSymbols);

        // Find all indices of '=' in this line
        const equalsIndices: number[] = [];
        for (let i = 0; i < lineSymbols.length; i++) {
            if (lineSymbols[i].symbol === "=") {
                equalsIndices.push(i);
            }
        }

        // Check for standalone 2D curve or simple variable assignment:
        // - y = f(x)
        // - x + y = 6
        // - x = 5 (single '=' at index 1 without further '=')
        const isSingleCurveOrAssignment =
            equalsIndices.length === 1 &&
            equalsIndices[0] < lineSymbols.length - 1 &&
            ((lineSymbols[0].symbol === "y" && lineRawTokens.includes("x")) ||
             (lineRawTokens.includes("x") && lineRawTokens.includes("y")) ||
             (lineSymbols[0].symbol.length === 1 && /^[a-z]$/i.test(lineSymbols[0].symbol) && equalsIndices[0] === 1));

        let stages: LineStage[] = [];
        let lineEvaluation: EvaluationResult;

        if (isSingleCurveOrAssignment) {
            // Standard single-line assignment or curve
            lineEvaluation = evaluateExpression(lineRawTokens, runningScope);
            if (
                lineEvaluation.success &&
                lineEvaluation.isAssignment &&
                lineEvaluation.assignedVariable
            ) {
                const assignedVal = lineEvaluation.assignedValue ?? lineEvaluation.value ?? 0;
                runningScope[lineEvaluation.assignedVariable] = assignedVal;
                runningScope.ans = assignedVal;
                runningScope.Ans = assignedVal;
            }

            stages = [
                {
                    stageIndex: 0,
                    symbols: lineSymbols,
                    rawTokens: lineRawTokens,
                    assembledTokens: lineEvaluation.assembledTokens,
                    evaluation: lineEvaluation,
                    hasTerminalEquals: false,
                    terminalEqualsSymbol: lineSymbols[equalsIndices[0]],
                    skipDisplayAnswer: false,
                },
            ];
        } else {
            // General multi-stage chained evaluation:
            // e.g. x + 5 = 8 + 2 = 10, or x + 5 = + 2 =, or + 2 = using previous line ans
            interface RawStageDef {
                symbols: RecognizedSymbolItem[];
                terminalEqualsSymbol?: RecognizedSymbolItem;
                hasTerminalEquals: boolean;
            }
            const stageDefs: RawStageDef[] = [];

            if (equalsIndices.length === 0) {
                stageDefs.push({
                    symbols: lineSymbols,
                    hasTerminalEquals: false,
                });
            } else {
                // First stage: symbols before first '='
                stageDefs.push({
                    symbols: lineSymbols.slice(0, equalsIndices[0]),
                    terminalEqualsSymbol: lineSymbols[equalsIndices[0]],
                    hasTerminalEquals: true,
                });

                // Intermediate stages between '=' signs
                for (let k = 1; k < equalsIndices.length; k++) {
                    stageDefs.push({
                        symbols: lineSymbols.slice(equalsIndices[k - 1] + 1, equalsIndices[k]),
                        terminalEqualsSymbol: lineSymbols[equalsIndices[k]],
                        hasTerminalEquals: true,
                    });
                }

                // Trailing symbols written after the last '=' (user is currently continuing to write)
                const lastEq = equalsIndices[equalsIndices.length - 1];
                if (lastEq < lineSymbols.length - 1) {
                    stageDefs.push({
                        symbols: lineSymbols.slice(lastEq + 1),
                        hasTerminalEquals: false,
                    });
                }
            }

            let previousStageResult: EvaluationResult | null = null;

            for (let sIdx = 0; sIdx < stageDefs.length; sIdx++) {
                const def = stageDefs[sIdx];
                let stageTokens = extractLineTokensWithSuperscripts(def.symbols);

                const startsWithBinaryOp =
                    stageTokens.length > 0 && ["+", "-", "*", "/", "^"].includes(stageTokens[0]);

                // Determine previous result to carry over:
                let carryValue: number | null = null;
                if (previousStageResult && previousStageResult.value !== null) {
                    carryValue = previousStageResult.value;
                } else if (runningScope.ans !== undefined) {
                    carryValue = runningScope.ans;
                } else if (runningScope.Ans !== undefined) {
                    carryValue = runningScope.Ans;
                }

                if (startsWithBinaryOp && carryValue !== null) {
                    stageTokens = [formatNumber(carryValue), ...stageTokens];
                }

                // If user handwrote the number after '=':
                // e.g. Stage 0 evaluated to 8. Stage 1 begins with handwritten '8'.
                // Then don't draw duplicate synthetic text for Stage 0!
                if (
                    sIdx > 0 &&
                    def.symbols.length > 0 &&
                    previousStageResult &&
                    previousStageResult.value !== null
                ) {
                    const firstSym = def.symbols[0].symbol;
                    const prevStr = previousStageResult.resultString;
                    if (firstSym === prevStr || (/^\d+$/.test(firstSym) && firstSym === formatNumber(previousStageResult.value))) {
                        if (stages[sIdx - 1]) {
                            stages[sIdx - 1].skipDisplayAnswer = true;
                        }
                    }
                }

                const stageEval = evaluateExpression(stageTokens, runningScope);

                if (stageEval.success && stageEval.isAssignment && stageEval.assignedVariable) {
                    const assignedVal = stageEval.assignedValue ?? stageEval.value ?? 0;
                    runningScope[stageEval.assignedVariable] = assignedVal;
                    runningScope.ans = assignedVal;
                    runningScope.Ans = assignedVal;
                } else if (stageEval.success && stageEval.value !== null) {
                    runningScope.ans = stageEval.value;
                    runningScope.Ans = stageEval.value;
                }

                previousStageResult = stageEval;

                stages.push({
                    stageIndex: sIdx,
                    symbols: def.symbols,
                    rawTokens: stageTokens,
                    assembledTokens: stageEval.assembledTokens,
                    evaluation: stageEval,
                    hasTerminalEquals: def.hasTerminalEquals,
                    terminalEqualsSymbol: def.terminalEqualsSymbol,
                    skipDisplayAnswer: false,
                });
            }

            // Pick the active evaluation for the whole line:
            // Prefer the last stage that has terminal equals and succeeded, or the final stage
            const finishedStages = stages.filter((s) => s.hasTerminalEquals && s.evaluation.success);
            const activeStage =
                finishedStages.length > 0
                    ? finishedStages[finishedStages.length - 1]
                    : stages[stages.length - 1];

            lineEvaluation = activeStage.evaluation;

            // Build chained equation LaTeX if multiple stages succeeded
            if (stages.length > 1 && finishedStages.length > 1) {
                const chainParts: string[] = [];
                for (const st of stages) {
                    if (st.hasTerminalEquals && st.evaluation.success) {
                        if (chainParts.length === 0) {
                            chainParts.push(st.evaluation.formulaLatex || st.rawTokens.join(" "));
                        }
                        chainParts.push(st.evaluation.resultString);
                    }
                }
                if (chainParts.length > 1) {
                    lineEvaluation = {
                        ...lineEvaluation,
                        latex: chainParts.join(" = "),
                    };
                }
            }
        }

        const hasTerminalEquals =
            lineSymbols.length > 0 && lineSymbols[lineSymbols.length - 1].symbol === "=";

        let minY = Infinity;
        let maxY = -Infinity;
        let minX = Infinity;
        let maxX = -Infinity;

        for (const s of lineSymbols) {
            if (s.boundingBox.minY < minY) minY = s.boundingBox.minY;
            if (s.boundingBox.maxY > maxY) maxY = s.boundingBox.maxY;
            if (s.boundingBox.minX < minX) minX = s.boundingBox.minX;
            if (s.boundingBox.maxX > maxX) maxX = s.boundingBox.maxX;
        }

        lines.push({
            lineIndex: index + 1,
            symbols: lineSymbols,
            rawTokens: lineRawTokens,
            assembledTokens: lineEvaluation.assembledTokens,
            evaluation: lineEvaluation,
            stages,
            boundingBox: {
                minX: minX === Infinity ? 0 : minX,
                maxX: maxX === -Infinity ? 0 : maxX,
                minY: minY === Infinity ? 0 : minY,
                maxY: maxY === -Infinity ? 0 : maxY,
                width: maxX - minX,
                height: maxY - minY,
                centerX: (minX + maxX) / 2,
                centerY: (minY + maxY) / 2,
            },
            hasTerminalEquals,
        });
    }

    // 5. Generate combined evaluation for multi-line display and backward compatibility
    const evaluation = createCombinedEvaluation(lines);
    const executionTimeMs = Math.round(performance.now() - startTime);

    return {
        lines,
        symbols: lines.flatMap((l) => l.symbols),
        rawTokens: lines.flatMap((l) => l.rawTokens),
        assembledTokens: lines.flatMap((l) => l.assembledTokens),
        evaluation,
        executionTimeMs,
        variables: { ...runningScope },
    };
}
