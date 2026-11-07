/**
 * Projects pointer positions, beats, and panels into the note and event viewport,
 * including line factors and note placement, for the drawing and gesture modules.
 *
 * The arithmetic itself stays in core timeline coordinates; these functions extend a
 * viewport receiver.
 */
import * as coreGeometry from "../../../../../../core/edit/timeline/timelineCoordinates.ts";
import {
  type TimelineArea,
  type TimelineNote,
  type TimelinePoint,
} from "../../../../../../core/edit/timeline/types.ts";
import type { TimelineViewportReceiver } from "./timelineViewportReceiver.ts";

/** Canvas-local pointer position. */
export function point(
  this: TimelineViewportReceiver,
  event: PointerEvent,
  canvas: HTMLCanvasElement = this.notesCanvas,
): TimelinePoint {
  const rectangle = canvas.getBoundingClientRect();
  return { x: event.clientX - rectangle.left, y: event.clientY - rectangle.top };
}

/** Bar and column bounds for one event channel. */
export function eventColumnBounds(
  this: TimelineViewportReceiver,
  channel: number,
  width: number,
): coreGeometry.EventColumnBounds {
  return coreGeometry.eventColumnBounds(
    channel,
    width,
    this.eventTypes.length,
    this.eventBarWidth ?? 0.82,
    this.eventInset(width),
  );
}

/** The beat multiplier declared by one line. */
export function factorForLine(this: TimelineViewportReceiver, lineIndex: number): number {
  return this.getSession().chart.judgeLineList?.[lineIndex]?.bpmfactor ?? 1;
}

/**
 * The factor that places a note on the visible time axis.
 *
 * Each solo/non-merged panel owns its line factor. Merged note mode draws every
 * selected line into one panel, so all of them have to share the active line's
 * factor; otherwise notes drift away from the one grid as the view scrolls.
 */
export function noteFactorForLine(this: TimelineViewportReceiver, lineIndex: number): number {
  const session = this.getSession();
  return session.notesMode === "multi_merged" ? this.factor : this.factorForLine(lineIndex);
}

/** Shared vertical projection for one factor, height, and area. */
function verticalAt(
  receiver: TimelineViewportReceiver,
  beat: number,
  factor: number,
  height: number,
  area: TimelineArea,
): number {
  return coreGeometry.verticalAtLineBeat(
    beat,
    height,
    { ...receiver.scaleConfig(), scale: receiver.scaleForArea(area) },
    factor,
    receiver.tempo,
  );
}

/** Shared visible beat range with a small margin. */
function beatRangeAt(
  receiver: TimelineViewportReceiver,
  factor: number,
  height: number,
  area: TimelineArea,
): [number, number] {
  const scale = { ...receiver.scaleConfig(factor), scale: receiver.scaleForArea(area) };
  const bottom = coreGeometry.beatAt(height, receiver.viewHeight(), scale, receiver.tempo);
  const top = coreGeometry.beatAt(0, receiver.viewHeight(), scale, receiver.tempo);
  return [Math.min(bottom, top) - 0.2, Math.max(bottom, top) + 0.2];
}

/** Project a beat onto a line's note panel. */
export function noteVerticalForLine(
  this: TimelineViewportReceiver,
  beat: number,
  lineIndex: number,
  height: number = this.viewHeight(),
  area: TimelineArea = "notes",
): number {
  return verticalAt(this, beat, this.noteFactorForLine(lineIndex), height, area);
}

/** Visible beat range for a line's note panel. */
export function noteBeatRangeForLine(
  this: TimelineViewportReceiver,
  lineIndex: number,
  height: number = this.viewHeight(),
  area: TimelineArea = "notes",
): [number, number] {
  return beatRangeAt(this, this.noteFactorForLine(lineIndex), height, area);
}

/** Project a beat onto a line's panel in the active area. */
export function verticalForLine(
  this: TimelineViewportReceiver,
  beat: number,
  lineIndex: number,
  height: number = this.viewHeight(),
  area: TimelineArea = this.getSession().multiLineMode,
): number {
  return verticalAt(this, beat, this.factorForLine(lineIndex), height, area);
}

/** Visible beat range for a line's panel in the active area. */
export function beatRangeForLine(
  this: TimelineViewportReceiver,
  lineIndex: number,
  height: number = this.viewHeight(),
  area: TimelineArea = this.getSession().multiLineMode,
): [number, number] {
  return beatRangeAt(this, this.factorForLine(lineIndex), height, area);
}

/** Number of panels the area shows, at least one. */
export function panelCount(this: TimelineViewportReceiver, area: TimelineArea = "notes"): number {
  const session = this.getSession();
  if (session.notesMode === "single" && session.eventsMode === "single") {
    return 1;
  }
  if (area === "notes" && session.notesMode === "multi_merged") {
    return 1;
  }
  return Math.max(1, session.multiLineIndices.length);
}

/** Panel position of a line, or 0 in single-panel mode. */
export function panelIndex(
  this: TimelineViewportReceiver,
  lineIndex: number,
  area: TimelineArea = "notes",
): number {
  const session = this.getSession();
  const index = session.targetLineIndices.indexOf(lineIndex);
  return this.panelCount(area) === 1 ? 0 : Math.max(0, index);
}

/** Width of one panel; every layout consumer derives from the same layout. */
export function panelWidth(
  this: TimelineViewportReceiver,
  width: number,
  area: TimelineArea = "notes",
): number {
  // Width must come from the same layout as the gap, stride, visible range,
  // offset and pan. A private fitting literal here is what let a 100-line
  // selection produce 0.12 px windows while the event gap stayed 1/12 of a
  // different (fitted) window.
  return coreGeometry.panelWidth(width, this.panelLayout(area));
}

/** Gap between adjacent panels. */
export function panelGap(
  this: TimelineViewportReceiver,
  width: number,
  area: TimelineArea = "notes",
): number {
  return coreGeometry.panelGap(width, this.panelLayout(area));
}

/** Horizontal distance between panel origins. */
export function panelStride(
  this: TimelineViewportReceiver,
  width: number,
  area: TimelineArea = "notes",
): number {
  return coreGeometry.panelStride(width, this.panelLayout(area));
}

/** Inclusive first and last panel currently inside the canvas. */
export function visiblePanelRange(
  this: TimelineViewportReceiver,
  width: number,
  area: TimelineArea = "notes",
): [number, number] {
  return coreGeometry.visiblePanelRange(
    width,
    this.panelLayout(area),
    this.multiLineViewportOffset(width, area),
  );
}

/** Clamped horizontal scroll offset for one area. */
export function multiLineViewportOffset(
  this: TimelineViewportReceiver,
  width: number,
  area: TimelineArea = "notes",
): number {
  const current =
    typeof this.multiLineScroll === "number" ? this.multiLineScroll : this.multiLineScroll?.[area];
  const value = coreGeometry.viewportOffset(width, this.panelLayout(area), Number(current) || 0);
  if (typeof this.multiLineScroll === "number") {
    this.multiLineScroll = { notes: value, events: value };
  } else {
    this.multiLineScroll[area] = value;
  }
  return value;
}

/** Move one multi-line area horizontally by a pointer delta and clamp its offset. */
export function panMultiLine(
  this: TimelineViewportReceiver,
  width: number,
  deltaX: number,
  area: TimelineArea = "notes",
): number {
  if (typeof this.multiLineScroll === "number") {
    this.multiLineScroll = { notes: this.multiLineScroll, events: this.multiLineScroll };
  }
  const current = this.multiLineViewportOffset(width, area);
  const next = coreGeometry.panViewportOffset(width, this.panelLayout(area), current, deltaX);
  this.multiLineScroll[area] = next;
  return next;
}

/** Panel index under a canvas x coordinate. */
export function lineIndexAt(
  this: TimelineViewportReceiver,
  horizontal: number,
  width: number,
  area: TimelineArea = "notes",
): number {
  const session = this.getSession();
  return coreGeometry.lineIndexAt(
    horizontal,
    width,
    session.lineIndex,
    session.targetLineIndices,
    this.panelLayout(area),
    this.multiLineViewportOffset(width, area),
  );
}

/** Convert a panel-local x coordinate to canvas x. */
export function panelHorizontal(
  this: TimelineViewportReceiver,
  horizontal: number,
  lineIndex: number,
  width: number,
  area: TimelineArea = "notes",
): number {
  return coreGeometry.panelHorizontal(
    horizontal,
    this.panelIndex(lineIndex, area),
    width,
    this.panelLayout(area),
    this.multiLineViewportOffset(width, area),
  );
}

/** Chart time at a canvas y coordinate. */
export function timeAt(this: TimelineViewportReceiver, vertical: number): number {
  return coreGeometry.timeAt(
    vertical,
    this.viewHeight(),
    { ...this.scaleConfig(), scale: this.scaleForArea(this.getSession().multiLineMode) },
    this.tempo,
  );
}

/** Beat at a canvas y coordinate. */
export function beatAt(this: TimelineViewportReceiver, vertical: number): number {
  return coreGeometry.beatAt(
    vertical,
    this.viewHeight(),
    { ...this.scaleConfig(), scale: this.scaleForArea(this.getSession().multiLineMode) },
    this.tempo,
  );
}

/** Beat at a canvas y coordinate, snapped to the current division. */
export function snappedBeat(this: TimelineViewportReceiver, vertical: number): number {
  return coreGeometry.snappedBeat(
    vertical,
    this.viewHeight(),
    { ...this.scaleConfig(), scale: this.scaleForArea(this.getSession().multiLineMode) },
    this.division,
    this.tempo,
  );
}

/** Canvas y coordinate for a beat in the active area. */
export function vertical(
  this: TimelineViewportReceiver,
  beat: number,
  height: number = this.viewHeight(),
): number {
  return coreGeometry.verticalAtBeat(
    beat,
    height,
    { ...this.scaleConfig(), scale: this.scaleForArea(this.getSession().multiLineMode) },
    this.tempo,
  );
}

/** Canvas y coordinate for an event beat. */
export function eventVertical(this: TimelineViewportReceiver, beat: number, type: string): number {
  return coreGeometry.verticalAtBeat(
    beat,
    this.viewHeight(),
    { ...this.scaleConfig(), scale: this.scaleForArea("events") },
    this.tempo,
  );
}

/** Event beat at a canvas y coordinate, optionally snapped. */
export function eventBeatAt(
  this: TimelineViewportReceiver,
  vertical: number,
  type: string,
  snap: boolean = false,
): number {
  const factor = this.factor;
  return snap
    ? coreGeometry.snappedBeat(
        vertical,
        this.viewHeight(),
        { ...this.scaleConfig(factor), scale: this.scaleForArea("events") },
        this.division,
        this.tempo,
      )
    : coreGeometry.beatAt(
        vertical,
        this.viewHeight(),
        { ...this.scaleConfig(factor), scale: this.scaleForArea("events") },
        this.tempo,
      );
}

/** Note x coordinate for a chart position. */
export function horizontal(this: TimelineViewportReceiver, position: number): number {
  return this.noteHorizontal(position);
}

/** Horizontal inset that keeps note bodies clear of the panel edge. */
export function noteInset(this: TimelineViewportReceiver, width: number): number {
  return this.isExclusive() ? 0 : coreGeometry.noteInset(this.renderNoteScale, width);
}

/** Inset that keeps event bars clear of the column edge. */
export function eventInset(this: TimelineViewportReceiver, width: number): number {
  return coreGeometry.eventInset(width);
}

/** Rendered width of one note. */
export function noteWidth(this: TimelineViewportReceiver, note: TimelineNote): number {
  return coreGeometry.noteWidth(this.renderNoteScale, note.size);
}

/** Snap a chart x position to the lane grid. */
export function snapXPosition(this: TimelineViewportReceiver, value: number): number {
  return coreGeometry.snapXPosition(value, this.gridCount, this.snapX);
}

/** Note x coordinate in one line's panel. */
export function noteHorizontal(
  this: TimelineViewportReceiver,
  position: number,
  lineIndex: number = this.getSession().lineIndex,
): number {
  const canvasWidth = this.notesCanvas.clientWidth;
  return coreGeometry.noteHorizontal(
    position,
    this.cameraX ?? 0,
    this.noteInset(this.panelWidth(canvasWidth, "notes")),
    this.panelWidth(canvasWidth, "notes"),
    this.panelIndex(lineIndex, "notes"),
    canvasWidth,
    this.panelLayout("notes"),
    this.multiLineViewportOffset(canvasWidth, "notes"),
  );
}

/** Chart x position at a canvas x coordinate. */
export function positionAt(this: TimelineViewportReceiver, horizontal: number): number {
  return this.notePositionAt(horizontal);
}

/** Chart x position at a canvas x coordinate, snapped to the lane grid. */
export function notePositionAt(
  this: TimelineViewportReceiver,
  horizontal: number,
  lineIndex: number = this.lineIndexAt(horizontal, this.notesCanvas.clientWidth, "notes"),
): number {
  const canvasWidth = this.notesCanvas.clientWidth;
  const panelWidth = this.panelWidth(canvasWidth, "notes");
  const panel = this.panelIndex(lineIndex, "notes");
  const inset = this.noteInset(panelWidth);
  return coreGeometry.notePositionAt(
    horizontal,
    this.cameraX ?? 0,
    inset,
    panelWidth,
    panel,
    canvasWidth,
    this.panelLayout("notes"),
    this.multiLineViewportOffset(canvasWidth, "notes"),
    this.gridCount,
    this.snapX,
  );
}

/** Clamp a note to the visible panel; null means it lies fully outside. */
export function clampNoteHorizontal(
  this: TimelineViewportReceiver,
  horizontal: number,
  width: number,
  canvasWidth: number = this.notesCanvas.clientWidth,
  lineIndex: number = this.getSession().lineIndex,
): number | null {
  return coreGeometry.clampNoteHorizontal(
    horizontal,
    width,
    canvasWidth,
    this.panelIndex(lineIndex, "notes"),
    this.panelLayout("notes"),
    this.multiLineViewportOffset(canvasWidth, "notes"),
  );
}

/** Explicit type surface used by the viewport receiver without a namespace import. */
export type TimelineGeometryModule = {
  point: typeof point;
  eventColumnBounds: typeof eventColumnBounds;
  factorForLine: typeof factorForLine;
  noteFactorForLine: typeof noteFactorForLine;
  noteVerticalForLine: typeof noteVerticalForLine;
  noteBeatRangeForLine: typeof noteBeatRangeForLine;
  verticalForLine: typeof verticalForLine;
  beatRangeForLine: typeof beatRangeForLine;
  panelCount: typeof panelCount;
  panelIndex: typeof panelIndex;
  panelWidth: typeof panelWidth;
  panelGap: typeof panelGap;
  panelStride: typeof panelStride;
  visiblePanelRange: typeof visiblePanelRange;
  multiLineViewportOffset: typeof multiLineViewportOffset;
  panMultiLine: typeof panMultiLine;
  lineIndexAt: typeof lineIndexAt;
  panelHorizontal: typeof panelHorizontal;
  timeAt: typeof timeAt;
  beatAt: typeof beatAt;
  snappedBeat: typeof snappedBeat;
  vertical: typeof vertical;
  eventVertical: typeof eventVertical;
  eventBeatAt: typeof eventBeatAt;
  horizontal: typeof horizontal;
  noteInset: typeof noteInset;
  eventInset: typeof eventInset;
  noteWidth: typeof noteWidth;
  snapXPosition: typeof snapXPosition;
  noteHorizontal: typeof noteHorizontal;
  positionAt: typeof positionAt;
  notePositionAt: typeof notePositionAt;
  clampNoteHorizontal: typeof clampNoteHorizontal;
};
