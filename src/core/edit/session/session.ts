/* eslint-disable max-lines -- history, selection, and document lifecycle share one session owner. */
/** Owns mutable editing state for one open chart, including history and selections. */
import { t } from "../../../i18n/index.ts";
import { warmChartFingerprintAsync } from "../document/chartRevision.ts";
import {
  History,
  type HistoryBeatRange,
  type HistoryEntries,
  type HistoryEntryDetail,
  type HistoryEntryMetadata,
  type HistoryEntryOrigin,
  type HistoryRecordOptions,
} from "./history.ts";
import {
  countScoringNotes,
  createChart,
  createLine,
  normalizeChartObjectIds,
} from "../../global/chart/chart.ts";
import { createChartObjectId } from "../../global/chart/identity.ts";
import type { Chart, JudgeLine, JudgeLineEvent, JudgeLineNote } from "../../global/chart/chart.ts";
import {
  selectionBeatRange,
  selectionState,
  sameSelection,
  remapSelection,
  restoreSelection,
} from "./selectionHistory.ts";
import type { SelectionState } from "./selectionHistory.ts";
import { extensionRegistry } from "../../extensions/runtime.ts";
import { selectiveUndo, selectiveUndoLatest } from "./selectiveUndo.ts";
import {
  NOISE_LINE_FIELD,
  noiseLineSettings,
  validNoiseLineSettings,
} from "../../global/chart/noise/noiseLine.ts";
import { lineNoiseConflicts } from "../../global/chart/noise/lineNoiseConflicts.ts";
import { lineAllowsNotes } from "../../global/chart/line/lineTraits.ts";

/** Which object kind the inspector and the keyboard act on. */
export type EditorFocus = "notes" | "events";

/** Builds a request id for a local entry committed while a room is active. */
function collaborationRequestId(): string {
  const crypto = globalThis.crypto;
  return typeof crypto?.randomUUID === "function"
    ? crypto.randomUUID()
    : `edit-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

/** Multi-line editing works on either notes or events. */
export type MultiLineMode = "notes" | "events";
/** Selection intent: no object, a normal single pick, or a multi-select gesture. */
export type SelectionMode = "none" | "single" | "multi";
/** The note field is single, merged multi-line, or split multi-line. */
export type NoteTimelineMode = "single" | "multi_merged" | "multi";
/** The event field is single or multi-line. */
export type EventTimelineMode = "single" | "multi";

export interface SessionMutationGate {
  run<T>(kind: "ui" | "history", operation: () => T): T;
}

export type SessionCommitOptions = HistoryRecordOptions & {
  /** Selection mapped to the committed chart, installed with the history entry. */
  afterSelection?: SelectionState;
  /**
   * Internal: a transaction plan already validated noise-line compatibility for
   * this chart. A before-commit hook can still replace the chart after planning,
   * so the commit boundary keeps its check whenever a hook is registered.
   */
  validatedNoise?: boolean;
};

/** One note addressed by the line it lives on. */
export interface SelectedNoteEntry {
  lineIndex: number;
  index: number;
  note: JudgeLineNote;
}

/** One clipped event together with the track it came from. */
export interface ClippedEvent {
  type: string;
  event: JudgeLineEvent;
}

/** A range of editing time shown on the timeline's activity strip. */
export interface RecentEdit {
  entryId: number;
  affectedCount: number;
  start: number;
  end: number;
  label: string;
}

/** Mutable editing state for one open chart, including history and selections. */
export class EditorSession extends EventTarget {
  history: History;
  lineIndex: number;
  selection: Set<number>;
  /** Bumped by pointer selection gestures so pane routing runs even when the set is unchanged. */
  selectionRevision: number;
  /** The most recent rectangle selection's target, including a one-item result. */
  marqueeSelection: "notes" | "events" | null;
  /** Whether the active object selection came from a single click or a multi-select gesture. */
  selectionMode: SelectionMode;
  clipboard: JudgeLineNote[];
  clipboardNoteLines: number[];
  eventSelection: Set<string>;
  eventClipboard: ClippedEvent[];
  eventClipboardLines: number[];
  /** Source layer of each clipped event; empty for older clipboard entries. */
  eventClipboardLayers: number[];
  /** Paste each clipped event back onto its source layer instead of the active one. */
  eventClipboardPreserveLayers: boolean;
  eventLayer: number;
  focus: EditorFocus;
  multiLineEnabled: boolean;
  multiLineMode: MultiLineMode;
  multiLineMerge: boolean;
  multiLineIndices: number[];
  private targetLineIndicesCache: number[] | null;
  private targetLineIndicesCacheSource: number[] | null;
  private targetLineIndicesCacheLine: number;
  private targetLineIndicesCacheMulti: boolean;
  multiLineSelection: Map<number, Set<number>>;
  multiEventSelection: Map<number, Set<string>>;
  multiSelectionIntent: unknown;
  editSeconds: number;
  recentEdits: RecentEdit[];
  /** Beat span of the latest commit or history move, used by undo jump. */
  lastEditBeatRange: HistoryBeatRange | null;
  /** Beat span of the most recent paste, for the overview strip marker. */
  lastPasteBeatRange: HistoryBeatRange | null;
  readonly readOnly: boolean;
  /** The active room role can make an otherwise writable document read-only. */
  collaborationReadOnly = false;
  /** Remote entries are applied through the room and must not be undone locally. */
  collaborationActive = false;
  /** Stable member id attached to local history entries while a room is active. */
  collaborationActorId = "";
  private mutationGate: SessionMutationGate | null = null;
  private fingerprintWarm?: Promise<string>;

  /** Runtime editing switches kept with this editor session; unset values use caller defaults. */
  declare cutDensity: number;
  declare division: number;
  declare eventWheelSteps: Record<string, number>;
  declare shaderAutoAlign?: boolean;
  declare liveBeatEdit?: boolean;
  declare liveEventEdit?: boolean;
  declare liveNoteEdit?: boolean;
  declare visibleTimeUnit?: string;

  /** Creates a session over a normalized chart, optionally read-only. */
  constructor(chart: Chart = createChart(), readOnly = false) {
    super();
    this.readOnly = readOnly;
    this.history = new History(normalizeChartObjectIds(chart));
    this.lineIndex = 0;
    this.selection = new Set();
    this.selectionRevision = 0;
    this.marqueeSelection = null;
    this.selectionMode = "none";
    this.clipboard = [];
    this.clipboardNoteLines = [];
    this.eventSelection = new Set();
    this.eventClipboard = [];
    this.eventClipboardLines = [];
    this.eventClipboardLayers = [];
    this.eventClipboardPreserveLayers = false;
    this.eventLayer = 0;
    this.focus = "notes";
    this.multiLineEnabled = false;
    this.multiLineMode = "notes";
    this.multiLineMerge = true;
    this.multiLineIndices = [];
    this.targetLineIndicesCache = null;
    this.targetLineIndicesCacheSource = null;
    this.targetLineIndicesCacheLine = -1;
    this.targetLineIndicesCacheMulti = false;
    this.multiLineSelection = new Map();
    this.multiEventSelection = new Map();
    this.multiSelectionIntent = null;
    this.editSeconds = 0;
    this.recentEdits = [];
    this.lastEditBeatRange = null;
    this.lastPasteBeatRange = null;
  }

  /** The committed chart held by history. */
  get chart(): Chart {
    return this.history.document;
  }
  /** Expose the immutable history read model to editor-owned surfaces. */
  historyEntries(): HistoryEntries {
    return this.history.entries();
  }
  /** Metadata for one retained or discarded history entry. */
  historyEntry(id: number): HistoryEntryDetail | null {
    return this.history.entry(id);
  }
  /** The active judge line, or undefined for an empty chart. */
  get line(): JudgeLine | undefined {
    return this.chart.judgeLineList?.[this.lineIndex];
  }
  /** Notes on the active judge line. */
  get notes(): JudgeLineNote[] {
    return this.line?.notes ?? [];
  }
  /** True when multi-line editing is enabled with at least two lines. */
  get multiLineActive(): boolean {
    return this.multiLineEnabled && this.multiLineIndices.length >= 2;
  }
  /** The note field's presentation, which needs two selected lines to be multi. */
  get notesMode(): NoteTimelineMode {
    if (!this.multiLineActive || this.multiLineMode !== "notes") {
      return "single";
    }
    return this.multiLineMerge ? "multi_merged" : "multi";
  }
  /** The event field's presentation. Only one field can be multi at a time. */
  get eventsMode(): EventTimelineMode {
    return this.multiLineActive && this.multiLineMode === "events" ? "multi" : "single";
  }
  /** The active line, or every selected line while multi-line is active. */
  get targetLineIndices(): number[] {
    const multi = this.multiLineActive;
    if (
      this.targetLineIndicesCache &&
      this.targetLineIndicesCacheMulti === multi &&
      this.targetLineIndicesCacheLine === this.lineIndex &&
      (!multi || this.targetLineIndicesCacheSource === this.multiLineIndices)
    ) {
      return this.targetLineIndicesCache;
    }
    this.targetLineIndicesCacheMulti = multi;
    this.targetLineIndicesCacheLine = this.lineIndex;
    this.targetLineIndicesCacheSource = multi ? this.multiLineIndices : null;
    this.targetLineIndicesCache = multi ? [...this.multiLineIndices] : [this.lineIndex];
    return this.targetLineIndicesCache;
  }
  /** Existing judge lines addressed by `targetLineIndices`. */
  get targetLines(): JudgeLine[] {
    return this.targetLineIndices
      .map((index) => this.chart.judgeLineList?.[index])
      .filter((line): line is JudgeLine => Boolean(line));
  }
  /** True when `index` is one of the multi-line target lines. */
  isTargetLine(index: number): boolean {
    return this.multiLineActive && this.multiLineIndices.includes(index);
  }
  /**
   * Replaces the shared line list; two or more lines enable multi-line
   * rendering. An empty result falls back to the current line while one exists.
   */
  setMultiLineSelection(indices: readonly number[]): void {
    const length = this.chart.judgeLineList?.length ?? 0;
    const next = [
      ...new Set(
        indices.filter((index) => Number.isInteger(index) && index >= 0 && index < length),
      ),
    ].sort((a, b) => a - b);
    this.multiLineIndices =
      next.length || !length ? next : [Math.max(0, Math.min(this.lineIndex, length - 1))];
    this.multiLineEnabled = this.multiLineIndices.length > 1;
    this.notify();
  }
  /** Enables or hides multi-line editing without discarding its line list. */
  setMultiLineEnabled(enabled = true, mode: MultiLineMode = this.multiLineMode): void {
    this.multiLineEnabled = Boolean(enabled);
    this.multiLineMode = mode === "events" ? "events" : "notes";
    if (this.multiLineEnabled && !this.multiLineIndices.length) {
      this.multiLineIndices = [this.lineIndex];
    }
    // Disabling hides multi-line editing but keeps its line list and selections.
    this.normalizeMultiLine();
    this.notify();
  }
  /** Switches whether multi-line notes share one merged field. */
  setMultiLineMerge(enabled: unknown): void {
    const next = Boolean(enabled);
    if (this.multiLineMerge === next) {
      return;
    }
    this.multiLineMerge = next;
    this.notify();
  }
  /** Selects whether multi-line editing targets notes or events. */
  setMultiLineMode(mode: MultiLineMode): void {
    this.multiLineMode = mode === "events" ? "events" : "notes";
    this.notify();
  }
  /** Drops invalid line indices and disables multi-line below two lines. */
  normalizeMultiLine(): void {
    const length = this.chart.judgeLineList?.length ?? 0;
    this.multiLineIndices = [
      ...new Set(
        this.multiLineIndices.filter(
          (index) => Number.isInteger(index) && index >= 0 && index < length,
        ),
      ),
    ].sort((a, b) => a - b);
    if (this.multiLineEnabled && !this.multiLineIndices.length && length) {
      this.multiLineIndices = [Math.max(0, Math.min(this.lineIndex, length - 1))];
    }
    if (this.multiLineIndices.length < 2) {
      this.multiLineEnabled = false;
    }
  }
  /** Adds one line to the multi-line selection and enables the mode. */
  addMultiLine(index = this.lineIndex): void {
    this.multiLineEnabled = true;
    if (Number.isInteger(index)) {
      this.multiLineIndices = [...this.multiLineIndices, index];
    }
    this.normalizeMultiLine();
    this.notify();
  }
  /** Removes one line, keeping at least the active line selected. */
  removeMultiLine(index = this.lineIndex): void {
    const next = this.multiLineIndices.filter((value) => value !== index);
    const length = this.chart.judgeLineList?.length ?? 0;
    this.multiLineIndices =
      next.length || !length ? next : [Math.max(0, Math.min(this.lineIndex, length - 1))];
    this.normalizeMultiLine();
    this.notify();
  }
  /** Resets the selection to the active line and disables multi-line. */
  clearMultiLines(): void {
    const length = this.chart.judgeLineList?.length ?? 0;
    this.multiLineIndices = length ? [Math.max(0, Math.min(this.lineIndex, length - 1))] : [];
    this.multiLineEnabled = false;
    this.notify();
  }
  /** Adds the line when absent, otherwise removes it. */
  toggleMultiLine(index = this.lineIndex): void {
    this.isTargetLine(index) ? this.removeMultiLine(index) : this.addMultiLine(index);
  }
  /** Adds the next unselected line, wrapping around the chart. */
  addNextMultiLine(): void {
    if (!this.multiLineIndices.length) {
      return this.addMultiLine(this.lineIndex);
    }
    const length = this.chart.judgeLineList?.length ?? 0;
    if (!length || this.multiLineIndices.length >= length) {
      return;
    }
    const selected = new Set(this.multiLineIndices);
    for (let offset = 1; offset <= length; offset++) {
      const next = (Math.max(...this.multiLineIndices) + offset) % length;
      if (!selected.has(next)) {
        return this.addMultiLine(next);
      }
    }
  }
  /** Adds the previous unselected line, wrapping around the chart. */
  addPreviousMultiLine(): void {
    if (!this.multiLineIndices.length) {
      return this.addMultiLine(this.lineIndex);
    }
    const length = this.chart.judgeLineList?.length ?? 0;
    if (!length || this.multiLineIndices.length >= length) {
      return;
    }
    const selected = new Set(this.multiLineIndices);
    for (let offset = 1; offset <= length; offset++) {
      const previous = (Math.min(...this.multiLineIndices) - offset + length * 2) % length;
      if (!selected.has(previous)) {
        return this.addMultiLine(previous);
      }
    }
  }
  /** Removes the highest selected line index. */
  removeMaximumMultiLine(): void {
    if (this.multiLineIndices.length) {
      this.removeMultiLine(Math.max(...this.multiLineIndices));
    }
  }
  /** Removes the lowest selected line index. */
  removeMinimumMultiLine(): void {
    if (this.multiLineIndices.length) {
      this.removeMultiLine(Math.min(...this.multiLineIndices));
    }
  }
  /** Warm and return the structural fingerprint in yielding slices after installation. */
  warmFingerprint(): Promise<string> {
    this.fingerprintWarm ??= warmChartFingerprintAsync(this.history.document);
    return this.fingerprintWarm;
  }

  /** Dispatches the session's change event. */
  notify(): void {
    this.dispatchEvent(new Event("change"));
  }

  /** Installs the gate that serializes UI and history mutations. */
  setMutationGate(gate: SessionMutationGate | null): void {
    this.mutationGate = gate;
  }

  /** Serialize a history-derived mutation with other document changes. */
  runHistoryMutation<T>(operation: () => T): T {
    return this.mutationGate?.run("history", operation) ?? operation();
  }

  /** Captures the current selection and mode for history. */
  selectionState(): SelectionState {
    return selectionState(this);
  }

  /** Record a UI-only selection transition without changing chart data. */
  recordSelection(
    label = t("editor.session.selectionChanged"),
    beforeSelection: SelectionState = this.selectionState(),
    notify = true,
  ): boolean {
    /** Records the selection transition and optionally notifies listeners. */
    const operation = () => {
      const changed = this.history.recordSelection(label, beforeSelection, this.selectionState());
      if (notify) {
        this.notify();
      }
      return changed;
    };
    return this.mutationGate?.run("ui", operation) ?? operation();
  }

  /** Apply one editor-level chart change, including session and UI bookkeeping. */
  commitChart(
    label: string,
    chart: Chart,
    beforeSelection: SelectionState = this.selectionState(),
    metadata: HistoryEntryMetadata = {},
    options: SessionCommitOptions = {},
  ): boolean {
    return (
      this.mutationGate?.run("ui", () =>
        this.commitChartInternal(label, chart, beforeSelection, metadata, options),
      ) ?? this.commitChartInternal(label, chart, beforeSelection, metadata, options)
    );
  }

  /** Applies an authoritative room transaction despite the local read-only gate. */
  commitRemoteChart(
    label: string,
    chart: Chart,
    origin: Pick<HistoryEntryOrigin, "clientId" | "requestId" | "undoOf"> = {},
  ): boolean {
    const metadata: HistoryEntryMetadata = {
      origin: { kind: "collaboration-remote", ...origin },
    };
    const operation = (): boolean => {
      const beforeSelection = this.selectionState();
      const afterSelection = remapSelection(this.chart, chart, beforeSelection);
      return this.commitChartInternal(
        label,
        chart,
        beforeSelection,
        metadata,
        { afterSelection },
        true,
      );
    };
    return this.mutationGate?.run("ui", operation) ?? operation();
  }

  /** Apply the room role; viewers cannot commit, and remote entries stay protected. */
  setCollaborationAccess(active: boolean, readOnly: boolean): void {
    this.collaborationActive = active;
    this.collaborationReadOnly = readOnly;
    if (!active) {
      this.collaborationActorId = "";
    }
    this.notify();
  }

  /** Set the member id stamped on local room transactions. */
  setCollaborationActor(actorId: string): void {
    this.collaborationActorId = actorId;
  }

  /** Runs commit hooks and policy checks, then records the chart change. */
  private commitChartInternal(
    label: string,
    chart: Chart,
    beforeSelection: SelectionState,
    metadata: HistoryEntryMetadata,
    options: SessionCommitOptions,
    remote = false,
  ): boolean {
    if ((this.readOnly || this.collaborationReadOnly) && !remote) {
      this.notify();
      return false;
    }
    const historyMetadata =
      !remote && this.collaborationActive && this.collaborationActorId
        ? {
            ...metadata,
            origin: metadata.origin
              ? {
                  ...metadata.origin,
                  clientId: metadata.origin.clientId ?? this.collaborationActorId,
                  requestId: metadata.origin.requestId ?? collaborationRequestId(),
                }
              : {
                  kind: "collaboration-local",
                  clientId: this.collaborationActorId,
                  requestId: collaborationRequestId(),
                },
          }
        : metadata;
    const beforeHook = extensionRegistry.hasHook("session:before-commit");
    const before = beforeHook
      ? {
          label,
          chart: structuredClone(chart),
          beforeSelection: structuredClone(beforeSelection),
          metadata: structuredClone(historyMetadata),
          cancel: false,
        }
      : { label, chart, beforeSelection, metadata: historyMetadata, cancel: false };
    extensionRegistry.emitHook("session:before-commit", before);
    if (before.cancel) {
      this.notify();
      return false;
    }
    // Check at the common commit boundary so paste, batch edits, extensions,
    // and remote changes cannot bypass the noise-line restrictions. A
    // transaction plan already checked the same chart, but a before-commit hook
    // may replace it after that plan was validated.
    if (!options.validatedNoise || beforeHook) {
      const invalidNoiseLine = (before.chart.judgeLineList ?? []).some((line) => {
        if (Object.hasOwn(line, NOISE_LINE_FIELD) && !validNoiseLineSettings(line)) {
          return true;
        }
        if (!noiseLineSettings(line)) {
          return false;
        }
        const conflicts = lineNoiseConflicts(line);
        return conflicts.notes > 0 || conflicts.alphaEvents > 0 || conflicts.speedEvents > 0;
      });
      if (invalidNoiseLine) {
        this.notify();
        return false;
      }
    }
    const afterSelection = options.afterSelection ?? this.selectionState();
    const beatRange =
      options.beatRange ??
      selectionBeatRange(before.chart, afterSelection) ??
      selectionBeatRange(this.chart, before.beforeSelection);
    const committed = this.history.record(
      before.label,
      before.chart,
      {
        beforeSelection: before.beforeSelection,
        afterSelection,
      },
      before.metadata,
      {
        normalized: options.normalized && !beforeHook,
        skipValidation: options.skipValidation,
        estimatedBytes: options.estimatedBytes,
        beatRange: beatRange ?? undefined,
      },
    );
    if (committed) {
      this.lastEditBeatRange = beatRange ?? null;
      if (options.afterSelection) {
        restoreSelection(this, options.afterSelection);
      }
      const entry = this.history.undoStack.at(-1);
      const time = Number.isFinite(this.editSeconds) ? Math.max(0, this.editSeconds) : 0;
      if (entry) {
        this.recentEdits.push({
          entryId: entry.id,
          affectedCount: entry.affectedObjectIds.length,
          start: time,
          end: time,
          label,
        });
      }
      if (this.recentEdits.length > 50) {
        this.recentEdits.shift();
      }
    }
    if (committed && extensionRegistry.hasHook("session:after-commit")) {
      extensionRegistry.emitHook("session:after-commit", {
        label: before.label,
        chart: structuredClone(this.chart),
      });
    }
    this.notify();
    return committed;
  }

  /** Inserts notes on the active line and selects them. */
  insertNotes(notes: JudgeLineNote[], label = t("editor.session.addNotes")): boolean {
    return this.insertNotesAt(this.lineIndex, notes, label);
  }

  /** Inserts cloned notes on one line, assigns ids, and updates its score. */
  insertNotesAt(
    lineIndex: number,
    notes: JudgeLineNote[],
    label = t("editor.session.addNotes"),
    beforeSelection: SelectionState = this.selectionState(),
  ): boolean {
    const lines = [...(this.chart.judgeLineList ?? [])];
    const existing = lines[lineIndex]?.notes ?? [];
    const first = existing.length;
    if (!lines[lineIndex] || !lineAllowsNotes(lines[lineIndex])) {
      return false;
    }
    const inserted = structuredClone(notes).map((note) => ({
      ...note,
      id: createChartObjectId(),
    }));
    const existingScoring =
      typeof lines[lineIndex].numOfNotes === "number"
        ? lines[lineIndex].numOfNotes
        : countScoringNotes(existing);
    lines[lineIndex] = {
      ...lines[lineIndex],
      notes: [...existing, ...inserted],
      numOfNotes: existingScoring + countScoringNotes(inserted),
    };
    const selected = inserted.map((note, offset) => first + offset);
    if (this.multiLineActive && this.multiLineMode === "notes") {
      this.multiLineSelection.clear();
      this.multiLineSelection.set(lineIndex, new Set(selected));
      if (lineIndex === this.lineIndex) {
        this.selection = new Set(selected);
      }
    } else {
      this.selection = new Set(selected);
    }
    this.commitChart(
      label,
      { ...this.chart, judgeLineList: lines },
      beforeSelection,
      {},
      {
        normalized: true,
      },
    );
    return true;
  }

  /** Selected notes with their line and index, across multi-line panels. */
  selectedNoteEntries(): SelectedNoteEntry[] {
    if (this.multiLineActive && this.multiLineMode === "notes") {
      return [...(this.multiLineSelection ?? new Map())].flatMap(([lineIndex, indices]) => {
        const line = this.chart.judgeLineList?.[lineIndex];
        return [...indices]
          .map((index) => ({ lineIndex, index, note: line?.notes?.[index] }))
          .filter((entry): entry is SelectedNoteEntry => Boolean(entry.note));
      });
    }
    return [...this.selection]
      .map((index) => ({ lineIndex: this.lineIndex, index, note: this.notes[index] }))
      .filter((entry): entry is SelectedNoteEntry => Boolean(entry.note));
  }

  /** Deletes selected notes from every affected line in one commit. */
  deleteSelection(): void {
    const entries = this.selectedNoteEntries();
    if (!entries.length) {
      return;
    }
    const beforeSelection = this.selectionState();
    const lines = [...(this.chart.judgeLineList ?? [])];
    const selectedByLine = new Map<number, Set<number>>();
    for (const entry of entries) {
      if (!selectedByLine.has(entry.lineIndex)) {
        selectedByLine.set(entry.lineIndex, new Set());
      }
      selectedByLine.get(entry.lineIndex)?.add(entry.index);
    }
    for (const [lineIndex, selected] of selectedByLine) {
      const line = lines[lineIndex];
      if (!line) {
        continue;
      }
      const remaining = (line.notes ?? []).filter((note, noteIndex) => !selected.has(noteIndex));
      const previousScoring =
        typeof line.numOfNotes === "number" ? line.numOfNotes : countScoringNotes(line.notes);
      const removedScoring = [...selected].reduce(
        (count, index) => count + (line.notes?.[index]?.type === 2 ? 0 : 1),
        0,
      );
      lines[lineIndex] = {
        ...line,
        notes: remaining,
        numOfNotes: Math.max(0, previousScoring - removedScoring),
      };
    }
    this.selection = new Set();
    if (this.multiLineActive && this.multiLineMode === "notes") {
      this.multiLineSelection = new Map();
    }
    this.commitChart(
      t("editor.session.deleteNotes"),
      { ...this.chart, judgeLineList: lines },
      beforeSelection,
      {},
      { normalized: true },
    );
  }

  /** Replaces selected notes with transformed copies in one commit. */
  transformSelection(
    label: string,
    change: (note: JudgeLineNote, entry: SelectedNoteEntry) => JudgeLineNote,
  ): void {
    const entries = this.selectedNoteEntries();
    if (!entries.length) {
      return;
    }
    const lines = [...(this.chart.judgeLineList ?? [])];
    const changes = new Map(
      entries.map((entry) => [`${entry.lineIndex}:${entry.index}`, change(entry.note, entry)]),
    );
    for (const lineIndex of new Set(entries.map((entry) => entry.lineIndex))) {
      const line = lines[lineIndex];
      if (!line) {
        continue;
      }
      const notes = (line.notes ?? []).map(
        (note, index) => changes.get(`${lineIndex}:${index}`) ?? note,
      );
      lines[lineIndex] = { ...line, notes, numOfNotes: countScoringNotes(notes) };
    }
    this.commitChart(
      label,
      { ...this.chart, judgeLineList: lines },
      this.selectionState(),
      {},
      {
        normalized: true,
      },
    );
  }

  /** Switches the active line and restores that line's stored selection. */
  selectLine(index: number): void {
    // Re-selecting the active line preserves the objects already picked.
    if (index !== this.lineIndex) {
      this.lineIndex = index;
      this.selection = new Set(
        this.multiLineActive ? (this.multiLineSelection.get(index) ?? []) : [],
      );
      this.eventSelection = new Set(
        this.multiLineActive ? (this.multiEventSelection.get(index) ?? []) : [],
      );
    } else if (this.multiLineActive) {
      // A repeated multi-line selection restores that line's stored members
      // without leaving a stale set from another panel.
      this.selection = new Set(this.multiLineSelection.get(index) ?? []);
      this.eventSelection = new Set(this.multiEventSelection.get(index) ?? []);
    }
    this.normalizeMultiLine();
    this.notify();
  }

  /** Appends a new default judge line and makes it active. */
  addLine(): void {
    const beforeSelection = this.selectionState();
    this.lineIndex = this.chart.judgeLineList?.length ?? 0;
    this.selection.clear();
    this.eventSelection.clear();
    this.commitChart(
      t("editor.session.addLine"),
      {
        ...this.chart,
        judgeLineList: [...(this.chart.judgeLineList ?? []), createLine()],
      },
      beforeSelection,
    );
  }

  /** Moves one step through history through the mutation gate. */
  travel(direction: "undo" | "redo"): boolean {
    if (this.collaborationActive) {
      // A room has no shared redo branch. Undo must compensate the newest
      // transaction this member actually sent, not move a local stack pointer.
      if (direction === "redo") {
        return false;
      }
      return (
        selectiveUndoLatest(this, t("workspace.history.collaborativeUndo")).status === "committed"
      );
    }
    return (
      this.mutationGate?.run("history", () => this.travelInternal(direction)) ??
      this.travelInternal(direction)
    );
  }

  /** Applies one history move and restores or remaps the selection. */
  private travelInternal(direction: "undo" | "redo"): boolean {
    const command = (direction === "undo" ? this.history.undoStack : this.history.redoStack).at(-1);
    if (!command) {
      return false;
    }
    // A room's authoritative entries belong to their author; undoing one
    // locally is refused because the room applies compensation entries.
    if (
      direction === "undo" &&
      this.collaborationActive &&
      command.origin?.kind === "collaboration-remote"
    ) {
      return false;
    }
    const current = this.selectionState();
    const source = this.chart;
    const from = direction === "undo" ? command.afterSelection : command.beforeSelection;
    const to = direction === "undo" ? command.beforeSelection : command.afterSelection;
    if (!this.history[direction]()) {
      return false;
    }
    restoreSelection(
      this,
      sameSelection(current, from) && to ? to : remapSelection(source, this.chart, current),
    );
    this.lastEditBeatRange = command.beatRange ?? null;
    this.notify();
    return true;
  }

  /** Moves through history to make the selected entry's after-state current. */
  jumpToHistory(id: number): boolean {
    if (!Number.isInteger(id)) {
      return false;
    }
    if (this.collaborationActive) {
      // A room entry is a transaction, not a stack position. Reverting it is a
      // compensation; forward redo has no shared branch.
      return (
        selectiveUndo(this, id, t("workspace.history.collaborativeUndo")).status === "committed"
      );
    }
    if (this.history.undoStack.some((command) => command.id === id)) {
      while (this.history.undoStack.at(-1)?.id !== id) {
        if (!this.travel("undo")) {
          return false;
        }
      }
      return true;
    }
    if (this.history.redoStack.some((command) => command.id === id)) {
      while (this.history.redoStack.at(-1)?.id !== id) {
        if (!this.travel("redo")) {
          return false;
        }
      }
      return this.travel("redo");
    }
    return false;
  }
}
