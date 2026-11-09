/**
 * The undo and redo history of one editor session.
 *
 * An entry keeps the chart on both sides of a change plus the selection around
 * it, so undo restores what was selected as well as what existed. `record`
 * rejects the current chart object by identity, and a retained-byte cap keeps
 * a long editing session from growing without limit. The saved baseline is the
 * canonical chart fingerprint, so replacing the document with equal content
 * does not mark it dirty.
 */
import { normalizeChartObjectIds, type Chart } from "../../global/chart/chart.ts";
import type { ChartObjectId } from "../../global/chart/identity.ts";
import { chartFingerprint } from "../document/chartRevision.ts";
import { invalidateChartLocations } from "../transaction/locations.ts";
import { createValue } from "../../state/values.ts";
import { sameSelection, type SelectionState } from "./selectionHistory.ts";
import type { EditorShortcutDefinition } from "../shortcuts/declarations.ts";

export interface EditorHistorySnapshot {
  canUndo: boolean;
  canRedo: boolean;
}

const historySnapshot = createValue<EditorHistorySnapshot>({
  initial: { canUndo: false, canRedo: false },
});
/** Whether the editor currently has undo and redo entries. */
export const getEditorHistorySnapshot = historySnapshot.get;
/** Publishes undo/redo availability to the toolbar. */
export function setEditorHistorySnapshot(next: EditorHistorySnapshot): void {
  historySnapshot.update(next);
}

/** The editor selection captured around one undoable change. */
export interface HistorySelection {
  beforeSelection?: SelectionState;
  afterSelection?: SelectionState;
}

/** A diagnostic attached to a history entry without coupling history to an editor feature. */
export interface HistoryEntryIssue {
  readonly code: string;
  readonly path?: string;
  readonly objectId?: ChartObjectId;
  readonly message?: string;
}

/** The recipe snapshot that produced one history entry. */
export interface HistoryEntryRecipe {
  readonly id: string;
  readonly name: string;
  readonly version: number;
  readonly params: unknown;
}

/** Identifies the actor that created a history entry. */
export interface HistoryEntryOrigin {
  readonly kind: string;
  readonly clientId?: string;
  readonly requestId?: string;
  /** The room transaction this entry compensates, when it is a collaborative undo. */
  readonly undoOf?: string;
}

/** Metadata shared by history producers, including transaction-based edits. */
export interface HistoryEntryMetadata {
  affectedObjectIds?: readonly ChartObjectId[];
  issues?: readonly HistoryEntryIssue[];
  recipe?: HistoryEntryRecipe;
  origin?: HistoryEntryOrigin;
}

export interface HistoryRecordOptions {
  /** The editor mutation already preserved chart object IDs. */
  normalized?: boolean;
  /** The caller has already validated a structurally conservative edit. */
  skipValidation?: boolean;
  /** Optional bounded estimate for a deletion-only change. */
  estimatedBytes?: number;
}

/** One undoable document change, with the bytes it is estimated to retain. */
export interface HistoryCommand {
  id: number;
  at: number;
  label: string;
  before: Chart;
  after: Chart;
  bytes: number;
  beforeFingerprint: string;
  afterFingerprint: string;
  affectedObjectIds: readonly ChartObjectId[];
  issues: readonly HistoryEntryIssue[];
  origin?: HistoryEntryOrigin;
  recipe?: HistoryEntryRecipe;
  beforeSelection?: SelectionState;
  afterSelection?: SelectionState;
}

/** A read-only history row for surfaces that render the undo and redo stacks. */
export interface HistoryEntrySummary {
  readonly id: number;
  readonly label: string;
  readonly at: number;
  readonly affectedCount: number;
  readonly discarded: boolean;
  /** Safe actor and compensation metadata; chart snapshots stay private. */
  readonly origin?: HistoryEntryOrigin;
}

/** Metadata needed by history surfaces without exposing retained chart snapshots. */
export interface HistoryEntryDetail extends HistoryEntrySummary {
  readonly affectedObjectIds: readonly ChartObjectId[];
  readonly issues: readonly HistoryEntryIssue[];
  readonly origin?: HistoryEntryOrigin;
  readonly recipe?: HistoryEntryRecipe;
}

/** The immutable read model for both history stacks and trimmed entries. */
export interface HistoryEntries {
  readonly undo: readonly HistoryEntrySummary[];
  readonly redo: readonly HistoryEntrySummary[];
  readonly discarded: number;
  readonly discardedEntries: readonly HistoryEntrySummary[];
}

/** Undo/redo stacks plus the committed chart, with bounded retention. */
export class History {
  document: Chart;
  /** Fingerprint of the last saved document; null means the session must be saved. */
  savedFingerprint: string | null;
  undoStack: HistoryCommand[];
  redoStack: HistoryCommand[];
  limit: number;
  byteLimit: number;
  retainedBytes: number;
  /** Bumped whenever the document or either stack changes. */
  revision: number;

  private nextId: number;
  private discardedCount: number;
  private discardedEntries: HistoryEntryDetail[];
  private entriesSnapshot: HistoryEntries;
  private readonly listeners = new Set<() => void>();

  /** Starts from a normalized document with empty stacks. */
  constructor(document: Chart, limit = 150) {
    this.document = normalizeChartObjectIds(document);
    this.savedFingerprint = chartFingerprint(this.document);
    this.undoStack = [];
    this.redoStack = [];
    this.limit = limit;
    this.byteLimit = 64 * 1024 ** 2;
    this.retainedBytes = 0;
    this.revision = 0;
    this.nextId = 1;
    this.discardedCount = 0;
    this.discardedEntries = [];
    this.entriesSnapshot = Object.freeze({
      undo: Object.freeze([]),
      redo: Object.freeze([]),
      discarded: 0,
      discardedEntries: Object.freeze([]),
    });
  }

  /** Observe changes to the immutable history read model. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Return stack summaries without exposing mutable history commands. */
  entries(): HistoryEntries {
    return this.entriesSnapshot;
  }

  /** Rebuilds the frozen read model from both stacks and discarded entries. */
  private createEntriesSnapshot(): HistoryEntries {
    const summarize = (command: HistoryCommand, discarded = false): HistoryEntrySummary =>
      Object.freeze({
        id: command.id,
        label: command.label,
        at: command.at,
        affectedCount: command.affectedObjectIds.length,
        discarded,
        ...(command.origin ? { origin: Object.freeze({ ...command.origin }) } : {}),
      });
    return Object.freeze({
      undo: Object.freeze(this.undoStack.map((command) => summarize(command))),
      redo: Object.freeze(this.redoStack.map((command) => summarize(command))),
      discarded: this.discardedCount,
      discardedEntries: Object.freeze(
        this.discardedEntries.map((entry) => Object.freeze({ ...entry })),
      ),
    });
  }

  /** Read metadata for one retained or discarded entry without exposing its chart snapshots. */
  entry(id: number): HistoryEntryDetail | null {
    const command = [...this.undoStack, ...this.redoStack].find((candidate) => candidate.id === id);
    if (command) {
      return detail(command, false);
    }
    return this.discardedEntries.find((candidate) => candidate.id === id) ?? null;
  }

  /** Record one already-prepared chart change without knowing about the editor UI. */
  record(
    label: string,
    next: Chart,
    selectionState: HistorySelection = {},
    metadata: HistoryEntryMetadata = {},
    options: HistoryRecordOptions = {},
  ): boolean {
    if (next === this.document) {
      return false;
    }
    // Every committed chart is a persistence boundary; normalize ids here so
    // derived events (for example trajectory fragments) carry a stable identity.
    // The previous document lets unchanged line objects and notes keep their
    // normalized ids without walking the whole chart again.
    if (!options.normalized) {
      next = normalizeChartObjectIds(next, undefined, this.document);
    }
    if (next === this.document) {
      return false;
    }
    const bytes = options.estimatedBytes ?? retainedChangeBytes(this.document, next);
    const before = this.document;
    invalidateChartLocations(before);
    invalidateChartLocations(next);
    const command: HistoryCommand = {
      id: this.nextId,
      at: Date.now(),
      label,
      before,
      after: next,
      bytes,
      beforeFingerprint: chartFingerprint(before),
      afterFingerprint: chartFingerprint(next),
      affectedObjectIds: Object.freeze([...(metadata.affectedObjectIds ?? [])]),
      issues: Object.freeze([...(metadata.issues ?? [])]),
      origin: metadata.origin ? structuredClone(metadata.origin) : undefined,
      recipe: metadata.recipe ? structuredClone(metadata.recipe) : undefined,
      ...selectionState,
    };
    // A new entry makes the redo branch unreachable. Drop its accounting
    // before trimming so it cannot evict valid undo entries.
    this.retainedBytes -= this.redoStack.reduce((sum, entry) => sum + entry.bytes, 0);
    this.redoStack = [];
    this.nextId += 1;
    this.undoStack.push(command);
    this.retainedBytes += bytes;
    // The newest operation must remain undoable even if it alone exceeds the
    // byte budget; the budget is consequently soft for that one entry.
    while (
      this.undoStack.length > Math.max(1, this.limit) ||
      (this.undoStack.length > 1 && this.retainedBytes > this.byteLimit)
    ) {
      const discarded = this.undoStack.shift();
      if (!discarded) {
        break;
      }
      this.retainedBytes -= discarded.bytes;
      this.discardedCount += 1;
      this.discardedEntries.push(detail(discarded, true));
      const retainedDiscardedLimit = Math.max(150, this.limit);
      if (this.discardedEntries.length > retainedDiscardedLimit) {
        this.discardedEntries.splice(0, this.discardedEntries.length - retainedDiscardedLimit);
      }
    }
    this.document = next;
    this.notify();
    return true;
  }

  /** Record a selection-only transition without marking the chart dirty. */
  recordSelection(
    label: string,
    beforeSelection: SelectionState,
    afterSelection: SelectionState,
  ): boolean {
    if (sameSelection(beforeSelection, afterSelection)) {
      return false;
    }
    const document = this.document;
    const command: HistoryCommand = {
      id: this.nextId++,
      at: Date.now(),
      label,
      before: document,
      after: document,
      bytes: 0,
      beforeFingerprint: chartFingerprint(document),
      afterFingerprint: chartFingerprint(document),
      affectedObjectIds: Object.freeze([]),
      issues: Object.freeze([]),
      beforeSelection,
      afterSelection,
    };
    this.retainedBytes -= this.redoStack.reduce((sum, entry) => sum + entry.bytes, 0);
    this.undoStack.push(command);
    this.redoStack = [];
    while (this.undoStack.length > Math.max(1, this.limit)) {
      const discarded = this.undoStack.shift();
      if (!discarded) {
        break;
      }
      this.retainedBytes -= discarded.bytes;
      this.discardedCount += 1;
      this.discardedEntries.push(detail(discarded, true));
      const retainedDiscardedLimit = Math.max(150, this.limit);
      if (this.discardedEntries.length > retainedDiscardedLimit) {
        this.discardedEntries.splice(0, this.discardedEntries.length - retainedDiscardedLimit);
      }
    }
    this.notify();
    return true;
  }

  /** Restores the previous document and moves its entry to the redo stack. */
  undo(): boolean {
    const command = this.undoStack.pop();
    if (!command) {
      return false;
    }
    this.redoStack.push(command);
    this.document = command.before;
    invalidateChartLocations(this.document);
    this.notify();
    return true;
  }

  /** Reapplies the next document and moves its entry back to the undo stack. */
  redo(): boolean {
    const command = this.redoStack.pop();
    if (!command) {
      return false;
    }
    this.undoStack.push(command);
    this.document = command.after;
    invalidateChartLocations(this.document);
    this.notify();
    return true;
  }

  /** Marks a document as the saved baseline for dirty tracking. */
  markSaved(document: Chart = this.document): void {
    this.savedFingerprint = chartFingerprint(document);
  }
  /** Marks the session as requiring an initial save. */
  markUnsaved(): void {
    this.savedFingerprint = null;
  }
  /** True when the current document's content differs from the saved baseline. */
  get dirty(): boolean {
    return this.savedFingerprint === null || this.fingerprint() !== this.savedFingerprint;
  }

  /**
   * The current document's fingerprint.
   *
   * `chartFingerprint` is cached per chart/line, so a caller asking right after a
   * commit gets the value the commit already derived.
   */
  fingerprint(): string {
    return chartFingerprint(this.document);
  }

  /** Refreshes the read model and notifies subscribers after a transition. */
  private notify(): void {
    this.revision += 1;
    this.entriesSnapshot = this.createEntriesSnapshot();
    for (const listener of [...this.listeners]) {
      try {
        listener();
      } catch (error) {
        // A subscriber runs after the state transition and must not make a
        // successful commit appear to have failed or block other observers.
        console.error("History listener failed", error);
      }
    }
  }
}

/** Copies one command's metadata without its chart snapshots. */
function detail(command: HistoryCommand, discarded: boolean): HistoryEntryDetail {
  return Object.freeze({
    id: command.id,
    label: command.label,
    at: command.at,
    affectedCount: command.affectedObjectIds.length,
    discarded,
    affectedObjectIds: Object.freeze([...command.affectedObjectIds]),
    issues: Object.freeze([...command.issues]),
    ...(command.origin ? { origin: structuredClone(command.origin) } : {}),
    ...(command.recipe ? { recipe: structuredClone(command.recipe) } : {}),
  });
}

/** Estimates bytes retained by one change, sharing unchanged subtrees. */
export function retainedChangeBytes(before: unknown, after: unknown): number {
  if (before === after) {
    return 0;
  }
  if (!before || typeof before !== "object") {
    return estimateRetained(before) + estimateRetained(after);
  }
  if (!after || typeof after !== "object") {
    return estimateRetained(before) + estimateRetained(after);
  }
  if (Array.isArray(before) && Array.isArray(after)) {
    // Find the untouched prefix and suffix by reference. A note inserted at the
    // front of a large array shifts every later element.
    const shared = Math.min(before.length, after.length);
    let prefix = 0;
    while (prefix < shared && before[prefix] === after[prefix]) {
      prefix += 1;
    }
    let suffix = 0;
    while (
      suffix < shared - prefix &&
      before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
    ) {
      suffix += 1;
    }
    let bytes = Math.max(before.length, after.length) * 8;
    if (before.length === after.length) {
      for (let index = prefix; index < before.length - suffix; index++) {
        bytes += retainedChangeBytes(before[index], after[index]);
      }
      return bytes;
    }
    for (let index = prefix; index < before.length - suffix; index++) {
      bytes += estimateRetained(before[index]);
    }
    for (let index = prefix; index < after.length - suffix; index++) {
      bytes += estimateRetained(after[index]);
    }
    return bytes;
  }
  let bytes = 64;
  const previous = before as Record<string, unknown>;
  const next = after as Record<string, unknown>;
  for (const key in previous) {
    if (!Object.hasOwn(previous, key)) {
      continue;
    }
    if (Object.hasOwn(next, key)) {
      if (previous[key] === next[key]) {
        continue;
      }
      bytes += retainedChangeBytes(previous[key], next[key]);
    } else {
      bytes += estimateRetained(previous[key]);
    }
  }
  for (const key in next) {
    if (!Object.hasOwn(next, key) || Object.hasOwn(previous, key)) {
      continue;
    }
    bytes += estimateRetained(next[key]);
  }
  return bytes;
}

const retainedByteCache = new WeakMap<object, number>();

/** Rough retained size of a value, caching object results and breaking cycles. */
function estimateRetained(value: unknown, seen: WeakSet<object> = new WeakSet()): number {
  if (typeof value === "string") {
    return value.length * 2 + 24;
  }
  if (!value || typeof value !== "object") {
    return 16;
  }
  const cached = retainedByteCache.get(value);
  if (cached !== undefined) {
    return cached;
  }
  if (seen.has(value)) {
    return 0;
  }
  seen.add(value);
  let bytes = Array.isArray(value) ? value.length * 8 : 64;
  for (const key in value) {
    if (Object.hasOwn(value, key)) {
      bytes += estimateRetained((value as Record<string, unknown>)[key], seen);
    }
  }
  retainedByteCache.set(value, bytes);
  return bytes;
}

// ------------------------------------------------------------------ shortcuts

/**
 * Undo and redo belong to the history they move through.
 *
 * The global pages edit the same document and commit into the same history, so
 * these are workspace commands rather than editor commands: `Ctrl+Z` must undo
 * a metadata or timing edit without first switching back to the timeline. A
 * focused text field still owns native undo through the context rules.
 */
export const historyShortcuts: readonly EditorShortcutDefinition[] = [
  {
    id: "edit.undo",
    category: "editor.editing",
    title: "shortcuts.editor.undo",
    scope: "workspace",
    defaults: [{ key: "Z", modifiers: ["CTRL"] }],
  },
  {
    id: "edit.redo",
    category: "editor.editing",
    title: "shortcuts.editor.redo",
    scope: "workspace",
    // The Ctrl+Y alternative matches the migration map and the curve draft's
    // long-standing redo key.
    defaults: [
      { key: "Z", modifiers: ["CTRL", "SHIFT"] },
      { key: "Y", modifiers: ["CTRL"] },
    ],
  },
];
