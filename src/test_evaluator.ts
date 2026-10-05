import { evaluateExpression } from "./math/evaluator";

const scope: Record<string, number> = {};

// Test 1: Assignment x = 10
const res1 = evaluateExpression(["x", "=", "10"], scope);
if (!res1.success || !res1.isAssignment || res1.assignedVariable !== "x" || res1.assignedValue !== 10) {
    throw new Error(`Test 1 Failed: ${JSON.stringify(res1)}`);
}
if (res1.isAssignment && res1.assignedVariable) {
    scope[res1.assignedVariable] = res1.assignedValue ?? 10;
}

// Test 2: Assignment y = 20
const res2 = evaluateExpression(["y", "=", "20"], scope);
if (!res2.success || !res2.isAssignment || res2.assignedVariable !== "y" || res2.assignedValue !== 20) {
    throw new Error(`Test 2 Failed: ${JSON.stringify(res2)}`);
}
if (res2.isAssignment && res2.assignedVariable) {
    scope[res2.assignedVariable] = res2.assignedValue ?? 20;
}

// Test 3: Evaluation x + y =
const res3 = evaluateExpression(["x", "+", "y", "="], scope);
if (!res3.success || res3.value !== 30 || res3.resultString !== "30") {
    throw new Error(`Test 3 Failed: ${JSON.stringify(res3)}`);
}

// Test 4: Evaluation 2 * x + 5 =
const res4 = evaluateExpression(["2", "*", "x", "+", "5", "="], scope);
if (!res4.success || res4.value !== 25) {
    throw new Error(`Test 4 Failed: ${JSON.stringify(res4)}`);
}

// Test 5: Implicit multiplication 2x =
const res5 = evaluateExpression(["2", "x", "="], scope);
if (!res5.success || res5.value !== 20) {
    throw new Error(`Test 5 Failed: ${JSON.stringify(res5)}`);
}

// Test 6: Querying variable x =
const res6 = evaluateExpression(["x", "="], scope);
if (!res6.success || res6.value !== 10) {
    throw new Error(`Test 6 Failed: ${JSON.stringify(res6)}`);
}

// Test 7: Normal multiplication between numbers 4 x 5 =
const res7 = evaluateExpression(["4", "x", "5", "="], scope);
if (!res7.success || res7.value !== 20) {
    throw new Error(`Test 7 Failed: ${JSON.stringify(res7)}`);
}

// Test 8: Assignment with arithmetic expression z = 4 + 6
const res8 = evaluateExpression(["z", "=", "4", "+", "6"], scope);
if (!res8.success || !res8.isAssignment || res8.assignedVariable !== "z" || res8.assignedValue !== 10) {
    throw new Error(`Test 8 Failed: ${JSON.stringify(res8)}`);
}

// Test 9: Undefined variable w + 1 =
const res9 = evaluateExpression(["w", "+", "1", "="], scope);
if (!res9.isError || !res9.errorMessage?.includes("not defined")) {
    throw new Error(`Test 9 Failed: ${JSON.stringify(res9)}`);
}

// Test 10: Division by zero with variable x / 0 =
const res10 = evaluateExpression(["x", "/", "0", "="], scope);
if (!res10.isUndefined || res10.resultString !== "Undefined") {
    throw new Error(`Test 10 Failed: ${JSON.stringify(res10)}`);
}

console.log("ALL 10 EVALUATOR & VARIABLE MEMORY TESTS PASSED SUCCESSFULLY!");
