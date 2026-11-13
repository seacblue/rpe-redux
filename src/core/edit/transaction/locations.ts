/* eslint-disable max-lines -- the module owns both the full-chart index and the per-container id views. */
/**
 * Indexes mutable chart objects for transaction operations without exposing the chart.
 *
 * Two layers keep one single-object edit independent of chart size. A whole-chart
 * line/note/event index serves batch requests and is carried from the planned
 * chart to the committed document, so a sequence of edits inherits it instead of
 * rebuilding. A per-container id view (the ids of one notes or event array plus a
 * cheap key per slot) lets an uncached lookup walk the chart container by
 * container instead of comparing every object in every line.
 *
 * Both caches are keyed by container identity. Copy-on-write transactions share
 * untouched lines, note arrays, and event arrays with the source chart, so their
 * caches are inherited for free; an array the transaction replaces gets its view
 * carried over or dropped when it is spliced or extended.
 */
import {
  EVENT_TRACKS,
  lineEventLayers,
  type Chart,
  type JudgeLine,
  type JudgeLineNote,
  type LineEventLayer,
  type MutableEventLayer,
} from "../../global/chart/chart.ts";
import { isChartObjectId, type ChartObjectId } from "../../global/chart/identity.ts";
import { isRecord } from "../../utils/guards.ts";

const ROOT_EVENT_KEYS = ["effects", "shaderEvents"] as const;
type RootEventKey = (typeof ROOT_EVENT_KEYS)[number] | "metaEffects";
/** Every root event list, including the metadata-owned effects. */
const ALL_ROOT_EVENT_KEYS: readonly RootEventKey[] = [...ROOT_EVENT_KEYS, "metaEffects"];

export interface LocatedLine {
  readonly line: JudgeLine;
  readonly index: number;
}

export interface LocatedNote {
  readonly note: JudgeLineNote;
  readonly line: LocatedLine;
  readonly remove: () => void;
}

/** A note's current position inside its owning line. */
export interface NoteLocation {
  readonly line: JudgeLine;
  readonly lineIndex: number;
  readonly note: JudgeLineNote;
  readonly noteIndex: number;
  readonly notes: JudgeLineNote[];
}

/** One event plus the list that owns it, so callers can replace or remove it. */
export interface LocatedEvent {
  readonly event: Record<string, unknown>;
  readonly line: LocatedLine | null;
  readonly eventIndex: number;
  readonly events: Record<string, unknown>[];
  readonly track: string | null;
  /** 0-based normal layer, -1 for the extended layer, null for a root list. */
  readonly layerIndex: number | null;
  readonly remove: () => void;
}

/** The minimal chart surface needed to locate an event by id. */
export interface EventChart {
  readonly judgeLineList?: readonly unknown[];
}

interface LineNoteIndex {
  /** Line id when the lookup was built; a different line at this slot means reorder. */
  lineId: ChartObjectId | undefined;
  /** The note array the indexed positions describe. */
  notes: JudgeLineNote[];
}

interface NoteIndexEntry {
  readonly lineIndex: number;
  readonly noteIndex: number;
}

interface EventIndexEntry {
  /** Line slot, or -1 for an event stored directly on the chart. */
  readonly lineIndex: number;
  /** Normal layer slot, -1 for the extended layer, null for a root list. */
  readonly layerIndex: number | null;
  /** Event track name, or null for a root list. */
  readonly track: string | null;
  readonly eventIndex: number;
  /** Root list discriminator; absent for line events. */
  readonly root?: RootEventKey;
}

interface ChartLocationIndex {
  /** The line array the index addresses; a replaced array means the index is stale. */
  lineList: readonly unknown[] | undefined;
  lineCount: number;
  /**
   * True when every line and every object was indexed. A carried index for a
   * paged document is incomplete because a paged-in line can appear later.
   */
  complete: boolean;
  readonly lineById: Map<ChartObjectId, number>;
  readonly lineNotes: LineNoteIndex[];
  readonly noteById: Map<ChartObjectId, NoteIndexEntry>;
  readonly eventById: Map<ChartObjectId, EventIndexEntry>;
  /** Lines whose indexed note positions moved after a splice. */
  readonly noteShifts: Set<number>;
}

/**
 * Opaque handle for one chart's location index between the plan and its commit.
 *
 * The history record invalidates a committed chart's cache so old snapshots do
 * not retain indexes; the transaction kernel detaches the index from its working
 * chart before committing and installs it on the document the session keeps.
 */
export interface ChartLocationSnapshot {
  readonly lineCount: number;
}

/** Counters that let tests prove an edit batch stays linear in chart size. */
export interface ChartLocationDiagnostics {
  /** Full index builds, each of which scans every line, note, and event. */
  readonly indexBuilds: number;
  /** Full event scans performed while building an index. */
  readonly eventScans: number;
  /** Event lookups served by an index. */
  readonly eventLookups: number;
}

/**
 * Cheap id view of one container.
 *
 * `ids` carries each slot's id (undefined when the object cannot be addressed),
 * and `keys` carries the matching cheap key so a scan compares numbers in a
 * tight loop. Equal keys are always confirmed against `ids`.
 */
interface ObjectIdView {
  readonly ids: readonly (ChartObjectId | undefined)[];
  readonly keys: readonly number[];
}

const locationIndexes = new WeakMap<Chart, ChartLocationIndex>();
const objectIdViews = new WeakMap<readonly unknown[], ObjectIdView>();
const diagnostics = { indexBuilds: 0, eventScans: 0, eventLookups: 0 };

/** Read the current location-index counters. */
export function chartLocationDiagnostics(): ChartLocationDiagnostics {
  return Object.freeze({ ...diagnostics });
}

/** Clear the counters without dropping cached indexes. */
export function resetChartLocationDiagnostics(): void {
  diagnostics.indexBuilds = 0;
  diagnostics.eventScans = 0;
  diagnostics.eventLookups = 0;
}

/** True for an id field the index can address. */
function indexableId(value: unknown): value is ChartObjectId {
  return typeof value === "string" && value.length > 0;
}

/**
 * Cheap 32-bit key for a chart object id.
 *
 * Chart ids are UUID-shaped and their trailing group carries each object's
 * ambiguity suffix and entropy, so hashing the last characters separates sibling
 * notes and events without walking the whole string. Colliding keys are resolved
 * by comparing the full id.
 */
function objectIdKey(id: string): number {
  let key = id.length;
  for (let index = Math.max(0, id.length - 8); index < id.length; index += 1) {
    key = (Math.imul(key, 33) + id.charCodeAt(index)) | 0;
  }
  return key;
}

/** Builds the id view of one notes or event array. */
function createObjectIdView(container: readonly unknown[]): ObjectIdView {
  const ids = new Array<ChartObjectId | undefined>(container.length);
  const keys = new Array<number>(container.length);
  for (let index = 0; index < container.length; index += 1) {
    const item = container[index];
    const id =
      item !== null && typeof item === "object" ? (item as { id?: unknown }).id : undefined;
    if (indexableId(id)) {
      ids[index] = id;
      keys[index] = objectIdKey(id);
    } else {
      keys[index] = 0;
    }
  }
  return { ids, keys };
}

/** Returns one container's id view, building it once per array identity. */
function objectIdView(container: readonly unknown[]): ObjectIdView {
  const cached = objectIdViews.get(container);
  if (cached && cached.ids.length === container.length) {
    return cached;
  }
  const view = createObjectIdView(container);
  objectIdViews.set(container, view);
  return view;
}

/**
 * Finds one id inside a container through its id view.
 *
 * `key` is the caller's `objectIdKey(id)`, computed once per lookup so a scan
 * over many containers hashes the target id only once.
 */
function containerIndexOf(container: readonly unknown[], id: ChartObjectId, key: number): number {
  const { ids, keys } = objectIdView(container);
  for (let index = 0; index < keys.length; index += 1) {
    if (keys[index] === key && ids[index] === id) {
      return index;
    }
  }
  return -1;
}

/** Extends one container's id view after an object was appended in place. */
export function appendObjectIdView(container: readonly unknown[], id: ChartObjectId): void {
  const view = objectIdViews.get(container);
  if (!view || view.ids.length !== container.length - 1) {
    objectIdViews.delete(container);
    return;
  }
  objectIdViews.set(container, {
    ids: [...view.ids, id],
    keys: [...view.keys, objectIdKey(id)],
  });
}

/** Carries a container's id view to a copy that keeps the same slots in order. */
export function inheritObjectIdView(source: readonly unknown[], target: readonly unknown[]): void {
  const view = objectIdViews.get(source);
  if (view && view.ids.length === target.length) {
    objectIdViews.set(target, view);
  }
}

/**
 * Rewrites one container's id view without the slots a splice removed.
 *
 * A copy-on-write transaction inherits the view of the array it copied, so the
 * view still describes the pre-splice slots when the splice lands. When no view
 * exists yet nothing is retained: the next lookup builds it from the final array.
 */
function refreshObjectIdView(
  container: readonly unknown[],
  removedIndices: readonly number[],
): void {
  const view = objectIdViews.get(container);
  if (!view || !removedIndices.length) {
    objectIdViews.delete(container);
    return;
  }
  if (view.ids.length !== container.length + removedIndices.length) {
    objectIdViews.delete(container);
    return;
  }
  const ids = [...view.ids];
  const keys = [...view.keys];
  for (const index of [...removedIndices].sort((left, right) => right - left)) {
    ids.splice(index, 1);
    keys.splice(index, 1);
  }
  objectIdViews.set(container, { ids, keys });
}

/** Returns the chart's root event list for one root key. */
function rootEventList(chart: Chart, root: RootEventKey): Record<string, unknown>[] | null {
  if (root === "metaEffects") {
    const meta = isRecord(chart.META) ? chart.META : undefined;
    return Array.isArray(meta?.effects) ? (meta.effects as Record<string, unknown>[]) : null;
  }
  const events = chart[root];
  return Array.isArray(events) ? (events as Record<string, unknown>[]) : null;
}

/** Builds a complete line/note/event index; the first occurrence wins for duplicate ids. */
function createLocationIndex(chart: Chart): ChartLocationIndex {
  diagnostics.indexBuilds += 1;
  diagnostics.eventScans += 1;
  const lines = chart.judgeLineList ?? [];
  const lineById = new Map<ChartObjectId, number>();
  const lineNotes: LineNoteIndex[] = [];
  const noteById = new Map<ChartObjectId, NoteIndexEntry>();
  const eventById = new Map<ChartObjectId, EventIndexEntry>();
  for (const [lineIndex, value] of lines.entries()) {
    if (!isRecord(value)) {
      lineNotes.push({ lineId: undefined, notes: [] });
      continue;
    }
    const line = value as unknown as JudgeLine;
    const lineId = line.id;
    if (indexableId(lineId) && !lineById.has(lineId)) {
      lineById.set(lineId, lineIndex);
    }
    const notes = Array.isArray(line.notes) ? line.notes : [];
    lineNotes.push({ lineId, notes });
    for (const [noteIndex, note] of notes.entries()) {
      const noteId = note?.id;
      if (indexableId(noteId) && !noteById.has(noteId)) {
        noteById.set(noteId, { lineIndex, noteIndex });
      }
    }
    for (const { layer, layerIndex } of eventLayersOf(line)) {
      for (const track of EVENT_TRACKS) {
        const events = (layer as MutableEventLayer)[track];
        if (!Array.isArray(events)) {
          continue;
        }
        for (const [eventIndex, event] of events.entries()) {
          const eventId = isRecord(event) ? event.id : undefined;
          if (indexableId(eventId) && !eventById.has(eventId)) {
            eventById.set(eventId, { lineIndex, layerIndex, track, eventIndex });
          }
        }
      }
    }
  }
  for (const root of ALL_ROOT_EVENT_KEYS) {
    const events = rootEventList(chart, root);
    if (!events) {
      continue;
    }
    for (const [eventIndex, event] of events.entries()) {
      const eventId = isRecord(event) ? event.id : undefined;
      if (indexableId(eventId) && !eventById.has(eventId)) {
        eventById.set(eventId, { lineIndex: -1, layerIndex: null, track: null, root, eventIndex });
      }
    }
  }
  return {
    lineList: chart.judgeLineList,
    lineCount: lines.length,
    complete: true,
    lineById,
    lineNotes,
    noteById,
    eventById,
    noteShifts: new Set(),
  };
}

/** Collects ids of every line, note, and event reachable from the chart. */
export function collectChartObjectIds(chart: Chart): Set<ChartObjectId> {
  const ids = new Set<ChartObjectId>();
  const add = (value: unknown): void => {
    if (isChartObjectId(value)) {
      ids.add(value);
    }
  };
  for (const line of chart.judgeLineList ?? []) {
    add(line.id);
    for (const note of line.notes ?? []) {
      add(note.id);
    }
    for (const layer of lineEventLayers(line)) {
      if (!layer) {
        continue;
      }
      for (const type of EVENT_TRACKS) {
        for (const event of (layer as MutableEventLayer)[type] ?? []) {
          add(event.id);
        }
      }
    }
  }
  for (const key of ROOT_EVENT_KEYS) {
    const events = chart[key];
    if (Array.isArray(events)) {
      for (const event of events) {
        if (isRecord(event)) {
          add(event.id);
        }
      }
    }
  }
  const metadataEffects = chart.META.effects;
  if (Array.isArray(metadataEffects)) {
    for (const event of metadataEffects) {
      if (isRecord(event)) {
        add(event.id);
      }
    }
  }
  return ids;
}

/** True while the cached index still describes the chart's line array shape. */
function indexIsCurrent(index: ChartLocationIndex, chart: Chart): boolean {
  return (
    index.lineList === chart.judgeLineList && index.lineCount === (chart.judgeLineList?.length ?? 0)
  );
}

/** Returns the chart's cached index, rebuilding it after a structural replacement. */
function chartLocations(chart: Chart): ChartLocationIndex {
  const cached = locationIndexes.get(chart);
  if (cached && indexIsCurrent(cached, chart)) {
    return cached;
  }
  const index = createLocationIndex(chart);
  locationIndexes.set(chart, index);
  return index;
}

/** Replaces the cached index with a fresh build and returns it. */
function rebuildLocations(chart: Chart): ChartLocationIndex {
  const index = createLocationIndex(chart);
  locationIndexes.set(chart, index);
  return index;
}

/** Rebuilds a chart's cached index once after a structural change. */
export function rebuildChartLocations(chart: Chart): void {
  rebuildLocations(chart);
}

/** Re-attaches a carried index to a chart whose line array it describes. */
function installLocations(chart: Chart, index: ChartLocationIndex, complete: boolean): void {
  const lineList = chart.judgeLineList;
  locationIndexes.set(chart, {
    ...index,
    lineList,
    lineCount: lineList?.length ?? 0,
    complete,
  });
}

/**
 * Moves a current index from a source chart to the planned copy that inherits it.
 *
 * The plan starts from the source chart's own containers, so the index describes
 * the planned chart until the transaction replaces a line. Leaving it on the
 * source would keep an index for a chart that becomes a history snapshot.
 */
export function inheritChartLocations(source: Chart, target: Chart): void {
  const index = locationIndexes.get(source);
  if (!index || !indexIsCurrent(index, source) || source === target) {
    return;
  }
  locationIndexes.delete(source);
  installLocations(target, index, index.complete);
}

/** Detaches a current index so a commit can install it on the live document. */
export function detachChartLocations(chart: Chart): ChartLocationSnapshot | null {
  const index = locationIndexes.get(chart);
  if (!index || !indexIsCurrent(index, chart)) {
    return null;
  }
  locationIndexes.delete(chart);
  return index;
}

/** Installs an index detached from a plan on the chart the session now treats as live. */
export function adoptChartLocations(chart: Chart, snapshot: ChartLocationSnapshot | null): void {
  if (!snapshot) {
    return;
  }
  const index = snapshot as ChartLocationIndex;
  // A paged document keeps a facade line array that the plan copied; installing
  // the index there still addresses the same line objects, but a later page-in
  // can add ids the index has not seen, so misses must scan again.
  installLocations(chart, index, index.complete && index.lineList === chart.judgeLineList);
}

/** Records a line appended to the chart's line list so a carried index addresses it. */
export function registerLineInIndex(chart: Chart, lineIndex: number): void {
  const index = locationIndexes.get(chart);
  const lineList = chart.judgeLineList;
  if (!index || !lineList || index.lineList !== lineList) {
    return;
  }
  const line = lineList[lineIndex];
  if (!line) {
    return;
  }
  index.lineCount = lineList.length;
  index.lineNotes[lineIndex] = {
    lineId: line.id,
    notes: (line.notes ?? []) as JudgeLineNote[],
  };
  if (indexableId(line.id) && !index.lineById.has(line.id)) {
    index.lineById.set(line.id, lineIndex);
  }
}

/**
 * Updates a carried index after one line's note array was spliced in place.
 *
 * Removed ids leave the index, the line's note reference is refreshed, and the
 * line is flagged so later lookups resolve the shifted positions through the
 * container id view instead of a whole-chart rebuild.
 */
export function noteLineSpliced(
  chart: Chart,
  lineIndex: number,
  removedIndices: readonly number[],
  removedIds: readonly ChartObjectId[],
): void {
  const lineList = chart.judgeLineList;
  const line = lineList?.[lineIndex];
  if (!line) {
    return;
  }
  const notes = (line.notes ?? []) as JudgeLineNote[];
  refreshObjectIdView(notes, removedIndices);
  const index = locationIndexes.get(chart);
  if (!index || !lineList || index.lineList !== lineList) {
    return;
  }
  const lookup = index.lineNotes[lineIndex];
  if (lookup && lookup.lineId === line.id) {
    lookup.notes = notes;
  }
  for (const id of removedIds) {
    index.noteById.delete(id);
  }
  index.noteShifts.add(lineIndex);
}

/**
 * Updates a carried index and cache after one event track array was spliced in place.
 *
 * Event positions resolve lazily at lookup time, so only the removed ids and the
 * container id view need refreshing here.
 */
export function eventTrackSpliced(
  chart: Chart,
  events: readonly unknown[],
  removedIndices: readonly number[],
  removedIds: readonly ChartObjectId[],
): void {
  refreshObjectIdView(events, removedIndices);
  const index = locationIndexes.get(chart);
  if (!index) {
    return;
  }
  for (const id of removedIds) {
    index.eventById.delete(id);
  }
}

/** Scans the chart's containers directly when no full index has been built. */
function scanNote(chart: Chart, id: ChartObjectId): NoteLocation | null {
  const key = objectIdKey(id);
  const lines = chart.judgeLineList ?? [];
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    const notes = (line.notes ?? []) as JudgeLineNote[];
    const noteIndex = containerIndexOf(notes, id, key);
    if (noteIndex < 0) {
      continue;
    }
    const note = notes[noteIndex];
    if (note) {
      return { line, lineIndex, note, noteIndex, notes };
    }
  }
  return null;
}

/** Scans one layer's tracks for an event id. */
function scanEventLayer(
  chart: Chart,
  locatedLine: LocatedLine,
  layer: LineEventLayer,
  layerIndex: number,
  id: ChartObjectId,
  key: number,
): LocatedEvent | null {
  for (const track of EVENT_TRACKS) {
    const events = (layer as MutableEventLayer)[track];
    if (!Array.isArray(events)) {
      continue;
    }
    const eventIndex = containerIndexOf(events, id, key);
    if (eventIndex < 0) {
      continue;
    }
    return locatedEvent(
      chart,
      events[eventIndex] as Record<string, unknown>,
      locatedLine,
      events as Record<string, unknown>[],
      track,
      layerIndex,
      eventIndex,
    );
  }
  return null;
}

/** Scans event owners directly for a single lookup without constructing a full index. */
function scanEvent(chart: Chart, id: ChartObjectId): LocatedEvent | null {
  const key = objectIdKey(id);
  const lines = chart.judgeLineList ?? [];
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const value = lines[lineIndex];
    if (!isRecord(value)) {
      continue;
    }
    const line = value as unknown as JudgeLine;
    const locatedLine: LocatedLine = { line, index: lineIndex };
    for (const { layer, layerIndex } of eventLayersOf(line)) {
      const located = scanEventLayer(chart, locatedLine, layer, layerIndex, id, key);
      if (located) {
        return located;
      }
    }
  }
  for (const root of ALL_ROOT_EVENT_KEYS) {
    const events = rootEventList(chart, root);
    if (!events) {
      continue;
    }
    const eventIndex = containerIndexOf(events, id, key);
    if (eventIndex >= 0) {
      const event = events[eventIndex];
      return locatedEvent(chart, event, lineForEvent(chart, event), events, null, null, eventIndex);
    }
  }
  return null;
}

/** Builds and caches the chart's note/line index for a batch of id lookups. */
export function ensureChartLocations(chart: Chart): void {
  chartLocations(chart);
}

/**
 * Finds a note's current line/array position.
 *
 * A cached index answers in constant time; a line whose note array was spliced
 * resolves its shifted positions through that line's id view. Without a cached
 * index the chart's containers are scanned through their id views, which reads
 * one cheap key per note instead of one indexed position per note.
 */
export function locateNote(chart: Chart, id: ChartObjectId): NoteLocation | null {
  const index = locationIndexes.get(chart);
  if (!index) {
    return scanNote(chart, id);
  }
  if (!indexIsCurrent(index, chart)) {
    return lookupNote(rebuildLocations(chart), chart, id);
  }
  if (!index.noteById.has(id)) {
    return index.complete ? null : scanNote(chart, id);
  }
  const located = lookupNote(index, chart, id);
  if (located) {
    return located;
  }
  return index.complete ? lookupNote(rebuildLocations(chart), chart, id) : scanNote(chart, id);
}

/** Looks up one note without rebuilding; null means missing or stale. */
function lookupNote(
  index: ChartLocationIndex,
  chart: Chart,
  id: ChartObjectId,
): NoteLocation | null {
  const entry = index.noteById.get(id);
  if (!entry) {
    return null;
  }
  const { lineIndex } = entry;
  const line = chart.judgeLineList?.[lineIndex];
  const lookup = index.lineNotes[lineIndex];
  if (!line || !lookup || lookup.lineId !== line.id) {
    return null;
  }
  const notes = (line.notes ?? []) as JudgeLineNote[];
  if (notes !== lookup.notes) {
    return null;
  }
  const noteIndex = index.noteShifts.has(lineIndex)
    ? containerIndexOf(notes, id, objectIdKey(id))
    : entry.noteIndex;
  if (noteIndex < 0) {
    return null;
  }
  const note = notes[noteIndex];
  if (!note || note.id !== id) {
    return null;
  }
  return { line, lineIndex, note, noteIndex, notes };
}

/**
 * Finds a judge line by id.
 *
 * A known id with a stale position rebuilds once; an unknown id returns null
 * without rebuilding a complete index, and scans a carried partial index.
 */
export function locateLine(chart: Chart, id: ChartObjectId): LocatedLine | null {
  const lookup = (index: ChartLocationIndex): LocatedLine | null => {
    const lineIndex = index.lineById.get(id);
    if (lineIndex === undefined) {
      return null;
    }
    const line = chart.judgeLineList?.[lineIndex];
    return line?.id === id ? { line, index: lineIndex } : null;
  };
  const scan = (): LocatedLine | null => {
    const lineIndex = (chart.judgeLineList ?? []).findIndex((line) => line.id === id);
    const line = chart.judgeLineList?.[lineIndex];
    return line ? { line, index: lineIndex } : null;
  };
  const index = locationIndexes.get(chart);
  if (!index) {
    return scan();
  }
  if (!indexIsCurrent(index, chart)) {
    return lookup(rebuildLocations(chart));
  }
  if (!index.lineById.has(id)) {
    return index.complete ? null : scan();
  }
  return lookup(index) ?? (index.complete ? lookup(rebuildLocations(chart)) : scan());
}

/**
 * Updates the cached index after the transaction clones a note array.
 *
 * The array keeps the same order, so its indexed positions stay valid and its id
 * view can be carried to the copy.
 */
export function setLineNotesRef(chart: Chart, lineIndex: number, notes: JudgeLineNote[]): void {
  const index = locationIndexes.get(chart);
  if (!index || !indexIsCurrent(index, chart)) {
    return;
  }
  const line = chart.judgeLineList?.[lineIndex];
  const lookup = index.lineNotes[lineIndex];
  if (!line || !lookup || lookup.lineId !== line.id) {
    return;
  }
  if (lookup.notes !== notes) {
    inheritObjectIdView(lookup.notes, notes);
  }
  lookup.notes = notes;
}

/** Records a newly inserted note in the cached index when one already exists. */
export function registerNoteInIndex(
  chart: Chart,
  lineIndex: number,
  id: ChartObjectId,
  noteIndex: number,
): void {
  const index = locationIndexes.get(chart);
  if (!index || !indexIsCurrent(index, chart)) {
    return;
  }
  const line = chart.judgeLineList?.[lineIndex];
  const lookup = index.lineNotes[lineIndex];
  if (!line || !lookup || lookup.lineId !== line.id || lookup.notes !== line.notes) {
    return;
  }
  if (!index.noteById.has(id)) {
    index.noteById.set(id, { lineIndex, noteIndex });
  }
}

/** Records a newly inserted line event in the cached index when one already exists. */
export function registerEventInIndex(
  chart: Chart,
  lineIndex: number,
  layerIndex: number,
  track: string,
  id: ChartObjectId,
  eventIndex: number,
): void {
  const index = locationIndexes.get(chart);
  if (!index || !indexIsCurrent(index, chart)) {
    return;
  }
  if (!index.eventById.has(id)) {
    index.eventById.set(id, { lineIndex, layerIndex, track, eventIndex });
  }
}

/** Drops a chart's cached location index after a commit, undo, or replacement. */
export function invalidateChartLocations(chart: Chart): void {
  locationIndexes.delete(chart);
}

/** Finds a note by id and exposes a remover bound to its owning array. */
export function findNote(chart: Chart, id: ChartObjectId): LocatedNote | null {
  const located = locateNote(chart, id);
  if (!located) {
    return null;
  }
  const { note, line, lineIndex, noteIndex } = located;
  return {
    note,
    line: { line, index: lineIndex },
    remove: () => {
      const notes = line.notes;
      if (!notes) {
        return;
      }
      const index = notes[noteIndex] === note ? noteIndex : notes.indexOf(note);
      if (index >= 0) {
        notes.splice(index, 1);
      }
      invalidateChartLocations(chart);
    },
  };
}

/** Resolves a root event's optional line index to its line. */
function lineForEvent(chart: Chart, event: Record<string, unknown>): LocatedLine | null {
  const value = event.line;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    return null;
  }
  const line = chart.judgeLineList?.[value];
  return line ? { line, index: value } : null;
}

/** Enumerates a line's normal layers and its extended layer with their indices. */
function eventLayersOf(line: JudgeLine): { layer: LineEventLayer; layerIndex: number }[] {
  const layers: { layer: LineEventLayer; layerIndex: number }[] = [];
  const normal = Array.isArray(line.eventLayers) ? line.eventLayers : [];
  for (const [index, layer] of normal.entries()) {
    if (isRecord(layer)) {
      layers.push({ layer: layer as LineEventLayer, layerIndex: index });
    }
  }
  if (isRecord(line.extended)) {
    layers.push({ layer: line.extended as LineEventLayer, layerIndex: -1 });
  }
  return layers;
}

/** Builds the public located-event record for one owning array. */
function locatedEvent(
  chart: Chart,
  event: Record<string, unknown>,
  line: LocatedLine | null,
  events: Record<string, unknown>[],
  track: string | null,
  layerIndex: number | null,
  eventIndex: number,
): LocatedEvent {
  return {
    event,
    line,
    eventIndex,
    events,
    track,
    layerIndex,
    remove: () => events.splice(eventIndex, 1),
  };
}

/** Resolves the layer one indexed event belongs to, or null when it vanished. */
function eventLayerAt(line: JudgeLine, layerIndex: number): LineEventLayer | null {
  if (layerIndex === -1) {
    return isRecord(line.extended) ? (line.extended as LineEventLayer) : null;
  }
  const normal = Array.isArray(line.eventLayers) ? line.eventLayers : [];
  const layer = normal[layerIndex];
  return isRecord(layer) ? (layer as LineEventLayer) : null;
}

/** Looks up one indexed line or root event; null means missing or stale. */
function lookupEvent(
  index: ChartLocationIndex,
  chart: Chart,
  id: ChartObjectId,
): LocatedEvent | null {
  const entry = index.eventById.get(id);
  if (!entry) {
    return null;
  }
  if (entry.root) {
    const events = rootEventList(chart, entry.root);
    if (!events) {
      return null;
    }
    const eventIndex = eventIndexFor(events, id, entry.eventIndex);
    const event = eventIndex < 0 ? undefined : events[eventIndex];
    if (!event) {
      return null;
    }
    if (eventIndex !== entry.eventIndex) {
      index.eventById.set(id, { ...entry, eventIndex });
    }
    return locatedEvent(chart, event, lineForEvent(chart, event), events, null, null, eventIndex);
  }
  const line = chart.judgeLineList?.[entry.lineIndex];
  if (!line || entry.track === null || entry.layerIndex === null) {
    return null;
  }
  const layer = eventLayerAt(line, entry.layerIndex);
  if (!layer) {
    return null;
  }
  const events = (layer as MutableEventLayer)[entry.track];
  if (!Array.isArray(events)) {
    return null;
  }
  const eventIndex = eventIndexFor(events, id, entry.eventIndex);
  const event = eventIndex < 0 ? undefined : events[eventIndex];
  if (!event) {
    return null;
  }
  if (eventIndex !== entry.eventIndex) {
    index.eventById.set(id, { ...entry, eventIndex });
  }
  return locatedEvent(
    chart,
    event,
    { line, index: entry.lineIndex },
    events as unknown as Record<string, unknown>[],
    entry.track,
    entry.layerIndex,
    eventIndex,
  );
}

/** Finds an event id at its expected slot or through the owning array's id view. */
function eventIndexFor(events: readonly unknown[], id: ChartObjectId, expected: number): number {
  const candidate = events[expected];
  if (isRecord(candidate) && candidate.id === id) {
    return expected;
  }
  return containerIndexOf(events, id, objectIdKey(id));
}

/**
 * Finds an event by id across line layers and root event lists.
 *
 * This is the single event locator shared by the transaction kernel and the
 * AI editing policy. A cached index answers a known id in constant time relative
 * to chart size; without one the chart is scanned container by container, and a
 * carried partial index falls back to that scan for its paged-in lines.
 */
export function findEvent(chart: EventChart, id: ChartObjectId): LocatedEvent | null {
  diagnostics.eventLookups += 1;
  const target = chart as Chart;
  const cached = locationIndexes.get(target);
  if (!cached) {
    return scanEvent(target, id);
  }
  const index = indexIsCurrent(cached, target) ? cached : rebuildLocations(target);
  const located = lookupEvent(index, target, id);
  if (located) {
    return located;
  }
  if (index.complete && !index.eventById.has(id)) {
    return null;
  }
  return index.complete ? lookupEvent(rebuildLocations(target), target, id) : scanEvent(target, id);
}
