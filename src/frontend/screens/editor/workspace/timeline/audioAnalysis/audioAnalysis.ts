/**
 * Owns the timeline audio-analysis overlay controller: requests decoded audio,
 * streams it through workers, caches waveform and spectrum results, and paints
 * the analysis against the timeline viewport.
 *
 * Decoding stays behind the injected audio source and the analysis math lives in
 * `core/media`; this module owns worker lifecycle, overlay drawing, and visibility.
 */
import {
  analyzeAudioBuffer,
  shapeWaveform,
  type AudioAnalysisData,
  type AudioBufferLike,
  type WaveformChannel,
} from "../../../../../../core/media/audioAnalysis.ts";
import { clamp01 } from "../../../../../../core/utils/numbers.ts";
import { createValue, type ValueCell } from "../../../../../../core/state/values.ts";
import { readCanvasPalette } from "../../../canvas/palette.ts";
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
  /** Perceptual emphasis for the signed min/max envelope. */
  curve: number;
  data: AudioAnalysisData | null;
  /** Fields populated by the first cancellation or analysis request. */
  source?: unknown;
  revision?: number;
  /** The source whose waveform was already requested, so a failure does not retry every frame. */
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
    this.alpha = 0.2;
    this.width = 0.62;
    this.curve = 1.5;
    this.data = null;
    this.visibility.set(false);
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
    this.data = null;
    this.draw();
  }
  /** Use an already decoded buffer and analyze it synchronously. */
  setBuffer(buffer: AudioBufferLike | null): void {
    this.cancel();
    this.source = null;
    this.data = buffer ? analyzeAudioBuffer(buffer) : null;
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
        this.data = analyzeAudioBuffer(buffer);
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
            this.data = event.data.data;
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

  /** Paint the waveform against the timeline viewport; `offsetSeconds` shifts the sampled time. */
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
    // waveform when the row is switched on. `pending` prevents a second decode
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
    const curve = this.curve;
    const stereo = source.channels > 1;
    const chartTimeAt = (y: number) => timeline.viewport.timeAt(y - top);
    const sampleChannel = (
      channel: WaveformChannel,
      fromSeconds: number,
      toSeconds: number,
    ): { min: number; max: number } => {
      const length = Math.min(channel.min.length, channel.max.length);
      if (length === 0 || source.duration <= 0) {
        return { min: 0, max: 0 };
      }
      const lowSeconds = Math.min(fromSeconds, toSeconds);
      const highSeconds = Math.max(fromSeconds, toSeconds);
      if (highSeconds < 0 || lowSeconds > source.duration) {
        return { min: 0, max: 0 };
      }
      const low = clamp01(lowSeconds / source.duration) * (length - 1);
      const high = clamp01(highSeconds / source.duration) * (length - 1);
      const start = Math.floor(low);
      const end = Math.max(start, Math.min(length - 1, Math.ceil(high)));
      let minimum = Number.POSITIVE_INFINITY;
      let maximum = Number.NEGATIVE_INFINITY;
      for (let index = start; index <= end; index++) {
        minimum = Math.min(minimum, channel.min[index] ?? 0);
        maximum = Math.max(maximum, channel.max[index] ?? 0);
      }
      if (!Number.isFinite(minimum)) {
        return { min: 0, max: 0 };
      }
      return {
        min: Math.max(-1, Math.min(1, shapeWaveform(minimum, curve))),
        max: Math.max(-1, Math.min(1, shapeWaveform(maximum, curve))),
      };
    };
    const points: {
      y: number;
      left: { min: number; max: number };
      right: { min: number; max: number };
    }[] = [];
    for (let y = top; y <= bottom; y += 1) {
      const from = chartTimeAt(y) + offsetSeconds;
      const to = chartTimeAt(y + 1) + offsetSeconds;
      points.push({
        y,
        left: sampleChannel(source.left, from, to),
        right: sampleChannel(source.right, from, to),
      });
    }
    const lanePath = (channel: "left" | "right", laneCenter: number) => {
      context.beginPath();
      points.forEach((point, index) => {
        const value = point[channel];
        const x = laneCenter + value.max * bandHalf;
        if (index === 0) {
          context.moveTo(x, point.y);
        } else {
          context.lineTo(x, point.y);
        }
      });
      for (let index = points.length - 1; index >= 0; index--) {
        const point = points[index];
        const value = point[channel];
        context.lineTo(laneCenter + value.min * bandHalf, point.y);
      }
      context.closePath();
    };
    const stereoPath = (channel: "left" | "right", direction: -1 | 1, close: boolean) => {
      context.beginPath();
      points.forEach((point, index) => {
        const value = point[channel];
        const amplitude = Math.max(Math.abs(value.min), Math.abs(value.max));
        const x = center + direction * amplitude * bandHalf;
        if (index === 0) {
          context.moveTo(x, point.y);
        } else {
          context.lineTo(x, point.y);
        }
      });
      if (close) {
        context.lineTo(center, bottom);
        context.lineTo(center, top);
        context.closePath();
      }
    };

    context.save();
    context.beginPath();
    context.rect(left, top, right - left, timelineHeight);
    context.clip();

    // A soft signed body with a brighter edge. Stereo is one waveform cut at
    // the centreline: the left channel fills the left half and the right
    // channel fills the right half, so the two sources never overlap.
    context.fillStyle = palette.foreground;
    context.globalAlpha = alpha * 0.22;
    if (stereo) {
      stereoPath("left", -1, true);
      context.fill();
      stereoPath("right", 1, true);
      context.fill();
    } else {
      lanePath("left", center);
      context.fill();
    }

    context.globalAlpha = alpha * 0.5;
    context.strokeStyle = palette.foreground;
    context.lineWidth = 1;
    if (stereo) {
      stereoPath("left", -1, false);
      context.stroke();
      stereoPath("right", 1, false);
      context.stroke();
    } else {
      lanePath("left", center);
      context.stroke();
    }

    // The centre line separates the stereo lanes and remains the timeline's
    // time axis in mono, where both channels share one lane.
    context.globalAlpha = alpha * 0.25;
    context.strokeStyle = palette.gridMajor;
    context.beginPath();
    context.moveTo(center + 0.5, top);
    context.lineTo(center + 0.5, bottom);
    context.stroke();
    context.restore();
  }
}
