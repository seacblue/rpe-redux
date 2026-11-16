/* eslint-disable max-lines -- grid geometry, hover rules, and retained packet submission share one drawing contract. */
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
import type { RenderCommand } from "../../../canvas/renderGraph.ts";
import {
  TimelineGridRenderDevice,
  type TimelineGridRenderPacket,
} from "../../../canvas/timelineGridRenderDevice.ts";
import { horizontalGuideHoverOpacity } from "./timelineHoverGuides.ts";

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

/** Return the complete invalidation key for a static timeline grid batch. */
export function gridBatchKey(
  receiver: Pick<
    TimelineGridReceiver,
    "appearance" | "cache" | "getSession" | "gestures" | "viewport"
  >,
  width: number,
  height: number,
  area: TimelineArea,
): string {
  const session = receiver.getSession();
  const palette = receiver.cache.palette() ?? readCanvasPalette();
  const cursor = area === "notes" ? receiver.gestures.cursor : receiver.gestures.eventCursor;
  const viewport = receiver.viewport as unknown as {
    origin: number;
    scale: number;
    division: number;
    judgementOffset: number;
    getMultiLineZoom?: (area: TimelineArea) => number;
    panelCount?: (area?: TimelineArea) => number;
    panelStride?: (width: number, area?: TimelineArea) => number;
    multiLineViewportOffset?: (width: number, area?: TimelineArea) => number;
    panelWidth?: (width: number, area?: TimelineArea) => number;
    panelGap?: (width: number, area?: TimelineArea) => number;
  };
  return [
    width,
    height,
    area,
    viewport.origin,
    viewport.scale,
    viewport.division,
    viewport.judgementOffset,
    viewport.getMultiLineZoom?.(area),
    viewport.panelCount?.(area),
    viewport.panelStride?.(width, area),
    viewport.multiLineViewportOffset?.(width, area),
    viewport.panelWidth?.(width, area),
    viewport.panelGap?.(width, area),
    session.multiLineMode,
    session.notesMode,
    session.eventsMode,
    session.targetLineIndices.join(","),
    receiver.appearance.barWidth,
    receiver.appearance.barAlpha,
    receiver.appearance.hoverGuidesEnabled,
    receiver.appearance.gridHighlightColor,
    receiver.appearance.subdivisionColors.join(","),
    palette.gridMajor,
    palette.gridMinor,
    palette.gridSubdivisions.join(","),
    palette.foreground,
    cursor?.x,
    cursor?.y,
    receiver.gestures.hoverArea,
  ].join("|");
}

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

interface GridScratch {
  readonly ticks: number[];
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
    fallbackColors: new Array<string>(9),
  };
  gridScratch.set(receiver, created);
  return created;
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

/** Pick the retained device for one timeline area and one moving/static layer. */
function gridDevice(
  receiver: TimelineGridReceiver,
  area: TimelineArea,
  playhead: boolean,
): TimelineGridReceiver["notesGridDevice"] {
  if (area === "notes") {
    return (
      (playhead ? receiver.notesPlayheadDevice : receiver.notesGridDevice) ??
      new TimelineGridRenderDevice(playhead ? receiver.notesPlayheadBatch : receiver.notesGridBatch)
    );
  }
  return (
    (playhead ? receiver.eventsPlayheadDevice : receiver.eventsGridDevice) ??
    new TimelineGridRenderDevice(playhead ? receiver.eventsPlayheadBatch : receiver.eventsGridBatch)
  );
}

/** Submit one grid packet while keeping Canvas2D and batch operations in the device. */
function renderGridPacket(
  receiver: TimelineGridReceiver,
  context: CanvasRenderingContext2D,
  area: TimelineArea,
  playhead: boolean,
  commands: readonly RenderCommand[],
  clip?: TimelineGridRenderPacket["clip"],
): void {
  gridDevice(receiver, area, playhead).render({
    context,
    commands,
    clip,
  });
}

type TimelineHoverGuideReceiver = {
  appearance: Pick<
    TimelineAppearance,
    "hoverGuidesEnabled" | "nearbyGuidesOnly" | "gridHighlightColor"
  >;
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
): { lineIndex: number; beat: number; pointerY: number } | null {
  if (
    receiver.appearance.hoverGuidesEnabled === false &&
    receiver.appearance.nearbyGuidesOnly !== true
  ) {
    return null;
  }
  if (receiver.gestures.hoverArea !== area) {
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
  return Number.isFinite(snapped) ? { lineIndex, beat: snapped, pointerY: pointer.y } : null;
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
  // Every visible tick is retained; nearby-only mode controls alpha, not geometry.
  const stride = 1;
  const hovered = hoveredGridLine(this, width, height, area);
  const highlightedTick = hovered ? Math.round(hovered.beat * this.viewport.division) : null;
  const scratch = scratchFor(this);
  const lineWidth = Math.max(0.5, ((this.appearance.barWidth ?? 3) * 2 * width) / 1920);
  const commands: RenderCommand[] = [];
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
    const nearestHover = highlightedTick !== null && tick === highlightedTick && beat >= 0;
    const hoverOpacity =
      this.appearance.nearbyGuidesOnly === true
        ? horizontalGuideHoverOpacity(vertical, hovered?.pointerY ?? null)
        : nearestHover
          ? 1
          : 0;
    // Only the nearest snapped beat line receives the highlight colour. The
    // surrounding lines keep their own colours and use hoverOpacity solely as
    // the sampling-style fade.
    const highlighted = this.appearance.hoverGuidesEnabled !== false && nearestHover;
    const color = highlighted
      ? sourceOverColor(baseColor, this.appearance.gridHighlightColor)
      : baseColor;
    const alpha =
      this.appearance.nearbyGuidesOnly === true ? hoverOpacity : Math.max(baseAlpha, hoverOpacity);
    if (draws(parts, "lines")) {
      commands.push({
        kind: "fillRect",
        x: 0,
        y: vertical,
        width,
        height: lineWidth,
        color,
        alpha,
      });
    }
    if (draws(parts, "labels") && tick % this.viewport.division === 0) {
      commands.push({
        kind: "text",
        text: String(beat),
        x: 5,
        y: vertical - 4,
        font: canvasFont("caption"),
        color: palette.foreground,
        align: "left",
        alpha: 1,
      });
    }
  }
  if (draws(parts, "playhead")) {
    const vertical = verticalAt(playBeat);
    const color = this.appearance.playheadColor ?? palette.playhead;
    commands.push({
      kind: "fillRect",
      x: 0,
      y: vertical,
      width,
      height: playheadLineWidth(this.appearance),
      color,
      alpha: 1,
    });
  }
  renderGridPacket(this, context, area, draws(parts, "playhead"), commands);
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
  // Every visible tick is retained; nearby-only mode controls alpha, not geometry.
  const stride = 1;
  const canvasWidth =
    area === "events"
      ? this.viewport.eventsCanvas.clientWidth
      : this.viewport.notesCanvas.clientWidth;
  const hovered = hoveredGridLine(this, canvasWidth, height, area);
  const highlightedTick =
    hovered?.lineIndex === lineIndex ? Math.round(hovered.beat * this.viewport.division) : null;
  const scratch = scratchFor(this);
  // Grid-line thickness is canvas-space, not panel-space; retained packets
  // still need the full-canvas width when several panels are fitted together.
  const lineWidth = Math.max(0.5, ((this.appearance.barWidth ?? 3) * 2 * canvasWidth) / 1920);
  const commands: RenderCommand[] = [];
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
    const nearestHover = highlightedTick !== null && tick === highlightedTick && beat >= 0;
    const hoverOpacity =
      this.appearance.nearbyGuidesOnly === true
        ? horizontalGuideHoverOpacity(vertical, hovered?.pointerY ?? null)
        : nearestHover
          ? 1
          : 0;
    // Match note-lane guides: colour only the nearest snapped line, while the
    // neighbouring lines retain their base colours and fade by pixel distance.
    const highlighted = this.appearance.hoverGuidesEnabled !== false && nearestHover;
    const color = highlighted
      ? sourceOverColor(baseColor, this.appearance.gridHighlightColor)
      : baseColor;
    const alpha =
      this.appearance.nearbyGuidesOnly === true ? hoverOpacity : Math.max(baseAlpha, hoverOpacity);
    if (draws(parts, "lines")) {
      commands.push({
        kind: "fillRect",
        x: left,
        y: vertical,
        width,
        height: lineWidth,
        color,
        alpha,
      });
    }
    if (draws(parts, "labels") && major && showBeatLabels) {
      commands.push({
        kind: "text",
        text: String(beat),
        x: left + 5,
        y: vertical - 4,
        font: canvasFont("caption"),
        color: palette.foreground,
        align: "left",
        alpha: 1,
      });
    }
  }
  if (draws(parts, "playhead")) {
    const playSeconds = this.viewport.tempo.seconds(playBeat, this.viewport.factor);
    const playLineBeat = this.viewport.tempo.beat(playSeconds, factor);
    const vertical = this.viewport.verticalForLine(playLineBeat, lineIndex, height, area);
    const color = this.appearance.playheadColor ?? palette.playhead;
    commands.push({
      kind: "fillRect",
      x: left,
      y: vertical,
      width,
      height: playheadLineWidth(this.appearance),
      color,
      alpha: 1,
    });
  }
  renderGridPacket(this, context, area, draws(parts, "playhead"), commands, {
    left,
    top: 0,
    width,
    height,
  });
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
    const lineWidth = playheadLineWidth(this.appearance);
    const color = this.appearance.playheadColor ?? palette.playhead;
    const playSeconds = this.viewport.tempo.seconds(playBeat, this.viewport.factor);
    const commands: RenderCommand[] = [];
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
      commands.push({
        kind: "fillRect",
        x: left,
        y: vertical,
        width: panelWidth,
        height: lineWidth,
        color,
        alpha: 1,
      });
    }
    renderGridPacket(this, context, area, true, commands);
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
  const palette = this.cache.palette() ?? readCanvasPalette();
  const targetLines = this.getSession().targetLineIndices;
  const [firstPanel, lastPanel] = this.viewport.visiblePanelRange(width, area);
  const commands: RenderCommand[] = [];
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
    for (let tick = labelFirst; tick <= last; tick += labelStride) {
      const beat = tick / this.viewport.division;
      const vertical = this.viewport.verticalForLine(beat, lineIndex, height, area);
      if (vertical >= 0 && vertical <= height) {
        commands.push({
          kind: "text",
          text: String(beat),
          x,
          y: vertical - 4,
          font: canvasFont(gap < 20 ? "micro" : "caption"),
          color: palette.foreground,
          align: "center",
          alpha: 1,
        });
      }
    }
  }
  renderGridPacket(this, context, area, false, commands);
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
    gridDevice(this, area, false).blit(context, layer.canvas, width, height);
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
  const commands: RenderCommand[] = [];
  const targetLines = this.getSession().targetLineIndices;
  const [firstPanel, lastPanel] = this.viewport.visiblePanelRange(width, area);
  for (let panel = firstPanel; panel <= lastPanel; panel++) {
    const lineIndex = targetLines[panel];
    if (lineIndex === undefined) {
      continue;
    }
    const left = panel * stride - offset;
    commands.push({
      kind: "text",
      text: String(lineIndex),
      x: left + 6,
      y: LINE_LABEL_BASELINE,
      font: canvasFont("caption"),
      color: palette.bottomValue,
      align: "left",
      alpha: 1,
    });
  }
  renderGridPacket(this, context, area, false, commands, {
    left: 0,
    top: 0,
    width,
    height,
  });
}
