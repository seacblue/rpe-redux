/**
 * Projects event bars and multi-line chrome. The backdrop grid and separators
 * are painted by `eventDrawing` on the live canvas; this module owns only the
 * reusable calculations and the cached header strip.
 *
 * Label budgeting and drag painting are owned by their feature modules; viewport
 * math comes from core.
 */
import type { TimelineEventRect } from "../../../../../../core/edit/timeline/types.ts";
import type { TimelineEventDrawingReceiver } from "../drawing/timelineReceiver.ts";
import { extendedLabels, noiseTrackLabels, trackLabels } from "../drawing/canvas.ts";
import { eventTypesForLine } from "../drawing/tracks.ts";
import { eventColumnLabel } from "./eventColumns.ts";
import { noiseLineSettings } from "../../../../../../core/global/chart/noise/noiseLine.ts";
import { readCanvasPalette } from "../../../canvas/palette.ts";
import { canvasFont } from "../../../canvas/text.ts";
import { clamp01 } from "../../../../../../core/utils/numbers.ts";
import { strokeVerticalGrid } from "../drawing/gridDrawing.ts";

type EventBarRectangle = Pick<TimelineEventRect, "x" | "y" | "width" | "height">;

/** The event-bar resources shared by track painting and the placement preview. */
type EventBarReceiver = Pick<TimelineEventDrawingReceiver, "appearance" | "eventBatch">;

/** Event-bar opacity shared by the canvas fallback and the GPU batch. */
export function eventBarOpacity(eventOpacity: number | undefined, lineOpacity = 1): number {
  return clamp01((eventOpacity ?? 1) * lineOpacity);
}

/** The event-field scale, preferring the area-specific accessor when present. */
function timelineScale(receiver: TimelineEventDrawingReceiver): number {
  return typeof receiver.viewport.scaleForArea === "function"
    ? receiver.viewport.scaleForArea("events")
    : receiver.viewport.scale;
}

/** Project a beat onto the event field's vertical axis. */
export function verticalAtBeat(
  receiver: TimelineEventDrawingReceiver,
  beat: number,
  factor: number,
  height: number,
): number {
  const originSeconds = receiver.cache.tempoSeconds(
    receiver.viewport.tempo,
    receiver.viewport.origin,
    factor,
  );
  const seconds = receiver.cache.tempoSeconds(receiver.viewport.tempo, beat, factor);
  return (
    height - receiver.viewport.judgementOffset - (seconds - originSeconds) * timelineScale(receiver)
  );
}

/** Add a bar to the GPU batch, falling back to the skin's canvas bar. */
export function drawEventBar(
  receiver: EventBarReceiver,
  context: CanvasRenderingContext2D,
  rectangle: EventBarRectangle,
  lineOpacity = 1,
): void {
  if (receiver.eventBatch.add(rectangle, lineOpacity)) {
    return;
  }
  receiver.appearance.skin?.eventBar(
    context,
    rectangle.x + rectangle.width / 2,
    rectangle.y + rectangle.height / 2,
    rectangle.width,
    rectangle.height,
  );
}

/** Key covering every input that changes the cached multi-line header strip. */
export function multiLineChromeKey(
  receiver: TimelineEventDrawingReceiver,
  session: ReturnType<TimelineEventDrawingReceiver["getSession"]>,
  width: number,
  height: number,
  palette: ReturnType<typeof readCanvasPalette>,
): string {
  return [
    session.targetLineIndices.join(","),
    receiver.gestures.extended,
    session.targetLineIndices
      .map((index) => receiver.viewport.eventTypesForLine(index).join(","))
      .join(";"),
    width,
    height,
    receiver.viewport.panelWidth(width, "events"),
    receiver.viewport.multiLineViewportOffset(width, "events"),
    palette.headerSurface,
    palette.foreground,
    receiver.appearance.verticalGridColor,
    palette.outline,
  ].join("|");
}

/** Paint the column headers for every visible multi-line event panel. */
export function drawMultiLineEventChrome(
  receiver: TimelineEventDrawingReceiver,
  context: CanvasRenderingContext2D,
  width: number,
): void {
  const palette = receiver.cache.palette() ?? readCanvasPalette();
  const session = receiver.getSession();
  const panelWidth = receiver.viewport.panelWidth(width, "events");
  const eventInset = receiver.viewport.eventInset(panelWidth);
  const contentWidth = Math.max(1, panelWidth - eventInset * 2);
  const offset = receiver.viewport.multiLineViewportOffset(width, "events");
  const stride = receiver.viewport.panelStride(width, "events");
  const targetLines = session.targetLineIndices;
  const multiPanel = receiver.viewport.panelCount("events") > 1;
  const [firstPanel, lastPanel] = receiver.viewport.visiblePanelRange(width, "events");
  context.fillStyle = palette.headerSurface;
  for (let panel = firstPanel; panel <= lastPanel; panel++) {
    const panelOffset = panel * stride - offset + eventInset;
    const lineIndex = targetLines[panel];
    if (lineIndex === undefined) {
      continue;
    }
    const eventTypes = receiver.viewport.eventTypesForLine(lineIndex);
    if (!eventTypes.length) {
      continue;
    }
    const channelWidth = contentWidth / eventTypes.length;
    const rawTypes = eventTypesForLine(
      session.chart.judgeLineList?.[lineIndex],
      receiver.gestures.extended,
    );
    const labels = receiver.gestures.extended
      ? extendedLabels()
      : noiseLineSettings(session.chart.judgeLineList?.[lineIndex])
        ? noiseTrackLabels()
        : trackLabels();
    for (let channel = 0; channel < eventTypes.length; channel++) {
      context.fillRect(panelOffset + channel * channelWidth, 0, channelWidth, 23);
      if (channelWidth >= 48) {
        context.fillStyle = palette.foreground;
        context.font = canvasFont("caption");
        context.textAlign = "center";
        context.fillText(
          eventColumnLabel(eventTypes[channel], rawTypes, labels),
          panelOffset + channel * channelWidth + channelWidth / 2,
          16,
          Math.max(8, channelWidth - 8),
        );
        context.textAlign = "left";
        context.fillStyle = palette.headerSurface;
      }
    }
    // Header fills sit above the backdrop separators. Paint the column edges
    // back into the header band so the last column keeps the panel's right
    // border instead of covering it with a solid block.
    context.lineWidth = 1;
    context.strokeStyle = receiver.appearance.verticalGridColor;
    for (let boundary = 0; boundary <= eventTypes.length; boundary += 1) {
      const raw = panelOffset + boundary * channelWidth;
      if (raw < 0 || raw > width) {
        continue;
      }
      strokeVerticalGrid(context, Math.min(width - 0.5, Math.max(0.5, raw)), 23);
    }
    if (multiPanel) {
      const raw = panelOffset + contentWidth;
      if (raw >= 0 && raw <= width) {
        context.lineWidth = 2;
        context.strokeStyle = palette.outline;
        strokeVerticalGrid(context, Math.min(width - 1, Math.max(1, raw)), 23);
        context.lineWidth = 1;
        context.strokeStyle = receiver.appearance.verticalGridColor;
      }
    }
  }
}
