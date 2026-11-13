/**
 * Draws the trajectory preview, the pending event placement, and shader event
 * bars in the event field.
 */
import { beatValue } from "../../../../../../core/global/chart/timing/beat.ts";
import { eventKey } from "../../../../../../core/edit/events/eventTracks.ts";
import { placedEvent } from "../../../../../../core/edit/events/eventCommands.ts";
import { eventColumnBounds } from "../../../../../../core/edit/timeline/timelineCoordinates.ts";
import { shaderIdentity } from "../../../../../../core/global/chart/shader/shaderEvents.ts";
import { trajectoryEventValue } from "../../../../../../core/global/chart/trajectory/curveTrajectory.ts";
import { t } from "../../../../../../i18n/index.ts";
import type {
  TimelineEventEntry,
  TimelineEventRect,
} from "../../../../../../core/edit/timeline/types.ts";
import type { JudgeLineEvent } from "../../../../../../core/global/chart/chart.ts";
import type { EventInteractionHandle } from "../drawing/canvas.ts";
import type {
  TimelineEventDrawingReceiver,
  TimelineEventOverlayReceiver,
  TimelinePendingEventReceiver,
} from "../drawing/timelineReceiver.ts";
import { readCanvasPalette, selectionColor } from "../../../canvas/palette.ts";
import { CANVAS_FONT_FAMILY, canvasFont, canvasTypePx } from "../../../canvas/text.ts";
import { multiLineLineOpacity } from "../multiLine/multiLinePresentation.ts";
import { eventColumnForTrack } from "./eventColumns.ts";
import { drawEventBar, eventBarOpacity } from "./eventRenderCache.ts";
import type { TimelineOverlayBatch } from "../../../canvas/timelineOverlayBatch.ts";
import { drawEventText } from "./eventTextDrawing.ts";
import {
  drawEventOverlapFilter,
  drawEventSelectionFilter,
  drawRemoteEventSelectionFilter,
} from "./eventSelectionDrawing.ts";

const TRAJECTORY_SAMPLE_COUNT = 65;

interface TrajectoryPlotAxis {
  readonly values: readonly number[];
  readonly minimum: number;
  readonly maximum: number;
}

interface TrajectoryPlotCache {
  x?: TrajectoryPlotAxis;
  y?: TrajectoryPlotAxis;
}

/** Reuse normalized trajectory samples while the immutable event object is alive. */
const trajectoryPlotCache = new WeakMap<object, TrajectoryPlotCache>();

interface ShaderIdentityCacheEntry {
  readonly shader: unknown;
  readonly shaderType: unknown;
  readonly name: unknown;
  readonly clone: unknown;
  readonly identity: string;
}

const shaderIdentityCache = new WeakMap<object, ShaderIdentityCacheEntry>();

/** Resolve one shader identity once until the event's identity fields change. */
export function eventShaderIdentity(event: JudgeLineEvent): string {
  const shader = event.shader;
  const shaderType = event.shaderType;
  const name = event.name;
  const clone = event.clone;
  const cached = shaderIdentityCache.get(event);
  if (
    cached &&
    cached.shader === shader &&
    cached.shaderType === shaderType &&
    cached.name === name &&
    cached.clone === clone
  ) {
    return cached.identity;
  }
  const identity = shaderIdentity(event);
  shaderIdentityCache.set(event, { shader, shaderType, name, clone, identity });
  return identity;
}

/** Sample one plotted trajectory axis once and retain its range for later frames. */
export function trajectoryPlotSamplesFor(
  event: JudgeLineEvent,
  axis: "x" | "y",
): TrajectoryPlotAxis {
  let cached = trajectoryPlotCache.get(event);
  if (!cached) {
    cached = {};
    trajectoryPlotCache.set(event, cached);
  }
  const existing = cached[axis];
  if (existing) {
    return existing;
  }
  const values = new Array<number>(TRAJECTORY_SAMPLE_COUNT);
  let minimum = Infinity;
  let maximum = -Infinity;
  for (let index = 0; index < TRAJECTORY_SAMPLE_COUNT; index++) {
    const value = trajectoryEventValue(event, index / (TRAJECTORY_SAMPLE_COUNT - 1), axis);
    values[index] = value;
    minimum = Math.min(minimum, value);
    maximum = Math.max(maximum, value);
  }
  const samples = { values, minimum, maximum };
  cached[axis] = samples;
  return samples;
}

/** Vertical projection and plot bounds shared by both trajectory painters. */
interface TrajectoryPlot {
  readonly plottable: boolean;
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
}

/** Resolve the trajectory preview's projection and plot bounds once. */
function trajectoryPlot(
  receiver: TimelineEventOverlayReceiver,
  rectangle: TimelineEventRect,
  event: JudgeLineEvent,
): TrajectoryPlot {
  const lineIndex = rectangle.lineIndex ?? receiver.getSession().lineIndex;
  const verticalAt = (beat: number) =>
    receiver.getSession().multiLineActive && receiver.getSession().multiLineMode === "events"
      ? receiver.viewport.verticalForLine(beat, lineIndex, receiver.viewport.viewHeight())
      : receiver.viewport.eventVertical(beat, "moveXEvents");
  const startY = verticalAt(beatValue(event.startTime));
  const endY = verticalAt(beatValue(event.endTime));
  return {
    plottable: rectangle.width > 20 && rectangle.height > 42,
    left: rectangle.x + 5,
    right: rectangle.x + rectangle.width - 5,
    top: Math.max(Math.min(startY, endY), rectangle.y + 38),
    bottom: Math.min(Math.max(startY, endY), rectangle.y + rectangle.height - 5),
  };
}

/** Fill `points` with the flat [x, y, ...] samples of one plotted trajectory axis. */
function trajectoryAxisPoints(
  plot: TrajectoryPlot,
  event: JudgeLineEvent,
  axis: "x" | "y",
  points: number[],
): void {
  const { values: samples, minimum, maximum } = trajectoryPlotSamplesFor(event, axis);
  points.length = 0;
  const span = maximum - minimum || 1;
  for (let index = 0; index < samples.length; index++) {
    points.push(
      plot.left + (((samples[index] ?? 0) - minimum) / span) * (plot.right - plot.left),
      plot.top + (index / 64) * (plot.bottom - plot.top),
    );
  }
}

/**
 * Paint one trajectory preview through the canvas or the overlay batch.
 *
 * Both renderers read one projection and one sample set; only the primitives
 * differ, so the preview keeps the same geometry across renderers.
 */
function paintTrajectory(
  receiver: TimelineEventOverlayReceiver,
  context: CanvasRenderingContext2D | null,
  batch: TimelineOverlayBatch | null,
  rectangle: TimelineEventRect,
  event: JudgeLineEvent,
  alpha: number,
): void {
  const palette = receiver.cache.palette() ?? readCanvasPalette();
  const plot = trajectoryPlot(receiver, rectangle, event);
  const chromeAlpha = alpha * 0.95;
  const centreX = rectangle.x + rectangle.width / 2;
  if (batch) {
    batch.addStrokeRect(
      rectangle.x,
      rectangle.y,
      rectangle.width,
      rectangle.height,
      palette.inspectorMarker,
      2,
      chromeAlpha,
    );
  } else if (context) {
    context.save();
    context.beginPath();
    context.rect(rectangle.x, rectangle.y, rectangle.width, rectangle.height);
    context.clip();
    context.strokeStyle = palette.inspectorMarker;
    context.globalAlpha = chromeAlpha;
    context.lineWidth = 2;
    context.strokeRect(rectangle.x, rectangle.y, rectangle.width, rectangle.height);
  }
  drawEventText(
    context,
    batch,
    t("editorPanels.timeline.trajectoryTrack"),
    centreX,
    rectangle.y + 30,
    Math.max(1, rectangle.width - 4),
    canvasFont("caption"),
    palette.inspectorMarker,
    "center",
    chromeAlpha,
  );
  if (plot.plottable) {
    const gridAlpha = alpha * 0.28;
    if (batch) {
      for (let index = 1; index < 4; index++) {
        const horizontal = plot.left + ((plot.right - plot.left) * index) / 4;
        const vertical = plot.top + ((plot.bottom - plot.top) * index) / 4;
        batch.addSegment(
          horizontal,
          plot.top,
          horizontal,
          plot.bottom,
          palette.outline,
          1,
          gridAlpha,
        );
        batch.addSegment(plot.left, vertical, plot.right, vertical, palette.outline, 1, gridAlpha);
      }
    } else if (context) {
      context.globalAlpha = gridAlpha;
      context.strokeStyle = palette.outline;
      context.lineWidth = 1;
      context.setLineDash([2, 3]);
      for (let index = 1; index < 4; index++) {
        const horizontal = plot.left + ((plot.right - plot.left) * index) / 4;
        const vertical = plot.top + ((plot.bottom - plot.top) * index) / 4;
        context.beginPath();
        context.moveTo(horizontal, plot.top);
        context.lineTo(horizontal, plot.bottom);
        context.moveTo(plot.left, vertical);
        context.lineTo(plot.right, vertical);
        context.stroke();
      }
      context.setLineDash([]);
    }
    const points: number[] = [];
    for (const [axis, color] of [
      ["x", palette.inspectorMarker],
      ["y", palette.eventShaderFill],
    ] as const) {
      trajectoryAxisPoints(plot, event, axis, points);
      if (batch) {
        batch.addPolyline(points, color, 1.5, alpha * 0.92);
        continue;
      }
      if (!context) {
        continue;
      }
      context.strokeStyle = color;
      context.globalAlpha = alpha * 0.92;
      context.lineWidth = 1.5;
      context.beginPath();
      for (let index = 0; index < points.length; index += 2) {
        if (index === 0) {
          context.moveTo(points[index] ?? 0, points[index + 1] ?? 0);
        } else {
          context.lineTo(points[index] ?? 0, points[index + 1] ?? 0);
        }
      }
      context.stroke();
    }
  }
  if (!batch) {
    context?.restore();
  }
}

/** Paint a trajectory preview through the overlay when it is active, else on the canvas. */
export function drawTrajectory(
  this: TimelineEventOverlayReceiver,
  context: CanvasRenderingContext2D,
  batch: TimelineOverlayBatch | null,
  rectangle: TimelineEventRect,
  event: JudgeLineEvent,
  alpha = 1,
): void {
  if (batch && batch.isActive()) {
    paintTrajectory(this, null, batch, rectangle, event, alpha);
    return;
  }
  paintTrajectory(this, context, null, rectangle, event, 1);
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
  entries: readonly TimelineEventEntry[],
  channel: number,
  width: number,
  height: number,
  selectedIndexes?: ReadonlySet<number>,
): void {
  const palette = this.cache.palette() ?? readCanvasPalette();
  const session = this.getSession();
  const lineIndex = session.lineIndex;
  const overlapSelectionSuppressed = this.gestures.overlapMenuOpen;
  const selectedEventColor = selectionColor("selected-event-color", "#00C800");
  const bounds = this.viewport.eventColumnBounds(channel, width);
  for (const entry of entries) {
    const placement = this.cache.shaderLane(entry.index);
    if (!placement) {
      continue;
    }
    const laneWidth = bounds.width / placement.count;
    const name = eventShaderIdentity(entry.item);
    const top = Math.max(23, this.viewport.eventVertical(entry.end, "paintEvents"));
    const bottom = Math.min(height, this.viewport.eventVertical(entry.start, "paintEvents"));
    if (bottom < top) {
      continue;
    }
    const projected = this.gestures.recordEventRect(
      bounds.x + placement.lane * laneWidth,
      top,
      Math.max(2, laneWidth - (placement.count > 1 ? 2 : 0)),
      Math.max(2, bottom - top),
      entry.index,
      "paintEvents",
    );
    const selected = selectedIndexes
      ? selectedIndexes.has(entry.index)
      : session.eventSelection.has(eventKey("paintEvents", entry.index));
    const hovered = this.gestures.isEventOverlapHovered(lineIndex, "paintEvents", entry.index);
    context.save();
    context.globalAlpha = eventBarOpacity(this.appearance.eventOpacity);
    drawEventBar(this, context, projected);
    context.globalAlpha = 1;
    if (entry.invalid) {
      context.fillStyle = palette.overlayInvalidFill;
      context.fillRect(projected.x, top, projected.width, projected.height);
    }
    if (hovered || (!overlapSelectionSuppressed && selected)) {
      drawEventSelectionFilter(context, projected, selectedEventColor);
    } else if (
      !overlapSelectionSuppressed &&
      entry.item.id !== undefined &&
      this.remoteSelectedEventIds.has(entry.item.id)
    ) {
      drawRemoteEventSelectionFilter(context, projected, palette);
    }
    context.beginPath();
    context.rect(projected.x, top, projected.width, projected.height);
    context.clip();
    context.fillStyle = palette.eventShaderText;
    context.font = `${this.appearance.eventValueFontSize ?? canvasTypePx("body")}px ${CANVAS_FONT_FAMILY}`;
    context.textAlign = "center";
    context.fillText(name, projected.x + projected.width / 2, top + 16, projected.width - 4);
    if (projected.height > 40) {
      context.fillText(
        `#${entry.item.order ?? 0}${entry.item.global ? ", UI" : ""}`,
        projected.x + projected.width / 2,
        top + 33,
        projected.width - 4,
      );
    }
    context.restore();
  }
}
