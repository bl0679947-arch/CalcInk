/**
 * Safe Deterministic Arithmetic Parser, Variable Memory Evaluator & LaTeX Generator for CalcInk
 * 
 * Rules & Constraints:
 * 1. Follows standard operator precedence (BODMAS / PEMDAS).
 * 2. Supports multi-digit integers, floating-point decimals, and negative numbers.
 * 3. NO eval() or Function() used. Fully deterministic recursive descent parser.
 * 4. Division by zero safely yields "Undefined".
 * 5. Malformed syntax is caught cleanly with descriptive errors, without unhandled exceptions.
 * 6. Supports variable assignment (e.g. x = 10, y = 20, z = x + y) and sequential scope memory.
 * 7. Resolves ambiguity between variable 'x' and multiplication operator '*'.
 */

export class DivisionByZeroError extends Error {
    constructor() {
        super("Division by zero");
        this.name = "DivisionByZeroError";
    }
}

export class MathSyntaxError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "MathSyntaxError";
    }
}

export interface ParsedToken {
    type: "NUMBER" | "OP" | "IDENTIFIER";
    value: number | string;
    text: string;
}

export interface AssembledExpression {
    tokens: ParsedToken[];
    hasTrailingEquals: boolean;
    assembledStrings: string[];
    isAssignment?: boolean;
    assignedVariable?: string;
    rhsTokens?: ParsedToken[];
    isEquation?: boolean;
    lhsTokens?: ParsedToken[];
}

export interface EvaluationResult {
    success: boolean;
    isUndefined: boolean;
    isError: boolean;
    resultString: string; // e.g. "19.5", "Undefined", "Syntax Error"
    value: number | null; // numeric value or null
    latex: string; // full LaTeX equation e.g. "12.5 + 7 = 19.5" or "x = 10"
    formulaLatex: string; // LHS formula e.g. "12.5 + 7" or "x"
    rawTokens: string[];
    assembledTokens: string[];
    errorMessage?: string;
    isAssignment?: boolean;
    assignedVariable?: string;
    assignedValue?: number;
    isCurve?: boolean;
    curveVariable?: "x" | "y";
}

/**
 * Standard LaTeX / symbol aliases to standard operator characters.
 */
const SYMBOL_ALIASES: Record<string, string> = {
    "\\times": "*",
    "\\cdot": "*",
    "\\ast": "*",
    "\\div": "/",
    "\\slash": "/",
    "÷": "/",
    "\\minus": "-",
    "\\horizbar": "-",
    "\\textendash": "-",
    "\\textemdash": "-",
    "–": "-",
    "—": "-",
    "\\pm": "+",
    "\\dagger": "+",
    "\\oplus": "+",
    "(": "(",
    ")": ")",
    "[": "(",
    "]": ")",
    "\\left(": "(",
    "\\right)": ")",
    "\\lbrack": "(",
    "\\rbrack": ")",
    "=": "=",
    "\\equiv": "=",
    "\\doteq": "=",
    "\\wedge": "^",
    "\\barwedge": "^",
    "\\hat": "^",
    "^": "^",
    "\\sin": "sin",
    "\\cos": "cos",
    "\\tan": "tan",
    "\\sqrt": "sqrt",
    "\\abs": "abs",
    "\\ln": "ln",
    "\\log": "log",
    "\\exp": "exp",
};

const MATH_FUNCTIONS = new Set(["sin", "cos", "tan", "sqrt", "abs", "ln", "log", "exp"]);

/**
 * Normalizes raw symbol predictions into uniform arithmetic tokens,
 * contextually resolving 'x' into either multiplication '*' or variable identifier 'x'.
 */
export function normalizeTokens(
    rawTokens: string[],
    _scope?: Record<string, number>
): string[] {
    const normalized: string[] = [];

    for (let i = 0; i < rawTokens.length; i++) {
        const token = rawTokens[i].trim();
        if (!token) continue;

        const lowerToken = token.toLowerCase();

        // Fuse sequences of individual letters into multi-character keywords (ans, sin, cos, tan, log)
        if (
            i + 2 < rawTokens.length &&
            rawTokens[i].toLowerCase() === "a" &&
            rawTokens[i + 1].toLowerCase() === "n" &&
            rawTokens[i + 2].toLowerCase() === "s"
        ) {
            normalized.push("ans");
            i += 2;
            continue;
        }

        if (
            i + 2 < rawTokens.length &&
            rawTokens[i].toLowerCase() === "s" &&
            rawTokens[i + 1].toLowerCase() === "i" &&
            rawTokens[i + 2].toLowerCase() === "n"
        ) {
            normalized.push("sin");
            i += 2;
            continue;
        }

        if (
            i + 2 < rawTokens.length &&
            rawTokens[i].toLowerCase() === "c" &&
            rawTokens[i + 1].toLowerCase() === "o" &&
            rawTokens[i + 2].toLowerCase() === "s"
        ) {
            normalized.push("cos");
            i += 2;
            continue;
        }

        if (
            i + 2 < rawTokens.length &&
            rawTokens[i].toLowerCase() === "t" &&
            rawTokens[i + 1].toLowerCase() === "a" &&
            rawTokens[i + 2].toLowerCase() === "n"
        ) {
            normalized.push("tan");
            i += 2;
            continue;
        }

        if (
            i + 2 < rawTokens.length &&
            rawTokens[i].toLowerCase() === "l" &&
            rawTokens[i + 1].toLowerCase() === "o" &&
            rawTokens[i + 2].toLowerCase() === "g"
        ) {
            normalized.push("log");
            i += 2;
            continue;
        }

        // Contextual disambiguation of 'x' or 'X'
        if (token === "x" || token === "X") {
            const next = rawTokens[i + 1]?.trim();
            const prev = rawTokens[i - 1]?.trim();

            // If between two numbers e.g. "4 x 5", it's arithmetic multiplication '*'
            if (prev && /^\d+(\.\d+)?$/.test(prev) && next && /^\d+(\.\d+)?$/.test(next)) {
                normalized.push("*");
            } else {
                // In algebra, equations (y = x), functions (x^2), coefficients (2x), it's variable 'x'
                normalized.push("x");
            }
            continue;
        }

        if (MATH_FUNCTIONS.has(lowerToken)) {
            normalized.push(lowerToken);
            continue;
        }

        if (lowerToken === "ans") {
            normalized.push("ans");
            continue;
        }

        // Other single-letter variables: y, Y, a, A, b, B, z, Z, etc.
        if (/^[a-zA-Z]$/.test(token)) {
            normalized.push(token.toLowerCase());
            continue;
        }

        normalized.push(SYMBOL_ALIASES[token] || token);
    }

    return normalized;
}

/**
 * Detects whether tokens have invalid placement of consecutive binary operators (e.g. "+ +", "* /", "+ *", "/ /").
 */
export function hasConsecutiveOperators(
    rawTokens: string[],
    scope?: Record<string, number>
): boolean {
    const normalized = normalizeTokens(rawTokens, scope);
    const binaryOps = ["+", "-", "*", "/", "^"];

    // Check leading invalid binary operators like "* 5" or "/ 8" UNLESS scope has an answer 'ans'
    const hasAnsInScope = scope && (scope.ans !== undefined || scope.Ans !== undefined);
    if (normalized.length > 0 && ["*", "/", "^"].includes(normalized[0]) && !hasAnsInScope) {
        return true;
    }

    // Allow assignment pattern "x = ..." without flagging '='
    for (let i = 0; i < normalized.length - 1; i++) {
        const cur = normalized[i];
        const next = normalized[i + 1];
        if (binaryOps.includes(cur) && binaryOps.includes(next)) {
            return true;
        }
    }

    return false;
}

/**
 * Helper to assemble a sequence of normalized tokens into ParsedTokens.
 */
function assembleTokenSequence(tokens: string[]): ParsedToken[] {
    const assembled: ParsedToken[] = [];
    let i = 0;

    while (i < tokens.length) {
        const t = tokens[i];

        // Is it a digit or a decimal point?
        if (/^\d+$/.test(t) || t === ".") {
            let numStr = "";
            let dotCount = 0;

            while (
                i < tokens.length &&
                (/^\d+$/.test(tokens[i]) || tokens[i] === ".")
            ) {
                if (tokens[i] === ".") {
                    dotCount++;
                    if (dotCount > 1) {
                        throw new MathSyntaxError(
                            `Invalid decimal number "${numStr}." with multiple decimal points`
                        );
                    }
                }
                numStr += tokens[i];
                i++;
            }

            if (numStr === ".") {
                throw new MathSyntaxError("Isolated decimal point '.' without digits");
            }

            if (numStr.endsWith(".")) {
                throw new MathSyntaxError(
                    `Incomplete decimal number "${numStr}" without fractional digits`
                );
            }

            const numVal = parseFloat(numStr);
            if (isNaN(numVal)) {
                throw new MathSyntaxError(`Invalid numeric literal "${numStr}"`);
            }

            assembled.push({ type: "NUMBER", value: numVal, text: numStr });
        } else if (/^[a-zA-Z]+$/.test(t)) {
            // Variable or function identifier
            const varName = t.toLowerCase();
            assembled.push({ type: "IDENTIFIER", value: varName, text: varName });
            i++;
        } else if (["+", "-", "*", "/", "(", ")", "^"].includes(t)) {
            assembled.push({ type: "OP", value: t, text: t });
            i++;
        } else {
            throw new MathSyntaxError(`Unrecognized symbol "${t}"`);
        }
    }

    return assembled;
}

/**
 * Assembles raw single-character/digit tokens into multi-digit numbers,
 * decimals, variables, and operators. Also detects variable assignment statements
 * and general algebraic equations (e.g. x + y = 6).
 */
export function assembleTokens(
    rawTokens: string[],
    scope?: Record<string, number>
): AssembledExpression {
    const normalized = normalizeTokens(rawTokens, scope);
    if (normalized.length === 0) {
        throw new MathSyntaxError("No symbols provided to evaluate");
    }

    // Check for trailing equals sign
    let hasTrailingEquals = false;
    const workingTokens = [...normalized];
    if (workingTokens[workingTokens.length - 1] === "=") {
        hasTrailingEquals = true;
        workingTokens.pop();
    }

    if (workingTokens.length === 0) {
        throw new MathSyntaxError("Expression contains only '='");
    }

    // If workingTokens starts with a binary operator (+, *, /, ^) and scope has 'ans' or 'Ans',
    // automatically prepend the previous answer to continue evaluation seamlessly
    const hasAnsInScope = scope && (scope.ans !== undefined || scope.Ans !== undefined);
    if (hasAnsInScope && workingTokens.length > 0) {
        const first = workingTokens[0];
        if (["+", "*", "/", "^"].includes(first)) {
            const ansVal = scope.ans !== undefined ? scope.ans : scope.Ans!;
            workingTokens.unshift(formatNumber(ansVal));
        }
    }

    // Check if this is a variable assignment: e.g. "x = 10", "x = 4 + 6", "y = x * 2"
    if (
        workingTokens.length >= 2 &&
        /^[a-z]$/i.test(workingTokens[0]) &&
        workingTokens[1] === "="
    ) {
        const assignedVariable = workingTokens[0].toLowerCase();
        const rhsRaw = workingTokens.slice(2);
        if (rhsRaw.length === 0) {
            throw new MathSyntaxError(`Incomplete assignment for variable '${assignedVariable}'`);
        }
        if (rhsRaw.includes("=")) {
            throw new MathSyntaxError("Unexpected '=' inside assignment expression");
        }

        const rhsTokens = assembleTokenSequence(rhsRaw);
        const assembledStrings = [assignedVariable, "=", ...rhsTokens.map((t) => t.text)];
        const fullTokens: ParsedToken[] = [
            { type: "IDENTIFIER", value: assignedVariable, text: assignedVariable },
            { type: "OP", value: "=", text: "=" },
            ...rhsTokens,
        ];

        return {
            tokens: fullTokens,
            hasTrailingEquals,
            assembledStrings,
            isAssignment: true,
            assignedVariable,
            rhsTokens,
        };
    }

    // Check for general equation containing '=' (e.g. "x + y = 6", "x^2 - 4 = y")
    if (workingTokens.includes("=")) {
        const eqIndices = workingTokens
            .map((t, idx) => (t === "=" ? idx : -1))
            .filter((idx) => idx !== -1);

        if (eqIndices.length > 1) {
            throw new MathSyntaxError("Multiple '=' signs inside equation");
        }

        const eqIdx = eqIndices[0];
        const lhsRaw = workingTokens.slice(0, eqIdx);
        const rhsRaw = workingTokens.slice(eqIdx + 1);

        if (lhsRaw.length === 0 || rhsRaw.length === 0) {
            throw new MathSyntaxError("Incomplete equation around '='");
        }

        const lhsTokens = assembleTokenSequence(lhsRaw);
        const rhsTokens = assembleTokenSequence(rhsRaw);
        const assembledStrings = [
            ...lhsTokens.map((t) => t.text),
            "=",
            ...rhsTokens.map((t) => t.text),
        ];
        const fullTokens: ParsedToken[] = [
            ...lhsTokens,
            { type: "OP", value: "=", text: "=" },
            ...rhsTokens,
        ];

        return {
            tokens: fullTokens,
            hasTrailingEquals,
            assembledStrings,
            isAssignment: false,
            isEquation: true,
            lhsTokens,
            rhsTokens,
        };
    }

    const assembled = assembleTokenSequence(workingTokens);
    return {
        tokens: assembled,
        hasTrailingEquals,
        assembledStrings: assembled.map((t) => t.text),
        isAssignment: false,
    };
}

/**
 * Deterministic recursive-descent parser implementing standard BODMAS/PEMDAS
 * with support for variables and implicit multiplication.
 * 
 * Grammar:
 * Expression -> Term ( ('+' | '-') Term )*
 * Term       -> Factor ( ('*' | '/') Factor | Factor )*  -- supports implicit multiplication
 * Factor     -> ('+' | '-') Factor | Power
 * Power      -> Primary ( '^' Factor )?
 * Primary    -> '(' Expression ')' | NUMBER | IDENTIFIER
 */
export function parseAndEvaluate(
    tokens: ParsedToken[],
    scope?: Record<string, number>
): number {
    let index = 0;

    function peek(): ParsedToken | null {
        return tokens[index] || null;
    }

    function next(): ParsedToken {
        const token = tokens[index];
        index++;
        return token;
    }

    function parseExpression(): number {
        let left = parseTerm();

        while (
            peek() &&
            peek()!.type === "OP" &&
            (peek()!.value === "+" || peek()!.value === "-")
        ) {
            const op = next().value as string;
            const right = parseTerm();
            if (op === "+") {
                left = left + right;
            } else {
                left = left - right;
            }
        }

        return left;
    }

    function parseTerm(): number {
        let left = parseFactor();

        while (index < tokens.length) {
            const token = peek();
            if (!token) break;

            if (token.type === "OP" && (token.value === "*" || token.value === "/")) {
                const op = next().value as string;
                const right = parseFactor();
                if (op === "*") {
                    left = left * right;
                } else {
                    if (Math.abs(right) < 1e-15) {
                        throw new DivisionByZeroError();
                    }
                    left = left / right;
                }
            } else if (
                token.type === "IDENTIFIER" ||
                (token.type === "OP" && token.value === "(")
            ) {
                // Implicit multiplication! e.g. 2x, 2(x + 1), (a)(b)
                const right = parseFactor();
                left = left * right;
            } else {
                break;
            }
        }

        return left;
    }

    function parseFactor(): number {
        // Unary operators (e.g. -5 or +3)
        if (peek() && peek()!.type === "OP" && peek()!.value === "+") {
            next();
            return parseFactor();
        }
        if (peek() && peek()!.type === "OP" && peek()!.value === "-") {
            next();
            return -parseFactor();
        }

        return parsePower();
    }

    function parsePower(): number {
        let left = parsePrimary();

        if (peek() && peek()!.type === "OP" && peek()!.value === "^") {
            next();
            const right = parseFactor(); // right-associative exponentiation
            left = Math.pow(left, right);
        }

        return left;
    }

    function parsePrimary(): number {
        const token = peek();
        if (!token) {
            throw new MathSyntaxError("Unexpected end of expression");
        }

        // Parentheses
        if (token.type === "OP" && token.value === "(") {
            next(); // consume '('

            if (peek() && peek()!.type === "OP" && peek()!.value === ")") {
                throw new MathSyntaxError("Empty parentheses '()'");
            }

            const val = parseExpression();
            const closeParen = peek();
            if (!closeParen || closeParen.type !== "OP" || closeParen.value !== ")") {
                throw new MathSyntaxError("Missing closing parenthesis ')'");
            }
            next(); // consume ')'
            return val;
        }

        // Function or Variable identifier
        if (token.type === "IDENTIFIER") {
            const ident = (token.value as string).toLowerCase();

            // Function evaluation
            if (MATH_FUNCTIONS.has(ident)) {
                next(); // consume function name

                let arg: number;
                if (peek() && peek()!.type === "OP" && peek()!.value === "(") {
                    next(); // consume '('
                    arg = parseExpression();
                    const closeParen = peek();
                    if (!closeParen || closeParen.type !== "OP" || closeParen.value !== ")") {
                        throw new MathSyntaxError(`Missing closing parenthesis after '${ident}'`);
                    }
                    next(); // consume ')'
                } else {
                    arg = parseFactor();
                }

                switch (ident) {
                    case "sin": return Math.sin(arg);
                    case "cos": return Math.cos(arg);
                    case "tan": return Math.tan(arg);
                    case "sqrt": {
                        if (arg < 0) throw new MathSyntaxError("Square root of negative number");
                        return Math.sqrt(arg);
                    }
                    case "abs": return Math.abs(arg);
                    case "ln": {
                        if (arg <= 0) throw new MathSyntaxError("Logarithm of non-positive number");
                        return Math.log(arg);
                    }
                    case "log": {
                        if (arg <= 0) throw new MathSyntaxError("Logarithm of non-positive number");
                        return Math.log10(arg);
                    }
                    case "exp": return Math.exp(arg);
                    default: return arg;
                }
            }

            next();
            if (scope) {
                if (ident in scope) {
                    return scope[ident];
                }
                const lower = ident.toLowerCase();
                if (lower in scope) {
                    return scope[lower];
                }
                if (ident === "ans" && "Ans" in scope) {
                    return scope["Ans"];
                }
            }
            throw new MathSyntaxError(`Variable '${token.text}' is not defined`);
        }

        // Numeric literal
        if (token.type === "NUMBER") {
            next();
            return token.value as number;
        }

        if (token.type === "OP" && token.value === ")") {
            throw new MathSyntaxError("Unexpected closing parenthesis ')'");
        }

        throw new MathSyntaxError(`Unexpected operator "${token.text}"`);
    }

    const result = parseExpression();

    if (index < tokens.length) {
        throw new MathSyntaxError(
            `Unexpected trailing symbol "${tokens[index].text}"`
        );
    }

    return result;
}

/**
 * Formats numbers removing floating point precision noise (e.g. 0.30000000000000004 -> 0.3).
 */
export function formatNumber(val: number): string {
    if (Number.isInteger(val)) {
        return val.toString();
    }
    const fixed = val.toFixed(10);
    const cleaned = parseFloat(fixed);
    return cleaned.toString();
}

/**
 * Generates beautiful LaTeX representation for KaTeX typesetting,
 * supporting expressions, variable references, and assignments.
 */
export function generateLatex(
    tokens: ParsedToken[],
    resultString: string | null,
    hasTrailingEquals: boolean,
    isAssignment?: boolean,
    assignedVariable?: string
): { fullLatex: string; formulaLatex: string } {
    if (isAssignment && assignedVariable) {
        const rhsTokens =
            tokens[0]?.type === "IDENTIFIER" && tokens[1]?.value === "="
                ? tokens.slice(2)
                : tokens;

        const rhsParts: string[] = [];
        for (let i = 0; i < rhsTokens.length; i++) {
            const t = rhsTokens[i];
            const next = rhsTokens[i + 1];
            if (t.type === "NUMBER" || t.type === "IDENTIFIER") {
                rhsParts.push(t.text);
            } else if (t.type === "OP") {
                if (t.value === "*") rhsParts.push("\\times");
                else if (t.value === "/") rhsParts.push("\\div");
                else if (t.value === "^" && next) {
                    rhsParts.push(`^{${next.text}}`);
                    i++;
                } else rhsParts.push(t.value as string);
            }
        }
        const rhsLatex = rhsParts.join(" ");

        if (resultString && rhsLatex !== resultString) {
            return {
                fullLatex: `${assignedVariable} = ${rhsLatex} = ${resultString}`,
                formulaLatex: `${assignedVariable} = ${rhsLatex}`,
            };
        } else {
            return {
                fullLatex: `${assignedVariable} = ${resultString || rhsLatex}`,
                formulaLatex: `${assignedVariable} = ${rhsLatex}`,
            };
        }
    }

    const parts: string[] = [];

    for (let i = 0; i < tokens.length; i++) {
        const t = tokens[i];
        const next = tokens[i + 1];
        if (t.type === "NUMBER" || t.type === "IDENTIFIER") {
            parts.push(t.text);
        } else if (t.type === "OP") {
            if (t.value === "*") {
                parts.push("\\times");
            } else if (t.value === "/") {
                parts.push("\\div");
            } else if (t.value === "^" && next) {
                parts.push(`^{${next.text}}`);
                i++;
            } else if (t.value === "-") {
                // If following an operator, wrap unary negative in parentheses if next is a number/identifier
                const prev = tokens[i - 1];
                if (
                    prev &&
                    prev.type === "OP" &&
                    prev.value !== ")" &&
                    next &&
                    (next.type === "NUMBER" || next.type === "IDENTIFIER")
                ) {
                    parts.push(`(-${next.text})`);
                    i++; // consume next
                    continue;
                }
                parts.push("-");
            } else {
                parts.push(t.value as string);
            }
        }
    }

    const formulaLatex = parts.join(" ");

    if (resultString) {
        if (resultString === "Undefined") {
            return {
                fullLatex: `${formulaLatex} = \\text{Undefined}`,
                formulaLatex,
            };
        }
        return {
            fullLatex: `${formulaLatex} = ${resultString}`,
            formulaLatex,
        };
    } else if (hasTrailingEquals) {
        return {
            fullLatex: `${formulaLatex} =`,
            formulaLatex,
        };
    }

    return {
        fullLatex: formulaLatex,
        formulaLatex,
    };
}

/**
 * Evaluates an array of recognized symbol tokens or a string expression.
 * Accepts an optional variable memory scope.
 * Never throws unhandled exceptions.
 */
export function evaluateExpression(
    input: string[] | string,
    scope?: Record<string, number>
): EvaluationResult {
    let rawTokens: string[];

    if (typeof input === "string") {
        const matches = input.match(/\\?[a-zA-Z]+|\d+|\.|\+|-|\*|\/|\(|\)|\^|=|\S/g);
        rawTokens = matches ? matches : [];
    } else {
        rawTokens = input;
    }

    if (rawTokens.length === 0) {
        return {
            success: false,
            isUndefined: false,
            isError: true,
            resultString: "Empty Expression",
            errorMessage: "No symbols detected. Draw an equation on the canvas.",
            value: null,
            latex: "\\text{No expression detected}",
            formulaLatex: "",
            rawTokens: [],
            assembledTokens: [],
        };
    }

    try {
        const assembledRes = assembleTokens(rawTokens, scope);

        // 1. Variable Assignment (e.g. x = 10, y = 20, or curve definition y = x^2)
        if (assembledRes.isAssignment && assembledRes.assignedVariable && assembledRes.rhsTokens) {
            const rhsHasX = assembledRes.rhsTokens.some(
                (t) => t.type === "IDENTIFIER" && t.value === "x"
            );

            // If assignedVariable is 'y' and RHS has 'x', this is a 2D function curve y = f(x)!
            if (assembledRes.assignedVariable === "y" && rhsHasX) {
                const { fullLatex, formulaLatex } = generateLatex(
                    assembledRes.tokens,
                    null,
                    false,
                    true,
                    "y"
                );
                return {
                    success: true,
                    isUndefined: false,
                    isError: false,
                    resultString: formulaLatex,
                    value: null,
                    latex: fullLatex,
                    formulaLatex,
                    rawTokens,
                    assembledTokens: assembledRes.assembledStrings,
                    isAssignment: false,
                    isCurve: true,
                    curveVariable: "x",
                };
            }

            try {
                const numericResult = parseAndEvaluate(assembledRes.rhsTokens, scope);
                const resultString = formatNumber(numericResult);
                const { fullLatex, formulaLatex } = generateLatex(
                    assembledRes.tokens,
                    resultString,
                    assembledRes.hasTrailingEquals,
                    true,
                    assembledRes.assignedVariable
                );

                return {
                    success: true,
                    isUndefined: false,
                    isError: false,
                    resultString,
                    value: numericResult,
                    latex: fullLatex,
                    formulaLatex,
                    rawTokens,
                    assembledTokens: assembledRes.assembledStrings,
                    isAssignment: true,
                    assignedVariable: assembledRes.assignedVariable,
                    assignedValue: numericResult,
                };
            } catch (assignErr) {
                if (rhsHasX) {
                    const { fullLatex, formulaLatex } = generateLatex(
                        assembledRes.tokens,
                        null,
                        false,
                        true,
                        assembledRes.assignedVariable
                    );
                    return {
                        success: true,
                        isUndefined: false,
                        isError: false,
                        resultString: formulaLatex,
                        value: null,
                        latex: fullLatex,
                        formulaLatex,
                        rawTokens,
                        assembledTokens: assembledRes.assembledStrings,
                        isAssignment: false,
                        isCurve: true,
                        curveVariable: "x",
                    };
                }
                throw assignErr;
            }
        }

        // 2. Multi-variable Equation (e.g. x + y = 6, 2x - y = 4, x^2 - 4 = y)
        if (assembledRes.isEquation && assembledRes.lhsTokens && assembledRes.rhsTokens) {
            const hasX = assembledRes.tokens.some((t) => t.type === "IDENTIFIER" && t.value === "x");
            const hasY = assembledRes.tokens.some((t) => t.type === "IDENTIFIER" && t.value === "y");
            const { fullLatex, formulaLatex } = generateLatex(
                assembledRes.tokens,
                null,
                false
            );
            return {
                success: true,
                isUndefined: false,
                isError: false,
                resultString: formulaLatex,
                value: null,
                latex: fullLatex,
                formulaLatex,
                rawTokens,
                assembledTokens: assembledRes.assembledStrings,
                isAssignment: false,
                isCurve: hasX || hasY,
                curveVariable: "x",
            };
        }

        // 3. Expression in terms of 'x' without '=' (e.g. x^2 - 4, 2x + 1)
        const hasX = assembledRes.tokens.some((t) => t.type === "IDENTIFIER" && t.value === "x");
        const xInScope = scope && "x" in scope;

        if (hasX && !xInScope) {
            const { formulaLatex } = generateLatex(
                assembledRes.tokens,
                null,
                assembledRes.hasTrailingEquals
            );
            return {
                success: true,
                isUndefined: false,
                isError: false,
                resultString: formulaLatex,
                value: null,
                latex: `y = ${formulaLatex}`,
                formulaLatex,
                rawTokens,
                assembledTokens: assembledRes.assembledStrings,
                isAssignment: false,
                isCurve: true,
                curveVariable: "x",
            };
        }

        // 4. Standard arithmetic evaluation (or evaluation with variables from scope)
        const numericResult = parseAndEvaluate(assembledRes.tokens, scope);
        const resultString = formatNumber(numericResult);
        const { fullLatex, formulaLatex } = generateLatex(
            assembledRes.tokens,
            resultString,
            assembledRes.hasTrailingEquals
        );

        return {
            success: true,
            isUndefined: false,
            isError: false,
            resultString,
            value: numericResult,
            latex: fullLatex,
            formulaLatex,
            rawTokens,
            assembledTokens: assembledRes.assembledStrings,
            isAssignment: false,
            isCurve: false,
        };
    } catch (err: unknown) {
        if (err instanceof DivisionByZeroError) {
            let fullLatex = "\\text{Undefined}";
            let formulaLatex = "";
            try {
                const assembledRes = assembleTokens(rawTokens, scope);
                const latexRes = generateLatex(
                    assembledRes.tokens,
                    "Undefined",
                    assembledRes.hasTrailingEquals
                );
                fullLatex = latexRes.fullLatex;
                formulaLatex = latexRes.formulaLatex;
            } catch {
                fullLatex = "\\text{Undefined}";
            }

            return {
                success: true,
                isUndefined: true,
                isError: false,
                resultString: "Undefined",
                errorMessage: "Division by zero is undefined.",
                value: null,
                latex: fullLatex,
                formulaLatex,
                rawTokens,
                assembledTokens: [],
            };
        }

        const message = err instanceof Error ? err.message : String(err);
        return {
            success: false,
            isUndefined: false,
            isError: true,
            resultString: "Syntax Error",
            errorMessage: message,
            value: null,
            latex: "\\text{Syntax Error}",
            formulaLatex: "",
            rawTokens,
            assembledTokens: [],
        };
    }
}
