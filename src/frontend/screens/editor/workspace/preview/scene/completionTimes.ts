/**
 * Completion-time cache for the preview score/combo readout.
 *
 * A line's sorted completion times only depend on that line's note entries and
 * the tempo source. Edits usually replace one line, so caching per line avoids
 * filtering, mapping, and sorting every note in the chart on each commit.
 */
import type { JudgeLineNote } from "../../../../../../core/global/chart/chart.ts";
import type { NoteEntry } from "../../../../../../core/global/chart/runtime/scene.ts";
import type { TempoSource } from "../../../../../../core/global/chart/timing/events.ts";

/** Sorted score-completion times for one line's compiled note entries. */
export function completionTimesForEntries(entries: readonly NoteEntry[]): number[] {
  const times: number[] = [];
  for (const entry of entries) {
    if (entry.note.isFake) {
      continue;
    }
    times.push(entry.note.type === 2 ? entry.end : entry.start);
  }
  return times.sort((left, right) => left - right);
}

/** Merge already-sorted completion-time arrays into one sorted array. */
export function mergeCompletionTimes(parts: readonly (readonly number[])[]): number[] {
  if (parts.length === 0) {
    return [];
  }
  if (parts.length === 1) {
    return [...parts[0]];
  }
  let total = 0;
  for (const part of parts) {
    total += part.length;
  }
  const merged = new Array<number>(total);
  const heapParts: number[] = [];
  const heapIndices: number[] = [];
  const heapValues: number[] = [];
  const less = (left: number, right: number): boolean =>
    heapValues[left] < heapValues[right] ||
    (heapValues[left] === heapValues[right] && heapParts[left] < heapParts[right]);
  const swap = (left: number, right: number): void => {
    [heapParts[left], heapParts[right]] = [heapParts[right], heapParts[left]];
    [heapIndices[left], heapIndices[right]] = [heapIndices[right], heapIndices[left]];
    [heapValues[left], heapValues[right]] = [heapValues[right], heapValues[left]];
  };
  const push = (part: number, index: number): void => {
    let slot = heapParts.length;
    heapParts.push(part);
    heapIndices.push(index);
    heapValues.push(parts[part][index]);
    while (slot > 0) {
      const parent = (slot - 1) >>> 1;
      if (less(parent, slot)) {
        break;
      }
      swap(parent, slot);
      slot = parent;
    }
  };
  const replaceRoot = (part: number, index: number): void => {
    heapParts[0] = part;
    heapIndices[0] = index;
    heapValues[0] = parts[part][index];
    let slot = 0;
    while (true) {
      const left = slot * 2 + 1;
      if (left >= heapParts.length) {
        return;
      }
      const right = left + 1;
      const child = right < heapParts.length && less(right, left) ? right : left;
      if (less(slot, child)) {
        return;
      }
      swap(slot, child);
      slot = child;
    }
  };
  for (let part = 0; part < parts.length; part += 1) {
    if (parts[part].length) {
      push(part, 0);
    }
  }
  for (let output = 0; output < total; output += 1) {
    const part = heapParts[0];
    const index = heapIndices[0];
    merged[output] = heapValues[0];
    const next = index + 1;
    if (next < parts[part].length) {
      replaceRoot(part, next);
    } else {
      const last = heapParts.length - 1;
      if (last === 0) {
        heapParts.pop();
        heapIndices.pop();
        heapValues.pop();
      } else {
        const lastPart = heapParts[last];
        const lastIndex = heapIndices[last];
        heapParts.pop();
        heapIndices.pop();
        heapValues.pop();
        replaceRoot(lastPart, lastIndex);
      }
    }
  }
  return merged;
}

/** Per-line completion-time cache, rebuilt only for lines whose notes changed. */
export class CompletionTimesCache {
  private tempo: TempoSource | null = null;
  private sources: readonly (readonly JudgeLineNote[] | undefined)[] = [];
  private lineTimes: number[][] = [];
  private merged: number[] = [];

  /** Recompute changed lines and merge their sorted completion times. */
  update(
    lines: readonly { readonly notes: readonly NoteEntry[] }[],
    sources: readonly (readonly JudgeLineNote[] | undefined)[],
    tempo: TempoSource,
  ): number[] {
    const tempoChanged = this.tempo !== tempo;
    if (tempoChanged) {
      this.sources = [];
      this.lineTimes = [];
      this.tempo = tempo;
    }
    const previousSources = this.sources;
    let changed = tempoChanged || previousSources.length !== lines.length;
    if (this.lineTimes.length !== lines.length) {
      this.lineTimes.length = lines.length;
    }
    for (let index = 0; index < lines.length; index += 1) {
      if (tempoChanged || previousSources[index] !== sources[index] || !this.lineTimes[index]) {
        this.lineTimes[index] = completionTimesForEntries(lines[index]?.notes ?? []);
        changed = true;
      }
    }
    this.sources = sources;
    if (!changed && this.merged.length) {
      return this.merged;
    }
    this.merged = mergeCompletionTimes(this.lineTimes);
    return this.merged;
  }

  /** Drop every line result when the document closes. */
  clear(): void {
    this.tempo = null;
    this.sources = [];
    this.lineTimes = [];
    this.merged = [];
  }
}
