/**
 * Runs PEZ archive reads in a worker when the host provides one, preserving ZIP
 * limits and progress. `readZip` remains the in-process fallback and the only
 * archive implementation.
 */
import { readZip } from "../../../../../../core/utils/zip.ts";
import type { ArchiveReader } from "../../../../../../core/global/document/pez.ts";

interface ZipProgress {
  id: number;
  kind: "progress";
  completed: number;
  total: number;
}

interface ZipResult {
  id: number;
  kind: "result";
  entries: Array<{ name: string; bytes: ArrayBuffer }>;
}

let nextRequestId = 1;

/** Read a PEZ archive off the UI thread while preserving ZIP limits and progress. */
export const readZipOffThread: ArchiveReader = (buffer, limits, onProgress) => {
  if (typeof Worker === "undefined") {
    return readZip(buffer, { ...limits, onProgress });
  }
  const worker = new Worker(new URL("./zipReadWorker.ts", import.meta.url), {
    type: "module",
  });
  const id = nextRequestId++;
  const source = buffer instanceof Uint8Array ? buffer.slice().buffer : buffer.slice(0);
  // The progress callback stays local; only the numeric limits cross the
  // worker boundary, because functions cannot be structured-cloned.
  const { onProgress: limitsProgress, ...workerLimits } = limits;
  const progress = onProgress ?? limitsProgress;
  return new Promise<Map<string, Uint8Array>>((resolve) => {
    const finish = (): void => worker.terminate();
    worker.onmessage = (event: MessageEvent<ZipProgress | ZipResult>) => {
      if (event.data.id !== id) {
        return;
      }
      if (event.data.kind === "progress") {
        void progress?.(event.data.completed, event.data.total);
        return;
      }
      finish();
      resolve(new Map(event.data.entries.map(({ name, bytes }) => [name, new Uint8Array(bytes)])));
    };
    worker.onerror = () => {
      finish();
      resolve(readZip(buffer, { ...workerLimits, onProgress: progress }));
    };
    worker.postMessage({ id, buffer: source, limits: workerLimits }, [source]);
  });
};
