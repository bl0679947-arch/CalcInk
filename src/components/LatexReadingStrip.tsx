import React, { useState, useEffect, useRef } from "react";
import katex from "katex";
import "katex/dist/katex.min.css";
import type { MultiSymbolResult, LineResult } from "../recognition/multiSymbol";
import type { ReactiveStatus } from "../App";
import "./LatexReadingStrip.css";

export interface LatexReadingStripProps {
  liveResult: MultiSymbolResult | null;
  reactiveStatus: ReactiveStatus;
  hasStrokes: boolean;
  theme: "dark" | "light";
}

/**
 * Formats a single LineResult into a clean LaTeX equation string.
 */
function getLineLatex(line: LineResult): { latex: string; rawFormula: string; status: "solved" | "waiting" | "invalid" | "undefined" | "assignment" } {
  if (line.evaluation.isAssignment) {
    const raw = line.rawTokens.join(" ");
    return {
      latex: line.evaluation.latex || raw,
      rawFormula: raw,
      status: "assignment",
    };
  }

  if (!line.hasTerminalEquals) {
    const raw = line.rawTokens.join(" ");
    return {
      latex: line.evaluation.formulaLatex || raw,
      rawFormula: raw,
      status: "waiting",
    };
  }

  if (line.evaluation.isUndefined) {
    const f = line.evaluation.formulaLatex || line.rawTokens.filter((t) => t !== "=").join(" ");
    return {
      latex: `${f} = \\text{Undefined}`,
      rawFormula: f,
      status: "undefined",
    };
  }

  if (line.evaluation.isError) {
    const raw = line.rawTokens.join(" ");
    return {
      latex: raw,
      rawFormula: raw,
      status: "invalid",
    };
  }

  if (line.evaluation.success) {
    const f = line.evaluation.formulaLatex || line.rawTokens.filter((t) => t !== "=").join(" ");
    return {
      latex: `${f} = ${line.evaluation.resultString}`,
      rawFormula: f,
      status: "solved",
    };
  }

  const raw = line.rawTokens.join(" ");
  return {
    latex: raw,
    rawFormula: raw,
    status: "waiting",
  };
}

/**
 * Formats multi-line results into an aligned LaTeX environment.
 */
function getCombinedLatex(lines: LineResult[]): string {
  if (lines.length === 0) return "";
  if (lines.length === 1) return getLineLatex(lines[0]).latex;

  const formattedRows = lines.map((line) => {
    const item = getLineLatex(line);
    if (item.status === "solved" || item.status === "undefined" || item.status === "assignment") {
      const parts = item.latex.split("=");
      if (parts.length >= 2) {
        return `${parts[0].trim()} &= ${parts.slice(1).join("=").trim()}`;
      }
    }
    return item.latex;
  });

  return `\\begin{aligned} ${formattedRows.join(" \\\\[4pt] ")} \\end{aligned}`;
}

export const LatexReadingStrip: React.FC<LatexReadingStripProps> = ({
  liveResult,
  reactiveStatus,
  hasStrokes,
  theme,
}) => {
  const [selectedLineIndex, setSelectedLineIndex] = useState<number | "all">("all");
  const [viewMode, setViewMode] = useState<"math" | "raw">("math");
  const [copied, setCopied] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const mathContainerRef = useRef<HTMLDivElement | null>(null);

  const lines = liveResult?.lines || [];
  const hasContent = hasStrokes && lines.length > 0;

  // Derive effective selection without needing an effect or cascading state update
  const effectiveLineIndex =
    selectedLineIndex === "all" || lines.some((l) => l.lineIndex === selectedLineIndex)
      ? selectedLineIndex
      : "all";

  // Determine which LaTeX string to render based on selection
  let currentLatex = "";
  let currentStatus: "solved" | "waiting" | "invalid" | "undefined" | "evaluating" | "assignment" = "waiting";

  if (reactiveStatus === "Evaluating...") {
    currentStatus = "evaluating";
  }

  if (hasContent) {
    if (effectiveLineIndex === "all" || lines.length === 1) {
      currentLatex = getCombinedLatex(lines);
      if (lines.some((l) => l.evaluation.isError)) currentStatus = "invalid";
      else if (lines.some((l) => l.evaluation.isUndefined)) currentStatus = "undefined";
      else if (lines.every((l) => l.evaluation.isAssignment)) currentStatus = "assignment";
      else if (lines.every((l) => l.evaluation.success)) currentStatus = "solved";
      else currentStatus = "waiting";
    } else {
      const targetLine = lines.find((l) => l.lineIndex === effectiveLineIndex) || lines[0];
      const res = getLineLatex(targetLine);
      currentLatex = res.latex;
      currentStatus = res.status;
    }
  }

  const isMultiLineDisplay = lines.length > 1 && effectiveLineIndex === "all";

  // Render KaTeX whenever the formula or viewMode changes
  useEffect(() => {
    if (viewMode === "math" && mathContainerRef.current) {
      if (!hasContent) {
        mathContainerRef.current.innerHTML = "";
        return;
      }

      try {
        katex.render(currentLatex, mathContainerRef.current, {
          displayMode: isMultiLineDisplay,
          throwOnError: false,
        });
      } catch (err) {
        console.error("KaTeX render error in LatexReadingStrip:", err);
        if (mathContainerRef.current) {
          mathContainerRef.current.textContent = currentLatex;
        }
      }
    }
  }, [currentLatex, viewMode, hasContent, isMultiLineDisplay]);

  const handleCopy = async () => {
    if (!currentLatex) return;
    try {
      await navigator.clipboard.writeText(currentLatex);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy LaTeX:", err);
    }
  };

  return (
    <div
      className={`latex-reading-strip ${isCollapsed ? "collapsed" : ""} ${hasContent ? "has-content" : "idle"} theme-${theme}`}
      role="region"
      aria-label="Real-time LaTeX reading strip"
    >
      {/* Collapsed Pill */}
      {isCollapsed ? (
        <button
          type="button"
          className="strip-expand-btn"
          onClick={() => setIsCollapsed(false)}
          title="Expand Real-Time LaTeX Reading Strip"
        >
          <span className="strip-badge-tex">T_E_X</span>
          <span className="strip-collapsed-label">
            {hasContent ? "Live LaTeX: " + (lines.length > 1 ? `${lines.length} lines` : "active") : "Live LaTeX (Idle)"}
          </span>
          <span className="strip-chevron">▲</span>
        </button>
      ) : (
        <div className="strip-inner">
          {/* Left: TeX Badge & Status Indicator */}
          <div className="strip-left">
            <span className="strip-badge-tex" title="Real-Time LaTeX Engine">
              T_E_X
            </span>

            {reactiveStatus === "Evaluating..." ? (
              <span className="strip-status-pill status-evaluating" title="Recognizing handwriting...">
                <span className="strip-dot pulse" />
                <span className="strip-status-text">Reading...</span>
              </span>
            ) : hasContent ? (
              <span className={`strip-status-pill status-${currentStatus}`}>
                <span className="strip-dot" />
                <span className="strip-status-text">
                  {currentStatus === "solved" && "Solved"}
                  {currentStatus === "assignment" && "✓ Stored"}
                  {currentStatus === "waiting" && "Waiting for ="}
                  {currentStatus === "invalid" && "Invalid Syntax"}
                  {currentStatus === "undefined" && "Undefined"}
                </span>
              </span>
            ) : (
              <span className="strip-status-pill status-idle">
                <span className="strip-dot" />
                <span className="strip-status-text">Ready</span>
              </span>
            )}
          </div>

          {/* Center: Live Formula Display & Line Selectors */}
          <div className="strip-center">
            {/* Multi-line tabs if > 1 equation line */}
            {lines.length > 1 && (
              <div className="strip-line-tabs" role="tablist" aria-label="Select Equation Line">
                <button
                  type="button"
                  className={`strip-line-tab ${effectiveLineIndex === "all" ? "active" : ""}`}
                  onClick={() => setSelectedLineIndex("all")}
                  title="View all lines aligned"
                >
                  All ({lines.length})
                </button>
                {lines.map((line) => (
                  <button
                    key={line.lineIndex}
                    type="button"
                    className={`strip-line-tab ${effectiveLineIndex === line.lineIndex ? "active" : ""}`}
                    onClick={() => setSelectedLineIndex(line.lineIndex)}
                    title={`View Line ${line.lineIndex}`}
                  >
                    Line {line.lineIndex}
                  </button>
                ))}
              </div>
            )}

            {/* Formula content */}
            <div className="strip-formula-viewport">
              {!hasContent ? (
                <div className="strip-empty-hint">
                  <span className="strip-hint-icon">✍️</span>
                  <span>Write any math expression on the canvas to see real-time LaTeX...</span>
                </div>
              ) : viewMode === "math" ? (
                <div
                  ref={mathContainerRef}
                  className="strip-katex-output"
                  title="Real-time rendered KaTeX expression"
                />
              ) : (
                <div className="strip-raw-output" title="Raw LaTeX Code">
                  <code>{currentLatex}</code>
                </div>
              )}
            </div>
          </div>

          {/* Right: Actions (Copy, Math/Raw toggle, Collapse) */}
          <div className="strip-right">
            {hasContent && (
              <>
                <button
                  type="button"
                  className={`strip-mode-toggle ${viewMode === "raw" ? "active" : ""}`}
                  onClick={() => setViewMode((prev) => (prev === "math" ? "raw" : "math"))}
                  title={viewMode === "math" ? "View Raw LaTeX Code" : "View Rendered Math"}
                >
                  {viewMode === "math" ? "Code" : "Math"}
                </button>

                <button
                  type="button"
                  className={`strip-copy-btn ${copied ? "copied" : ""}`}
                  onClick={handleCopy}
                  title="Copy LaTeX to clipboard"
                  disabled={!currentLatex}
                >
                  {copied ? (
                    <>
                      <span>✓</span>
                      <span>Copied!</span>
                    </>
                  ) : (
                    <>
                      <span>📋</span>
                      <span>Copy</span>
                    </>
                  )}
                </button>
              </>
            )}

            <button
              type="button"
              className="strip-minimize-btn"
              onClick={() => setIsCollapsed(true)}
              title="Minimize LaTeX reading strip"
            >
              ▼
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
