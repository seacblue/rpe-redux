/**
 * Loads and analyses audio for the scrubber spectrum.
 *
 * Decoding and analysis are scheduled off the interaction path, so a long track
 * does not stall the first paint of the progress card. A-B loop state is not a
 * spectrum concern: the scrubber keeps one full-track analysis while the range
 * is rendered by the progress surface.
 */
import { analyzeAudioBuffer, type AudioAnalysisData } from "../../../core/media/audioAnalysis.ts";
import {
  getAudioAnalysisWorkerFactory,
  type AudioAnalysisWorkerFactory,
} from "../../contracts/audioAnalysisWorker.ts";
import type { ScrubberSpectrum } from "./scrubberSpectrum.ts";
import { yieldToHost } from "../../../core/utils/yieldToHost.ts";

type SpectrumSource = Uint8Array | string;
type AnalysisBuffer = Parameters<typeof analyzeAudioBuffer>[0];
type AnalysisOptions = NonNullable<Parameters<typeof analyzeAudioBuffer>[1]>;

interface SpectrumAudioDecoder {
  decodeForAnalysis(source: SpectrumSource): Promise<AnalysisBuffer | null>;
}

interface SpectrumLoaderDependencies {
  audio: SpectrumAudioDecoder;
  spectrum: Pick<ScrubberSpectrum, "clear" | "setData">;
  schedule?: (task: () => void) => void;
  analyze?: (buffer: AnalysisBuffer, options?: AnalysisOptions) => AudioAnalysisData | null;
}

const ANALYSIS_OPTIONS: AnalysisOptions = {
  waveformSize: 512,
  spectrumFrames: 512,
  bands: 24,
};
const ANALYSIS_CHUNK_SAMPLES = 262144;

const defaultAnalyze = (buffer: AnalysisBuffer, options: AnalysisOptions = ANALYSIS_OPTIONS) =>
  analyzeAudioBuffer(buffer, options);

/** Runs the task when the host is idle, or after a short timeout otherwise. */
function scheduleIdle(task: () => void): void {
  if (typeof window !== "undefined" && typeof window.requestIdleCallback === "function") {
    // A busy first render must not starve the waveform forever.
    window.requestIdleCallback(task, { timeout: 1000 });
  } else {
    setTimeout(task, 16);
  }
}

/** Decodes and analyses scrubber artwork without blocking music playback. */
export function createScrubberSpectrumLoader({
  audio,
  spectrum,
  schedule = scheduleIdle,
  analyze = defaultAnalyze,
}: SpectrumLoaderDependencies) {
  let revision = 0;
  let activeWorker: Worker | null = null;
  let cancelActive: (() => void) | null = null;

  /** Terminate the worker currently running, if any, and release its abort hook. */
  function stopActiveWorker(): void {
    activeWorker?.terminate();
    activeWorker = null;
    cancelActive?.();
    cancelActive = null;
  }

  /** Invalidate the pending request and clear the canvas. */
  function clear(): void {
    revision += 1;
    stopActiveWorker();
    spectrum.clear();
  }

  /** Stream the buffer to an analysis worker; null when superseded. */
  async function analyzeStreamed(
    buffer: AnalysisBuffer,
    isCurrent: () => boolean,
    createWorker: AudioAnalysisWorkerFactory,
    options: AnalysisOptions,
  ): Promise<AudioAnalysisData | null> {
    const worker = createWorker();
    activeWorker = worker;
    let resolveAbort = () => {};
    const aborted = new Promise<void>((resolve) => {
      resolveAbort = resolve;
    });
    cancelActive = resolveAbort;
    const channelCount = Math.max(1, buffer.numberOfChannels);
    const sourceChannels = Array.from({ length: channelCount }, (_, channel) =>
      buffer.getChannelData(channel),
    );
    try {
      worker.postMessage({
        type: "start",
        length: buffer.length,
        numberOfChannels: channelCount,
        duration: buffer.duration,
        options,
      });
      for (let offset = 0; offset < buffer.length; offset += ANALYSIS_CHUNK_SAMPLES) {
        if (!isCurrent()) {
          return null;
        }
        const end = Math.min(buffer.length, offset + ANALYSIS_CHUNK_SAMPLES);
        const chunks = sourceChannels.map((channel) => channel.slice(offset, end));
        worker.postMessage(
          { type: "chunk", offset, channels: chunks },
          chunks.map((chunk) => chunk.buffer),
        );
        await Promise.race([yieldToHost(), aborted]);
      }
      if (!isCurrent()) {
        return null;
      }
      worker.postMessage({ type: "finish" });
      const done = new Promise<AudioAnalysisData | null>((resolve, reject) => {
        worker.onmessage = (
          event: MessageEvent<{ type: "done"; data: AudioAnalysisData | null }>,
        ) => {
          if (event.data?.type === "done") {
            resolve(event.data.data);
          }
        };
        worker.onerror = (event) => reject(new Error(event.message));
      });
      return await Promise.race([done, aborted.then(() => null)]);
    } finally {
      worker.terminate();
      if (activeWorker === worker) {
        activeWorker = null;
        cancelActive = null;
      }
    }
  }

  /** Schedules decode and analysis for a new source, discarding any older request. */
  function queue(source: SpectrumSource): void {
    const request = (revision += 1);
    stopActiveWorker();
    spectrum.clear();
    schedule(() => {
      void (async () => {
        const buffer = await audio.decodeForAnalysis(source);
        if (!buffer || request !== revision) {
          return;
        }
        let createWorker: AudioAnalysisWorkerFactory | null = null;
        if (typeof Worker !== "undefined" && analyze === defaultAnalyze) {
          try {
            createWorker = getAudioAnalysisWorkerFactory();
          } catch {
            createWorker = null;
          }
        }
        const data = createWorker
          ? await analyzeStreamed(
              buffer,
              () => request === revision,
              createWorker,
              ANALYSIS_OPTIONS,
            )
          : analyze(buffer, ANALYSIS_OPTIONS);
        if (request === revision) {
          spectrum.setData(data);
        }
      })().catch(() => {
        // Spectrum failures are non-fatal; playback continues without artwork.
      });
    });
  }

  return { clear, queue, dispose: clear };
}
