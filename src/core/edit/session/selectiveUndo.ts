/** Three-way compensation of a retained chart revision without overwriting later edits. */
import { assertChart, countScoringNotes, type Chart } from "../../global/chart/chart.ts";
import { remapSelection } from "./selectionHistory.ts";
import type { EditorSession } from "./session.ts";

const missing = Symbol("missing");

/** Builds a request id for a collaborative compensation entry. */
function collaborationRequestId(): string {
  const crypto = globalThis.crypto;
  return typeof crypto?.randomUUID === "function"
    ? crypto.randomUUID()
    : `undo-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}
type Value = unknown | typeof missing;
type MergeResult = { value: Value; conflicts: string[] };

/** True for a live plain object; `missing` and arrays are excluded. */
function object(value: Value): value is Record<string, unknown> {
  return value !== missing && value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Deep equality that treats `missing` as distinct from any value. */
function equal(a: Value, b: Value): boolean {
  if (Object.is(a, b)) {
    return true;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((value, index) => equal(value, b[index]));
  }
  if (!object(a) || !object(b)) {
    return false;
  }
  const keys = Object.keys(a);
  return (
    keys.length === Object.keys(b).length &&
    keys.every((key) => Object.hasOwn(b, key) && equal(a[key], b[key]))
  );
}

/** Indexes an array of id-bearing objects; null when ids are absent or repeated. */
function idMap(array: unknown[]): Map<string, unknown> | null {
  const result = new Map<string, unknown>();
  for (const item of array) {
    if (!object(item) || typeof item.id !== "string" || result.has(item.id)) {
      return null;
    }
    result.set(item.id, item);
  }
  return result;
}

/** Three-way merges arrays by id, or by index for fixed event layers. */
function mergeArray(
  before: unknown[],
  after: unknown[],
  current: unknown[],
  path: string,
): MergeResult {
  const old = idMap(before),
    changed = idMap(after),
    live = idMap(current);
  if (old && changed && live && (old.size || changed.size || live.size)) {
    // Line indices are referenced by numeric parent links; a topology change
    // cannot safely merge with intervening line changes without remapping them.
    if (
      path === "/judgeLineList" &&
      (old.size !== changed.size || [...old.keys()].some((id) => !changed.has(id)))
    ) {
      return { value: current, conflicts: [path] };
    }
    const oldCommon = [...old.keys()].filter((id) => changed.has(id));
    const afterCommon = [...changed.keys()].filter((id) => old.has(id));
    if (!equal(oldCommon, afterCommon)) {
      return { value: current, conflicts: [path] };
    }
    const result = [...current];
    const conflicts: string[] = [];
    for (const id of new Set([...old.keys(), ...changed.keys()])) {
      const index = result.findIndex((item) => object(item) && item.id === id);
      const merged = merge(
        old.get(id) ?? missing,
        changed.get(id) ?? missing,
        index < 0 ? missing : result[index],
        `${path}/${id}`,
      );
      conflicts.push(...merged.conflicts);
      if (merged.conflicts.length) {
        continue;
      }
      if (merged.value === missing) {
        if (index >= 0) {
          result.splice(index, 1);
        }
      } else if (index >= 0) {
        result[index] = merged.value;
      } else {
        const oldIndex = before.findIndex((item) => object(item) && item.id === id);
        let insert = result.length;
        for (let i = oldIndex + 1; i < before.length; i++) {
          const following = before[i];
          if (!object(following)) {
            continue;
          }
          const found = result.findIndex((item) => object(item) && item.id === following.id);
          if (found >= 0) {
            insert = found;
            break;
          }
        }
        result.splice(insert, 0, merged.value);
      }
    }
    return { value: result, conflicts };
  }
  // Fixed positional containers such as event layers can be merged by index;
  // scalar arrays (including beat tuples) remain atomic.
  if (
    path.endsWith("/eventLayers") &&
    before.length === after.length &&
    after.length === current.length &&
    before.every(object) &&
    after.every(object) &&
    current.every(object)
  ) {
    const result: unknown[] = current.slice();
    const conflicts: string[] = [];
    for (let i = 0; i < before.length; i++) {
      const merged = merge(before[i], after[i], current[i], `${path}/${i}`);
      result[i] = merged.value;
      conflicts.push(...merged.conflicts);
    }
    return { value: result, conflicts };
  }
  return { value: current, conflicts: [path] };
}

/** Three-way merges one value, reporting paths where current diverged. */
function merge(before: Value, after: Value, current: Value, path: string): MergeResult {
  if (equal(before, after)) {
    return { value: current, conflicts: [] };
  }
  if (equal(current, after)) {
    return { value: before, conflicts: [] };
  }
  if (Array.isArray(before) && Array.isArray(after) && Array.isArray(current)) {
    return mergeArray(before, after, current, path);
  }
  if (object(before) && object(after) && object(current)) {
    const result = { ...current };
    const conflicts: string[] = [];
    // Start and end form one time interval even though they are separate
    // fields; merging edits on opposite endpoints can create an invalid span.
    if (
      "startTime" in before &&
      "endTime" in before &&
      ((!equal(before.startTime, after.startTime) && !equal(current.endTime, after.endTime)) ||
        (!equal(before.endTime, after.endTime) && !equal(current.startTime, after.startTime)))
    ) {
      return { value: current, conflicts: [path] };
    }
    for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
      // Scoring counts are derived from notes and recalculated after merging.
      if (key === "numOfNotes" && /^\/judgeLineList\/[^/]+$/.test(path)) {
        continue;
      }
      const merged = merge(
        Object.hasOwn(before, key) ? before[key] : missing,
        Object.hasOwn(after, key) ? after[key] : missing,
        Object.hasOwn(current, key) ? current[key] : missing,
        `${path}/${key}`,
      );
      conflicts.push(...merged.conflicts);
      if (merged.value === missing) {
        delete result[key];
      } else {
        Object.defineProperty(result, key, {
          value: merged.value,
          enumerable: true,
          writable: true,
          configurable: true,
        });
      }
    }
    return { value: result, conflicts };
  }
  return { value: current, conflicts: [path] };
}

export type SelectiveUndoResult =
  | { status: "committed"; entryId: number }
  | { status: "conflict"; paths: readonly string[] }
  | { status: "unavailable" | "rejected" };

/**
 * Compensate the newest transaction authored by this room member.
 *
 * Remote entries and entries created before joining the room cannot be
 * compensated, so the search walks past them. The first eligible entry decides
 * the result: a conflict is reported instead of silently trying an older edit.
 */
export function selectiveUndoLatest(session: EditorSession, label: string): SelectiveUndoResult {
  if (!session.collaborationActive || !session.collaborationActorId) {
    return { status: "unavailable" };
  }
  for (let index = session.history.undoStack.length - 1; index >= 0; index -= 1) {
    const entry = session.history.undoStack[index];
    if (entry.origin?.kind === "collaboration-remote") {
      continue;
    }
    if (entry.origin?.clientId !== session.collaborationActorId || !entry.origin.requestId) {
      continue;
    }
    return selectiveUndo(session, entry.id, label);
  }
  return { status: "unavailable" };
}

/** Compensate a retained applied entry as one new history entry, or leave the chart unchanged. */
export function selectiveUndo(
  session: EditorSession,
  id: number,
  label: string,
): SelectiveUndoResult {
  return session.runHistoryMutation(() => {
    const entry = session.history.undoStack.find((item) => item.id === id);
    if (
      !entry ||
      entry.before === entry.after ||
      session.readOnly ||
      entry.origin?.kind === "collaboration-remote"
    ) {
      return { status: "unavailable" };
    }
    if (
      session.collaborationActive &&
      (!entry.origin?.clientId ||
        entry.origin.clientId !== session.collaborationActorId ||
        !entry.origin.requestId)
    ) {
      return { status: "unavailable" };
    }
    const source = session.chart;
    const merged = merge(entry.before, entry.after, source, "");
    if (merged.conflicts.length) {
      return { status: "conflict", paths: merged.conflicts };
    }
    const mergedChart = merged.value as Chart;
    const chart: Chart = {
      ...mergedChart,
      judgeLineList: mergedChart.judgeLineList?.map((line) => {
        const count = countScoringNotes(line.notes ?? []);
        return line.numOfNotes === count ? line : { ...line, numOfNotes: count };
      }),
    };
    try {
      assertChart(chart);
    } catch {
      return { status: "rejected" };
    }
    const selection = session.selectionState();
    const nextSelection = remapSelection(source, chart, selection);
    const committed = session.commitChart(
      label,
      chart,
      selection,
      {
        affectedObjectIds: entry.affectedObjectIds,
        origin: session.collaborationActive
          ? {
              kind: "collaborative-undo",
              clientId: session.collaborationActorId,
              requestId: collaborationRequestId(),
              undoOf: entry.origin?.requestId,
            }
          : { kind: "selective-undo", requestId: String(id) },
      },
      { afterSelection: nextSelection, beatRange: entry.beatRange },
    );
    if (!committed) {
      return { status: "rejected" };
    }
    const committedEntry = session.history.undoStack.at(-1);
    return committedEntry
      ? { status: "committed", entryId: committedEntry.id }
      : { status: "rejected" };
  });
}
