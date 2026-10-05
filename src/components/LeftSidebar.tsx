import React, { useEffect, useRef, useState } from "react";
import katex from "katex";
import "katex/dist/katex.min.css";
import type { Stroke } from "../App";
import "./LeftSidebar.css";

export interface HistoryItem {
  id: string;
  timestamp: number;
  rawTokens: string[];
  assembledTokens: string[];
  latex: string;
  resultString: string;
  isUndefined: boolean;
  isError: boolean;
  errorMessage?: string;
  strokes: Stroke[];
}

export interface LeftSidebarProps {
  isOpen: boolean;
  onClose: () => void;
  activePanel: "menu" | "history" | "color" | "size" | "variables";
  setActivePanel: (panel: "menu" | "history" | "color" | "size" | "variables") => void;
  // History
  history: HistoryItem[];
  onLoadHistoryItem: (item: HistoryItem) => void;
  onDeleteHistoryItem: (id: string) => void;
  onClearHistory: () => void;
  // Color
  strokeColor: string;
  onSelectColor: (color: string) => void;
  theme: "dark" | "light";
  // Pen Size
  strokeWidth: number;
  onChangeStrokeWidth: (width: number) => void;
  // Variable Memory
  variables: Record<string, number>;
  onClearVariables: () => void;
  onDeleteVariable: (varName: string) => void;
}

function formatTime(timestamp: number): string {
  const now = Date.now();
  const diffSec = Math.floor((now - timestamp) / 1000);

  if (diffSec < 10) return "Just now";
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours}h ago`;

  const date = new Date(timestamp);
  return date.toLocaleDateString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const DARK_COLOR_OPTIONS = [
  { color: "#ffffff", label: "Chalk White" },
  { color: "#fbbf24", label: "Golden Yellow" },
  { color: "#38bdf8", label: "Sky Cyan" },
  { color: "#34d399", label: "Mint Green" },
  { color: "#f87171", label: "Coral Rose" },
  { color: "#c084fc", label: "Lavender Purple" },
  { color: "#f472b6", label: "Hot Pink" },
  { color: "#94a3b8", label: "Slate Grey" },
];

const LIGHT_COLOR_OPTIONS = [
  { color: "#111827", label: "Ink Black" },
  { color: "#d97706", label: "Amber Orange" },
  { color: "#0284c7", label: "Ocean Blue" },
  { color: "#059669", label: "Forest Green" },
  { color: "#dc2626", label: "Crimson Red" },
  { color: "#7c3aed", label: "Royal Purple" },
  { color: "#db2777", label: "Berry Pink" },
  { color: "#475569", label: "Pencil Grey" },
];

const SIZE_PRESETS = [
  { width: 2, label: "Fine", dotSize: 4 },
  { width: 4, label: "Regular", dotSize: 7 },
  { width: 6, label: "Medium", dotSize: 10 },
  { width: 8, label: "Bold", dotSize: 13 },
  { width: 10, label: "Marker", dotSize: 16 },
];

interface HistoryCardProps {
  item: HistoryItem;
  onLoad: (item: HistoryItem) => void;
  onDelete: (id: string) => void;
}

const HistoryCard: React.FC<HistoryCardProps> = ({ item, onLoad, onDelete }) => {
  const formulaRef = useRef<HTMLDivElement | null>(null);
  const [copiedLatex, setCopiedLatex] = useState(false);
  const [copiedResult, setCopiedResult] = useState(false);

  useEffect(() => {
    if (formulaRef.current) {
      const latexToRender = item.latex || item.assembledTokens.join(" ") || "\\text{Empty}";
      try {
        katex.render(latexToRender, formulaRef.current, {
          displayMode: false,
          throwOnError: false,
        });
      } catch {
        if (formulaRef.current) {
          formulaRef.current.textContent = item.assembledTokens.join(" ");
        }
      }
    }
  }, [item.latex, item.assembledTokens]);

  const handleCopyLatex = (e: React.MouseEvent) => {
    e.stopPropagation();
    const textToCopy = `${item.latex} ${item.resultString}`;
    navigator.clipboard.writeText(textToCopy);
    setCopiedLatex(true);
    setTimeout(() => setCopiedLatex(false), 1800);
  };

  const handleCopyResult = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(item.resultString);
    setCopiedResult(true);
    setTimeout(() => setCopiedResult(false), 1800);
  };

  return (
    <div className="left-history-card">
      <div className="left-history-card-top">
        <span className="left-history-card-time">🕒 {formatTime(item.timestamp)}</span>
        <button
          type="button"
          className="left-history-card-delete-btn"
          onClick={() => onDelete(item.id)}
          title="Delete calculation from history"
        >
          ✕
        </button>
      </div>

      <div className="left-history-card-formula" ref={formulaRef}>
        {item.assembledTokens.join(" ")}
      </div>

      <div className={`left-history-card-result ${item.isUndefined ? "undefined" : ""}`}>
        <span className="left-history-result-label">
          {item.isUndefined ? "Warning" : "Answer"}
        </span>
        <span className="left-history-result-value">= {item.resultString}</span>
      </div>

      <div className="left-history-card-actions">
        <button
          type="button"
          className="left-history-action-btn btn-load"
          onClick={() => onLoad(item)}
          title="Restore handwritten equation onto the canvas"
        >
          ✍️ Restore
        </button>
        <button
          type="button"
          className="left-history-action-btn"
          onClick={handleCopyLatex}
          title="Copy LaTeX formula and result"
        >
          {copiedLatex ? "✓ Copied" : "LaTeX"}
        </button>
        <button
          type="button"
          className="left-history-action-btn"
          onClick={handleCopyResult}
          title="Copy numerical result"
        >
          {copiedResult ? "✓ Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
};

export const LeftSidebar: React.FC<LeftSidebarProps> = ({
  isOpen,
  onClose,
  activePanel,
  setActivePanel,
  history,
  onLoadHistoryItem,
  onDeleteHistoryItem,
  onClearHistory,
  strokeColor,
  onSelectColor,
  theme,
  strokeWidth,
  onChangeStrokeWidth,
  variables,
  onClearVariables,
  onDeleteVariable,
}) => {
  const sidebarRef = useRef<HTMLElement | null>(null);

  // Close or go back on Escape, and close on clicking outside (no blurred overlay needed)
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (activePanel !== "menu") {
          setActivePanel("menu");
        } else {
          onClose();
        }
      }
    };

    const handlePointerDownOutside = (e: PointerEvent) => {
      if (
        sidebarRef.current &&
        !sidebarRef.current.contains(e.target as Node) &&
        !(e.target as Element).closest?.(".canvas-left-toggle-btn")
      ) {
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    document.addEventListener("pointerdown", handlePointerDownOutside);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("pointerdown", handlePointerDownOutside);
    };
  }, [isOpen, activePanel, setActivePanel, onClose]);

  const colorOptions = theme === "dark" ? DARK_COLOR_OPTIONS : LIGHT_COLOR_OPTIONS;

  return (
    <aside
      ref={sidebarRef}
      className={`left-sidebar-sheet ${isOpen ? "open" : ""}`}
      role="dialog"
      aria-modal="true"
      aria-label="Notebook Sidebar Navigation"
    >
        {/* ==============================================================
            LEVEL 1: MAIN MENU (History, Color, Pen Size options)
            ============================================================== */}
        {activePanel === "menu" && (
          <div className="left-sidebar-view animate-fade-in">
            <div className="left-sidebar-header">
              <div className="left-sidebar-brand">
                <span className="left-sidebar-icon">✍️</span>
                <div className="left-sidebar-title-group">
                  <h2 className="left-sidebar-title">Notebook Tools</h2>
                  <span className="left-sidebar-subtitle">Quick settings & history</span>
                </div>
              </div>
              <button
                type="button"
                className="left-sidebar-close-btn"
                onClick={onClose}
                title="Close sidebar (Esc)"
                aria-label="Close sidebar"
              >
                ✕
              </button>
            </div>

            <div className="left-sidebar-menu-list">
              {/* Option 1: History */}
              <button
                type="button"
                className="left-sidebar-nav-item"
                onClick={() => setActivePanel("history")}
                title="Open Calculation History"
              >
                <div className="nav-item-icon-box history-icon-box">
                  <span>📜</span>
                </div>
                <div className="nav-item-info">
                  <span className="nav-item-label">History</span>
                  <span className="nav-item-desc">Saved calculations & LaTeX</span>
                </div>
                {history.length > 0 && (
                  <span className="nav-item-badge">{history.length}</span>
                )}
                <span className="nav-item-chevron">›</span>
              </button>

              {/* Option 2: Color */}
              <button
                type="button"
                className="left-sidebar-nav-item"
                onClick={() => setActivePanel("color")}
                title="Open Color Palette"
              >
                <div className="nav-item-icon-box color-icon-box">
                  <span>🎨</span>
                </div>
                <div className="nav-item-info">
                  <span className="nav-item-label">Pen Color</span>
                  <span className="nav-item-desc">Palette presets & custom hex</span>
                </div>
                <span
                  className="nav-item-color-preview"
                  style={{ backgroundColor: strokeColor }}
                  title={`Current color: ${strokeColor}`}
                />
                <span className="nav-item-chevron">›</span>
              </button>

              {/* Option 3: Pen Size */}
              <button
                type="button"
                className="left-sidebar-nav-item"
                onClick={() => setActivePanel("size")}
                title="Open Pen Size & Stepper"
              >
                <div className="nav-item-icon-box size-icon-box">
                  <span>📏</span>
                </div>
                <div className="nav-item-info">
                  <span className="nav-item-label">Pen Size</span>
                  <span className="nav-item-desc">Vertical incrementer & presets</span>
                </div>
                <span className="nav-item-badge size-badge">{strokeWidth}px</span>
                <span className="nav-item-chevron">›</span>
              </button>

              {/* Option 4: Variable Memory */}
              <button
                type="button"
                className="left-sidebar-nav-item"
                onClick={() => setActivePanel("variables")}
                title="Open Variable Memory Inspector"
              >
                <div className="nav-item-icon-box variable-icon-box">
                  <span>🧠</span>
                </div>
                <div className="nav-item-info">
                  <span className="nav-item-label">Variable Memory</span>
                  <span className="nav-item-desc">Active variables & values</span>
                </div>
                {Object.keys(variables).length > 0 && (
                  <span className="nav-item-badge variable-badge">
                    {Object.keys(variables).length}
                  </span>
                )}
                <span className="nav-item-chevron">›</span>
              </button>
            </div>
          </div>
        )}

        {/* ==============================================================
            LEVEL 2: HISTORY SUBPANEL (Opened on top of main menu)
            ============================================================== */}
        {activePanel === "history" && (
          <div className="left-sidebar-view left-subpanel animate-slide-left">
            <div className="left-sidebar-header">
              <button
                type="button"
                className="left-sidebar-back-btn"
                onClick={() => setActivePanel("menu")}
                title="Back to Tools Menu"
              >
                <span>‹</span>
                <span>Back</span>
              </button>
              <div className="left-subpanel-title-box">
                <h2 className="left-sidebar-title">
                  History
                  {history.length > 0 && (
                    <span className="left-count-badge">{history.length}</span>
                  )}
                </h2>
              </div>
              <div className="left-header-actions">
                {history.length > 0 && (
                  <button
                    type="button"
                    className="left-clear-all-btn"
                    onClick={onClearHistory}
                    title="Clear all history (instant)"
                  >
                    Clear All
                  </button>
                )}
                <button
                  type="button"
                  className="left-sidebar-close-btn"
                  onClick={onClose}
                  title="Close sidebar"
                >
                  ✕
                </button>
              </div>
            </div>

            <div className="left-sidebar-body">
              {history.length === 0 ? (
                <div className="left-history-empty">
                  <div className="empty-icon">🧮</div>
                  <h3>No History Yet</h3>
                  <p>
                    Write an expression ending with <strong>=</strong> or click{" "}
                    <strong>✨ Calculate</strong> to record results.
                  </p>
                </div>
              ) : (
                history.map((item) => (
                  <HistoryCard
                    key={item.id}
                    item={item}
                    onLoad={(selected) => {
                      onLoadHistoryItem(selected);
                      onClose();
                    }}
                    onDelete={onDeleteHistoryItem}
                  />
                ))
              )}
            </div>
          </div>
        )}

        {/* ==============================================================
            LEVEL 2: COLOR SUBPANEL (Opened on top of main menu, Vertically Aligned)
            ============================================================== */}
        {activePanel === "color" && (
          <div className="left-sidebar-view left-subpanel animate-slide-left">
            <div className="left-sidebar-header">
              <button
                type="button"
                className="left-sidebar-back-btn"
                onClick={() => setActivePanel("menu")}
                title="Back to Tools Menu"
              >
                <span>‹</span>
                <span>Back</span>
              </button>
              <h2 className="left-sidebar-title">Pen Color</h2>
              <button
                type="button"
                className="left-sidebar-close-btn"
                onClick={onClose}
                title="Close sidebar"
              >
                ✕
              </button>
            </div>

            <div className="left-sidebar-body">
              {/* Active Color Showcase */}
              <div className="vertical-active-color-card">
                <span
                  className="active-color-large-swatch"
                  style={{ backgroundColor: strokeColor }}
                />
                <div className="active-color-meta">
                  <span className="active-color-title">Active Color</span>
                  <span className="active-color-hex">{strokeColor.toUpperCase()}</span>
                </div>
              </div>

              {/* Vertically Aligned Color Presets */}
              <div className="vertical-section">
                <span className="vertical-section-label">PRESET PALETTE</span>
                <div className="vertical-color-list" role="radiogroup" aria-label="Color Presets">
                  {colorOptions.map((opt) => {
                    const isSelected =
                      strokeColor.toLowerCase() === opt.color.toLowerCase();
                    return (
                      <button
                        key={opt.color}
                        type="button"
                        className={`vertical-color-row ${isSelected ? "active" : ""}`}
                        onClick={() => onSelectColor(opt.color)}
                      >
                        <span
                          className="vertical-color-dot"
                          style={{ backgroundColor: opt.color }}
                        >
                          {isSelected && <span className="vertical-color-check">✓</span>}
                        </span>
                        <span className="vertical-color-name">{opt.label}</span>
                        <span className="vertical-color-hex-tag">{opt.color}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Vertically Aligned Custom Color Picker */}
              <div className="vertical-section">
                <span className="vertical-section-label">CUSTOM COLOR</span>
                <label className="vertical-custom-picker-row">
                  <input
                    type="color"
                    value={strokeColor}
                    onChange={(e) => onSelectColor(e.target.value)}
                    className="vertical-custom-input"
                  />
                  <div className="vertical-custom-info">
                    <span className="vertical-custom-title">Pick Any Custom Ink</span>
                    <span className="vertical-custom-desc">Click swatch to open picker</span>
                  </div>
                </label>
              </div>
            </div>
          </div>
        )}

        {/* ==============================================================
            LEVEL 2: PEN SIZE SUBPANEL (Opened on top of main menu, Vertically Aligned Incrementer)
            ============================================================== */}
        {activePanel === "size" && (
          <div className="left-sidebar-view left-subpanel animate-slide-left">
            <div className="left-sidebar-header">
              <button
                type="button"
                className="left-sidebar-back-btn"
                onClick={() => setActivePanel("menu")}
                title="Back to Tools Menu"
              >
                <span>‹</span>
                <span>Back</span>
              </button>
              <h2 className="left-sidebar-title">Pen Size</h2>
              <button
                type="button"
                className="left-sidebar-close-btn"
                onClick={onClose}
                title="Close sidebar"
              >
                ✕
              </button>
            </div>

            <div className="left-sidebar-body">
              {/* Vertically Aligned Stepper / Incrementer */}
              <div className="vertical-section">
                <span className="vertical-section-label">VERTICAL INCREMENTER</span>
                <div className="vertical-stepper-card">
                  {/* + Increment Button */}
                  <button
                    type="button"
                    className="stepper-btn stepper-btn-plus"
                    onClick={() => onChangeStrokeWidth(Math.min(10, strokeWidth + 1))}
                    disabled={strokeWidth >= 10}
                    title="Increase thickness by 1px"
                  >
                    +
                  </button>

                  {/* Stepper Value & Live Stroke Preview */}
                  <div className="stepper-center-box">
                    <span className="stepper-value-text">{strokeWidth} px</span>
                    <div className="stepper-stroke-preview-box">
                      <div
                        className="stepper-stroke-line"
                        style={{
                          height: `${Math.max(2, strokeWidth)}px`,
                          backgroundColor: strokeColor,
                        }}
                      />
                    </div>
                  </div>

                  {/* - Decrement Button */}
                  <button
                    type="button"
                    className="stepper-btn stepper-btn-minus"
                    onClick={() => onChangeStrokeWidth(Math.max(1, strokeWidth - 1))}
                    disabled={strokeWidth <= 1}
                    title="Decrease thickness by 1px"
                  >
                    −
                  </button>
                </div>
              </div>

              {/* Vertically Aligned Slider */}
              <div className="vertical-section">
                <span className="vertical-section-label">FINE-TUNE SLIDER</span>
                <div className="vertical-slider-box">
                  <input
                    type="range"
                    min="1"
                    max="10"
                    step="1"
                    value={strokeWidth}
                    onChange={(e) => onChangeStrokeWidth(Number(e.target.value))}
                    className="vertical-range-input"
                  />
                  <div className="vertical-slider-ticks">
                    <span>1px</span>
                    <span>5px</span>
                    <span>10px</span>
                  </div>
                </div>
              </div>

              {/* Vertically Aligned Presets */}
              <div className="vertical-section">
                <span className="vertical-section-label">PRESET WIDTHS</span>
                <div className="vertical-presets-list" role="radiogroup" aria-label="Stroke Width Presets">
                  {SIZE_PRESETS.map((preset) => {
                    const isSelected = strokeWidth === preset.width;
                    return (
                      <button
                        key={preset.width}
                        type="button"
                        className={`vertical-preset-row ${isSelected ? "active" : ""}`}
                        onClick={() => onChangeStrokeWidth(preset.width)}
                      >
                        <span className="vertical-preset-dot-box">
                          <span
                            className="vertical-preset-dot"
                            style={{
                              width: `${preset.dotSize}px`,
                              height: `${preset.dotSize}px`,
                              backgroundColor: isSelected ? "var(--btn-active-text)" : "currentColor",
                            }}
                          />
                        </span>
                        <span className="vertical-preset-label">{preset.label}</span>
                        <span className="vertical-preset-px">{preset.width} px</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ==============================================================
            LEVEL 2: VARIABLE MEMORY SUBPANEL (Opened on top of main menu)
            ============================================================== */}
        {activePanel === "variables" && (
          <div className="left-sidebar-view left-subpanel animate-slide-left">
            <div className="left-sidebar-header">
              <button
                type="button"
                className="left-sidebar-back-btn"
                onClick={() => setActivePanel("menu")}
                title="Back to Tools Menu"
              >
                <span>‹</span>
                <span>Back</span>
              </button>
              <div className="left-subpanel-title-box">
                <h2 className="left-sidebar-title">
                  Variables
                  {Object.keys(variables).length > 0 && (
                    <span className="left-count-badge">{Object.keys(variables).length}</span>
                  )}
                </h2>
              </div>
              <div className="left-header-actions">
                {Object.keys(variables).length > 0 && (
                  <button
                    type="button"
                    className="left-clear-all-btn"
                    onClick={onClearVariables}
                    title="Clear all stored variables"
                  >
                    Clear All
                  </button>
                )}
                <button
                  type="button"
                  className="left-sidebar-close-btn"
                  onClick={onClose}
                  title="Close sidebar"
                >
                  ✕
                </button>
              </div>
            </div>

            <div className="left-sidebar-body">
              {Object.keys(variables).length === 0 ? (
                <div className="left-history-empty">
                  <div className="empty-icon">🧠</div>
                  <h3>No Variables Stored</h3>
                  <p>
                    Write an assignment equation on the canvas, such as:
                  </p>
                  <div className="variable-example-card">
                    <div className="variable-example-row"><code>x = 10</code><span>stores x as 10</span></div>
                    <div className="variable-example-row"><code>y = 20</code><span>stores y as 20</span></div>
                    <div className="variable-example-row"><code>x + y =</code><span>evaluates to 30</span></div>
                  </div>
                </div>
              ) : (
                <div className="variables-list">
                  <div className="vertical-section-label">ACTIVE MEMORY REGISTERS</div>
                  {Object.entries(variables).map(([name, value]) => (
                    <div key={name} className="variable-row-card">
                      <div className="variable-badge-symbol">
                        <span>{name}</span>
                      </div>
                      <div className="variable-value-box">
                        <span className="variable-equals">=</span>
                        <span className="variable-value">{value}</span>
                      </div>
                      <button
                        type="button"
                        className="variable-delete-btn"
                        onClick={() => onDeleteVariable(name)}
                        title={`Delete variable ${name}`}
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </aside>
  );
};
