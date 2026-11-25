/**
 * The timing detector's worker message contract.
 *
 * The worker and the synchronous fallback both analyze one already-mixed mono
 * signal through this function, so their reply shape cannot drift. A result is
 * one measured BPM/offset plus its preview arrays, or `null`; only those three
 * buffers are transferred back to the dialog.
 */
import {
  detectBestFixedTimingFromSamples,
  type BeatDetectionResult,
} from "../../../../../core/media/beatDetection.ts";
import { detectLearnedFixedTimingFromSamples } from "./learnedBeatDetector.ts";

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
    // Run both fixed-grid estimators and let their shared evidence scorer pick
    // one answer, so the UI never needs to expose a detector choice.
    const result = detectBestFixedTimingFromSamples(data.samples, data.sampleRate, data.duration);
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

/** Run the learned refinement and fall back to the synchronous detector safely. */
export async function analyzeTimingRequestAsync(
  data: TimingDetectionRequest,
): Promise<TimingDetectionMessage> {
  try {
    const baseline = detectBestFixedTimingFromSamples(data.samples, data.sampleRate, data.duration);
    if (!baseline) {
      return { reply: { type: "result", result: null }, transfer: [] };
    }
    const learned = await detectLearnedFixedTimingFromSamples(
      data.samples,
      data.sampleRate,
      data.duration,
      baseline,
    );
    return timingDetectionMessage(learned ?? baseline);
  } catch (error) {
    return {
      reply: { type: "error", message: error instanceof Error ? error.message : String(error) },
      transfer: [],
    };
  }
}

/** Describe a result and the buffers that can be transferred to the dialog. */
function timingDetectionMessage(result: BeatDetectionResult): TimingDetectionMessage {
  return {
    reply: { type: "result", result },
    transfer: [result.waveform.peaks.buffer, result.onset.buffer, result.beatTimes.buffer],
  };
}
