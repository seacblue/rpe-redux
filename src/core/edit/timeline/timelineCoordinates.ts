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

export interface TimelinePanelLayout {
  active: boolean;
  count: number;
  configuredWidth: number;
  /** Number of panels that should fit in the visible horizontal viewport. */
  visibleCount?: number;
  /** Gap expressed as a ratio of one panel's width. */
  gapRatio?: number;
  /** Minimum gap for note-panel presentation; event windows use zero. */
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

/** Width of one panel, configured or fitted to the visible viewport. */
export function panelWidth(width: number, layout: TimelinePanelLayout): number {
  const safeWidth = Math.max(0, Number(width) || 0);
  const safeCount = Math.max(1, Math.floor(Number(layout.count) || 1));
  if (!layout.active || safeCount === 1) {
    return safeWidth;
  }
  const configuredWidth = Number(layout.configuredWidth) || 0;
  if (configuredWidth > 0) {
    return Math.max(0, configuredWidth);
  }
  return fittedPanelWidth(
    safeWidth,
    Math.max(1, Math.floor(Number(layout.visibleCount) || safeCount)),
    layout.gapRatio,
    layout.gapMinimum,
  );
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
  const visibleCount = Math.max(1, Math.floor(Number(layout.visibleCount) || safeCount));
  if (!layout.active || safeCount <= 1 || visibleCount <= 1) {
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
  const local = inset + ((position - cameraX + 675) / 1350) * contentWidth;
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
  const value = ((local - inset) / contentWidth) * 1350 - 675 + cameraX;
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
