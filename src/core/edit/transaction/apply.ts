/* eslint-disable max-lines -- the kernel owns cloning, batch operations, validation, and commit. */
/**
 * Pure transaction apply kernel: lazily clones the lines a request touches,
 * applies inserts/updates/deletes, collects issues, and commits the resulting
 * chart as one history entry. The public API and preview planner both call this
 * module; it never imports either caller. An internal origin tag travels from a
 * detached request to the history entry its commit records.
 */
import {
  createLine,
  countScoringNotes,
  EXTENDED_TYPES,
  markChartObjectIdNormalized,
  markChartObjectCollectionNormalized,
  noteScoringWeight,
  type Chart,
  type JudgeLine,
  type JudgeLineEvent,
  type JudgeLineNote,
} from "../../global/chart/chart.ts";
import {
  createChartObjectId,
  isChartObjectId,
  type ChartObjectId,
} from "../../global/chart/identity.ts";
import { chartFingerprint } from "../document/chartRevision.ts";
import { removeValueContentFingerprint } from "../../global/chart/chartContentHash.ts";
import { isRecord } from "../../utils/guards.ts";
import { containsCycle } from "../../global/chart/cycles.ts";
import type { EditorSession } from "../session/session.ts";
import type {
  ChartTransactionRequest,
  ChartTransactionResult,
  TransactionCommitOptions,
  TransactionConflict,
  TransactionEventInsert,
  TransactionHistorySummary,
  TransactionJudgeLineUpdate,
  TransactionLineInsert,
  TransactionLineTarget,
  TransactionNoteInsert,
  TransactionObjectUpdate,
  TransactionIssue,
} from "./contract.ts";
import type { HistoryEntryMetadata, HistoryEntryOrigin } from "../session/history.ts";
import { t } from "../../../i18n/index.ts";
import {
  adoptChartLocations,
  appendObjectIdView,
  collectChartObjectIds,
  detachChartLocations,
  ensureChartLocations,
  eventTrackSpliced,
  findEvent,
  inheritChartLocations,
  inheritObjectIdView,
  locateLine,
  locateNote,
  noteLineSpliced,
  rebuildChartLocations,
  registerEventInIndex,
  registerLineInIndex,
  registerNoteInIndex,
  type LocatedLine,
} from "./locations.ts";
import {
  ensureEventList,
  issue,
  mutableEventListFor,
  mutableLine,
  mutableNote,
  mutableNotes,
  type MutableTransactionState,
} from "./mutable.ts";
import { applyJudgeLinePatch, validateTouchedLineRelations } from "./linePatches.ts";
import { applyTiming } from "./timing.ts";

const NOTE_PATCH_BLOCKLIST = new Set(["id"]);
const EVENT_PATCH_BLOCKLIST = new Set(["id", "line", "lineIndex", "eventType", "layer"]);
const UNSAFE_PATCH_FIELDS = new Set(["__proto__", "prototype", "constructor"]);

/**
 * Applies one line's scoring-count delta.
 *
 * A line's current `numOfNotes` is the authoritative start the kernel edits, so
 * inserts, deletes, and note-type patches adjust it instead of recounting an
 * entire line. A chart line without a numeric count falls back to one exact
 * recount of its final notes.
 */
function adjustNoteCount(line: JudgeLine, delta: number): void {
  if (!delta) {
    return;
  }
  line.numOfNotes =
    typeof line.numOfNotes === "number"
      ? Math.max(0, line.numOfNotes + delta)
      : countScoringNotes(line.notes);
}

/** Private audit origins: request tag, then the plan chart its preview commits. */
const requestOrigins = new WeakMap<object, HistoryEntryOrigin>();
const chartOrigins = new WeakMap<Chart, HistoryEntryOrigin>();

/** Tag a detached request with the origin its eventual commit must record. */
export function withTransactionOrigin<T>(request: T, origin: HistoryEntryOrigin): T {
  if (!isRecord(request)) {
    return request;
  }
  const tagged = { ...request };
  requestOrigins.set(tagged, Object.freeze({ ...origin }));
  return tagged as T;
}

export type { MutableTransactionState } from "./mutable.ts";
export { issue } from "./mutable.ts";

/**
 * Clones only the containers a transaction may mutate.
 *
 * Judge lines stay shared and are cloned on first mutation, and the source
 * chart's location index moves to the copy so a one-object edit reuses it.
 * Untouched line objects stay shared, so their cached content digests are
 * reused without copying a per-chart digest map.
 */
export function transactionChart(source: Chart): Chart {
  const target = {
    ...source,
    // A transaction replaces metadata keys and the whole tempo map instead of
    // mutating them in place, so a shallow header copy isolates the source and
    // keeps the nested effect list identical for incremental id normalization.
    META: { ...source.META },
    BPMList: source.BPMList,
    judgeLineList: source.judgeLineList ? [...source.judgeLineList] : source.judgeLineList,
    // Transaction operations do not mutate these root event arrays. Reusing
    // them lets incremental id normalization distinguish a line edit from a
    // root-chart replacement without scanning every object again.
    ...(Array.isArray(source.effects) ? { effects: source.effects } : {}),
    ...(Array.isArray(source.shaderEvents) ? { shaderEvents: source.shaderEvents } : {}),
  };
  inheritChartLocations(source, target);
  return target;
}

/** Copy and freeze an issue list for a public transaction result. */
export function freezeIssues(issues: readonly TransactionIssue[]): readonly TransactionIssue[] {
  return Object.freeze([...issues]);
}

/** Copy and freeze an affected-object id list. */
export function freezeIds(ids: readonly ChartObjectId[]): readonly ChartObjectId[] {
  return Object.freeze([...ids]);
}

/** Chart identity shared with history and the document coordinator. */
export function fingerprint(chart: Chart): string {
  return chartFingerprint(chart);
}

/** Build the stable public result envelope for every transaction outcome. */
export function result(
  status: ChartTransactionResult["status"],
  beforeFingerprint: string | null,
  afterFingerprint: string | null,
  affectedObjectIds: readonly ChartObjectId[],
  issues: readonly TransactionIssue[],
  history: TransactionHistorySummary | null,
  conflict: TransactionConflict | null = null,
): ChartTransactionResult {
  return Object.freeze({
    status,
    beforeFingerprint,
    afterFingerprint,
    affectedObjectIds: freezeIds(affectedObjectIds),
    issues: freezeIssues(issues),
    history: history ? Object.freeze(history) : null,
    conflict: conflict ? Object.freeze(conflict) : null,
  });
}

/** Records an id once in the affected list. */
function addAffected(state: MutableTransactionState, id: unknown): void {
  if (!isChartObjectId(id)) {
    return;
  }
  const seen = (state.affectedSet ??= new Set(state.affected));
  if (!seen.has(id)) {
    seen.add(id);
    state.affected.push(id);
  }
}

/** Populates the used-id set on the first insert instead of every update-only edit. */
function ensureUsedIds(state: MutableTransactionState): void {
  if (state.usedIdsReady !== false) {
    return;
  }
  for (const id of collectChartObjectIds(state.chart)) {
    state.usedIds.add(id);
  }
  state.usedIdsReady = true;
}

/** Accepts a supplied unused id, or generates a unique one. */
function nextId(
  state: MutableTransactionState,
  value: unknown,
  path: string,
): ChartObjectId | null {
  if (value !== undefined) {
    // Caller-supplied ids must still be checked against the complete chart.
    ensureUsedIds(state);
    if (!isChartObjectId(value)) {
      state.issues.push(issue("object.id.invalid", path));
      return null;
    }
    if (state.usedIds.has(value)) {
      state.issues.push(issue("object.id.duplicate", path, value));
      return null;
    }
    state.usedIds.add(value);
    return value;
  }
  // Generated ids already come from the shared UUID-shaped identity factory.
  // Avoid the million-object scan that was previously used to prove a random
  // id unique; generated editor ids use the same collision model everywhere
  // else in the editor, while explicit ids keep the strict validation path.
  let id = createChartObjectId();
  while (state.usedIds.has(id)) {
    id = createChartObjectId();
  }
  state.usedIds.add(id);
  return id;
}

/** Detaches a patch value from the request object. */
function clonePatchValue(value: unknown): unknown {
  return structuredClone(value);
}

/** Copies allowed patch fields onto a target, recording blocked or unsafe keys. */
function applyPatch(
  target: Record<string, unknown>,
  patch: unknown,
  blocked: ReadonlySet<string>,
  path: string,
  issues: TransactionIssue[],
): void {
  if (!isRecord(patch)) {
    issues.push(issue("patch.object.required", path));
    return;
  }
  for (const [key, value] of Object.entries(patch)) {
    if (UNSAFE_PATCH_FIELDS.has(key)) {
      issues.push(issue("patch.field.unsafe", `${path}.${key}`));
      continue;
    }
    if (blocked.has(key)) {
      issues.push(issue("patch.field.immutable", `${path}.${key}`));
      continue;
    }
    try {
      const cloned = clonePatchValue(value);
      if (containsCycle(cloned)) {
        issues.push(issue("patch.value.cyclic", `${path}.${key}`));
        continue;
      }
      target[key] = cloned;
    } catch (error) {
      issues.push(
        issue(
          "patch.value.uncloneable",
          `${path}.${key}`,
          undefined,
          error instanceof Error ? error.message : String(error),
        ),
      );
    }
  }
}

/** Resolves a line target by id, index, or both; conflicting targets fail. */
function findLine(
  chart: Chart,
  target: TransactionLineTarget,
  path: string,
  state: MutableTransactionState,
): LocatedLine | null {
  const hasId = target.lineId !== undefined;
  const hasIndex = target.lineIndex !== undefined;
  if (!hasId && !hasIndex) {
    state.issues.push(issue("line.target.required", path));
    return null;
  }
  let byId: LocatedLine | null = null;
  if (hasId) {
    if (!isChartObjectId(target.lineId)) {
      state.issues.push(issue("line.id.invalid", `${path}.lineId`));
    } else {
      const located = locateLine(chart, target.lineId);
      if (!located) {
        state.issues.push(issue("line.id.notFound", `${path}.lineId`, target.lineId));
      } else {
        byId = located;
      }
    }
  }
  let byIndex: LocatedLine | null = null;
  if (hasIndex) {
    if (!Number.isInteger(target.lineIndex) || (target.lineIndex ?? -1) < 0) {
      state.issues.push(issue("line.index.invalid", `${path}.lineIndex`));
    } else {
      const line = chart.judgeLineList?.[target.lineIndex];
      if (!line) {
        state.issues.push(issue("line.index.notFound", `${path}.lineIndex`));
      } else {
        byIndex = { line, index: target.lineIndex };
      }
    }
  }
  if (byId && byIndex && byId.index !== byIndex.index) {
    state.issues.push(issue("line.target.mismatch", path));
    return null;
  }
  return byId ?? byIndex;
}

/** Rejects an update/delete id that is not a chart object id. */
function validateObjectId(
  value: unknown,
  path: string,
  state: MutableTransactionState,
): ChartObjectId | null {
  if (!isChartObjectId(value)) {
    state.issues.push(issue("object.id.invalid", path));
    return null;
  }
  return value;
}

/** Reserves the id for a newly inserted object. */
function validateInsertId(
  state: MutableTransactionState,
  object: Record<string, unknown>,
  path: string,
): ChartObjectId | null {
  return nextId(state, object.id, `${path}.id`);
}

/** Inserts one note and refreshes its line's scoring count. */
function insertNote(
  state: MutableTransactionState,
  entry: TransactionNoteInsert,
  index: number,
): void {
  if (!isRecord(entry)) {
    state.issues.push(issue("note.insert.object.required", `notes.insert[${index}]`));
    return;
  }
  const located = findLine(state.chart, entry, `notes.insert[${index}]`, state);
  if (!located || !isRecord(entry.note)) {
    if (!isRecord(entry.note)) {
      state.issues.push(issue("note.insert.note.required", `notes.insert[${index}].note`));
    }
    return;
  }
  const line = mutableLine(state, located);
  const notes = mutableNotes(state, line, located.index);
  const note = structuredClone(entry.note);
  const id = validateInsertId(state, note, `notes.insert[${index}].note`);
  if (!id) {
    return;
  }
  note.id = id;
  if (entry.note.id === undefined) {
    markChartObjectIdNormalized(note);
  }
  notes.push(note);
  appendObjectIdView(notes, id);
  (state.changedNotes ??= new Set()).add({
    note,
    lineIndex: located.index,
    noteIndex: notes.length - 1,
  });
  registerNoteInIndex(state.chart, located.index, id, notes.length - 1);
  adjustNoteCount(line, noteScoringWeight(note));
  addAffected(state, id);
  addAffected(state, line.id);
}

/** Inserts one event on its resolved track and layer. */
function insertEvent(
  state: MutableTransactionState,
  entry: TransactionEventInsert,
  index: number,
): void {
  if (!isRecord(entry)) {
    state.issues.push(issue("event.insert.object.required", `events.insert[${index}]`));
    return;
  }
  const located = findLine(state.chart, entry, `events.insert[${index}]`, state);
  if (!located || !isRecord(entry.event)) {
    if (!isRecord(entry.event)) {
      state.issues.push(issue("event.insert.event.required", `events.insert[${index}].event`));
    }
    return;
  }
  const line = mutableLine(state, located);
  if (typeof entry.eventType !== "string") {
    state.issues.push(issue("event.type.required", `events.insert[${index}].eventType`));
    return;
  }
  const events = ensureEventList(
    line,
    located.index,
    entry.eventType,
    entry.layer,
    `events.insert[${index}]`,
    state,
  );
  if (!events) {
    return;
  }
  const event = structuredClone(entry.event);
  const id = validateInsertId(state, event, `events.insert[${index}].event`);
  if (!id) {
    return;
  }
  event.id = id;
  const nextEvent = { start: 0, end: 0, ...event };
  if (entry.event.id === undefined) {
    markChartObjectIdNormalized(nextEvent);
  }
  events.push(nextEvent);
  appendObjectIdView(events, id);
  const layerIndex =
    entry.layer === "extended" ||
    (entry.layer === undefined && (EXTENDED_TYPES as readonly string[]).includes(entry.eventType))
      ? -1
      : typeof entry.layer === "number"
        ? entry.layer
        : 0;
  registerEventInIndex(
    state.chart,
    located.index,
    layerIndex,
    entry.eventType,
    id,
    events.length - 1,
  );
  (state.changedEvents ??= new Set()).add({
    event: nextEvent,
    lineIndex: located.index,
    layerIndex,
    track: entry.eventType,
    eventIndex: events.length - 1,
  });
  addAffected(state, id);
  addAffected(state, line.id);
}

/** Applies note updates and deletes, rejecting duplicate operations per id. */
function updateNotes(
  state: MutableTransactionState,
  updates: readonly TransactionObjectUpdate[],
  deletes: readonly unknown[],
): void {
  const touched = new Set<ChartObjectId>();
  // Two or more id lookups amortize one index build; a single lookup stays a
  // direct scan so small edits do not pay for a whole-chart index.
  if (updates.length + deletes.length > 1) {
    ensureChartLocations(state.chart);
  }
  for (const [index, update] of updates.entries()) {
    if (!isRecord(update)) {
      state.issues.push(issue("note.update.object.required", `notes.update[${index}]`));
      continue;
    }
    const id = validateObjectId(update.id, `notes.update[${index}].id`, state);
    if (!id) {
      continue;
    }
    if (touched.has(id)) {
      state.issues.push(issue("object.operation.conflict", `notes.update[${index}].id`, id));
      continue;
    }
    touched.add(id);
    const located = locateNote(state.chart, id);
    if (!located) {
      state.issues.push(issue("note.id.notFound", `notes.update[${index}].id`, id));
      continue;
    }
    const previousWeight = noteScoringWeight(located.note);
    const previousNotes = located.notes;
    const line = mutableLine(state, { line: located.line, index: located.lineIndex });
    const notes = mutableNotes(state, line, located.lineIndex);
    inheritObjectIdView(previousNotes, notes);
    applyPatch(
      mutableNote(notes, located.noteIndex),
      update.patch,
      NOTE_PATCH_BLOCKLIST,
      `notes.update[${index}].patch`,
      state.issues,
    );
    const changedNote = notes[located.noteIndex];
    if (changedNote) {
      (state.changedNotes ??= new Set()).add({
        note: changedNote,
        lineIndex: located.lineIndex,
        noteIndex: located.noteIndex,
      });
    }
    adjustNoteCount(line, noteScoringWeight(changedNote) - previousWeight);
    addAffected(state, id);
    addAffected(state, line.id);
  }
  const deletedByLine = new Map<
    number,
    {
      readonly indices: number[];
      readonly ids: ChartObjectId[];
      readonly notes: JudgeLineNote[];
    }
  >();
  for (const [index, value] of deletes.entries()) {
    const id = validateObjectId(value, `notes.delete[${index}]`, state);
    if (!id) {
      continue;
    }
    if (touched.has(id)) {
      state.issues.push(issue("object.operation.conflict", `notes.delete[${index}]`, id));
      continue;
    }
    touched.add(id);
    const located = locateNote(state.chart, id);
    if (!located) {
      state.issues.push(issue("note.id.notFound", `notes.delete[${index}]`, id));
      continue;
    }
    mutableLine(state, { line: located.line, index: located.lineIndex });
    const deleted = deletedByLine.get(located.lineIndex);
    if (deleted) {
      deleted.indices.push(located.noteIndex);
      deleted.ids.push(id);
    } else {
      deletedByLine.set(located.lineIndex, {
        indices: [located.noteIndex],
        ids: [id],
        notes: located.notes,
      });
    }
    addAffected(state, id);
    addAffected(state, located.line.id);
  }
  for (const [lineIndex, deleted] of deletedByLine) {
    const line = state.chart.judgeLineList?.[lineIndex];
    if (!line) {
      continue;
    }
    const sourceNotes = mutableNotes(state, line, lineIndex);
    inheritObjectIdView(deleted.notes, sourceNotes);
    removeValueContentFingerprint(sourceNotes, sourceNotes, deleted.indices);
    let removedWeight = 0;
    for (const noteIndex of deleted.indices) {
      removedWeight += noteScoringWeight(sourceNotes[noteIndex]);
    }
    for (const noteIndex of [...deleted.indices].sort((left, right) => right - left)) {
      sourceNotes.splice(noteIndex, 1);
    }
    line.notes = sourceNotes;
    markChartObjectCollectionNormalized(sourceNotes);
    noteLineSpliced(state.chart, lineIndex, deleted.indices, deleted.ids);
    adjustNoteCount(line, -removedWeight);
  }
}

/** Resolves a located event's index after copy-on-write replaced the track array. */
function currentEventIndex(
  events: Record<string, unknown>[],
  located: { readonly event: Record<string, unknown>; readonly eventIndex: number },
): number {
  return events[located.eventIndex] === located.event
    ? located.eventIndex
    : events.indexOf(located.event);
}

/** Applies event updates and deletes, batching lookups and deletions. */
function updateEvents(
  state: MutableTransactionState,
  updates: readonly TransactionObjectUpdate[],
  deletes: readonly unknown[],
): void {
  const touched = new Set<ChartObjectId>();
  // Two or more id lookups amortize one index build; a single lookup stays a
  // direct scan so small edits do not pay for a whole-chart index.
  if (updates.length + deletes.length > 1) {
    ensureChartLocations(state.chart);
  }
  for (const [index, update] of updates.entries()) {
    if (!isRecord(update)) {
      state.issues.push(issue("event.update.object.required", `events.update[${index}]`));
      continue;
    }
    const id = validateObjectId(update.id, `events.update[${index}].id`, state);
    if (!id) {
      continue;
    }
    if (touched.has(id)) {
      state.issues.push(issue("object.operation.conflict", `events.update[${index}].id`, id));
      continue;
    }
    touched.add(id);
    const located = findEvent(state.chart, id);
    if (!located) {
      state.issues.push(issue("event.id.notFound", `events.update[${index}].id`, id));
      continue;
    }
    const events = mutableEventListFor(state, located);
    if (events !== located.events) {
      inheritObjectIdView(located.events, events);
    }
    const eventIndex = currentEventIndex(events, located);
    if (eventIndex < 0) {
      continue;
    }
    const mutable = { ...events[eventIndex] };
    events[eventIndex] = mutable;
    applyPatch(
      mutable,
      update.patch,
      EVENT_PATCH_BLOCKLIST,
      `events.update[${index}].patch`,
      state.issues,
    );
    if (located.line && located.track && located.layerIndex !== null) {
      (state.changedEvents ??= new Set()).add({
        event: mutable as unknown as JudgeLineEvent,
        lineIndex: located.line.index,
        layerIndex: located.layerIndex,
        track: located.track,
        eventIndex,
      });
    }
    addAffected(state, id);
    addAffected(state, located.line?.line.id);
  }

  // Resolve every deletion against the index before mutating any track, then
  // splice each list from the end. This keeps the cached positions valid and
  // avoids one invalidation per deleted event.
  const deletions: {
    readonly events: Record<string, unknown>[];
    readonly eventIndex: number;
    readonly id: ChartObjectId;
  }[] = [];
  for (const [index, value] of deletes.entries()) {
    const id = validateObjectId(value, `events.delete[${index}]`, state);
    if (!id) {
      continue;
    }
    if (touched.has(id)) {
      state.issues.push(issue("object.operation.conflict", `events.delete[${index}]`, id));
      continue;
    }
    touched.add(id);
    const located = findEvent(state.chart, id);
    if (!located) {
      state.issues.push(issue("event.id.notFound", `events.delete[${index}]`, id));
      continue;
    }
    const events = mutableEventListFor(state, located);
    if (events !== located.events) {
      inheritObjectIdView(located.events, events);
    }
    const eventIndex = currentEventIndex(events, located);
    if (eventIndex < 0) {
      continue;
    }
    deletions.push({ events, eventIndex, id });
    addAffected(state, id);
    addAffected(state, located.line?.line.id);
  }
  if (deletions.length) {
    const byList = new Map<
      Record<string, unknown>[],
      { readonly indexes: number[]; readonly ids: ChartObjectId[] }
    >();
    for (const deletion of deletions) {
      const list = byList.get(deletion.events);
      if (list) {
        list.indexes.push(deletion.eventIndex);
        list.ids.push(deletion.id);
      } else {
        byList.set(deletion.events, { indexes: [deletion.eventIndex], ids: [deletion.id] });
      }
    }
    for (const [events, deleted] of byList) {
      deleted.indexes.sort((left, right) => right - left);
      for (const eventIndex of deleted.indexes) {
        events.splice(eventIndex, 1);
      }
      eventTrackSpliced(state.chart, events, deleted.indexes, deleted.ids);
    }
    if (deletions.length > 1) {
      rebuildChartLocations(state.chart);
    }
  }
}

/** Inserts one judge line and then applies its editable patch fields. */
function insertLine(
  state: MutableTransactionState,
  entry: TransactionLineInsert,
  index: number,
): void {
  if (!isRecord(entry) || !isRecord(entry.line)) {
    state.issues.push(issue("line.insert.line.required", `lines.insert[${index}].line`));
    return;
  }
  const path = `lines.insert[${index}].line`;
  const line = createLine(typeof entry.line.Name === "string" ? entry.line.Name : undefined);
  const id = nextId(state, entry.line.id, `${path}.id`);
  if (!id) {
    return;
  }
  line.id = id;
  if (entry.line.id === undefined) {
    markChartObjectIdNormalized(line);
  }
  state.chart.judgeLineList ??= [];
  state.chart.judgeLineList.push(line);
  state.clonedLines.add(state.chart.judgeLineList.length - 1);
  (state.fullLineValidation ??= new Set()).add(state.chart.judgeLineList.length - 1);
  registerLineInIndex(state.chart, state.chart.judgeLineList.length - 1);
  applyJudgeLinePatch(
    state.chart,
    state.issues,
    state.relationTouched,
    line,
    id,
    entry.line,
    path,
    applyPatch,
  );
  addAffected(state, id);
}

/** Applies line patches and records parent-relation changes for validation. */
function updateLines(
  state: MutableTransactionState,
  updates: readonly TransactionJudgeLineUpdate[],
): void {
  const touched = new Set<ChartObjectId>();
  // Two or more id lookups amortize one index build; a single lookup stays a
  // direct scan so small edits do not pay for a whole-chart index.
  if (updates.length > 1) {
    ensureChartLocations(state.chart);
  }
  for (const [index, update] of updates.entries()) {
    if (!isRecord(update)) {
      state.issues.push(issue("line.update.object.required", `lines.update[${index}]`));
      continue;
    }
    const id = validateObjectId(update.id, `lines.update[${index}].id`, state);
    if (!id) {
      continue;
    }
    if (touched.has(id)) {
      state.issues.push(issue("object.operation.conflict", `lines.update[${index}].id`, id));
      continue;
    }
    touched.add(id);
    const located = locateLine(state.chart, id);
    if (!located) {
      state.issues.push(issue("line.id.notFound", `lines.update[${index}].id`, id));
      continue;
    }
    const mutable = mutableLine(state, located);
    applyJudgeLinePatch(
      state.chart,
      state.issues,
      state.relationTouched,
      mutable,
      id,
      update.patch,
      `lines.update[${index}].patch`,
      applyPatch,
    );
    addAffected(state, id);
  }
}

/** Reads an optional operation array, recording an issue for other shapes. */
function readArray(
  value: unknown,
  path: string,
  state: MutableTransactionState,
): readonly unknown[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    state.issues.push(issue("operations.array.required", path));
    return [];
  }
  return value;
}

/** Apply metadata, timing, line, note and event operations to a mutable transaction state. */
export function applyRequest(
  state: MutableTransactionState,
  request: ChartTransactionRequest,
): void {
  const origin = requestOrigins.get(request);
  if (origin) {
    chartOrigins.set(state.chart, origin);
  }
  if (request.metadata !== undefined) {
    applyPatch(state.chart.META, request.metadata, new Set(), "metadata", state.issues);
  }
  if (request.timing !== undefined) {
    applyTiming(state.chart, request.timing, state.issues);
  }
  if (request.lines !== undefined) {
    if (!isRecord(request.lines)) {
      state.issues.push(issue("lines.object.required", "lines"));
    } else {
      for (const [index, entry] of readArray(
        request.lines.insert,
        "lines.insert",
        state,
      ).entries()) {
        insertLine(state, entry as TransactionLineInsert, index);
      }
      updateLines(
        state,
        readArray(
          request.lines.update,
          "lines.update",
          state,
        ) as readonly TransactionJudgeLineUpdate[],
      );
    }
  }
  if (request.notes !== undefined) {
    if (!isRecord(request.notes)) {
      state.issues.push(issue("notes.object.required", "notes"));
    } else {
      for (const [index, entry] of readArray(
        request.notes.insert,
        "notes.insert",
        state,
      ).entries()) {
        insertNote(state, entry as TransactionNoteInsert, index);
      }
      updateNotes(
        state,
        readArray(
          request.notes.update,
          "notes.update",
          state,
        ) as readonly TransactionObjectUpdate[],
        readArray(request.notes.delete, "notes.delete", state),
      );
    }
  }
  if (request.events !== undefined) {
    if (!isRecord(request.events)) {
      state.issues.push(issue("events.object.required", "events"));
    } else {
      for (const [index, entry] of readArray(
        request.events.insert,
        "events.insert",
        state,
      ).entries()) {
        insertEvent(state, entry as TransactionEventInsert, index);
      }
      updateEvents(
        state,
        readArray(
          request.events.update,
          "events.update",
          state,
        ) as readonly TransactionObjectUpdate[],
        readArray(request.events.delete, "events.delete", state),
      );
    }
  }
  validateTouchedLineRelations(state.chart, state.relationTouched, state.issues);
}

/** Return the caller label or the localized default transaction label. */
export function transactionLabel(request: ChartTransactionRequest): string {
  return request.label?.trim() || t("editor.session.transaction");
}

/** Commit a planned chart once, returning unchanged/conflict/committed with history details. */
export function commitTransaction(
  session: EditorSession,
  chart: Chart,
  label: string,
  beforeFingerprint: string,
  affectedObjectIds: readonly ChartObjectId[],
  options: TransactionCommitOptions = {},
): ChartTransactionResult {
  const currentFingerprint = fingerprint(session.chart);
  const expectedFingerprint = options.expectedFingerprint ?? beforeFingerprint;
  if (currentFingerprint !== expectedFingerprint || currentFingerprint !== beforeFingerprint) {
    const conflict: TransactionConflict = {
      code: "chartFingerprint",
      expectedFingerprint:
        currentFingerprint !== expectedFingerprint ? expectedFingerprint : beforeFingerprint,
      currentFingerprint,
    };
    return result("conflict", currentFingerprint, currentFingerprint, [], [], null, conflict);
  }
  const afterFingerprint = options.afterFingerprint ?? fingerprint(chart);
  if (beforeFingerprint === afterFingerprint) {
    return result("unchanged", beforeFingerprint, afterFingerprint, [], [], null);
  }
  const origin = options.origin ?? chartOrigins.get(chart);
  const metadata: HistoryEntryMetadata = {
    affectedObjectIds,
    issues: [],
    ...(origin ? { origin } : {}),
  };
  // The commit boundary invalidates the committed chart's cache so old history
  // snapshots do not retain it; carry the planned chart's index across and hand
  // it to the document the session keeps next.
  const locations = detachChartLocations(chart);
  const committed = session.commitChart(
    label,
    chart,
    session.selectionState(),
    metadata,
    options.validatedNoise
      ? { validatedNoise: true, estimatedBytes: options.estimatedBytes }
      : options.estimatedBytes === undefined
        ? undefined
        : { estimatedBytes: options.estimatedBytes },
  );
  if (!committed) {
    adoptChartLocations(chart, locations);
    return result(
      "rejected",
      beforeFingerprint,
      fingerprint(session.chart),
      [],
      [issue("commit.rejected")],
      null,
    );
  }
  adoptChartLocations(session.chart, locations);
  const entry = session.history.undoStack.at(-1);
  if (!entry) {
    return result(
      "rejected",
      beforeFingerprint,
      beforeFingerprint,
      [],
      [issue("history.record.missing")],
      null,
    );
  }
  const history = {
    label: entry.label,
    beforeFingerprint: entry.beforeFingerprint,
    afterFingerprint: entry.afterFingerprint,
    affectedObjectIds: entry.affectedObjectIds,
    issues: entry.issues,
    origin: entry.origin ? Object.freeze({ ...entry.origin }) : null,
  } satisfies TransactionHistorySummary;
  return result(
    "committed",
    entry.beforeFingerprint,
    entry.afterFingerprint,
    entry.affectedObjectIds,
    [],
    history,
  );
}
