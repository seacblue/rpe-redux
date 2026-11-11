/**
 * Draws the event field: backdrop grid and columns, event bars, curves, selection
 * and overlap tints, and multi-line chrome.
 *
 * It owns painting and per-pass culling; event lookup, drag deltas, and viewport
 * projection come from core, the cache, and the viewport.
 */
import { beatValue } from "../../../../../../core/global/chart/timing/beat.ts";
import {
  eventKey,
  eventList,
  eventListAt,
} from "../../../../../../core/edit/events/eventTracks.ts";
import { t } from "../../../../../../i18n/index.ts";
import { context2d, prepareCanvas } from "../../../canvas/canvas2d.ts";
import { CANVAS_FONT_FAMILY, canvasFont, canvasTypePx } from "../../../canvas/text.ts";
import { extendedLabels, noiseTrackLabels, trackLabels } from "../drawing/canvas.ts";
import { noiseLineSettings } from "../../../../../../core/global/chart/noise/noiseLine.ts";
import { NOISE_ACTIVE_EVENTS } from "../../../../../../core/edit/events/eventTracks.ts";
import { BACKGROUND_GRID, FOREGROUND_GRID, strokeVerticalGrid } from "../drawing/gridDrawing.ts";
import { eventLayerOf, hasNonPositiveRange } from "../../../../../../core/edit/timeline/model.ts";
import { eventColumnBoundary } from "../../../../../../core/edit/timeline/timelineCoordinates.ts";
import type {
  TimelineEventLayer,
  TimelineEventRect,
} from "../../../../../../core/edit/timeline/types.ts";
import type { JudgeLineEvent } from "../../../../../../core/global/chart/chart.ts";
import type { EventChain } from "../../../../../../core/edit/timeline/eventChains.ts";
import type { TimelineEventDrawingReceiver } from "../drawing/timelineReceiver.ts";
import { readCanvasPalette, type CanvasPalette } from "../../../canvas/palette.ts";
import { multiLineLineOpacity } from "../multiLine/multiLinePresentation.ts";
import { drawEventCurve, drawEventCurveBatch, eventCurveStroke } from "./eventCurve.ts";
import {
  drawEventOverlapFilter,
  drawEventSelectionFilters,
  drawRemoteEventSelectionFilters,
} from "./eventSelectionDrawing.ts";
import {
  drawEventBar,
  drawMultiLineEventChrome,
  eventBarOpacity,
  multiLineChromeKey,
  verticalAtBeat,
} from "./eventRenderCache.ts";
import { labelGroups, shouldDrawEventCurves } from "./eventLabelLayout.ts";
type EventBarRectangle = Pick<TimelineEventRect, "x" | "y" | "width" | "height">;
const EMPTY_EVENTS: readonly JudgeLineEvent[] = [];
const EMPTY_SELECTION = new Set<string>();

/** One selected event's projected values, ready for the always-visible label pass. */
interface SelectedEventValue {
  readonly start: unknown;
  readonly end: unknown;
  readonly top: number;
  readonly bottom: number;
}

/**
 * Paint start and end values for selected events regardless of column width.
 *
 * The ordinary value pass is budgeted by track width and label spacing, so a
 * narrow inspector layout can hide the event being edited. A selected event
 * keeps a surface chip at both anchors; this pass deliberately ignores the
 * label budget so the values follow the selection into every inspector.
 */
function drawSelectedEventValues(
  context: CanvasRenderingContext2D,
  values: readonly SelectedEventValue[],
  centerX: number,
  width: number,
  height: number,
  palette: CanvasPalette,
  font: string,
  format: (value: unknown) => string,
  opacity = 1,
): void {
  if (!values.length || width <= 8) {
    return;
  }
  const availableWidth = Math.max(12, width - 4);
  context.save();
  context.font = font;
  context.textAlign = "center";
  context.globalAlpha = opacity;
  for (const value of values) {
    if (value.bottom - value.top <= 26 || value.bottom < 0 || value.top > height) {
      continue;
    }
    const top = Math.max(36, value.top + 13);
    const bottom = Math.min(height - 5, value.bottom - 5);
    for (const [text, y] of [
      [format(value.end), top],
      [format(value.start), bottom],
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
  context.restore();
}

/** Draw the event field for the current mode: grid, bars, curves, labels, and gestures. */
export function drawEvents(this: TimelineEventDrawingReceiver, playBeat: number): void {
  const palette = this.cache.palette() ?? readCanvasPalette();
  const { context, width, height } = prepareCanvas(this.eventsCanvas);
  this.viewport.syncMultiLineChrome("events", width);
  const session = this.getSession();
  const overlapSelectionSuppressed = this.gestures.overlapMenuOpen;
  const multiEvents = session.eventsMode === "multi";
  // The event backdrop holds the beat grid and the panel/channel separators.
  // Both are projected from the live origin, so they are rebuilt every frame
  // rather than translated as a cached bitmap.
  const backdrop = prepareCanvas(this.eventsBackdrop);
  const factor = this.viewport.factor;
  const verticalAt = (beat: number) => verticalAtBeat(this, beat, factor, height);
  // Multi-line event bars are a time-dependent GPU batch and are submitted on
  // every frame; the visible event range bounds the instance count.
  const chrome = multiEvents
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
    this.drawMultiLineGrid(backdrop.context, width, height, playBeat, "events", BACKGROUND_GRID);
    this.drawMultiLineGrid(context, width, height, playBeat, "events", FOREGROUND_GRID);
    if (repaintBatch) {
      this.drawMultiLineEvents(playBeat, backdrop.context);
    }
    if (chrome) {
      context.drawImage(chrome.canvas, 0, 0, width, 23);
    }
    this.gestures.eventInteraction.draw(context, width);
    this.drawMultiLineBeatLabels(context, width, height, "events");
    this.drawMultiLinePanelLabels(context, width, height, "events");
    if (repaintBatch) {
      this.eventBatch.finish();
    }
    return;
  }
  this.grid(backdrop.context, width, height, playBeat, BACKGROUND_GRID, "events");
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
  const cached = this.cache.events(session.chart, indexKey, this.eventTypes, layer);
  this.gestures.eventRects = [];
  const labels = noiseLineSettings(session.line) ? noiseTrackLabels() : trackLabels();
  backdrop.context.strokeStyle = this.appearance.verticalGridColor;
  const eventInset = this.viewport.eventInset(width);
  for (let channel = 1; channel < this.eventTypes.length; channel++) {
    const x = eventColumnBoundary(channel, width, this.eventTypes.length, eventInset);
    strokeVerticalGrid(backdrop.context, x, height);
  }
  const firstColumn = eventColumnBoundary(0, width, this.eventTypes.length, eventInset);
  const lastColumn = eventColumnBoundary(
    this.eventTypes.length,
    width,
    this.eventTypes.length,
    eventInset,
  );
  strokeVerticalGrid(backdrop.context, Math.max(0.5, firstColumn), height);
  strokeVerticalGrid(backdrop.context, Math.min(width - 0.5, lastColumn), height);
  this.eventTypes.forEach((type, channel) => {
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
      this.viewport.eventBeatAt(height, type),
      this.viewport.eventBeatAt(0, type),
      this.viewport.gridCount,
    );
    if (type === "paintEvents") {
      this.drawShaderEvents(context, entries, channel, width, height);
      context.fillStyle = palette.headerSurface;
      context.fillRect(horizontal, 0, channelWidth, 23);
      context.fillStyle = palette.foreground;
      context.font = canvasFont("caption");
      context.textAlign = "center";
      context.fillText(
        t("editorPanels.timeline.shaderTrack"),
        horizontal + channelWidth / 2,
        16,
        Math.max(8, channelWidth - 8),
      );
      context.textAlign = "left";
      return;
    }
    const ranges = cached.ranges[channel];
    const selectedRectangles: EventBarRectangle[] = [];
    const remoteSelectedRectangles: EventBarRectangle[] = [];
    const selectedValues: SelectedEventValue[] = [];
    const drawCurves =
      this.appearance.eventCurvesEnabled !== false && shouldDrawEventCurves(entries.length, height);
    for (const entry of entries) {
      const vertical = verticalAt(entry.end);
      const bottom = verticalAt(entry.start);
      if (bottom < 0 || vertical > height) {
        continue;
      }
      const rectangle = {
        x: barX,
        y: Math.max(0, vertical),
        width: barWidth,
        height: Math.max(2, Math.min(height, bottom) - Math.max(0, vertical)),
        index: entry.index,
        type,
      };
      this.gestures.eventRects.push(rectangle);
      const selected = this.getSession().eventSelection.has(eventKey(type, entry.index));
      const hovered = this.gestures.isEventOverlapHovered(
        this.getSession().lineIndex,
        type,
        entry.index,
      );
      const highlightSelection = hovered || (!overlapSelectionSuppressed && selected);
      if (highlightSelection) {
        selectedRectangles.push(rectangle);
      }
      if (selected) {
        selectedValues.push({
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
        remoteSelectedRectangles.push(rectangle);
      }
      context.globalAlpha = eventBarOpacity(this.appearance.eventOpacity);
      drawEventBar(this, context, rectangle);
      if (
        cached.overlaps[channel].has(entry.index) ||
        hasNonPositiveRange(entry.item.startTime, entry.item.endTime)
      ) {
        drawEventOverlapFilter(context, rectangle, palette);
      }
      context.globalAlpha = 1;
      if (entry.item.trajectory) {
        this.drawTrajectoryEvent(context, rectangle, entry.item);
      }
      if (
        this.appearance.eventCurvesEnabled !== false &&
        !entry.item.trajectory &&
        (drawCurves || selected) &&
        channelWidth >= (this.appearance.eventCurveThreshold ?? 24)
      ) {
        context.strokeStyle = eventCurveStroke(palette, selected);
        drawEventCurve(context, entry.item, ranges.get(entry.index), rectangle, bottom, vertical);
      }
    }
    drawEventSelectionFilters(context, selectedRectangles);
    drawRemoteEventSelectionFilters(context, remoteSelectedRectangles, palette);
    context.strokeStyle = palette.eventStroke;
    context.lineWidth = 1;
    const formatValue = (value: unknown) =>
      typeof value === "number"
        ? value.toFixed(2)
        : Array.isArray(value)
          ? value.join(",")
          : String(value);
    const valueThreshold = this.appearance.eventValueThreshold ?? 30;
    if (type !== NOISE_ACTIVE_EVENTS && channelWidth >= valueThreshold) {
      context.font = `${this.appearance.eventValueFontSize ?? canvasTypePx("body")}px ${CANVAS_FONT_FAMILY}`;
      const valueGroups = labelGroups(
        entries.map((entry) => ranges.get(entry.index)),
        height,
        (group) =>
          group.entries.some((entry) =>
            this.getSession().eventSelection.has(eventKey(type, entry.index)),
          ),
        (group) => ({
          top: verticalAt(beatValue(group.entries.at(-1)!.event.endTime)),
          bottom: verticalAt(beatValue(group.entries[0]!.event.startTime)),
        }),
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
        context.fillStyle = top < 23 ? palette.topValue : palette.foreground;
        context.textAlign = "center";
        context.fillText(
          formatValue(Number.isFinite(group.max) ? group.max : last.end),
          horizontal + channelWidth / 2,
          Math.max(36, top + 13),
          channelWidth - 12,
        );
        context.fillStyle = bottom > height ? palette.bottomValue : palette.foreground;
        if (bottom - top > 26) {
          context.fillText(
            formatValue(Number.isFinite(group.min) ? group.min : first.start),
            horizontal + channelWidth / 2,
            Math.min(height - 5, bottom - 5),
            channelWidth - 12,
          );
        }
        context.textAlign = "left";
      }
    }
    if (type !== NOISE_ACTIVE_EVENTS) {
      drawSelectedEventValues(
        context,
        selectedValues,
        horizontal + channelWidth / 2,
        channelWidth,
        height,
        palette,
        `${this.appearance.eventValueFontSize ?? canvasTypePx("body")}px ${CANVAS_FONT_FAMILY}`,
        formatValue,
      );
    }
    context.fillStyle = palette.headerSurface;
    context.fillRect(horizontal, 0, channelWidth, 23);
    context.fillStyle = palette.foreground;
    context.textAlign = "center";
    context.fillText(
      (this.gestures.extended ? extendedLabels() : labels)[channel],
      horizontal + channelWidth / 2,
      16,
      Math.max(8, channelWidth - 8),
    );
    context.textAlign = "left";
  });
  // Header fills cover the backdrop's vertical separators. Re-stroke the
  // header portion on the editing canvas so every column edge, including the
  // field's right boundary, stays visible through the header band.
  context.globalAlpha = 1;
  context.lineWidth = 1;
  context.strokeStyle = palette.gridMinor;
  for (let boundary = 0; boundary <= this.eventTypes.length; boundary += 1) {
    const x = eventColumnBoundary(boundary, width, this.eventTypes.length, eventInset);
    strokeVerticalGrid(context, Math.max(0.5, Math.min(width - 0.5, x)), 23);
  }
  this.gestures.eventInteraction.draw(context, width);
  this.eventBatch.finish();
}

/** Draw all visible multi-line event panels into the live canvas. */
export function drawMultiLineEvents(
  this: TimelineEventDrawingReceiver,
  playBeat: number,
  separators: CanvasRenderingContext2D,
): boolean {
  const palette = this.cache.palette() ?? readCanvasPalette();
  const session = this.getSession();
  const overlapSelectionSuppressed = this.gestures.overlapMenuOpen;
  const context = context2d(this.eventsCanvas);
  const width = this.eventsCanvas.clientWidth;
  const height = this.eventsCanvas.clientHeight;
  this.gestures.eventRects = [];
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
    const verticalAt = (beat: number) => verticalAtBeat(this, beat, lineFactor, height);
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
    eventTypes.forEach((type, channel) => {
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
      const [bottomBeat, topBeat] = this.viewport.beatRangeForLine(lineIndex, height);
      const entries = this.cache.eventEntries(
        session.chart,
        events,
        bottomBeat,
        topBeat,
        this.viewport.gridCount,
      );
      const selectedRectangles: EventBarRectangle[] = [];
      const remoteSelectedRectangles: EventBarRectangle[] = [];
      const selectedValues: SelectedEventValue[] = [];
      const lineSelection =
        session.multiEventSelection?.get(lineIndex) ??
        (lineIndex === session.lineIndex ? session.eventSelection : EMPTY_SELECTION);
      const drawCurves =
        this.appearance.eventCurvesEnabled !== false &&
        shouldDrawEventCurves(entries.length, height);
      const curveEntriesBySelection: [
        Array<{
          event: JudgeLineEvent;
          range: EventChain<JudgeLineEvent>;
          startY: number;
          endY: number;
        }>,
        Array<{
          event: JudgeLineEvent;
          range: EventChain<JudgeLineEvent>;
          startY: number;
          endY: number;
        }>,
      ] = [[], []];
      for (const { index, item: event, start, end } of entries) {
        const top = verticalAt(end);
        const bottom = verticalAt(start);
        if (bottom < 23 || top > height) {
          continue;
        }
        const rectangle = {
          x: barX,
          y: Math.max(23, top),
          width: barWidth,
          height: Math.max(2, Math.min(height, bottom) - Math.max(23, top)),
          index,
          type,
          lineIndex,
        };
        this.gestures.eventRects.push(rectangle);
        const selected = lineSelection.has(eventKey(type, index));
        const hovered = this.gestures.isEventOverlapHovered(lineIndex, type, index);
        const highlightSelection = hovered || (!overlapSelectionSuppressed && selected);
        if (highlightSelection) {
          selectedRectangles.push(rectangle);
        }
        if (selected && type !== "paintEvents") {
          selectedValues.push({ start: event.start, end: event.end, top, bottom });
        }
        if (
          !highlightSelection &&
          !overlapSelectionSuppressed &&
          event.id !== undefined &&
          this.remoteSelectedEventIds.has(event.id)
        ) {
          remoteSelectedRectangles.push(rectangle);
        }
        context.globalAlpha = eventBarOpacity(this.appearance.eventOpacity, lineOpacity);
        drawEventBar(this, context, rectangle, lineOpacity);
        if (display.overlaps.has(index) || hasNonPositiveRange(event.startTime, event.endTime)) {
          drawEventOverlapFilter(context, rectangle, palette);
        }
        context.globalAlpha = lineOpacity;
        if (event.trajectory) {
          this.drawTrajectoryEvent(context, rectangle, event);
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
            curveEntriesBySelection[selected ? 1 : 0].push({
              event,
              range: group,
              startY: bottom,
              endY: top,
            });
          }
        }
      }
      context.globalAlpha = lineOpacity;
      drawEventSelectionFilters(context, selectedRectangles);
      drawRemoteEventSelectionFilters(context, remoteSelectedRectangles, palette);
      context.strokeStyle = palette.eventStroke;
      for (const [selected, curveEntries] of curveEntriesBySelection.entries()) {
        if (!curveEntries.length) {
          continue;
        }
        context.strokeStyle = eventCurveStroke(palette, selected === 1);
        drawEventCurveBatch(
          context,
          curveEntries,
          { x: barX, y: 23, width: barWidth, height: Math.max(2, height - 23) },
          { steps: 24, padding: 4, lineWidth: 1.5, drawConstant: true },
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
      const format = (value: unknown) =>
        typeof value === "number"
          ? value.toFixed(2)
          : Array.isArray(value)
            ? value.join(",")
            : String(value ?? "");
      if (type !== "paintEvents" && valueFontSize > 0) {
        context.font = `${valueFontSize}px ${CANVAS_FONT_FAMILY}`;
        context.textAlign = "center";
        const valueGroups = labelGroups(
          entries.map((entry) => ranges.get(entry.index)),
          height,
          (group) => group.entries.some((entry) => lineSelection.has(eventKey(type, entry.index))),
          (group) => ({
            top: verticalAt(beatValue(group.entries.at(-1)!.event.endTime)),
            bottom: verticalAt(beatValue(group.entries[0]!.event.startTime)),
          }),
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
          context.fillStyle = palette.foreground;
          context.fillText(
            format(Number.isFinite(group.max) ? group.max : last.end),
            offset + channel * channelWidth + channelWidth / 2,
            Math.max(37, top + 13),
            Math.max(10, channelWidth - 8),
          );
          if (bottom - top > 26) {
            context.fillText(
              format(Number.isFinite(group.min) ? group.min : first.start),
              offset + channel * channelWidth + channelWidth / 2,
              Math.min(height - 5, bottom - 5),
              Math.max(10, channelWidth - 8),
            );
          }
        }
        context.textAlign = "left";
      }
      if (type !== "paintEvents" && type !== NOISE_ACTIVE_EVENTS) {
        drawSelectedEventValues(
          context,
          selectedValues,
          offset + channel * channelWidth + channelWidth / 2,
          channelWidth,
          height,
          palette,
          `${Math.max(8, valueFontSize || Math.min(baseValueFontSize, 10))}px ${CANVAS_FONT_FAMILY}`,
          format,
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
