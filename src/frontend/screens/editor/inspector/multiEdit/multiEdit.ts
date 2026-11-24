/**
 * The multi-edit panel model: opens the batch form, previews a plan against a
 * captured selection, draws its ghost, and commits only the accepted result.
 *
 * Planning and chart mutation stay in `core/edit/multiEdit`; this module owns
 * the form element, the preview lifetime, and the notification text.
 */
/* eslint-disable max-lines -- the panel owns form, preview, and ghost rendering coordination. */
import type { Timeline } from "../../workspace/timeline/surface/timeline.ts";
import { createElement } from "react";
import { flushSync } from "react-dom";
import { NOISE_ACTIVE_EVENTS } from "../../../../../core/edit/events/eventTracks.ts";
import { captureSelection } from "../../../../../core/edit/selection/snapshot.ts";
import type { SelectionSnapshot } from "../../../../../core/edit/selection/snapshot.ts";
import { commitSelectionEdit } from "../../../../../core/edit/selection/edits.ts";
import { previewMultiEdit } from "../../../../../core/edit/multiEdit/plan.ts";
import { previewEventClone } from "../../../../../core/edit/multiEdit/clone.ts";
import { EVENT_BATCH_FIELDS } from "../../../../../core/edit/multiEdit/planVocabulary.ts";
import type {
  BatchChange,
  MultiEditResult,
} from "../../../../../core/edit/multiEdit/planVocabulary.ts";
import { beatValue } from "../../../../../core/global/chart/timing/beat.ts";
import type {
  Chart,
  JudgeLineEvent,
  JudgeLineNote,
} from "../../../../../core/global/chart/chart.ts";
import type { EditorSession } from "../../../../../core/edit/session/session.ts";
import { eventColumnBounds } from "../../../../../core/edit/timeline/timelineCoordinates.ts";
import type { EventChain } from "../../../../../core/edit/timeline/eventChains.ts";
import {
  readCanvasPalette,
  selectionHighlightColor,
  selectionColor,
} from "../../canvas/palette.ts";
import { NOTE_GHOST_FILTER } from "../../canvas/noteGhostVisual.ts";
import { canvasFont } from "../../canvas/text.ts";
import { fitNumericText } from "../../canvas/numericText.ts";
import {
  MultiEditParameters,
  type CloneParameters,
  type MultiEditKind,
} from "../../../../../core/edit/multiEdit/parameters.ts";
import { PREFERENCE_SECTIONS, preferenceStorage } from "../../../../../core/state/preferences.ts";
import { t } from "../../../../../i18n/index.ts";
import type { MultiEditFormValues } from "./MultiEditForm.tsx";
import type { MultiEditMode, MultiEditPaneHandle } from "./MultiEditPane.tsx";
import type { MultiEditState } from "./model.ts";
import type { EditorFeedback } from "../../workspace/runtime/session/feedback.ts";
import { eventColumnForTrack } from "../../workspace/timeline/events/eventColumns.ts";
import { drawEventCurve, eventCurveStroke } from "../../workspace/timeline/events/eventCurve.ts";
import { drawEventSelectionFilter } from "../../workspace/timeline/events/eventSelectionDrawing.ts";
import {
  affectedObjectIds,
  batchPaintLayer,
  ghostEventRanges,
  recipeName,
  selectedEventTypes,
  sourceLineIndex,
} from "./multiEditCommit.ts";

type MultiEditTimeline = Pick<
  Timeline,
  | "notesCanvas"
  | "eventsCanvas"
  | "eventTypes"
  | "eventColumns"
  | "appearance"
  | "cache"
  | "changed"
  | "hiddenEvents"
  | "hiddenNotes"
> & {
  viewport: Pick<
    Timeline["viewport"],
    | "tempo"
    | "origin"
    | "division"
    | "panelWidth"
    | "panelIndex"
    | "panelStride"
    | "multiLineViewportOffset"
    | "verticalForLine"
    | "eventVertical"
    | "vertical"
    | "noteWidth"
    | "clampNoteHorizontal"
    | "noteHorizontal"
    | "eventInset"
    | "eventBarWidth"
  >;
};

/** Batch-edit panel model for the inspector. */
export class MultiEditPanel {
  readonly state: MultiEditState;
  getSession: () => EditorSession;
  timeline: MultiEditTimeline;
  invalidate: () => void;
  notify: EditorFeedback["notify"];
  active: boolean;
  parameters: MultiEditParameters;
  /** `open()` always writes the real value; the initializer keeps the field typed. */
  kind: MultiEditKind = "notes";
  seed?: number;
  result: MultiEditResult | null = null;
  signature?: string | null;
  chart?: Chart;
  committing?: boolean;
  private noiseActivationSelected = false;
  previewEnabled?: { checked: boolean };
  form?: MultiEditPaneHandle;
  formModule?: Promise<typeof import("./MultiEditPane.tsx")>;
  /** Retains the paint order for an unchanged batch result. */
  private ghostChanges?: { result: MultiEditResult; changes: readonly BatchChange[] };
  /** Chain ranges for the result chart, including its unchanged events. */
  private ghostRanges?: {
    result: MultiEditResult;
    ranges: Map<BatchChange, EventChain<JudgeLineEvent> | null>;
  };
  /** Source events a clone preview removes; hidden only while its ghost is on. */
  private hiddenSourceEvents?: ReadonlySet<JudgeLineEvent>;
  /** Source notes replaced by an edit preview; hidden only while its ghost is on. */
  private hiddenSourceNotes?: ReadonlySet<JudgeLineNote>;
  /** Keeps selected events and their selection identity across a layer switch. */
  private selectionSnapshot?: SelectionSnapshot;
  private selectionSnapshotSignature?: string;
  private selectionSnapshotRevision?: number;
  /** These closures are assigned inside `open()` before any caller invokes them. */
  updateHistory?: (event?: Event) => void;
  load?: (
    value: MultiEditFormValues | Partial<CloneParameters>,
    options?: { preserveCurrent?: boolean },
  ) => void;
  read?: () => MultiEditFormValues | CloneParameters;

  /** Binds the panel to the live session, timeline, and host callbacks. */
  constructor(
    getSession: () => EditorSession,
    timeline: MultiEditTimeline,
    {
      invalidate,
      notify,
      state,
      scrollInspectorToTop,
    }: {
      invalidate: () => void;
      notify: EditorFeedback["notify"];
      state: MultiEditState;
      scrollInspectorToTop: () => void;
    },
  ) {
    this.getSession = getSession;
    this.state = state;
    this.timeline = timeline;
    this.invalidate = invalidate;
    this.notify = notify;
    this.scrollInspectorToTop = scrollInspectorToTop;
    this.active = false;
    this.parameters = new MultiEditParameters(
      preferenceStorage(PREFERENCE_SECTIONS.multiEdit),
      (message: string) => notify(message, "warning"),
    );
  }

  /** Drops the cached batch selection and its revision marker. */
  private clearSelectionSnapshot(): void {
    this.selectionSnapshot = this.selectionSnapshotSignature = undefined;
    this.selectionSnapshotRevision = undefined;
  }

  /** Opens the form for notes or events and installs its live bindings. */
  open(kind: MultiEditKind): void {
    if (this.active && this.kind === kind) {
      this.sync();
      return;
    }
    this.active = true;
    this.kind = kind;
    this.seed = 1;
    this.result = null;
    this.ghostChanges = undefined;
    this.ghostRanges = undefined;
    this.hiddenSourceEvents = undefined;
    this.hiddenSourceNotes = undefined;
    this.timeline.hiddenEvents = undefined;
    this.timeline.hiddenNotes = undefined;
    this.clearSelectionSnapshot();
    this.signature = null;
    const editFallback = (): MultiEditFormValues => ({
      mode: "edit",
      ...this.parameters.read(kind),
      eventApplicationMode: "per-line",
      eventType: selectedEventTypes(this.getSession())[0] ?? "",
    });
    this.updateHistory = () => this.renderForm(kind);
    this.read = () => this.form?.read() ?? editFallback();
    this.load = (
      value: MultiEditFormValues | Partial<CloneParameters>,
      options?: { preserveCurrent?: boolean },
    ) => {
      if ((value as Partial<CloneParameters>).mode === "clone") {
        const incoming = value as Partial<CloneParameters>;
        const base = this.parameters.readClone(String(this.getSession().lineIndex));
        const clone: CloneParameters = {
          ...base,
          ...incoming,
          mode: "clone",
          channels: { ...base.channels, ...(incoming.channels ?? {}) },
        };
        this.form?.load(clone, options);
        this.parameters.updateClone(clone);
        this.refresh(clone);
        return;
      }
      // Load over what the form shows now: a history entry carries only the batch
      // parameters, so the multi-line application mode must survive the load.
      const shown = this.read?.();
      const current: MultiEditFormValues = shown && shown.mode === "edit" ? shown : editFallback();
      const next = {
        ...current,
        ...(value as Partial<MultiEditFormValues>),
        mode: "edit" as const,
      };
      if (kind === "events" && !EVENT_BATCH_FIELDS.some(([key]) => key === next.field)) {
        next.field = "both";
      }
      if (this.noiseActivationSelected && !["t1", "t2"].includes(next.field)) {
        next.field = "t1";
      }
      this.seed = next.seed ?? this.seed;
      this.form?.load(next, options);
      this.parameters.update(kind, next);
      this.refresh(next);
    };
    this.renderForm(kind);
    this.scrollInspectorToTop();
  }

  /** Loads the pane module and publishes a fresh form element. */
  renderForm(kind: MultiEditKind): void {
    this.formModule ??= import("./MultiEditPane.tsx");
    void this.formModule.then(({ MultiEditPane }) => {
      if (!this.active || this.kind !== kind) {
        return;
      }
      const session = this.getSession();
      const noiseActivation =
        kind === "events" &&
        captureSelection(session).events.some((entry) => entry.type === NOISE_ACTIVE_EVENTS);
      const eventTypes = kind === "events" ? selectedEventTypes(session) : [];
      this.noiseActivationSelected = noiseActivation;
      const view = createElement(MultiEditPane, {
        key: `${kind}:${noiseActivation}`,
        kind,
        noiseActivation,
        eventTypes,
        multiEventEdit:
          kind === "events" && session.multiLineActive && session.multiLineMode === "events",
        editHistory: this.parameters.history[kind],
        cloneHistory: this.parameters.cloneHistory,
        cloneValues: this.parameters.readClone(String(session.lineIndex)),
        defaultCloneTargets: String(session.lineIndex),
        onReady: (form) => {
          this.form = form;
          this.previewEnabled = {
            get checked() {
              return form.isPreviewEnabled();
            },
          };
        },
        onChange: (value) => {
          if (value.mode === "clone") {
            this.parameters.updateClone(value);
            if (this.form?.read().mode === "clone") {
              this.refresh(value);
            }
            return;
          }
          this.parameters.update(kind, value);
          if (this.form?.read().mode !== "clone") {
            this.refresh(value);
          }
        },
        onHistory: (index, mode: MultiEditMode) => {
          const entries =
            mode === "clone" ? this.parameters.cloneHistory : this.parameters.history[kind];
          if (entries.length) {
            const position = (index + entries.length) % entries.length;
            this.form?.selectHistory(String(position));
            this.load?.(entries[position], { preserveCurrent: true });
          }
        },
        onApply: () => {
          this.refresh();
          if (!this.result) {
            return;
          }
          const result = this.result;
          const amount = result.changes.length;
          this.committing = true;
          try {
            const session = this.getSession();
            const visibleEventLayer = session.eventLayer;
            const commitResult =
              result.eventLayer === visibleEventLayer
                ? result
                : { ...result, eventLayer: visibleEventLayer };
            const values =
              this.read?.() ??
              ({
                mode: "edit",
                ...this.parameters.read(kind),
                eventApplicationMode: "per-line",
                eventType: selectedEventTypes(session)[0] ?? "",
              } satisfies MultiEditFormValues);
            const isClone = values.mode === "clone";
            const name = recipeName(values);
            commitSelectionEdit(
              session,
              commitResult,
              name,
              {
                affectedObjectIds: affectedObjectIds(session, result),
                recipe: {
                  id: isClone ? "builtin.multi-edit.clone" : `builtin.multi-edit.${kind}`,
                  name,
                  version: 1,
                  params: structuredClone(values),
                },
              },
              { normalized: true },
            );
            if (result.eventLayer !== visibleEventLayer) {
              // The retained selection belongs to the edited layer, while the
              // active timeline still shows the layer the user switched to.
              session.eventSelection.clear();
              session.notify();
            }
            if (isClone) {
              this.parameters.rememberClone(values);
            } else {
              this.parameters.remember(kind, values);
            }
            this.updateHistory?.();
            this.form?.selectHistory("");
            this.result = null;
            this.ghostChanges = undefined;
            this.ghostRanges = undefined;
            this.clearSelectionSnapshot();
            this.chart = this.getSession().chart;
            this.signature = this.selectionSignature();
            this.form?.setResult("", false);
            this.form?.setReady?.(false);
            this.form?.setWarning?.("");
            const lineCount = new Set(result.changes.map((change) => change.lineIndex)).size;
            this.notify(
              isClone
                ? t("editorPanels.multiEdit.clone.appliedNotify", {
                    count: amount,
                    lines: lineCount,
                  })
                : t("editorPanels.multiEdit.appliedNotify", { count: amount }),
              "success",
            );
            this.invalidate();
          } catch (error) {
            this.notify(error instanceof Error ? error.message : String(error), "error");
          } finally {
            this.committing = false;
          }
        },
        onModeChange: () => {
          // A mode switch changes which form `read()` returns; drop the old
          // proposal and rebuild the ghost and readiness for the new face.
          this.result = null;
          this.ghostChanges = undefined;
          this.ghostRanges = undefined;
          this.clearSelectionSnapshot();
          this.refresh();
        },
      });
      flushSync(() =>
        this.state.set({
          view,
        }),
      );
      if (this.signature === null) {
        this.load?.(this.parameters.read(kind));
        this.sync();
      }
    });
  }
  /** Deactivates the panel and drops its preview. */
  hide(): void {
    this.active = false;
    this.result = null;
    this.ghostChanges = undefined;
    this.ghostRanges = undefined;
    this.hiddenSourceEvents = undefined;
    this.hiddenSourceNotes = undefined;
    this.timeline.hiddenEvents = undefined;
    this.timeline.hiddenNotes = undefined;
    this.clearSelectionSnapshot();
    this.invalidate();
  }

  /** Clears chart-local batch history when the document session is replaced. */
  resetForDocument(): void {
    this.parameters.clearHistory();
    this.form?.selectHistory("");
    this.result = null;
    this.clearSelectionSnapshot();
    this.form?.setReady?.(false);
    this.form?.setWarning?.("");
    this.updateHistory?.();
    this.invalidate();
  }

  /** Drop a stale inspector proposal after another editor command owns the chart. */
  clearPreview(): void {
    this.result = null;
    this.ghostChanges = undefined;
    this.ghostRanges = undefined;
    this.hiddenSourceEvents = undefined;
    this.hiddenSourceNotes = undefined;
    this.timeline.hiddenEvents = undefined;
    this.timeline.hiddenNotes = undefined;
    this.clearSelectionSnapshot();
    this.chart = this.getSession().chart;
    this.signature = this.selectionSignature();
    this.form?.setResult("", false);
    this.form?.setReady?.(false);
    this.form?.setWarning?.("");
    this.invalidate();
  }

  /** Releases the form and clears the published snapshot. */
  dispose(): void {
    this.active = false;
    this.form = undefined;
    this.previewEnabled = undefined;
    this.hiddenSourceEvents = undefined;
    this.hiddenSourceNotes = undefined;
    this.timeline.hiddenEvents = undefined;
    this.timeline.hiddenNotes = undefined;
    flushSync(() => this.state.set(null));
  }

  /** Host callback that brings the pane back into view when it opens. */
  private readonly scrollInspectorToTop: () => void;

  /** Rebuilds the preview when the chart, selection, or target changes. */
  sync(): void {
    if (!this.active || this.committing) {
      return;
    }
    const session = this.getSession();
    const noiseActivation =
      this.kind === "events" &&
      captureSelection(session).events.some((entry) => entry.type === NOISE_ACTIVE_EVENTS);
    if (noiseActivation !== this.noiseActivationSelected) {
      this.noiseActivationSelected = noiseActivation;
      this.signature = null;
      this.renderForm(this.kind);
      return;
    }
    const signature = this.selectionSignature();
    if (session.chart === this.chart && signature === this.signature) {
      return;
    }
    if (this.kind === "events") {
      this.form?.setEventTypes(selectedEventTypes(session));
    }
    this.chart = session.chart;
    this.signature = signature;
    this.refresh();
  }

  /** Compact key of the current line, division, and selection membership. */
  selectionSignature(): string {
    const session = this.getSession();
    const currentEventSelection =
      session.multiLineActive && session.multiLineMode === "events"
        ? []
        : [...session.eventSelection];
    const multiEvents = [...(session.multiEventSelection ?? new Map())]
      .map(([line, values]) => `${line}:${[...values].sort().join(",")}`)
      .sort()
      .join("|");
    return `${session.lineIndex}:${this.timeline.viewport.division}:${[...session.selection]}:${currentEventSelection}:${multiEvents}`;
  }

  /** Recomputes the active preview and reports any error to the form. */
  refresh(values?: MultiEditFormValues | CloneParameters): void {
    this.result = null;
    this.ghostChanges = undefined;
    this.ghostRanges = undefined;
    this.hiddenSourceEvents = undefined;
    this.hiddenSourceNotes = undefined;
    let message = "";
    let isError = false;
    try {
      const session = this.getSession();
      const selectionSignature = this.selectionSignature();
      const liveSnapshot = captureSelection(session);
      const previousSnapshot = this.selectionSnapshot;
      const selectionWasClearedByLayerSwitch =
        this.kind === "events" &&
        previousSnapshot?.chart === session.chart &&
        previousSnapshot.lineIndex === session.lineIndex &&
        previousSnapshot.eventLayer !== session.eventLayer &&
        previousSnapshot.events.length > 0 &&
        liveSnapshot.events.length === 0 &&
        this.selectionSnapshotRevision === session.selectionRevision;
      const snapshot =
        this.kind === "events" &&
        previousSnapshot &&
        previousSnapshot.chart === session.chart &&
        this.selectionSnapshotRevision === session.selectionRevision &&
        (this.selectionSnapshotSignature === selectionSignature ||
          selectionWasClearedByLayerSwitch) &&
        previousSnapshot.eventLayer !== session.eventLayer
          ? previousSnapshot
          : liveSnapshot;
      if (snapshot.notes.length || snapshot.events.length) {
        this.selectionSnapshot = snapshot;
        this.selectionSnapshotSignature = selectionSignature;
        this.selectionSnapshotRevision = session.selectionRevision;
      } else {
        this.clearSelectionSnapshot();
      }
      const options =
        values ??
        this.read?.() ??
        ({
          mode: "edit",
          ...this.parameters.read(this.kind),
          eventApplicationMode: "per-line",
          eventType: selectedEventTypes(session)[0] ?? "",
        } satisfies MultiEditFormValues);
      if (this.kind === "events" && options.mode === "clone") {
        const preview = previewEventClone(snapshot, options, this.timeline.viewport.division);
        this.result = preview.result;
        // Without keep-source the result drops the selection; the ghost alone
        // shows the copies, so the real source bars must leave the canvas.
        this.hiddenSourceEvents =
          options.retainSource === false
            ? new Set(snapshot.events.map((entry) => entry.event))
            : undefined;
        this.form?.setReady?.(true);
        this.form?.setWarning?.(
          options.retainSource && preview.overlapsSource
            ? t("editorPanels.multiEdit.clone.overlapWarning")
            : "",
        );
      } else {
        this.result = previewMultiEdit(snapshot, this.kind, options as MultiEditFormValues);
        const changedSources = this.result.changes.filter(
          (change) =>
            !change.copy && JSON.stringify(change.before) !== JSON.stringify(change.after),
        );
        if (this.kind === "notes") {
          this.hiddenSourceNotes = new Set(
            changedSources.map((change) => change.before as JudgeLineNote),
          );
        } else {
          this.hiddenSourceEvents = new Set(
            changedSources.map((change) => change.before as JudgeLineEvent),
          );
        }
        this.form?.setReady?.(false);
        this.form?.setWarning?.("");
      }
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
      isError = true;
      this.form?.setReady?.(false);
      this.form?.setWarning?.("");
    }
    this.form?.setResult(message, isError);
    const previewOn = this.form?.isPreviewEnabled() ?? this.previewEnabled?.checked ?? false;
    this.syncHiddenEvents(previewOn ? this.hiddenSourceEvents : undefined, false);
    this.syncHiddenNotes(previewOn ? this.hiddenSourceNotes : undefined, false);
    // Every clone draft change, including the preview and keep-source switches,
    // repaints the timeline with the same proposal the form now shows.
    this.timeline.changed?.();
    this.invalidate();
  }

  /**
   * The edit this panel would commit right now, or null when the preview is off
   * or there is nothing to preview.
   *
   * The result is a transient timeline render input; the live chart remains the
   * only commit, playback, and realtime-preview source.
   */
  previewResult(): MultiEditResult | null {
    if (
      !this.active ||
      !this.result ||
      !(this.form?.isPreviewEnabled() ?? this.previewEnabled?.checked)
    ) {
      return null;
    }
    return this.result;
  }

  /** Hand the removed-source set to the timeline, redrawing only when it changes. */
  private syncHiddenEvents(hidden: ReadonlySet<JudgeLineEvent> | undefined, redraw = true): void {
    if (this.timeline.hiddenEvents === hidden) {
      return;
    }
    this.timeline.hiddenEvents = hidden;
    this.timeline.changed?.();
    if (redraw) {
      this.invalidate();
    }
  }

  /** Hand the replaced-note set to the timeline, redrawing only when it changes. */
  private syncHiddenNotes(hidden: ReadonlySet<JudgeLineNote> | undefined, redraw = true): void {
    if (this.timeline.hiddenNotes === hidden) {
      return;
    }
    this.timeline.hiddenNotes = hidden;
    this.timeline.changed?.();
    if (redraw) {
      this.invalidate();
    }
  }

  /**
   * Resolve every preview change against the result chart's own event chains.
   *
   * The chain min/max must include the unchanged events too, or a ghost curve
   * spans only its own start/end and stops matching its neighbours.
   */
  private eventRanges(
    result: MultiEditResult,
  ): Map<BatchChange, EventChain<JudgeLineEvent> | null> {
    if (this.ghostRanges?.result === result) {
      return this.ghostRanges.ranges;
    }
    const ranges = ghostEventRanges(result, this.timeline.cache);
    this.ghostRanges = { result, ranges };
    return ranges;
  }

  /** Draws the preview batch's before/after ghosts on the timeline canvas. */
  drawTimeline(): void {
    const result = this.previewResult();
    this.syncHiddenEvents(result ? this.hiddenSourceEvents : undefined);
    this.syncHiddenNotes(result ? this.hiddenSourceNotes : undefined);
    if (!result) {
      return;
    }
    const timeline = this.timeline;
    const session = this.getSession();
    const canvas = this.kind === "notes" ? timeline.notesCanvas : timeline.eventsCanvas;
    if (!canvas.clientWidth) {
      return;
    }
    const context = canvas.getContext("2d") as CanvasRenderingContext2D;
    const palette = readCanvasPalette();
    context.save();
    context.beginPath();
    context.rect(0, this.kind === "events" ? 23 : 0, canvas.clientWidth, canvas.clientHeight);
    context.clip();
    const multiArea = session.multiLineActive && session.multiLineMode === this.kind;
    const visibleLines = multiArea ? new Set(session.targetLineIndices) : null;
    const visibleInView = (lineIndex: number) =>
      multiArea ? visibleLines?.has(lineIndex) === true : lineIndex === session.lineIndex;
    // Ghosts follow the real note paint order, so a ghost Hold body stays
    // beneath the ghost heads it would otherwise cover.
    let changes: readonly BatchChange[] = result.changes;
    if (this.kind === "notes") {
      if (this.ghostChanges?.result !== result) {
        this.ghostChanges = {
          result,
          changes: [...result.changes].sort(
            (left, right) => batchPaintLayer(left) - batchPaintLayer(right),
          ),
        };
      }
      changes = this.ghostChanges.changes;
    }
    const eventRanges = this.kind === "events" ? this.eventRanges(result) : null;
    for (const change of changes) {
      const item = change.after;
      const lineIndex = Number.isInteger(change.lineIndex) ? change.lineIndex : session.lineIndex;
      // A clone can target lines the current view does not show; painting those
      // onto the single-line canvas would put every copy on the active line.
      if (!visibleInView(lineIndex)) {
        continue;
      }
      const width = canvas.clientWidth;
      const panelWidth = multiArea ? timeline.viewport.panelWidth(width, this.kind) : width;
      const panelOffset = multiArea
        ? timeline.viewport.panelIndex(lineIndex, this.kind) *
            timeline.viewport.panelStride(width, this.kind) -
          timeline.viewport.multiLineViewportOffset(width, this.kind)
        : 0;
      const vertical = (beat: number) =>
        multiArea
          ? timeline.viewport.verticalForLine(beat, lineIndex, canvas.clientHeight)
          : change.type === "paintEvents"
            ? timeline.viewport.eventVertical(beat, change.type)
            : timeline.viewport.vertical(beat);
      const top = vertical(beatValue(item.endTime));
      const bottom = vertical(beatValue(item.startTime));
      if (top > canvas.clientHeight || bottom < 0) {
        continue;
      }
      if (this.kind === "notes") {
        // A batch operation can produce a result without moving or resizing a
        // note (the default is X + 0). Painting that ghost on top of the real
        // note changes its colour, even though there is nothing to preview.
        if (
          sourceLineIndex(session, change.before) === change.lineIndex &&
          change.before.positionX === item.positionX &&
          (change.before.size ?? 1) === (item.size ?? 1) &&
          change.before.type === item.type &&
          beatValue(change.before.startTime) === beatValue(item.startTime) &&
          beatValue(change.before.endTime) === beatValue(item.endTime)
        ) {
          continue;
        }
        const note = {
          ...item,
          type: typeof item.type === "number" ? item.type : 1,
          positionX: typeof item.positionX === "number" ? item.positionX : 0,
        };
        const noteWidth = timeline.viewport.noteWidth(note);
        const horizontal = timeline.viewport.clampNoteHorizontal(
          timeline.viewport.noteHorizontal(note.positionX, lineIndex),
          noteWidth,
          canvas.clientWidth,
          lineIndex,
        );
        if (horizontal != null) {
          context.save();
          context.globalAlpha = 0.5;
          context.filter = NOTE_GHOST_FILTER;
          const selectedNoteColor = selectionHighlightColor(palette);
          const selectedNoteColorStyle = { mode: "selected" as const, color: selectedNoteColor };
          const skin = timeline.appearance.skin;
          if (note.type === 2) {
            skin?.hold(
              context,
              horizontal,
              bottom,
              top,
              noteWidth,
              false,
              true,
              selectedNoteColorStyle,
            );
          } else {
            skin?.head(
              context,
              note.type,
              horizontal,
              bottom,
              noteWidth,
              false,
              selectedNoteColorStyle,
            );
          }
          context.restore();
        }
      } else {
        const columns = timeline.eventColumns;
        const column = eventColumnForTrack(columns, change.type);
        if (column < 0) {
          continue;
        }
        const columnBounds = eventColumnBounds(
          column,
          panelWidth,
          columns.length,
          timeline.viewport.eventBarWidth ?? 0.82,
          timeline.viewport.eventInset(panelWidth),
        );
        const bounds = {
          x: panelOffset + columnBounds.x,
          width: columnBounds.width,
        };
        context.save();
        context.beginPath();
        context.rect(bounds.x, 23, bounds.width, canvas.clientHeight);
        context.clip();
        const ghostHeight = Math.max(2, bottom - top);
        context.globalAlpha = 0.5;
        context.filter = NOTE_GHOST_FILTER;
        timeline.appearance.skin?.eventBar(
          context,
          bounds.x + bounds.width / 2,
          top + ghostHeight / 2,
          bounds.width,
          ghostHeight,
        );
        context.filter = "none";
        drawEventSelectionFilter(
          context,
          { x: bounds.x, y: top, width: bounds.width, height: ghostHeight },
          selectionColor("selected-event-color", "#00C800"),
        );
        context.globalAlpha = 1;
        // The skin bar alone does not communicate the eased result; reuse the
        // timeline's own event curve so the ghost keeps the same easing symbol.
        // Its chain range comes from the result chart, so unchanged neighbours
        // and their values pull the curve into the same min/max.
        const startValue = typeof item.start === "number" ? item.start : Number.NaN;
        const endValue = typeof item.end === "number" ? item.end : Number.NaN;
        if (Number.isFinite(startValue) && Number.isFinite(endValue)) {
          const range = eventRanges?.get(change) ?? {
            entries: [],
            min: Math.min(startValue, endValue),
            max: Math.max(startValue, endValue),
          };
          context.save();
          context.globalAlpha = 0.75;
          context.filter = NOTE_GHOST_FILTER;
          context.strokeStyle = eventCurveStroke(palette, true);
          drawEventCurve(
            context,
            item as unknown as JudgeLineEvent,
            range,
            { x: bounds.x, y: 23, width: bounds.width, height: canvas.clientHeight - 23 },
            bottom,
            top,
            { steps: 24, padding: 4, lineWidth: 1.5 },
          );
          context.restore();
        }
        context.font = canvasFont("caption");
        context.textAlign = "center";
        const format = (value: unknown) =>
          typeof value === "number" && Number.isFinite(value)
            ? Number(value.toFixed(3)).toString()
            : Array.isArray(value)
              ? value.join(",")
              : String(value ?? "");
        if (bottom - top > 24) {
          context.fillStyle = palette.foreground;
          const labels: readonly [unknown, number][] = [
            [item.end ?? item.shader, Math.max(36, top + 13)],
            [item.start ?? item.shader, Math.min(canvas.clientHeight - 5, bottom - 4)],
          ];
          for (const [value, position] of labels) {
            const text = fitNumericText(
              format(value),
              bounds.width - 8,
              (candidate) => context.measureText(candidate).width,
            );
            context.fillText(text, bounds.x + bounds.width / 2, position);
          }
        }
        context.restore();
      }
    }
    context.restore();
  }
}
