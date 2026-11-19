/**
 * Projects event bars and multi-line chrome. The backdrop grid and separators
 * are painted by `eventDrawing` on the live canvas; this module owns only the
 * reusable calculations and the cached panel header strip.
 *
 * Each multi-line event panel captions itself with its judge line instead of the
 * event column names, because every panel repeats the same five columns. Label
 * budgeting and drag painting are owned by their feature modules; viewport math
 * comes from core.
 */
import type { TimelineEventRect } from "../../../../../../core/edit/timeline/types.ts";
import type { TimelineEventDrawingReceiver } from "../drawing/timelineReceiver.ts";
import { readCanvasPalette } from "../../../canvas/palette.ts";
import { canvasFont } from "../../../canvas/text.ts";
import { clamp01 } from "../../../../../../core/utils/numbers.ts";
import { LINE_LABEL_BASELINE, strokeVerticalGrid } from "../drawing/gridDrawing.ts";
import type { TimelineOverlayBatch } from "../../../canvas/timelineOverlayBatch.ts";
import { drawEventText } from "./eventTextDrawing.ts";
import { multiLineLineLabel } from "../multiLine/multiLineLineLabel.ts";

type EventBarRectangle = Pick<TimelineEventRect, "x" | "y" | "width" | "height">;

/** One visible event panel's header band geometry and its judge-line caption. */
interface MultiLineEventHeader {
  readonly left: number;
  readonly width: number;
  readonly text: string;
}

interface MultiLineChromeKeyCache {
  readonly chart: object;
  readonly targetLineIndices: readonly number[];
  readonly palette: object;
  readonly verticalGridColor: string;
  readonly width: number;
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

/** One visible event panel's header band and judge-line caption at this width. */
function visibleEventHeaders(
  receiver: TimelineEventDrawingReceiver,
  width: number,
): MultiLineEventHeader[] {
  const session = receiver.getSession();
  const panelWidth = receiver.viewport.panelWidth(width, "events");
  const eventInset = receiver.viewport.eventInset(panelWidth);
  const contentWidth = Math.max(1, panelWidth - eventInset * 2);
  const offset = receiver.viewport.multiLineViewportOffset(width, "events");
  const stride = receiver.viewport.panelStride(width, "events");
  const targets = session.targetLineIndices;
  const [firstPanel, lastPanel] = receiver.viewport.visiblePanelRange(width, "events");
  const headers: MultiLineEventHeader[] = [];
  for (let panel = firstPanel; panel <= lastPanel; panel += 1) {
    const lineIndex = targets[panel];
    if (lineIndex === undefined) {
      continue;
    }
    headers.push({
      left: panel * stride - offset + eventInset,
      width: contentWidth,
      text: multiLineLineLabel(lineIndex, session.chart.judgeLineList?.[lineIndex]),
    });
  }
  return headers;
}

/** Key covering every input that changes the cached multi-line header strip. */
export function multiLineChromeKey(
  receiver: TimelineEventDrawingReceiver,
  session: ReturnType<TimelineEventDrawingReceiver["getSession"]>,
  width: number,
  palette: ReturnType<typeof readCanvasPalette>,
): string {
  const targetLineIndices = session.targetLineIndices;
  const panelWidth = receiver.viewport.panelWidth(width, "events");
  const offset = receiver.viewport.multiLineViewportOffset(width, "events");
  const verticalGridColor = receiver.appearance.verticalGridColor;
  const cached = multiLineChromeKeyCache.get(receiver);
  if (
    cached &&
    cached.chart === session.chart &&
    cached.targetLineIndices === targetLineIndices &&
    cached.palette === palette &&
    cached.verticalGridColor === verticalGridColor &&
    cached.width === width &&
    cached.panelWidth === panelWidth &&
    cached.offset === offset
  ) {
    return cached.key;
  }
  const key = [
    JSON.stringify(visibleEventHeaders(receiver, width)),
    width,
    panelWidth,
    offset,
    palette.headerSurface,
    palette.bottomValue,
    verticalGridColor,
    palette.outline,
  ].join("|");
  multiLineChromeKeyCache.set(receiver, {
    chart: session.chart,
    targetLineIndices,
    palette,
    verticalGridColor,
    width,
    panelWidth,
    offset,
    key,
  });
  return key;
}

/** Paint the judge-line header band for every visible multi-line event panel. */
export function drawMultiLineEventChrome(
  receiver: TimelineEventDrawingReceiver,
  context: CanvasRenderingContext2D,
  width: number,
  labelBatch?: TimelineOverlayBatch,
): void {
  const palette = receiver.cache.palette() ?? readCanvasPalette();
  const multiPanel = receiver.viewport.panelCount("events") > 1;
  const headers = visibleEventHeaders(receiver, width);
  const font = canvasFont("caption");
  context.fillStyle = palette.headerSurface;
  for (const header of headers) {
    // The five event columns keep a fixed order, so the band names the judge
    // line instead of repeating the track names in every panel.
    context.fillRect(header.left, 0, header.width, 23);
    // The overlay's GPU curves paint above the canvas; queue the band fill and
    // its label on that layer too, after the curves were submitted.
    labelBatch?.addRect(header.left, 0, header.width, 23, palette.headerSurface);
    drawEventText(
      context,
      labelBatch ?? null,
      header.text,
      header.left + header.width / 2,
      LINE_LABEL_BASELINE,
      Math.max(8, header.width - 12),
      font,
      palette.bottomValue,
      "center",
    );
  }
  // Header fills sit above the backdrop separators. Paint the panel edges back
  // into the band so adjacent windows keep their boundaries.
  context.lineWidth = 1;
  context.strokeStyle = receiver.appearance.verticalGridColor;
  for (const header of headers) {
    if (header.left >= 0 && header.left <= width) {
      strokeVerticalGrid(context, Math.min(width - 0.5, Math.max(0.5, header.left)), 23);
    }
    const right = header.left + header.width;
    if (right >= 0 && right <= width) {
      strokeVerticalGrid(context, Math.min(width - 0.5, Math.max(0.5, right)), 23);
    }
  }
  if (multiPanel) {
    context.lineWidth = 2;
    context.strokeStyle = palette.outline;
    for (const header of headers) {
      const raw = header.left + header.width;
      if (raw >= 0 && raw <= width) {
        strokeVerticalGrid(context, Math.min(width - 1, Math.max(1, raw)), 23);
      }
    }
    context.lineWidth = 1;
    context.strokeStyle = receiver.appearance.verticalGridColor;
  }
}
