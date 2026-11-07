/**
 * Applying one transform to a captured selection, and committing it.
 *
 * `editCapturedSelection` is pure: it takes the snapshot and returns the chart it
 * would produce. `commitSelectionEdit` is the only function here that touches the
 * session, and it writes one undo entry for the whole batch.
 */

import { t } from "../../../i18n/index.ts";
import { assertChart, countScoringNotes } from "../../global/chart/chart.ts";
import type { Chart, JudgeLine, JudgeLineEvent, JudgeLineNote } from "../../global/chart/chart.ts";
import {
  addBeats,
  compareBeats,
  fromNumber,
  normalizeBeat,
  nudgeBeat,
  subtractBeats,
  type Beat,
} from "../../global/chart/timing/beat.ts";
import { verticalGrid } from "../../global/chart/editing/editGrid.ts";
import { alignShaderParameters } from "../../global/chart/shader/shaderEvents.ts";
import { chartWithEventLists, eventKey, eventList } from "../events/eventTracks.ts";
import type { EventSession } from "../events/eventTracks.ts";
import type { HistoryEntryMetadata, HistoryRecordOptions } from "../session/history.ts";
import type { EditorFocus, EditorSession } from "../session/session.ts";
import { captureSelection } from "./snapshot.ts";
import { restoreSelection } from "../session/selectionHistory.ts";
import type { EventCaptureEntry, NoteCaptureEntry, SelectionSnapshot } from "./snapshot.ts";

export interface SelectionEditResult {
  chart: Chart;
  lineIndex: number;
  eventLayer: number;
  focus: EditorFocus;
  selection: Set<number>;
  eventSelection: Set<string>;
  multiLineSelection?: Map<number, Iterable<number>>;
  multiEventSelection?: Map<number, Iterable<string>>;
}

/** Per-object transforms `editCapturedSelection` applies. */
export interface EditSelectionOptions {
  note?: (note: JudgeLineNote, entry: NoteCaptureEntry) => JudgeLineNote;
  event?: (event: JudgeLineEvent, type: string, entry: EventCaptureEntry) => JudgeLineEvent;
  lineOffset?: number;
}

/** Builds the minimal session shape for reading an event track. */
function eventSession(
  chart: Chart,
  lineIndex: number,
  eventLayer: number,
): EventSession & { line: JudgeLine | undefined } {
  return { chart, lineIndex, eventLayer, line: chart.judgeLineList?.[lineIndex] };
}

/** Applies per-object transforms and line shifts to a snapshot; never mutates it. */
export function editCapturedSelection(
  snapshot: SelectionSnapshot,
  { note = (value) => value, event = (value) => value, lineOffset = 0 }: EditSelectionOptions = {},
): SelectionEditResult {
  const sourceIndex = snapshot.lineIndex;
  const count = (snapshot.chart.judgeLineList ?? []).length;
  const targetIndex = (((sourceIndex + lineOffset) % count) + count) % count;
  let chart = snapshot.chart;
  const selection = new Set<number>();
  const eventSelection = new Set<string>();
  const multiLineSelection = new Map<number, Set<number>>();
  if (snapshot.notes.length) {
    const lines = [...(chart.judgeLineList ?? [])];
    // Keep untouched line and note arrays shared with the snapshot. A batch
    // edit commonly touches one line in a large chart; copying every line here
    // turns a small edit into a chart-sized allocation and invalidates every
    // line's derived render/index cache.
    const originalNotes = lines.map((line) => line?.notes ?? []);
    const touchedNoteLines = new Set<number>();
    const grouped = new Map<number, NoteCaptureEntry[]>();
    for (const entry of snapshot.notes) {
      const entrySource = Number.isInteger(entry.lineIndex) ? entry.lineIndex : sourceIndex;
      if (!grouped.has(entrySource)) {
        grouped.set(entrySource, []);
      }
      grouped.get(entrySource)?.push(entry);
    }
    const selectedBySource = new Map<number, Set<number>>();
    for (const [entrySource, entries] of grouped) {
      selectedBySource.set(entrySource, new Set(entries.map((entry) => entry.index)));
    }
    const nextNotes = originalNotes.map((notes, lineIndex) => {
      const selected = selectedBySource.get(lineIndex);
      if (!selected) {
        return notes;
      }
      touchedNoteLines.add(lineIndex);
      return notes.filter((unused, index) => !selected.has(index));
    });
    for (const [entrySource, entries] of grouped) {
      const entryTarget = (((entrySource + lineOffset) % count) + count) % count;
      const source = lines[entrySource];
      const target = lines[entryTarget];
      if (!source || !target) {
        continue;
      }
      const updates = new Map<number, JudgeLineNote>(
        entries.map((entry): [number, JudgeLineNote] => [entry.index, note(entry.note, entry)]),
      );
      const selectedIndices = new Set<number>();
      if (entrySource === entryTarget) {
        touchedNoteLines.add(entrySource);
        nextNotes[entrySource] = originalNotes[entrySource].map(
          (item, index) => updates.get(index) ?? item,
        );
        for (const index of updates.keys()) {
          selectedIndices.add(index);
        }
      } else {
        touchedNoteLines.add(entryTarget);
        const targetNotes = nextNotes[entryTarget] ?? [];
        const moved = [...updates.values()];
        for (let index = targetNotes.length; index < targetNotes.length + moved.length; index++) {
          selectedIndices.add(index);
        }
        nextNotes[entryTarget] = [...targetNotes, ...moved];
      }
      multiLineSelection.set(entryTarget, selectedIndices);
      if (entryTarget === sourceIndex || (grouped.size === 1 && entryTarget === targetIndex)) {
        for (const index of selectedIndices) {
          selection.add(index);
        }
      }
    }
    for (const lineIndex of touchedNoteLines) {
      const line = lines[lineIndex];
      if (line) {
        const notes = nextNotes[lineIndex];
        lines[lineIndex] = { ...line, notes, numOfNotes: countScoringNotes(notes) };
      }
    }
    chart = { ...chart, judgeLineList: lines };
  }
  const entriesByLine = new Map<number, EventCaptureEntry[]>();
  for (const entry of snapshot.events) {
    const lineIndex = Number.isInteger(entry.lineIndex) ? entry.lineIndex : sourceIndex;
    if (!entriesByLine.has(lineIndex)) {
      entriesByLine.set(lineIndex, []);
    }
    entriesByLine.get(lineIndex)?.push(entry);
  }
  const sourceUpdatesByLine = new Map<number, Map<string, JudgeLineEvent[]>>();
  const targetUpdatesByLine = new Map<number, Map<string, JudgeLineEvent[]>>();
  const multiEventSelection = new Map<number, Set<string>>();
  for (const [entrySource, entries] of entriesByLine) {
    const entryTarget = (((entrySource + lineOffset) % count) + count) % count;
    const types = new Set(entries.map((entry) => entry.type));
    for (const type of types) {
      const selected = new Map<number, JudgeLineEvent>(
        entries
          .filter((entry) => entry.type === type)
          .map((entry): [number, JudgeLineEvent] => {
            let next = event(entry.event, type, entry);
            if (
              type === "paintEvents" &&
              snapshot.shaderAutoAlign !== false &&
              compareBeats(next.startTime, entry.event.startTime) !== 0
            ) {
              next = alignShaderParameters(next);
            }
            return [entry.index, next];
          }),
      );
      const original = eventList(eventSession(chart, entrySource, snapshot.eventLayer), type);
      if (entrySource === entryTarget) {
        if (!sourceUpdatesByLine.has(entrySource)) {
          sourceUpdatesByLine.set(entrySource, new Map());
        }
        sourceUpdatesByLine.get(entrySource)?.set(
          type,
          original.map((item, index) => selected.get(index) ?? item),
        );
        if (!multiEventSelection.has(entrySource)) {
          multiEventSelection.set(entrySource, new Set());
        }
        for (const index of selected.keys()) {
          const key = eventKey(type, index);
          multiEventSelection.get(entrySource)?.add(key);
          if (entrySource === sourceIndex) {
            eventSelection.add(key);
          }
        }
      } else {
        if (!sourceUpdatesByLine.has(entrySource)) {
          sourceUpdatesByLine.set(entrySource, new Map());
        }
        sourceUpdatesByLine.get(entrySource)?.set(
          type,
          original.filter((item, index) => !selected.has(index)),
        );
        const target = [...eventList(eventSession(chart, entryTarget, snapshot.eventLayer), type)];
        if (!targetUpdatesByLine.has(entryTarget)) {
          targetUpdatesByLine.set(entryTarget, new Map());
        }
        const targetSelection = multiEventSelection.get(entryTarget) ?? new Set<string>();
        for (const next of selected.values()) {
          const key = eventKey(type, target.length);
          targetSelection.add(key);
          if (entryTarget === sourceIndex || entriesByLine.size === 1) {
            eventSelection.add(key);
          }
          target.push(next);
        }
        targetUpdatesByLine.get(entryTarget)?.set(type, target);
        multiEventSelection.set(entryTarget, targetSelection);
      }
    }
  }
  for (const [lineIndex, updates] of sourceUpdatesByLine) {
    if (updates.size) {
      chart = chartWithEventLists(chart, lineIndex, snapshot.eventLayer, updates);
    }
  }
  for (const [lineIndex, updates] of targetUpdatesByLine) {
    if (updates.size) {
      chart = chartWithEventLists(chart, lineIndex, snapshot.eventLayer, updates);
    }
  }
  return {
    chart,
    lineIndex: entriesByLine.size > 1 ? sourceIndex : targetIndex,
    eventLayer: snapshot.eventLayer,
    focus: snapshot.focus,
    selection,
    eventSelection,
    multiEventSelection,
    multiLineSelection,
  };
}

/** Writes a planned selection edit as one history entry; false when unchanged. */
export function commitSelectionEdit(
  session: EditorSession,
  result: SelectionEditResult,
  label: string,
  metadata: HistoryEntryMetadata = {},
  options: HistoryRecordOptions = {},
): boolean {
  if (result.chart === session.chart) {
    return false;
  }
  if (!options.skipValidation) {
    assertChart(result.chart);
  }
  const beforeSelection = session.selectionState();
  if (!(
    session.multiLineActive &&
    ((result.multiEventSelection?.size ?? 0) > 0 || (result.multiLineSelection?.size ?? 0) > 0)
  )) {
    session.lineIndex = result.lineIndex;
  }
  session.eventLayer = result.eventLayer;
  session.focus = result.focus;
  session.selection = result.selection;
  session.eventSelection = result.eventSelection;
  if (result.multiLineSelection) {
    session.multiLineSelection = new Map(
      [...result.multiLineSelection].map(([line, values]): [number, Set<number>] => [
        line,
        new Set(values),
      ]),
    );
  }
  if (result.multiEventSelection) {
    session.multiEventSelection = new Map(
      [...result.multiEventSelection].map(([line, values]): [number, Set<string>] => [
        line,
        new Set(values),
      ]),
    );
  }
  try {
    const committed = session.commitChart(label, result.chart, beforeSelection, metadata, options);
    if (committed) {
      return true;
    }
  } catch (error) {
    restoreSelection(session, beforeSelection);
    session.notify();
    throw error;
  }
  restoreSelection(session, beforeSelection);
  session.notify();
  return false;
}

/**
 * `item` moved by `delta`.
 *
 * `delta` is a beat increment when the caller already has one, so a nudge of
 * `1/3` stays `1/3`; a bare number is a continuous measurement (a drag in beats)
 * and is converted once, here, at the entry.
 */
export function shiftedTime<T extends { startTime: number[]; endTime: number[] }>(
  item: T,
  delta: number | Beat,
  part: "start" | "end" | "both" = "both",
): T {
  const increment = typeof delta === "number" ? fromNumber(delta) : normalizeBeat(delta);
  if (compareBeats(increment, [0, 0, 1]) === 0) {
    return item;
  }
  const shiftedStart = addBeats(item.startTime, increment);
  const shiftedEnd = addBeats(item.endTime, increment);
  return {
    ...item,
    startTime:
      part === "end"
        ? item.startTime
        : part === "start" && compareBeats(shiftedStart, item.endTime) > 0
          ? item.endTime
          : shiftedStart,
    endTime:
      part === "start"
        ? item.endTime
        : part === "end" && compareBeats(shiftedEnd, item.startTime) < 0
          ? item.startTime
          : shiftedEnd,
  };
}

/** Moves the selection by one grid step in a page-key direction. */
export function nudgeSelection(
  session: EditorSession,
  direction: string,
  division: number,
  gridCount: number,
): boolean {
  const snapshot = captureSelection(session);
  if (!snapshot.notes.length && !snapshot.events.length) {
    return false;
  }
  const horizontal = direction === "ArrowLeft" || direction === "ArrowRight";
  if (horizontal && !snapshot.notes.length) {
    return true;
  }
  const deltaX = horizontal
    ? verticalGrid(gridCount).spacing * (direction === "ArrowLeft" ? -1 : 1)
    : 0;
  // The vertical nudge is a grid division, computed in the triple, so a 1/3 or
  // 1/7 division moves by exactly that much.
  const step = direction === "ArrowDown" ? -1 : 1;
  const beatStep = (item: { startTime: number[] }): Beat =>
    subtractBeats(nudgeBeat(item.startTime, step, division), item.startTime);
  return commitSelectionEdit(
    session,
    editCapturedSelection(snapshot, {
      note: (item) => ({
        ...(horizontal ? item : shiftedTime(item, beatStep(item))),
        positionX: Number(item.positionX) + deltaX,
      }),
      event: (item) => (horizontal ? item : shiftedTime(item, beatStep(item))),
    }),
    t("editor.commands.batchEdit.nudgeLabel"),
  );
}
