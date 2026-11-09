/**
 * The timing detector's worker message contract.
 *
 * The worker and the synchronous fallback both analyze one already-mixed mono
 * signal through this function, so their reply shape cannot drift. A result is
 * one measured BPM/offset plus its preview arrays, or `null`; only those three
 * buffers are transferred back to the dialog.
 */
import {
  detectAutoTimingFromSamples,
  type BeatDetectionResult,
} from "../../../../../core/media/beatDetection.ts";

/** A request to analyze one already-mixed mono signal. */
export interface TimingDetectionRequest {
  type: "analyze";
  samples: Float32Array;
  sampleRate: number;
  duration: number;
}

/** A measured fixed-BPM result, a not-found answer, or a diagnostic string. */
export type TimingDetectionReply =
  { type: "result"; result: BeatDetectionResult | null } | { type: "error"; message: string };

/** One reply plus the buffers the worker must transfer. */
export interface TimingDetectionMessage {
  reply: TimingDetectionReply;
  transfer: Transferable[];
}

/** Run one analysis request and describe how to post the reply. */
export function analyzeTimingRequest(data: TimingDetectionRequest): TimingDetectionMessage {
  try {
    const result = detectAutoTimingFromSamples(data.samples, data.sampleRate, data.duration);
    if (!result) {
      return { reply: { type: "result", result: null }, transfer: [] };
    }
    return {
      reply: { type: "result", result },
      transfer: [result.waveform.peaks.buffer, result.onset.buffer, result.beatTimes.buffer],
    };
  } catch (error) {
    return {
      reply: { type: "error", message: error instanceof Error ? error.message : String(error) },
      transfer: [],
    };
  }
}
