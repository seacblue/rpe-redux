/**
 * Captures and compares the selection state that undo has to restore.
 *
 * Every field is flattened into sorted arrays so equality can be checked
 * without reading the live session, and disabled multi-line fields stay
 * explicit because restoring an entry must also restore the mode that was
 * active.
 */
import { eventList, eventKey } from "../events/eventTracks.ts";
import type { EventSession } from "../events/eventTracks.ts";
import { beatValue } from "../../global/chart/timing/beat.ts";
import type { Chart } from "../../global/chart/chart.ts";
import type { HistoryBeatRange } from "./history.ts";
import type { EditorSession, EditorFocus, MultiLineMode, SelectionMode } from "./session.ts";

/** Everything a commit captures around a change so undo can restore it. */
export interface SelectionState {
  lineIndex: number;
  eventLayer: number;
  focus: EditorFocus;
  /** The gesture that produced the selection controls Inspector routing. */
  marqueeSelection?: "notes" | "events" | null;
  /** Whether the active selection is single-object or multi-select intent. */
  selectionMode?: SelectionMode;
  selection: number[];
  eventSelection: string[];
  multiLineSelection: [number, number[]][];
  multiEventSelection: [number, string[]][];
  multiLineEnabled: boolean;
  multiLineMode: MultiLineMode;
  multiLineMerge: boolean;
  multiLineIndices: number[];
}

/** Flattens the live selection into a comparable, detached snapshot. */
export function selectionState(session: EditorSession): SelectionState {
  return {
    lineIndex: session.lineIndex,
    eventLayer: session.eventLayer,
    focus: session.focus,
    marqueeSelection: session.marqueeSelection,
    selectionMode: session.selectionMode,
    selection: [...session.selection].sort((left, right) => left - right),
    eventSelection: [...session.eventSelection].sort(),
    multiLineSelection: [...(session.multiLineSelection ?? new Map())]
      .map(([line, values]): [number, number[]] => [
        line,
        [...values].sort((left, right) => left - right),
      ])
      .sort((left, right) => left[0] - right[0]),
    multiEventSelection: [...(session.multiEventSelection ?? new Map())]
      .map(([line, values]): [number, string[]] => [line, [...values].sort()])
      .sort((left, right) => left[0] - right[0]),
    multiLineEnabled: session.multiLineEnabled,
    multiLineMode: session.multiLineMode,
    multiLineMerge: session.multiLineMerge,
    multiLineIndices: [...(session.multiLineIndices ?? [])],
  };
}

/**
 * The beat span covered by one selection snapshot against a chart revision.
 *
 * It reads the selected notes and events directly, so a history entry can keep
 * the edited time even when the object has been deleted from the committed
 * revision. Returns null when the selection addresses no timed object.
 */
export function selectionBeatRange(chart: Chart, state: SelectionState): HistoryBeatRange | null {
  let start = Infinity;
  let end = -Infinity;
  const consider = (item: { startTime?: readonly number[]; endTime?: readonly number[] }): void => {
    if (!item?.startTime || !item?.endTime) {
      return;
    }
    try {
      start = Math.min(start, beatValue(item.startTime));
      end = Math.max(end, beatValue(item.endTime));
    } catch {
      // A malformed selection entry contributes no span instead of hiding the
      // valid objects selected beside it.
    }
  };
  const notesOnLine = (lineIndex: number, indices: readonly number[]): void => {
    const notes = chart.judgeLineList?.[lineIndex]?.notes ?? [];
    for (const index of indices) {
      if (Number.isInteger(index)) {
        consider(notes[index]);
      }
    }
  };
  notesOnLine(state.lineIndex, state.selection);
  for (const [lineIndex, indices] of state.multiLineSelection ?? []) {
    notesOnLine(lineIndex, indices);
  }
  const eventsOnLine = (lineIndex: number, keys: readonly string[]): void => {
    const eventSession: EventSession = {
      chart,
      lineIndex,
      eventLayer: state.eventLayer,
    };
    for (const key of keys) {
      const separator = String(key).lastIndexOf(":");
      if (separator <= 0) {
        continue;
      }
      const index = Number(String(key).slice(separator + 1));
      if (!Number.isInteger(index)) {
        continue;
      }
      consider(eventList(eventSession, String(key).slice(0, separator))[index]);
    }
  };
  eventsOnLine(state.lineIndex, state.eventSelection);
  for (const [lineIndex, keys] of state.multiEventSelection ?? []) {
    eventsOnLine(lineIndex, keys);
  }
  return Number.isFinite(start) && Number.isFinite(end) ? { start, end } : null;
}

/** Index-wise equality of the two index/event-key lists. */
function sameIndices(
  left: readonly (number | string)[],
  right: readonly (number | string)[],
): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

/** True when both snapshots describe the same selection and mode. */
export function sameSelection(left: SelectionState, right: SelectionState | undefined): boolean {
  return Boolean(
    right &&
    left.lineIndex === right.lineIndex &&
    left.eventLayer === right.eventLayer &&
    left.focus === right.focus &&
    (left.marqueeSelection ?? null) === (right.marqueeSelection ?? null) &&
    (left.selectionMode ?? "none") === (right.selectionMode ?? "none") &&
    left.multiLineEnabled === right.multiLineEnabled &&
    left.multiLineMode === right.multiLineMode &&
    left.multiLineMerge === right.multiLineMerge &&
    JSON.stringify(left.multiLineIndices ?? []) === JSON.stringify(right.multiLineIndices ?? []) &&
    JSON.stringify(left.multiLineSelection ?? []) ===
      JSON.stringify(right.multiLineSelection ?? []) &&
    JSON.stringify(left.multiEventSelection ?? []) ===
      JSON.stringify(right.multiEventSelection ?? []) &&
    sameIndices(left.selection, right.selection) &&
    sameIndices(left.eventSelection, right.eventSelection),
  );
}

/**
 * Maps indices from one document to another: an object that survived the edit
 * keeps its selection, and otherwise — when the two documents are parallel —
 * the index itself is the answer.
 */
function remapIndices<T extends object>(
  source: readonly T[],
  target: readonly T[],
  indices: readonly number[],
): number[] {
  const locations = new Map<T, number>(target.map((item, index): [T, number] => [item, index]));
  const ids = new Map<string, number>();
  target.forEach((item, index) => {
    if ("id" in item && typeof item.id === "string") {
      ids.set(item.id, index);
    }
  });
  const sourceItems = new Set(source);
  return indices.flatMap((index) => {
    const item = source[index];
    if (!item) {
      return [];
    }
    const mapped = locations.get(item);
    if (mapped !== undefined) {
      return [mapped];
    }
    if ("id" in item && typeof item.id === "string") {
      const byId = ids.get(item.id);
      return byId === undefined ? [] : [byId];
    }
    return source.length === target.length && target[index] && !sourceItems.has(target[index])
      ? [index]
      : [];
  });
}

/** Find a corresponding line by reference, stable id, or shared child arrays. */
function remapLineIndex(source: Chart, target: Chart, sourceIndex: number): number | null {
  const sourceLine = source.judgeLineList?.[sourceIndex];
  if (!sourceLine) {
    return null;
  }
  const targetIndex = (target.judgeLineList ?? []).findIndex(
    (candidate) =>
      candidate === sourceLine ||
      (sourceLine.id !== undefined && candidate.id === sourceLine.id) ||
      (candidate.notes === sourceLine.notes && candidate.eventLayers === sourceLine.eventLayers),
  );
  return targetIndex >= 0 ? targetIndex : null;
}

/** Maps a selection snapshot onto another chart revision by id and position. */
export function remapSelection(
  source: Chart,
  target: Chart,
  state: SelectionState,
): SelectionState {
  const line = source.judgeLineList?.[state.lineIndex];
  const lines = target.judgeLineList ?? [];
  const matching = remapLineIndex(source, target, state.lineIndex) ?? -1;
  const lineIndex =
    matching >= 0 ? matching : Math.max(0, Math.min(state.lineIndex, lines.length - 1));
  const sourceSession = { ...state, chart: source, line };
  const targetSession = { ...state, chart: target, lineIndex, line: lines[lineIndex] };
  const selection = remapIndices(
    line?.notes ?? [],
    targetSession.line?.notes ?? [],
    state.selection,
  );
  const eventSelection: string[] = [];
  const byType = new Map<string, number[]>();
  for (const key of state.eventSelection) {
    const [type, index] = key.split(":");
    if (!byType.has(type)) {
      byType.set(type, []);
    }
    byType.get(type)?.push(Number(index));
  }
  for (const [type, indices] of byType) {
    for (const index of remapIndices(
      eventList(sourceSession, type),
      eventList(targetSession, type),
      indices,
    )) {
      eventSelection.push(eventKey(type, index));
    }
  }
  const multiEventSelection = (state.multiEventSelection ?? []).flatMap(
    ([sourceLineIndex, keys]): [number, string[]][] => {
      const sourceLine = source.judgeLineList?.[sourceLineIndex];
      const targetLineIndex = remapLineIndex(source, target, sourceLineIndex);
      if (!sourceLine || targetLineIndex === null) {
        return [];
      }
      const targetLine = target.judgeLineList?.[targetLineIndex];
      if (!targetLine) {
        return [];
      }
      const sourceSession = {
        ...state,
        chart: source,
        lineIndex: sourceLineIndex,
        line: sourceLine,
      };
      const targetSession = {
        ...state,
        chart: target,
        lineIndex: targetLineIndex,
        line: targetLine,
      };
      const byType = new Map<string, number[]>();
      for (const key of keys) {
        const [type, index] = String(key).split(":");
        if (!byType.has(type)) {
          byType.set(type, []);
        }
        byType.get(type)?.push(Number(index));
      }
      const mapped: string[] = [];
      for (const [type, indices] of byType) {
        for (const index of remapIndices(
          eventList(sourceSession, type),
          eventList(targetSession, type),
          indices,
        )) {
          mapped.push(eventKey(type, index));
        }
      }
      return mapped.length ? [[targetLineIndex, mapped]] : [];
    },
  );
  const multiLineSelection = (state.multiLineSelection ?? []).flatMap(
    ([sourceLineIndex, indices]): [number, number[]][] => {
      const sourceNotes = source.judgeLineList?.[sourceLineIndex]?.notes ?? [];
      const targetLineIndex = remapLineIndex(source, target, sourceLineIndex);
      if (targetLineIndex === null) {
        return [];
      }
      const targetNotes = target.judgeLineList?.[targetLineIndex]?.notes ?? [];
      const mapped = remapIndices(sourceNotes, targetNotes, indices);
      return mapped.length ? [[targetLineIndex, mapped]] : [];
    },
  );
  const multiLineIndices = (state.multiLineIndices ?? []).flatMap((sourceLineIndex) => {
    const targetLineIndex = remapLineIndex(source, target, sourceLineIndex);
    return targetLineIndex === null ? [] : [targetLineIndex];
  });
  return {
    ...state,
    lineIndex,
    selection,
    eventSelection,
    multiLineSelection,
    multiEventSelection,
    multiLineIndices,
  };
}

/** Applies a snapshot back onto a session, dropping indices the chart lost. */
export function restoreSelection(session: EditorSession, state: SelectionState): void {
  session.lineIndex = Math.max(
    0,
    Math.min(state.lineIndex, (session.chart.judgeLineList?.length ?? 0) - 1),
  );
  session.eventLayer = state.eventLayer;
  session.focus = state.focus;
  session.marqueeSelection = state.marqueeSelection ?? null;
  const hasSelection =
    state.selection.length > 0 ||
    state.eventSelection.length > 0 ||
    state.multiLineSelection.some(([, values]) => values.length > 0) ||
    state.multiEventSelection.some(([, values]) => values.length > 0);
  session.selectionMode = state.selectionMode ?? (hasSelection ? "single" : "none");
  session.selection = new Set(state.selection.filter((index) => session.notes[index]));
  session.multiLineSelection = new Map(
    (state.multiLineSelection ?? [])
      .map(([lineIndex, indices]): [number, Set<number>] => [
        lineIndex,
        new Set(
          indices.filter((index) => session.chart.judgeLineList?.[lineIndex]?.notes?.[index]),
        ),
      ])
      .filter(([, values]) => values.size),
  );
  session.eventSelection = new Set(
    state.eventSelection.filter((key) => {
      const [type, index] = key.split(":");
      return eventList(session, type)[Number(index)];
    }),
  );
  session.multiEventSelection = new Map(
    (state.multiEventSelection ?? [])
      .map(([lineIndex, keys]): [number, Set<string>] => [
        lineIndex,
        new Set(
          keys.filter((key) => {
            const [type, index] = String(key).split(":");
            const line = session.chart.judgeLineList?.[lineIndex];
            const lineSession: EventSession = {
              chart: session.chart,
              lineIndex,
              eventLayer: session.eventLayer,
            };
            return line && eventList(lineSession, type)[Number(index)];
          }),
        ),
      ])
      .filter(([, keys]) => keys.size),
  );
  session.multiLineEnabled = state.multiLineEnabled ?? false;
  session.multiLineMode = state.multiLineMode === "events" ? "events" : "notes";
  session.multiLineMerge = state.multiLineMerge ?? true;
  session.multiLineIndices = [...(state.multiLineIndices ?? [])];
  session.normalizeMultiLine();
  session.multiLineEnabled = session.multiLineIndices.length > 1;
}
