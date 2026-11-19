/**
 * Geometry for the batch control dock: where the three control balls sit on the
 * stage, and how they follow the timeline content.
 *
 * The dock is anchored to chart time and to the selection's panel bounds, so a
 * scroll, a multi-line pan, or a vertical zoom moves it together with the objects
 * it edits instead of leaving it at a stale screen position. This module owns
 * only the arithmetic; the controller owns the elements and the drag.
 */
import type { TimelineArea } from "../../../../../../core/edit/timeline/types.ts";

/** A canvas-space point. */
export interface DockPoint {
  readonly x: number;
  readonly y: number;
}

/** Horizontal panel bounds. */
export interface DockBounds {
  readonly left: number;
  readonly right: number;
  readonly width: number;
}

/** The viewport values that move timeline content under the dock. */
export interface DockViewport {
  readonly origin: number;
  readonly judgementOffset: number;
  readonly tempo: { seconds(beat: number, factor: number): number };
  scaleForArea(area: TimelineArea): number;
}

/** Viewport state the current dock was computed for. */
export interface DockScroll {
  readonly origin: number;
  readonly scale: number;
  readonly pan: number;
}

/** Where the dock sits: a chart-time anchor plus its distance from the panel edge. */
export interface DockAnchor {
  /** Absolute time under the dock, in seconds on `factor`. */
  readonly seconds: number;
  /** Per-line time factor used by `seconds`. */
  readonly factor: number;
  /** Horizontal distance from the selection's left panel edge. */
  readonly offsetX: number;
}

/** Docked state of one timeline area's control group. */
export interface DockGroup {
  /** Selection signature plus canvas size the dock was last placed for. */
  signature: string;
  /** Published stage-relative position. */
  left?: string;
  top?: string;
  /** Line indices of the docked selection; the panel bounds derive from them. */
  lines?: number[];
  /** Content-relative position, so scroll, pan, and zoom keep the dock attached. */
  anchor?: DockAnchor;
  /** Viewport scroll state the current dock was computed for. */
  scroll?: DockScroll;
}

/** One dock computation: the viewport plus the canvas it is measured against. */
export interface DockInput {
  readonly viewport: DockViewport;
  readonly area: TimelineArea;
  readonly width: number;
  readonly height: number;
}

/** The placement inputs of a fresh dock, before it has an anchor. */
export interface DockPlacement {
  readonly bounds: DockBounds;
  readonly point: DockPoint | null;
  readonly factor: number;
}

/** How far inside the panel edge the dock may sit, in CSS pixels. */
const DOCK_EDGE_INSET = 20;
/** Horizontal clearance that keeps the balls off the selection's right edge. */
const DOCK_RIGHT_CLEARANCE = 26;
/** Distance from the pointer that keeps the balls off the pointer itself. */
const DOCK_POINTER_OFFSET = 50;
/** Minimum dock row; the header band must stay uncovered. */
const DOCK_TOP_MIN = 25;
/** Height of the three stacked balls plus their gaps, kept inside the canvas. */
const DOCK_STACK_HEIGHT = 97;
/** Upward bias from the pointer row, so the stack grows down past it. */
const DOCK_POINTER_LIFT = 30;
/** Judgement offset used when the viewport has not published one. */
const DEFAULT_JUDGEMENT_OFFSET = 42;

/** Clamp `value` into `[min, max]`, tolerating an inverted range. */
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** Viewport scroll state that decides whether a docked ball has to move. */
export function dockScroll(viewport: DockViewport, area: TimelineArea, pan: number): DockScroll {
  return { origin: viewport.origin, scale: viewport.scaleForArea(area), pan };
}

/** True when the timeline content moved under a docked ball. */
export function dockScrollChanged(previous: DockScroll | undefined, next: DockScroll): boolean {
  return (
    previous === undefined ||
    previous.origin !== next.origin ||
    previous.scale !== next.scale ||
    previous.pan !== next.pan
  );
}

/** Panel bounds covering `lines`; an empty list falls back to `fallbackLine`. */
export function dockBoundsForLines(
  lines: readonly number[],
  fallbackLine: number,
  boundsOf: (lineIndex: number) => DockBounds,
): DockBounds {
  if (!lines.length) {
    return boundsOf(fallbackLine);
  }
  let left = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  for (const lineIndex of lines) {
    const bounds = boundsOf(lineIndex);
    left = Math.min(left, bounds.left);
    right = Math.max(right, bounds.right);
  }
  return { left, right, width: right - left };
}

/** Absolute time at one canvas row, using the timeline's own projection. */
export function dockSecondsAtRow(input: DockInput, row: number, factor: number): number {
  const { viewport } = input;
  const scale = viewport.scaleForArea(input.area);
  if (!(scale > 0) || !Number.isFinite(scale)) {
    return viewport.tempo.seconds(viewport.origin, factor);
  }
  const offset = viewport.judgementOffset ?? DEFAULT_JUDGEMENT_OFFSET;
  return viewport.tempo.seconds(viewport.origin, factor) + (input.height - offset - row) / scale;
}

/** Canvas row for one absolute time; the inverse of `dockSecondsAtRow`. */
export function dockRowAtSeconds(input: DockInput, seconds: number, factor: number): number {
  const { viewport } = input;
  const scale = viewport.scaleForArea(input.area);
  const offset = viewport.judgementOffset ?? DEFAULT_JUDGEMENT_OFFSET;
  return (
    input.height - offset - (seconds - viewport.tempo.seconds(viewport.origin, factor)) * scale
  );
}

/**
 * Place a fresh dock near the pointer, inside the selection's panel bounds.
 *
 * The result is returned as an anchor, so the next frame can restore the same
 * content-relative position after the viewport moves.
 */
export function dockPlacement(
  input: DockInput,
  placement: DockPlacement,
): { anchor: DockAnchor; x: number; y: number } {
  const { bounds, point, factor } = placement;
  const requested = Math.max(
    bounds.left + DOCK_EDGE_INSET,
    Math.min(
      bounds.right - DOCK_RIGHT_CLEARANCE,
      (point?.x ?? bounds.left + bounds.width / 2) + DOCK_POINTER_OFFSET,
    ),
  );
  const x = clamp(requested, 8, input.width - DOCK_RIGHT_CLEARANCE);
  const y = clamp(
    (point?.y ?? input.height / 2) - DOCK_POINTER_LIFT,
    DOCK_TOP_MIN,
    input.height - DOCK_STACK_HEIGHT,
  );
  return {
    anchor: { seconds: dockSecondsAtRow(input, y, factor), factor, offsetX: x - bounds.left },
    x,
    y,
  };
}

/** Recompute the dock from its anchor after the viewport moved. */
export function dockPosition(
  input: DockInput,
  anchor: DockAnchor,
  bounds: DockBounds,
): { x: number; y: number } {
  return {
    x: clamp(bounds.left + anchor.offsetX, 8, input.width - DOCK_RIGHT_CLEARANCE),
    y: clamp(
      dockRowAtSeconds(input, anchor.seconds, anchor.factor),
      DOCK_TOP_MIN,
      input.height - DOCK_STACK_HEIGHT,
    ),
  };
}
