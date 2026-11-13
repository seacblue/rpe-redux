/* eslint-disable max-lines -- the document owns paging, revisions, and serialization. */
/**
 * A paged chart document: header plus line summaries, with raw line text loaded
 * on demand. The document owns the chart facade used by the editor and keeps a
 * bounded working set; eager charts simply load every line up front.
 */
import { createChartIdentityFactory, isChartObjectId, type ChartObjectId } from "../identity.ts";
import { EVENT_TYPES, EXTENDED_TYPES } from "../chartVocabulary.ts";
import { lineParentIndex, type BpmEntry, type Chart, type JudgeLine } from "../chart.ts";
import { TempoMap } from "../timing/tempo.ts";
import { isRecord } from "../../../utils/guards.ts";
import {
  combineContentFingerprint,
  headerContentFingerprint,
  lineContentFingerprint,
  primeLineContentFingerprint,
} from "../chartContentHash.ts";
import { summarizeChartLine, summarizeChartLineIncremental } from "./chartLineSummary.ts";
import { stringifyChartValue } from "./chartSerialize.ts";
import { registerChartDocument } from "./chartDocumentRegistry.ts";
import type { ChartLineRevisionSeed } from "../chartRevisionSeed.ts";
import type { ChartValueDigestGroup } from "../chartContentHash.ts";
import {
  LINE_FLAG_IDS,
  LINE_FLAG_INVALID,
  type ChartHeader,
  type ChartIndex,
  type ChartLineProvider,
  type ChartLineSummary,
} from "./chartStreamTypes.ts";

/** Marker attached to a not-yet-loaded line in a paged chart facade. */
const LINE_PLACEHOLDER = Symbol("chart-line-placeholder");
let nextPendingFingerprintId = 1;

/** True when a line is a paged facade placeholder rather than chart content. */
export function isPlaceholderLine(line: unknown): boolean {
  return Boolean(line && typeof line === "object" && LINE_PLACEHOLDER in line);
}

/** One line's load state and optional materialized object. */
interface LineSlot {
  summary: ChartLineSummary;
  state: "missing" | "loading" | "loaded" | "dirty" | "invalid";
  line?: JudgeLine;
  raw?: string;
  loading?: Promise<JudgeLine>;
  lastUsed: number;
}

/** Options for constructing a paged or eager chart document. */
export interface ChartDocumentOptions {
  readonly header: ChartHeader;
  readonly index?: ChartIndex | null;
  readonly provider: ChartLineProvider;
  /** Lines already materialized; eager construction passes every line. */
  readonly initialLines?: readonly JudgeLine[];
  /** Maximum materialized lines retained; 0 disables eviction. */
  readonly maxCachedLines?: number;
  /** Maximum raw line text bytes retained; 0 disables byte eviction. */
  readonly maxCachedBytes?: number;
}

/** Thrown when a time window needs more lines than the caller allowed. */
export class ChartPagingLimitError extends Error {
  readonly name = "ChartPagingLimitError";
  readonly required: number;
  readonly limit: number;

  /** Build the error with the candidate count and caller limit. */
  constructor(required: number, limit: number) {
    super(`Paged chart needs ${required} lines, limit is ${limit}`);
    this.required = required;
    this.limit = limit;
  }
}

/** The placeholder line shown for a line whose source text is not loaded. */
function placeholderLine(summary: ChartLineSummary): JudgeLine {
  const line = {
    ...(summary.id ? { id: summary.id as ChartObjectId } : {}),
    Name: `Line ${summary.index}`,
    Group: summary.group,
    father: summary.father,
    zOrder: 0,
    notes: [],
    eventLayers: [],
    extended: {},
    numOfNotes: summary.noteCount,
  } as JudgeLine;
  Object.defineProperty(line, LINE_PLACEHOLDER, { value: true });
  return line;
}

/** Empty summary used when a source has no index yet. */
function emptySummary(index: number): ChartLineSummary {
  return {
    index,
    byteOffset: 0,
    byteLength: 0,
    noteCount: 0,
    eventCount: 0,
    startSeconds: null,
    endSeconds: null,
    digest: "",
    flags: 0,
    group: 0,
    father: -1,
  };
}

/** Read the chart header fields without the document-only `lineCount`. */
function headerValues(header: ChartHeader): Record<string, unknown> {
  return {
    ...header.extras,
    META: header.META,
    BPMList: header.BPMList,
    ...(header.judgeLineGroup ? { judgeLineGroup: header.judgeLineGroup } : {}),
    ...(header.blockAreaList ? { blockAreaList: header.blockAreaList } : {}),
    ...(header.effects ? { effects: header.effects } : {}),
    ...(header.shaderEvents ? { shaderEvents: header.shaderEvents } : {}),
    ...(header.markers ? { markers: header.markers } : {}),
  };
}

/** Visit a line's owned objects and apply an id assignment. */
function visitLineObjects(line: JudgeLine, visit: (value: Record<string, unknown>) => void): void {
  visit(line as unknown as Record<string, unknown>);
  for (const note of line.notes ?? []) {
    visit(note as unknown as Record<string, unknown>);
  }
  for (const layer of [...(line.eventLayers ?? []), line.extended]) {
    if (!layer) {
      continue;
    }
    for (const type of [...EVENT_TYPES, ...EXTENDED_TYPES]) {
      for (const event of layer[type] ?? []) {
        visit(event as unknown as Record<string, unknown>);
      }
    }
  }
}

/** One line replacement between two document revisions. */
export interface ChartLinePatch {
  readonly index: number;
  readonly before?: JudgeLine;
  readonly after?: JudgeLine;
}

/** A paged or eager chart document. */
export class ChartDocument {
  header: ChartHeader;
  readonly index: ChartIndex | null;
  readonly provider: ChartLineProvider;
  lineCount: number;
  readonly chart: Chart;
  /** Optional release hook for a worker or source owned by the opener. */
  dispose?: () => void;
  private readonly lines: JudgeLine[];
  private readonly slots: LineSlot[];
  private tempo: TempoMap;
  private readonly identityFactory = createChartIdentityFactory();
  private readonly usedIds = new Set<string>();
  private readonly maxCachedLines: number;
  private readonly maxCachedBytes: number;
  private cachedBytes = 0;
  private clock = 0;
  private revision = 0;
  private fingerprintCache: string | null = null;
  private readonly pendingFingerprintToken = `pending-chart-fingerprint-${nextPendingFingerprintId++}`;
  private fingerprintReadyState: boolean;
  /**
   * Line indexes whose semantic digest has not been published yet.
   *
   * Keyed by line index instead of counted so a duplicate or unusable seed can
   * consume its slot without completing hydration early or leaving it pending
   * forever.
   */
  private readonly pendingFingerprintSlots = new Set<number>();
  private fingerprintReadyPromise: Promise<void>;
  private resolveFingerprintReady!: () => void;
  private materialized: Chart | null = null;
  private materializing = false;
  private tempoDirty = false;

  /** Build a document over a header, index, and line provider. */
  constructor(options: ChartDocumentOptions) {
    this.header = options.header;
    this.index = options.index ?? null;
    this.provider = options.provider;
    this.maxCachedLines = Math.max(0, options.maxCachedLines ?? 0);
    this.maxCachedBytes = Math.max(0, options.maxCachedBytes ?? 0);
    this.lineCount = Math.max(
      options.index?.lines.length ?? 0,
      options.initialLines?.length ?? 0,
      options.provider.lineCount,
      options.header.lineCount,
    );
    this.tempo = new TempoMap(
      options.header.BPMList.length
        ? options.header.BPMList
        : ([{ bpm: 120, startTime: [0, 0, 1] }] as BpmEntry[]),
    );
    this.slots = Array.from({ length: this.lineCount }, (unused, index) => ({
      summary: options.index?.lines[index] ?? emptySummary(index),
      state: "missing",
      lastUsed: 0,
    }));
    this.lines = new Array<JudgeLine>(this.lineCount);
    for (let index = 0; index < this.lineCount; index++) {
      this.lines[index] = placeholderLine(this.slots[index].summary);
    }
    this.fingerprintReadyState = !options.index?.fingerprintsPending;
    if (!this.fingerprintReadyState) {
      for (const [index, slot] of this.slots.entries()) {
        if (!slot.summary.digest) {
          this.pendingFingerprintSlots.add(index);
        }
      }
    }
    this.fingerprintReadyPromise = this.fingerprintReadyState
      ? Promise.resolve()
      : new Promise<void>((resolve) => {
          this.resolveFingerprintReady = resolve;
        });
    if (!this.pendingFingerprintSlots.size && !this.fingerprintReadyState) {
      this.completeFingerprintHydration();
    }
    const initial = options.initialLines;
    if (initial) {
      for (let index = 0; index < Math.min(initial.length, this.lineCount); index++) {
        this.installLine(index, initial[index], "loaded");
        for (const object of this.lineObjects(initial[index])) {
          const id = object.id;
          if (isChartObjectId(id)) {
            this.usedIds.add(id);
          }
        }
      }
    }
    this.chart = this.createFacade();
  }

  /** Build the facade chart object and register its document identity. */
  private createFacade(): Chart {
    const chart = {
      ...headerValues(this.header),
      judgeLineList: this.lines,
    } as Chart;
    registerChartDocument(chart, this);
    return chart;
  }

  /** The loaded line at `index`, or undefined while it is still paged out. */
  line(index: number): JudgeLine | undefined {
    const slot = this.slots[index];
    return slot?.line;
  }

  /** Read one line's summary. */
  summary(index: number): ChartLineSummary {
    return this.slots[index]?.summary ?? emptySummary(index);
  }

  /** True once every clean line has its semantic content digest. */
  get fingerprintReady(): boolean {
    return this.fingerprintReadyState;
  }

  /** Wait for the background line digest pass to finish. */
  whenFingerprintReady(): Promise<void> {
    return this.fingerprintReadyPromise;
  }

  /**
   * Install one background-computed line digest without materializing siblings.
   *
   * The producer emits at most one seed per line, so an out-of-range or
   * unusable seed still consumes its pending slot: a later seed cannot repair
   * it, and leaving the slot pending would keep `whenFingerprintReady` unsettled
   * forever.
   */
  applyFingerprintSeed(index: number, seed: ChartLineRevisionSeed): void {
    const slot = this.slots[index];
    if (!slot) {
      return;
    }
    this.pendingFingerprintSlots.delete(index);
    if (seed.digest && !slot.summary.digest) {
      const summary = { ...slot.summary, digest: seed.digest, childDigests: seed.childDigests };
      slot.summary = summary;
      const indexedLines = this.index?.lines as ChartLineSummary[] | undefined;
      if (indexedLines) {
        indexedLines[index] = summary;
      }
      if (slot.line && slot.state !== "dirty") {
        primeLineContentFingerprint(slot.line, seed.digest, seed.childDigests);
      }
      this.fingerprintCache = null;
    }
    if (!this.pendingFingerprintSlots.size) {
      this.completeFingerprintHydration();
    }
  }

  /** Mark the background digest stream complete after all seeds arrived. */
  completeFingerprintHydration(): void {
    if (this.fingerprintReadyState || this.pendingFingerprintSlots.size > 0) {
      return;
    }
    this.fingerprintReadyState = true;
    this.resolveFingerprintReady?.();
  }

  /** True when the line is materialized and not a placeholder. */
  isLoaded(index: number): boolean {
    return Boolean(this.slots[index]?.line);
  }

  /** Every loaded line index, in source order. */
  loadedIndices(): number[] {
    const indices: number[] = [];
    for (let index = 0; index < this.slots.length; index++) {
      if (this.slots[index].line) {
        indices.push(index);
      }
    }
    return indices;
  }

  /** Ensure one line is materialized and return it. */
  async ensureLine(index: number, signal?: AbortSignal): Promise<JudgeLine> {
    const slot = this.slots[index];
    if (!slot) {
      throw new RangeError(`Line index out of range: ${index}`);
    }
    if (slot.line) {
      slot.lastUsed = ++this.clock;
      return slot.line;
    }
    if (slot.loading) {
      return slot.loading;
    }
    const work = this.loadLine(index, slot, signal);
    slot.loading = work;
    try {
      return await work;
    } finally {
      slot.loading = undefined;
    }
  }

  /** Ensure a bounded set of lines, using a small worker pool. */
  async ensureLines(indices: readonly number[], signal?: AbortSignal): Promise<void> {
    const queue = [...new Set(indices)].filter((index) => !this.slots[index]?.line);
    let cursor = 0;
    const workers = Array.from({ length: Math.min(8, queue.length) }, async () => {
      while (cursor < queue.length) {
        const index = queue[cursor++];
        if (index !== undefined) {
          await this.ensureLine(index, signal);
        }
      }
    });
    await Promise.all(workers);
  }

  /**
   * Ensure every line that can affect `seconds`.
   *
   * Lines with no finite end or no alpha events are conservatively included.
   * A caller can cap the candidate count and fall back to eager materialization.
   */
  async ensureTime(
    seconds: number,
    windowSeconds = 2,
    options: { maxLines?: number; signal?: AbortSignal } = {},
  ): Promise<number[]> {
    const windowStart = seconds - Math.max(0, windowSeconds);
    const windowEnd = seconds + Math.max(0, windowSeconds);
    const candidates: number[] = [];
    // A tempo edit invalidates every unloaded summary. Load the whole chart
    // once so later windows use the new time map instead of stale intervals.
    if (this.tempoDirty) {
      for (const slot of this.slots) {
        candidates.push(slot.summary.index);
      }
    } else {
      for (const slot of this.slots) {
        const summary = slot.summary;
        const intervals = summary.intervals;
        const intersects =
          intervals && intervals.length
            ? intervals.some(
                ([intervalStart, intervalEnd]) =>
                  intervalEnd >= windowStart && intervalStart <= windowEnd,
              )
            : summary.startSeconds === null ||
              summary.endSeconds === null ||
              (summary.endSeconds >= windowStart && summary.startSeconds <= windowEnd);
        if (intersects) {
          candidates.push(summary.index);
        }
      }
    }
    const limit = this.tempoDirty
      ? Number.POSITIVE_INFINITY
      : (options.maxLines ?? Number.POSITIVE_INFINITY);
    const pending = candidates.filter((index) => !this.slots[index]?.line);
    if (pending.length > limit) {
      throw new ChartPagingLimitError(pending.length, limit);
    }
    await this.ensureLines(pending, options.signal);
    if (this.tempoDirty) {
      this.tempoDirty = false;
    }
    return candidates;
  }

  /** Ensure a line and every ancestor it needs for a world transform. */
  async ensureAncestors(index: number, signal?: AbortSignal): Promise<void> {
    const seen = new Set<number>();
    let current = index;
    while (Number.isInteger(current) && current >= 0 && current < this.slots.length) {
      if (seen.has(current)) {
        return;
      }
      seen.add(current);
      await this.ensureLine(current, signal);
      current = this.slots[current].summary.father;
    }
  }

  /** Replace one line after an edit and mark it dirty. */
  replaceLine(index: number, line: JudgeLine): void {
    this.installLine(index, this.normalizeLine(line, true), "dirty");
    this.changed();
  }

  /**
   * Restore a line snapshot from history.
   *
   * The array may contain placeholders for lines that were not materialized;
   * their summaries are kept so a later page-in still knows where they belong.
   */
  applyLineSnapshot(lines: readonly JudgeLine[], header: ChartHeader): void {
    const tempoWasDirty = this.tempoDirty;
    this.setHeader(header);
    const recomputeAll = tempoWasDirty || this.tempoDirty;
    this.lineCount = lines.length;
    while (this.slots.length < lines.length) {
      const index = this.slots.length;
      this.slots.push({ summary: emptySummary(index), state: "missing", lastUsed: 0 });
      this.lines.push(placeholderLine(emptySummary(index)));
    }
    if (this.slots.length > lines.length) {
      for (const slot of this.slots.slice(lines.length)) {
        this.cachedBytes = Math.max(0, this.cachedBytes - (slot.raw?.length ?? 0));
      }
      this.slots.splice(lines.length);
      this.lines.splice(lines.length);
    }
    for (let index = 0; index < lines.length; index++) {
      const line = lines[index];
      const slot = this.slots[index];
      // A remote change reuses every untouched line object. Keep its summary
      // instead of re-hashing the whole chart on each accepted batch.
      if (!recomputeAll && line === this.lines[index]) {
        slot.summary = { ...slot.summary, index };
        continue;
      }
      if (isPlaceholderLine(line)) {
        this.cachedBytes = Math.max(0, this.cachedBytes - (slot.raw?.length ?? 0));
        slot.line = undefined;
        slot.state = "missing";
        slot.raw = undefined;
        slot.summary = { ...slot.summary, index };
        this.lines[index] = line;
        continue;
      }
      const normalized = this.normalizeLine(line, true);
      slot.summary =
        !recomputeAll && slot.line && !isPlaceholderLine(this.lines[index])
          ? summarizeChartLineIncremental(slot.summary, normalized, index)
          : summarizeChartLine(
              normalized,
              index,
              this.tempo,
              slot.summary.byteOffset,
              slot.summary.byteLength,
            );
      this.installLine(index, normalized, "dirty");
    }
    this.changed();
  }

  /** Replace the header and line slots from a committed chart. */
  syncFromChart(next: Chart): void {
    if (next === this.chart) {
      return;
    }
    const lines = next.judgeLineList ?? [];
    this.applyLineSnapshot(lines, chartHeader(next, lines.length));
  }

  /** Replace only the document header while keeping all line slots paged. */
  updateHeaderFromChart(next: Chart): void {
    this.setHeader(chartHeader(next, this.lineCount));
    this.changed();
  }

  /** Insert a line at `index`, shifting later summaries and slots. */
  insertLine(index: number, line: JudgeLine): void {
    const at = Math.max(0, Math.min(this.slots.length, index));
    const normalized = this.normalizeLine(line);
    const summary = summarizeChartLine(normalized, at, this.tempo);
    this.slots.splice(at, 0, { summary, state: "dirty", line: normalized, lastUsed: ++this.clock });
    this.lines.splice(at, 0, normalized);
    this.reindex(at);
    this.changed();
  }

  /** Remove one line, shifting later summaries and slots. */
  removeLine(index: number): void {
    if (index < 0 || index >= this.slots.length) {
      return;
    }
    const [removed] = this.slots.splice(index, 1);
    this.cachedBytes = Math.max(0, this.cachedBytes - (removed?.raw?.length ?? 0));
    this.lines.splice(index, 1);
    this.reindex(index);
    this.changed();
  }

  /** Indices of lines edited in this document. */
  dirtyLines(): number[] {
    const dirty: number[] = [];
    for (const slot of this.slots) {
      if (slot.state === "dirty") {
        dirty.push(slot.summary.index);
      }
    }
    return dirty;
  }

  /** Materialize every line and return a plain snapshot. */
  async materializeAll(options: { signal?: AbortSignal } = {}): Promise<Chart> {
    // The snapshot needs every line at once, so the paged working-set budget
    // must not evict lines while it is being assembled.
    this.materializing = true;
    try {
      await this.ensureLines(
        this.slots.map((slot) => slot.summary.index),
        options.signal,
      );
    } finally {
      this.materializing = false;
    }
    if (this.materialized) {
      return this.materialized;
    }
    const snapshot = {
      ...headerValues(this.header),
      judgeLineList: [...this.lines],
    } as Chart;
    registerChartDocument(snapshot, this);
    this.materialized = snapshot;
    return snapshot;
  }

  /** Canonical content fingerprint; clean lines use their index digest. */
  fingerprint(): string {
    if (this.fingerprintCache !== null) {
      return this.fingerprintCache;
    }
    if (!this.fingerprintReadyState) {
      // The token is intentionally process-local and must never be used for a
      // save/conflict decision. Hosts gate writes on `fingerprintReady` and
      // replace it with the semantic digest when the worker finishes.
      return this.pendingFingerprintToken;
    }
    const digests = this.slots.map((slot) => {
      // A clean line's index digest already describes its content and ignores
      // editor-only ids, so loading it does not require another full walk.
      if (slot.state !== "dirty" && slot.summary.digest) {
        return slot.summary.digest;
      }
      if (slot.line) {
        return lineContentFingerprint(slot.line);
      }
      return slot.summary.digest;
    });
    this.fingerprintCache = combineContentFingerprint(
      headerContentFingerprint(headerValues(this.header)),
      digests,
    );
    return this.fingerprintCache;
  }

  /** Build a transaction fingerprint by reusing clean line digests. */
  previewFingerprint(chart: Chart, changedLineIndexes: Iterable<number>): string {
    if (!this.fingerprintReadyState) {
      return this.pendingFingerprintToken;
    }
    const changed = new Set(changedLineIndexes);
    const lines = chart.judgeLineList ?? [];
    const digests = lines.map((line, index) => {
      if (changed.has(index)) {
        return lineContentFingerprint(line);
      }
      const summary = this.slots[index]?.summary;
      return summary?.digest || lineContentFingerprint(line);
    });
    return combineContentFingerprint(headerContentFingerprint(chart), digests);
  }

  /**
   * Write the chart as JSON chunks.
   *
   * Clean lines reuse their raw source text when available; dirty lines are
   * serialized from the materialized object. The output is semantically equal
   * to `serializeChart` but does not build one whole-chart string.
   */
  async serialize(sink: (chunk: string) => Promise<void> | void): Promise<void> {
    const header = headerValues(this.header);
    const keys = Object.keys(header);
    await sink("{");
    for (let index = 0; index < keys.length; index++) {
      const key = keys[index];
      await sink(`${index ? "," : ""}${JSON.stringify(key)}:${stringifyChartValue(header[key])}`);
    }
    await sink(`${keys.length ? "," : ""}"judgeLineList":[`);
    for (let index = 0; index < this.slots.length; index++) {
      if (index) {
        await sink(",");
      }
      const slot = this.slots[index];
      if (slot.state === "invalid" || (slot.summary.flags & LINE_FLAG_INVALID) !== 0) {
        throw new Error(`Invalid chart line ${index}`);
      }
      if (slot.state === "dirty" && slot.line) {
        await sink(stringifyChartValue(slot.line));
        continue;
      }
      // Clean lines are copied from the source without parsing or assigning
      // ids; the index already validated their structure when it was built.
      const source = slot.raw ?? (await this.provider.readLine(index));
      if (source === undefined) {
        throw new Error(`Missing chart line ${index}`);
      }
      await sink(typeof source === "string" ? source : source.raw);
    }
    await sink("]}");
  }

  /** Load one line from raw text or the provider. */
  private async loadLine(index: number, slot: LineSlot, signal?: AbortSignal): Promise<JudgeLine> {
    const source = slot.raw ?? (await this.provider.readLine(index, signal));
    if (source === undefined) {
      slot.state = "invalid";
      throw new Error(`Missing chart line ${index}`);
    }
    const raw = typeof source === "string" ? source : source.raw;
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      slot.state = "invalid";
      throw new Error(`Invalid chart line ${index}`);
    }
    if (!isRecord(value)) {
      slot.state = "invalid";
      throw new Error(`Invalid chart line ${index}`);
    }
    if (slot.summary.flags & LINE_FLAG_INVALID) {
      slot.state = "invalid";
      throw new Error(`Invalid chart line ${index}`);
    }
    const line =
      slot.summary.flags & LINE_FLAG_IDS
        ? (value as unknown as JudgeLine)
        : this.normalizeLine(value as unknown as JudgeLine);
    if (this.tempoDirty) {
      slot.summary = summarizeChartLine(
        line,
        index,
        this.tempo,
        slot.summary.byteOffset,
        slot.summary.byteLength,
      );
    }
    if (slot.summary.flags & LINE_FLAG_IDS) {
      for (const object of this.lineObjects(line)) {
        const id = object.id;
        if (isChartObjectId(id)) {
          this.usedIds.add(id);
        }
      }
    }
    this.installLine(
      index,
      line,
      "loaded",
      raw,
      typeof source === "string" ? undefined : source.valueDigests,
    );
    this.evict();
    return line;
  }

  /** Put a materialized line into the facade and slot. */
  private installLine(
    index: number,
    line: JudgeLine,
    state: "loaded" | "dirty",
    raw?: string,
    valueDigests?: readonly ChartValueDigestGroup[],
  ): void {
    const slot = this.slots[index];
    if (!slot) {
      return;
    }
    slot.line = line;
    slot.state = state;
    slot.raw = raw ?? slot.raw;
    slot.lastUsed = ++this.clock;
    this.lines[index] = line;
    primeLineContentFingerprint(line, slot.summary.digest, slot.summary.childDigests, valueDigests);
    this.cachedBytes += raw?.length ?? 0;
  }

  /** Renumber summaries after an insertion or removal. */
  private reindex(from: number): void {
    for (let index = from; index < this.slots.length; index++) {
      this.slots[index].summary = { ...this.slots[index].summary, index };
    }
  }

  /** Invalidate caches after an edit. */
  private changed(): void {
    this.revision += 1;
    this.fingerprintCache = null;
    this.materialized = null;
  }

  /** Update the header and mirror it onto the facade chart. */
  private setHeader(header: ChartHeader): void {
    const tempoChanged = JSON.stringify(header.BPMList) !== JSON.stringify(this.header.BPMList);
    this.header = header;
    this.tempo = new TempoMap(
      header.BPMList.length ? header.BPMList : ([{ bpm: 120, startTime: [0, 0, 1] }] as BpmEntry[]),
    );
    if (tempoChanged) {
      this.tempoDirty = true;
    }
    Object.assign(this.chart, headerValues(header));
  }

  /** Assign stable ids to one line and its owned objects. */
  private normalizeLine(line: JudgeLine, reuseIds = false): JudgeLine {
    for (const object of this.lineObjects(line)) {
      const existing = object.id;
      if (!isChartObjectId(existing) || (!reuseIds && this.usedIds.has(existing))) {
        object.id = this.identityFactory.next();
      }
      this.usedIds.add(object.id as string);
    }
    return line;
  }

  /** Every id-bearing object owned by a line. */
  private lineObjects(line: JudgeLine): Record<string, unknown>[] {
    const objects: Record<string, unknown>[] = [];
    visitLineObjects(line, (value) => objects.push(value));
    return objects;
  }

  /** Drop least-recently-used clean lines when the cache exceeds its budget. */
  private evict(): void {
    if (this.materializing || (!this.maxCachedLines && !this.maxCachedBytes)) {
      return;
    }
    const candidates = this.slots
      .filter((slot) => slot.line && slot.state === "loaded")
      .sort((left, right) => left.lastUsed - right.lastUsed);
    let lineCount = this.slots.reduce((count, slot) => count + (slot.line ? 1 : 0), 0);
    for (const slot of candidates) {
      if (
        (!this.maxCachedLines || lineCount <= this.maxCachedLines) &&
        (!this.maxCachedBytes || this.cachedBytes <= this.maxCachedBytes)
      ) {
        break;
      }
      const index = slot.summary.index;
      const rawLength = slot.raw?.length ?? 0;
      slot.line = undefined;
      slot.state = "missing";
      slot.raw = undefined;
      this.cachedBytes = Math.max(0, this.cachedBytes - rawLength);
      this.lines[index] = placeholderLine(slot.summary);
      lineCount -= 1;
    }
  }

  /** Build an eager document from a plain chart. */
  static fromChart(
    chart: Chart,
    options: { maxCachedLines?: number; maxCachedBytes?: number } = {},
  ): ChartDocument {
    const lines = chart.judgeLineList ?? [];
    const header = chartHeader(chart, lines.length);
    const tempo = new TempoMap(
      header.BPMList.length ? header.BPMList : ([{ bpm: 120, startTime: [0, 0, 1] }] as BpmEntry[]),
    );
    const summaries = lines.map((line, index) => summarizeChartLine(line, index, tempo));
    const provider: ChartLineProvider = {
      lineCount: lines.length,
      async readLine(index: number) {
        const line = lines[index];
        return line ? JSON.stringify(line) : undefined;
      },
    };
    return new ChartDocument({
      header,
      index: {
        version: 1,
        headerDigest: headerContentFingerprint(headerValues(header)),
        lines: summaries,
        assetNames: [],
        totalBytes: 0,
        canonical: false,
      },
      provider,
      initialLines: lines,
      ...options,
    });
  }
}

/** Build a header from a plain chart. */
function chartHeader(chart: Chart, lineCount: number): ChartHeader {
  const extras: Record<string, unknown> = { ...chart };
  delete extras.META;
  delete extras.BPMList;
  delete extras.judgeLineGroup;
  delete extras.blockAreaList;
  delete extras.effects;
  delete extras.shaderEvents;
  delete extras.markers;
  delete extras.judgeLineList;
  return {
    META: chart.META,
    BPMList: chart.BPMList,
    ...(chart.judgeLineGroup ? { judgeLineGroup: chart.judgeLineGroup } : {}),
    ...(chart.blockAreaList ? { blockAreaList: chart.blockAreaList } : {}),
    ...(Array.isArray(chart.effects) ? { effects: chart.effects } : {}),
    ...(Array.isArray(chart.shaderEvents) ? { shaderEvents: chart.shaderEvents } : {}),
    ...(Array.isArray(chart.markers) ? { markers: chart.markers } : {}),
    extras,
    lineCount,
  };
}

/** Resolve a line's parent index through the shared parent rule. */
export function lineParentOf(line: JudgeLine): number {
  return lineParentIndex(line.father);
}
