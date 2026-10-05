/**
 * 2D Function Curve Detection & Mathematical Analysis Engine for CalcInk
 * 
 * Detects algebraic curves written in terms of x and y:
 * - Explicit functions: y = f(x) (e.g. y = x^2, y = 2x + 1, y = sin(x), y = 1/x)
 * - Implicit linear/algebraic relations: LHS(x, y) = RHS(x, y) (e.g. x + y = 6, 2x - y = 4)
 * - Expressions in x: f(x) (e.g. x^2 - 4, 2x + 1, x^3 - 3x)
 * 
 * Computes:
 * - Deterministic, safe numerical evaluator fn(x)
 * - Analytical & numerical roots (x-intercepts where f(x) = 0)
 * - y-intercept (f(0))
 * - Local extrema & vertex (min / max)
 * - Analytical expression classification (Linear, Quadratic Parabola, Trigonometric, etc.)
 * - Integer value table for quick reference
 */

import type { LineResult } from "../recognition/multiSymbol";
import {
    assembleTokens,
    parseAndEvaluate,
    generateLatex,
    type ParsedToken,
} from "./evaluator";

export interface ExtremaPoint {
    x: number;
    y: number;
    type: "min" | "max" | "inflection";
    label: string;
}

export interface PlottableCurve {
    id: string;
    lineIndex: number;
    rawTokens: string[];
    assembledTokens: string[];
    equationText: string;
    latex: string;
    fnLatex: string;
    fn: (x: number) => number;
    expressionType: "linear" | "quadratic" | "polynomial" | "trigonometric" | "rational" | "constant" | "general";
    roots: number[];
    yIntercept: number | null;
    extrema: ExtremaPoint[];
    coefficients?: { a?: number; b?: number; c?: number };
    domain: [number, number];
    rangeY: [number, number];
    tableValues: { x: number; y: number | null }[];
}

/**
 * Safely evaluates a parsed token sequence at a given x value.
 * Returns NaN if division by zero or mathematical error occurs.
 */
function evaluateTokensAt(
    tokens: ParsedToken[],
    xVal: number,
    baseScope?: Record<string, number>
): number {
    try {
        const val = parseAndEvaluate(tokens, { ...(baseScope || {}), x: xVal });
        if (typeof val !== "number" || isNaN(val) || !isFinite(val)) {
            return NaN;
        }
        return val;
    } catch {
        return NaN;
    }
}

/**
 * Safely evaluates a parsed token sequence at given x and y values.
 */
function evaluateTokensAtXY(
    tokens: ParsedToken[],
    xVal: number,
    yVal: number,
    baseScope?: Record<string, number>
): number {
    try {
        const val = parseAndEvaluate(tokens, { ...(baseScope || {}), x: xVal, y: yVal });
        if (typeof val !== "number" || isNaN(val) || !isFinite(val)) {
            return NaN;
        }
        return val;
    } catch {
        return NaN;
    }
}

/**
 * Analyzes a mathematical function f(x) over a sample range to find:
 * - Roots (x-intercepts where f(x) = 0)
 * - y-intercept (f(0))
 * - Extrema / vertex
 * - Function classification (linear, quadratic, etc.)
 */
function analyzeFunction(
    fn: (x: number) => number,
    rawTokensText: string
): {
    expressionType: PlottableCurve["expressionType"];
    roots: number[];
    yIntercept: number | null;
    extrema: ExtremaPoint[];
    coefficients?: { a?: number; b?: number; c?: number };
} {
    // 1. y-intercept
    const yAt0 = fn(0);
    const yIntercept = isFinite(yAt0) && !isNaN(yAt0) ? Math.round(yAt0 * 1000) / 1000 : null;

    // 2. Check for trigonometric or rational tokens
    const lowerText = rawTokensText.toLowerCase();
    const isTrig = ["sin", "cos", "tan"].some((trig) => lowerText.includes(trig));
    const isRational = lowerText.includes("/") || lowerText.includes("\\div");

    // 3. Test polynomial degrees using finite differences: f(0), f(1), f(-1), f(2), f(-2)
    const f0 = fn(0);
    const f1 = fn(1);
    const f_1 = fn(-1);
    const f2 = fn(2);
    const f_2 = fn(-2);

    let expressionType: PlottableCurve["expressionType"] = "general";
    const extrema: ExtremaPoint[] = [];
    const rootsSet: Set<number> = new Set();
    let coefficients: { a?: number; b?: number; c?: number } | undefined;

    if (
        !isTrig &&
        !isRational &&
        isFinite(f0) &&
        isFinite(f1) &&
        isFinite(f_1) &&
        isFinite(f2) &&
        isFinite(f_2)
    ) {
        // If constant: f(x) = c
        if (Math.abs(f1 - f0) < 1e-5 && Math.abs(f_1 - f0) < 1e-5 && Math.abs(f2 - f0) < 1e-5) {
            expressionType = "constant";
            coefficients = { c: f0 };
        } else {
            // Check for quadratic: f(x) = ax^2 + bx + c
            const c = f0;
            const a = (f1 + f_1 - 2 * c) / 2;
            const b = (f1 - f_1) / 2;

            const expectedF2 = 4 * a + 2 * b + c;
            const expectedF_2 = 4 * a - 2 * b + c;

            if (
                Math.abs(f2 - expectedF2) < 1e-3 &&
                Math.abs(f_2 - expectedF_2) < 1e-3
            ) {
                if (Math.abs(a) > 1e-5) {
                    expressionType = "quadratic";
                    coefficients = { a: Math.round(a * 1000) / 1000, b: Math.round(b * 1000) / 1000, c: Math.round(c * 1000) / 1000 };

                    // Vertex: x = -b / (2a)
                    const vx = -b / (2 * a);
                    const vy = fn(vx);
                    if (isFinite(vy) && !isNaN(vy)) {
                        extrema.push({
                            x: Math.round(vx * 1000) / 1000,
                            y: Math.round(vy * 1000) / 1000,
                            type: a > 0 ? "min" : "max",
                            label: a > 0 ? "Vertex (Min)" : "Vertex (Max)",
                        });
                    }

                    // Quadratic roots via discriminant
                    const disc = b * b - 4 * a * c;
                    if (disc >= 0) {
                        const r1 = (-b - Math.sqrt(disc)) / (2 * a);
                        const r2 = (-b + Math.sqrt(disc)) / (2 * a);
                        rootsSet.add(Math.round(r1 * 1000) / 1000);
                        rootsSet.add(Math.round(r2 * 1000) / 1000);
                    }
                } else if (Math.abs(b) > 1e-5) {
                    // Linear: f(x) = bx + c
                    expressionType = "linear";
                    coefficients = { b: Math.round(b * 1000) / 1000, c: Math.round(c * 1000) / 1000 };
                    const linearRoot = -c / b;
                    rootsSet.add(Math.round(linearRoot * 1000) / 1000);
                }
            } else {
                expressionType = "polynomial";
            }
        }
    } else if (isTrig) {
        expressionType = "trigonometric";
    } else if (isRational) {
        expressionType = "rational";
    }

    // 4. Numerical root finding and extrema search if not already analytically found
    const searchMin = -15;
    const searchMax = 15;
    const step = 0.1;

    let prevX = searchMin;
    let prevY = fn(prevX);
    let prevSlope = NaN;

    for (let x = searchMin + step; x <= searchMax; x += step) {
        const y = fn(x);

        if (isFinite(prevY) && isFinite(y) && !isNaN(prevY) && !isNaN(y)) {
            // Root bracket check: sign change across [prevX, x]
            if ((prevY <= 0 && y >= 0) || (prevY >= 0 && y <= 0)) {
                // Refine root using bisection
                let low = prevX;
                let high = x;
                for (let iter = 0; iter < 16; iter++) {
                    const mid = (low + high) / 2;
                    const fMid = fn(mid);
                    if (Math.abs(fMid) < 1e-6) {
                        low = mid;
                        break;
                    }
                    if ((fn(low) <= 0 && fMid >= 0) || (fn(low) >= 0 && fMid <= 0)) {
                        high = mid;
                    } else {
                        low = mid;
                    }
                }
                const rootVal = Math.round(((low + high) / 2) * 1000) / 1000;
                if (!isNaN(rootVal) && isFinite(rootVal) && Math.abs(fn(rootVal)) < 0.05) {
                    rootsSet.add(rootVal);
                }
            }

            // Extrema check via numerical slope sign change (if not quadratic)
            if (expressionType !== "quadratic" && expressionType !== "linear" && expressionType !== "constant") {
                const curSlope = (y - prevY) / step;
                if (!isNaN(prevSlope)) {
                    if (prevSlope > 0 && curSlope < 0) {
                        // Local maximum
                        const midX = (prevX + x) / 2;
                        extrema.push({
                            x: Math.round(midX * 1000) / 1000,
                            y: Math.round(fn(midX) * 1000) / 1000,
                            type: "max",
                            label: "Local Max",
                        });
                    } else if (prevSlope < 0 && curSlope > 0) {
                        // Local minimum
                        const midX = (prevX + x) / 2;
                        extrema.push({
                            x: Math.round(midX * 1000) / 1000,
                            y: Math.round(fn(midX) * 1000) / 1000,
                            type: "min",
                            label: "Local Min",
                        });
                    }
                }
                prevSlope = curSlope;
            }
        }

        prevX = x;
        prevY = y;
    }

    const roots = Array.from(rootsSet).sort((a, b) => a - b);

    return {
        expressionType,
        roots,
        yIntercept,
        extrema: extrema.slice(0, 4), // keep up to 4 significant extrema
        coefficients,
    };
}

/**
 * Detects all plottable 2D function curves from recognized lines of handwriting.
 */
export function detectPlottableCurves(
    lines: LineResult[],
    variables?: Record<string, number>
): PlottableCurve[] {
    const curves: PlottableCurve[] = [];

    for (const line of lines) {
        const rawTokens = line.rawTokens || [];
        if (rawTokens.length === 0) continue;

        // Skip lines that are solved arithmetic evaluations (e.g. x + 5 = 8)
        if (line.hasTerminalEquals && line.evaluation.value !== null && !line.evaluation.isAssignment) {
            continue;
        }

        // Skip simple scalar variable assignments (e.g. x = 3, y = 10)
        if (
            line.evaluation.isAssignment &&
            line.evaluation.assignedVariable !== "y" &&
            typeof line.evaluation.assignedValue === "number"
        ) {
            continue;
        }

        try {
            const assembled = assembleTokens(rawTokens, variables);
            const tokens = assembled.tokens;

            const hasX = tokens.some((t) => t.type === "IDENTIFIER" && t.value === "x");
            const hasY = tokens.some((t) => t.type === "IDENTIFIER" && t.value === "y");

            // We only care about expressions/equations involving x (or both x and y)
            if (!hasX && !hasY) {
                continue;
            }

            let fn: ((x: number) => number) | null = null;
            let equationText = "";
            let latex = "";
            let fnLatex = "";

            // Case 1: Explicit y = f(x) assignment or equation (where RHS contains x)
            if (
                assembled.isAssignment &&
                assembled.assignedVariable === "y" &&
                assembled.rhsTokens &&
                assembled.rhsTokens.length > 0 &&
                assembled.rhsTokens.some((t) => t.type === "IDENTIFIER" && t.value === "x")
            ) {
                const rhsTokens = assembled.rhsTokens;
                fn = (x: number) => evaluateTokensAt(rhsTokens, x, variables);
                const latexRes = generateLatex(rhsTokens, null, false);
                fnLatex = latexRes.formulaLatex;
                equationText = `y = ${rhsTokens.map((t) => t.text).join(" ")}`;
                latex = `y = ${fnLatex}`;
            }

            // Case 2: General equation LHS = RHS containing x and y (e.g. x + y = 6, 2x - y = 4, x^2 - 4 = y)
            else if (assembled.isEquation && assembled.lhsTokens && assembled.rhsTokens) {
                const lhsTokens = assembled.lhsTokens;
                const rhsTokens = assembled.rhsTokens;

                // Check if LHS is simply 'y': y = RHS(x)
                if (lhsTokens.length === 1 && lhsTokens[0].value === "y") {
                    fn = (x: number) => evaluateTokensAt(rhsTokens, x, variables);
                    const latexRes = generateLatex(rhsTokens, null, false);
                    fnLatex = latexRes.formulaLatex;
                    equationText = `y = ${rhsTokens.map((t) => t.text).join(" ")}`;
                    latex = `y = ${fnLatex}`;
                }
                // Check if RHS is simply 'y': LHS(x) = y -> y = LHS(x)
                else if (rhsTokens.length === 1 && rhsTokens[0].value === "y") {
                    fn = (x: number) => evaluateTokensAt(lhsTokens, x, variables);
                    const latexRes = generateLatex(lhsTokens, null, false);
                    fnLatex = latexRes.formulaLatex;
                    equationText = `y = ${lhsTokens.map((t) => t.text).join(" ")}`;
                    latex = `y = ${fnLatex}`;
                }
                // General relation: E(x, y) = LHS(x, y) - RHS(x, y) = 0
                // If linear in y: y(x) = -E(x, 0) / (E(0, 1) - E(0, 0))
                else if (hasY) {
                    const E = (x: number, y: number) =>
                        evaluateTokensAtXY(lhsTokens, x, y, variables) -
                        evaluateTokensAtXY(rhsTokens, x, y, variables);

                    const e01 = E(0, 1);
                    const e00 = E(0, 0);
                    const aCoeff = e01 - e00;

                    if (isFinite(aCoeff) && Math.abs(aCoeff) > 1e-6) {
                        fn = (x: number) => -E(x, 0) / aCoeff;
                        const fullLatexRes = generateLatex(tokens, null, false);
                        equationText = assembled.assembledStrings.join(" ");
                        latex = fullLatexRes.fullLatex;
                        fnLatex = latex;
                    }
                }
            }

            // Case 3: Expression in terms of 'x' without 'y' (e.g. x^2 - 4, 2x + 1, x^3 - 3x)
            // Only consider it a curve if it is NOT an evaluated calculation with trailing '='
            else if (hasX && !hasY && !line.hasTerminalEquals && line.evaluation.value === null) {
                const exprTokens = tokens.filter((t) => t.value !== "=");
                fn = (x: number) => evaluateTokensAt(exprTokens, x, variables);
                const latexRes = generateLatex(exprTokens, null, false);
                fnLatex = latexRes.formulaLatex;
                equationText = `y = ${exprTokens.map((t) => t.text).join(" ")}`;
                latex = `y = ${fnLatex}`;
            }

            if (!fn) continue;

            // Verify function produces valid values for at least some sample points
            const testPoints = [-2, -1, 0, 1, 2];
            const testVals = testPoints.map(fn);
            const validCount = testVals.filter((v) => isFinite(v) && !isNaN(v)).length;
            if (validCount < 2) {
                continue;
            }

            // Analyze mathematical properties
            const analysis = analyzeFunction(fn, rawTokens.join(" "));

            // Generate integer table of values (-4 to 4)
            const tableValues: { x: number; y: number | null }[] = [];
            for (let x = -4; x <= 4; x++) {
                const y = fn(x);
                tableValues.push({
                    x,
                    y: isFinite(y) && !isNaN(y) ? Math.round(y * 1000) / 1000 : null,
                });
            }

            curves.push({
                id: `curve-${line.lineIndex}-${Date.now()}`,
                lineIndex: line.lineIndex,
                rawTokens,
                assembledTokens: assembled.assembledStrings,
                equationText,
                latex,
                fnLatex,
                fn,
                expressionType: analysis.expressionType,
                roots: analysis.roots,
                yIntercept: analysis.yIntercept,
                extrema: analysis.extrema,
                coefficients: analysis.coefficients,
                domain: [-10, 10],
                rangeY: [-10, 10],
                tableValues,
            });
        } catch {
            // Skip unparseable lines cleanly without crashing
            continue;
        }
    }

    return curves;
}
