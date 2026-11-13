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
import { eventColumnVisibilityKey } from "./eventColumns.ts";
import { eventColumnLabel } from "./eventColumns.ts";
import { noiseLineSettings } from "../../../../../../core/global/chart/noise/noiseLine.ts";
import { readCanvasPalette } from "../../../canvas/palette.ts";
import { canvasFont } from "../../../canvas/text.ts";
import { clamp01 } from "../../../../../../core/utils/numbers.ts";
import { strokeVerticalGrid } from "../drawing/gridDrawing.ts";
import type { TimelineOverlayBatch } from "../../../canvas/timelineOverlayBatch.ts";
import { drawEventText } from "./eventTextDrawing.ts";

type EventBarRectangle = Pick<TimelineEventRect, "x" | "y" | "width" | "height">;

interface MultiLineChromeKeyCache {
  readonly chart: object;
  readonly targetLineIndices: readonly number[];
  readonly palette: object;
  readonly extended: boolean;
  readonly visibility: number;
  readonly width: number;
  readonly height: number;
  readonly panelWidth: number;
  readonly offset: number;
  readonly key: string;
}

const multiLineChromeKeyCache = new WeakMap<object, MultiLineChromeKeyCache>();

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

/** Create a beat projector that reuses the frame's origin and event scale. */
export function createVerticalAtBeat(
  receiver: TimelineEventDrawingReceiver,
  factor: number,
  height: number,
): (beat: number) => number {
  const originSeconds = receiver.cache.tempoSeconds(
    receiver.viewport.tempo,
    receiver.viewport.origin,
    factor,
  );
  const scale = timelineScale(receiver);
  const offset = receiver.viewport.judgementOffset;
  const cache = receiver.cache;
  const tempo = receiver.viewport.tempo;
  return (beat: number) =>
    height - offset - (cache.tempoSeconds(tempo, beat, factor) - originSeconds) * scale;
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
  const targetLineIndices = session.targetLineIndices;
  const extended = receiver.gestures.extended;
  const visibility = eventColumnVisibilityKey();
  const panelWidth = receiver.viewport.panelWidth(width, "events");
  const offset = receiver.viewport.multiLineViewportOffset(width, "events");
  const cached = multiLineChromeKeyCache.get(receiver);
  if (
    cached &&
    cached.chart === session.chart &&
    cached.targetLineIndices === targetLineIndices &&
    cached.palette === palette &&
    cached.extended === extended &&
    cached.visibility === visibility &&
    cached.width === width &&
    cached.height === height &&
    cached.panelWidth === panelWidth &&
    cached.offset === offset
  ) {
    return cached.key;
  }
  const key = [
    targetLineIndices.join(","),
    extended,
    targetLineIndices
      .map((index) => receiver.viewport.eventTypesForLine(index).join(","))
      .join(";"),
    width,
    height,
    panelWidth,
    offset,
    palette.headerSurface,
    palette.foreground,
    receiver.appearance.verticalGridColor,
    palette.outline,
  ].join("|");
  multiLineChromeKeyCache.set(receiver, {
    chart: session.chart,
    targetLineIndices,
    palette,
    extended,
    visibility,
    width,
    height,
    panelWidth,
    offset,
    key,
  });
  return key;
}

/** Paint the column headers for every visible multi-line event panel. */
export function drawMultiLineEventChrome(
  receiver: TimelineEventDrawingReceiver,
  context: CanvasRenderingContext2D,
  width: number,
  labelBatch?: TimelineOverlayBatch,
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
        const label = eventColumnLabel(eventTypes[channel], rawTypes, labels);
        drawEventText(
          context,
          labelBatch ?? null,
          label,
          panelOffset + channel * channelWidth + channelWidth / 2,
          16,
          Math.max(8, channelWidth - 8),
          canvasFont("caption"),
          palette.foreground,
          "center",
        );
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
