/** Shared progress mapping for imports that read, unpack, and write a chart. */
import type { LoadStage } from "../../../core/global/document/loading.ts";

export { throwIfAborted } from "../../../core/utils/abort.ts";

const LOAD_SPANS: Partial<Record<LoadStage, readonly [number, number]>> = {
  read: [0, 0.35],
  unpack: [0.35, 0.55],
  parse: [0.55, 0.8],
};

/** Map one native load phase into the monotonic progress range owned by import. */
export function importLoadProgress(
  stage: LoadStage,
  completed: number,
  total: number,
): number | null {
  const span = LOAD_SPANS[stage];
  if (!span || total <= 0 || !Number.isFinite(completed) || !Number.isFinite(total)) {
    return span ? span[0] : null;
  }
  const fraction = Math.max(0, Math.min(1, completed / total));
  return span[0] + (span[1] - span[0]) * fraction;
}

/** Reserve the final progress range for the library write. */
export function importWriteProgress(value: number): number {
  const fraction = Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
  return 0.8 + fraction * 0.2;
}
