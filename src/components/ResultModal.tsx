import React, { useEffect, useRef, useState } from "react";
import katex from "katex";
import "katex/dist/katex.min.css";
import type { MultiSymbolResult } from "../recognition/multiSymbol";
import { evaluateExpression, type EvaluationResult } from "../math/evaluator";
import "./ResultModal.css";

interface ResultModalProps {
    isOpen: boolean;
    onClose: () => void;
    multiResult: MultiSymbolResult | null;
    onClearCanvas?: () => void;
}

interface ContentProps {
    multiResult: MultiSymbolResult;
    onClose: () => void;
    onClearCanvas?: () => void;
}

const ResultModalContent: React.FC<ContentProps> = ({
    multiResult,
    onClose,
    onClearCanvas,
}) => {
    const formulaRef = useRef<HTMLDivElement | null>(null);
    const [activeEvaluation, setActiveEvaluation] = useState<EvaluationResult>(
        multiResult.evaluation
    );
    const [editableTokens, setEditableTokens] = useState<string>(
        multiResult.rawTokens.join(" ")
    );
    const [copied, setCopied] = useState<boolean>(false);

    // Render KaTeX when evaluation changes
    useEffect(() => {
        if (formulaRef.current) {
            const latexToRender = activeEvaluation.latex || "\\text{No expression}";
            try {
                katex.render(latexToRender, formulaRef.current, {
                    displayMode: true,
                    throwOnError: false,
                });
            } catch (err) {
                console.error("KaTeX rendering error:", err);
                if (formulaRef.current) {
                    formulaRef.current.textContent = latexToRender;
                }
            }
        }
    }, [activeEvaluation]);

    // Handle Escape key to close modal
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                onClose();
            }
        };
        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [onClose]);

    const handleCopyLatex = () => {
        if (activeEvaluation?.latex) {
            navigator.clipboard.writeText(activeEvaluation.latex);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        }
    };

    const handleReCalculate = () => {
        const trimmed = editableTokens.trim();
        if (!trimmed) return;
        const newTokens = trimmed.split(/\s+/);
        const newResult = evaluateExpression(newTokens);
        setActiveEvaluation(newResult);
    };

    const isSuccess = activeEvaluation.success && !activeEvaluation.isUndefined;
    const isUndefined = activeEvaluation.isUndefined;
    const isError = activeEvaluation.isError;

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div
                className="modal-card"
                onClick={(e) => e.stopPropagation()}
                role="dialog"
                aria-modal="true"
            >
                {/* Header */}
                <div className="modal-header">
                    <div className="modal-header-left">
                        <span style={{ fontSize: "1.4rem" }}>🧮</span>
                        <h2 className="modal-title">
                            {multiResult.lines && multiResult.lines.length > 1
                                ? `Expression Results (${multiResult.lines.length} Equations)`
                                : "Expression Result"}
                        </h2>
                    </div>
                    <button
                        className="modal-close-btn"
                        onClick={onClose}
                        title="Close (Esc)"
                        aria-label="Close"
                    >
                        &times;
                    </button>
                </div>

                {/* Body */}
                <div className="modal-body">
                    {/* KaTeX Mathematical Typesetting */}
                    <div className="katex-formula-wrapper">
                        <span className="katex-formula-label">
                            {multiResult.lines && multiResult.lines.length > 1
                                ? "Rendered Multi-Line Equations"
                                : "Rendered Mathematical Expression"}
                        </span>
                        <div ref={formulaRef} className="katex-formula-content" />
                    </div>

                    {/* Result Status Banners (Single-line or Multi-line list) */}
                    {multiResult.lines && multiResult.lines.length > 1 ? (
                        <div
                            className="multiline-results-list"
                            style={{ display: "flex", flexDirection: "column", gap: "8px", margin: "14px 0" }}
                        >
                            {multiResult.lines.map((line) => {
                                const lSuccess = line.evaluation.success && !line.evaluation.isUndefined;
                                const lUndef = line.evaluation.isUndefined;
                                return (
                                    <div
                                        key={line.lineIndex}
                                        className={`result-banner ${lSuccess ? "success" : lUndef ? "undefined" : "error"}`}
                                        style={{ margin: 0 }}
                                    >
                                        <div className="result-info">
                                            <span className="result-label">Line {line.lineIndex}</span>
                                            <span className="result-detail">
                                                {line.assembledTokens.join(" ") || line.rawTokens.join(" ")}
                                            </span>
                                        </div>
                                        <div className="result-value-badge">
                                            {lSuccess
                                                ? `= ${line.evaluation.resultString}`
                                                : lUndef
                                                ? "Undefined"
                                                : "Syntax Error"}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    ) : (
                        <>
                            {isSuccess && (
                                <div className="result-banner success">
                                    <div className="result-info">
                                        <span className="result-label">Evaluated Answer</span>
                                        <span className="result-detail">
                                            Computed via deterministic arithmetic parser (BODMAS)
                                        </span>
                                    </div>
                                    <div className="result-value-badge">
                                        = {activeEvaluation.resultString}
                                    </div>
                                </div>
                            )}

                            {isUndefined && (
                                <div className="result-banner undefined">
                                    <div className="result-info">
                                        <span className="result-label">Evaluation Warning</span>
                                        <span className="result-detail">
                                            Division by zero is mathematically undefined.
                                        </span>
                                    </div>
                                    <div className="result-value-badge" style={{ fontSize: "1.35rem" }}>
                                        Undefined
                                    </div>
                                </div>
                            )}

                            {isError && (
                                <div className="result-banner error">
                                    <div className="result-info">
                                        <span className="result-label">Syntax Error</span>
                                        <span className="result-detail">
                                            {activeEvaluation.errorMessage || "Malformed mathematical expression"}
                                        </span>
                                    </div>
                                    <div className="result-value-badge" style={{ fontSize: "1.2rem" }}>
                                        Syntax Error
                                    </div>
                                </div>
                            )}
                        </>
                    )}

                    {/* Raw LaTeX Format Section */}
                    <div className="latex-section">
                        <div className="latex-section-header">
                            <span className="latex-section-title">LaTeX Code</span>
                            <button
                                className={`copy-btn ${copied ? "copied" : ""}`}
                                onClick={handleCopyLatex}
                            >
                                {copied ? "✓ Copied!" : "Copy LaTeX"}
                            </button>
                        </div>
                        <div className="latex-code-container">
                            <span className="latex-code-text">{activeEvaluation.latex}</span>
                        </div>
                    </div>

                    {/* Recognized Symbols Breakdown */}
                    <div className="tokens-section">
                        <div className="tokens-header">
                            <span className="latex-section-title">
                                Recognized Symbols ({multiResult.symbols.length})
                            </span>
                        </div>

                        {multiResult.symbols.length > 0 && (
                            <div className="tokens-list">
                                {multiResult.symbols.map((item) => {
                                    const isOp = ["+", "-", "*", "/", "(", ")", "^"].includes(item.symbol);
                                    const isEq = item.symbol === "=";
                                    return (
                                        <span
                                            key={item.id}
                                            className={`token-pill ${isOp ? "operator" : isEq ? "equals" : ""}`}
                                            title={`Symbol #${item.id}: "${item.symbol}"`}
                                        >
                                            {item.symbol}
                                        </span>
                                    );
                                })}
                            </div>
                        )}

                        {/* Interactive edit & re-evaluate */}
                        <div className="re-eval-bar">
                            <input
                                type="text"
                                className="re-eval-input"
                                value={editableTokens}
                                onChange={(e) => setEditableTokens(e.target.value)}
                                placeholder="Edit tokens separated by spaces, e.g. 12.5 + 7 ="
                                onKeyDown={(e) => {
                                    if (e.key === "Enter") handleReCalculate();
                                }}
                            />
                            <button className="re-eval-btn" onClick={handleReCalculate}>
                                Recalculate
                            </button>
                        </div>
                    </div>
                </div>

                {/* Footer */}
                <div className="modal-footer">
                    {onClearCanvas && (
                        <button
                            className="footer-btn secondary"
                            onClick={() => {
                                onClearCanvas();
                                onClose();
                            }}
                        >
                            Clear & Close
                        </button>
                    )}
                    <button className="footer-btn primary" onClick={onClose}>
                        Done
                    </button>
                </div>
            </div>
        </div>
    );
};

export const ResultModal: React.FC<ResultModalProps> = ({
    isOpen,
    onClose,
    multiResult,
    onClearCanvas,
}) => {
    if (!isOpen || !multiResult) {
        return null;
    }

    return (
        <ResultModalContent
            key={multiResult.executionTimeMs + "_" + multiResult.rawTokens.join("")}
            multiResult={multiResult}
            onClose={onClose}
            onClearCanvas={onClearCanvas}
        />
    );
};
