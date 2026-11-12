/**
 * Worker entry point that accumulates streamed channel chunks and runs the core
 * waveform and spectrum analysis off the main thread.
 *
 * It owns the worker message protocol only; the algorithms stay in
 * `core/media/audioAnalysis.ts`.
 */
import {
  analyzeAudioBuffer,
  type AudioAnalysisOptions,
} from "../../../../../../../core/media/audioAnalysis.ts";

/** Payloads the editor posts while streaming a decoded audio buffer. */
type AudioAnalysisRequest =
  | {
      type: "start";
      length: number;
      numberOfChannels: number;
      duration: number;
      options?: AudioAnalysisOptions;
    }
  | {
      type: "chunk";
      offset: number;
      channels: Float32Array[];
    }
  | { type: "finish" };

/**
 * The dedicated-worker globals this entry point uses. `self` is declared as
 * `Window & typeof globalThis` by the DOM lib (the WebWorker lib is not part of
 * this project's `lib`) and `Window.postMessage` cannot express the
 * `(message, transfer[])` form, so the worker surface is named here.
 */
interface AudioAnalysisScope {
  onmessage: ((event: MessageEvent<AudioAnalysisRequest>) => void) | null;
  postMessage(message: unknown, transfer: Transferable[]): void;
}

const worker = self as AudioAnalysisScope;
let length = 0;
let numberOfChannels = 0;
let duration = 0;
let options: AudioAnalysisOptions | undefined;
let channels: Float32Array[] = [];

worker.onmessage = ({ data }) => {
  if (data.type === "start") {
    length = data.length;
    numberOfChannels = data.numberOfChannels;
    duration = data.duration;
    options = data.options;
    channels = Array.from({ length: numberOfChannels }, () => new Float32Array(length));
    return;
  }
  if (data.type === "chunk") {
    for (let channel = 0; channel < data.channels.length; channel++) {
      const target = channels[channel];
      if (target) {
        target.set(data.channels[channel], data.offset);
      }
    }
    return;
  }
  if (data.type !== "finish") {
    return;
  }
  const result = analyzeAudioBuffer(
    {
      numberOfChannels,
      length,
      duration,
      getChannelData: (index) => channels[index] ?? new Float32Array(0),
    },
    options,
  );
  // `analyzeAudioBuffer` returns null when the buffer exposes no channel data;
  // there is nothing to hand back in that case.
  if (!result) {
    worker.postMessage({ type: "done", data: null }, []);
    return;
  }
  worker.postMessage({ type: "done", data: result }, [
    result.left.min.buffer,
    result.left.max.buffer,
    result.right.min.buffer,
    result.right.max.buffer,
    result.spectrum.buffer,
  ]);
};
