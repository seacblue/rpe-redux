/**
 * Paints the timeline beat grid, subdivision labels, hover guides, playhead, and
 * multi-line panel chrome across the backdrop and foreground canvases.
 *
 * Canvas preparation and grid-part selection live here; beat math comes from
 * `core` and projection from the viewport.
 */
import type { TimelineGridReceiver } from "./timelineReceiver.ts";
import type { TimelineArea } from "../../../../../../core/edit/timeline/types.ts";
import { verticalGrid } from "../../../../../../core/global/chart/editing/editGrid.ts";
import { readCanvasPalette } from "../../../canvas/palette.ts";
import { canvasFont } from "../../../canvas/text.ts";
import type { TimelineAppearance } from "./timelineAppearance.ts";
import type { TimelineGestures } from "../interaction/timelineGestures.ts";
import type { TimelineViewport } from "../viewport/timelineViewport.ts";
import { BEAT_LINE_COLOR_KEYS, beatLineColorKeyAt } from "../../../canvas/beatLineColors.ts";

/**
 * Which parts of the beat grid a pass draws.
 *
 * The grid is painted on a backdrop and a foreground canvas. The playhead has
 * its own foreground canvas so static grid/content can be reused during seek
 * and playback frames.
 */
export interface GridParts {
  readonly lines?: boolean;
  readonly labels?: boolean;
  readonly playhead?: boolean;
}

export const BACKGROUND_GRID: GridParts = Object.freeze({
  // Beat bars are painted into the visible backdrop on every content frame.
  // They must not become part of a translated finite cache: playback can move
  // the viewport beyond the cache's original beat range.
  lines: true,
  labels: false,
  playhead: false,
});

export const FOREGROUND_GRID: GridParts = Object.freeze({
  lines: false,
  labels: true,
  playhead: false,
});

export const PLAYHEAD_GRID: GridParts = Object.freeze({
  lines: false,
  labels: false,
  playhead: true,
});

const draws = (parts: GridParts, part: keyof GridParts): boolean => parts[part] !== false;

/** Resolve the stroke colour for one grid tick from the configured subdivision colours. */
function gridStrokeColor(
  palette: ReturnType<typeof readCanvasPalette>,
  tick: number,
  division: number,
  subdivisionColors: readonly string[],
): string {
  const key = beatLineColorKeyAt(tick, division);
  // The settings table and the canvas role list share one coarse-to-fine order.
  const index = BEAT_LINE_COLOR_KEYS.indexOf(key);
  const fallbackByKey: Record<string, string> = {
    "1": palette.gridMajor,
    "2": palette.gridSubdivisions[0] ?? palette.gridMinor,
    "3": palette.gridSubdivisions[1] ?? palette.gridMinor,
    "4": palette.gridSubdivisions[2] ?? palette.gridMinor,
    "6": palette.gridSubdivisions[3] ?? palette.gridMinor,
    "8": palette.gridSubdivisions[4] ?? palette.gridMinor,
    "12": palette.gridSubdivisions[5] ?? palette.gridMinor,
    "16": palette.gridSubdivisions[6] ?? palette.gridMinor,
    default: palette.gridMinor,
  };
  return subdivisionColors[index] ?? fallbackByKey[key] ?? palette.gridMinor;
}

interface GridStrokeBatch {
  color: string;
  alpha: number;
  positions: number[];
}

/** Add one grid line to the batch with the same colour and alpha. */
function addGridPosition(
  batches: Map<string, GridStrokeBatch>,
  color: string,
  alpha: number,
  position: number,
): void {
  const key = `${color}|${alpha}`;
  const batch = batches.get(key) ?? { color, alpha, positions: [] };
  batch.positions.push(position);
  batches.set(key, batch);
}

/** Stroke every queued grid line with one path per colour and alpha. */
function strokeGridBatches(
  context: CanvasRenderingContext2D,
  batches: Map<string, GridStrokeBatch>,
  left: number,
  right: number,
): void {
  for (const batch of batches.values()) {
    context.strokeStyle = batch.color;
    context.globalAlpha = batch.alpha;
    context.beginPath();
    for (const position of batch.positions) {
      context.moveTo(left, position);
      context.lineTo(right, position);
    }
    context.stroke();
  }
  context.globalAlpha = 1;
}

type TimelineHoverGuideReceiver = {
  appearance: Pick<TimelineAppearance, "hoverGuidesEnabled" | "verticalGridHighlightColor">;
  gestures: Pick<TimelineGestures, "cursor" | "eventCursor" | "hoverArea">;
  viewport: TimelineViewport;
};

/** Spatial guides end at beat zero rather than continuing into negative time. */
export function strokeVerticalGrid(
  context: CanvasRenderingContext2D,
  horizontal: number,
  height: number,
): void {
  if (height <= 0) {
    return;
  }
  context.beginPath();
  context.moveTo(horizontal, 0);
  context.lineTo(horizontal, height);
  context.stroke();
}

/** Snap a chart x position to the nearest lane. */
function nearestVerticalPosition(value: number, count: number): number {
  const grid = verticalGrid(count);
  const index = Math.min(
    grid.lineCount - 1,
    Math.max(0, Math.round(value / grid.spacing - grid.first)),
  );
  return (index + grid.first) * grid.spacing;
}

/** Event timelines highlight beat rows only; notes may also highlight a lane. */
export function shouldDrawEventHoverVertical(area: TimelineArea): boolean {
  return area !== "events";
}

/** Draws the nearest snap lines over the active editing surface. */
export function drawHoverGuides(
  this: TimelineHoverGuideReceiver,
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  area: TimelineArea,
): void {
  if (this.appearance.hoverGuidesEnabled === false || this.gestures.hoverArea !== area) {
    return;
  }
  const pointer = area === "events" ? this.gestures.eventCursor : this.gestures.cursor;
  if (!pointer) {
    return;
  }
  const lineIndex = this.viewport.lineIndexAt(pointer.x, width, area);
  const factor = this.viewport.factorForLine(lineIndex);
  const seconds = this.viewport.timeAt(pointer.y);
  const beat = this.viewport.tempo.beat(seconds, factor);
  const nearestBeat = Math.round(beat * this.viewport.division) / this.viewport.division;
  const horizontal = this.viewport.verticalForLine(nearestBeat, lineIndex, height, area);
  const zeroY = this.viewport.verticalForLine(0, lineIndex, height, area);
  const vertical = shouldDrawEventHoverVertical(area)
    ? this.viewport.noteHorizontal(
        nearestVerticalPosition(
          this.viewport.notePositionAt(pointer.x, lineIndex),
          this.viewport.gridCount,
        ),
        lineIndex,
      )
    : null;
  if (!Number.isFinite(horizontal)) {
    return;
  }
  context.save();
  context.globalAlpha = 0.72;
  // Keep the guide continuous and lift the underlying grid colour slightly.
  // A blend mode communicates emphasis without turning the grid into a second
  // dashed interaction layer.
  context.globalCompositeOperation = "screen";
  context.lineWidth = 1.5;
  if (nearestBeat >= 0) {
    context.strokeStyle = readCanvasPalette().bottomValue;
    context.beginPath();
    context.moveTo(0, horizontal + 0.5);
    context.lineTo(width, horizontal + 0.5);
    context.stroke();
  }
  if (vertical !== null && Number.isFinite(vertical) && zeroY > 0) {
    context.strokeStyle = this.appearance.verticalGridHighlightColor;
    context.beginPath();
    context.moveTo(vertical + 0.5, 0);
    context.lineTo(vertical + 0.5, Math.min(height, zeroY));
    context.stroke();
  }
  context.restore();
}

/** Keep the configured thickness in CSS pixels even in narrow timeline panels. */
function playheadLineWidth(
  appearance: Pick<TimelineGridReceiver["appearance"], "playheadWidth">,
): number {
  return Math.max(0.5, appearance.playheadWidth ?? 3);
}

/** Draw the beat grid, subdivision labels, and optionally the playhead for one timeline area. */
export function grid(
  this: TimelineGridReceiver,
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  playBeat: number,
  parts: GridParts = {},
  area: TimelineArea = "notes",
): void {
  const palette = this.cache.palette() ?? readCanvasPalette();
  // Invert and project against the same local canvas height. The viewport
  // default can belong to the other timeline canvas during a resize or mode
  // switch, which shifts the visible beat grid.
  const scale = this.viewport.scaleForArea(area);
  const originSeconds = this.viewport.tempo.seconds(this.viewport.origin, this.viewport.factor);
  const secondsAt = (vertical: number) =>
    originSeconds + (height - this.viewport.judgementOffset - vertical) / scale;
  const beatAt = (vertical: number) =>
    this.viewport.tempo.beat(secondsAt(vertical), this.viewport.factor);
  const verticalAt = (beat: number) =>
    height -
    this.viewport.judgementOffset -
    (this.viewport.tempo.seconds(beat, this.viewport.factor) - originSeconds) * scale;
  const first = Math.max(0, Math.floor(beatAt(height) * this.viewport.division));
  const last = Math.ceil(beatAt(0) * this.viewport.division);
  const localBeatHeight = Math.abs(
    verticalAt(this.viewport.origin + 1) - verticalAt(this.viewport.origin),
  );
  const stride = Math.max(
    1,
    Math.ceil((6 * this.viewport.division) / Math.max(1, localBeatHeight)),
  );
  context.font = canvasFont("caption");
  context.lineWidth = Math.max(0.5, ((this.appearance.barWidth ?? 3) * 2 * width) / 1920);
  const batches = new Map<string, GridStrokeBatch>();
  for (let tick = first; tick <= last; tick += stride) {
    const beat = tick / this.viewport.division;
    const vertical = verticalAt(beat);
    const major = tick % this.viewport.division === 0;
    const color = gridStrokeColor(
      palette,
      tick,
      this.viewport.division,
      this.appearance.subdivisionColors,
    );
    const alpha = Math.min(
      1,
      (this.appearance.barAlpha ?? 1) * (major ? 0.9 : tick % 2 === 0 ? 0.6 : 0.4),
    );
    if (draws(parts, "lines")) {
      addGridPosition(batches, color, alpha, vertical);
    }
    if (draws(parts, "labels") && tick % this.viewport.division === 0) {
      context.globalAlpha = 1;
      context.fillStyle = palette.foreground;
      context.fillText(String(beat), 5, vertical - 4);
    }
  }
  strokeGridBatches(context, batches, 0, width);
  context.globalAlpha = 1;
  if (draws(parts, "playhead")) {
    context.strokeStyle = this.appearance.playheadColor ?? palette.playhead;
    context.lineWidth = playheadLineWidth(this.appearance);
    const vertical = verticalAt(playBeat);
    context.beginPath();
    context.moveTo(0, vertical);
    context.lineTo(width, vertical);
    context.stroke();
  }
  context.lineWidth = 1;
}

/** Draw the grid clipped to a single multi-line panel at `left`. */
export function gridForLine(
  this: TimelineGridReceiver,
  context: CanvasRenderingContext2D,
  left: number,
  width: number,
  height: number,
  playBeat: number,
  lineIndex: number,
  showBeatLabels: boolean = true,
  parts: GridParts = {},
  area: TimelineArea = this.getSession().multiLineMode,
): void {
  const palette = this.cache.palette() ?? readCanvasPalette();
  const factor = this.viewport.factorForLine(lineIndex);
  const originSeconds = this.viewport.tempo.seconds(this.viewport.origin, factor);
  const secondsAt = (vertical: number) =>
    originSeconds +
    (height - this.viewport.judgementOffset - vertical) / this.viewport.scaleForArea(area);
  const beatAt = (vertical: number) => this.viewport.tempo.beat(secondsAt(vertical), factor);
  const first = Math.max(0, Math.floor(beatAt(height) * this.viewport.division));
  const last = Math.ceil(beatAt(0) * this.viewport.division);
  const localBeatHeight = Math.abs(
    this.viewport.verticalForLine(this.viewport.origin + 1, lineIndex, height, area) -
      this.viewport.verticalForLine(this.viewport.origin, lineIndex, height, area),
  );
  const stride = Math.max(
    1,
    Math.ceil((6 * this.viewport.division) / Math.max(1, localBeatHeight)),
  );
  context.save();
  context.beginPath();
  context.rect(left, 0, width, height);
  context.clip();
  context.font = canvasFont("caption");
  context.lineWidth = Math.max(0.5, ((this.appearance.barWidth ?? 3) * 2 * width) / 1920);
  const batches = new Map<string, GridStrokeBatch>();
  for (let tick = first; tick <= last; tick += stride) {
    const beat = tick / this.viewport.division;
    const vertical = this.viewport.verticalForLine(beat, lineIndex, height, area);
    const major = tick % this.viewport.division === 0;
    const color = gridStrokeColor(
      palette,
      tick,
      this.viewport.division,
      this.appearance.subdivisionColors,
    );
    const alpha = Math.min(
      1,
      (this.appearance.barAlpha ?? 1) * (major ? 0.9 : tick % 2 === 0 ? 0.6 : 0.4),
    );
    if (draws(parts, "lines")) {
      addGridPosition(batches, color, alpha, vertical);
    }
    if (draws(parts, "labels") && major && showBeatLabels) {
      context.globalAlpha = 1;
      context.fillStyle = palette.foreground;
      context.fillText(String(beat), left + 5, vertical - 4);
    }
  }
  strokeGridBatches(context, batches, left, left + width);
  context.globalAlpha = 1;
  if (draws(parts, "playhead")) {
    const playSeconds = this.viewport.tempo.seconds(playBeat, this.viewport.factor);
    const playLineBeat = this.viewport.tempo.beat(playSeconds, factor);
    context.strokeStyle = this.appearance.playheadColor ?? palette.playhead;
    context.lineWidth = playheadLineWidth(this.appearance);
    context.beginPath();
    context.moveTo(left, this.viewport.verticalForLine(playLineBeat, lineIndex, height, area));
    context.lineTo(
      left + width,
      this.viewport.verticalForLine(playLineBeat, lineIndex, height, area),
    );
    context.stroke();
  }
  context.restore();
  context.lineWidth = 1;
}

/** Draw the grid and playhead for every visible multi-line panel. */
export function drawMultiLineGrid(
  this: TimelineGridReceiver,
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  playBeat: number,
  area: TimelineArea = "events",
  parts: GridParts = {},
): void {
  const panelWidth = this.viewport.panelWidth(width, area);
  const stride = this.viewport.panelStride(width, area);
  const offset = this.viewport.multiLineViewportOffset(width, area);
  const multiple = this.viewport.panelCount(area) > 1;
  const targetLines = this.getSession().targetLineIndices;
  const [firstPanel, lastPanel] = this.viewport.visiblePanelRange(width, area);
  if (parts.playhead && !parts.lines && !parts.labels) {
    const palette = this.cache.palette() ?? readCanvasPalette();
    context.save();
    context.strokeStyle = this.appearance.playheadColor ?? palette.playhead;
    context.lineWidth = playheadLineWidth(this.appearance);
    context.beginPath();
    const playSeconds = this.viewport.tempo.seconds(playBeat, this.viewport.factor);
    for (let panel = firstPanel; panel <= lastPanel; panel++) {
      const lineIndex = targetLines[panel];
      if (lineIndex === undefined) {
        continue;
      }
      const left = panel * stride - offset;
      const playLineBeat = this.viewport.tempo.beat(
        playSeconds,
        this.viewport.factorForLine(lineIndex),
      );
      const vertical = this.viewport.verticalForLine(playLineBeat, lineIndex, height, area);
      if (!Number.isFinite(vertical)) {
        continue;
      }
      context.moveTo(left, vertical);
      context.lineTo(left + panelWidth, vertical);
    }
    context.stroke();
    context.restore();
    return;
  }
  for (let panel = firstPanel; panel <= lastPanel; panel++) {
    const lineIndex = targetLines[panel];
    if (lineIndex === undefined) {
      continue;
    }
    this.gridForLine(
      context,
      panel * stride - offset,
      panelWidth,
      height,
      playBeat,
      lineIndex,
      !multiple,
      parts,
      area,
    );
  }
}

/** Draw beat numbers in the gaps between multi-line panels. */
export function drawMultiLineBeatLabels(
  this: TimelineGridReceiver,
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  area: TimelineArea,
): void {
  if (this.viewport.panelCount(area) < 2) {
    return;
  }
  const panelWidth = this.viewport.panelWidth(width, area);
  const stride = this.viewport.panelStride(width, area);
  const offset = this.viewport.multiLineViewportOffset(width, area);
  const gap = this.viewport.panelGap(width, area);
  const targetLines = this.getSession().targetLineIndices;
  const [firstPanel, lastPanel] = this.viewport.visiblePanelRange(width, area);
  for (let panel = firstPanel; panel <= Math.min(lastPanel, targetLines.length - 2); panel++) {
    const lineIndex = targetLines[panel];
    if (lineIndex === undefined) {
      continue;
    }
    const factor = this.viewport.factorForLine(lineIndex);
    const originSeconds = this.viewport.tempo.seconds(this.viewport.origin, factor);
    const secondsAt = (vertical: number) =>
      originSeconds +
      (height - this.viewport.judgementOffset - vertical) / this.viewport.scaleForArea(area);
    const beatAt = (vertical: number) => this.viewport.tempo.beat(secondsAt(vertical), factor);
    const first = Math.max(0, Math.floor(beatAt(height) * this.viewport.division));
    const last = Math.ceil(beatAt(0) * this.viewport.division);
    const localBeatHeight = Math.abs(
      this.viewport.verticalForLine(this.viewport.origin + 1, lineIndex, height, area) -
        this.viewport.verticalForLine(this.viewport.origin, lineIndex, height, area),
    );
    const tickStride = Math.max(
      1,
      Math.ceil((6 * this.viewport.division) / Math.max(1, localBeatHeight)),
    );
    const labelStride = Math.max(
      this.viewport.division,
      Math.ceil(tickStride / this.viewport.division) * this.viewport.division,
    );
    const labelFirst = Math.ceil(first / this.viewport.division) * this.viewport.division;
    const x = panel * stride - offset + panelWidth + gap / 2;
    context.save();
    context.font = canvasFont(gap < 20 ? "micro" : "caption");
    context.textAlign = "center";
    context.fillStyle = this.cache.palette()?.foreground ?? "#dddddd";
    for (let tick = labelFirst; tick <= last; tick += labelStride) {
      const beat = tick / this.viewport.division;
      const vertical = this.viewport.verticalForLine(beat, lineIndex, height, area);
      if (vertical >= 0 && vertical <= height) {
        context.fillText(String(beat), x, vertical - 4);
      }
    }
    context.restore();
  }
}

/**
 * Baseline for the line label in both fields.
 *
 * Both areas share one baseline so the left edge stays aligned when only one
 * field is visible.
 */
const LINE_LABEL_BASELINE = 16;

/** Draw each visible panel's line index in its top-left corner. */
export function drawMultiLinePanelLabels(
  this: TimelineGridReceiver,
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  area: TimelineArea,
): void {
  if (this.viewport.panelCount(area) < 2) {
    return;
  }
  const stride = this.viewport.panelStride(width, area);
  const offset = this.viewport.multiLineViewportOffset(width, area);
  const palette = this.cache.palette() ?? readCanvasPalette();
  context.save();
  context.beginPath();
  context.rect(0, 0, width, height);
  context.clip();
  context.fillStyle = palette.bottomValue;
  context.font = canvasFont("caption");
  context.textAlign = "left";
  const targetLines = this.getSession().targetLineIndices;
  const [firstPanel, lastPanel] = this.viewport.visiblePanelRange(width, area);
  for (let panel = firstPanel; panel <= lastPanel; panel++) {
    const lineIndex = targetLines[panel];
    if (lineIndex === undefined) {
      continue;
    }
    const left = panel * stride - offset;
    context.fillText(String(lineIndex), left + 6, LINE_LABEL_BASELINE);
  }
  context.restore();
}
