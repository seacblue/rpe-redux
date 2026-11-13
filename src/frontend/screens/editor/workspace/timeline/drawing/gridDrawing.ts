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
import {
  beatLineColorKeyAt,
  beatLineColorKeys,
  type BeatLineColorKey,
} from "../../../canvas/beatLineColors.ts";
import { sourceOverColor } from "../../../../../../core/utils/colors.ts";

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

/** Include the hovered tick even when dense-grid culling skips its neighbours. */
export function visibleGridTicks(
  first: number,
  last: number,
  stride: number,
  highlightedTick: number | null,
): number[] {
  const ticks: number[] = [];
  return visibleGridTicksInto(first, last, stride, highlightedTick, ticks);
}

/** Fill reusable storage with the visible grid ticks while preserving draw order. */
export function visibleGridTicksInto(
  first: number,
  last: number,
  stride: number,
  highlightedTick: number | null,
  ticks: number[],
): number[] {
  ticks.length = 0;
  for (let tick = first; tick <= last; tick += stride) {
    ticks.push(tick);
  }
  if (highlightedTick !== null && highlightedTick >= first && highlightedTick <= last) {
    const position = (highlightedTick - first) / stride;
    if (!Number.isInteger(position)) {
      ticks.splice(Math.ceil(position), 0, highlightedTick);
    }
  }
  return ticks;
}

const GRID_COLOR_INDEX: Readonly<Record<BeatLineColorKey, number>> = {
  "1": 0,
  "2": 1,
  "3": 2,
  "4": 3,
  "6": 4,
  "8": 5,
  "12": 6,
  "16": 7,
  default: 8,
};

/** Build the fallback slots once per grid pass instead of once per tick. */
function gridFallbackColors(
  palette: ReturnType<typeof readCanvasPalette>,
  target: string[],
): readonly string[] {
  target[0] = palette.gridMajor;
  target[1] = palette.gridSubdivisions[0] ?? palette.gridMinor;
  target[2] = palette.gridSubdivisions[1] ?? palette.gridMinor;
  target[3] = palette.gridSubdivisions[2] ?? palette.gridMinor;
  target[4] = palette.gridSubdivisions[3] ?? palette.gridMinor;
  target[5] = palette.gridSubdivisions[4] ?? palette.gridMinor;
  target[6] = palette.gridSubdivisions[5] ?? palette.gridMinor;
  target[7] = palette.gridSubdivisions[6] ?? palette.gridMinor;
  target[8] = palette.gridMinor;
  return target;
}

/** Resolve one grid color using a precomputed fallback slot table. */
export function gridStrokeColor(
  palette: ReturnType<typeof readCanvasPalette>,
  tick: number,
  division: number,
  subdivisionColors: readonly string[],
  fallbackColors: readonly string[],
  colorKeys: readonly BeatLineColorKey[] = beatLineColorKeys(division),
): string {
  const indexInPattern =
    ((Math.trunc(tick) % colorKeys.length) + colorKeys.length) % colorKeys.length;
  const key = colorKeys[indexInPattern] ?? beatLineColorKeyAt(tick, division);
  const index = GRID_COLOR_INDEX[key];
  return subdivisionColors[index] ?? fallbackColors[index] ?? palette.gridMinor;
}

interface GridStrokeBatch {
  color: string;
  alpha: number;
  positions: number[];
}

interface GridScratch {
  readonly ticks: number[];
  readonly batches: Map<string, GridStrokeBatch>;
  readonly batchPool: GridStrokeBatch[];
  readonly fallbackColors: string[];
}

const gridScratch = new WeakMap<object, GridScratch>();

/** Retain grid pass storage per receiver without changing the public drawing contract. */
function scratchFor(receiver: object): GridScratch {
  const current = gridScratch.get(receiver);
  if (current) {
    return current;
  }
  const created: GridScratch = {
    ticks: [],
    batches: new Map(),
    batchPool: [],
    fallbackColors: new Array<string>(9),
  };
  gridScratch.set(receiver, created);
  return created;
}

/** Return completed stroke batches to the receiver-owned pool for the next pass. */
function resetGridBatches(scratch: GridScratch): void {
  for (const batch of scratch.batches.values()) {
    batch.positions.length = 0;
    scratch.batchPool.push(batch);
  }
  scratch.batches.clear();
}

type TempoSecondsCache = {
  tempoSeconds?: (tempo: TimelineViewport["tempo"], beat: number, factor: number) => number;
};

/** Resolve beat time through the retained cache, while keeping lightweight test receivers valid. */
function cachedTempoSeconds(
  cache: TempoSecondsCache,
  tempo: TimelineViewport["tempo"],
  beat: number,
  factor: number,
): number {
  return cache.tempoSeconds?.call(cache, tempo, beat, factor) ?? tempo.seconds(beat, factor);
}

/** Add one grid line to the batch with the same colour and alpha. */
function addGridPosition(
  batches: Map<string, GridStrokeBatch>,
  batchPool: GridStrokeBatch[],
  color: string,
  alpha: number,
  position: number,
): void {
  const key = `${color}|${alpha}`;
  let batch = batches.get(key);
  if (!batch) {
    batch = batchPool.pop() ?? { color, alpha, positions: [] };
    batch.color = color;
    batch.alpha = alpha;
    batches.set(key, batch);
  }
  batch.positions.push(position);
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
  appearance: Pick<TimelineAppearance, "hoverGuidesEnabled" | "gridHighlightColor">;
  cache: TempoSecondsCache;
  gestures: Pick<TimelineGestures, "cursor" | "eventCursor" | "hoverArea">;
  viewport: TimelineViewport;
};

/** Resolve the snapped beat under the pointer for the requested timeline area. */
function hoveredGridLine(
  receiver: TimelineHoverGuideReceiver,
  width: number,
  height: number,
  area: TimelineArea,
): { lineIndex: number; beat: number } | null {
  if (receiver.appearance.hoverGuidesEnabled === false || receiver.gestures.hoverArea !== area) {
    return null;
  }
  const pointer = area === "events" ? receiver.gestures.eventCursor : receiver.gestures.cursor;
  if (!pointer) {
    return null;
  }
  const lineIndex = receiver.viewport.lineIndexAt(pointer.x, width, area);
  const factor = receiver.viewport.factorForLine(lineIndex);
  const seconds =
    cachedTempoSeconds(receiver.cache, receiver.viewport.tempo, receiver.viewport.origin, factor) +
    (height - receiver.viewport.judgementOffset - pointer.y) / receiver.viewport.scaleForArea(area);
  const beat = receiver.viewport.tempo.beat(seconds, factor);
  const snapped = Math.round(beat * receiver.viewport.division) / receiver.viewport.division;
  return Number.isFinite(snapped) ? { lineIndex, beat: snapped } : null;
}

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
export function nearestVerticalPosition(value: number, count: number): number {
  const grid = verticalGrid(count);
  const index = Math.min(
    grid.lineCount - 1,
    Math.max(0, Math.round(value / grid.spacing - grid.first)),
  );
  return (index + grid.first) * grid.spacing;
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
  const originSeconds = cachedTempoSeconds(
    this.cache,
    this.viewport.tempo,
    this.viewport.origin,
    this.viewport.factor,
  );
  const secondsAt = (vertical: number) =>
    originSeconds + (height - this.viewport.judgementOffset - vertical) / scale;
  const beatAt = (vertical: number) =>
    this.viewport.tempo.beat(secondsAt(vertical), this.viewport.factor);
  const verticalAt = (beat: number) =>
    height -
    this.viewport.judgementOffset -
    (cachedTempoSeconds(this.cache, this.viewport.tempo, beat, this.viewport.factor) -
      originSeconds) *
      scale;
  const first = Math.max(0, Math.floor(beatAt(height) * this.viewport.division));
  const last = Math.ceil(beatAt(0) * this.viewport.division);
  const localBeatHeight = Math.abs(
    verticalAt(this.viewport.origin + 1) - verticalAt(this.viewport.origin),
  );
  const stride = Math.max(
    1,
    Math.ceil((6 * this.viewport.division) / Math.max(1, localBeatHeight)),
  );
  const hovered = hoveredGridLine(this, width, height, area);
  const highlightedTick = hovered ? Math.round(hovered.beat * this.viewport.division) : null;
  context.font = canvasFont("caption");
  context.lineWidth = Math.max(0.5, ((this.appearance.barWidth ?? 3) * 2 * width) / 1920);
  const scratch = scratchFor(this);
  resetGridBatches(scratch);
  const batches = scratch.batches;
  const lineBatch = area === "notes" ? this.notesGridBatch : this.eventsGridBatch;
  const playheadBatch = area === "notes" ? this.notesPlayheadBatch : this.eventsPlayheadBatch;
  const fallbackColors = gridFallbackColors(palette, scratch.fallbackColors);
  const colorKeys = beatLineColorKeys(this.viewport.division);
  const ticks = visibleGridTicksInto(first, last, stride, highlightedTick, scratch.ticks);
  for (const tick of ticks) {
    const beat = tick / this.viewport.division;
    const vertical = verticalAt(beat);
    const major = tick % this.viewport.division === 0;
    const baseColor = gridStrokeColor(
      palette,
      tick,
      this.viewport.division,
      this.appearance.subdivisionColors,
      fallbackColors,
      colorKeys,
    );
    const baseAlpha = Math.min(
      1,
      (this.appearance.barAlpha ?? 1) * (major ? 0.9 : tick % 2 === 0 ? 0.6 : 0.4),
    );
    const highlighted = highlightedTick !== null && tick === highlightedTick && beat >= 0;
    const color = highlighted
      ? sourceOverColor(baseColor, this.appearance.gridHighlightColor, baseAlpha)
      : baseColor;
    const alpha = highlighted ? 1 : baseAlpha;
    if (draws(parts, "lines")) {
      if (lineBatch?.isActive?.()) {
        lineBatch.addRect(0, vertical, width, Math.max(0.5, context.lineWidth), color, alpha);
      } else {
        addGridPosition(batches, scratch.batchPool, color, alpha, vertical);
      }
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
    const vertical = verticalAt(playBeat);
    const color = this.appearance.playheadColor ?? palette.playhead;
    const lineWidth = playheadLineWidth(this.appearance);
    if (playheadBatch?.isActive?.()) {
      playheadBatch.addRect(0, vertical, width, lineWidth, color);
    } else {
      context.strokeStyle = color;
      context.lineWidth = lineWidth;
      context.beginPath();
      context.moveTo(0, vertical);
      context.lineTo(width, vertical);
      context.stroke();
    }
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
  const originSeconds = cachedTempoSeconds(
    this.cache,
    this.viewport.tempo,
    this.viewport.origin,
    factor,
  );
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
  const canvasWidth =
    area === "events"
      ? this.viewport.eventsCanvas.clientWidth
      : this.viewport.notesCanvas.clientWidth;
  const hovered = hoveredGridLine(this, canvasWidth, height, area);
  const highlightedTick =
    hovered?.lineIndex === lineIndex ? Math.round(hovered.beat * this.viewport.division) : null;
  context.save();
  context.beginPath();
  context.rect(left, 0, width, height);
  context.clip();
  context.font = canvasFont("caption");
  context.lineWidth = Math.max(0.5, ((this.appearance.barWidth ?? 3) * 2 * width) / 1920);
  const scratch = scratchFor(this);
  resetGridBatches(scratch);
  const batches = scratch.batches;
  const lineBatch = area === "notes" ? this.notesGridBatch : this.eventsGridBatch;
  const playheadBatch = area === "notes" ? this.notesPlayheadBatch : this.eventsPlayheadBatch;
  const fallbackColors = gridFallbackColors(palette, scratch.fallbackColors);
  const colorKeys = beatLineColorKeys(this.viewport.division);
  const ticks = visibleGridTicksInto(first, last, stride, highlightedTick, scratch.ticks);
  for (const tick of ticks) {
    const beat = tick / this.viewport.division;
    const vertical = this.viewport.verticalForLine(beat, lineIndex, height, area);
    const major = tick % this.viewport.division === 0;
    const baseColor = gridStrokeColor(
      palette,
      tick,
      this.viewport.division,
      this.appearance.subdivisionColors,
      fallbackColors,
      colorKeys,
    );
    const baseAlpha = Math.min(
      1,
      (this.appearance.barAlpha ?? 1) * (major ? 0.9 : tick % 2 === 0 ? 0.6 : 0.4),
    );
    const highlighted = highlightedTick !== null && tick === highlightedTick && beat >= 0;
    const color = highlighted
      ? sourceOverColor(baseColor, this.appearance.gridHighlightColor, baseAlpha)
      : baseColor;
    const alpha = highlighted ? 1 : baseAlpha;
    if (draws(parts, "lines")) {
      if (lineBatch?.isActive?.()) {
        lineBatch.addRect(left, vertical, width, Math.max(0.5, context.lineWidth), color, alpha);
      } else {
        addGridPosition(batches, scratch.batchPool, color, alpha, vertical);
      }
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
    const vertical = this.viewport.verticalForLine(playLineBeat, lineIndex, height, area);
    const color = this.appearance.playheadColor ?? palette.playhead;
    const lineWidth = playheadLineWidth(this.appearance);
    if (playheadBatch?.isActive?.()) {
      playheadBatch.addRect(left, vertical, width, lineWidth, color);
    } else {
      context.strokeStyle = color;
      context.lineWidth = lineWidth;
      context.beginPath();
      context.moveTo(left, vertical);
      context.lineTo(left + width, vertical);
      context.stroke();
    }
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
    const playheadBatch = area === "notes" ? this.notesPlayheadBatch : this.eventsPlayheadBatch;
    const active = playheadBatch?.isActive?.() === true;
    const lineWidth = playheadLineWidth(this.appearance);
    const color = this.appearance.playheadColor ?? palette.playhead;
    const playSeconds = this.viewport.tempo.seconds(playBeat, this.viewport.factor);
    if (!active) {
      context.save();
      context.strokeStyle = color;
      context.lineWidth = lineWidth;
      context.beginPath();
    }
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
      if (active) {
        playheadBatch.addRect(left, vertical, panelWidth, lineWidth, color);
      } else {
        context.moveTo(left, vertical);
        context.lineTo(left + panelWidth, vertical);
      }
    }
    if (!active) {
      context.stroke();
      context.restore();
    }
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
    const originSeconds = cachedTempoSeconds(
      this.cache,
      this.viewport.tempo,
      this.viewport.origin,
      factor,
    );
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
  const key = multiLinePanelLabelLayerKey(this, width, height, area);
  const owner = area === "notes" ? this.notesBackdrop : this.eventsBackdrop;
  const layer = this.cache.canvasLayer(owner, key, width, height, `panel-labels:${area}`);
  if (layer) {
    if (layer.repaint) {
      drawMultiLinePanelLabelsInto.call(this, layer.context, width, height, area);
    }
    context.drawImage(layer.canvas, 0, 0, width, height);
    return;
  }
  drawMultiLinePanelLabelsInto.call(this, context, width, height, area);
}

/** Return every geometry and appearance input used by the cached panel labels. */
function multiLinePanelLabelLayerKey(
  receiver: TimelineGridReceiver,
  width: number,
  height: number,
  area: TimelineArea,
): string {
  const panelCount = receiver.viewport.panelCount(area);
  const stride = receiver.viewport.panelStride(width, area);
  const offset = receiver.viewport.multiLineViewportOffset(width, area);
  const [firstPanel, lastPanel] = receiver.viewport.visiblePanelRange(width, area);
  const palette = receiver.cache.palette() ?? readCanvasPalette();
  return [
    width,
    height,
    area,
    panelCount,
    stride,
    offset,
    firstPanel,
    lastPanel,
    receiver.getSession().targetLineIndices.join(","),
    palette.bottomValue,
  ].join("|");
}

/** Paint the panel labels into either the live or an offscreen context. */
function drawMultiLinePanelLabelsInto(
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
