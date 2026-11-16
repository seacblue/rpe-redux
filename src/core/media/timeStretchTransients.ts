/** Runs optional time-stretch transient detection in a dedicated worker. */
import { detectTransients } from "./timeStretchCore.ts";

interface TransientRequest {
  channels: Float32Array[];
  sampleRate: number;
}

interface TransientWorkerScope {
  onmessage: ((event: MessageEvent<TransientRequest>) => void) | null;
  postMessage(message: unknown, transfer: Transferable[]): void;
}

/** Worker surface kept local because the project DOM lib does not include WebWorker types. */
const worker = self as TransientWorkerScope;

worker.onmessage = ({ data }) => {
  const transients = detectTransients(data.channels, data.sampleRate);
  worker.postMessage({ transients }, [transients.buffer]);
};
