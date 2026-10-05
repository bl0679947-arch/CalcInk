import { useRef, useState, useEffect, useCallback } from "react";
import "./App.css";


import type { MultiSymbolResult, RecognizedSymbolItem } from "./recognition/multiSymbol";
import { initRecognitionWorker, evaluateStrokesWorker } from "./recognition/workerClient";
import { hasConsecutiveOperators } from "./math/evaluator";
import { ResultModal } from "./components/ResultModal";
import { LeftSidebar, type HistoryItem } from "./components/LeftSidebar";
import { RightGraphSidebar } from "./components/RightGraphSidebar";
import { isScribbleStroke, findScratchedStrokes } from "./math/geometry";
import { LatexReadingStrip } from "./components/LatexReadingStrip";
import { detectPlottableCurves, type PlottableCurve } from "./math/curveDetection";

export type ReactiveStatus =
  | "Ready"
  | "Evaluating..."
  | "Waiting for ="
  | "Invalid expression"
  | "Graph ready";


export interface Point {
  x: number;
  y: number;
  pressure: number;
  width: number;
}

export interface Stroke {
  id: number;
  points: Point[];
  width: number;
  color: string;
}

const LOGICAL_WIDTH = 1200;
const LOGICAL_HEIGHT = 650;

interface PixelErase {
  x: number;
  y: number;
  radius: number;
}

interface CanvasState {
  strokes: Stroke[];
  pixelErasures: PixelErase[];
}

interface RawPoint {
  x: number;
  y: number;
  pressure: number;
}

export interface InlineAnswer {
  lineIndex: number;
  stageIndex?: number;
  text: string;
  x: number;
  y: number;
  fontSize: number;
  isUndefined: boolean;
  isAssignment?: boolean;
}

/**
 * Computes dynamic handwriting font size and offset calibrated
 * to the user's handwritten variables and numerals on that line.
 */
function computeHandwritingMetrics(
  symbols: RecognizedSymbolItem[],
  eqSymbol?: RecognizedSymbolItem
): { fontSize: number; spacing: number } {
  // Isolate handwritten operand symbols (letters, variables, digits)
  const operandSymbols = symbols.filter(
    (s) => /^[a-zA-Z0-9]$/.test(s.symbol) || s.symbol === "\\pi"
  );
  const refSymbols =
    operandSymbols.length > 0
      ? operandSymbols
      : symbols.filter((s) => s.symbol !== "=" && s.symbol !== "-");

  let refHeight: number;
  if (refSymbols.length > 0) {
    const sumH = refSymbols.reduce((sum, s) => sum + s.boundingBox.height, 0);
    refHeight = sumH / refSymbols.length;
  } else if (eqSymbol) {
    refHeight = Math.max(eqSymbol.boundingBox.height * 2.3, eqSymbol.boundingBox.width * 0.9);
  } else {
    refHeight = 36;
  }

  // In Caveat / Kalam / Segoe Print, visual digit height is ~0.72x the font-size.
  // To make the printed digits visually comparable to the handwritten variables (refHeight),
  // font-size is scaled to refHeight * 1.35.
  const fontSize = Math.max(22, Math.min(Math.round(refHeight * 1.35), 130));
  const spacing = Math.max(14, Math.round(refHeight * 0.4));

  return { fontSize, spacing };
}

const PEN_CURSOR = `url("data:image/svg+xml,${encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none">
  <path d="M1 23 L4 18 L16 6 C17.5 4.5 19.5 4.5 21 6 C22.5 7.5 22.5 9.5 21 11 L9 23 L4 23 Z" fill="#000000"/>
  <path d="M16 6 C17.5 4.5 19.5 4.5 21 6 C22.5 7.5 22.5 9.5 21 11 L18.5 8.5 Z" fill="#f43f5e"/>
  <path d="M15 7 L17.5 9.5 L16.5 10.5 L14 8 Z" fill="#cbd5e1"/>
  <path d="M6 16 L15 7 L16.5 8.5 L7.5 17.5 Z" fill="#38bdf8"/>
  <path d="M7.5 17.5 L16.5 8.5 L18 10 L9 19 Z" fill="#0284c7"/>
  <path d="M4 18 L6 16 L9 19 L7 21 Z" fill="#fbbf24"/>
  <path d="M1 23 L4 18 L7 21 Z" fill="#0f172a"/>
  <circle cx="1.5" cy="22.5" r="0.8" fill="#ffffff"/>
  <path d="M5.5 15.5 L14.5 6.5" stroke="#ffffff" stroke-width="0.8" stroke-linecap="round"/>
</svg>
`.trim())}") 1 23, crosshair`;

const ERASER_CURSOR = `url("data:image/svg+xml,${encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none">
  <path d="M2 22 L7 17 L17 7 C18 6 19.5 6 20.5 7 L22 8.5 C23 9.5 23 11 22 12 L12 22 L7 22 Z" fill="#000000"/>
  <path d="M12 12 L17 7 C18 6 19.5 6 20.5 7 L22 8.5 C23 9.5 23 11 22 12 L17 17 Z" fill="#fb7185"/>
  <path d="M17 17 L22 12 L20.5 13.5 L15.5 18.5 Z" fill="#e11d48"/>
  <path d="M11 13 L16 8 L17 9 L12 14 Z" fill="#60a5fa"/>
  <path d="M2 22 L7 17 L11 13 L12 14 L7 22 Z" fill="#f8fafc"/>
  <path d="M7 22 L12 14 L10.5 15.5 L5.5 22 Z" fill="#cbd5e1"/>
  <path d="M2.5 21.5 L16.5 7.5" stroke="#ffffff" stroke-width="0.8" stroke-linecap="round"/>
</svg>
`.trim())}") 2 22, cell`;

const ERASER_PIXEL_CURSOR = `url("data:image/svg+xml,${encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 18 18">
  <rect x="1.5" y="1.5" width="15" height="15" fill="#ffffff" stroke="#000000" stroke-width="1.5"/>
  <path d="M9 5 L9 13 M5 9 L13 9" stroke="#94a3b8" stroke-width="1"/>
</svg>
`.trim())}") 9 9, cell`;

export type PaperStyle = "lined" | "grid" | "dots" | "blank";
export type ThemeMode = "dark" | "light";

function App() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Digital Paper Style: 4 styles (lined, grid, dots, blank) - default is "lined"
  const [paperStyle, setPaperStyle] = useState<PaperStyle>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("calcink-paper-style");
      if (saved === "lined" || saved === "grid" || saved === "dots" || saved === "blank") {
        return saved;
      }
    }
    return "lined";
  });

  // Theme Mode: Dark mode and Light mode - default is "dark"
  const [theme, setTheme] = useState<ThemeMode>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("calcink-theme");
      if (saved === "light" || saved === "dark") {
        return saved;
      }
    }
    return "dark";
  });

  // Default pen color: White (#ffffff) in dark mode, Charcoal (#111827) in light mode
  const [strokeColor, setStrokeColor] = useState<string>(() => {
    return theme === "dark" ? "#ffffff" : "#111827";
  });

  // High-DPI device pixel ratio tracking
  const [dpr, setDpr] = useState(
    typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1
  );

  // All completed strokes
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [pixelErasures, setPixelErasures] = useState<PixelErase[]>([]);
  const [history, setHistory] = useState<CanvasState[]>([]);
  const [redoHistory, setRedoHistory] = useState<CanvasState[]>([]);

  const [isErasing, setIsErasing] = useState(false);
  const [isPixelErasing, setIsPixelErasing] = useState(false);
  const [isPanTool, setIsPanTool] = useState(false);
  const [isSpacePanning, setIsSpacePanning] = useState(false);
  const [isDraggingPan, setIsDraggingPan] = useState(false);

  // Canvas Zoom and Pan State
  const [zoom, setZoom] = useState<number>(1.0);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const viewportRef = useRef<HTMLDivElement | null>(null);

  const isPanningRef = useRef(false);
  const panStartRef = useRef<{ x: number; y: number; initialPan: { x: number; y: number } }>({
    x: 0,
    y: 0,
    initialPan: { x: 0, y: 0 },
  });

  const touchPointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinchStartRef = useRef<{
    distance: number;
    midpoint: { x: number; y: number };
    initialZoom: number;
    initialPan: { x: number; y: number };
  } | null>(null);

  const handleZoomIn = () => {
    setZoom((prev) => Math.min(3.0, Number((prev + 0.2).toFixed(2))));
  };

  const handleZoomOut = () => {
    setZoom((prev) => Math.max(0.5, Number((prev - 0.2).toFixed(2))));
  };

  const handleResetZoomAndPan = () => {
    setZoom(1.0);
    setPan({ x: 0, y: 0 });
  };

  const getCanvasCursor = () => {
    if (isPanTool || isSpacePanning) {
      return isDraggingPan ? "grabbing" : "grab";
    }
    if (isPixelErasing) {
      return ERASER_PIXEL_CURSOR;
    }
    if (isErasing) {
      return ERASER_CURSOR;
    }
    return PEN_CURSOR;
  };

  const [strokeWidth, setStrokeWidth] = useState<number>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("calcink-stroke-width");
      if (saved) {
        const parsed = Number(saved);
        if (!isNaN(parsed) && parsed >= 1 && parsed <= 10) {
          return parsed;
        }
      }
    }
    return 4; // Default to Regular 4px
  });

  const [multiResult, setMultiResult] = useState<MultiSymbolResult | null>(null);
  const [liveResult, setLiveResult] = useState<MultiSymbolResult | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isEvaluating, setIsEvaluating] = useState(false);

  // Live Reactive Status: "Evaluating..." | "Waiting for =" | "Invalid expression" | "Ready"
  const [reactiveStatus, setReactiveStatus] = useState<ReactiveStatus>("Ready");

  const getStatusClass = (status: ReactiveStatus) => {
    switch (status) {
      case "Evaluating...":
        return "evaluating";
      case "Waiting for =":
        return "waiting";
      case "Invalid expression":
        return "invalid";
      case "Graph ready":
      case "Ready":
      default:
        return "ready";
    }
  };

  // Calculation History Drawer State
  const [calculationHistory, setCalculationHistory] = useState<HistoryItem[]>(() => {
    if (typeof window !== "undefined") {
      try {
        const saved = localStorage.getItem("calcink-history");
        if (saved) return JSON.parse(saved);
      } catch (err) {
        console.error("Failed to load calculation history:", err);
      }
    }
    return [];
  });
  // Left Sidebar State (Notebook Tools: History, Color, Pen Size)
  const [isLeftSidebarOpen, setIsLeftSidebarOpen] = useState(false);
  const [activeLeftPanel, setActiveLeftPanel] = useState<"menu" | "history" | "color" | "size" | "variables">("menu");

  // Right Graph Sidebar State (2D Function Curve Plotter)
  const [isRightGraphOpen, setIsRightGraphOpen] = useState(false);
  const [detectedCurves, setDetectedCurves] = useState<PlottableCurve[]>([]);
  const [activeCurveIndex, setActiveCurveIndex] = useState(0);

  const handleChangeStrokeWidth = (w: number) => {
    setStrokeWidth(w);
    try {
      localStorage.setItem("calcink-stroke-width", String(w));
    } catch {
      // ignore
    }
  };

  // Record completed calculations in history drawer (supports single, multi-line, and variable assignments)
  const addToHistory = useCallback(
    (res: MultiSymbolResult, strokeSnapshot: Stroke[]) => {
      const linesToRecord =
        res.lines && res.lines.length > 0
          ? res.lines.filter(
              (l) => (l.hasTerminalEquals || l.evaluation.isAssignment) && (l.evaluation.success || l.evaluation.isUndefined)
            )
          : [];

      if (linesToRecord.length === 0) {
        if (!res.evaluation || res.assembledTokens.length === 0) return;
        if (!res.evaluation.success && !res.evaluation.isUndefined) return;
        linesToRecord.push({
          lineIndex: 1,
          symbols: res.symbols,
          rawTokens: res.rawTokens,
          assembledTokens: res.assembledTokens,
          evaluation: res.evaluation,
          stages: [],
          boundingBox: { minX: 0, maxX: 0, minY: 0, maxY: 0, width: 0, height: 0, centerX: 0, centerY: 0 },
          hasTerminalEquals: true,
        });
      }

      setCalculationHistory((prev) => {
        let currentHistory = [...prev];

        for (const line of linesToRecord) {
          const latex = line.evaluation.latex || line.assembledTokens.join(" ");
          const resultString = line.evaluation.resultString;

          // Prevent duplicate spam if identical calculation was just added as latest item
          if (
            currentHistory.length > 0 &&
            currentHistory[0].latex === latex &&
            currentHistory[0].resultString === resultString
          ) {
            continue;
          }

          // Extract strokes belonging specifically to this line
          const lineStrokeIds = new Set(
            line.symbols.flatMap((s) => s.strokes.map((st) => st.id))
          );
          const lineStrokes = strokeSnapshot.filter((st) => lineStrokeIds.has(st.id));

          const newItem: HistoryItem = {
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            timestamp: Date.now(),
            rawTokens: [...line.rawTokens],
            assembledTokens: [...line.assembledTokens],
            latex,
            resultString,
            isUndefined: line.evaluation.isUndefined,
            isError: line.evaluation.isError,
            errorMessage: line.evaluation.errorMessage,
            strokes:
              lineStrokes.length > 0
                ? lineStrokes
                : JSON.parse(JSON.stringify(strokeSnapshot)),
          };

          currentHistory = [newItem, ...currentHistory.slice(0, 49)];
        }

        localStorage.setItem("calcink-history", JSON.stringify(currentHistory));
        return currentHistory;
      });
    },
    []
  );

  // Dynamic inline answers projected next to each '=' on the canvas surface
  const [inlineAnswers, setInlineAnswers] = useState<InlineAnswer[]>([]);
  // Active Variable Memory Scope (e.g. { x: 10, y: 20 })
  const [variables, setVariables] = useState<Record<string, number>>({});
  const evalTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const evalGenerationRef = useRef(0);
  const strokesRef = useRef<Stroke[]>(strokes);

  useEffect(() => {
    strokesRef.current = strokes;
  }, [strokes]);

  // Sync stroke width to localStorage
  useEffect(() => {
    localStorage.setItem("calcink-stroke-width", String(strokeWidth));
  }, [strokeWidth]);

  // Sync theme to document element and localStorage
  useEffect(() => {
    localStorage.setItem("calcink-theme", theme);
    document.documentElement.setAttribute("data-theme", theme);
    document.documentElement.style.colorScheme = theme;
  }, [theme]);

  // Sync paper style to localStorage
  useEffect(() => {
    localStorage.setItem("calcink-paper-style", paperStyle);
  }, [paperStyle]);

  // Preload models in background worker thread so reactive recognition is instant
  useEffect(() => {
    initRecognitionWorker().catch((err) => console.log("Worker preload note:", err));
  }, []);

  // Cleanup debounce timer on unmount
  useEffect(() => {
    return () => {
      if (evalTimeoutRef.current) {
        clearTimeout(evalTimeoutRef.current);
      }
    };
  }, []);

  // Current stroke being drawn
  const currentStroke = useRef<Stroke | null>(null);

  // Used to generate unique stroke IDs
  const nextStrokeId = useRef(1);

  const isMouseDown = useRef(false);
  const isPixelEraseActive = useRef(false);
  const lastErasePoint = useRef<{ x: number; y: number } | null>(null);

  // Keep DPR synchronized when window is resized or moved across displays
  useEffect(() => {
    const handleDprOrResize = () => {
      setDpr(window.devicePixelRatio || 1);
    };

    window.addEventListener("resize", handleDprOrResize);

    const mediaQuery = window.matchMedia(`(resolution: ${window.devicePixelRatio}dpr)`);
    mediaQuery.addEventListener?.("change", handleDprOrResize);

    return () => {
      window.removeEventListener("resize", handleDprOrResize);
      mediaQuery.removeEventListener?.("change", handleDprOrResize);
    };
  }, []);

  const getCanvasPoint = (
    event: {
      clientX: number;
      clientY: number;
      pressure?: number;
    }
  ): RawPoint => {
    const canvas = canvasRef.current;

    if (!canvas) {
      return {
        x: 0,
        y: 0,
        pressure: 0.5,
      };
    }

    const rect = canvas.getBoundingClientRect();
    const scaleX = rect.width > 0 ? LOGICAL_WIDTH / rect.width : 1;
    const scaleY = rect.height > 0 ? LOGICAL_HEIGHT / rect.height : 1;

    return {
      x: (event.clientX - rect.left) * scaleX,
      y: (event.clientY - rect.top) * scaleY,
      pressure: 
        event.pressure !== undefined && event.pressure > 0
          ? event.pressure
          : 0.5,
    };
  };

  const startDrawing = (
    event: React.PointerEvent<HTMLCanvasElement>
  ) => {
    const canvas = canvasRef.current;

    if (!canvas) return;

    // Track pointer for multi-touch pinch-to-zoom
    touchPointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (touchPointersRef.current.size >= 2) {
      if (currentStroke.current) {
        currentStroke.current = null;
        redrawCanvas(strokes, pixelErasures, inlineAnswers);
      }
      const pts = Array.from(touchPointersRef.current.values());
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      const mid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
      pinchStartRef.current = {
        distance: dist,
        midpoint: mid,
        initialZoom: zoom,
        initialPan: { ...pan },
      };
      return;
    }

    // Pan mode check: Middle mouse click (button === 1), Pan tool, or Spacebar held
    if (event.button === 1 || isPanTool || isSpacePanning) {
      panStartRef.current = {
        x: event.clientX,
        y: event.clientY,
        initialPan: { ...pan },
      };
      isPanningRef.current = true;
      isMouseDown.current = true;
      setIsDraggingPan(true);
      canvas.setPointerCapture(event.pointerId);
      return;
    }

    // Only left-click draws/erases
    if (event.button !== 0) return;

    // Capture pointer so drawing continues smoothly even outside canvas boundaries
    canvas.setPointerCapture(event.pointerId);
    isMouseDown.current = true;

    // Invalidate pending evaluation and instantly clear inline answer when user edits
    if (evalTimeoutRef.current) {
      clearTimeout(evalTimeoutRef.current);
      evalTimeoutRef.current = null;
    }
    evalGenerationRef.current++;

    if (inlineAnswers.length > 0) {
      setInlineAnswers([]);
      redrawCanvas(strokes, pixelErasures, []);
    }

    setReactiveStatus("Evaluating...");

    if (isPixelErasing) {
      setHistory((previousHistory) => [
        ...previousHistory,
        {
          strokes: [...strokes],
          pixelErasures: [...pixelErasures],
        },
      ]);

      setRedoHistory([]);
      isPixelEraseActive.current = true;

      const point = getCanvasPoint(event);
      lastErasePoint.current = { x: point.x, y: point.y };
      pixelErase(point.x, point.y);
      return;
    }

    if (isErasing) {
      const point = getCanvasPoint(event);
      eraseAtPoint(point.x, point.y);
      return;
    }

    const rawPoint = getCanvasPoint(event);

    const point: Point = {
      x: rawPoint.x,
      y: rawPoint.y,
      pressure: rawPoint.pressure,
      width: getPressureWidth(rawPoint.pressure),
    };

    const stroke: Stroke = {
      id: nextStrokeId.current,
      points: [point],
      width: strokeWidth,
      color: strokeColor,
    };

    nextStrokeId.current += 1;
    currentStroke.current = stroke;

    // Start drawing with high-DPI scaling
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const currentDpr = window.devicePixelRatio || 1;
    ctx.setTransform(currentDpr, 0, 0, currentDpr, 0, 0);

    ctx.lineWidth = strokeWidth;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = stroke.color;

    ctx.beginPath();
    ctx.moveTo(point.x, point.y);
  };

  const draw = (
    event: React.PointerEvent<HTMLCanvasElement>
  ) => {
    const canvas = canvasRef.current;

    if (!canvas || !isMouseDown.current) return;

    // Multi-touch pinch-to-zoom & two-finger pan
    if (touchPointersRef.current.has(event.pointerId)) {
      touchPointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    }

    if (touchPointersRef.current.size >= 2 && pinchStartRef.current) {
      const pts = Array.from(touchPointersRef.current.values());
      const currentDist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      const currentMid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };

      if (pinchStartRef.current.distance > 0) {
        const scaleMultiplier = currentDist / pinchStartRef.current.distance;
        const newZoom = Math.max(0.5, Math.min(3.0, Number((pinchStartRef.current.initialZoom * scaleMultiplier).toFixed(3))));
        const dx = currentMid.x - pinchStartRef.current.midpoint.x;
        const dy = currentMid.y - pinchStartRef.current.midpoint.y;

        setZoom(newZoom);
        setPan({
          x: Math.round(pinchStartRef.current.initialPan.x + dx),
          y: Math.round(pinchStartRef.current.initialPan.y + dy),
        });
      }
      return;
    }

    // Panning in progress
    if (isPanningRef.current) {
      const dx = event.clientX - panStartRef.current.x;
      const dy = event.clientY - panStartRef.current.y;
      setPan({
        x: panStartRef.current.initialPan.x + dx,
        y: panStartRef.current.initialPan.y + dy,
      });
      return;
    }

    if (isPixelErasing) {
      if (isPixelEraseActive.current) {
        const point = getCanvasPoint(event);
        if (lastErasePoint.current) {
          const dx = point.x - lastErasePoint.current.x;
          const dy = point.y - lastErasePoint.current.y;
          const dist = Math.hypot(dx, dy);
          const step = 6;
          if (dist > step) {
            const steps = Math.ceil(dist / step);
            for (let i = 1; i <= steps; i++) {
              const t = i / steps;
              pixelErase(
                lastErasePoint.current.x + dx * t,
                lastErasePoint.current.y + dy * t
              );
            }
          } else {
            pixelErase(point.x, point.y);
          }
        } else {
          pixelErase(point.x, point.y);
        }
        lastErasePoint.current = { x: point.x, y: point.y };
      }
      return;
    }

    if (isErasing) {
      const point = getCanvasPoint(event);
      eraseAtPoint(point.x, point.y);
      return;
    }

    const stroke = currentStroke.current;
    if (!stroke) return;

    const rawPoint = getCanvasPoint(event);

    const point: Point = {
      x: rawPoint.x,
      y: rawPoint.y,
      pressure: rawPoint.pressure,
      width: getPressureWidth(rawPoint.pressure),
    };

    // Store the point
    stroke.points.push(point);

    // Draw with high-DPI scaling
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const currentDpr = window.devicePixelRatio || 1;
    ctx.setTransform(currentDpr, 0, 0, currentDpr, 0, 0);

    const previousPoint = stroke.points[stroke.points.length - 2];

    if (previousPoint) {
      const width = point.width;

      ctx.lineWidth = width;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.strokeStyle = stroke.color;

      ctx.beginPath();
      ctx.moveTo(previousPoint.x, previousPoint.y);
      ctx.lineTo(point.x, point.y);
      ctx.stroke();
    }
  };

  const stopDrawing = (
    event: React.PointerEvent<HTMLCanvasElement>
  ) => {
    const canvas = canvasRef.current;
    isMouseDown.current = false;
    isPixelEraseActive.current = false;
    lastErasePoint.current = null;

    touchPointersRef.current.delete(event.pointerId);
    if (touchPointersRef.current.size < 2) {
      pinchStartRef.current = null;
    }

    if (canvas && canvas.hasPointerCapture(event.pointerId)) {
      canvas.releasePointerCapture(event.pointerId);
    }

    if (isPanningRef.current) {
      isPanningRef.current = false;
      setIsDraggingPan(false);
      return;
    }

    if (isPixelErasing || isErasing) {
      currentStroke.current = null;
      scheduleReactiveEvaluation(strokes);
      return;
    }

    const stroke = currentStroke.current;
    if (!stroke) return;

    // Detect scratch-out scribble-to-erase gesture (rapid zigzag over strokes)
    if (!isPixelErasing && !isErasing && isScribbleStroke(stroke)) {
      const targetStrokeIds = findScratchedStrokes(stroke, strokes);
      if (targetStrokeIds.length > 0) {
        if (evalTimeoutRef.current) clearTimeout(evalTimeoutRef.current);
        evalGenerationRef.current++;

        // Save current canvas state to history for full Undo/Redo support
        setHistory((previousHistory) => [
          ...previousHistory,
          {
            strokes: [...strokes],
            pixelErasures: [...pixelErasures],
          },
        ]);
        setRedoHistory([]);

        const targetSet = new Set(targetStrokeIds);
        const remainingStrokes = strokes.filter((s) => !targetSet.has(s.id));
        setStrokes(remainingStrokes);
        currentStroke.current = null;

        if (remainingStrokes.length === 0) {
          setInlineAnswers([]);
          setLiveResult(null);
          setReactiveStatus("Ready");
          redrawCanvas(remainingStrokes, pixelErasures, []);
        } else {
          setInlineAnswers([]);
          redrawCanvas(remainingStrokes, pixelErasures, []);
          scheduleReactiveEvaluation(remainingStrokes);
        }
        return;
      }
    }

    setHistory((previousHistory) => [
      ...previousHistory,
      {
        strokes: [...strokes],
        pixelErasures: [...pixelErasures],
      },
    ]);

    setRedoHistory([]);

    const newStrokes = [...strokes, stroke];
    setStrokes(newStrokes);
    currentStroke.current = null;

    scheduleReactiveEvaluation(newStrokes);
  };

  const drawSmoothedStroke = (
  ctx: CanvasRenderingContext2D,
  stroke: Stroke
) => {
  const points = stroke.points;

  if (points.length === 0) return;

  ctx.strokeStyle = stroke.color;
  ctx.fillStyle = stroke.color;

  // Single point
  if (points.length === 1) {
    const point = points[0];

    ctx.beginPath();
    ctx.arc(
      point.x,
      point.y,
      point.width / 2,
      0,
      Math.PI * 2
    );
    ctx.fill();

    return;
  }

  // Start with the first point
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);

  /*
    For every point, use it as the control point
    and use midpoints as the start/end of the curve.
  */
  for (let i = 1; i < points.length - 1; i++) {
    const point = points[i];
    const nextPoint = points[i + 1];

    const endX =
      (point.x + nextPoint.x) / 2;

    const endY =
      (point.y + nextPoint.y) / 2;

    ctx.lineWidth = point.width;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    ctx.quadraticCurveTo(
      point.x,
      point.y,
      endX,
      endY
    );

    ctx.stroke();
    
    // Start a new path for the next width
    ctx.beginPath();
    ctx.moveTo(endX, endY);
  }

  // Finish the stroke at the final point
  const lastPoint = points[points.length - 1];
  const secondLastPoint = points[points.length - 2];

  const finalStartX =
    (secondLastPoint.x + lastPoint.x) / 2;

  const finalStartY =
    (secondLastPoint.y + lastPoint.y) / 2;

  ctx.lineWidth = lastPoint.width;

  ctx.beginPath();

  ctx.moveTo(finalStartX, finalStartY);

  ctx.quadraticCurveTo(
    lastPoint.x,
    lastPoint.y,
    lastPoint.x,
    lastPoint.y
  );

  ctx.stroke();
};

  // Canvas redraw function
  const redrawCanvas = useCallback(
    (
      strokeList: Stroke[],
      eraseList: PixelErase[],
      answers: InlineAnswer[]
    ) => {
      const canvas = canvasRef.current;

      if (!canvas) return;

      const ctx = canvas.getContext("2d");

      if (!ctx) return;

      const currentDpr = window.devicePixelRatio || 1;

      // Clear the entire canvas buffer in physical pixels
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Set scaling transform so all drawing coordinates match logical canvas space
      ctx.setTransform(currentDpr, 0, 0, currentDpr, 0, 0);

      ctx.lineCap = "round";
      ctx.lineJoin = "round";

      // Draw all strokes
      strokeList.forEach((stroke) => {
        drawSmoothedStroke(ctx, stroke);
      });

      // Apply pixel erasures
      ctx.save();
      ctx.globalCompositeOperation = "destination-out";

      eraseList.forEach((erase) => {
        ctx.beginPath();
        ctx.arc(erase.x, erase.y, erase.radius, 0, Math.PI * 2);
        ctx.fill();
      });

      ctx.restore();

      // Render dynamic inline answers immediately adjacent to each terminal equals sign
      if (answers && answers.length > 0) {
        answers.forEach((ans) => {
          ctx.save();
          // Standard handwriting format: Caveat, Kalam, Segoe Print, Chalkboard SE, cursive
          ctx.font = `600 ${ans.fontSize}px "Caveat", "Kalam", "Segoe Print", "Chalkboard SE", cursive, sans-serif`;
          ctx.textBaseline = "middle";
          ctx.textAlign = "left";

          if (ans.isUndefined) {
            ctx.fillStyle = theme === "dark" ? "#fbbf24" : "#d97706"; // High contrast amber warning for Undefined
          } else if (ans.isAssignment) {
            ctx.fillStyle = theme === "dark" ? "#34d399" : "#059669"; // Emerald Mint for stored variable
          } else {
            ctx.fillStyle = theme === "dark" ? "#38bdf8" : "#2563eb"; // Luminous sky cyan in dark mode, royal blue in light mode
          }

          ctx.fillText(ans.text, ans.x, ans.y);
          ctx.restore();
        });
      }
    },
    [theme]
  );

  useEffect(() => {
    redrawCanvas(strokes, pixelErasures, inlineAnswers);
  }, [strokes, pixelErasures, dpr, inlineAnswers, redrawCanvas]);

  // Redraw when custom web handwriting fonts (Caveat / Kalam) finish loading
  useEffect(() => {
    if (typeof document !== "undefined" && document.fonts) {
      document.fonts.ready.then(() => {
        redrawCanvas(strokes, pixelErasures, inlineAnswers);
      });
    }
  }, [redrawCanvas, strokes, pixelErasures, inlineAnswers]);

  // Wheel and Trackpad Zoom / Pan Listener
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();

      if (e.ctrlKey || e.metaKey) {
        // Trackpad pinch-to-zoom OR Ctrl + Mouse Wheel
        const canvas = canvasRef.current;
        if (!canvas) return;

        const currentRect = canvas.getBoundingClientRect();
        const currentCenterX = currentRect.left + currentRect.width / 2;
        const currentCenterY = currentRect.top + currentRect.height / 2;
        const diffX = e.clientX - currentCenterX;
        const diffY = e.clientY - currentCenterY;

        const zoomDelta = -e.deltaY * 0.003;
        setZoom((prevZoom) => {
          const newZoom = Math.max(
            0.5,
            Math.min(3.0, Number((prevZoom * (1 + zoomDelta)).toFixed(3)))
          );
          if (newZoom <= 1.0) {
            setPan({ x: 0, y: 0 });
            return newZoom;
          }
          const ratio = newZoom / prevZoom;
          setPan((prevPan) => {
            const vp = viewportRef.current;
            const vpW = vp ? vp.clientWidth : 1200;
            const vpH = vp ? vp.clientHeight : 650;
            const maxPanX = Math.max(0, Math.round((vpW * (newZoom - 1)) / 2 + 40));
            const maxPanY = Math.max(0, Math.round((vpH * (newZoom - 1)) / 2 + 40));
            const nextX = Math.round(prevPan.x + diffX * (1 - ratio));
            const nextY = Math.round(prevPan.y + diffY * (1 - ratio));
            return {
              x: Math.max(-maxPanX, Math.min(maxPanX, nextX)),
              y: Math.max(-maxPanY, Math.min(maxPanY, nextY)),
            };
          });
          return newZoom;
        });
      }
      // Note: Normal mouse wheel scroll (without Ctrl/Meta) is ignored to keep canvas firmly anchored and prevent sliding up/down over dark background
    };

    viewport.addEventListener("wheel", handleWheel, { passive: false });
    return () => viewport.removeEventListener("wheel", handleWheel);
  }, []);

  function scheduleReactiveEvaluation(
    currentStrokes?: Stroke[],
    scopeOverride?: Record<string, number>
  ) {
    if (evalTimeoutRef.current) {
      clearTimeout(evalTimeoutRef.current);
    }

    const strokesToEval = currentStrokes || strokesRef.current;
    if (strokesToEval.length === 0) {
      setInlineAnswers([]);
      setLiveResult(null);
      setReactiveStatus("Ready");
      return;
    }

    setReactiveStatus("Evaluating...");

    evalTimeoutRef.current = setTimeout(async () => {
      await runReactiveEvaluation(strokesToEval, scopeOverride);
    }, 850); // 850ms responsive debounce after user pauses drawing
  }

  function clearVariables() {
    setVariables({});
    scheduleReactiveEvaluation(strokesRef.current, {});
  }

  function deleteVariable(varName: string) {
    setVariables((prev) => {
      const next = { ...prev };
      delete next[varName];
      scheduleReactiveEvaluation(strokesRef.current, next);
      return next;
    });
  }

  async function runReactiveEvaluation(
    strokesToEval: Stroke[],
    scopeOverride?: Record<string, number>
  ) {
    if (strokesToEval.length === 0) {
      setInlineAnswers([]);
      setLiveResult(null);
      setReactiveStatus("Ready");
      return;
    }

    const currentGen = ++evalGenerationRef.current;
    setReactiveStatus("Evaluating...");

    try {
      const scopeToUse = scopeOverride !== undefined ? scopeOverride : variables;
      const res = await evaluateStrokesWorker(strokesToEval, scopeToUse);

      // Check if user continued drawing/erasing while inference was running
      if (currentGen !== evalGenerationRef.current) {
        return;
      }

      if (res.lines.length === 0 || res.symbols.length === 0) {
        setInlineAnswers([]);
        setLiveResult(null);
        setReactiveStatus("Ready");
        return;
      }

      setLiveResult(res);
      setVariables(res.variables);

      // Detect 2D function curves from recognized lines
      const curves = detectPlottableCurves(res.lines, res.variables);
      setDetectedCurves(curves);

      const newAnswers: InlineAnswer[] = [];
      let anyLineHasError = false;
      let anyLineWaitingForEquals = false;
      let anyLineSolved = false;

      for (const line of res.lines) {
        if (line.symbols.length === 0) continue;

        const isCurve = line.evaluation.isCurve;
        const hasTerminalEquals = line.hasTerminalEquals;

        // If this is a pure curve without terminal equals or without a numeric value:
        if (isCurve && (!hasTerminalEquals || line.evaluation.value === null)) {
          // 2D function curve (e.g. y = x^2, x^2 - 4, x + y = 6): no inline text on canvas, but line is valid!
          anyLineSolved = true;
          continue;
        }

        // Process line stages (supports single equations and chained expressions e.g. x + 5 = 8 + 2 = 10)
        const stagesToProcess =
          line.stages && line.stages.length > 0
            ? line.stages
            : [
                {
                  stageIndex: 0,
                  symbols: line.symbols,
                  rawTokens: line.rawTokens,
                  assembledTokens: line.assembledTokens,
                  evaluation: line.evaluation,
                  hasTerminalEquals: line.hasTerminalEquals,
                  terminalEqualsSymbol: line.symbols[line.symbols.length - 1],
                  skipDisplayAnswer: false,
                },
              ];

        for (const stage of stagesToProcess) {
          const isAssignment = stage.evaluation.isAssignment;
          const stageHasTerminalEquals = stage.hasTerminalEquals;

          if (isAssignment) {
            // Variable declarations are stored in memory without displaying inline tick mark/stored indicator
            anyLineSolved = true;
            continue;
          }

          if (!stageHasTerminalEquals) {
            // If this stage has consecutive operators like 2 + + 3 before '=', flag error
            if (hasConsecutiveOperators(stage.rawTokens, res.variables)) {
              anyLineHasError = true;
            } else {
              anyLineWaitingForEquals = true;
            }
            continue;
          }

          // When the expression in this stage is invalid:
          if (stage.evaluation.isError) {
            anyLineHasError = true;
            continue;
          }

          // If user handwrote the number after '=', skip synthetic rendering to avoid overlap
          if (stage.skipDisplayAnswer) {
            anyLineSolved = true;
            continue;
          }

          const eqSym = stage.terminalEqualsSymbol || line.symbols[line.symbols.length - 1];
          const eqBox = eqSym.boundingBox;
          const { fontSize, spacing } = computeHandwritingMetrics(stage.symbols, eqSym);

          const answerX = Math.min(eqBox.maxX + spacing, LOGICAL_WIDTH - 60);
          const answerY = eqBox.centerY;

          if (stage.evaluation.isUndefined) {
            newAnswers.push({
              lineIndex: line.lineIndex,
              stageIndex: stage.stageIndex,
              text: "Undefined",
              x: answerX,
              y: answerY,
              fontSize,
              isUndefined: true,
              isAssignment: false,
            });
            anyLineSolved = true;
          } else if (stage.evaluation.success) {
            newAnswers.push({
              lineIndex: line.lineIndex,
              stageIndex: stage.stageIndex,
              text: stage.evaluation.resultString,
              x: answerX,
              y: answerY,
              fontSize,
              isUndefined: false,
              isAssignment: false,
            });
            anyLineSolved = true;
          }
        }
      }

      setInlineAnswers(newAnswers);

      if (anyLineSolved) {
        addToHistory(res, strokesToEval);
      }

      // Update live reactive status across all lines
      if (anyLineHasError) {
        setReactiveStatus("Invalid expression");
      } else if (curves.length > 0) {
        setReactiveStatus("Graph ready");
      } else if (anyLineWaitingForEquals) {
        setReactiveStatus("Waiting for =");
      } else if (anyLineSolved) {
        setReactiveStatus("Ready");
      } else {
        setReactiveStatus("Ready");
      }
    } catch (err) {
      console.error("Reactive evaluation error:", err);
      if (currentGen === evalGenerationRef.current) {
        setInlineAnswers([]);
        setLiveResult(null);
        setReactiveStatus("Invalid expression");
      }
    }
  };

  const undo = () => {
    if (history.length === 0) {
      return;
    }

    if (evalTimeoutRef.current) clearTimeout(evalTimeoutRef.current);
    evalGenerationRef.current++;
    setInlineAnswers([]);

    const previousState =
      history[history.length - 1];

    // Save current state for redo
    setRedoHistory((previousRedo) => [
      ...previousRedo,
      {
        strokes: [...strokes],
        pixelErasures: [...pixelErasures],
      },
    ]);

    setStrokes(previousState.strokes);
    setPixelErasures(previousState.pixelErasures);

    setHistory((previousHistory) =>
      previousHistory.slice(0, -1)
    );

    scheduleReactiveEvaluation(previousState.strokes);
  };

  const redo = () => {
    if (redoHistory.length === 0) {
      return;
    }

    if (evalTimeoutRef.current) clearTimeout(evalTimeoutRef.current);
    evalGenerationRef.current++;
    setInlineAnswers([]);

    const nextState =
      redoHistory[redoHistory.length - 1];

    setHistory((previousHistory) => [
      ...previousHistory,
      {
        strokes: [...strokes],
        pixelErasures: [...pixelErasures],
      },
    ]);

    setStrokes(nextState.strokes);
    setPixelErasures(nextState.pixelErasures);

    setRedoHistory((previousRedo) =>
      previousRedo.slice(0, -1)
    );

    scheduleReactiveEvaluation(nextState.strokes);
  };

  const clearCanvas = () => {
    if (
      strokes.length == 0 && pixelErasures.length == 0
    ) {
      return;
    }

    if (evalTimeoutRef.current) clearTimeout(evalTimeoutRef.current);
    evalGenerationRef.current++;
    setInlineAnswers([]);

    setHistory((previousHistory) => [
      ...previousHistory,
      {
        strokes: [...strokes],
        pixelErasures: [...pixelErasures],
      },
    ]);

    setRedoHistory([]);

    setStrokes([]);

    setPixelErasures([]);

    setLiveResult(null);

    setVariables({});

    setDetectedCurves([]);

    setIsRightGraphOpen(false);

    setReactiveStatus("Ready");
  };

  const findStrokeAtPoint = (
  x: number,
  y: number
): number | null => {

  const eraserRadius = 10;

  for (let i = strokes.length - 1; i >= 0; i--) {

    const stroke = strokes[i];

    for (const point of stroke.points) {

      const dx = point.x - x;
      const dy = point.y - y;

      const distance =
        Math.sqrt(dx * dx + dy * dy);

      if (distance <= eraserRadius) {
        return stroke.id;
      }
    }
  }

  return null;
};

  const eraseAtPoint = (
  x: number,
  y: number
) => {

  const strokeId = findStrokeAtPoint(x, y);

  if (strokeId === null) {
    return;
  }

  const strokeToRemove = strokes.find(
    (stroke) => stroke.id === strokeId
  );

  if (!strokeToRemove) {
    return;
  }

  if (evalTimeoutRef.current) clearTimeout(evalTimeoutRef.current);
  evalGenerationRef.current++;
  setInlineAnswers([]);

  // Save current state before deleting
  setHistory((previousHistory) => [
    ...previousHistory,
    {
      strokes: [...strokes],
      pixelErasures: [...pixelErasures],
    },
  ]);

  // New action invalidates redo
  setRedoHistory([]);

  // Remove the stroke
  const newStrokes = strokes.filter(
    (stroke) => stroke.id !== strokeId
  );
  setStrokes(newStrokes);
  scheduleReactiveEvaluation(newStrokes);
};

  const pixelErase = (
  x: number,
  y: number
) => {
  const eraserSize = 25;

  const erase: PixelErase = {
    x,
    y,
    radius: eraserSize / 2,
  };

  setPixelErasures((previousErasures) => [
    ...previousErasures,
    erase,
  ]);
};

  const getPressureWidth = (pressure: number) => {
  const minWidth = strokeWidth * 0.35;
  const maxWidth = strokeWidth;

  return (
    minWidth +
    (maxWidth - minWidth) * pressure
  );
};

  const handleCalculateExpression = async () => {
    if (strokes.length === 0) {
      alert("Please draw an equation or math expression on the canvas first!");
      return;
    }

    try {
      setIsEvaluating(true);
      setReactiveStatus("Evaluating...");
      const res = await evaluateStrokesWorker(strokes);
      setMultiResult(res);
      setLiveResult(res);
      setIsModalOpen(true);
      addToHistory(res, strokes);
      if (res.evaluation.isError) {
        setReactiveStatus("Invalid expression");
      } else {
        setReactiveStatus("Ready");
      }
    } catch (error) {
      console.error("Expression evaluation failed:", error);
      setReactiveStatus("Invalid expression");
      alert(
        "Failed to evaluate expression: " +
          (error instanceof Error ? error.message : String(error))
      );
    } finally {
      setIsEvaluating(false);
    }
  };

  const handleToggleTheme = () => {
    const nextTheme = theme === "dark" ? "light" : "dark";
    setTheme(nextTheme);

    if (nextTheme === "light") {
      // If strokeColor is white/chalk, switch to dark ink for light mode
      if (strokeColor.toLowerCase() === "#ffffff" || strokeColor.toLowerCase() === "#f8fafc") {
        setStrokeColor("#111827");
      }
      // Adapt existing default white strokes so they don't disappear on white paper
      setStrokes((prev) =>
        prev.map((s) =>
          s.color.toLowerCase() === "#ffffff" || s.color.toLowerCase() === "#f8fafc"
            ? { ...s, color: "#111827" }
            : s
        )
      );
    } else {
      // If strokeColor is dark ink, switch to white for dark mode
      if (strokeColor.toLowerCase() === "#111827" || strokeColor.toLowerCase() === "#000000") {
        setStrokeColor("#ffffff");
      }
      // Adapt existing default dark strokes so they don't disappear on dark paper
      setStrokes((prev) =>
        prev.map((s) =>
          s.color.toLowerCase() === "#111827" || s.color.toLowerCase() === "#000000"
            ? { ...s, color: "#ffffff" }
            : s
        )
      );
    }
  };

  const handleSelectPreset = (c: string) => {
    setStrokeColor(c);
    // If an eraser was selected, switch back to pen automatically
    if (isErasing || isPixelErasing) {
      setIsErasing(false);
      setIsPixelErasing(false);
      isPixelEraseActive.current = false;
    }
  };

  const handleLoadHistoryItem = (item: HistoryItem) => {
    if (evalTimeoutRef.current) {
      clearTimeout(evalTimeoutRef.current);
      evalTimeoutRef.current = null;
    }
    evalGenerationRef.current++;

    // Save current state to undo history
    setHistory((prev) => [
      ...prev,
      {
        strokes: [...strokes],
        pixelErasures: [...pixelErasures],
      },
    ]);
    setRedoHistory([]);

    // Restore strokes
    const restoredStrokes = JSON.parse(JSON.stringify(item.strokes));
    setStrokes(restoredStrokes);
    setPixelErasures([]);
    setIsLeftSidebarOpen(false);

    // Schedule reactive re-evaluation
    scheduleReactiveEvaluation(restoredStrokes);
  };

  const handleDeleteHistoryItem = (id: string) => {
    setCalculationHistory((prev) => {
      const next = prev.filter((item) => item.id !== id);
      localStorage.setItem("calcink-history", JSON.stringify(next));
      return next;
    });
  };

  const handleClearHistory = () => {
    // Instant clear without confirmation message
    setCalculationHistory([]);
    localStorage.removeItem("calcink-history");
  };

  // Keyboard shortcuts for Undo (Ctrl+Z), Redo (Ctrl+Y), and History (Ctrl+H)
  const undoRef = useRef(undo);
  const redoRef = useRef(redo);

  useEffect(() => {
    undoRef.current = undo;
    redoRef.current = redo;
  });

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return;
      }

      if ((e.ctrlKey || e.metaKey) && (e.key === "=" || e.key === "+")) {
        e.preventDefault();
        handleZoomIn();
      } else if ((e.ctrlKey || e.metaKey) && e.key === "-") {
        e.preventDefault();
        handleZoomOut();
      } else if ((e.ctrlKey || e.metaKey) && e.key === "0") {
        e.preventDefault();
        handleResetZoomAndPan();
      } else if (e.code === "Space" && !e.repeat) {
        setIsSpacePanning(true);
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        if (e.shiftKey) {
          e.preventDefault();
          redoRef.current();
        } else {
          e.preventDefault();
          undoRef.current();
        }
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
        e.preventDefault();
        redoRef.current();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "h") {
        e.preventDefault();
        setIsLeftSidebarOpen((prev) => !prev);
        setActiveLeftPanel("history");
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        setIsSpacePanning(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, []);

  return (
    <div className="app" data-theme={theme}>
      <header className="header">
        <div className="header-brand">
          <div className="header-icon">✍️</div>
          <div className="header-title-box">
            <h1>CalcInk</h1>
            <p>Digital Math Notebook</p>
          </div>
        </div>

        {/* Live Reactive Status Indicator & Variable Memory HUD */}
        <div className="header-center-status">
          <div
            className={`live-status-pill status-${getStatusClass(reactiveStatus)}`}
            title={`Live Reactive Status: ${reactiveStatus}`}
            role="status"
            aria-live="polite"
          >
            <span className="live-status-dot" />
            <span className="live-status-text">{reactiveStatus}</span>
          </div>

          {Object.keys(variables).length > 0 && (
            <div
              className="header-variable-pill"
              title="Active Variable Memory (Click to open Inspector)"
              onClick={() => {
                setActiveLeftPanel("variables");
                setIsLeftSidebarOpen(true);
              }}
            >
              <span className="variable-pill-symbol">𝑥</span>
              <span className="variable-pill-text">
                {Object.entries(variables)
                  .slice(0, 3)
                  .map(([k, v]) => `${k} = ${v}`)
                  .join(", ")}
                {Object.keys(variables).length > 3 && ` +${Object.keys(variables).length - 3}`}
              </span>
              <button
                type="button"
                className="variable-pill-clear-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  clearVariables();
                }}
                title="Clear all variables"
              >
                ✕
              </button>
            </div>
          )}
        </div>

        <div className="header-meta">
          <span className="header-badge">
            Strokes: <strong>{strokes.length}</strong>
          </span>
          <button
            type="button"
            className="theme-toggle-btn"
            onClick={handleToggleTheme}
            title={`Switch to ${theme === "dark" ? "Light" : "Dark"} Mode`}
          >
            {theme === "dark" ? (
              <>
                <span>🌙</span> Dark
              </>
            ) : (
              <>
                <span>☀️</span> Light
              </>
            )}
          </button>
        </div>
      </header>

      <div className="toolbar">
        {/* Paper Style Selector: 4 styles, Horizontal Lined as default */}
        <div className="toolbar-group">
          <span className="toolbar-group-label">Paper:</span>
          <div className="segmented-control" role="radiogroup" aria-label="Paper Style">
            <button
              type="button"
              className={`segmented-btn ${paperStyle === "lined" ? "active" : ""}`}
              onClick={() => setPaperStyle("lined")}
              title="Horizontal Lined Notebook (Default)"
            >
              <span>📝</span>
              <span>Lined</span>
            </button>
            <button
              type="button"
              className={`segmented-btn ${paperStyle === "grid" ? "active" : ""}`}
              onClick={() => setPaperStyle("grid")}
              title="Graph / Quad Grid Paper"
            >
              <span>📐</span>
              <span>Grid</span>
            </button>
            <button
              type="button"
              className={`segmented-btn ${paperStyle === "dots" ? "active" : ""}`}
              onClick={() => setPaperStyle("dots")}
              title="Dot Grid Paper"
            >
              <span>⠇</span>
              <span>Dots</span>
            </button>
            <button
              type="button"
              className={`segmented-btn ${paperStyle === "blank" ? "active" : ""}`}
              onClick={() => setPaperStyle("blank")}
              title="Blank Plain Sheet"
            >
              <span>📄</span>
              <span>Blank</span>
            </button>
          </div>
        </div>

        <div className="toolbar-divider" />

        {/* Drawing & Erasing Tools */}
        <div className="toolbar-group">
          <div className="segmented-control" role="group" aria-label="Tool Selection">
            <button
              type="button"
              className={`segmented-btn ${!isErasing && !isPixelErasing && !isPanTool ? "active" : ""}`}
              onClick={() => {
                setIsErasing(false);
                setIsPixelErasing(false);
                setIsPanTool(false);
                isPixelEraseActive.current = false;
              }}
              title="Pen (Draw math — scribble to scratch out)"
            >
              <span>✏️</span>
              <span>Pen</span>
            </button>
            <button
              type="button"
              className={`segmented-btn ${isErasing ? "active" : ""}`}
              onClick={() => {
                setIsErasing(true);
                setIsPixelErasing(false);
                setIsPanTool(false);
                isPixelEraseActive.current = false;
              }}
              title="Stroke Eraser (erases clicked stroke)"
            >
              <span>🧹</span>
              <span>Eraser</span>
            </button>
            <button
              type="button"
              className={`segmented-btn ${isPixelErasing ? "active" : ""}`}
              onClick={() => {
                setIsPixelErasing(true);
                setIsErasing(false);
                setIsPanTool(false);
                isPixelEraseActive.current = false;
              }}
              title="Pixel Eraser (precise erasing along path)"
            >
              <span>⌫</span>
              <span>Pixel</span>
            </button>
            <button
              type="button"
              className={`segmented-btn ${isPanTool ? "active" : ""}`}
              onClick={() => {
                setIsPanTool(true);
                setIsErasing(false);
                setIsPixelErasing(false);
                isPixelEraseActive.current = false;
              }}
              title="Pan / Hand Tool (Drag to move canvas, or hold Space)"
            >
              <span>✋</span>
              <span>Pan</span>
            </button>
          </div>
        </div>

        <div className="toolbar-divider" />

        {/* Compact Quick Pen Size & Color Pill (Opens Left Sidebar) */}
        <div className="toolbar-group">
          <button
            type="button"
            className="toolbar-quick-size-btn"
            onClick={() => {
              setIsLeftSidebarOpen(true);
              setActiveLeftPanel("size");
            }}
            title="Pen Size & Thickness (Click to open sidebar)"
          >
            <span>📏</span>
            <span>{strokeWidth}px</span>
            <span
              className="quick-color-dot"
              style={{ backgroundColor: strokeColor }}
              title={`Active color: ${strokeColor}`}
            />
          </button>
        </div>

        <div className="toolbar-spacer" />

        {/* History & Calculation Actions - Fully visible without truncation */}
        <div className="toolbar-group">
          <button
            type="button"
            className="action-btn"
            onClick={undo}
            disabled={history.length === 0}
            title="Undo stroke (Ctrl+Z)"
          >
            <span>↩</span> Undo
          </button>
          <button
            type="button"
            className="action-btn"
            onClick={redo}
            disabled={redoHistory.length === 0}
            title="Redo stroke (Ctrl+Y)"
          >
            <span>↪</span> Redo
          </button>
          <button
            type="button"
            className="action-btn btn-clear"
            onClick={clearCanvas}
            disabled={strokes.length === 0 && pixelErasures.length === 0}
            title="Clear canvas"
          >
            <span>🗑</span> Clear
          </button>
          <button
            type="button"
            className="btn-calculate"
            onClick={handleCalculateExpression}
            disabled={isEvaluating}
            title="Recognize expression and display LaTeX breakdown"
          >
            {isEvaluating ? "Calculating..." : "✨ Calculate"}
          </button>
        </div>
      </div>

      <main className="paper-container">
        {/* Toggle Button on the Left of the Canvas */}
        {!isLeftSidebarOpen && (
          <button
            type="button"
            className="canvas-left-toggle-btn"
            onClick={() => {
              setIsLeftSidebarOpen(true);
              setActiveLeftPanel("menu");
            }}
            title="Open Notebook Tools (History, Color, Pen Size)"
            aria-label="Open Left Sidebar"
          >
            <span className="toggle-chevron">›</span>
          </button>
        )}

        {/* Left Sidebar: Constrained ONLY above the writing canvas, NO blurred background */}
        <LeftSidebar
          isOpen={isLeftSidebarOpen}
          onClose={() => setIsLeftSidebarOpen(false)}
          activePanel={activeLeftPanel}
          setActivePanel={setActiveLeftPanel}
          history={calculationHistory}
          onLoadHistoryItem={handleLoadHistoryItem}
          onDeleteHistoryItem={handleDeleteHistoryItem}
          onClearHistory={handleClearHistory}
          strokeColor={strokeColor}
          onSelectColor={handleSelectPreset}
          theme={theme}
          strokeWidth={strokeWidth}
          onChangeStrokeWidth={handleChangeStrokeWidth}
          variables={variables}
          onClearVariables={clearVariables}
          onDeleteVariable={deleteVariable}
        />

        {/* Toggle Button on the Right of the Canvas (Appears when 2D Curve is detected) */}
        {!isRightGraphOpen && detectedCurves.length > 0 && (
          <button
            type="button"
            className="canvas-right-toggle-btn"
            onClick={() => setIsRightGraphOpen(true)}
            title="Open 2D Function Curve Graph"
            aria-label="Open Right Graph Sidebar"
          >
            <span className="toggle-chevron">‹</span>
            <span className="toggle-graph-icon">📈</span>
            <span className="toggle-graph-label">Graph</span>
          </button>
        )}

        {/* Right Sidebar: Constrained ONLY above the writing canvas, NO blurred background */}
        <RightGraphSidebar
          isOpen={isRightGraphOpen}
          onClose={() => setIsRightGraphOpen(false)}
          curves={detectedCurves}
          activeCurveIndex={activeCurveIndex}
          onSelectCurveIndex={setActiveCurveIndex}
          theme={theme}
          strokeColor={strokeColor}
        />

        <div className="canvas-wrapper">
          <div className="canvas-viewport" ref={viewportRef}>
            <canvas
              ref={canvasRef}
              className={`paper-canvas paper-${paperStyle}`}
              width={Math.round(LOGICAL_WIDTH * dpr)}
              height={Math.round(LOGICAL_HEIGHT * dpr)}
              onPointerDown={startDrawing}
              onPointerMove={draw}
              onPointerUp={stopDrawing}
              onPointerCancel={stopDrawing}
              style={{
                transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                transformOrigin: "center center",
                cursor: getCanvasCursor(),
              }}
            />

            {/* Floating Zoom & Pan Controls HUD */}
            <div className="canvas-zoom-controls" role="toolbar" aria-label="Canvas Zoom and View Controls">
              <button
                type="button"
                className="zoom-btn"
                onClick={handleZoomOut}
                disabled={zoom <= 0.5}
                title="Zoom Out (Ctrl - or Wheel)"
              >
                −
              </button>
              <button
                type="button"
                className="zoom-btn zoom-level-btn"
                onClick={handleResetZoomAndPan}
                title="Click to reset to 100% (Ctrl 0)"
              >
                {Math.round(zoom * 100)}%
              </button>
              <button
                type="button"
                className="zoom-btn"
                onClick={handleZoomIn}
                disabled={zoom >= 3.0}
                title="Zoom In (Ctrl + or Wheel)"
              >
                +
              </button>
              <button
                type="button"
                className="zoom-btn zoom-reset-icon"
                onClick={handleResetZoomAndPan}
                title="Reset Pan & Zoom to Center (Ctrl 0)"
              >
                ⟲
              </button>
            </div>
          </div>
          <LatexReadingStrip
            liveResult={liveResult}
            reactiveStatus={reactiveStatus}
            hasStrokes={strokes.length > 0}
            theme={theme}
          />
        </div>
      </main>

      <ResultModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        multiResult={multiResult}
        onClearCanvas={clearCanvas}
      />
    </div>
  );
}

export default App;