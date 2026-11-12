/**
 * Timeline selection gestures: rectangle selection, event shifting and the
 * commit that follows a note drag.
 *
 * Selection is computed from chart coordinates and the caller's note index, so
 * the same rectangle selects the same objects at any zoom or scroll, and
 * multi-line modes contribute their own line indices. A live marquee always
 * recombines its start-time baseline with the current rectangle; objects that
 * leave the rectangle therefore leave the selection again.
 */
import {
  addBeats,
  beatValue,
  compareBeats,
  fromNumber,
  normalizeBeat,
  type Beat,
} from "../../global/chart/timing/beat.ts";
import type { JudgeLineEvent, JudgeLineNote } from "../../global/chart/chart.ts";
import { shaderEventLanes } from "../../global/chart/shader/shaderEvents.ts";
import type { EditorSession } from "../session/session.ts";
import { captureSelection } from "../selection/snapshot.ts";
import { commitSelectionEdit, editCapturedSelection } from "../selection/edits.ts";
import { eventKey, eventList, eventListAt } from "../events/eventTracks.ts";
import { selectedEvents, transformEvents } from "../events/eventEdits.ts";
import { checkedNotes, hasNonPositiveRange, isTimelineNoteRenderable } from "./model.ts";
import type { NoteIndex, TimelineEventRect, TimelineNote } from "./types.ts";

export interface SelectionRectangle {
  left: number;
  right: number;
  bottom: number;
  top: number;
  append?: boolean;
  remove?: boolean;
  /** Notes selected before a Shift/Ctrl marquee started. */
  baseNotes?: ReadonlyMap<number, ReadonlySet<number>>;
  /** Events selected before a Shift/Ctrl event marquee started. */
  baseEvents?: ReadonlyMap<number, ReadonlySet<string>>;
}

/** One screen-space segment used by the timeline's freehand selection gesture. */
export interface SelectionSweep {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  /** Extra hit padding in screen pixels. */
  padding?: number;
  remove?: boolean;
}

/** Reports whether a marquee touched an object and whether it changed selection. */
export interface SelectionGestureResult {
  changed: boolean;
  matched: boolean;
}

/** Return whether a right-button sweep moved far enough to replace the context menu. */
export function shouldSuppressTimelineContextMenu(input: {
  button: number;
  moved: boolean;
}): boolean {
  return input.button === 2 && input.moved;
}

/**
 * Return whether an empty primary-button press pans the multi-line viewport.
 *
 * A multi-panel timeline reserves that press for panning, so it must not also
 * start a sweep, place an object, or clear the selection it is navigating.
 */
export function timelineEmptyPanPress(input: {
  multiLineActive: boolean;
  panelCount: number;
  button: number;
  hit: boolean;
  tool: boolean;
  pending: boolean;
}): boolean {
  return (
    input.multiLineActive &&
    input.panelCount > 1 &&
    input.button === 0 &&
    !input.hit &&
    !input.tool &&
    !input.pending
  );
}

/**
 * Return whether the timeline may start any freehand sweep.
 *
 * A split multi-line timeline reserves pointer drags for panning and marquee
 * selection, so both the additive and the subtractive sweep are unavailable
 * there; the sweep is not reintroduced through another button or modifier.
 */
export function timelineSweepEnabled(input: {
  multiLineActive: boolean;
  panelCount: number;
}): boolean {
  return !input.multiLineActive || input.panelCount <= 1;
}

/** Return whether a pointer path exceeds the timeline's click tolerance. */
export function timelineSweepMoved(
  start: { x: number; y: number },
  current: { x: number; y: number },
): boolean {
  return Math.hypot(current.x - start.x, current.y - start.y) > 3;
}

/** Return whether a segment touches an axis-aligned rectangle. */
function segmentTouchesRectangle(
  sweep: SelectionSweep,
  rectangle: { left: number; top: number; right: number; bottom: number },
): boolean {
  const padding = sweep.padding ?? 0;
  const left = rectangle.left - padding;
  const right = rectangle.right + padding;
  const top = rectangle.top - padding;
  const bottom = rectangle.bottom + padding;
  const dx = sweep.endX - sweep.startX;
  const dy = sweep.endY - sweep.startY;
  let t0 = 0;
  let t1 = 1;
  const clip = (p: number, q: number): boolean => {
    if (p === 0) {
      return q >= 0;
    }
    const ratio = q / p;
    if (p < 0) {
      if (ratio > t1) {
        return false;
      }
      if (ratio > t0) {
        t0 = ratio;
      }
    } else {
      if (ratio < t0) {
        return false;
      }
      if (ratio < t1) {
        t1 = ratio;
      }
    }
    return true;
  };
  return (
    clip(-dx, sweep.startX - left) &&
    clip(dx, right - sweep.startX) &&
    clip(-dy, sweep.startY - top) &&
    clip(dy, bottom - sweep.startY)
  );
}

/** Restore the note selection a marquee began with; returns whether it changed. */
function restoreNoteBaseline(
  session: EditorSession,
  base: ReadonlyMap<number, ReadonlySet<number>> | undefined,
  append: boolean,
): boolean {
  if (!base) {
    if (!append) {
      const dirty = session.selection.size > 0 || session.multiLineSelection.size > 0;
      session.selection.clear();
      session.multiLineSelection.clear();
      return dirty;
    }
    return false;
  }
  const multi = session.multiLineActive && session.multiLineMode === "notes";
  if (sameNoteSelection(session, base, multi)) {
    return false;
  }
  session.selection.clear();
  session.multiLineSelection.clear();
  if (multi) {
    for (const [lineIndex, indices] of base) {
      session.multiLineSelection.set(lineIndex, new Set(indices));
    }
  }
  session.selection = new Set(base.get(session.lineIndex) ?? []);
  return true;
}

/** True when the session already holds exactly the baseline note selection. */
function sameNoteSelection(
  session: EditorSession,
  base: ReadonlyMap<number, ReadonlySet<number>>,
  multi: boolean,
): boolean {
  if (!multi) {
    const expected = base.get(session.lineIndex);
    if (!expected || expected.size !== session.selection.size) {
      return expected === undefined && session.selection.size === 0;
    }
    for (const index of expected) {
      if (!session.selection.has(index)) {
        return false;
      }
    }
    return true;
  }
  if (session.multiLineSelection.size !== base.size) {
    return false;
  }
  for (const [lineIndex, indices] of base) {
    const current = session.multiLineSelection.get(lineIndex);
    if (!current || current.size !== indices.size) {
      return false;
    }
    for (const index of indices) {
      if (!current.has(index)) {
        return false;
      }
    }
  }
  return true;
}

/** Restore the event selection a marquee began with; returns whether it changed. */
function restoreEventBaseline(
  session: EditorSession,
  base: ReadonlyMap<number, ReadonlySet<string>> | undefined,
  append: boolean,
): boolean {
  if (!base) {
    if (!append) {
      const dirty = session.eventSelection.size > 0 || session.multiEventSelection.size > 0;
      session.eventSelection.clear();
      session.multiEventSelection.clear();
      return dirty;
    }
    return false;
  }
  const multi = session.multiLineActive && session.multiLineMode === "events";
  if (sameEventSelection(session, base, multi)) {
    return false;
  }
  session.eventSelection.clear();
  session.multiEventSelection.clear();
  if (multi) {
    for (const [lineIndex, keys] of base) {
      session.multiEventSelection.set(lineIndex, new Set(keys));
    }
  }
  session.eventSelection = new Set(base.get(session.lineIndex) ?? []);
  return true;
}

/** True when the session already holds exactly the baseline event selection. */
function sameEventSelection(
  session: EditorSession,
  base: ReadonlyMap<number, ReadonlySet<string>>,
  multi: boolean,
): boolean {
  if (!multi) {
    const expected = base.get(session.lineIndex);
    if (!expected || expected.size !== session.eventSelection.size) {
      return expected === undefined && session.eventSelection.size === 0;
    }
    for (const key of expected) {
      if (!session.eventSelection.has(key)) {
        return false;
      }
    }
    return true;
  }
  if (session.multiEventSelection.size !== base.size) {
    return false;
  }
  for (const [lineIndex, keys] of base) {
    const current = session.multiEventSelection.get(lineIndex);
    if (!current || current.size !== keys.size) {
      return false;
    }
    for (const key of keys) {
      if (!current.has(key)) {
        return false;
      }
    }
  }
  return true;
}

/** True when an event-selection key still resolves on the given line. */
function validEventKey(session: EditorSession, lineIndex: number, key: string): boolean {
  const separator = key.lastIndexOf(":");
  if (separator <= 0) {
    return false;
  }
  const type = key.slice(0, separator);
  const index = Number(key.slice(separator + 1));
  return Number.isInteger(index) && eventListAt(session, lineIndex, type)[index] !== undefined;
}

/** Drop indices an undo removed from a line that is still present. */
function pruneNoteBaseline(session: EditorSession): boolean {
  let dirty = false;
  const lineCount = session.chart.judgeLineList?.length ?? 0;
  for (const [lineIndex, indices] of session.multiLineSelection) {
    if (lineIndex < 0 || lineIndex >= lineCount) {
      session.multiLineSelection.delete(lineIndex);
      dirty = true;
      continue;
    }
    const notes = session.chart.judgeLineList?.[lineIndex]?.notes?.length ?? 0;
    for (const index of indices) {
      if (!Number.isInteger(index) || index < 0 || index >= notes) {
        indices.delete(index);
        dirty = true;
      }
    }
    if (!indices.size && lineIndex !== session.lineIndex) {
      session.multiLineSelection.delete(lineIndex);
      dirty = true;
    }
  }
  const currentNotes = session.chart.judgeLineList?.[session.lineIndex]?.notes?.length ?? 0;
  for (const index of session.selection) {
    if (!Number.isInteger(index) || index < 0 || index >= currentNotes) {
      session.selection.delete(index);
      dirty = true;
    }
  }
  return dirty;
}

/** Adds or removes notes whose lanes intersect the selection rectangle. */
export function selectNotesInRectangle(
  session: EditorSession,
  rectangle: SelectionRectangle,
  indexForLine: (lineIndex: number) => NoteIndex | undefined,
  horizontal: (note: TimelineNote, lineIndex: number) => number,
): SelectionGestureResult {
  let dirty = restoreNoteBaseline(session, rectangle.baseNotes, rectangle.append ?? false);
  let matched = false;
  dirty = pruneNoteBaseline(session) || dirty;
  const multi = session.multiLineActive && session.multiLineMode === "notes";
  const lines = multi ? session.targetLineIndices : [session.lineIndex];
  for (const lineIndex of lines) {
    const lineIndexData = indexForLine(lineIndex);
    const index = lineIndexData?.index;
    if (!index) {
      continue;
    }
    const noteCount = lineIndexData.notes.length;
    const selected = multi
      ? new Set(session.multiLineSelection?.get(lineIndex) ?? [])
      : session.selection;
    for (const value of selected) {
      if (!Number.isInteger(value) || value < 0 || value >= noteCount) {
        selected.delete(value);
        dirty = true;
      }
    }
    for (const entry of index
      .query(rectangle.bottom, rectangle.top)
      .filter((candidate) => isTimelineNoteRenderable(candidate.item))) {
      const x = horizontal(entry.item, lineIndex);
      if (x >= rectangle.left && x <= rectangle.right) {
        matched = true;
        const changed = rectangle.remove
          ? selected.delete(entry.index)
          : !selected.has(entry.index);
        if (changed) {
          dirty = true;
          if (!rectangle.remove) {
            selected.add(entry.index);
          }
        }
      }
    }
    if (multi) {
      session.multiLineSelection?.set(lineIndex, selected);
    }
  }
  if (multi) {
    session.selection = new Set(session.multiLineSelection?.get(session.lineIndex) ?? []);
  }
  if (dirty) {
    session.notify();
  }
  return { changed: dirty, matched };
}

/** Geometry needed to test a note against one swept pointer segment. */
export interface NoteSweepGeometry {
  indexForLine: (lineIndex: number) => NoteIndex | undefined;
  bounds: (
    note: TimelineNote,
    lineIndex: number,
    index: number,
  ) => { left: number; top: number; right: number; bottom: number };
}

/** Adds or removes notes touched by a freehand timeline segment. */
export function selectNotesAlongSegment(
  session: EditorSession,
  sweep: SelectionSweep,
  geometry: NoteSweepGeometry,
): SelectionGestureResult {
  let dirty = false;
  let matched = false;
  const multi = session.multiLineActive && session.multiLineMode === "notes";
  const lines = multi ? session.targetLineIndices : [session.lineIndex];
  for (const lineIndex of lines) {
    const lineIndexData = geometry.indexForLine(lineIndex);
    if (!lineIndexData) {
      continue;
    }
    const selected = multi
      ? new Set(session.multiLineSelection.get(lineIndex) ?? [])
      : session.selection;
    for (const entry of lineIndexData.index
      .query(-Infinity, Infinity)
      .filter((candidate) => isTimelineNoteRenderable(candidate.item))) {
      const bounds = geometry.bounds(entry.item, lineIndex, entry.index);
      if (
        !segmentTouchesRectangle(sweep, {
          left: bounds.left,
          top: bounds.top,
          right: bounds.right,
          bottom: bounds.bottom,
        })
      ) {
        continue;
      }
      matched = true;
      const changed = sweep.remove ? selected.delete(entry.index) : !selected.has(entry.index);
      if (!changed) {
        continue;
      }
      dirty = true;
      if (!sweep.remove) {
        selected.add(entry.index);
      }
    }
    if (multi) {
      session.multiLineSelection.set(lineIndex, selected);
    }
  }
  if (multi) {
    session.selection = new Set(session.multiLineSelection.get(session.lineIndex) ?? []);
  }
  if (dirty) {
    session.notify();
  }
  return { changed: dirty, matched };
}

export interface EventSelectionGeometry {
  rectangles: readonly TimelineEventRect[];
  scroll: number;
  eventTypes: readonly string[];
  columnBounds(channel: number): { x: number; width: number };
  /** Beat-range query for one event type, backed by the timeline's interval index. */
  eventsInRange(
    type: string,
    start: number,
    end: number,
  ): readonly { index: number; item: JudgeLineEvent }[];
}

/** Geometry needed to test drawn event bars against a freehand segment. */
export interface EventSweepGeometry {
  rectangles: readonly TimelineEventRect[];
  scroll: number;
}

/** Adds or removes event bars touched by a freehand timeline segment. */
export function selectEventsAlongSegment(
  session: EditorSession,
  sweep: SelectionSweep,
  geometry: EventSweepGeometry,
): SelectionGestureResult {
  let dirty = false;
  let matched = false;
  const multi = session.multiLineActive && session.multiLineMode === "events";
  for (const hit of geometry.rectangles) {
    const lineIndex = hit.lineIndex ?? session.lineIndex;
    if (multi && !session.targetLineIndices.includes(lineIndex)) {
      continue;
    }
    if (
      !segmentTouchesRectangle(sweep, {
        left: hit.x + geometry.scroll,
        top: hit.y,
        right: hit.x + hit.width + geometry.scroll,
        bottom: hit.y + hit.height,
      })
    ) {
      continue;
    }
    matched = true;
    const key = eventKey(hit.type, hit.index);
    const selected =
      multi && lineIndex !== session.lineIndex
        ? (session.multiEventSelection.get(lineIndex) ?? new Set<string>())
        : session.eventSelection;
    const changed = sweep.remove ? selected.delete(key) : !selected.has(key);
    if (!changed) {
      continue;
    }
    dirty = true;
    if (!sweep.remove) {
      selected.add(key);
    }
    if (multi) {
      session.multiEventSelection.set(lineIndex, selected);
    }
  }
  if (multi) {
    session.eventSelection = new Set(session.multiEventSelection.get(session.lineIndex) ?? []);
  }
  if (dirty) {
    session.notify();
  }
  return { changed: dirty, matched };
}

/** Event arrays are immutable chart revisions; their paint lanes only need one sweep. */
const laneCache = new WeakMap<object, ReturnType<typeof shaderEventLanes>>();

/** Returns cached paint lanes for one immutable event array. */
function lanesFor(items: readonly JudgeLineEvent[]): ReturnType<typeof shaderEventLanes> {
  const cached = laneCache.get(items);
  if (cached) {
    return cached;
  }
  const lanes = shaderEventLanes(items);
  laneCache.set(items, lanes);
  return lanes;
}

/** Adds or removes events whose rectangles or columns intersect the marquee. */
export function selectEventsInRectangle(
  session: EditorSession,
  rectangle: SelectionRectangle,
  geometry: EventSelectionGeometry,
): SelectionGestureResult {
  const { left, right, bottom, top, remove } = rectangle;
  let dirty = restoreEventBaseline(session, rectangle.baseEvents, rectangle.append ?? false);
  let matched = false;
  dirty = pruneEventBaseline(session) || dirty;
  if (session.multiLineActive && session.multiLineMode === "events") {
    for (const hit of geometry.rectangles) {
      if (hit.x + geometry.scroll >= right || hit.x + hit.width + geometry.scroll <= left) {
        continue;
      }
      const lineIndex = hit.lineIndex ?? session.lineIndex;
      const item = eventListAt(session, lineIndex, hit.type)[hit.index];
      const selected =
        lineIndex === session.lineIndex
          ? session.eventSelection
          : (session.multiEventSelection?.get(lineIndex) ?? new Set<string>());
      const invalidRange = item && hasNonPositiveRange(item.startTime, item.endTime);
      if (
        !item ||
        (invalidRange
          ? beatValue(item.startTime) > top || beatValue(item.startTime) < bottom
          : beatValue(item.startTime) > top || beatValue(item.endTime) < bottom)
      ) {
        continue;
      }
      const key = eventKey(hit.type, hit.index);
      const changed = remove ? selected.delete(key) : !selected.has(key);
      if (changed) {
        dirty = true;
        if (!remove) {
          selected.add(key);
        }
      }
      if (lineIndex === session.lineIndex) {
        session.eventSelection = selected;
      }
      session.multiEventSelection?.set(lineIndex, selected);
    }
  } else {
    geometry.eventTypes.forEach((type, channel) => {
      const bounds = geometry.columnBounds(channel);
      if (bounds.x >= right || bounds.x + bounds.width <= left) {
        return;
      }
      const items = eventList(session, type);
      const lanes = type === "paintEvents" ? lanesFor(items) : null;
      for (const entry of geometry.eventsInRange(type, bottom, top)) {
        const index = entry.index;
        if (lanes) {
          const lane = lanes.get(index);
          if (!lane) {
            continue;
          }
          const width = bounds.width / lane.count;
          const x = bounds.x + lane.lane * width;
          if (x >= right || x + Math.max(2, width - (lane.count > 1 ? 2 : 0)) <= left) {
            continue;
          }
          matched = true;
        }
        const key = eventKey(type, index);
        matched = true;
        const changed = remove
          ? session.eventSelection.delete(key)
          : !session.eventSelection.has(key);
        if (changed) {
          dirty = true;
          if (!remove) {
            session.eventSelection.add(key);
          }
        }
      }
    });
  }
  if (dirty) {
    session.notify();
  }
  return { changed: dirty, matched };
}

/** Drops event keys that stopped resolving after an edit or undo. */
function pruneEventBaseline(session: EditorSession): boolean {
  let dirty = false;
  const lineCount = session.chart.judgeLineList?.length ?? 0;
  for (const [lineIndex, keys] of session.multiEventSelection) {
    if (lineIndex < 0 || lineIndex >= lineCount) {
      session.multiEventSelection.delete(lineIndex);
      dirty = true;
      continue;
    }
    for (const key of keys) {
      if (!validEventKey(session, lineIndex, key)) {
        keys.delete(key);
        dirty = true;
      }
    }
    if (!keys.size && lineIndex !== session.lineIndex) {
      session.multiEventSelection.delete(lineIndex);
      dirty = true;
    }
  }
  for (const key of session.eventSelection) {
    if (!validEventKey(session, session.lineIndex, key)) {
      session.eventSelection.delete(key);
      dirty = true;
    }
  }
  return dirty;
}

/** Shifts selected event starts, ends, or both by an exact beat increment. */
export function shiftSelectedEvents(
  session: EditorSession,
  kind: string,
  delta: number | Beat,
  label: string,
): void {
  // A number is a continuous drag measurement; converting it once here is the
  // boundary. Everything after it is exact tuple arithmetic.
  const increment = typeof delta === "number" ? fromNumber(delta) : normalizeBeat(delta);
  const multi = session.multiLineActive && session.multiLineMode === "events";
  if (
    compareBeats(increment, [0, 0, 1]) === 0 ||
    !(multi
      ? [...session.multiEventSelection.values()].some((values) => values.size)
      : selectedEvents(session).length)
  ) {
    return;
  }
  const change = (event: JudgeLineEvent): JudgeLineEvent => ({
    ...event,
    startTime: kind === "endTime" ? event.startTime : addBeats(event.startTime, increment),
    endTime: kind === "startTime" ? event.endTime : addBeats(event.endTime, increment),
  });
  if (multi) {
    commitSelectionEdit(
      session,
      editCapturedSelection(captureSelection(session), { event: change }),
      label,
      {},
      { normalized: true },
    );
  } else {
    transformEvents(session, label, change);
  }
}

/** Commits a note drag through the multi-line or single-line path. */
export function commitNoteDrag(
  session: EditorSession,
  move: (note: TimelineNote) => TimelineNote,
  label: string,
  beforeCommit: () => void,
): void {
  if (session.multiLineActive && session.multiLineMode === "notes") {
    const result = editCapturedSelection(captureSelection(session), {
      note: (note) => move(note as TimelineNote),
    });
    beforeCommit();
    commitSelectionEdit(session, result, label, {}, { normalized: true });
  } else {
    const notes = checkedNotes(session.notes);
    const replacements = new Map<JudgeLineNote, JudgeLineNote>(
      [...session.selection].map((index) => [notes[index], move(notes[index])]),
    );
    beforeCommit();
    session.transformSelection(label, (note) => replacements.get(note) ?? note);
  }
}
