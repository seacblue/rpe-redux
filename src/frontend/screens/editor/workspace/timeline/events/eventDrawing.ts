/**
 * Draws the event field: backdrop grid and columns, event bars, curves, selection
 * and overlap tints, and multi-line chrome.
 *
 * It owns painting and per-pass culling; event lookup, drag deltas, and viewport
 * projection come from core, the cache, and the viewport.
 */
/* eslint-disable max-lines -- single and multi-line event passes share one GPU fallback contract. */
import { beatValue } from "../../../../../../core/global/chart/timing/beat.ts";
import { eventList, eventListAt } from "../../../../../../core/edit/events/eventTracks.ts";
import { t } from "../../../../../../i18n/index.ts";
import { context2d, prepareCanvas } from "../../../canvas/canvas2d.ts";
import { CANVAS_FONT_FAMILY, canvasFont, canvasTypePx } from "../../../canvas/text.ts";
import { extendedLabels, noiseTrackLabels, trackLabels } from "../drawing/canvas.ts";
import { noiseLineSettings } from "../../../../../../core/global/chart/noise/noiseLine.ts";
import { NOISE_ACTIVE_EVENTS } from "../../../../../../core/edit/events/eventTracks.ts";
import { BACKGROUND_GRID, FOREGROUND_GRID, strokeVerticalGrid } from "../drawing/gridDrawing.ts";
import { eventLayerOf } from "../../../../../../core/edit/timeline/model.ts";
import { eventColumnBoundary } from "../../../../../../core/edit/timeline/timelineCoordinates.ts";
import type {
  TimelineEventLayer,
  TimelineEventRect,
} from "../../../../../../core/edit/timeline/types.ts";
import type { JudgeLineEvent } from "../../../../../../core/global/chart/chart.ts";
import type { EventChain } from "../../../../../../core/edit/timeline/eventChains.ts";
import type { TimelineEventDrawingReceiver } from "../drawing/timelineReceiver.ts";
import { readCanvasPalette, type CanvasPalette } from "../../../canvas/palette.ts";
import type { TimelineOverlayBatch } from "../../../canvas/timelineOverlayBatch.ts";
import { multiLineLineOpacity } from "../multiLine/multiLinePresentation.ts";
import { drawEventCurves, eventCurveStroke } from "./eventCurve.ts";
import { drawEventOverlapFilter, drawEventSelectionOverlay } from "./eventSelectionDrawing.ts";
import {
  drawEventBar,
  drawMultiLineEventChrome,
  eventBarOpacity,
  multiLineChromeKey,
  createVerticalAtBeat,
} from "./eventRenderCache.ts";
import {
  createEventLabelScratch,
  labelGroupsFromEntries,
  shouldDrawEventCurves,
  type EventLabelScratch,
} from "./eventLabelLayout.ts";
import { drawTrajectory } from "./eventOverlayDrawing.ts";
import { drawEventText } from "./eventTextDrawing.ts";
type EventBarRectangle = Pick<TimelineEventRect, "x" | "y" | "width" | "height">;

interface EventCurveEntry {
  event: JudgeLineEvent;
  range: EventChain<JudgeLineEvent>;
  startY: number;
  endY: number;
}

const EMPTY_EVENTS: readonly JudgeLineEvent[] = [];
const EMPTY_SELECTION = new Set<string>();
const EMPTY_SELECTED_INDEXES = new Set<number>();

/** Decode canonical event-selection keys once before scanning one track. */
export function selectedEventIndexesForType(
  selection: ReadonlySet<string>,
  type: string,
): ReadonlySet<number> {
  if (!selection.size) {
    return EMPTY_SELECTED_INDEXES;
  }
  const prefix = `${type}:`;
  const indexes = new Set<number>();
  for (const key of selection) {
    if (!key.startsWith(prefix)) {
      continue;
    }
    const indexText = key.slice(prefix.length);
    if (/^(?:0|[1-9]\d*)$/.test(indexText)) {
      indexes.add(Number(indexText));
    }
  }
  return indexes;
}

/** Resolve the event viewport range once because eventBeatAt is type-independent. */
export function eventBeatRangeForTypes(
  viewport: Pick<TimelineEventDrawingReceiver["viewport"], "eventBeatAt">,
  height: number,
  eventTypes: readonly string[],
): [number, number] {
  if (!eventTypes.length) {
    return [0, 0];
  }
  const type = eventTypes[0] ?? "";
  return [viewport.eventBeatAt(height, type), viewport.eventBeatAt(0, type)];
}

/** Format an event start/end value for the value labels. */
function formatEventValue(value: unknown): string {
  if (typeof value === "number") {
    return value.toFixed(2);
  }
  if (Array.isArray(value)) {
    return value.join(",");
  }
  return String(value ?? "");
}

/** One selected event's projected values, ready for the always-visible label pass. */
interface SelectedEventValue {
  readonly start: unknown;
  readonly end: unknown;
  readonly top: number;
  readonly bottom: number;
}

interface EventDrawingScratch {
  readonly selectedRectangles: EventBarRectangle[];
  readonly remoteSelectedRectangles: EventBarRectangle[];
  readonly selectedValues: SelectedEventValue[];
  readonly curveEntriesBySelection: [EventCurveEntry[], EventCurveEntry[]];
  readonly selectedIndexesBySelection: Map<ReadonlySet<string>, Map<string, ReadonlySet<number>>>;
  readonly labelScratch: EventLabelScratch;
}

const eventDrawingScratch = new WeakMap<object, EventDrawingScratch>();

/** Retain per-receiver event work lists and value objects across drawing frames. */
function scratchFor(receiver: object): EventDrawingScratch {
  const existing = eventDrawingScratch.get(receiver);
  if (existing) {
    return existing;
  }
  const created: EventDrawingScratch = {
    selectedRectangles: [],
    remoteSelectedRectangles: [],
    selectedValues: [],
    curveEntriesBySelection: [[], []],
    selectedIndexesBySelection: new Map(),
    labelScratch: createEventLabelScratch(),
  };
  eventDrawingScratch.set(receiver, created);
  return created;
}

/** Decode one selection/type pair at most once during a synchronous draw. */
function selectedIndexesForChannel(
  cache: Map<ReadonlySet<string>, Map<string, ReadonlySet<number>>>,
  selection: ReadonlySet<string>,
  type: string,
): ReadonlySet<number> {
  let byType = cache.get(selection);
  if (!byType) {
    byType = new Map();
    cache.set(selection, byType);
  }
  const cached = byType.get(type);
  if (cached) {
    return cached;
  }
  const indexes = selectedEventIndexesForType(selection, type);
  byType.set(type, indexes);
  return indexes;
}

/** Clear the lists consumed by one event channel without releasing their capacity. */
function resetChannelScratch(scratch: EventDrawingScratch): void {
  scratch.selectedRectangles.length = 0;
  scratch.remoteSelectedRectangles.length = 0;
  scratch.selectedValues.length = 0;
  scratch.curveEntriesBySelection[0].length = 0;
  scratch.curveEntriesBySelection[1].length = 0;
}

/**
 * Paint start and end values for selected events regardless of column width.
 *
 * The ordinary value pass is budgeted by track width and label spacing, so a
 * narrow inspector layout can hide the event being edited. A selected event
 * keeps a surface chip at both anchors; this pass deliberately ignores the
 * label budget so the values follow the selection into every inspector.
 *
 * Both renderers share the chip geometry: the Canvas2D branch measures and fills
 * one chip, the overlay branch queues the same chip into the retained texture.
 */
function drawSelectedEventValues(
  context: CanvasRenderingContext2D,
  batch: TimelineOverlayBatch | null,
  values: readonly SelectedEventValue[],
  centerX: number,
  width: number,
  height: number,
  palette: CanvasPalette,
  font: string,
  opacity = 1,
): void {
  if (!values.length || width <= 8) {
    return;
  }
  const availableWidth = Math.max(12, width - 4);
  if (!batch) {
    context.save();
    context.font = font;
    context.textAlign = "center";
    context.globalAlpha = opacity;
  }
  for (const value of values) {
    if (value.bottom - value.top <= 26 || value.bottom < 0 || value.top > height) {
      continue;
    }
    const top = Math.max(36, value.top + 13);
    const bottom = Math.min(height - 5, value.bottom - 5);
    if (batch) {
      batch.addTextChip(
        formatEventValue(value.end),
        centerX,
        top,
        availableWidth,
        font,
        palette.foreground,
        palette.surface,
        opacity,
      );
      batch.addTextChip(
        formatEventValue(value.start),
        centerX,
        bottom,
        availableWidth,
        font,
        palette.foreground,
        palette.surface,
        opacity,
      );
      continue;
    }
    for (const [text, y] of [
      [formatEventValue(value.end), top],
      [formatEventValue(value.start), bottom],
    ] as const) {
      // Keep the chip tight to the printed value; a full-column bar would read
      // as a second event bar behind every selected anchor.
      const chipWidth = Math.min(
        availableWidth,
        Math.max(12, Math.ceil(context.measureText(text).width) + 8),
      );
      context.fillStyle = palette.surface;
      context.fillRect(centerX - chipWidth / 2, y - 11, chipWidth, 14);
      context.fillStyle = palette.foreground;
      context.fillText(text, centerX, y, chipWidth - 6);
    }
  }
  if (!batch) {
    context.restore();
  }
}

/** Draw the event field for the current mode: grid, bars, curves, labels, and gestures. */
export function drawEvents(this: TimelineEventDrawingReceiver, playBeat: number): void {
  this.gestures.beginEventRectFrame();
  const palette = this.cache.palette() ?? readCanvasPalette();
  const { context, width, height } = prepareCanvas(this.eventsCanvas);
  const overlayActive = this.eventOverlayBatch.begin(width, height);
  const overlayBatch = overlayActive ? this.eventOverlayBatch : null;
  this.viewport.syncMultiLineChrome("events", width);
  const session = this.getSession();
  const scratch = scratchFor(this);
  scratch.selectedIndexesBySelection.clear();
  const overlapSelectionSuppressed = this.gestures.overlapMenuOpen;
  const multiEvents = session.eventsMode === "multi";
  // The event backdrop holds the beat grid and the panel/channel separators.
  // Both are projected from the live origin, so they are rebuilt every frame
  // rather than translated as a cached bitmap.
  const backdrop = prepareCanvas(this.eventsBackdrop);
  const factor = this.viewport.factor;
  const verticalAt = createVerticalAtBeat(this, factor, height);
  // Multi-line event bars are a time-dependent GPU batch and are submitted on
  // every frame; the visible event range bounds the instance count.
  // The header strip is a Canvas2D layer whose labels stay in the strip. The
  // WebGL overlay clears its label batch and texture every frame, so overlay
  // chrome is painted into the live context and batched again on each frame
  // instead of being cached.
  const chrome =
    multiEvents && !overlayActive
      ? this.cache.canvasLayer(
          this.eventsCanvas,
          multiLineChromeKey(this, session, width, height, palette),
          width,
          23,
        )
      : undefined;
  if (chrome?.repaint) {
    drawMultiLineEventChrome(this, chrome.context, width);
  }
  const repaintBatch = this.eventBatch.begin(
    width,
    height,
    this.appearance.skin,
    eventBarOpacity(this.appearance.eventOpacity),
  );
  if (multiEvents) {
    if (this.viewport.panelCount("events") > 1) {
      const panelWidth = this.viewport.panelWidth(width, "events");
      const gap = this.viewport.panelGap(width, "events");
      const offset = this.viewport.multiLineViewportOffset(width, "events");
      context.save();
      context.fillStyle = palette.gridMinor;
      context.globalAlpha = 0.35;
      const panelCount = this.viewport.panelCount("events");
      const [firstPanel, lastPanel] = this.viewport.visiblePanelRange(width, "events");
      const firstGap = Math.max(0, firstPanel - 1);
      const lastGap = Math.min(panelCount - 2, lastPanel);
      for (let panel = firstGap; panel <= lastGap; panel++) {
        context.fillRect(panel * (panelWidth + gap) + panelWidth - offset, 0, gap, height);
      }
      context.restore();
    }
    this.eventsGridBatch.begin(width, height);
    this.drawMultiLineGrid(backdrop.context, width, height, playBeat, "events", BACKGROUND_GRID);
    this.eventsGridBatch.finish();
    this.drawMultiLineGrid(context, width, height, playBeat, "events", FOREGROUND_GRID);
    if (repaintBatch) {
      this.drawMultiLineEvents(playBeat, backdrop.context);
    }
    if (chrome) {
      context.drawImage(chrome.canvas, 0, 0, width, 23);
    } else {
      // Cached chrome is unavailable only when the overlay owns the label
      // batch (or the browser cannot allocate a layer), so repaint straight
      // into the live context and queue the labels for this frame.
      drawMultiLineEventChrome(this, context, width, overlayBatch ?? undefined);
    }
    this.gestures.eventInteraction.draw(context, width);
    this.drawMultiLineBeatLabels(context, width, height, "events");
    this.drawMultiLinePanelLabels(context, width, height, "events");
    if (repaintBatch) {
      this.eventBatch.finish();
    }
    this.eventOverlayBatch.finish();
    this.gestures.finishEventRectFrame();
    return;
  }
  this.eventsGridBatch.begin(width, height);
  this.grid(backdrop.context, width, height, playBeat, BACKGROUND_GRID, "events");
  this.eventsGridBatch.finish();
  this.grid(context, width, height, playBeat, FOREGROUND_GRID, "events");
  const layer: TimelineEventLayer = this.gestures.extended
    ? { ...session.line?.extended, paintEvents: eventList(session, "paintEvents") }
    : noiseLineSettings(session.line)
      ? {
          ...eventLayerOf(session.line?.eventLayers?.[this.gestures.layer]),
          scaleXEvents: eventList(session, "scaleXEvents"),
          scaleYEvents: eventList(session, "scaleYEvents"),
          [NOISE_ACTIVE_EVENTS]: eventList(session, NOISE_ACTIVE_EVENTS),
        }
      : eventLayerOf(session.line?.eventLayers?.[this.gestures.layer]);
  const indexKey = `${session.lineIndex}:${this.gestures.extended}:${this.gestures.layer}`;
  // Resolve the display columns once. The getter also reads visibility settings
  // and allocates the track list, so calling it from loop bounds multiplies work
  // across every event channel in the frame.
  const eventTypes = this.eventTypes;
  const eventTypeCount = eventTypes.length;
  const cached = this.cache.events(session.chart, indexKey, eventTypes, layer);
  const labels = noiseLineSettings(session.line) ? noiseTrackLabels() : trackLabels();
  const headerLabels = this.gestures.extended ? extendedLabels() : labels;
  backdrop.context.strokeStyle = this.appearance.verticalGridColor;
  const eventInset = this.viewport.eventInset(width);
  const eventBeatRange = eventBeatRangeForTypes(this.viewport, height, eventTypes);
  for (let channel = 1; channel < eventTypeCount; channel++) {
    const x = eventColumnBoundary(channel, width, eventTypeCount, eventInset);
    strokeVerticalGrid(backdrop.context, x, height);
  }
  const firstColumn = eventColumnBoundary(0, width, eventTypeCount, eventInset);
  const lastColumn = eventColumnBoundary(eventTypeCount, width, eventTypeCount, eventInset);
  strokeVerticalGrid(backdrop.context, Math.max(0.5, firstColumn), height);
  strokeVerticalGrid(backdrop.context, Math.min(width - 0.5, lastColumn), height);
  // Reuse per-channel work lists. Their contents are consumed before the next
  // channel starts, so only growth beyond the largest channel remains allocative.
  eventTypes.forEach((type, channel) => {
    resetChannelScratch(scratch);
    const {
      channelWidth,
      left: columnLeft,
      x: barX,
      width: barWidth,
    } = this.viewport.eventColumnBounds(channel, width);
    const horizontal = columnLeft;
    const events = layer[type] ?? EMPTY_EVENTS;
    const entries = this.cache.eventEntries(
      session.chart,
      events,
      eventBeatRange[0],
      eventBeatRange[1],
      this.viewport.gridCount,
    );
    const selectedIndexes = selectedIndexesForChannel(
      scratch.selectedIndexesBySelection,
      session.eventSelection,
      type,
    );
    if (type === "paintEvents") {
      this.drawShaderEvents(context, entries, channel, width, height, selectedIndexes);
      context.fillStyle = palette.headerSurface;
      context.fillRect(horizontal, 0, channelWidth, 23);
      overlayBatch?.addRect(horizontal, 0, channelWidth, 23, palette.headerSurface);
      const shaderLabel = t("editorPanels.timeline.shaderTrack");
      const shaderX = horizontal + channelWidth / 2;
      const shaderWidth = Math.max(8, channelWidth - 8);
      drawEventText(
        context,
        overlayBatch,
        shaderLabel,
        shaderX,
        16,
        shaderWidth,
        canvasFont("caption"),
        palette.foreground,
        "center",
      );
      return;
    }
    const ranges = cached.ranges[channel];
    const drawCurves =
      this.appearance.eventCurvesEnabled !== false && shouldDrawEventCurves(entries.length, height);
    for (const entry of entries) {
      const vertical = verticalAt(entry.end);
      const bottom = verticalAt(entry.start);
      if (bottom < 0 || vertical > height) {
        continue;
      }
      const projected = this.gestures.recordEventRect(
        barX,
        Math.max(0, vertical),
        barWidth,
        Math.max(2, Math.min(height, bottom) - Math.max(0, vertical)),
        entry.index,
        type,
      );
      const selected = selectedIndexes.has(entry.index);
      const hovered = this.gestures.isEventOverlapHovered(session.lineIndex, type, entry.index);
      const highlightSelection = hovered || (!overlapSelectionSuppressed && selected);
      if (highlightSelection) {
        scratch.selectedRectangles.push(projected);
      }
      if (selected) {
        scratch.selectedValues.push({
          start: entry.item.start,
          end: entry.item.end,
          top: vertical,
          bottom,
        });
      }
      if (
        !highlightSelection &&
        !overlapSelectionSuppressed &&
        entry.item.id !== undefined &&
        this.remoteSelectedEventIds.has(entry.item.id)
      ) {
        scratch.remoteSelectedRectangles.push(projected);
      }
      context.globalAlpha = eventBarOpacity(this.appearance.eventOpacity);
      drawEventBar(this, context, projected);
      if (cached.overlaps[channel].has(entry.index) || entry.invalid) {
        drawEventOverlapFilter(context, projected, palette);
      }
      context.globalAlpha = 1;
      if (entry.item.trajectory) {
        drawTrajectory.call(this, context, overlayBatch, projected, entry.item);
      }
      if (
        this.appearance.eventCurvesEnabled !== false &&
        !entry.item.trajectory &&
        (drawCurves || selected) &&
        channelWidth >= (this.appearance.eventCurveThreshold ?? 24)
      ) {
        const range = ranges.get(entry.index);
        if (range) {
          scratch.curveEntriesBySelection[selected ? 1 : 0].push({
            event: entry.item,
            range,
            startY: bottom,
            endY: vertical,
          });
        }
      }
    }
    for (const [selected, curveEntries] of scratch.curveEntriesBySelection.entries()) {
      drawEventCurves(
        context,
        overlayBatch,
        curveEntries,
        { x: barX, y: 0, width: barWidth, height },
        eventCurveStroke(palette, selected === 1),
      );
    }
    drawEventSelectionOverlay(
      context,
      overlayBatch,
      palette,
      scratch.selectedRectangles,
      scratch.remoteSelectedRectangles,
    );
    context.strokeStyle = palette.eventStroke;
    context.lineWidth = 1;
    const valueThreshold = this.appearance.eventValueThreshold ?? 30;
    const valueFontSize = this.appearance.eventValueFontSize ?? canvasTypePx("body");
    const valueFont = `${valueFontSize}px ${CANVAS_FONT_FAMILY}`;
    if (type !== NOISE_ACTIVE_EVENTS && channelWidth >= valueThreshold) {
      const valueGroups = labelGroupsFromEntries(
        entries,
        ranges,
        height,
        (group) => group.entries.some((entry) => selectedIndexes.has(entry.index)),
        (group) => ({
          top: verticalAt(beatValue(group.entries.at(-1)!.event.endTime)),
          bottom: verticalAt(beatValue(group.entries[0]!.event.startTime)),
        }),
        scratch.labelScratch,
      );
      for (const group of valueGroups) {
        const first = group.entries[0].event;
        const lastEntry = group.entries.at(-1);
        if (!lastEntry) {
          continue;
        }
        const last = lastEntry.event;
        const top = verticalAt(beatValue(last.endTime));
        const bottom = verticalAt(beatValue(first.startTime));
        drawEventText(
          context,
          overlayBatch,
          formatEventValue(Number.isFinite(group.max) ? group.max : last.end),
          horizontal + channelWidth / 2,
          Math.max(36, top + 13),
          channelWidth - 12,
          valueFont,
          top < 23 ? palette.topValue : palette.foreground,
          "center",
        );
        if (bottom - top > 26) {
          drawEventText(
            context,
            overlayBatch,
            formatEventValue(Number.isFinite(group.min) ? group.min : first.start),
            horizontal + channelWidth / 2,
            Math.min(height - 5, bottom - 5),
            channelWidth - 12,
            valueFont,
            bottom > height ? palette.bottomValue : palette.foreground,
            "center",
          );
        }
      }
    }
    if (type !== NOISE_ACTIVE_EVENTS) {
      drawSelectedEventValues(
        context,
        overlayBatch,
        scratch.selectedValues,
        horizontal + channelWidth / 2,
        channelWidth,
        height,
        palette,
        valueFont,
      );
    }
    context.fillStyle = palette.headerSurface;
    context.fillRect(horizontal, 0, channelWidth, 23);
    // The easing/curve overlay is a GPU layer above this canvas; queue the same
    // header fill after its curves so easing never covers the column labels.
    overlayBatch?.addRect(horizontal, 0, channelWidth, 23, palette.headerSurface);
    const headerLabel = headerLabels[channel];
    if (headerLabel) {
      drawEventText(
        context,
        overlayBatch,
        headerLabel,
        horizontal + channelWidth / 2,
        16,
        Math.max(8, channelWidth - 8),
        canvasFont("caption"),
        palette.foreground,
        "center",
      );
    }
  });
  // Header fills cover the backdrop's vertical separators. Re-stroke the
  // header portion on the editing canvas so every column edge, including the
  // field's right boundary, stays visible through the header band.
  context.globalAlpha = 1;
  context.lineWidth = 1;
  context.strokeStyle = palette.gridMinor;
  for (let boundary = 0; boundary <= eventTypeCount; boundary += 1) {
    const x = eventColumnBoundary(boundary, width, eventTypeCount, eventInset);
    strokeVerticalGrid(context, Math.max(0.5, Math.min(width - 0.5, x)), 23);
  }
  this.gestures.eventInteraction.draw(context, width);
  this.eventBatch.finish();
  this.eventOverlayBatch.finish();
  this.gestures.finishEventRectFrame();
}

/** Draw all visible multi-line event panels into the live canvas. */
export function drawMultiLineEvents(
  this: TimelineEventDrawingReceiver,
  playBeat: number,
  separators: CanvasRenderingContext2D,
): boolean {
  const scratch = scratchFor(this);
  scratch.selectedIndexesBySelection.clear();
  const palette = this.cache.palette() ?? readCanvasPalette();
  const session = this.getSession();
  const overlapSelectionSuppressed = this.gestures.overlapMenuOpen;
  const context = context2d(this.eventsCanvas);
  const width = this.eventsCanvas.clientWidth;
  const height = this.eventsCanvas.clientHeight;
  this.gestures.beginEventRectFrame();
  const overlayBatch = this.eventOverlayBatch.isActive() ? this.eventOverlayBatch : null;
  const baseValueFontSize = this.appearance.eventValueFontSize ?? 13;
  const lineIndices = session.targetLineIndices;
  const panelWidth = this.viewport.panelWidth(width, "events");
  const eventInset = this.viewport.eventInset(panelWidth);
  const contentWidth = Math.max(1, panelWidth - eventInset * 2);
  const viewportOffset = this.viewport.multiLineViewportOffset(width, "events");
  const panelStride = this.viewport.panelStride(width, "events");
  const [firstPanel, lastPanel] = this.viewport.visiblePanelRange(width, "events");
  for (let panel = firstPanel; panel <= lastPanel; panel++) {
    const lineIndex = lineIndices[panel];
    if (lineIndex === undefined) {
      continue;
    }
    const eventTypes = this.viewport.eventTypesForLine(lineIndex);
    const channelWidth = eventTypes.length ? contentWidth / eventTypes.length : 0;
    const barWidth =
      channelWidth * Math.max(0.35, Math.min(1, this.appearance.eventBarWidth ?? 0.82));
    const lineOpacity = multiLineLineOpacity(
      lineIndex,
      session.lineIndex,
      this.appearance.multiLineNonCurrentOpacity,
    );
    const lineFactor = this.viewport.factorForLine(lineIndex);
    const verticalAt = createVerticalAtBeat(this, lineFactor, height);
    const eventBeatRange = this.viewport.beatRangeForLine(lineIndex, height);
    const offset = panel * panelStride - viewportOffset + eventInset;
    const contentRight = offset + channelWidth * eventTypes.length;
    const layer: TimelineEventLayer = this.gestures.extended
      ? {
          ...(session.chart.judgeLineList?.[lineIndex]?.extended ?? {}),
          paintEvents: eventListAt(session, lineIndex, "paintEvents"),
        }
      : noiseLineSettings(session.chart.judgeLineList?.[lineIndex])
        ? {
            ...eventLayerOf(
              session.chart.judgeLineList?.[lineIndex]?.eventLayers?.[this.gestures.layer],
            ),
            scaleXEvents: eventListAt(session, lineIndex, "scaleXEvents"),
            scaleYEvents: eventListAt(session, lineIndex, "scaleYEvents"),
            [NOISE_ACTIVE_EVENTS]: eventListAt(session, lineIndex, NOISE_ACTIVE_EVENTS),
          }
        : eventLayerOf(
            session.chart.judgeLineList?.[lineIndex]?.eventLayers?.[this.gestures.layer],
          );
    if (!eventTypes.length) {
      // Every ordinary track is hidden. Keep the panel edges so the field still
      // reads as one empty multi-line panel instead of an unclipped void.
      separators.strokeStyle = this.appearance.verticalGridColor;
      strokeVerticalGrid(separators, Math.max(0.5, offset), height);
      strokeVerticalGrid(separators, Math.min(width - 0.5, offset + contentWidth), height);
    }
    const lineSelection =
      session.multiEventSelection?.get(lineIndex) ??
      (lineIndex === session.lineIndex ? session.eventSelection : EMPTY_SELECTION);
    eventTypes.forEach((type, channel) => {
      resetChannelScratch(scratch);
      context.globalAlpha = lineOpacity;
      const barX = offset + channel * channelWidth + (channelWidth - barWidth) / 2;
      separators.strokeStyle = this.appearance.verticalGridColor;
      if (channel === 0) {
        strokeVerticalGrid(separators, Math.max(0.5, offset), height);
        strokeVerticalGrid(separators, Math.min(width - 0.5, contentRight), height);
      }
      strokeVerticalGrid(separators, offset + channel * channelWidth, height);
      const events = layer[type] ?? EMPTY_EVENTS;
      const display = this.cache.eventDisplay(session.chart, events);
      const { ranges } = display;
      const entries = this.cache.eventEntries(
        session.chart,
        events,
        eventBeatRange[0],
        eventBeatRange[1],
        this.viewport.gridCount,
      );
      const selectedIndexes = selectedIndexesForChannel(
        scratch.selectedIndexesBySelection,
        lineSelection,
        type,
      );
      const drawCurves =
        this.appearance.eventCurvesEnabled !== false &&
        shouldDrawEventCurves(entries.length, height);
      for (const { index, item: event, start, end, invalid } of entries) {
        const top = verticalAt(end);
        const bottom = verticalAt(start);
        if (bottom < 23 || top > height) {
          continue;
        }
        const projected = this.gestures.recordEventRect(
          barX,
          Math.max(23, top),
          barWidth,
          Math.max(2, Math.min(height, bottom) - Math.max(23, top)),
          index,
          type,
          lineIndex,
        );
        const selected = selectedIndexes.has(index);
        const hovered = this.gestures.isEventOverlapHovered(lineIndex, type, index);
        const highlightSelection = hovered || (!overlapSelectionSuppressed && selected);
        if (highlightSelection) {
          scratch.selectedRectangles.push(projected);
        }
        if (selected && type !== "paintEvents") {
          scratch.selectedValues.push({ start: event.start, end: event.end, top, bottom });
        }
        if (
          !highlightSelection &&
          !overlapSelectionSuppressed &&
          event.id !== undefined &&
          this.remoteSelectedEventIds.has(event.id)
        ) {
          scratch.remoteSelectedRectangles.push(projected);
        }
        context.globalAlpha = eventBarOpacity(this.appearance.eventOpacity, lineOpacity);
        drawEventBar(this, context, projected, lineOpacity);
        if (display.overlaps.has(index) || invalid) {
          drawEventOverlapFilter(context, projected, palette);
        }
        context.globalAlpha = lineOpacity;
        if (event.trajectory) {
          drawTrajectory.call(this, context, overlayBatch, projected, event, lineOpacity);
        }
        if (
          this.appearance.eventCurvesEnabled !== false &&
          !event.trajectory &&
          type !== "paintEvents" &&
          (drawCurves || selected) &&
          channelWidth >= (this.appearance.eventCurveThreshold ?? 24)
        ) {
          const group = ranges.get(index);
          if (group) {
            scratch.curveEntriesBySelection[selected ? 1 : 0].push({
              event,
              range: group,
              startY: bottom,
              endY: top,
            });
          }
        }
      }
      context.globalAlpha = lineOpacity;
      drawEventSelectionOverlay(
        context,
        overlayBatch,
        palette,
        scratch.selectedRectangles,
        scratch.remoteSelectedRectangles,
        lineOpacity,
      );
      context.strokeStyle = palette.eventStroke;
      for (const [selected, curveEntries] of scratch.curveEntriesBySelection.entries()) {
        drawEventCurves(
          context,
          overlayBatch,
          curveEntries,
          { x: barX, y: 23, width: barWidth, height: Math.max(2, height - 23) },
          eventCurveStroke(palette, selected === 1),
          { steps: 24, padding: 4, lineWidth: 1.5, drawConstant: true },
          lineOpacity,
        );
      }
      const valueThreshold = this.appearance.eventValueThreshold ?? 30;
      const valueFontSize =
        channelWidth >= valueThreshold * 2.4
          ? baseValueFontSize
          : channelWidth >= valueThreshold * 1.7
            ? Math.min(baseValueFontSize, 11)
            : channelWidth >= valueThreshold * 1.2
              ? Math.min(baseValueFontSize, 9)
              : channelWidth >= valueThreshold
                ? Math.min(baseValueFontSize, 8)
                : 0;
      if (type !== "paintEvents" && valueFontSize > 0) {
        const valueGroups = labelGroupsFromEntries(
          entries,
          ranges,
          height,
          (group) => group.entries.some((entry) => selectedIndexes.has(entry.index)),
          (group) => ({
            top: verticalAt(beatValue(group.entries.at(-1)!.event.endTime)),
            bottom: verticalAt(beatValue(group.entries[0]!.event.startTime)),
          }),
          scratch.labelScratch,
        );
        const centerX = offset + channel * channelWidth + channelWidth / 2;
        const maxWidth = Math.max(10, channelWidth - 8);
        const font = `${valueFontSize}px ${CANVAS_FONT_FAMILY}`;
        for (const group of valueGroups) {
          const first = group.entries[0].event;
          const lastEntry = group.entries.at(-1);
          if (!lastEntry) {
            continue;
          }
          const last = lastEntry.event;
          const top = verticalAt(beatValue(last.endTime));
          const bottom = verticalAt(beatValue(first.startTime));
          drawEventText(
            context,
            overlayBatch,
            formatEventValue(Number.isFinite(group.max) ? group.max : last.end),
            centerX,
            Math.max(37, top + 13),
            maxWidth,
            font,
            palette.foreground,
            "center",
            lineOpacity,
          );
          if (bottom - top > 26) {
            drawEventText(
              context,
              overlayBatch,
              formatEventValue(Number.isFinite(group.min) ? group.min : first.start),
              centerX,
              Math.min(height - 5, bottom - 5),
              maxWidth,
              font,
              palette.foreground,
              "center",
              lineOpacity,
            );
          }
        }
      }
      if (type !== "paintEvents" && type !== NOISE_ACTIVE_EVENTS) {
        drawSelectedEventValues(
          context,
          overlayBatch,
          scratch.selectedValues,
          offset + channel * channelWidth + channelWidth / 2,
          channelWidth,
          height,
          palette,
          `${Math.max(8, valueFontSize || Math.min(baseValueFontSize, 10))}px ${CANVAS_FONT_FAMILY}`,
          lineOpacity,
        );
      }
    });
    context.globalAlpha = 1;
    if (this.viewport.panelCount("events") > 1) {
      separators.strokeStyle = palette.outline;
      separators.lineWidth = 2;
      separators.beginPath();
      separators.moveTo(offset + panelWidth, 0);
      separators.lineTo(offset + panelWidth, height);
      separators.stroke();
      separators.lineWidth = 1;
    }
  }
  context.globalAlpha = 1;
  context.lineWidth = 1;
  return true;
}
