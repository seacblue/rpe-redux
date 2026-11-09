/**
 * Draws the timeline side strips: clipboard and paste ranges, the current-time
 * marker, and drag seeking.
 *
 * Hovering a strip feeds the floating thumbnail preview; chart sampling and
 * navigation math come from core.
 */
import type { Chart } from "../../../../../../core/global/chart/chart.ts";
import type { TempoMap } from "../../../../../../core/global/chart/timing/tempo.ts";
import type { TimelineActivity } from "../../../../../../core/edit/timeline/activity.ts";
import { clamp } from "../../../../../../core/utils/numbers.ts";
import { prepareCanvas } from "../../../canvas/canvas2d.ts";
import type { TimelineThumbnail } from "./timelineThumbnail.ts";
import { sameOverviewFrame, type OverviewFrameKey } from "./overviewFrameKey.ts";
import {
  type TimelineBindingsState,
  type TimelineOverviewBindings,
} from "../surface/timelineBindings.ts";
import { readCanvasPalette, selectionColor } from "../../../canvas/palette.ts";

export interface TimelineOverviewSnapshot {
  chart: Chart;
  tempo: TempoMap;
  lineIndex: number;
  layer: number;
  extended: boolean;
  mediaDuration: number;
  currentSeconds: number;
  offsetSeconds: number;
  /** Changes only when the history stacks or document change. */
  historyRevision: number;
  /** The active line's tempo factor, used to place clipboard beat spans. */
  bpmFactor: number;
  /** The clipboard's current beat span, when it holds objects. */
  clipboardRange: { start: number; end: number } | null;
  /** The most recent paste's beat span. */
  pasteRange: { start: number; end: number } | null;
  hasDocument: boolean;
  atHome: boolean;
}

export interface TimelineOverviewOptions {
  densityCanvas: HTMLCanvasElement;
  historyCanvas: HTMLCanvasElement;
  /** The editing canvases the strips are drawn to match. */
  timeline: { notesCanvas: HTMLCanvasElement; eventsCanvas: HTMLCanvasElement };
  activity: Pick<TimelineActivity, "compile" | "duration">;
  thumbnail: Pick<TimelineThumbnail, "show" | "hide">;
  bindings: TimelineBindingsState;
  densityBarsEnabled: () => boolean;
  hoverPreviewEnabled: () => boolean;
  clipboardRangesEnabled: () => boolean;
  rangeBarOpacity: () => number;
  getSnapshot: () => TimelineOverviewSnapshot;
  seek: (seconds: number) => void;
}

/**
 * Paint one clipboard or paste span over a strip.
 *
 * The span is stored in beats so it stays valid when the tempo map changes; the
 * strip itself is addressed in chart seconds. Rounded corners keep the marker
 * distinct from a plain rectangle, and the caller supplies the fill opacity so
 * the strips stay quiet behind the timeline.
 */
function paintRangeBar(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  duration: number,
  range: { start: number; end: number },
  tempo: TempoMap,
  factor: number,
  color: string,
  opacity: number,
): void {
  if (!width || !height || !(duration > 0)) {
    return;
  }
  let start: number;
  let end: number;
  try {
    start = tempo.seconds(range.start, factor);
    end = tempo.seconds(range.end, factor);
  } catch {
    return;
  }
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    return;
  }
  const startY = height - (clamp(start, 0, duration) / duration) * height;
  const endY = height - (clamp(end, 0, duration) / duration) * height;
  const barX = 2;
  const barWidth = Math.max(1, width - 4);
  const top = Math.max(1, Math.min(height - 2, Math.min(startY, endY)));
  const bottom = Math.max(top + 2, Math.min(height - 1, Math.max(startY, endY)));
  const barHeight = bottom - top;
  const radius = Math.min(3, barWidth / 2, barHeight / 2);
  context.save();
  context.beginPath();
  context.roundRect(barX, top, barWidth, barHeight, radius);
  context.globalAlpha = opacity;
  context.fillStyle = color;
  context.fill();
  context.globalAlpha = Math.min(1, opacity + 0.3);
  context.lineWidth = 1;
  context.strokeStyle = color;
  context.stroke();
  context.restore();
}

/** Owns the timeline side-strip drawing, hover preview and drag seeking. */
export class TimelineOverview {
  private readonly options: TimelineOverviewOptions;
  private lastSeek = -Infinity;
  private pendingSeek: ReturnType<typeof setTimeout> | undefined;
  private pendingSeconds = 0;
  private seekingCanvas: HTMLCanvasElement | null = null;
  private readonly bindings: TimelineOverviewBindings;
  private readonly bindingState: TimelineBindingsState;
  private drawnFrame: OverviewFrameKey | null = null;
  private disposed = false;

  /** Bind both strips to the supplied canvases and publish their bindings. */
  constructor(options: TimelineOverviewOptions) {
    this.options = options;
    this.bindingState = options.bindings;
    this.bindings = {
      density: this.stripBindings(options.densityCanvas),
      history: this.stripBindings(options.historyCanvas),
    };
    this.bindingState.overview.set(this.bindings);
  }

  /** Paint both strips using the same chart-time sample as the timeline frame. */
  draw(currentSeconds?: number): void {
    const { densityCanvas, historyCanvas, activity } = this.options;
    if (!this.options.densityBarsEnabled()) {
      this.options.thumbnail.hide();
      return;
    }
    if (!this.options.hoverPreviewEnabled()) {
      this.options.thumbnail.hide();
    }
    const snapshot = this.options.getSnapshot();
    const palette = readCanvasPalette();
    // Only one editing field can be visible at a time in the exclusive layouts,
    // and the hidden canvas reports a zero height. The strips match whichever
    // field is actually on screen.
    const height =
      this.options.timeline.notesCanvas.clientHeight ||
      this.options.timeline.eventsCanvas.clientHeight;
    const width = densityCanvas.clientWidth;
    if (!height || !width) {
      this.drawnFrame = null;
      return;
    }
    activity.compile(snapshot.chart, snapshot.tempo);
    const duration = Math.max(
      0.001,
      snapshot.mediaDuration > 0 ? snapshot.mediaDuration : activity.duration,
    );
    const markerY =
      height - (clamp(currentSeconds ?? snapshot.currentSeconds, 0, duration) / duration) * height;
    const rangeBarsEnabled = this.options.clipboardRangesEnabled();
    const rangeBarOpacity = clamp(this.options.rangeBarOpacity(), 0.02, 0.8);
    const clipboardColor = selectionColor("timeline-clipboard-range-color", "#00C800");
    const pasteColor = selectionColor("timeline-paste-range-color", "#FFCC66");
    const frameKey: OverviewFrameKey = {
      chart: snapshot.chart,
      line: snapshot.lineIndex,
      layer: snapshot.layer,
      extended: snapshot.extended,
      duration,
      width,
      historyWidth: historyCanvas.clientWidth,
      height,
      historyRevision: snapshot.historyRevision,
      palette,
      markerY,
      rangeBarsEnabled,
      rangeBarOpacity,
      clipboardRangeKey: snapshot.clipboardRange
        ? `${snapshot.clipboardRange.start}:${snapshot.clipboardRange.end}`
        : "",
      pasteRangeKey: snapshot.pasteRange
        ? `${snapshot.pasteRange.start}:${snapshot.pasteRange.end}`
        : "",
      clipboardColor,
      pasteColor,
    };
    if (sameOverviewFrame(this.drawnFrame, frameKey)) {
      return;
    }
    const noteFrame = prepareCanvas(densityCanvas);
    const historyFrame = prepareCanvas(historyCanvas);
    if (rangeBarsEnabled) {
      for (const frame of [noteFrame, historyFrame]) {
        if (snapshot.clipboardRange) {
          paintRangeBar(
            frame.context,
            frame.width,
            height,
            duration,
            snapshot.clipboardRange,
            snapshot.tempo,
            snapshot.bpmFactor,
            clipboardColor,
            rangeBarOpacity,
          );
        }
        if (snapshot.pasteRange) {
          paintRangeBar(
            frame.context,
            frame.width,
            height,
            duration,
            snapshot.pasteRange,
            snapshot.tempo,
            snapshot.bpmFactor,
            pasteColor,
            rangeBarOpacity,
          );
        }
      }
    }
    for (const frame of [noteFrame, historyFrame]) {
      frame.context.strokeStyle = palette.bottomValue;
      frame.context.lineWidth = 1;
      frame.context.beginPath();
      frame.context.moveTo(0, markerY + 0.5);
      frame.context.lineTo(frame.width, markerY + 0.5);
      frame.context.stroke();
    }
    this.drawnFrame = frameKey;
  }

  /** Release timers and published bindings. */
  dispose(): void {
    this.disposed = true;
    clearTimeout(this.pendingSeek);
    this.pendingSeek = undefined;
    if (this.bindingState.overview.get() === this.bindings) {
      this.bindingState.overview.set(null);
    }
  }

  /** Pointer bindings for one overview strip. */
  private stripBindings(strip: HTMLCanvasElement) {
    return {
      pointerDown: (event: PointerEvent) => {
        if (this.disposed) {
          return;
        }
        this.seekingCanvas = strip;
        strip.setPointerCapture?.(event.pointerId);
        this.seekFromStrip(strip, event);
        this.previewOnStrip(strip, event);
      },
      pointerMove: (event: PointerEvent) => {
        if (this.disposed) {
          return;
        }
        if (this.seekingCanvas === strip) {
          this.seekFromStrip(strip, event);
        }
        this.previewOnStrip(strip, event);
      },
      pointerUp: (event: PointerEvent) => {
        if (this.disposed) {
          return;
        }
        if (this.seekingCanvas === strip) {
          this.seekFromStrip(strip, event, true);
          this.seekingCanvas = null;
        }
      },
      pointerLeave: () => {
        if (this.disposed) {
          return;
        }
        if (this.seekingCanvas !== strip) {
          this.options.thumbnail.hide();
        }
      },
    };
  }

  /** Chart duration in seconds, preferring the media duration. */
  private duration(): number {
    const snapshot = this.options.getSnapshot();
    this.options.activity.compile(snapshot.chart, snapshot.tempo);
    return snapshot.mediaDuration > 0 ? snapshot.mediaDuration : this.options.activity.duration;
  }

  /**
   * Show the hover preview for a strip.
   *
   * The preview is pinned to the strip's inner edge so it opens towards the
   * middle of the workspace rather than under the cursor.
   */
  private preview(strip: HTMLCanvasElement, seconds: number, clientY: number): void {
    const snapshot = this.options.getSnapshot();
    if (snapshot.atHome || !snapshot.hasDocument) {
      this.options.thumbnail.hide();
      return;
    }
    const rect = strip.getBoundingClientRect();
    const left = strip === this.options.densityCanvas;
    this.options.thumbnail.show({
      scene: {
        chart: snapshot.chart,
        tempo: snapshot.tempo,
        seconds,
        lineIndex: snapshot.lineIndex,
      },
      anchor: {
        y: clientY,
        edge: left ? rect.right : rect.left,
        side: left ? "left" : "right",
      },
    });
  }

  /** Convert a strip hover into a preview request for the matching chart time. */
  private previewOnStrip(strip: HTMLCanvasElement, event: PointerEvent): void {
    if (!this.options.hoverPreviewEnabled()) {
      this.options.thumbnail.hide();
      return;
    }
    const rect = strip.getBoundingClientRect();
    if (!rect.height) {
      return;
    }
    const ratio = clamp((event.clientY - rect.top) / rect.height, 0, 1);
    this.preview(strip, (1 - ratio) * this.duration(), event.clientY);
  }

  /** Seek to the chart time under the pointer, throttled unless `force` is set. */
  private seekFromStrip(strip: HTMLCanvasElement, event: PointerEvent, force = false): void {
    const rect = strip.getBoundingClientRect();
    if (!rect.height) {
      return;
    }
    const ratio = clamp((event.clientY - rect.top) / rect.height, 0, 1);
    this.pendingSeconds = (1 - ratio) * this.duration() + this.options.getSnapshot().offsetSeconds;
    const now = performance.now();
    const elapsed = now - this.lastSeek;
    if (!force && elapsed < 50) {
      if (!this.pendingSeek) {
        this.pendingSeek = setTimeout(() => {
          this.pendingSeek = undefined;
          this.lastSeek = performance.now();
          this.options.seek(this.pendingSeconds);
        }, 50 - elapsed);
      }
      return;
    }
    clearTimeout(this.pendingSeek);
    this.pendingSeek = undefined;
    this.lastSeek = now;
    this.options.seek(this.pendingSeconds);
  }
}
