/**
 * Bézier control-point editor: one paste-friendly number field and a draggable curve.
 *
 * The chart stores `x1, y1, x2, y2` as one array, so the editor edits that array
 * through a single draft: a pasted control-point line can be corrected as a
 * whole, and its first four numbers become the curve. The canvas remains a
 * direct-manipulation preview of the same draft. Both x coordinates stay inside
 * `[0, 1]`; y may overshoot either end, and the shared plot rect keeps every
 * handle reachable without moving the frame.
 *
 * Painting goes through `easingCanvas.ts` like the easing preview does, so the
 * frame, the overshoot fade, and the theme colours are the same code.
 */
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { FieldRow } from "../field/FieldRow.tsx";
import { Input } from "../input/Input.tsx";
import { bezier } from "../../../core/utils/easing.ts";
import { clamp01 } from "../../../core/utils/numbers.ts";
import { t } from "../../../i18n/index.ts";
import { formatBezierPoints, parseBezierPointText } from "./bezierPointText.ts";
import {
  EASING_CANVAS_HEIGHT,
  EASING_CANVAS_WIDTH,
  EASING_GUIDE_ALPHA,
  EASING_PLOT,
  drawEasingFrame,
  drawEasingUnitLines,
  easingProgressX,
  prepareEasingCanvas,
  strokeEasingPolyline,
} from "./easingCanvas.ts";

interface BezierEditorProps {
  points: readonly number[];
  commit: (points: number[]) => void;
  /** Publish a transient curve while dragging; null clears the preview. */
  preview?: (points: readonly number[] | null) => void;
  /** Accessible label for the control-point field. */
  label: string;
}

const WIDTH = EASING_CANVAS_WIDTH;
const HEIGHT = EASING_CANVAS_HEIGHT;
const PLOT_WIDTH = EASING_PLOT.right - EASING_PLOT.left;
const PLOT_HEIGHT = EASING_PLOT.bottom - EASING_PLOT.top;
const DEFAULT_POINTS = [0, 0, 1, 1];
/** Control-point indices, in the order their two handle styles are stored. */
const HANDLE_POINTS = [0, 2] as const;
/** Pointer distance, in logical canvas pixels, that still grabs a handle. */
const HIT_RADIUS = 18;
/** Idle handle size; hovered and dragged handles grow to a second size. */
const HANDLE_RADIUS = 4;
const HANDLE_ACTIVE_RADIUS = 5.2;
/** Handle colour and size transitions. */
const HANDLE_TRANSITION_MS = 140;
/** Curve segments across the transfer. */
const SEGMENTS = 96;

/** The value range the vertical axis shows; the unit square is always part of it. */
interface ValueWindow {
  minimum: number;
  maximum: number;
}

/** One animated handle look. */
interface HandleStyle {
  radius: number;
  color: readonly [number, number, number];
}

/** Keep malformed chart data out of the editor while preserving the format shape. */
function normalizePoints(points: readonly number[]): number[] {
  return DEFAULT_POINTS.map((fallback, index) => {
    const value = points[index];
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return fallback;
    }
    return index % 2 === 0 ? clamp01(value) : value;
  });
}

/** Fit the vertical axis to the unit square plus every stored y value. */
function valueWindow(points: readonly number[]): ValueWindow {
  const ys = [points[1] ?? 0, points[3] ?? 1];
  return { minimum: Math.min(0, ...ys), maximum: Math.max(1, ...ys) };
}

/** Read a resolved theme colour as RGB; theme tokens are hex or rgb strings. */
function colorRgb(value: string): readonly [number, number, number] {
  const hex = /^#([0-9a-f]{3,8})$/iu.exec(value.trim())?.[1];
  if (hex) {
    const expanded =
      hex.length === 3 || hex.length === 4
        ? hex
            .slice(0, 3)
            .split("")
            .map((part) => part + part)
            .join("")
        : hex.slice(0, 6);
    if (expanded.length === 6) {
      const channel = (offset: number) => Number.parseInt(expanded.slice(offset, offset + 2), 16);
      return [channel(0), channel(2), channel(4)];
    }
  }
  const rgb = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/iu.exec(value.trim());
  if (rgb) {
    return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  }
  return [232, 236, 244];
}

/** Blend two RGB colours for one frame of the handle transition. */
function mixRgb(
  from: readonly [number, number, number],
  to: readonly [number, number, number],
  amount: number,
): readonly [number, number, number] {
  return [
    Math.round(from[0] + (to[0] - from[0]) * amount),
    Math.round(from[1] + (to[1] - from[1]) * amount),
    Math.round(from[2] + (to[2] - from[2]) * amount),
  ];
}

/** Render one RGB triple as a canvas fill colour. */
function colorFill(color: readonly [number, number, number]): string {
  const part = (value: number) => Math.round(value).toString(16).padStart(2, "0");
  return `#${part(color[0])}${part(color[1])}${part(color[2])}`;
}

/** A labelled Bézier field with one control-point draft and a responsive curve. */
export function BezierEditor({ points, commit, preview, label }: BezierEditorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const draftPoints = useRef(normalizePoints(points));
  const dragIndex = useRef<number | null>(null);
  const hoverIndex = useRef<number | null>(null);
  /**
   * The axis captured when a drag starts. The pointer is mapped through it for
   * the whole gesture so the value cannot chase a rescaling plot; the drawing
   * itself refits to the draft live.
   */
  const dragWindow = useRef<ValueWindow | null>(null);
  const dragChanged = useRef(false);
  const [draftText, setDraftText] = useState(() => formatBezierPoints(normalizePoints(points)));
  const draftTextRef = useRef(draftText);
  const [drawVersion, setDrawVersion] = useState(0);
  const handleStyles = useRef<HandleStyle[]>([
    { radius: HANDLE_RADIUS, color: [232, 236, 244] },
    { radius: HANDLE_RADIUS, color: [232, 236, 244] },
  ]);
  const stylesReady = useRef(false);
  const animationFrame = useRef<number | null>(null);
  const animation = useRef<{
    start: number;
    from: HandleStyle[];
    to: HandleStyle[];
  } | null>(null);
  const paintRef = useRef<() => void>(() => {});
  const parsedDraft = parseBezierPointText(draftText);
  // An unfinished draft is not wrong yet; only a complete set with a
  // non-finite number is marked. Incomplete text restores on blur.
  const invalid = !parsedDraft.valid && parsedDraft.issue === "non-finite";

  useEffect(() => {
    if (dragIndex.current !== null) {
      return;
    }
    const next = normalizePoints(points);
    const text = formatBezierPoints(next);
    if (text === draftTextRef.current) {
      return;
    }
    draftPoints.current = next;
    draftTextRef.current = text;
    setDraftText(text);
    setDrawVersion((version) => version + 1);
  }, [points]);

  useEffect(() => {
    const redraw = () => setDrawVersion((version) => version + 1);
    window.addEventListener("redux-theme", redraw);
    const canvas = canvasRef.current;
    const observer =
      canvas && typeof ResizeObserver !== "undefined" ? new ResizeObserver(redraw) : null;
    if (observer && canvas) {
      observer.observe(canvas);
    }
    redraw();
    return () => {
      window.removeEventListener("redux-theme", redraw);
      observer?.disconnect();
    };
  }, []);

  /** The size and colour each handle settles on for the current state. */
  const handleTargets = (): HandleStyle[] => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return handleStyles.current;
    }
    const style = getComputedStyle(canvas);
    const token = (name: string) => style.getPropertyValue(name).trim();
    const idle = token("--foreground");
    const hover = token("--accent-hover") || token("--accent") || idle;
    const active = token("--accent-pressed") || token("--accent") || idle;
    const dragging = dragIndex.current;
    return HANDLE_POINTS.map((index) => {
      const isActive = dragging === index;
      const isHovered = hoverIndex.current === index;
      return {
        radius: isActive || isHovered ? HANDLE_ACTIVE_RADIUS : HANDLE_RADIUS,
        color: colorRgb(isActive ? active : isHovered ? hover : idle),
      };
    });
  };

  /** Draw the frame, control handles, and the current animated handles. */
  const paint = () => {
    const canvas = canvasRef.current;
    const surface = canvas ? prepareEasingCanvas(canvas, EASING_PLOT) : null;
    if (!canvas || !surface) {
      return;
    }
    const { context, palette, plot } = surface;
    const draft = draftPoints.current;
    if (
      !stylesReady.current ||
      !Array.isArray(handleStyles.current) ||
      handleStyles.current.length < 2 ||
      !handleStyles.current[0] ||
      !handleStyles.current[1]
    ) {
      handleStyles.current = handleTargets();
      stylesReady.current = true;
    }

    const axis = valueWindow(draft);
    const span = axis.maximum - axis.minimum;
    const yOf = (value: number) => plot.bottom - ((value - axis.minimum) / span) * PLOT_HEIGHT;
    const xOfProgress = (progress: number) => easingProgressX(progress, plot);

    drawEasingFrame(surface);
    // A control point may sit past ±1, which is what the limit lines are for; a
    // draft inside the range needs no line because the frame edges are the limit.
    drawEasingUnitLines(surface, yOf, [draft[1], draft[3]]);

    // The two control-handle tangents are context, so they take the guide weight
    // and stay dashed: a dashed guide is what separates an editable handle line
    // from the curve itself.
    context.save();
    context.strokeStyle = palette.guide;
    context.globalAlpha = EASING_GUIDE_ALPHA;
    context.lineWidth = 1;
    context.setLineDash([3, 3]);
    context.beginPath();
    context.moveTo(xOfProgress(0), yOf(0));
    context.lineTo(xOfProgress(draft[0]), yOf(draft[1]));
    context.moveTo(xOfProgress(1), yOf(1));
    context.lineTo(xOfProgress(draft[2]), yOf(draft[3]));
    context.stroke();
    context.restore();

    const points: number[] = [];
    for (let index = 0; index <= SEGMENTS; index += 1) {
      const progress = index / SEGMENTS;
      points.push(xOfProgress(progress), yOf(bezier(progress, draft)));
    }
    strokeEasingPolyline(surface, { points, style: "curve" }, 2);

    for (const [styleIndex, pointIndex] of HANDLE_POINTS.entries()) {
      const handle = handleStyles.current[styleIndex];
      context.fillStyle = colorFill(handle.color);
      context.beginPath();
      context.arc(
        xOfProgress(draft[pointIndex]),
        yOf(draft[pointIndex + 1]),
        handle.radius,
        0,
        Math.PI * 2,
      );
      context.fill();
    }
  };

  useEffect(() => {
    paintRef.current = paint;
  });
  useEffect(() => {
    paintRef.current();
  }, [drawVersion]);
  useEffect(() => {
    return () => {
      if (animationFrame.current !== null) {
        cancelAnimationFrame(animationFrame.current);
      }
    };
  }, []);

  /** Advance both handle looks toward the current interaction state. */
  const tick = (now: number) => {
    const state = animation.current;
    if (!state) {
      animationFrame.current = null;
      return;
    }
    const progress = Math.min(1, (now - state.start) / HANDLE_TRANSITION_MS);
    const eased = 1 - (1 - progress) ** 3;
    handleStyles.current = state.to.map((target, index) => {
      const from = state.from[index] ?? target;
      return {
        radius: from.radius + (target.radius - from.radius) * eased,
        color: mixRgb(from.color, target.color, eased),
      };
    });
    paintRef.current();
    if (progress < 1) {
      animationFrame.current = requestAnimationFrame(tick);
    } else {
      animationFrame.current = null;
      animation.current = null;
    }
  };

  /** Ease both handles from their current look to the state's target look. */
  const animateHandles = () => {
    if (!Array.isArray(handleStyles.current) || handleStyles.current.length < 2) {
      handleStyles.current = handleTargets();
    }
    const from = handleStyles.current.map((handle) => ({
      radius: handle.radius,
      color: handle.color,
    }));
    animation.current = { start: performance.now(), from, to: handleTargets() };
    if (animationFrame.current === null) {
      animationFrame.current = requestAnimationFrame(tick);
    }
  };

  /** Move the hover look and start its transition when the pointer crosses a handle. */
  const setHover = (index: number | null) => {
    if (hoverIndex.current === index) {
      return;
    }
    hoverIndex.current = index;
    animateHandles();
  };

  /** Replace the draft text and redraw once it describes a usable curve. */
  const updateText = (text: string) => {
    draftTextRef.current = text;
    setDraftText(text);
    const parsed = parseBezierPointText(text);
    if (!parsed.valid) {
      return;
    }
    draftPoints.current = parsed.points;
    setDrawVersion((version) => version + 1);
  };

  /** Write a valid draft to the chart; rejected text stays in the field. */
  const commitText = (text: string) => {
    const parsed = parseBezierPointText(text);
    if (!parsed.valid) {
      if (parsed.issue === "count") {
        // Fewer than four numbers is an unfinished draft, not a curve; leaving
        // the field restores the stored points instead of keeping a partial line.
        updateText(formatBezierPoints(normalizePoints(points)));
      }
      return;
    }
    const current = normalizePoints(points);
    const next = parsed.points;
    draftPoints.current = next;
    const formatted = formatBezierPoints(next);
    draftTextRef.current = formatted;
    setDraftText(formatted);
    setDrawVersion((version) => version + 1);
    if (next.some((value, index) => value !== current[index])) {
      commit(next);
    }
  };

  /** Map a pointer position onto the visible value window of the drawing. */
  const canvasPoint = (pointer: ReactPointerEvent<HTMLCanvasElement>, axis: ValueWindow) => {
    const rect = pointer.currentTarget.getBoundingClientRect();
    const logicalX = ((pointer.clientX - rect.left) / rect.width) * WIDTH;
    const logicalY = ((pointer.clientY - rect.top) / rect.height) * HEIGHT;
    return {
      x: clamp01((logicalX - EASING_PLOT.left) / PLOT_WIDTH),
      // The pointer may leave the plot while the drag keeps the capture, so the
      // value follows the full canvas height and can overshoot the unit square.
      y:
        axis.minimum +
        ((EASING_PLOT.bottom - logicalY) / PLOT_HEIGHT) * (axis.maximum - axis.minimum),
      logicalX,
      logicalY,
    };
  };

  /** The control point under the pointer, or null when none is within reach. */
  const handleAtPointer = (pointer: ReactPointerEvent<HTMLCanvasElement>) => {
    const axis = valueWindow(draftPoints.current);
    const point = canvasPoint(pointer, axis);
    const span = axis.maximum - axis.minimum;
    let nearest: { index: number; distance: number } | null = null;
    for (const index of HANDLE_POINTS) {
      const x = easingProgressX(draftPoints.current[index] ?? 0, EASING_PLOT);
      const y =
        EASING_PLOT.bottom -
        (((draftPoints.current[index + 1] ?? 0) - axis.minimum) / span) * PLOT_HEIGHT;
      const distance = Math.hypot(point.logicalX - x, point.logicalY - y);
      if (!nearest || distance < nearest.distance) {
        nearest = { index, distance };
      }
    }
    return nearest && nearest.distance <= HIT_RADIUS ? nearest.index : null;
  };

  /** Release the drag capture and publish the moved control point once. */
  const finishDrag = (pointer: ReactPointerEvent<HTMLCanvasElement>) => {
    if (dragIndex.current === null) {
      return;
    }
    if (pointer.currentTarget.hasPointerCapture(pointer.pointerId)) {
      pointer.currentTarget.releasePointerCapture(pointer.pointerId);
    }
    if (dragChanged.current) {
      const text = formatBezierPoints(draftPoints.current);
      draftTextRef.current = text;
      setDraftText(text);
      preview?.(null);
      commit([...draftPoints.current]);
    } else {
      preview?.(null);
    }
    dragIndex.current = null;
    dragWindow.current = null;
    dragChanged.current = false;
    hoverIndex.current = handleAtPointer(pointer);
    animateHandles();
  };

  return (
    <div className="bezier-editor-fields" role="group" aria-label={label}>
      <FieldRow
        layout="inline"
        density="compact"
        label={label}
        control={(id) => (
          <Input
            id={id}
            className="bezier-points-input"
            type="text"
            textAlign="center"
            value={draftText}
            aria-label={label}
            aria-invalid={invalid}
            onChange={(event) => updateText(event.currentTarget.value)}
            onBlur={(event) => commitText(event.currentTarget.value)}
            onKeyDown={(event: ReactKeyboardEvent<HTMLInputElement>) => {
              if (event.key === "Enter") {
                // Blur is the one commit path, so Enter and leaving the field
                // cannot write the same change twice.
                event.currentTarget.blur();
              } else if (event.key === "Escape") {
                updateText(formatBezierPoints(normalizePoints(points)));
              }
            }}
          />
        )}
      />
      <canvas
        ref={canvasRef}
        width={WIDTH}
        height={HEIGHT}
        className="easing-preview bezier-editor"
        role="region"
        aria-label={t("design.easing.editor")}
        onPointerDown={(pointer) => {
          pointer.preventDefault();
          const index = handleAtPointer(pointer);
          if (index === null) {
            return;
          }
          hoverIndex.current = index;
          dragIndex.current = index;
          dragWindow.current = valueWindow(draftPoints.current);
          dragChanged.current = false;
          animateHandles();
          pointer.currentTarget.setPointerCapture(pointer.pointerId);
        }}
        onPointerMove={(pointer) => {
          const index = dragIndex.current;
          if (index === null) {
            setHover(handleAtPointer(pointer));
            return;
          }
          const axis = dragWindow.current;
          if (!axis) {
            return;
          }
          pointer.preventDefault();
          const point = canvasPoint(pointer, axis);
          const draft = draftPoints.current;
          draft[index] = point.x;
          // A captured pointer can travel far outside the canvas; one window
          // span beyond either edge is enough overshoot for one gesture and
          // keeps a stray release from writing an absurd value.
          const span = axis.maximum - axis.minimum;
          draft[index + 1] = Math.min(axis.maximum + span, Math.max(axis.minimum - span, point.y));
          draftTextRef.current = formatBezierPoints(draft);
          setDraftText(draftTextRef.current);
          dragChanged.current = true;
          preview?.([...draft]);
          setDrawVersion((version) => version + 1);
        }}
        onPointerLeave={() => {
          if (dragIndex.current === null) {
            setHover(null);
          }
        }}
        onPointerUp={finishDrag}
        onPointerCancel={finishDrag}
      />
    </div>
  );
}
