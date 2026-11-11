/**
 * Owns the mounted editor's detached chart read model.
 *
 * This module exposes chart data without exposing the live session. It keeps
 * the public query seam beside the editor runtime and leaves the plugin facade
 * in `core/api` as a thin adapter.
 */
import {
  lineParentIndex,
  parseChart,
  serializeChart,
  type Chart,
  type ChartMeta,
  type JudgeLine,
  type JudgeLineEvent,
  type JudgeLineNote,
} from "../../global/chart/chart.ts";
import type { ChartObjectId } from "../../global/chart/identity.ts";
import { createLateBound } from "../../utils/lateBound.ts";
import { chartFingerprint } from "../document/chartRevision.ts";

export type ReadonlyChart<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends string | number | boolean | bigint | symbol | null | undefined
    ? T
    : T extends readonly (infer Item)[]
      ? readonly ReadonlyChart<Item>[]
      : T extends object
        ? { readonly [Key in keyof T]: ReadonlyChart<T[Key]> }
        : T;

export type ChartReadSnapshot = ReadonlyChart<Chart>;
export type ChartReadMeta = ReadonlyChart<ChartMeta>;
export type ChartReadLine = ReadonlyChart<JudgeLine>;
export type ChartReadNote = ReadonlyChart<JudgeLineNote>;
export type ChartReadEvent = ReadonlyChart<JudgeLineEvent>;

export type ChartReadCollection = "metadata" | "lines" | "notes" | "events";

export type ChartReadItem<Collection extends ChartReadCollection> = Collection extends "metadata"
  ? ChartReadMeta
  : Collection extends "lines"
    ? ChartReadLine
    : Collection extends "notes"
      ? ChartNoteReadRef
      : ChartEventReadRef;

export interface ChartReadState {
  readonly chartFingerprint: string | null;
  readonly generation: number;
}

export interface ChartReadPageOptions {
  readonly chartFingerprint?: string | null;
  readonly cursor?: string | null;
  readonly limit?: number;
}

export type ChartReadPage<T> =
  | {
      readonly status: "ok";
      readonly chartFingerprint: string | null;
      readonly generation: number;
      readonly items: readonly T[];
      readonly nextCursor: string | null;
    }
  | {
      readonly status: "stale_read";
      readonly requestedFingerprint: string | null;
      readonly currentFingerprint: string | null;
      readonly requestedGeneration: number | null;
      readonly currentGeneration: number;
    }
  | {
      readonly status: "invalid_request";
      readonly reason: "invalid_cursor";
    };

export interface ChartNoteReadRef {
  readonly id: ChartObjectId;
  readonly lineId: ChartObjectId;
  readonly lineIndex: number;
  readonly index: number;
  readonly note: ChartReadNote;
}

export interface ChartEventReadRef {
  readonly id: ChartObjectId;
  readonly lineId: ChartObjectId;
  readonly lineIndex: number;
  readonly eventType: string;
  readonly layer: number | "extended";
  readonly index: number;
  readonly event: ChartReadEvent;
}

export interface ChartResourceReference {
  readonly kind: "song" | "background" | "lineTexture" | "attachUI";
  readonly name: string;
}

export interface ChartApiHost {
  chart(): Chart | null;
  revision?: () => Partial<ChartReadState>;
}

export interface ChartApi {
  readonly version: number;
  state(): ChartReadState;
  read<Collection extends ChartReadCollection>(
    collection: Collection,
    options?: ChartReadPageOptions,
  ): ChartReadPage<ChartReadItem<Collection>>;
  snapshot(): ChartReadSnapshot | null;
  metadata(): ChartReadMeta | null;
  resources(): readonly ChartResourceReference[];
  lines(): readonly ChartReadLine[];
  line(id: ChartObjectId): ChartReadLine | null;
  parentId(id: ChartObjectId): ChartObjectId | null;
  notes(): readonly ChartNoteReadRef[];
  note(id: ChartObjectId): ChartNoteReadRef | null;
  events(): readonly ChartEventReadRef[];
  event(id: ChartObjectId): ChartEventReadRef | null;
}

/** Recursively freezes an object graph, tolerating cycles. */
function freezeDeep<T>(value: T, seen = new WeakSet<object>()): ReadonlyChart<T> {
  if (!value || typeof value !== "object") {
    return value as ReadonlyChart<T>;
  }
  const object = value as object;
  if (seen.has(object)) {
    return value as ReadonlyChart<T>;
  }
  seen.add(object);
  for (const child of Object.values(object)) {
    freezeDeep(child, seen);
  }
  return Object.freeze(value) as ReadonlyChart<T>;
}

// EditorSession replaces the chart object at every committed edit, so the
// detached read model is reused while that identity is current.
const detachedSnapshots = new WeakMap<Chart, ChartReadSnapshot>();

/** Returns a frozen, detached copy of the chart for read-only consumers. */
function detachedChart(chart: Chart | null): ChartReadSnapshot | null {
  if (!chart) {
    return null;
  }
  const cached = detachedSnapshots.get(chart);
  if (cached) {
    return cached;
  }
  const snapshot = freezeDeep(parseChart(serializeChart(chart)));
  detachedSnapshots.set(chart, snapshot);
  return snapshot;
}

interface ChartReadCursor {
  readonly collection: ChartReadCollection;
  readonly chartFingerprint: string | null;
  readonly generation: number;
  readonly offset: number;
}

interface ChartCapture {
  readonly snapshot: ChartReadSnapshot | null;
  readonly revision: ChartReadState;
}

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;

/** Encodes a read cursor as an opaque, URL-safe string. */
function encodeCursor(cursor: ChartReadCursor): string {
  return `chart-read-v1.${encodeURIComponent(JSON.stringify(cursor))}`;
}

/** Decodes a read cursor; null means malformed or unsupported input. */
function decodeCursor(value: string): ChartReadCursor | null {
  if (!value.startsWith("chart-read-v1.")) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(decodeURIComponent(value.slice("chart-read-v1.".length)));
    if (!parsed || typeof parsed !== "object") {
      return null;
    }
    const cursor = parsed as Partial<ChartReadCursor>;
    if (
      !["metadata", "lines", "notes", "events"].includes(cursor.collection ?? "") ||
      (cursor.chartFingerprint !== null && typeof cursor.chartFingerprint !== "string") ||
      !Number.isSafeInteger(cursor.generation) ||
      !Number.isSafeInteger(cursor.offset) ||
      (cursor.offset ?? -1) < 0
    ) {
      return null;
    }
    return cursor as ChartReadCursor;
  } catch {
    return null;
  }
}

/** Clamps a requested page size to the supported range. */
function pageSize(value: number | undefined): number {
  return Number.isSafeInteger(value) && value !== undefined && value > 0
    ? Math.min(value, MAX_PAGE_SIZE)
    : DEFAULT_PAGE_SIZE;
}

/** Collects every id-bearing event across layers and extended tracks. */
function eventRefs(snapshot: ChartReadSnapshot): readonly ChartEventReadRef[] {
  const refs: ChartEventReadRef[] = [];
  for (const [lineIndex, line] of (snapshot.judgeLineList ?? []).entries()) {
    if (!line.id) {
      continue;
    }
    type ReadonlyLayer = NonNullable<typeof line.extended>;
    const layers: [ReadonlyLayer | null, number | "extended"][] = (line.eventLayers ?? []).map(
      (layer, layerIndex) => [layer, layerIndex],
    );
    if (line.extended) {
      layers.push([line.extended, "extended"]);
    }
    for (const [layer, layerIndex] of layers) {
      if (!layer) {
        continue;
      }
      for (const [eventType, events] of Object.entries(layer)) {
        if (!eventType.endsWith("Events") || !Array.isArray(events)) {
          continue;
        }
        for (const [index, event] of events.entries()) {
          if (!event || typeof event !== "object" || !event.id) {
            continue;
          }
          refs.push(
            Object.freeze({
              id: event.id,
              lineId: line.id,
              lineIndex,
              eventType,
              layer: layerIndex,
              index,
              event,
            }),
          );
        }
      }
    }
  }
  return Object.freeze(refs);
}

/** Collects every id-bearing note with its owning line. */
function noteRefs(snapshot: ChartReadSnapshot): readonly ChartNoteReadRef[] {
  const refs: ChartNoteReadRef[] = [];
  for (const [lineIndex, line] of (snapshot.judgeLineList ?? []).entries()) {
    if (!line.id) {
      continue;
    }
    for (const [index, note] of (line.notes ?? []).entries()) {
      if (!note?.id) {
        continue;
      }
      refs.push(
        Object.freeze({
          id: note.id,
          lineId: line.id,
          lineIndex,
          index,
          note,
        }),
      );
    }
  }
  return Object.freeze(refs);
}

/** Resolve a line's parent, or the owning line for a note/event. */
function parentId(snapshot: ChartReadSnapshot, id: ChartObjectId): ChartObjectId | null {
  const lines = snapshot.judgeLineList ?? [];
  const line = lines.find((candidate) => candidate.id === id);
  if (line) {
    const parent = lineParentIndex(line.father);
    return Number.isInteger(parent) && parent >= 0 ? (lines[parent]?.id ?? null) : null;
  }
  return (
    noteRefs(snapshot).find((candidate) => candidate.id === id)?.lineId ??
    eventRefs(snapshot).find((candidate) => candidate.id === id)?.lineId ??
    null
  );
}

/** Return chart-declared resource names without exposing the mutable asset map. */
function resourceReferences(snapshot: ChartReadSnapshot): readonly ChartResourceReference[] {
  const references: ChartResourceReference[] = [];
  const add = (kind: ChartResourceReference["kind"], name: unknown): void => {
    if (
      typeof name === "string" &&
      name &&
      !references.some((entry) => entry.kind === kind && entry.name === name)
    ) {
      references.push(Object.freeze({ kind, name }));
    }
  };
  add("song", snapshot.META.song);
  add("background", snapshot.META.background);
  for (const line of snapshot.judgeLineList ?? []) {
    add("lineTexture", line.Texture);
    add("attachUI", line.attachUI);
  }
  return Object.freeze(references);
}

/** Returns the paged items for one readable chart collection. */
function collectionItems(
  snapshot: ChartReadSnapshot | null,
  collection: ChartReadCollection,
): readonly (ChartReadMeta | ChartReadLine | ChartNoteReadRef | ChartEventReadRef)[] {
  if (!snapshot) {
    return [];
  }
  if (collection === "metadata") {
    return [snapshot.META];
  }
  if (collection === "lines") {
    return snapshot.judgeLineList ?? [];
  }
  return collection === "notes" ? noteRefs(snapshot) : eventRefs(snapshot);
}

/** Builds the detached chart read model over one host. */
export function createChartApi(host: ChartApiHost): ChartApi {
  let previousChart: Chart | null | undefined;
  let previousFingerprint: string | null | undefined;
  let localGeneration = 0;

  const capture = (): ChartCapture => {
    const source = host.chart();
    const computedFingerprint = chartFingerprint(source);
    if (source !== previousChart || computedFingerprint !== previousFingerprint) {
      localGeneration += 1;
      previousChart = source;
      previousFingerprint = computedFingerprint;
    }
    const snapshot = detachedChart(source);
    const suppliedRevision = host.revision?.();
    return {
      snapshot,
      revision: Object.freeze({
        chartFingerprint: suppliedRevision?.chartFingerprint ?? computedFingerprint,
        generation: suppliedRevision?.generation ?? localGeneration,
      }),
    };
  };

  const current = (): ChartReadSnapshot | null => capture().snapshot;
  const read = <Collection extends ChartReadCollection>(
    collection: Collection,
    options: ChartReadPageOptions = {},
  ): ChartReadPage<ChartReadItem<Collection>> => {
    const captureResult = capture();
    const cursor = options.cursor ? decodeCursor(options.cursor) : null;
    if (options.cursor && !cursor) {
      return { status: "invalid_request", reason: "invalid_cursor" };
    }

    const requestedFingerprint = cursor?.chartFingerprint ?? options.chartFingerprint ?? null;
    const requestedGeneration = cursor?.generation ?? null;
    if (
      cursor &&
      (cursor.collection !== collection ||
        cursor.chartFingerprint !== captureResult.revision.chartFingerprint ||
        cursor.generation !== captureResult.revision.generation)
    ) {
      return {
        status: "stale_read",
        requestedFingerprint,
        currentFingerprint: captureResult.revision.chartFingerprint,
        requestedGeneration,
        currentGeneration: captureResult.revision.generation,
      };
    }
    if (
      options.chartFingerprint !== undefined &&
      options.chartFingerprint !== captureResult.revision.chartFingerprint
    ) {
      return {
        status: "stale_read",
        requestedFingerprint: options.chartFingerprint,
        currentFingerprint: captureResult.revision.chartFingerprint,
        requestedGeneration,
        currentGeneration: captureResult.revision.generation,
      };
    }

    const snapshot = captureResult.snapshot;
    const allItems = collectionItems(snapshot, collection) as readonly ChartReadItem<Collection>[];
    const offset = cursor?.offset ?? 0;
    const size = pageSize(options.limit);
    const items = allItems.slice(offset, offset + size);
    const nextOffset = offset + items.length;
    const nextCursor =
      nextOffset < allItems.length
        ? encodeCursor({
            collection,
            chartFingerprint: captureResult.revision.chartFingerprint,
            generation: captureResult.revision.generation,
            offset: nextOffset,
          })
        : null;
    return {
      status: "ok",
      chartFingerprint: captureResult.revision.chartFingerprint,
      generation: captureResult.revision.generation,
      items: Object.freeze([...items]),
      nextCursor,
    } as ChartReadPage<ChartReadItem<Collection>>;
  };

  return {
    version: 1,
    state(): ChartReadState {
      return capture().revision;
    },
    read,
    snapshot: current,
    metadata(): ChartReadMeta | null {
      return current()?.META ?? null;
    },
    resources(): readonly ChartResourceReference[] {
      const snapshot = current();
      return snapshot ? resourceReferences(snapshot) : Object.freeze([]);
    },
    lines(): readonly ChartReadLine[] {
      return Object.freeze([...(current()?.judgeLineList ?? [])]);
    },
    line(id: ChartObjectId): ChartReadLine | null {
      return current()?.judgeLineList?.find((line) => line.id === id) ?? null;
    },
    parentId(id: ChartObjectId): ChartObjectId | null {
      const snapshot = current();
      return snapshot ? parentId(snapshot, id) : null;
    },
    notes(): readonly ChartNoteReadRef[] {
      const snapshot = current();
      return snapshot ? noteRefs(snapshot) : Object.freeze([]);
    },
    note(id: ChartObjectId): ChartNoteReadRef | null {
      return this.notes().find((note) => note.id === id) ?? null;
    },
    events(): readonly ChartEventReadRef[] {
      const snapshot = current();
      return snapshot ? eventRefs(snapshot) : Object.freeze([]);
    },
    event(id: ChartObjectId): ChartEventReadRef | null {
      return this.events().find((event) => event.id === id) ?? null;
    },
  };
}

const chartApiBinding = createLateBound<ChartApi>();

/** Binds a chart host; returns an idempotent disposer. */
export function connectChartApi(host: ChartApiHost): () => void {
  return chartApiBinding.bind(createChartApi(host));
}

/** The mounted chart facade, or null while no editor is bound. */
export function getChartApi(): ChartApi | null {
  return chartApiBinding.value();
}
