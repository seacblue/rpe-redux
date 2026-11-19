/**
 * Bézier control-point editor: four labelled numbers and a draggable curve.
 *
 * The chart stores `x1, y1, x2, y2` as one array, but the editor presents each
 * coordinate as its own field so every value follows the normal label/control
 * alignment. The canvas remains a direct-manipulation preview of those fields.
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
import { t, type MessageKey } from "../../../i18n/index.ts";
import { numericWheel } from "../../controls/numericWheel.ts";
import { EASING_CANVAS_HEIGHT, EASING_CANVAS_WIDTH, resizeEasingCanvas } from "./easingCanvas.ts";

interface BezierEditorProps {
  points: readonly number[];
  commit: (points: number[]) => void;
  /** Publish a transient curve while dragging; null clears the preview. */
  preview?: (points: readonly number[] | null) => void;
  /** Accessible label for the group of coordinate fields. */
  label: string;
}

const WIDTH = EASING_CANVAS_WIDTH;
const HEIGHT = EASING_CANVAS_HEIGHT;
const LEFT = 10;
const TOP = 20;
const BOTTOM = 80;
const PLOT_WIDTH = WIDTH - LEFT * 2;
const PLOT_HEIGHT = BOTTOM - TOP;
const DEFAULT_POINTS = [0, 0, 1, 1];
const POINT_KEYS: readonly MessageKey[] = [
  "design.easing.control.x1",
  "design.easing.control.y1",
  "design.easing.control.x2",
  "design.easing.control.y2",
];

/** Keep malformed chart data out of the editor while preserving the format shape. */
function normalizePoints(points: readonly number[]): number[] {
  return DEFAULT_POINTS.map((fallback, index) => {
    const value = points[index];
    return typeof value === "number" && Number.isFinite(value) ? clamp01(value) : fallback;
  });
}

/** Format one coordinate without adding a second representation to the chart model. */
function formatPoint(value: number): string {
  return String(Number(value.toFixed(3)));
}

/** Parse one coordinate, returning null for drafts outside the chart's range. */
function parsePoint(text: string): number | null {
  const value = Number(text.trim());
  return Number.isFinite(value) && value >= 0 && value <= 1 ? value : null;
}

/** Format all four coordinates for the editable drafts. */
function formatPoints(points: readonly number[]): string[] {
  return normalizePoints(points).map(formatPoint);
}

/**
 * One labelled coordinate box.
 *
 * Its wheel belongs to the draft: a notch steps the coordinate and hands the
 * result to the owner so the chart, timeline, and preview receive it at once.
 */
function PointInput({
  id,
  index,
  label,
  value,
  invalid,
  onText,
  onWheel,
  onBlur,
  onKeyDown,
}: {
  id?: string;
  index: number;
  label: string;
  value: string;
  invalid: boolean;
  onText(index: number, text: string): void;
  onWheel(index: number, input: HTMLInputElement): void;
  onBlur(): void;
  onKeyDown(event: ReactKeyboardEvent<HTMLInputElement>): void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const wheelHandler = useRef(onWheel);
  useEffect(() => {
    wheelHandler.current = onWheel;
  });
  useEffect(() => {
    const input = inputRef.current;
    if (!input) {
      return;
    }
    return numericWheel(input, 0.001, undefined, () => wheelHandler.current(index, input));
  }, [index]);
  return (
    <Input
      id={id}
      ref={inputRef}
      className="bezier-point-input"
      type="number"
      textAlign="center"
      min={0}
      max={1}
      step={0.001}
      data-redux-wheel="custom"
      value={value}
      aria-label={label}
      aria-invalid={invalid}
      onChange={(event) => onText(index, event.currentTarget.value)}
      onBlur={onBlur}
      onKeyDown={onKeyDown}
    />
  );
}

/** A labelled Bézier field with four validated coordinates and a responsive curve. */
export function BezierEditor({ points, commit, preview, label }: BezierEditorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const draftPoints = useRef(normalizePoints(points));
  const dragIndex = useRef<number | null>(null);
  const dragChanged = useRef(false);
  const draftTextRef = useRef(formatPoints(points));
  const [draftText, setDraftText] = useState(() => formatPoints(points));
  const [drawVersion, setDrawVersion] = useState(0);

  useEffect(() => {
    if (dragIndex.current !== null) {
      return;
    }
    const next = normalizePoints(points);
    const text = formatPoints(next);
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

  useEffect(() => {
    const canvas = canvasRef.current;
    const draw = canvas?.getContext("2d");
    if (!canvas || !draw) {
      return;
    }
    const style = getComputedStyle(canvas);
    const token = (name: string) => style.getPropertyValue(name).trim();
    const rect = canvas.getBoundingClientRect();
    const cssWidth = Math.max(1, rect.width || WIDTH);
    const cssHeight = Math.max(1, rect.height || HEIGHT);
    const { pixelWidth, pixelHeight, scaleX, scaleY } = resizeEasingCanvas(
      canvas,
      cssWidth,
      cssHeight,
    );
    const draft = draftPoints.current;
    draw.setTransform(1, 0, 0, 1, 0, 0);
    draw.clearRect(0, 0, pixelWidth, pixelHeight);
    draw.setTransform(scaleX, 0, 0, scaleY, 0, 0);
    draw.strokeStyle = token("--foreground-muted");
    draw.lineWidth = 1;
    draw.setLineDash([2, 3]);
    draw.strokeRect(LEFT, TOP, PLOT_WIDTH, PLOT_HEIGHT);
    draw.setLineDash([3, 3]);
    draw.beginPath();
    draw.moveTo(LEFT, BOTTOM);
    draw.lineTo(LEFT + draft[0] * PLOT_WIDTH, BOTTOM - draft[1] * PLOT_HEIGHT);
    draw.moveTo(LEFT + PLOT_WIDTH, TOP);
    draw.lineTo(LEFT + draft[2] * PLOT_WIDTH, BOTTOM - draft[3] * PLOT_HEIGHT);
    draw.stroke();
    draw.setLineDash([]);
    draw.strokeStyle = token("--warning");
    draw.lineWidth = 2;
    draw.beginPath();
    for (let index = 0; index <= 100; index += 1) {
      const progress = index / 100;
      const value = bezier(progress, draft);
      const x = LEFT + progress * PLOT_WIDTH;
      const y = BOTTOM - value * PLOT_HEIGHT;
      if (index === 0) {
        draw.moveTo(x, y);
      } else {
        draw.lineTo(x, y);
      }
    }
    draw.stroke();
    draw.fillStyle = token("--foreground");
    for (const point of [
      [draft[0], draft[1]],
      [draft[2], draft[3]],
    ]) {
      draw.beginPath();
      draw.arc(LEFT + point[0] * PLOT_WIDTH, BOTTOM - point[1] * PLOT_HEIGHT, 5, 0, Math.PI * 2);
      draw.fill();
    }
  }, [drawVersion]);

  /** Update one text draft and redraw when all coordinates are valid. */
  const updatePointText = (index: number, text: string) => {
    const next = [...draftTextRef.current];
    next[index] = text;
    draftTextRef.current = next;
    setDraftText(next);
    const parsed = next.map(parsePoint);
    if (parsed.every((value): value is number => value !== null)) {
      draftPoints.current = parsed;
      setDrawVersion((version) => version + 1);
    }
  };

  /** Commit one coordinate while keeping the chart's four-value shape intact. */
  const commitPoint = (index: number) => {
    const value = parsePoint(draftTextRef.current[index] ?? "");
    if (value === null) {
      return;
    }
    const parsed = draftTextRef.current.map(parsePoint);
    if (!parsed.every((point): point is number => point !== null)) {
      const text = [...draftTextRef.current];
      text[index] = formatPoint(value);
      draftTextRef.current = text;
      setDraftText(text);
      return;
    }
    const next = parsed;
    next[index] = value;
    draftPoints.current = next;
    const text = formatPoints(next);
    draftTextRef.current = text;
    setDraftText(text);
    const current = normalizePoints(points);
    if (next.some((point, pointIndex) => point !== current[pointIndex])) {
      commit(next);
    }
  };

  /** Map a pointer position onto the 0..1 curve space of the drawing. */
  const canvasPoint = (pointer: ReactPointerEvent<HTMLCanvasElement>) => {
    const rect = pointer.currentTarget.getBoundingClientRect();
    const logicalX = ((pointer.clientX - rect.left) / rect.width) * WIDTH;
    const logicalY = ((pointer.clientY - rect.top) / rect.height) * HEIGHT;
    return {
      x: clamp01((logicalX - LEFT) / PLOT_WIDTH),
      y: clamp01((BOTTOM - logicalY) / PLOT_HEIGHT),
    };
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
      const text = formatPoints(draftPoints.current);
      draftTextRef.current = text;
      setDraftText(text);
      preview?.(null);
      commit([...draftPoints.current]);
    } else {
      preview?.(null);
    }
    dragIndex.current = null;
    dragChanged.current = false;
  };

  const normalizedPoints = normalizePoints(points);
  return (
    <div className="bezier-editor-fields" role="group" aria-label={label}>
      <div className="bezier-point-fields">
        {POINT_KEYS.map((key, index) => (
          <FieldRow
            key={key}
            layout="inline"
            density="compact"
            label={t(key)}
            control={(id) => (
              <PointInput
                id={id}
                index={index}
                label={t(key)}
                value={draftText[index] ?? formatPoint(normalizedPoints[index] ?? 0)}
                invalid={parsePoint(draftText[index] ?? "") === null}
                onText={updatePointText}
                onWheel={(coordinate, input) => {
                  updatePointText(coordinate, input.value);
                  commitPoint(coordinate);
                }}
                onBlur={() => commitPoint(index)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    commitPoint(index);
                    event.currentTarget.blur();
                  } else if (event.key === "Escape") {
                    updatePointText(index, formatPoint(points[index] ?? 0));
                  }
                }}
              />
            )}
          />
        ))}
      </div>
      <canvas
        ref={canvasRef}
        width={WIDTH}
        height={HEIGHT}
        className="easing-preview bezier-editor"
        role="region"
        aria-label={t("design.easing.editor")}
        onPointerDown={(pointer) => {
          pointer.preventDefault();
          const point = canvasPoint(pointer);
          const draft = draftPoints.current;
          const candidates = [0, 2].map((index) => ({
            index,
            distance: Math.hypot(point.x - draft[index], point.y - draft[index + 1]),
          }));
          const nearest = candidates.reduce((best, candidate) =>
            candidate.distance < best.distance ? candidate : best,
          );
          if (nearest.distance > 0.14) {
            return;
          }
          dragIndex.current = nearest.index;
          dragChanged.current = false;
          pointer.currentTarget.setPointerCapture(pointer.pointerId);
        }}
        onPointerMove={(pointer) => {
          const index = dragIndex.current;
          if (index === null) {
            return;
          }
          pointer.preventDefault();
          const point = canvasPoint(pointer);
          draftPoints.current[index] = point.x;
          draftPoints.current[index + 1] = point.y;
          draftTextRef.current = formatPoints(draftPoints.current);
          setDraftText(draftTextRef.current);
          dragChanged.current = true;
          preview?.([...draftPoints.current]);
          setDrawVersion((version) => version + 1);
        }}
        onPointerUp={finishDrag}
        onPointerCancel={finishDrag}
      />
    </div>
  );
}
