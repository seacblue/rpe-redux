/**
 * Owns the timeline audio-analysis overlay controller: requests decoded audio,
 * streams it through workers, caches the spectrum, and paints the mirrored
 * heatmap against the timeline viewport.
 *
 * Decoding stays behind the injected audio source and the analysis math lives in
 * `core/media`; this module owns worker lifecycle, overlay drawing, and visibility.
 */
import {
  analyzeAudioBuffer,
  type AudioAnalysisData,
  type AudioBufferLike,
} from "../../../../../../core/media/audioAnalysis.ts";
import {
  paintVerticalSpectrogramPixels,
  type SpectrogramRgb,
} from "../../../../../../core/media/spectrumPixels.ts";
import { clamp01 } from "../../../../../../core/utils/numbers.ts";
import { createValue, type ValueCell } from "../../../../../../core/state/values.ts";
import { readCanvasPalette, rgbChannels } from "../../../canvas/palette.ts";
import { measureElementRect, prepareCanvas } from "../../../canvas/canvas2d.ts";
import { yieldToHost } from "../../../../../../core/utils/yieldToHost.ts";
/** Large enough to keep worker traffic low, small enough to keep copying off the frame. */
const ANALYSIS_CHUNK_SAMPLES = 262144;

export type AudioAnalysisVisibility = ValueCell<boolean>;

/** Creates the cell that tells the overlay canvas whether the graph has content. */
export function createAudioAnalysisVisibility(): AudioAnalysisVisibility {
  return createValue({ initial: false });
}

/** Timeline slice needed to position the analysis graph. */
export interface AnalysisTimeline {
  notesCanvas?: { getBoundingClientRect(): DOMRect };
  getSession?(): { notesMode?: "single" | "multi_merged" | "multi" } | null;
  viewport: { timeAt(y: number): number };
}

/** The only audio-decoder capability required by the analysis graph. */
export interface AnalysisAudioSource {
  decodeForAnalysis(source: unknown): Promise<AudioBufferLike | null>;
}

/** Streams decoded audio through a worker and paints the analysis into the timeline viewport. */
export class AudioAnalysis {
  canvas: HTMLCanvasElement | null;
  getTimeline: () => AnalysisTimeline | null | undefined;
  getAudio: () => AnalysisAudioSource;
  visibility: AudioAnalysisVisibility;
  enabled: boolean;
  alpha: number;
  width: number;
  /** Perceptual emphasis for the heatmap's energy ramp. */
  curve: number;
  data: AudioAnalysisData | null;
  /** Bumped whenever `data` is replaced so the cached image cannot outlive it. */
  dataRevision: number;
  /** Mirrored spectrum image at analysis resolution, reused across frames. */
  heatmap: HTMLCanvasElement | null;
  heatmapKey: string;
  /** Fields populated by the first cancellation or analysis request. */
  source?: unknown;
  revision?: number;
  /** The source whose analysis was already requested, so a failure does not retry every frame. */
  requestedSource?: unknown;
  worker?: Worker | null;
  cancelPending?: (() => void) | null;
  pending?: Promise<void> | null;

  /** Create the controller around the overlay canvas and its runtime seams. */
  constructor(
    canvas: HTMLCanvasElement | null,
    getTimeline: () => AnalysisTimeline | null | undefined,
    getAudio: () => AnalysisAudioSource,
    visibility: AudioAnalysisVisibility,
  ) {
    this.canvas = canvas;
    this.getTimeline = getTimeline;
    this.getAudio = getAudio;
    this.visibility = visibility;
    this.enabled = false;
    this.alpha = 0.3;
    this.width = 0.62;
    this.curve = 1.5;
    this.data = null;
    this.dataRevision = 0;
    this.heatmap = null;
    this.heatmapKey = "";
    this.visibility.set(false);
  }

  /** Replace the analysis and invalidate the cached heatmap image. */
  private replaceData(data: AudioAnalysisData | null): void {
    this.data = data;
    this.dataRevision += 1;
    this.heatmap = null;
    this.heatmapKey = "";
  }

  /** Abort any in-flight analysis, drop the worker, and clear the pending request. */
  cancel(): void {
    this.revision = (this.revision ?? 0) + 1;
    this.requestedSource = undefined;
    this.worker?.terminate();
    this.cancelPending?.();
    this.cancelPending = null;
    this.worker = null;
    this.pending = null;
  }
  /** Set the audio source to decode lazily; clears the previous graph. */
  setSource(source: unknown): void {
    this.cancel();
    this.source = source;
    this.replaceData(null);
    this.draw();
  }
  /** Use an already decoded buffer and analyze it synchronously. */
  setBuffer(buffer: AudioBufferLike | null): void {
    this.cancel();
    this.source = null;
    this.replaceData(buffer ? analyzeAudioBuffer(buffer) : null);
    this.draw();
  }
  /** Decode and analyze the current source once, sharing the pending run with later callers. */
  async ensureData(): Promise<void> {
    if (this.data || !this.source) {
      return;
    }
    if (this.pending) {
      return this.pending;
    }
    const revision = this.revision;
    const run = async (): Promise<void> => {
      const buffer = await this.getAudio().decodeForAnalysis(this.source);
      if (!buffer || revision !== this.revision) {
        return;
      }
      if (typeof Worker === "undefined") {
        this.replaceData(analyzeAudioBuffer(buffer));
        this.draw();
        return;
      }
      const channelCount = Math.max(1, buffer.numberOfChannels);
      const sourceChannels = Array.from({ length: channelCount }, (_, channel) =>
        buffer.getChannelData(channel),
      );
      const worker = new Worker(new URL("./workers/audioAnalysis.ts", import.meta.url), {
        type: "module",
      });
      this.worker = worker;
      let resolveAbort = () => {};
      const aborted = new Promise<void>((resolve) => {
        resolveAbort = resolve;
      });
      let resolveDone = () => {};
      const done = new Promise<void>((resolve, reject) => {
        resolveDone = resolve;
        worker.onmessage = (
          event: MessageEvent<{ type: "done"; data: AudioAnalysisData | null }>,
        ) => {
          if (event.data?.type === "done" && revision === this.revision) {
            this.replaceData(event.data.data);
          }
          resolve();
        };
        worker.onerror = (event) => reject(new Error(event.message));
      });
      // Cancellation resolves both the abort and completion promises so the
      // streaming loop cannot outlive `cancel()`.
      this.cancelPending = () => {
        resolveAbort();
        resolveDone();
      };
      worker.postMessage({
        type: "start",
        length: buffer.length,
        numberOfChannels: channelCount,
        duration: buffer.duration,
      });
      try {
        for (let offset = 0; offset < buffer.length; offset += ANALYSIS_CHUNK_SAMPLES) {
          if (revision !== this.revision) {
            return;
          }
          const end = Math.min(buffer.length, offset + ANALYSIS_CHUNK_SAMPLES);
          const chunks = sourceChannels.map((channel) => channel.slice(offset, end));
          worker.postMessage(
            { type: "chunk", offset, channels: chunks },
            chunks.map((chunk) => chunk.buffer),
          );
          await Promise.race([yieldToHost(), aborted]);
          if (revision !== this.revision) {
            return;
          }
        }
        worker.postMessage({ type: "finish" });
        await Promise.race([done, aborted]);
      } finally {
        worker.terminate();
        if (this.worker === worker) {
          this.worker = null;
        }
        this.cancelPending = null;
      }
      if (revision !== this.revision) {
        return;
      }
      this.draw();
    };
    const pending = run().finally(() => {
      if (revision === this.revision) {
        this.pending = null;
      }
    });
    this.pending = pending;
    return pending;
  }

  /** Build or reuse the mirrored spectrum image for the current analysis and palette. */
  private spectrumImage(
    data: AudioAnalysisData,
    low: SpectrogramRgb,
    high: SpectrogramRgb,
  ): HTMLCanvasElement | null {
    if (typeof document === "undefined" || data.bands < 1 || data.frameCount < 1) {
      return null;
    }
    const curve = Number.isFinite(this.curve) ? Math.max(0.25, this.curve) : 1.5;
    const key = `${this.dataRevision}:${data.bands}:${data.frameCount}:${low.join(
      ",",
    )}:${high.join(",")}:${curve}`;
    if (this.heatmap && this.heatmapKey === key) {
      return this.heatmap;
    }
    const image = document.createElement("canvas");
    image.width = Math.max(2, data.bands * 2);
    image.height = Math.max(2, data.frameCount);
    const context = image.getContext("2d");
    if (!context) {
      return null;
    }
    const cells = context.createImageData(image.width, image.height);
    paintVerticalSpectrogramPixels(cells.data, image.width, image.height, data, {
      low,
      high,
      curve,
    });
    context.putImageData(cells, 0, 0);
    this.heatmap = image;
    this.heatmapKey = key;
    return image;
  }

  /** Paint the mirrored spectrum heatmap against the timeline viewport. */
  draw(offsetSeconds = 0): void {
    const canvas = this.canvas;
    if (!canvas || !this.enabled) {
      this.visibility.set(false);
      return;
    }
    const timeline = this.getTimeline?.();
    const session = timeline?.getSession?.();
    if (!timeline || session?.notesMode === "multi") {
      this.visibility.set(false);
      return;
    }
    // Loading the decoded data belongs to the graph, not to the settings
    // toggle: a chart opened while the feature was off must still gain its
    // heatmap when the row is switched on. `pending` prevents a second decode
    // from starting on the next frame.
    if (!this.data) {
      if (this.source && !this.pending && this.requestedSource !== this.source) {
        this.requestedSource = this.source;
        void this.ensureData().catch(() => undefined);
      }
      this.visibility.set(false);
      return;
    }
    const stage = canvas.parentElement;
    const notesCanvas = timeline.notesCanvas;
    if (!stage || !notesCanvas) {
      this.visibility.set(false);
      return;
    }
    const stageRect = measureElementRect(stage);
    const notesRect = measureElementRect(notesCanvas);
    if (!notesRect.width || !notesRect.height) {
      this.visibility.set(false);
      return;
    }
    this.visibility.set(true);
    const width = stageRect.width;
    const height = stageRect.height;
    if (!canvas.getContext("2d")) {
      return;
    }
    const { context } = prepareCanvas(canvas, true, { width, height });
    const top = Math.max(0, notesRect.top - stageRect.top);
    const bottom = Math.min(height, notesRect.bottom - stageRect.top);
    const left = Math.max(0, notesRect.left - stageRect.left);
    const right = Math.min(width, notesRect.right - stageRect.left);
    if (right <= left || bottom <= top) {
      this.visibility.set(false);
      return;
    }
    const center = (left + right) / 2;
    const bandHalf = Math.max(8, ((right - left) * clamp01(this.width)) / 2);
    const timelineHeight = bottom - top;
    const source = this.data;
    const palette = readCanvasPalette();
    const alpha = clamp01(this.alpha);
    const low: SpectrogramRgb = rgbChannels(palette.bottomValue) ?? [90, 169, 255];
    const high: SpectrogramRgb = rgbChannels(palette.foreground) ?? [255, 255, 255];
    const image = this.spectrumImage(source, low, high);
    if (!image || source.duration <= 0 || source.spectrum.length === 0) {
      this.visibility.set(false);
      return;
    }
    const chartTimeAt = (y: number) => timeline.viewport.timeAt(y - top);
    const from = chartTimeAt(top) + offsetSeconds;
    const to = chartTimeAt(bottom) + offsetSeconds;
    const timeLow = Math.min(from, to);
    const timeHigh = Math.max(from, to);
    const span = timeHigh - timeLow;
    const start = Math.max(0, timeLow);
    const end = Math.min(source.duration, timeHigh);
    if (span <= 0 || end <= start) {
      this.visibility.set(false);
      return;
    }
    const screenY = (seconds: number) => top + ((seconds - timeLow) / span) * timelineHeight;
    const drawTop = Math.min(screenY(start), screenY(end));
    const drawHeight = Math.abs(screenY(end) - screenY(start));

    context.save();
    context.beginPath();
    context.rect(left, top, right - left, timelineHeight);
    context.clip();
    context.globalAlpha = alpha;
    context.imageSmoothingEnabled = true;
    context.drawImage(
      image,
      0,
      (start / source.duration) * (image.height - 1),
      image.width,
      Math.max(1, ((end - start) / source.duration) * (image.height - 1)),
      center - bandHalf,
      drawTop,
      bandHalf * 2,
      Math.max(1, drawHeight),
    );

    // The centre line keeps the judge-line axis readable through the heatmap.
    context.globalAlpha = alpha * 0.25;
    context.strokeStyle = palette.gridMajor;
    context.beginPath();
    context.moveTo(center + 0.5, top);
    context.lineTo(center + 0.5, bottom);
    context.stroke();
    context.restore();
  }
}
