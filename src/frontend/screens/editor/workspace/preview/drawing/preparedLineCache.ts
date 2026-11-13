/** Reuses preview line preparation objects across frames to reduce GC pressure. */
import type {
  LineRuntime,
  SampledLineState,
} from "../../../../../../core/global/chart/runtime/scene.ts";

/** Per-frame line values shared by the Hold and ordinary-note passes. */
export interface PreparedPreviewLine {
  frame: number;
  state: SampledLineState;
  runtime: LineRuntime;
  selectedNotes: ReadonlySet<number> | undefined;
  centerX: number;
  centerY: number;
  rotation: number;
  cosine: number;
  sine: number;
  holdCapScale: number;
  lineScaleX: number;
  lineScaleY: number;
  isNoiseLine: boolean;
}

interface PreparedLineCache {
  generation: number;
  entries: Array<PreparedPreviewLine | undefined>;
}

const preparedLineCaches = new WeakMap<object, PreparedLineCache>();

/** Retain per-line preparation storage while invalidating values by frame generation. */
export function preparedLineCache(surface: object): PreparedLineCache {
  const existing = preparedLineCaches.get(surface);
  if (existing) {
    existing.generation += 1;
    return existing;
  }
  const created: PreparedLineCache = { generation: 1, entries: [] };
  preparedLineCaches.set(surface, created);
  return created;
}
