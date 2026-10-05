/// <reference lib="webworker" />

import { loadModel } from "./model";
import { recognizeAndEvaluateExpression, type MultiSymbolResult } from "./multiSymbol";
import type { Stroke } from "../App";

export interface WorkerRequest {
    id: number;
    type: "INIT" | "EVALUATE";
    strokes?: Stroke[];
    initialScope?: Record<string, number>;
}

export interface WorkerResponse {
    id: number;
    type: "INIT_SUCCESS" | "RESULT" | "ERROR";
    result?: MultiSymbolResult;
    error?: string;
}

let isInitialized = false;
let initPromise: Promise<void> | null = null;
let latestRequestId = 0;

async function ensureWorkerInitialized(): Promise<void> {
    if (isInitialized) return;
    if (initPromise) return initPromise;
    initPromise = (async () => {
        await loadModel();
        isInitialized = true;
    })();
    return initPromise;
}

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
    const { id, type, strokes } = event.data;
    latestRequestId = Math.max(latestRequestId, id);

    try {
        if (type === "INIT") {
            await ensureWorkerInitialized();
            self.postMessage({ id, type: "INIT_SUCCESS" } satisfies WorkerResponse);
            return;
        }

        if (type === "EVALUATE") {
            await ensureWorkerInitialized();

            // Stale check before starting expensive compute
            if (id < latestRequestId) {
                return;
            }

            const result = await recognizeAndEvaluateExpression(strokes || [], event.data.initialScope);

            // Stale check after inference completes
            if (id < latestRequestId) {
                return;
            }

            self.postMessage({
                id,
                type: "RESULT",
                result,
            } satisfies WorkerResponse);
        }
    } catch (err) {
        console.error("[RecognitionWorker] Execution failure:", err);
        self.postMessage({
            id,
            type: "ERROR",
            error: err instanceof Error ? err.message : String(err),
        } satisfies WorkerResponse);
    }
};
