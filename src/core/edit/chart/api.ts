/**
 * Owns the mounted editor's detached chart read model.
 *
 * This module exposes chart data without exposing the live session. It keeps
 * the public query seam beside the editor runtime and leaves the plugin facade
 * in `core/api` as a thin adapter.
 */
import {
  lineParentIndex,
  type BpmEntry,
  type Chart,
  type ChartMeta,
  type JudgeLine,
  type JudgeLineEvent,
  type JudgeLineNote,
} from "../../global/chart/chart.ts";
import type { ChartObjectId } from "../../global/chart/identity.ts";
import { createLateBound } from "../../utils/lateBound.ts";
import { chartFingerprint } from "../document/chartRevision.ts";
import type { ChartContentRange } from "../../global/chart/chartRange.ts";
import { chartRange } from "./chartRangeRead.ts";
import { readLineGroups } from "./lineGroupsRead.ts";

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
export type ChartReadTiming = ReadonlyChart<BpmEntry>;
export type ChartReadLine = ReadonlyChart<JudgeLine>;
/** Detached folder metadata used to select judge lines without a full snapshot. */
export interface ChartReadLineGroup {
  readonly index: number;
  readonly name: string;
  readonly lineIndices: readonly number[];
}
export type ChartReadNote = ReadonlyChart<JudgeLineNote>;
export type ChartReadEvent = ReadonlyChart<JudgeLineEvent>;

export type ChartReadCollection = "metadata" | "timing" | "lines" | "notes" | "events";

export type ChartReadItem<Collection extends ChartReadCollection> = Collection extends "metadata"
  ? ChartReadMeta
  : Collection extends "timing"
    ? ChartReadTiming
    : Collection extends "lines"
      ? ChartReadLine
      : Collection extends "notes"
        ? ChartNoteReadRef
        : ChartEventReadRef;

export interface ChartReadState {
  readonly chartFingerprint: string | null;
  readonly generation: number;
}

export type ChartReadRange = ChartContentRange;

export interface ChartReadPageOptions {
  readonly chartFingerprint?: string | null;
  readonly cursor?: string | null;
  /** Zero-based first item of the page. Ignored when `cursor` is supplied. */
  readonly offset?: number;
  /** Requested page size, clamped to the host maximum. Defaults to 50. */
  readonly limit?: number;
}

/** Stable reasons a paged read rejected its request. */
export type ChartReadPageIssue =
  "invalid_cursor" | "invalid_limit" | "invalid_offset" | "conflicting_paging";

export type ChartReadPage<T> =
  | {
      readonly status: "ok";
      readonly chartFingerprint: string | null;
      readonly generation: number;
      readonly items: readonly T[];
      /** Zero-based item offset of the first returned item. */
      readonly offset: number;
      /** Page size the host applied after clamping. */
      readonly limit: number;
      /** Collection length at this revision, independent of the page. */
      readonly total: number;
      readonly hasMore: boolean;
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
      readonly reason: ChartReadPageIssue;
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

/** Options for reading a whole collection in one call. */
export interface ChartReadAllOptions {
  readonly chartFingerprint?: string | null;
  /** Page size fetched internally; defaults to the host maximum. */
  readonly limit?: number;
}

/** The complete collection at one revision, or the reason it could not be read. */
export type ChartReadAllResult<T> =
  | {
      readonly status: "ok";
      readonly chartFingerprint: string | null;
      readonly generation: number;
      readonly items: readonly T[];
      readonly total: number;
    }
  | {
      readonly status: "stale_read";
      readonly requestedFingerprint: string | null;
      readonly currentFingerprint: string | null;
    }
  | {
      readonly status: "invalid_request";
      readonly reason: ChartReadPageIssue;
    };

export interface ChartApiHost {
  chart(): Chart | null;
  revision?: () => Partial<ChartReadState>;
}

export interface ChartApi {
  readonly version: number;
  state(): ChartReadState;
  range(): ChartReadRange;
  read<Collection extends ChartReadCollection>(
    collection: Collection,
    options?: ChartReadPageOptions,
  ): ChartReadPage<ChartReadItem<Collection>>;
  snapshot(): ChartReadSnapshot | null;
  metadata(): ChartReadMeta | null;
  resources(): readonly ChartResourceReference[];
  lines(): readonly ChartReadLine[];
  lineGroups(): readonly ChartReadLineGroup[];
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

// A plain session replaces the chart object at every committed edit, but a
// paged document keeps one facade and mutates its slots in place. The whole
// chart snapshot is therefore reused only while both the chart identity and its
// content fingerprint are current.
const detachedSnapshots = new WeakMap<
  Chart,
  { readonly fingerprint: string | null; readonly snapshot: ChartReadSnapshot }
>();
const detachedLineSnapshots = new WeakMap<object, ChartReadLine>();
const detachedMetaSnapshots = new WeakMap<object, ChartReadMeta>();
const detachedTimingSnapshots = new WeakMap<object, ChartReadTiming>();
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

/** Return one detached tempo entry without copying the rest of the map. */
function detachedTiming(entry: BpmEntry): ChartReadTiming {
  return detachedValue(entry, detachedTimingSnapshots);
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
function detachedChart(chart: Chart | null, fingerprint: string | null): ChartReadSnapshot | null {
  if (!chart) {
    return null;
  }
  const cached = detachedSnapshots.get(chart);
  if (cached && cached.fingerprint === fingerprint) {
    return cached.snapshot;
  }
  // A structured clone preserves the detached-read contract without first
  // building a second whole-chart JSON string. The old serialize/parse path
  // could exceed the browser string limit on million-event charts.
  const snapshot = freezeDeep(structuredClone(chart));
  detachedSnapshots.set(chart, { fingerprint, snapshot });
  return snapshot;
}

interface ChartReadCursor {
  readonly collection: ChartReadCollection;
  readonly chartFingerprint: string | null;
  readonly generation: number;
  readonly offset: number;
  /** Page size captured when the cursor was issued, so continuation keeps it. */
  readonly limit?: number;
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

/** Returns the requested page size, or null when it is not a positive integer. */
function pageSize(value: number | undefined): number | null {
  if (value === undefined) {
    return DEFAULT_PAGE_SIZE;
  }
  return Number.isSafeInteger(value) && value > 0 ? Math.min(value, MAX_PAGE_SIZE) : null;
}

/** Returns the requested start offset, or null when it is not a non-negative integer. */
function pageOffset(value: number | undefined): number | null {
  if (value === undefined) {
    return 0;
  }
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
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
      !["metadata", "timing", "lines", "notes", "events"].includes(cursor.collection ?? "") ||
      (cursor.chartFingerprint !== null && typeof cursor.chartFingerprint !== "string") ||
      !Number.isSafeInteger(cursor.generation) ||
      !Number.isSafeInteger(cursor.offset) ||
      (cursor.offset ?? -1) < 0 ||
      (cursor.limit !== undefined &&
        (!Number.isSafeInteger(cursor.limit) || cursor.limit < 1 || cursor.limit > MAX_PAGE_SIZE))
    ) {
      return null;
    }
    return cursor as ChartReadCursor;
  } catch {
    return null;
  }
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

/** Read one page directly from the live chart without assembling all items. */
function readPageFromSource(
  source: Chart | null,
  collection: ChartReadCollection,
  offset: number,
  size: number,
): readonly unknown[] {
  if (!source) {
    return Object.freeze([]);
  }
  if (collection === "metadata") {
    return offset === 0 ? Object.freeze([detachedMeta(source.META)]) : Object.freeze([]);
  }
  if (collection === "timing") {
    const page = (source.BPMList ?? []).slice(offset, offset + size).map(detachedTiming);
    return Object.freeze(page);
  }
  if (collection === "lines") {
    const page = (source.judgeLineList ?? []).slice(offset, offset + size).map(detachedLine);
    return Object.freeze(page);
  }

  const items: SourceItem[] = [];
  let seen = 0;
  visitSourceItems(source, collection, (_id, create) => {
    if (seen < offset) {
      seen += 1;
      return false;
    }
    if (items.length >= size) {
      return true;
    }
    seen += 1;
    items.push(create());
    return false;
  });
  return Object.freeze(items);
}

interface CollectionCount {
  readonly fingerprint: string | null;
  readonly total: number;
}

const collectionCounts = new WeakMap<Chart, Partial<Record<"notes" | "events", CollectionCount>>>();

/** Count one item collection without cloning or freezing its payloads. */
function countSourceItems(source: Chart, collection: "notes" | "events"): number {
  let total = 0;
  visitSourceItems(source, collection, () => {
    total += 1;
    return false;
  });
  return total;
}

/** Collection length for one revision, cached per chart identity and fingerprint. */
function collectionTotal(
  source: Chart | null,
  collection: ChartReadCollection,
  fingerprint: string | null,
): number {
  if (!source) {
    return 0;
  }
  if (collection === "metadata") {
    return 1;
  }
  if (collection === "timing") {
    return source.BPMList?.length ?? 0;
  }
  if (collection === "lines") {
    return source.judgeLineList?.length ?? 0;
  }
  const cached = collectionCounts.get(source)?.[collection];
  if (cached && cached.fingerprint === fingerprint) {
    return cached.total;
  }
  const count = Object.freeze({
    fingerprint,
    total: countSourceItems(source, collection),
  });
  const entry = collectionCounts.get(source) ?? {};
  entry[collection] = count;
  collectionCounts.set(source, entry);
  return count.total;
}

/**
 * Read every item of one collection by draining pages internally.
 *
 * The caller receives one array and never handles a cursor or page offset.
 * Pages are fetched through the supplied `read`, so the sandbox can collect
 * them across the bridge without sending one oversized result.
 */
export function readAllChartItems<Collection extends ChartReadCollection>(
  read: (
    collection: Collection,
    options?: ChartReadPageOptions,
  ) => ChartReadPage<ChartReadItem<Collection>>,
  collection: Collection,
  options: ChartReadAllOptions = {},
): ChartReadAllResult<ChartReadItem<Collection>> {
  const items: ChartReadItem<Collection>[] = [];
  const limit = options.limit ?? MAX_PAGE_SIZE;
  let cursor: string | null = null;
  for (;;) {
    const page = read(collection, {
      ...(cursor ? { cursor } : { offset: 0 }),
      limit,
      ...(options.chartFingerprint === undefined
        ? {}
        : { chartFingerprint: options.chartFingerprint }),
    });
    if (page.status === "invalid_request") {
      return page;
    }
    if (page.status === "stale_read") {
      return {
        status: "stale_read",
        requestedFingerprint: page.requestedFingerprint,
        currentFingerprint: page.currentFingerprint,
      };
    }
    items.push(...page.items);
    if (!page.nextCursor) {
      return {
        status: "ok",
        chartFingerprint: page.chartFingerprint,
        generation: page.generation,
        items: Object.freeze(items),
        total: page.total,
      };
    }
    cursor = page.nextCursor;
  }
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

  const current = (): ChartReadSnapshot | null => {
    const captured = capture();
    return detachedChart(captured.source, captured.revision.chartFingerprint);
  };
  const read = <Collection extends ChartReadCollection>(
    collection: Collection,
    options: ChartReadPageOptions = {},
  ): ChartReadPage<ChartReadItem<Collection>> => {
    const cursor = options.cursor ? decodeCursor(options.cursor) : null;
    if (options.cursor && !cursor) {
      return { status: "invalid_request", reason: "invalid_cursor" };
    }
    if (cursor && options.offset !== undefined) {
      return { status: "invalid_request", reason: "conflicting_paging" };
    }
    const offset = cursor?.offset ?? pageOffset(options.offset);
    if (offset === null) {
      return { status: "invalid_request", reason: "invalid_offset" };
    }
    const size = pageSize(options.limit ?? cursor?.limit);
    if (size === null) {
      return { status: "invalid_request", reason: "invalid_limit" };
    }

    const captureResult = capture();
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

    const total = collectionTotal(
      captureResult.source,
      collection,
      captureResult.revision.chartFingerprint,
    );
    const items = readPageFromSource(
      captureResult.source,
      collection,
      offset,
      size,
    ) as readonly ChartReadItem<Collection>[];
    const nextOffset = offset + items.length;
    const hasMore = nextOffset < total;
    const nextCursor = hasMore
      ? encodeCursor({
          collection,
          chartFingerprint: captureResult.revision.chartFingerprint,
          generation: captureResult.revision.generation,
          offset: nextOffset,
          limit: size,
        })
      : null;
    return {
      status: "ok",
      chartFingerprint: captureResult.revision.chartFingerprint,
      generation: captureResult.revision.generation,
      items: Object.freeze([...items]),
      offset,
      limit: size,
      total,
      hasMore,
      nextCursor,
    } as ChartReadPage<ChartReadItem<Collection>>;
  };

  return {
    version: 1,
    state(): ChartReadState {
      return capture().revision;
    },
    range(): ChartReadRange {
      return chartRange(capture().source);
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
    lineGroups(): readonly ChartReadLineGroup[] {
      return readLineGroups(capture().source);
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
      return readPageFromSource(
        source,
        "notes",
        0,
        Number.MAX_SAFE_INTEGER,
      ) as readonly ChartNoteReadRef[];
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
      return readPageFromSource(
        source,
        "events",
        0,
        Number.MAX_SAFE_INTEGER,
      ) as readonly ChartEventReadRef[];
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
