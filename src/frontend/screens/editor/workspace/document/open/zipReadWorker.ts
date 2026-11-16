/**
 * Worker entry for PEZ archive reads: forwards progress and the extracted
 * entries for one request. ZIP limits arrive from the caller; the archive format
 * itself lives in core utils.
 */
import { readZip, type ZipLimits } from "../../../../../../core/utils/zip.ts";

interface ZipRequest {
  id: number;
  buffer: ArrayBuffer;
  limits: ZipLimits;
}

interface ZipProgress {
  id: number;
  kind: "progress";
  completed: number;
  total: number;
}

interface ZipResult {
  id: number;
  kind: "result";
  names: string[];
  entries: Array<{ name: string; bytes: ArrayBuffer }>;
}

/** Worker scope typed for the archive request/response protocol. */
const workerScope = globalThis as typeof globalThis & {
  onmessage: ((event: MessageEvent<ZipRequest>) => void) | null;
  postMessage(message: ZipProgress | ZipResult, transfer?: Transferable[]): void;
};

/** Reads one archive and forwards progress and extracted entries. */
workerScope.onmessage = async (event) => {
  const { id, buffer, limits } = event.data;
  const names: string[] = [];
  let files;
  if (limits.only?.length) {
    files = await readZip(buffer, {
      ...limits,
      onProgress: (completed, total) => {
        workerScope.postMessage({ id, kind: "progress", completed, total });
      },
    });
  } else {
    // Read the directory once, retaining every name while inflating only chart
    // JSON and metadata sidecars needed before the editor reaches its first
    // frame. Skipped entries still pass ZIP bounds, method, and duplicate-name
    // validation in readZip.
    const initialEntryFilter = (name: string): boolean =>
      /(^|\/)info\.txt$/i.test(name) || /(^|\/)extra\.json$/i.test(name);
    files = await readZip(buffer, {
      ...limits,
      entryFilter: initialEntryFilter,
      onEntryName: (name) => names.push(name),
      onProgress: (completed, total) => {
        workerScope.postMessage({ id, kind: "progress", completed, total });
      },
    });
  }
  const entries = [...files].map(([name, bytes]) => ({ name, bytes: bytes.slice().buffer }));
  workerScope.postMessage(
    {
      id,
      kind: "result",
      names: names.length ? names : entries.map((entry) => entry.name),
      entries,
    },
    entries.map(({ bytes }) => bytes),
  );
};
