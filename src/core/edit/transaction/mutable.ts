/**
 * Copy-on-write helpers for one transaction's working chart.
 *
 * A transaction shallow-copies a judge line on first touch, then copies only
 * the note array, event layer, or event track it actually mutates. The source
 * chart therefore keeps every object identity it had before the request.
 */
import {
  EVENT_TYPES,
  isEventTrack,
  markChartObjectCollectionNormalized,
  type Chart,
  type JudgeLine,
  type JudgeLineEvent,
  type JudgeLineNote,
  type MutableEventLayer,
} from "../../global/chart/chart.ts";
import type { ChartObjectId } from "../../global/chart/identity.ts";
import type { TransactionIssue } from "./contract.ts";
import { setLineNotesRef, type LocatedEvent, type LocatedLine } from "./locations.ts";
import {
  inheritLineContentFingerprint,
  inheritValueContentFingerprint,
  markValueContentFingerprintDirty,
} from "../../global/chart/chartContentHash.ts";

/** Mutable state shared by the transaction apply kernel and its helpers. */
export interface MutableTransactionState {
  readonly chart: Chart;
  readonly issues: TransactionIssue[];
  readonly affected: ChartObjectId[];
  readonly usedIds: Set<ChartObjectId>;
  readonly relationTouched: Set<ChartObjectId>;
  readonly clonedLines: Set<number>;
  /** Deduplicates `affected` without scanning it on every add. */
  affectedSet?: Set<ChartObjectId>;
  /** False defers the full id scan until the first insert needs it. */
  usedIdsReady?: boolean;
  /** Line indices whose note arrays were copied for this transaction. */
  clonedNoteLines?: Set<number>;
  /** Line indices whose event-layer arrays were copied. */
  clonedEventLayerArrays?: Set<number>;
  /** `lineIndex:layerIndex` keys whose layer objects were copied. */
  clonedEventLayerObjects?: Set<string>;
  /** Line indices whose extended layer object was copied. */
  clonedExtendedLayers?: Set<number>;
  /** `lineIndex:layerIndex:track` keys whose event arrays were copied. */
  eventTracks?: Map<string, Record<string, unknown>[]>;
  /** Newly inserted or patched notes that require structural validation. */
  changedNotes?: Set<{ note: JudgeLineNote; lineIndex: number; noteIndex: number }>;
  /** Newly inserted or patched events that require structural validation. */
  changedEvents?: Set<{
    event: JudgeLineEvent;
    lineIndex: number;
    layerIndex: number;
    track: string;
    eventIndex: number;
  }>;
  /** New lines need the complete line validator; existing lines use fields only. */
  fullLineValidation?: Set<number>;
  /** Conservative retained-byte estimate collected while containers are copied. */
  retainedBytes?: number;
}

/** Add a conservative history-retention estimate without traversing shared data. */
function addRetainedBytes(state: MutableTransactionState, bytes: number): void {
  state.retainedBytes = (state.retainedBytes ?? 64) + Math.max(0, bytes);
}

/** Build one immutable transaction issue with optional path/object context. */
export function issue(
  code: string,
  path?: string,
  objectId?: ChartObjectId,
  message?: string,
): TransactionIssue {
  return Object.freeze({
    code,
    ...(path ? { path } : {}),
    ...(objectId ? { objectId } : {}),
    ...(message ? { message } : {}),
  });
}

/** Returns the line's shallow working copy; nested arrays are copied on demand. */
export function mutableLine(state: MutableTransactionState, located: LocatedLine): JudgeLine {
  if (!state.clonedLines.has(located.index)) {
    const clone: JudgeLine = { ...located.line };
    state.chart.judgeLineList![located.index] = clone;
    state.clonedLines.add(located.index);
    inheritLineContentFingerprint(located.line, clone);
    addRetainedBytes(state, 128);
    return clone;
  }
  return state.chart.judgeLineList?.[located.index] ?? located.line;
}

/** Returns the line's private notes array, copying it on first note mutation. */
export function mutableNotes(
  state: MutableTransactionState,
  line: JudgeLine,
  lineIndex: number,
): JudgeLineNote[] {
  const cloned = (state.clonedNoteLines ??= new Set<number>());
  if (!cloned.has(lineIndex)) {
    const source = line.notes;
    line.notes = [...(source ?? [])];
    if (source) {
      inheritValueContentFingerprint(source, line.notes);
    }
    addRetainedBytes(state, (source?.length ?? 0) * 8 + 128);
    cloned.add(lineIndex);
    setLineNotesRef(state.chart, lineIndex, line.notes);
    markChartObjectCollectionNormalized(line.notes);
    markValueContentFingerprintDirty(line.notes);
  }
  line.notes ??= [];
  return line.notes;
}

/** Replaces one note with a shallow copy so the source chart keeps its object. */
export function mutableNote(notes: JudgeLineNote[], index: number): JudgeLineNote {
  const clone: JudgeLineNote = { ...notes[index] };
  notes[index] = clone;
  return clone;
}

/** Returns the line's private event-layer array, copying it on first event mutation. */
function mutableEventLayerArray(
  state: MutableTransactionState,
  line: JudgeLine,
  lineIndex: number,
): (MutableEventLayer | null)[] {
  const cloned = (state.clonedEventLayerArrays ??= new Set<number>());
  if (!cloned.has(lineIndex)) {
    const source = line.eventLayers;
    line.eventLayers = [...(source ?? [])];
    if (source) {
      inheritValueContentFingerprint(source, line.eventLayers);
    }
    // Replacing a layer object changes this array even though its length does
    // not, so the inherited seed must reconcile before it is reused.
    markValueContentFingerprintDirty(line.eventLayers);
    addRetainedBytes(state, (source?.length ?? 0) * 8 + 128);
    cloned.add(lineIndex);
  }
  return line.eventLayers as (MutableEventLayer | null)[];
}

/** Returns one private normal event layer, copying it on first mutation. */
function mutableEventLayer(
  state: MutableTransactionState,
  line: JudgeLine,
  lineIndex: number,
  layerIndex: number,
): MutableEventLayer {
  const layers = mutableEventLayerArray(state, line, lineIndex);
  while (layers.length <= layerIndex) {
    layers.push({});
  }
  const key = `${lineIndex}:${layerIndex}`;
  const cloned = (state.clonedEventLayerObjects ??= new Set<string>());
  if (!cloned.has(key)) {
    const source = layers[layerIndex];
    layers[layerIndex] = { ...(source ?? {}) };
    if (source) {
      inheritValueContentFingerprint(source, layers[layerIndex] as object);
    }
    addRetainedBytes(state, 128);
    cloned.add(key);
  }
  return layers[layerIndex] as MutableEventLayer;
}

/** Returns the private extended layer, copying it on first mutation. */
function mutableExtendedLayer(
  state: MutableTransactionState,
  line: JudgeLine,
  lineIndex: number,
): MutableEventLayer {
  const cloned = (state.clonedExtendedLayers ??= new Set<number>());
  if (!cloned.has(lineIndex)) {
    const source = line.extended;
    line.extended = { ...(source ?? {}) };
    if (source) {
      inheritValueContentFingerprint(source, line.extended);
    }
    addRetainedBytes(state, 128);
    cloned.add(lineIndex);
  }
  return line.extended as MutableEventLayer;
}

/** Returns one private event track array, copying it on first mutation. */
export function mutableEventTrack(
  state: MutableTransactionState,
  line: JudgeLine,
  lineIndex: number,
  layerIndex: number,
  eventType: string,
): Record<string, unknown>[] {
  const layer =
    layerIndex === -1
      ? mutableExtendedLayer(state, line, lineIndex)
      : mutableEventLayer(state, line, lineIndex, layerIndex);
  const key = `${lineIndex}:${layerIndex}:${eventType}`;
  const tracks = (state.eventTracks ??= new Map<string, Record<string, unknown>[]>());
  let events = tracks.get(key);
  if (!events) {
    const source = (layer[eventType] as JudgeLineEvent[] | undefined) ?? [];
    events = [...source] as unknown as Record<string, unknown>[];
    inheritValueContentFingerprint(source, events);
    (layer as Record<string, unknown>)[eventType] = events;
    tracks.set(key, events);
    markChartObjectCollectionNormalized(events);
    markValueContentFingerprintDirty(events);
    addRetainedBytes(state, source.length * 8 + 128);
  }
  return events;
}

/** Ensures a mutable event list exists for a track and layer. */
export function ensureEventList(
  line: JudgeLine,
  lineIndex: number,
  eventType: string,
  layer: number | "extended" | undefined,
  path: string,
  state: MutableTransactionState,
): JudgeLineEvent[] | null {
  if (!isEventTrack(eventType)) {
    state.issues.push(issue("event.type.unsupported", `${path}.eventType`));
    return null;
  }
  const isBaseTrack = EVENT_TYPES.includes(eventType as (typeof EVENT_TYPES)[number]);
  if (isBaseTrack) {
    if (layer !== undefined && (!Number.isInteger(layer) || (layer as number) < 0)) {
      state.issues.push(issue("event.layer.invalid", `${path}.layer`));
      return null;
    }
    const layerIndex = typeof layer === "number" ? layer : 0;
    return mutableEventTrack(
      state,
      line,
      lineIndex,
      layerIndex,
      eventType,
    ) as unknown as JudgeLineEvent[];
  }
  if (layer !== undefined && layer !== "extended") {
    state.issues.push(issue("event.layer.extendedRequired", `${path}.layer`));
    return null;
  }
  return mutableEventTrack(state, line, lineIndex, -1, eventType) as unknown as JudgeLineEvent[];
}

/** Returns the private event list for a located event, copying line containers on demand. */
export function mutableEventListFor(
  state: MutableTransactionState,
  located: LocatedEvent,
): Record<string, unknown>[] {
  if (!located.line || located.layerIndex === null || !located.track) {
    return located.events;
  }
  const line = mutableLine(state, located.line);
  return mutableEventTrack(state, line, located.line.index, located.layerIndex, located.track);
}
