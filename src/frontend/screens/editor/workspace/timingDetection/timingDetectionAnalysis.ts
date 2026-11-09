/**
 * Runs automatic fixed-BPM timing detection off the UI thread.
 *
 * The decoded buffer is mixed on the main thread (the worker receives one mono
 * array), then a short-lived worker returns the measured BPM/offset and preview
 * arrays, or `null` when no clear beat exists. A missing worker falls back to
 * the same protocol function synchronously so the feature still works in a
 * restricted WebView.
 */
import { mixToMono, type BeatDetectionResult } from "../../../../../core/media/beatDetection.ts";
import {
  analyzeTimingRequest,
  type TimingDetectionReply,
} from "./timingDetectionWorkerProtocol.ts";

/** Analyze one decoded buffer, aborting cleanly when the dialog closes. */
export async function analyzeTiming(
  buffer: AudioBuffer,
  signal?: AbortSignal,
): Promise<BeatDetectionResult | null> {
  if (signal?.aborted) {
    return null;
  }
  const samples = mixToMono(buffer);
  if (!samples.length) {
    return null;
  }
  if (typeof Worker === "undefined") {
    const { reply } = analyzeTimingRequest({
      type: "analyze",
      samples,
      sampleRate: buffer.sampleRate,
      duration: buffer.duration,
    });
    if (reply.type === "error") {
      throw new Error(reply.message);
    }
    return reply.result;
  }
  return new Promise<BeatDetectionResult | null>((resolve, reject) => {
    let settled = false;
    const worker = new Worker(new URL("./timingDetection.worker.ts", import.meta.url), {
      type: "module",
    });
    const finish = (result: BeatDetectionResult | null): void => {
      if (settled) {
        return;
      }
      settled = true;
      signal?.removeEventListener("abort", abort);
      worker.terminate();
      resolve(result);
    };
    const fail = (error: unknown): void => {
      if (settled) {
        return;
      }
      settled = true;
      signal?.removeEventListener("abort", abort);
      worker.terminate();
      reject(error);
    };
    const abort = (): void => {
      finish(null);
    };
    signal?.addEventListener("abort", abort, { once: true });
    worker.onmessage = (event: MessageEvent<TimingDetectionReply>) => {
      if (event.data.type === "error") {
        fail(new Error(event.data.message));
        return;
      }
      finish(event.data.result);
    };
    worker.onerror = () => {
      // The mono array has already been transferred, so the main thread no
      // longer owns a copy to retry with synchronously. Report the failure and
      // let the dialog offer its explicit retry.
      fail(new Error("Timing detection worker failed"));
    };
    worker.postMessage(
      {
        type: "analyze",
        samples,
        sampleRate: buffer.sampleRate,
        duration: buffer.duration,
      },
      [samples.buffer],
    );
  });
}
