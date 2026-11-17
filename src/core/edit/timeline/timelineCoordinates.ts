/**
 * Converts between chart coordinates and timeline pixels.
 *
 * Panel geometry decides which columns are visible, and every time or position
 * conversion goes through the same scale so drawing, hit testing and editing
 * agree on where a beat or a note sits. Snapping always runs on the chart side
 * of the conversion.
 */
import { beatValue } from "../../global/chart/timing/beat.ts";
import { snapPosition, snapTime, type TempoGrid } from "../../global/chart/editing/editGrid.ts";

export interface TimelineScale {
  origin: number;
  factor: number;
  scale: number;
  judgementOffset: number;
}

/** Authored horizontal interval represented by one note timeline viewport. */
export const NOTE_X_MIN = -675;
export const NOTE_X_MAX = 675;
export const NOTE_X_SPAN = NOTE_X_MAX - NOTE_X_MIN;

/** A reusable beat-to-pixel projection for one timeline frame and scale. */
export type VerticalBeatProjection = (beat: number) => number;

/** Reusable horizontal and clipping projection for one note panel. */
export interface NotePanelProjection {
  horizontal(position: number): number;
  clamp(horizontal: number, noteWidth: number): number | null;
}

/**
 * Create a vertical projection that reuses the origin time for every beat.
 *
 * Drawing a dense timeline asks for both anchors of every visible note. The
 * origin is invariant for the frame, so calculating it once avoids repeating
 * the same tempo lookup while preserving the exact `verticalAtBeat` formula.
 */
export function createVerticalBeatProjection(
  height: number,
  scale: TimelineScale,
  tempo: TempoGrid,
): VerticalBeatProjection {
  const originSeconds = tempo.seconds(scale.origin, scale.factor);
  return (beat) =>
    height -
    scale.judgementOffset -
    (tempo.seconds(beat, scale.factor) - originSeconds) * scale.scale;
}

/**
 * Create a note-panel projection that reuses all layout values invariant for a
 * frame. The returned clipping operation has the same panel-overlap contract as
 * `clampNoteHorizontal`.
 */
export function createNotePanelProjection(
  cameraX: number,
  inset: number,
  panelWidthValue: number,
  linePanel: number,
  canvasWidth: number,
  layout: TimelinePanelLayout,
  scroll: number,
): NotePanelProjection {
  return {
    horizontal: (position) =>
      noteHorizontal(
        position,
        cameraX,
        inset,
        panelWidthValue,
        linePanel,
        canvasWidth,
        layout,
        scroll,
      ),
    clamp: (horizontal, noteWidthValue) =>
      clampNoteHorizontal(horizontal, noteWidthValue, canvasWidth, linePanel, layout, scroll),
  };
}

/** Smallest multi-line window scale: a few pixels per window. */
export const MULTI_LINE_WINDOW_WIDTH_MIN = 0.01;
/** Largest multi-line window scale: one window covering most of the timeline. */
export const MULTI_LINE_WINDOW_WIDTH_MAX = 1;
/**
 * Default multi-line window scale.
 *
 * The scale is calibrated in windows instead of raw pixels, so this default
 * lands on a readable split: {@link MULTI_LINE_WINDOWS_AT_DEFAULT} windows
 * across the timeline, with the trailing one cut in half at the edge.
 */
export const MULTI_LINE_WINDOW_WIDTH_DEFAULT = 0.5;

/** Windows the timeline holds across its width at the default window scale. */
export const MULTI_LINE_WINDOWS_AT_DEFAULT = 3.5;

/** Clamp a multi-line window scale into the supported range, in hundredths. */
export function clampMultiLineWindowWidth(value: number): number {
  const candidate = Number.isFinite(value) ? value : MULTI_LINE_WINDOW_WIDTH_DEFAULT;
  const bounded = Math.max(
    MULTI_LINE_WINDOW_WIDTH_MIN,
    Math.min(MULTI_LINE_WINDOW_WIDTH_MAX, candidate),
  );
  return Math.round(bounded * 100) / 100;
}

/**
 * Panel width, as a fraction of the viewport, for one multi-line window scale.
 *
 * `scale` is relative to {@link MULTI_LINE_WINDOW_WIDTH_DEFAULT} windows, so
 * the viewport holds that many windows across: `0.5` shows three and a half,
 * `1` shows one and three quarters. A fractional count cuts the trailing
 * window at that fraction instead of rounding it away, which keeps every scale
 * aligned to the edge. Gaps are included in the span, so a scale that lands on
 * a whole number fits exactly that many windows.
 */
export function multiLineWidthRatio(scale: number, gapRatio = 0.04): number {
  const safeScale = clampMultiLineWindowWidth(scale);
  const gap = Math.max(0, Number.isFinite(gapRatio) ? gapRatio : 0);
  const windows = (MULTI_LINE_WINDOWS_AT_DEFAULT * MULTI_LINE_WINDOW_WIDTH_DEFAULT) / safeScale;
  const whole = Math.floor(windows);
  const fraction = windows - whole;
  const span =
    fraction > 0 ? whole * (1 + gap) + fraction : Math.max(1, whole + Math.max(0, whole - 1) * gap);
  return Math.min(1, 1 / span);
}

export interface TimelinePanelLayout {
  active: boolean;
  count: number;
  /** Width of one panel as a fraction of the viewport width; fitted across all panels when absent. */
  widthRatio?: number;
  /** Gap expressed as a ratio of one panel's width. */
  gapRatio?: number;
  /** Minimum gap for a fitted note-panel layout; width-scaled layouts keep the gap proportional. */
  gapMinimum?: number;
}

/** The authored note size represents a timeline occupying half the workspace. */
export const TIMELINE_NOTE_REFERENCE_RATIO = 0.5;

/** Scale an authored note size by the timeline width relative to its 50% reference. */
export function noteScaleForTimelineRatio(noteScale: number, timelineRatio: number): number {
  const safeScale = Number.isFinite(noteScale) ? Math.max(0, noteScale) : 0;
  const safeRatio = Number.isFinite(timelineRatio) ? Math.max(0, timelineRatio) : 0;
  return (safeScale * safeRatio) / TIMELINE_NOTE_REFERENCE_RATIO;
}

/** Width of one panel: the configured fraction of the viewport, or a fit across every panel. */
export function panelWidth(width: number, layout: TimelinePanelLayout): number {
  const safeWidth = Math.max(0, Number(width) || 0);
  const safeCount = Math.max(1, Math.floor(Number(layout.count) || 1));
  if (!layout.active || safeCount === 1) {
    return safeWidth;
  }
  const ratio = Number(layout.widthRatio);
  if (Number.isFinite(ratio) && ratio > 0) {
    return Math.max(0, Math.min(safeWidth, safeWidth * ratio));
  }
  return fittedPanelWidth(safeWidth, safeCount, layout.gapRatio, layout.gapMinimum);
}

/** Fits `count` panels and their gaps into the available width. */
function fittedPanelWidth(width: number, count: number, gapRatio = 0.04, gapMinimum = 12): number {
  const safeCount = Math.max(1, Math.floor(count));
  const safeGapRatio = Math.max(0, Number(gapRatio) || 0);
  const safeWidth = Math.max(0, width);
  const ratioWidth = safeWidth / (safeCount + safeGapRatio * (safeCount - 1));
  const minimum = Math.min(
    Math.max(0, Number(gapMinimum ?? 12) || 0),
    safeCount > 1 ? safeWidth / (safeCount - 1) : 0,
  );
  return safeGapRatio * ratioWidth >= minimum
    ? ratioWidth
    : Math.max(0, (safeWidth - minimum * (safeCount - 1)) / safeCount);
}

/** Gap between panels, never below the layout's minimum. */
export function panelGap(width: number, layout: TimelinePanelLayout): number {
  const safeCount = Math.max(1, Math.floor(Number(layout.count) || 1));
  if (!layout.active || safeCount <= 1) {
    return 0;
  }
  const minimum = Math.min(
    Math.max(0, Number(layout.gapMinimum ?? 12) || 0),
    safeCount > 1 ? Math.max(0, Number(width) || 0) / (safeCount - 1) : 0,
  );
  return Math.max(
    minimum,
    panelWidth(width, layout) * Math.max(0, Number(layout.gapRatio) || 0.04),
  );
}

/** Horizontal distance from one panel's start to the next. */
export function panelStride(width: number, layout: TimelinePanelLayout): number {
  return panelWidth(width, layout) + panelGap(width, layout);
}

/** Return the inclusive panel range that can intersect the horizontal viewport. */
export function visiblePanelRange(
  width: number,
  layout: TimelinePanelLayout,
  scroll: number,
): [number, number] {
  const count = Math.max(1, Math.floor(layout.count));
  if (!layout.active || count <= 1) {
    return [0, 0];
  }
  const panelWidthValue = panelWidth(width, layout);
  const stride = panelWidthValue + panelGap(width, layout);
  const offset = viewportOffset(width, { ...layout, count }, scroll);
  const viewportWidth = Math.max(0, width);
  if (viewportWidth <= 0 || stride <= 0) {
    return [0, -1];
  }
  const first = Math.max(0, Math.floor((offset - panelWidthValue) / stride) + 1);
  const last = Math.min(count - 1, Math.ceil((offset + viewportWidth) / stride) - 1);
  return first <= last ? [first, last] : [0, -1];
}

/** Clamps the horizontal viewport offset to the panel content bounds. */
export function viewportOffset(width: number, layout: TimelinePanelLayout, scroll: number): number {
  const panelWidthValue = panelWidth(width, layout);
  const gap = panelGap(width, layout);
  const maximum = Math.max(
    0,
    layout.count * panelWidthValue + Math.max(0, layout.count - 1) * gap - width,
  );
  return Math.max(0, Math.min(maximum, Number(scroll) || 0));
}

/** Apply a horizontal pointer delta and keep the viewport inside its content bounds. */
export function panViewportOffset(
  width: number,
  layout: TimelinePanelLayout,
  scroll: number,
  deltaX: number,
): number {
  return viewportOffset(width, layout, (Number(scroll) || 0) - (Number(deltaX) || 0));
}

/** Resolves the target line under a panel-relative horizontal position. */
export function lineIndexAt(
  horizontal: number,
  width: number,
  fallback: number,
  targetLines: readonly number[],
  layout: TimelinePanelLayout,
  scroll: number,
): number {
  if (!layout.active || layout.count === 1) {
    return fallback;
  }
  const offset = viewportOffset(width, layout, scroll);
  const stride = panelStride(width, layout);
  if (stride <= 0) {
    return fallback;
  }
  const slot = Math.max(0, Math.min(layout.count - 1, Math.floor((horizontal + offset) / stride)));
  return targetLines[slot] ?? fallback;
}

/** Converts one panel's local X coordinate into canvas X. */
export function panelHorizontal(
  horizontal: number,
  panel: number,
  width: number,
  layout: TimelinePanelLayout,
  scroll: number,
): number {
  return panel * panelStride(width, layout) - viewportOffset(width, layout, scroll) + horizontal;
}

/** Chart seconds at a canvas row. */
export function timeAt(
  vertical: number,
  viewHeight: number,
  scale: TimelineScale,
  tempo: TempoGrid,
): number {
  return (
    tempo.seconds(scale.origin, scale.factor) +
    (viewHeight - scale.judgementOffset - vertical) / scale.scale
  );
}

/** Continuous beat at a canvas row. */
export function beatAt(
  vertical: number,
  viewHeight: number,
  scale: TimelineScale,
  tempo: TempoGrid,
): number {
  return tempo.beat(timeAt(vertical, viewHeight, scale, tempo), scale.factor);
}

/** Beat at a canvas row after snapping to the division grid. */
export function snappedBeat(
  vertical: number,
  viewHeight: number,
  scale: TimelineScale,
  division: number,
  tempo: TempoGrid,
): number {
  return beatValue(
    snapTime(timeAt(vertical, viewHeight, scale, tempo), division, tempo, scale.factor),
  );
}

/** Canvas row at a beat for the given scale and tempo. */
export function verticalAtBeat(
  beat: number,
  height: number,
  scale: TimelineScale,
  tempo: TempoGrid,
): number {
  return (
    height -
    scale.judgementOffset -
    (tempo.seconds(beat, scale.factor) - tempo.seconds(scale.origin, scale.factor)) * scale.scale
  );
}

/** Canvas row at a beat using one line's BPM factor. */
export function verticalAtLineBeat(
  beat: number,
  height: number,
  scale: TimelineScale,
  lineFactor: number,
  tempo: TempoGrid,
): number {
  return verticalAtBeat(beat, height, { ...scale, factor: lineFactor }, tempo);
}

/** Restores the world-space start point of a marquee from its cached values. */
export function rectangleStartPoint(
  x: number,
  y: number,
  worldX: number | undefined,
  seconds: number | undefined,
  scroll: number,
  height: number,
  scale: TimelineScale,
  tempo: TempoGrid,
): { x: number; y: number } {
  return {
    x: worldX === undefined ? x : worldX - scroll,
    y:
      seconds === undefined
        ? y
        : height -
          scale.judgementOffset -
          (seconds - tempo.seconds(scale.origin, scale.factor)) * scale.scale,
  };
}

/** Inclusive beat range covered by a marquee, widened by a small epsilon. */
export function rectangleBeatRange(
  startSeconds: number | undefined,
  currentSeconds: number | undefined,
  startY: number,
  currentY: number,
  height: number,
  scale: TimelineScale,
  tempo: TempoGrid,
): [number, number] {
  const start = startSeconds ?? timeAt(startY, height, scale, tempo);
  const current =
    currentSeconds ??
    tempo.seconds(scale.origin, scale.factor) +
      (height - scale.judgementOffset - currentY) / scale.scale;
  return [
    tempo.beat(Math.min(start, current), scale.factor) - 1e-8,
    tempo.beat(Math.max(start, current), scale.factor) + 1e-8,
  ];
}

/**
 * Event columns use the full panel width, like note lanes.
 *
 * The chart's left and right boundaries are the panel edges; an extra inset
 * leaves visible gaps at both ends of an event-only canvas even though the
 * columns themselves are evenly spaced.
 */
export function eventInset(_panelWidth: number): number {
  return 0;
}

/** The horizontal geometry of one event-type column inside a window. */
export interface EventColumnBounds {
  readonly channelWidth: number;
  readonly left: number;
  readonly x: number;
  readonly width: number;
}

/** Geometry of one event-type column: channel span, bar origin, and bar width. */
export function eventColumnBounds(
  channel: number,
  width: number,
  eventTypeCount: number,
  configuredBarWidth: number,
  inset = 0,
): EventColumnBounds {
  const safeInset = Math.min(Math.max(0, inset), Math.max(0, width / 2 - 1));
  const contentWidth = Math.max(1, width - safeInset * 2);
  const channelWidth = contentWidth / Math.max(1, eventTypeCount);
  const barWidth = channelWidth * Math.max(0.35, Math.min(1, configuredBarWidth));
  const left = safeInset + channel * channelWidth;
  return {
    channelWidth,
    left,
    x: left + (channelWidth - barWidth) / 2,
    width: barWidth,
  };
}

/** Return the boundary between two event columns inside a window inset. */
export function eventColumnBoundary(
  channel: number,
  width: number,
  eventTypeCount: number,
  inset = 0,
): number {
  const safeInset = Math.min(Math.max(0, inset), Math.max(0, width / 2 - 1));
  return safeInset + ((width - safeInset * 2) / Math.max(1, eventTypeCount)) * channel;
}

/**
 * Note lanes use the full panel width.
 *
 * The chart's left and right boundaries are the panel edges, and the internal
 * snap lanes divide that full width evenly. Keeping a horizontal inset here
 * would leave wider margins at the two ends than between the lanes, which reads
 * as a broken grid even though the lanes themselves are uniformly spaced.
 */
export function noteInset(_renderNoteScale: number, _panelWidthValue: number): number {
  return 0;
}

/** Rendered note width for a note size, clamped to a drawable range. */
export function noteWidth(renderNoteScale: number, size: number | undefined): number {
  return 68 * renderNoteScale * Math.min(3, Math.max(0.2, size ?? 1));
}

/** Snaps a chart X position to the lanes when snapping is enabled. */
export function snapXPosition(value: number, gridCount: number, enabled: boolean): number {
  return enabled ? snapPosition(value, gridCount) : value;
}

/** Canvas X for a note's chart X position inside its panel. */
export function noteHorizontal(
  position: number,
  cameraX: number,
  inset: number,
  panelWidthValue: number,
  linePanel: number,
  canvasWidth: number,
  layout: TimelinePanelLayout,
  scroll: number,
): number {
  const contentWidth = Math.max(1, panelWidthValue - inset * 2);
  const local = inset + ((position - cameraX - NOTE_X_MIN) / NOTE_X_SPAN) * contentWidth;
  return panelHorizontal(local, linePanel, canvasWidth, layout, scroll);
}

/** Chart X for a canvas X, optionally snapped to the lanes. */
export function notePositionAt(
  horizontal: number,
  cameraX: number,
  inset: number,
  panelWidthValue: number,
  linePanel: number,
  canvasWidth: number,
  layout: TimelinePanelLayout,
  scroll: number,
  gridCount: number,
  snapX: boolean,
): number {
  const contentWidth = Math.max(1, panelWidthValue - inset * 2);
  const local =
    horizontal +
    viewportOffset(canvasWidth, layout, scroll) -
    linePanel * panelStride(canvasWidth, layout);
  const value = ((local - inset) / contentWidth) * NOTE_X_SPAN + NOTE_X_MIN + cameraX;
  return snapXPosition(value, gridCount, snapX);
}

/** Returns the canvas X when the note overlaps its panel, else null. */
export function clampNoteHorizontal(
  horizontal: number,
  noteWidthValue: number,
  canvasWidth: number,
  linePanel: number,
  layout: TimelinePanelLayout,
  scroll: number,
): number | null {
  const panelWidthValue = panelWidth(canvasWidth, layout);
  const offset = viewportOffset(canvasWidth, layout, scroll);
  const left = linePanel * panelStride(canvasWidth, layout) - offset;
  const right = left + panelWidthValue;
  return horizontal + noteWidthValue / 2 < left || horizontal - noteWidthValue / 2 > right
    ? null
    : horizontal;
}
