/**
 * Worker entry point for automatic fixed-BPM timing detection.
 *
 * The main thread mixes the decoded buffer, transfers one mono array, and gets
 * the measured answer plus its preview arrays, or `null`, back. The algorithm
 * stays in `core/media/beatDetection.ts`; the message shape lives in
 * `timingDetectionWorkerProtocol.ts` so the synchronous fallback shares it.
 */
import {
  analyzeTimingRequest,
  type TimingDetectionReply,
  type TimingDetectionRequest,
} from "./timingDetectionWorkerProtocol.ts";

interface TimingDetectionScope {
  onmessage: ((event: MessageEvent<TimingDetectionRequest>) => void) | null;
  postMessage(message: TimingDetectionReply, transfer: Transferable[]): void;
}

const worker = self as TimingDetectionScope;

worker.onmessage = ({ data }) => {
  if (data.type !== "analyze") {
    return;
  }
  const { reply, transfer } = analyzeTimingRequest(data);
  worker.postMessage(reply, transfer);
};
