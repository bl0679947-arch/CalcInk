import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import katex from "katex";
import type { PlottableCurve } from "../math/curveDetection";
import "./RightGraphSidebar.css";

interface RightGraphSidebarProps {
  isOpen: boolean;
  onClose: () => void;
  curves: PlottableCurve[];
  activeCurveIndex: number;
  onSelectCurveIndex: (index: number) => void;
  theme: "dark" | "light";
  strokeColor?: string;
}

export const RightGraphSidebar: React.FC<RightGraphSidebarProps> = ({
  isOpen,
  onClose,
  curves,
  activeCurveIndex,
  onSelectCurveIndex,
  theme,
  strokeColor: _strokeColor,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Viewport zoom & pan state
  const [rangeSpan, setRangeSpan] = useState<number>(10); // default half-range: [-10, 10]
  const [center, setCenter] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [hoverPoint, setHoverPoint] = useState<{ x: number; y: number; px: number; py: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef<{ mouseX: number; mouseY: number; centerX: number; centerY: number } | null>(null);

  const activeCurve = useMemo(() => {
    if (curves.length === 0) return null;
    const safeIndex = Math.max(0, Math.min(activeCurveIndex, curves.length - 1));
    return curves[safeIndex];
  }, [curves, activeCurveIndex]);

  // Render KaTeX for equation badge
  const katexHtml = useMemo(() => {
    if (!activeCurve) return "";
    try {
      return katex.renderToString(activeCurve.latex || activeCurve.equationText, {
        displayMode: false,
        throwOnError: false,
      });
    } catch {
      return activeCurve.equationText;
    }
  }, [activeCurve]);

  // Convert math (x, y) to canvas pixel coordinates
  const mathToPixel = useCallback(
    (x: number, y: number, width: number, height: number) => {
      const scaleX = width / (rangeSpan * 2);
      const scaleY = height / (rangeSpan * 2);
      const px = width / 2 + (x - center.x) * scaleX;
      const py = height / 2 - (y - center.y) * scaleY;
      return { px, py };
    },
    [rangeSpan, center]
  );

  // Convert canvas pixel coordinates to math (x, y)
  const pixelToMath = useCallback(
    (px: number, py: number, width: number, height: number) => {
      const scaleX = width / (rangeSpan * 2);
      const scaleY = height / (rangeSpan * 2);
      const x = center.x + (px - width / 2) / scaleX;
      const y = center.y - (py - height / 2) / scaleY;
      return { x, y };
    },
    [rangeSpan, center]
  );

  // Draw 2D Coordinate plane & curves
  const renderGraph = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;

    if (width === 0 || height === 0) return;

    if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
    }

    ctx.save();
    ctx.scale(dpr, dpr);

    // Background
    const isDark = theme === "dark";
    ctx.fillStyle = isDark ? "#0d1117" : "#fafbfc";
    ctx.fillRect(0, 0, width, height);

    // Compute grid step size based on rangeSpan
    let gridStep = 1;
    if (rangeSpan > 25) gridStep = 5;
    else if (rangeSpan > 12) gridStep = 2;
    else if (rangeSpan <= 3) gridStep = 0.5;

    const minX = center.x - rangeSpan;
    const maxX = center.x + rangeSpan;
    const minY = center.y - rangeSpan;
    const maxY = center.y + rangeSpan;

    // 1. Grid Lines
    ctx.lineWidth = 1;
    ctx.strokeStyle = isDark ? "rgba(255, 255, 255, 0.06)" : "rgba(0, 0, 0, 0.06)";

    const firstGridX = Math.floor(minX / gridStep) * gridStep;
    for (let x = firstGridX; x <= maxX; x += gridStep) {
      const { px } = mathToPixel(x, 0, width, height);
      ctx.beginPath();
      ctx.moveTo(px, 0);
      ctx.lineTo(px, height);
      ctx.stroke();
    }

    const firstGridY = Math.floor(minY / gridStep) * gridStep;
    for (let y = firstGridY; y <= maxY; y += gridStep) {
      const { py } = mathToPixel(0, y, width, height);
      ctx.beginPath();
      ctx.moveTo(0, py);
      ctx.lineTo(width, py);
      ctx.stroke();
    }

    // 2. Axes (X and Y)
    const { px: originX, py: originY } = mathToPixel(0, 0, width, height);

    ctx.strokeStyle = isDark ? "rgba(255, 255, 255, 0.35)" : "rgba(0, 0, 0, 0.35)";
    ctx.lineWidth = 1.5;

    // X-Axis
    if (originY >= 0 && originY <= height) {
      ctx.beginPath();
      ctx.moveTo(0, originY);
      ctx.lineTo(width, originY);
      ctx.stroke();
    }

    // Y-Axis
    if (originX >= 0 && originX <= width) {
      ctx.beginPath();
      ctx.moveTo(originX, 0);
      ctx.lineTo(originX, height);
      ctx.stroke();
    }

    // 3. Tick Marks and Labels
    ctx.fillStyle = isDark ? "rgba(255, 255, 255, 0.45)" : "rgba(0, 0, 0, 0.5)";
    ctx.font = "10px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";

    for (let x = firstGridX; x <= maxX; x += gridStep) {
      if (Math.abs(x) < 1e-6) continue;
      const { px } = mathToPixel(x, 0, width, height);
      const clampY = Math.max(14, Math.min(originY + 4, height - 16));
      ctx.fillText(Number(x.toFixed(2)).toString(), px, clampY);
    }

    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    for (let y = firstGridY; y <= maxY; y += gridStep) {
      if (Math.abs(y) < 1e-6) continue;
      const { py } = mathToPixel(0, y, width, height);
      const clampX = Math.max(24, Math.min(originX - 6, width - 8));
      ctx.fillText(Number(y.toFixed(2)).toString(), clampX, py);
    }

    // Origin (0,0) label
    if (originX > 20 && originX < width - 20 && originY > 20 && originY < height - 20) {
      ctx.fillText("0", originX - 4, originY + 4);
    }

    // 4. Render Curves
    curves.forEach((curve) => {
      const isCurrent = activeCurve && curve.id === activeCurve.id;
      const curveColor = isCurrent
        ? isDark ? "#38bdf8" : "#0284c7"
        : isDark ? "rgba(148, 163, 184, 0.4)" : "rgba(100, 116, 139, 0.35)";

      ctx.save();
      ctx.strokeStyle = curveColor;
      ctx.lineWidth = isCurrent ? 2.5 : 1.5;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";

      if (isCurrent && isDark) {
        ctx.shadowColor = "rgba(56, 189, 248, 0.4)";
        ctx.shadowBlur = 6;
      }

      ctx.beginPath();
      let isDrawing = false;
      const sampleCount = Math.min(Math.round(width * 1.5), 600);
      const dx = (maxX - minX) / sampleCount;

      for (let i = 0; i <= sampleCount; i++) {
        const x = minX + i * dx;
        const y = curve.fn(x);

        if (!isFinite(y) || isNaN(y) || Math.abs(y) > 1e4) {
          isDrawing = false;
          continue;
        }

        const { px, py } = mathToPixel(x, y, width, height);

        // Break path if moving across extreme vertical asymptotes
        if (py < -height * 2 || py > height * 3) {
          isDrawing = false;
          continue;
        }

        if (!isDrawing) {
          ctx.moveTo(px, py);
          isDrawing = true;
        } else {
          ctx.lineTo(px, py);
        }
      }
      ctx.stroke();
      ctx.restore();

      // If active curve: highlight Key Feature Points (Roots, y-intercept, vertex)
      if (isCurrent) {
        // A. Roots (Emerald Green)
        curve.roots.forEach((root) => {
          if (root >= minX && root <= maxX) {
            const { px, py } = mathToPixel(root, 0, width, height);
            ctx.beginPath();
            ctx.arc(px, py, 4.5, 0, Math.PI * 2);
            ctx.fillStyle = "#10b981";
            ctx.fill();
            ctx.strokeStyle = isDark ? "#0d1117" : "#ffffff";
            ctx.lineWidth = 1.5;
            ctx.stroke();
          }
        });

        // B. y-intercept (Blue / Indigo)
        if (curve.yIntercept !== null && 0 >= minX && 0 <= maxX) {
          const { px, py } = mathToPixel(0, curve.yIntercept, width, height);
          if (py >= 0 && py <= height) {
            ctx.beginPath();
            ctx.arc(px, py, 4.5, 0, Math.PI * 2);
            ctx.fillStyle = "#6366f1";
            ctx.fill();
            ctx.strokeStyle = isDark ? "#0d1117" : "#ffffff";
            ctx.lineWidth = 1.5;
            ctx.stroke();
          }
        }

        // C. Extrema / Vertex (Amber / Orange)
        curve.extrema.forEach((pt) => {
          if (pt.x >= minX && pt.x <= maxX && pt.y >= minY && pt.y <= maxY) {
            const { px, py } = mathToPixel(pt.x, pt.y, width, height);
            ctx.beginPath();
            ctx.arc(px, py, 5, 0, Math.PI * 2);
            ctx.fillStyle = pt.type === "min" ? "#f59e0b" : "#ec4899";
            ctx.fill();
            ctx.strokeStyle = isDark ? "#0d1117" : "#ffffff";
            ctx.lineWidth = 1.5;
            ctx.stroke();
          }
        });
      }
    });

    // 5. Interactive Hover Point Crosshair
    if (hoverPoint && activeCurve) {
      const { px, py } = mathToPixel(hoverPoint.x, hoverPoint.y, width, height);

      // Crosshair lines
      ctx.save();
      ctx.strokeStyle = isDark ? "rgba(56, 189, 248, 0.4)" : "rgba(2, 132, 199, 0.4)";
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);

      ctx.beginPath();
      ctx.moveTo(px, 0);
      ctx.lineTo(px, height);
      ctx.moveTo(0, py);
      ctx.lineTo(width, py);
      ctx.stroke();

      // Glowing cursor target dot
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.arc(px, py, 6, 0, Math.PI * 2);
      ctx.fillStyle = "#38bdf8";
      ctx.fill();
      ctx.strokeStyle = isDark ? "#0d1117" : "#ffffff";
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.restore();
    }

    ctx.restore();
  }, [
    theme,
    rangeSpan,
    center,
    hoverPoint,
    curves,
    activeCurve,
    mathToPixel,
  ]);

  // Redraw on state changes or resize
  useEffect(() => {
    if (isOpen) {
      renderGraph();
    }
  }, [isOpen, renderGraph]);

  useEffect(() => {
    const handleResize = () => {
      if (isOpen) renderGraph();
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [isOpen, renderGraph]);

  // Pointer interactions: Mouse move to track crosshair
  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas || !activeCurve) return;
    const rect = canvas.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;

    if (isDragging && dragStartRef.current) {
      const dxPixels = px - dragStartRef.current.mouseX;
      const dyPixels = py - dragStartRef.current.mouseY;
      const scaleX = rect.width / (rangeSpan * 2);
      const scaleY = rect.height / (rangeSpan * 2);

      setCenter({
        x: dragStartRef.current.centerX - dxPixels / scaleX,
        y: dragStartRef.current.centerY + dyPixels / scaleY,
      });
      return;
    }

    const { x } = pixelToMath(px, py, rect.width, rect.height);
    const y = activeCurve.fn(x);

    if (isFinite(y) && !isNaN(y)) {
      setHoverPoint({ x, y, px, py });
    } else {
      setHoverPoint(null);
    }
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    setIsDragging(true);
    dragStartRef.current = {
      mouseX: e.clientX - rect.left,
      mouseY: e.clientY - rect.top,
      centerX: center.x,
      centerY: center.y,
    };
    canvas.setPointerCapture(e.pointerId);
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    setIsDragging(false);
    dragStartRef.current = null;
    const canvas = canvasRef.current;
    if (canvas && canvas.hasPointerCapture(e.pointerId)) {
      canvas.releasePointerCapture(e.pointerId);
    }
  };

  const handlePointerLeave = () => {
    if (!isDragging) {
      setHoverPoint(null);
    }
  };

  // Mouse wheel zoom
  const handleWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 0.85 : 1.18;
    setRangeSpan((prev) => Math.max(1, Math.min(100, prev * factor)));
  };

  const handleResetView = () => {
    setRangeSpan(10);
    setCenter({ x: 0, y: 0 });
    setHoverPoint(null);
  };

  if (!isOpen) return null;

  return (
    <aside
      className={`right-sidebar-sheet ${isOpen ? "open" : ""}`}
      ref={containerRef}
      aria-label="2D Function Curve Graph"
    >
      {/* Header */}
      <div className="right-sidebar-header">
        <div className="right-sidebar-title-group">
          <span className="right-sidebar-icon">📈</span>
          <div>
            <h2 className="right-sidebar-title">2D Function Graph</h2>
            <p className="right-sidebar-subtitle">
              {curves.length === 1 ? "1 Curve Detected" : `${curves.length} Curves Available`}
            </p>
          </div>
        </div>

        <button
          type="button"
          className="right-sidebar-close-btn"
          onClick={onClose}
          title="Close Graph Sidebar"
          aria-label="Close Graph"
        >
          <span className="close-chevron">›</span>
        </button>
      </div>

      {/* Multi-curve Tabs (if multiple detected) */}
      {curves.length > 1 && (
        <div className="curve-selector-tabs" role="tablist">
          {curves.map((curve, idx) => (
            <button
              key={curve.id}
              type="button"
              role="tab"
              aria-selected={idx === activeCurveIndex}
              className={`curve-tab-btn ${idx === activeCurveIndex ? "active" : ""}`}
              onClick={() => onSelectCurveIndex(idx)}
            >
              Curve {idx + 1}: {curve.equationText || `f(x)`}
            </button>
          ))}
        </div>
      )}

      {/* Equation Pill Badge */}
      {activeCurve && (
        <div className="curve-equation-banner">
          <div className="equation-math-badge" dangerouslySetInnerHTML={{ __html: katexHtml }} />
          <span className="equation-type-chip">{activeCurve.expressionType}</span>
        </div>
      )}

      {/* Graph Canvas Container */}
      <div className="graph-canvas-container">
        <canvas
          ref={canvasRef}
          className="function-graph-canvas"
          onPointerMove={handlePointerMove}
          onPointerDown={handlePointerDown}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerLeave}
          onWheel={handleWheel}
          style={{ cursor: isDragging ? "grabbing" : "crosshair" }}
        />

        {/* Hover Coordinate Chip */}
        {hoverPoint && (
          <div className="graph-hover-chip" role="status">
            <span>x: <strong>{hoverPoint.x.toFixed(2)}</strong></span>
            <span>y: <strong>{hoverPoint.y.toFixed(2)}</strong></span>
          </div>
        )}

        {/* Floating Zoom / Pan Controls Overlay */}
        <div className="graph-overlay-controls" role="toolbar" aria-label="Graph Zoom Controls">
          <button
            type="button"
            className="graph-ctrl-btn"
            onClick={() => setRangeSpan((s) => Math.max(1, s * 0.75))}
            title="Zoom In"
            aria-label="Zoom In"
          >
            +
          </button>
          <button
            type="button"
            className="graph-ctrl-btn"
            onClick={() => setRangeSpan((s) => Math.min(100, s * 1.33))}
            title="Zoom Out"
            aria-label="Zoom Out"
          >
            −
          </button>
          <button
            type="button"
            className="graph-ctrl-btn reset-btn"
            onClick={handleResetView}
            title="Reset Origin (0,0) and Zoom"
            aria-label="Reset View"
          >
            ⟲
          </button>
        </div>
      </div>

      {/* Range Quick Presets */}
      <div className="graph-preset-row">
        <span className="preset-label">Window:</span>
        {[5, 10, 20].map((span) => (
          <button
            key={span}
            type="button"
            className={`preset-pill ${Math.abs(rangeSpan - span) < 1 ? "active" : ""}`}
            onClick={() => {
              setRangeSpan(span);
              setCenter({ x: 0, y: 0 });
            }}
          >
            ±{span}
          </button>
        ))}
        <span className="graph-drag-hint">Drag canvas to pan</span>
      </div>

      {/* Mathematical Analysis Card */}
      {activeCurve && (
        <div className="curve-analysis-scrollable">
          <div className="analysis-card">
            <h3 className="card-section-title">Key Properties</h3>

            <div className="feature-grid">
              {/* Roots / x-intercepts */}
              <div className="feature-box">
                <div className="feature-title">
                  <span className="feature-dot green" />
                  Roots (x-intercepts)
                </div>
                <div className="feature-value">
                  {activeCurve.roots.length > 0
                    ? activeCurve.roots.map((r) => `x = ${r}`).join(", ")
                    : "No real roots"}
                </div>
              </div>

              {/* y-intercept */}
              <div className="feature-box">
                <div className="feature-title">
                  <span className="feature-dot blue" />
                  y-intercept
                </div>
                <div className="feature-value">
                  {activeCurve.yIntercept !== null ? `(0, ${activeCurve.yIntercept})` : "None"}
                </div>
              </div>

              {/* Extrema / Vertex */}
              {activeCurve.extrema.length > 0 && (
                <div className="feature-box full-width">
                  <div className="feature-title">
                    <span className="feature-dot orange" />
                    Vertex / Extrema
                  </div>
                  <div className="feature-value">
                    {activeCurve.extrema.map((ex, i) => (
                      <span key={i} className="extrema-chip">
                        {ex.label}: ({ex.x}, {ex.y})
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Quick Value Table */}
            <div className="table-section">
              <h4 className="table-subtitle">Sample Values: (x, y)</h4>
              <div className="values-table-wrapper">
                <table className="values-table">
                  <thead>
                    <tr>
                      <th>x</th>
                      {activeCurve.tableValues.slice(1, 8).map((pt) => (
                        <th key={pt.x}>{pt.x}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <th>y</th>
                      {activeCurve.tableValues.slice(1, 8).map((pt) => (
                        <td key={pt.x}>{pt.y !== null ? pt.y : "—"}</td>
                      ))}
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
};
