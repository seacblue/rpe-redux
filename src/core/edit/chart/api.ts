/**
 * Owns the mounted editor's detached chart read model.
 *
 * This module exposes chart data without exposing the live session. It keeps
 * the public query seam beside the editor runtime and leaves the plugin facade
 * in `core/api` as a thin adapter.
 */
import {
  lineParentIndex,
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
const detachedLineSnapshots = new WeakMap<object, ChartReadLine>();
const detachedMetaSnapshots = new WeakMap<object, ChartReadMeta>();
const detachedNoteSnapshots = new WeakMap<object, ChartReadNote>();
const detachedEventSnapshots = new WeakMap<object, ChartReadEvent>();

/** Clone and freeze one chart value while reusing the current source identity. */
function detachedValue<T extends object, R>(value: T, cache: WeakMap<object, R>): R {
  const cached = cache.get(value);
  if (cached) {
    return cached;
  }
  const snapshot = freezeDeep(structuredClone(value)) as R;
  cache.set(value, snapshot);
  return snapshot;
}

/** Return one detached line without copying unrelated lines or chart headers. */
function detachedLine(line: JudgeLine): ChartReadLine {
  return detachedValue(line, detachedLineSnapshots);
}

/** Return one detached metadata block without copying chart content. */
function detachedMeta(meta: ChartMeta): ChartReadMeta {
  return detachedValue(meta, detachedMetaSnapshots);
}

/** Return one detached note without copying its owning line. */
function detachedNote(note: JudgeLineNote): ChartReadNote {
  return detachedValue(note, detachedNoteSnapshots);
}

/** Return one detached event without copying its owning line. */
function detachedEvent(event: JudgeLineEvent): ChartReadEvent {
  return detachedValue(event, detachedEventSnapshots);
}

/** Returns a frozen, detached copy of the chart for read-only consumers. */
function detachedChart(chart: Chart | null): ChartReadSnapshot | null {
  if (!chart) {
    return null;
  }
  const cached = detachedSnapshots.get(chart);
  if (cached) {
    return cached;
  }
  // A structured clone preserves the detached-read contract without first
  // building a second whole-chart JSON string. The old serialize/parse path
  // could exceed the browser string limit on million-event charts.
  const snapshot = freezeDeep(structuredClone(chart));
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
  readonly source: Chart | null;
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

type SourceItem = ChartNoteReadRef | ChartEventReadRef;
type SourceItemFactory = () => SourceItem;

/** Visit source items lazily so skipped pages never clone their payloads. */
function visitSourceItems(
  source: Chart | null,
  collection: "notes" | "events",
  visit: (id: ChartObjectId, create: SourceItemFactory) => boolean,
): void {
  for (const [lineIndex, line] of (source?.judgeLineList ?? []).entries()) {
    if (!line.id) {
      continue;
    }
    const lineId = line.id;
    if (collection === "notes") {
      for (const [index, note] of (line.notes ?? []).entries()) {
        if (!note?.id) {
          continue;
        }
        const id = note.id;
        if (
          visit(id, () =>
            Object.freeze({
              id,
              lineId,
              lineIndex,
              index,
              note: detachedNote(note),
            }),
          )
        ) {
          return;
        }
      }
      continue;
    }
    const layers: [NonNullable<JudgeLine["extended"]> | null, number | "extended"][] = (
      line.eventLayers ?? []
    ).map((layer, layerIndex) => [layer, layerIndex]);
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
          const id = event.id as ChartObjectId;
          if (
            visit(id, () =>
              Object.freeze({
                id,
                lineId,
                lineIndex,
                eventType,
                layer: layerIndex,
                index,
                event: detachedEvent(event as JudgeLineEvent),
              }),
            )
          ) {
            return;
          }
        }
      }
    }
  }
}

/** Resolve a line's parent, or the owning line for a note/event. */
function parentId(source: Chart | null, id: ChartObjectId): ChartObjectId | null {
  const lines = source?.judgeLineList ?? [];
  const line = lines.find((candidate) => candidate.id === id);
  if (line) {
    const parent = lineParentIndex(line.father);
    return Number.isInteger(parent) && parent >= 0 ? (lines[parent]?.id ?? null) : null;
  }
  let owner: ChartObjectId | null = null;
  visitSourceItems(source, "notes", (itemId, create) => {
    if (itemId === id) {
      owner = (create() as ChartNoteReadRef).lineId;
      return true;
    }
    return false;
  });
  if (owner) {
    return owner;
  }
  visitSourceItems(source, "events", (itemId, create) => {
    if (itemId === id) {
      owner = (create() as ChartEventReadRef).lineId;
      return true;
    }
    return false;
  });
  return owner;
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

interface ReadPageSlice {
  readonly items: readonly unknown[];
  readonly hasMore: boolean;
}

/** Read one page directly from the live chart without assembling all items. */
function readPageFromSource(
  source: Chart | null,
  collection: ChartReadCollection,
  offset: number,
  size: number,
): ReadPageSlice {
  if (!source) {
    return { items: [], hasMore: false };
  }
  if (collection === "metadata") {
    return offset === 0
      ? { items: [detachedMeta(source.META)], hasMore: false }
      : { items: [], hasMore: false };
  }
  if (collection === "lines") {
    const lines = source.judgeLineList ?? [];
    const page = lines.slice(offset, offset + size).map(detachedLine);
    return { items: page, hasMore: offset + page.length < lines.length };
  }

  const items: SourceItem[] = [];
  let seen = 0;
  let hasMore = false;
  visitSourceItems(source, collection, (_id, create) => {
    if (seen < offset) {
      seen += 1;
      return false;
    }
    if (items.length >= size) {
      hasMore = true;
      return true;
    }
    seen += 1;
    items.push(create());
    return false;
  });
  return { items: Object.freeze(items), hasMore };
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
    const suppliedRevision = host.revision?.();
    return {
      source,
      revision: Object.freeze({
        chartFingerprint: suppliedRevision?.chartFingerprint ?? computedFingerprint,
        generation: suppliedRevision?.generation ?? localGeneration,
      }),
    };
  };

  const current = (): ChartReadSnapshot | null => detachedChart(capture().source);
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

    const offset = cursor?.offset ?? 0;
    const size = pageSize(options.limit);
    const page = readPageFromSource(captureResult.source, collection, offset, size);
    const items = page.items as readonly ChartReadItem<Collection>[];
    const nextOffset = offset + items.length;
    const nextCursor = page.hasMore
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
      const source = capture().source;
      return source ? detachedMeta(source.META) : null;
    },
    resources(): readonly ChartResourceReference[] {
      const source = capture().source;
      return source ? resourceReferences(source) : Object.freeze([]);
    },
    lines(): readonly ChartReadLine[] {
      return Object.freeze((capture().source?.judgeLineList ?? []).map(detachedLine));
    },
    line(id: ChartObjectId): ChartReadLine | null {
      const line = capture().source?.judgeLineList?.find((candidate) => candidate.id === id);
      return line ? detachedLine(line) : null;
    },
    parentId(id: ChartObjectId): ChartObjectId | null {
      return parentId(capture().source, id);
    },
    notes(): readonly ChartNoteReadRef[] {
      const source = capture().source;
      if (!source) {
        return Object.freeze([]);
      }
      const page = readPageFromSource(source, "notes", 0, Number.MAX_SAFE_INTEGER);
      return page.items as readonly ChartNoteReadRef[];
    },
    note(id: ChartObjectId): ChartNoteReadRef | null {
      const source = capture().source;
      let result: ChartNoteReadRef | null = null;
      visitSourceItems(source, "notes", (noteId, create) => {
        if (noteId !== id) {
          return false;
        }
        result = create() as ChartNoteReadRef;
        return true;
      });
      return result;
    },
    events(): readonly ChartEventReadRef[] {
      const source = capture().source;
      if (!source) {
        return Object.freeze([]);
      }
      const page = readPageFromSource(source, "events", 0, Number.MAX_SAFE_INTEGER);
      return page.items as readonly ChartEventReadRef[];
    },
    event(id: ChartObjectId): ChartEventReadRef | null {
      const source = capture().source;
      let result: ChartEventReadRef | null = null;
      visitSourceItems(source, "events", (eventId, create) => {
        if (eventId !== id) {
          return false;
        }
        result = create() as ChartEventReadRef;
        return true;
      });
      return result;
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
