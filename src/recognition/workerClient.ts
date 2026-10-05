import type { Stroke } from "../App";
import type { MultiSymbolResult } from "./multiSymbol";
import type { WorkerRequest, WorkerResponse } from "./recognition.worker";
import { loadModel as loadModelInline } from "./model";
import { recognizeAndEvaluateExpression as evaluateInline } from "./multiSymbol";

let workerInstance: Worker | null = null;
let requestIdCounter = 0;
const pendingRequests = new Map<number, {
    resolve: (res: MultiSymbolResult) => void;
    reject: (err: Error) => void;
}>();

let isWorkerReady = false;
let initPromise: Promise<void> | null = null;

function getWorker(): Worker | null {
    if (typeof window === "undefined" || typeof Worker === "undefined") {
        return null;
    }

    if (!workerInstance) {
        try {
            workerInstance = new Worker(
                new URL("./recognition.worker.ts", import.meta.url),
                { type: "module" }
            );

            workerInstance.onmessage = (event: MessageEvent<WorkerResponse>) => {
                const { id, type, result, error } = event.data;
                const pending = pendingRequests.get(id);
                if (!pending) return;

                pendingRequests.delete(id);

                if (type === "RESULT" && result) {
                    pending.resolve(result);
                } else if (type === "ERROR") {
                    pending.reject(new Error(error || "Worker recognition error"));
                }
            };

            workerInstance.onerror = (err) => {
                console.error("[RecognitionWorkerClient] Background worker error:", err);
            };
        } catch (err) {
            console.warn("[RecognitionWorkerClient] Web Worker unavailable, using inline execution:", err);
            workerInstance = null;
        }
    }

    return workerInstance;
}

export async function initRecognitionWorker(): Promise<void> {
    if (isWorkerReady) return;
    if (initPromise) return initPromise;

    initPromise = (async () => {
        const worker = getWorker();
        if (!worker) {
            // Fallback: run inline model initialization
            await loadModelInline();
            isWorkerReady = true;
            return;
        }

        const id = ++requestIdCounter;
        await new Promise<void>((resolve, reject) => {
            const handleInit = (event: MessageEvent<WorkerResponse>) => {
                if (event.data.id === id) {
                    worker.removeEventListener("message", handleInit);
                    if (event.data.type === "INIT_SUCCESS") {
                        isWorkerReady = true;
                        resolve();
                    } else {
                        reject(new Error(event.data.error || "Worker initialization failed"));
                    }
                }
            };
            worker.addEventListener("message", handleInit);
            worker.postMessage({ id, type: "INIT" } satisfies WorkerRequest);
        });
    })();

    return initPromise;
}

export async function evaluateStrokesWorker(
    strokes: Stroke[],
    initialScope?: Record<string, number>
): Promise<MultiSymbolResult> {
    const worker = getWorker();

    // If Worker is not available, execute inline with zero friction
    if (!worker) {
        await loadModelInline();
        return evaluateInline(strokes, initialScope);
    }

    // Ensure worker models are initialized
    if (!isWorkerReady) {
        await initRecognitionWorker();
    }

    const id = ++requestIdCounter;

    // Prune stale pending requests since a newer stroke evaluation has been submitted
    for (const [oldId, pending] of pendingRequests.entries()) {
        if (oldId < id) {
            pending.reject(new Error("Superseded by newer stroke evaluation"));
            pendingRequests.delete(oldId);
        }
    }

    return new Promise<MultiSymbolResult>((resolve, reject) => {
        pendingRequests.set(id, { resolve, reject });
        worker.postMessage({
            id,
            type: "EVALUATE",
            strokes,
            initialScope,
        } satisfies WorkerRequest);
    });
}
