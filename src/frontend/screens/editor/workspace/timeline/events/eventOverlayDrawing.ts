/**
 * Draws the trajectory preview, the pending event placement, and shader event
 * bars in the event field.
 */
import { beatValue } from "../../../../../../core/global/chart/timing/beat.ts";
import { type IntervalEntry } from "../../../../../../core/utils/intervalIndex.ts";
import { eventKey } from "../../../../../../core/edit/events/eventTracks.ts";
import { placedEvent } from "../../../../../../core/edit/events/eventCommands.ts";
import { hasNonPositiveRange } from "../../../../../../core/edit/timeline/model.ts";
import { eventColumnBounds } from "../../../../../../core/edit/timeline/timelineCoordinates.ts";
import { shaderIdentity } from "../../../../../../core/global/chart/shader/shaderEvents.ts";
import { trajectoryEventValue } from "../../../../../../core/global/chart/trajectory/curveTrajectory.ts";
import { t } from "../../../../../../i18n/index.ts";
import type { TimelineEventRect } from "../../../../../../core/edit/timeline/types.ts";
import type { JudgeLineEvent } from "../../../../../../core/global/chart/chart.ts";
import type { EventInteractionHandle } from "../drawing/canvas.ts";
import type {
  TimelineEventDrawingReceiver,
  TimelineEventOverlayReceiver,
  TimelinePendingEventReceiver,
} from "../drawing/timelineReceiver.ts";
import { readCanvasPalette } from "../../../canvas/palette.ts";
import { CANVAS_FONT_FAMILY, canvasFont, canvasTypePx } from "../../../canvas/text.ts";
import { multiLineLineOpacity } from "../multiLine/multiLinePresentation.ts";
import { eventColumnForTrack } from "./eventColumns.ts";
import { drawEventBar, eventBarOpacity } from "./eventRenderCache.ts";
import {
  drawEventOverlapFilter,
  drawEventSelectionFilters,
  drawRemoteEventSelectionFilters,
} from "./eventSelectionDrawing.ts";

/** Draw the trajectory preview inside one event bar. */
export function drawTrajectoryEvent(
  this: TimelineEventOverlayReceiver,
  context: CanvasRenderingContext2D,
  rectangle: TimelineEventRect,
  event: JudgeLineEvent,
): void {
  const lineIndex = rectangle.lineIndex ?? this.getSession().lineIndex;
  const verticalAt = (beat: number) =>
    this.getSession().multiLineActive && this.getSession().multiLineMode === "events"
      ? this.viewport.verticalForLine(beat, lineIndex, this.viewport.viewHeight())
      : this.viewport.eventVertical(beat, "moveXEvents");
  const startY = verticalAt(beatValue(event.startTime));
  const endY = verticalAt(beatValue(event.endTime));
  const palette = this.cache.palette() ?? readCanvasPalette();
  context.save();
  context.beginPath();
  context.rect(rectangle.x, rectangle.y, rectangle.width, rectangle.height);
  context.clip();
  context.strokeStyle = palette.inspectorMarker;
  context.globalAlpha = 0.95;
  context.lineWidth = 2;
  context.strokeRect(rectangle.x, rectangle.y, rectangle.width, rectangle.height);
  context.fillStyle = palette.inspectorMarker;
  context.font = canvasFont("caption");
  context.textAlign = "center";
  context.fillText(
    t("editorPanels.timeline.trajectoryTrack"),
    rectangle.x + rectangle.width / 2,
    rectangle.y + 30,
    Math.max(1, rectangle.width - 4),
  );
  if (rectangle.width > 20 && rectangle.height > 42) {
    const plotLeft = rectangle.x + 5;
    const plotRight = rectangle.x + rectangle.width - 5;
    const plotTop = Math.max(Math.min(startY, endY), rectangle.y + 38);
    const plotBottom = Math.min(Math.max(startY, endY), rectangle.y + rectangle.height - 5);
    context.globalAlpha = 0.28;
    context.strokeStyle = palette.outline;
    context.lineWidth = 1;
    context.setLineDash([2, 3]);
    for (let index = 1; index < 4; index++) {
      const horizontal = plotLeft + ((plotRight - plotLeft) * index) / 4;
      const vertical = plotTop + ((plotBottom - plotTop) * index) / 4;
      context.beginPath();
      context.moveTo(horizontal, plotTop);
      context.lineTo(horizontal, plotBottom);
      context.moveTo(plotLeft, vertical);
      context.lineTo(plotRight, vertical);
      context.stroke();
    }
    context.setLineDash([]);
    for (const [axis, color] of [
      ["x", palette.inspectorMarker],
      ["y", palette.eventShaderFill],
    ] as const) {
      const samples = Array.from({ length: 65 }, (unused, index) =>
        trajectoryEventValue(event, index / 64, axis),
      );
      const minimum = Math.min(...samples);
      const maximum = Math.max(...samples);
      context.strokeStyle = color;
      context.globalAlpha = 0.92;
      context.lineWidth = 1.5;
      context.beginPath();
      samples.forEach((value, index) => {
        const horizontal =
          plotLeft + ((value - minimum) / (maximum - minimum || 1)) * (plotRight - plotLeft);
        const vertical = plotTop + (index / 64) * (plotBottom - plotTop);
        if (index) {
          context.lineTo(horizontal, vertical);
        } else {
          context.moveTo(horizontal, vertical);
        }
      });
      context.stroke();
    }
  }
  context.restore();
}

/**
 * Draw the armed placement preview as the committed event-bar skin at half
 * opacity.
 *
 * The preview follows the same column, span, and per-line dimming as a
 * committed event so it reads as that object rather than a procedural overlay.
 * A span the placement rules reject borrows the committed-event overlap tint.
 */
export function drawPendingEvent(
  this: TimelinePendingEventReceiver,
  context: CanvasRenderingContext2D,
  pending: NonNullable<EventInteractionHandle["pending"]>,
  width: number,
): void {
  const session = this.getSession();
  const pendingLineIndex = pending.lineIndex ?? session.lineIndex;
  const eventTypes = this.viewport.eventTypesForLine(pendingLineIndex);
  const channel = eventColumnForTrack(eventTypes, pending.type);
  if (channel < 0) {
    return;
  }
  const cursorBeat = this.gestures.eventCursor
    ? this.viewport.eventBeatAt(this.gestures.eventCursor.y, pending.type, true)
    : pending.beat;
  // The endpoint may be earlier than the start. Order the two anchors here so
  // the preview and the committed event share one span.
  const startBeat = Math.min(pending.beat, cursorBeat);
  const endBeat = Math.max(pending.beat, cursorBeat);
  let valid = true;
  try {
    placedEvent(session, pending.type, startBeat, endBeat, undefined, pending.lineIndex);
  } catch {
    valid = false;
  }
  const vertical =
    session.multiLineActive && session.multiLineMode === "events"
      ? (beat: number) => this.viewport.verticalForLine(beat, pendingLineIndex)
      : (beat: number) => this.viewport.eventVertical(beat, pending.type);
  const top = Math.min(vertical(startBeat), vertical(endBeat));
  const height = Math.max(2, Math.abs(vertical(startBeat) - vertical(endBeat)));
  const panelWidth = this.viewport.panelWidth(width, "events");
  const panelOffset =
    this.viewport.panelIndex(pendingLineIndex, "events") *
      this.viewport.panelStride(width, "events") -
    this.viewport.multiLineViewportOffset(width, "events");
  const column = eventColumnBounds(
    channel,
    panelWidth,
    eventTypes.length,
    this.viewport.eventBarWidth ?? 0.82,
    this.viewport.eventInset(panelWidth),
  );
  const rectangle = { x: panelOffset + column.x, y: top, width: column.width, height };
  const appearance = this.appearance;
  const lineOpacity =
    session.multiLineActive && session.multiLineMode === "events"
      ? multiLineLineOpacity(
          pendingLineIndex,
          session.lineIndex,
          appearance.multiLineNonCurrentOpacity,
        )
      : 1;
  const previewLineOpacity = lineOpacity / 2;
  context.save();
  context.globalAlpha = eventBarOpacity(appearance.eventOpacity, previewLineOpacity);
  drawEventBar(this, context, rectangle, previewLineOpacity);
  context.restore();
  if (!valid) {
    // Reuse the committed-event overlap tint so a rejected span keeps the
    // track's existing warning language.
    drawEventOverlapFilter(context, rectangle, readCanvasPalette());
  }
}

/** Draw paint events in their shader lanes with the shared event-bar skin. */
export function drawShaderEvents(
  this: TimelineEventDrawingReceiver,
  context: CanvasRenderingContext2D,
  entries: readonly IntervalEntry<JudgeLineEvent>[],
  channel: number,
  width: number,
  height: number,
): void {
  const palette = this.cache.palette() ?? readCanvasPalette();
  const bounds = this.viewport.eventColumnBounds(channel, width);
  for (const entry of entries) {
    const placement = this.cache.shaderLane(entry.index);
    if (!placement) {
      continue;
    }
    const laneWidth = bounds.width / placement.count;
    const name = shaderIdentity(entry.item);
    const top = Math.max(23, this.viewport.eventVertical(entry.end, "paintEvents"));
    const bottom = Math.min(height, this.viewport.eventVertical(entry.start, "paintEvents"));
    if (bottom < top) {
      continue;
    }
    const rectangle = {
      x: bounds.x + placement.lane * laneWidth,
      y: top,
      width: Math.max(2, laneWidth - (placement.count > 1 ? 2 : 0)),
      height: Math.max(2, bottom - top),
      index: entry.index,
      type: "paintEvents",
    };
    this.gestures.eventRects.push(rectangle);
    const selected = this.getSession().eventSelection.has(eventKey("paintEvents", entry.index));
    const hovered = this.gestures.isEventOverlapHovered(
      this.getSession().lineIndex,
      "paintEvents",
      entry.index,
    );
    const overlapSelectionSuppressed = this.gestures.overlapMenuOpen;
    context.save();
    context.globalAlpha = eventBarOpacity(this.appearance.eventOpacity);
    drawEventBar(this, context, rectangle);
    context.globalAlpha = 1;
    if (hasNonPositiveRange(entry.item.startTime, entry.item.endTime)) {
      context.fillStyle = palette.overlayInvalidFill;
      context.fillRect(rectangle.x, top, rectangle.width, rectangle.height);
    }
    if (hovered || (!overlapSelectionSuppressed && selected)) {
      drawEventSelectionFilters(context, [rectangle]);
    } else if (
      !overlapSelectionSuppressed &&
      entry.item.id !== undefined &&
      this.remoteSelectedEventIds.has(entry.item.id)
    ) {
      drawRemoteEventSelectionFilters(context, [rectangle], palette);
    }
    context.beginPath();
    context.rect(rectangle.x, top, rectangle.width, rectangle.height);
    context.clip();
    context.fillStyle = palette.eventShaderText;
    context.font = `${this.appearance.eventValueFontSize ?? canvasTypePx("body")}px ${CANVAS_FONT_FAMILY}`;
    context.textAlign = "center";
    context.fillText(name, rectangle.x + rectangle.width / 2, top + 16, rectangle.width - 4);
    if (rectangle.height > 40) {
      context.fillText(
        `#${entry.item.order ?? 0}${entry.item.global ? ", UI" : ""}`,
        rectangle.x + rectangle.width / 2,
        top + 33,
        rectangle.width - 4,
      );
    }
    context.restore();
  }
}
