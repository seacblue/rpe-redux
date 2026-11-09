/**
 * The multi-edit panel model: opens the batch form, previews a plan against a
 * captured selection, draws its ghost, and commits only the accepted result.
 *
 * Planning and chart mutation stay in `core/edit/multiEdit`; this module owns
 * the form element, the preview lifetime, and the notification text.
 */
import type { Timeline } from "../../workspace/timeline/surface/timeline.ts";
import { createElement } from "react";
import { flushSync } from "react-dom";
import { NOISE_ACTIVE_EVENTS } from "../../../../../core/edit/events/eventTracks.ts";
import { captureSelection } from "../../../../../core/edit/selection/snapshot.ts";
import { commitSelectionEdit } from "../../../../../core/edit/selection/edits.ts";
import { previewMultiEdit } from "../../../../../core/edit/multiEdit/plan.ts";
import type { MultiEditResult } from "../../../../../core/edit/multiEdit/planVocabulary.ts";
import { beatValue } from "../../../../../core/global/chart/timing/beat.ts";
import type { Chart } from "../../../../../core/global/chart/chart.ts";
import { normalizeChartObjectIds } from "../../../../../core/global/chart/chart.ts";
import { isChartObjectId, type ChartObjectId } from "../../../../../core/global/chart/identity.ts";
import type { EditorSession } from "../../../../../core/edit/session/session.ts";
import { eventColumnBounds } from "../../../../../core/edit/timeline/timelineCoordinates.ts";
import { noteColor, readCanvasPalette } from "../../canvas/palette.ts";
import { canvasFont } from "../../canvas/text.ts";
import {
  MultiEditParameters,
  type MultiEditKind,
} from "../../../../../core/edit/multiEdit/parameters.ts";
import { PREFERENCE_SECTIONS, preferenceStorage } from "../../../../../core/state/preferences.ts";
import { t } from "../../../../../i18n/index.ts";
import type {
  MultiEditFormHandle,
  MultiEditFormModule,
  MultiEditFormValues,
} from "./MultiEditForm.tsx";
import type { MultiEditState } from "./model.ts";
import type { EditorFeedback } from "../../workspace/runtime/session/feedback.ts";
import { drawEventGhost } from "./eventGhostDrawing.ts";
import { eventColumnForTrack } from "../../workspace/timeline/events/eventColumns.ts";

const OPERATION_LABELS: Readonly<Record<string, string>> = {
  By: "editor.commands.multiEdit.operation.by",
  To: "editor.commands.multiEdit.operation.to",
  Times: "editor.commands.multiEdit.operation.times",
  Max: "editor.commands.multiEdit.operation.max",
  Min: "editor.commands.multiEdit.operation.min",
  Flip: "editor.commands.multiEdit.operation.flip",
};

/** Localized recipe name for the current operation. */
function recipeName(values: Pick<MultiEditFormValues, "operation">): string {
  return OPERATION_LABELS[values.operation] ?? "editor.commands.multiEdit.error.unknownOperation";
}

/** Compares two batch items by their serialized form. */
function sameBatchItem(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/** Finds the chart line that currently owns a note or event object. */
function sourceLineIndex(session: EditorSession, item: object): number | undefined {
  const index = (session.chart.judgeLineList ?? []).findIndex((line) => {
    if ((line.notes ?? []).some((note) => note === item)) {
      return true;
    }
    return [...(line.eventLayers ?? []), line.extended].some((layer) =>
      Object.values(layer ?? {}).some(
        (events) => Array.isArray(events) && events.some((event) => event === item),
      ),
    );
  });
  return index >= 0 ? index : undefined;
}

/** Collects ids of objects the batch actually changes, copies, or moves. */
function affectedObjectIds(session: EditorSession, result: MultiEditResult): ChartObjectId[] {
  normalizeChartObjectIds(result.chart);
  const ids = new Set<ChartObjectId>();
  for (const change of result.changes) {
    const id = change.after.id;
    if (!isChartObjectId(id)) {
      continue;
    }
    const moved = sourceLineIndex(session, change.before) !== change.lineIndex;
    if (change.copy || moved || !sameBatchItem(change.before, change.after)) {
      ids.add(id);
    }
  }
  return [...ids];
}

type MultiEditTimeline = Pick<
  Timeline,
  "notesCanvas" | "eventsCanvas" | "eventTypes" | "eventColumns" | "appearance"
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
  cache: Pick<Timeline["cache"], "eventRange">;
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
  form?: MultiEditFormHandle;
  formModule?: Promise<MultiEditFormModule>;
  /** These closures are assigned inside `open()` before any caller invokes them. */
  updateHistory?: (event?: Event) => void;
  load?: (value: Partial<MultiEditFormValues>) => void;
  read?: () => MultiEditFormValues;

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
    this.signature = null;
    this.updateHistory = () => this.renderForm(kind);
    this.read = () =>
      this.form?.read() ?? { ...this.parameters.read(kind), eventApplicationMode: "per-line" };
    this.load = (value: Partial<MultiEditFormValues>) => {
      // Load over what the form shows now: a history entry carries only the batch
      // parameters, so the multi-line application mode must survive the load.
      const current = this.read?.() ?? {
        ...this.parameters.read(kind),
        eventApplicationMode: "per-line",
      };
      const next = { ...current, ...value };
      if (this.noiseActivationSelected && !["t1", "t2", "duration"].includes(next.field)) {
        next.field = "t1";
      }
      this.seed = next.seed ?? this.seed;
      this.form?.load(next);
      this.parameters.update(kind, next);
      this.refresh(next);
    };
    this.renderForm(kind);
    this.scrollInspectorToTop();
  }

  /** Loads the form module and publishes a fresh form element. */
  renderForm(kind: MultiEditKind): void {
    this.formModule ??= import("./MultiEditForm.tsx");
    void this.formModule.then(({ MultiEditForm }) => {
      if (!this.active || this.kind !== kind) {
        return;
      }
      const session = this.getSession();
      const noiseActivation =
        kind === "events" &&
        captureSelection(session).events.some((entry) => entry.type === NOISE_ACTIVE_EVENTS);
      this.noiseActivationSelected = noiseActivation;
      const view = createElement(MultiEditForm, {
        key: `${kind}:${noiseActivation}`,
        kind,
        noiseActivation,
        multiEventEdit:
          kind === "events" && session.multiLineActive && session.multiLineMode === "events",
        history: this.parameters.history[kind],
        onReady: (form) => {
          this.form = form;
          this.previewEnabled = {
            get checked() {
              return form.isPreviewEnabled();
            },
          };
        },
        onChange: (value) => {
          this.parameters.update(kind, value);
          this.refresh(value);
        },
        onHistory: (index) => {
          const entries = this.parameters.history[kind];
          if (entries.length) {
            const position = (index + entries.length) % entries.length;
            this.form?.selectHistory(String(position));
            this.load?.(entries[position]);
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
            const values = this.read?.() ?? this.parameters.read(kind);
            const name = recipeName(values);
            commitSelectionEdit(
              this.getSession(),
              result,
              name,
              {
                affectedObjectIds: affectedObjectIds(this.getSession(), result),
                recipe: {
                  id: `builtin.multi-edit.${kind}`,
                  name,
                  version: 1,
                  params: structuredClone(values),
                },
              },
              { normalized: true },
            );
            const position = this.parameters.remember(kind, values);
            this.updateHistory?.();
            this.form?.selectHistory(String(position));
            this.result = null;
            this.chart = this.getSession().chart;
            this.signature = this.selectionSignature();
            this.form?.setResult("", false, false);
            this.notify(t("editorPanels.multiEdit.appliedNotify", { count: amount }), "success");
            this.invalidate();
          } catch (error) {
            this.notify(error instanceof Error ? error.message : String(error), "error");
          } finally {
            this.committing = false;
          }
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
    this.invalidate();
  }

  /** Drop a stale inspector proposal after another editor command owns the chart. */
  clearPreview(): void {
    this.result = null;
    this.chart = this.getSession().chart;
    this.signature = this.selectionSignature();
    this.form?.setResult("", false, false);
    this.invalidate();
  }

  /** Releases the form and clears the published snapshot. */
  dispose(): void {
    this.active = false;
    this.form = undefined;
    this.previewEnabled = undefined;
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
    this.chart = session.chart;
    this.signature = signature;
    this.refresh();
  }

  /** Compact key of the current line, layer, division, and selection. */
  selectionSignature(): string {
    const session = this.getSession();
    const multiEvents = [...(session.multiEventSelection ?? new Map())]
      .map(([line, values]) => `${line}:${[...values].sort().join(",")}`)
      .sort()
      .join("|");
    return `${session.lineIndex}:${session.eventLayer}:${this.timeline.viewport.division}:${[...session.selection]}:${[...session.eventSelection]}:${multiEvents}`;
  }

  /** Recomputes the batch preview and reports errors to the form. */
  refresh(values?: Partial<MultiEditFormValues>): void {
    this.result = null;
    let summary: string;
    let isError = false;
    try {
      const snapshot = captureSelection(this.getSession());
      const options = values ?? this.read?.() ?? this.parameters.read(this.kind);
      this.result = previewMultiEdit(snapshot, this.kind, options);
      // The ghost overlay carries the affected count; the form keeps its status empty.
      summary = "";
    } catch (error) {
      summary = error instanceof Error ? error.message : String(error);
      isError = true;
    }
    this.form?.setResult(summary, isError, Boolean(this.result));
    this.invalidate();
  }

  /**
   * The edit this panel would commit right now, or null when the preview is off
   * or there is nothing to preview.
   *
   * One gate, two consumers: `drawTimeline` draws these changes onto the timeline canvas and
   * `previewChart` hands the chart to the realtime preview. Keeping the conditions here
   * guarantees both surfaces show the same proposal.
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

  /** The chart `previewResult()` proposes, or null when nothing is being previewed. */
  previewChart(): Chart | null {
    return this.previewResult()?.chart ?? null;
  }

  /** Draws the preview batch's before/after ghosts on the timeline canvas. */
  drawTimeline(): void {
    const result = this.previewResult();
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
    context.setLineDash([5, 3]);
    context.lineWidth = 2;
    context.beginPath();
    context.rect(0, this.kind === "events" ? 23 : 0, canvas.clientWidth, canvas.clientHeight);
    context.clip();
    const ranges = new Map<string, [number, number]>();
    if (this.kind === "events") {
      for (const change of result.changes) {
        const rangeKey = `${change.lineIndex}:${change.type}`;
        const range = ranges.get(rangeKey) ?? [Infinity, -Infinity];
        const chain =
          change.lineIndex === session.lineIndex
            ? timeline.cache.eventRange(
                eventColumnForTrack(timeline.eventColumns, change.type),
                change.index,
              )
            : null;
        if (chain && Number.isFinite(chain.min) && Number.isFinite(chain.max)) {
          range[0] = Math.min(range[0], chain.min);
          range[1] = Math.max(range[1], chain.max);
        }
        for (const item of [change.before, change.after]) {
          if (
            typeof item.start === "number" &&
            typeof item.end === "number" &&
            Number.isFinite(item.start) &&
            Number.isFinite(item.end)
          ) {
            range[0] = Math.min(range[0], item.start, item.end);
            range[1] = Math.max(range[1], item.start, item.end);
          }
        }
        ranges.set(rangeKey, range);
      }
    }
    for (const change of result.changes) {
      const item = change.after;
      const lineIndex = Number.isInteger(change.lineIndex) ? change.lineIndex : session.lineIndex;
      const multiArea = session.multiLineActive && session.multiLineMode === this.kind;
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
          const color = Array.isArray(item.tint)
            ? item.tint
            : Array.isArray(item.color)
              ? item.color
              : undefined;
          const noteColorStyle = color ? { mode: "tint" as const, color } : undefined;
          const skin = timeline.appearance.skin;
          const painted =
            note.type === 2
              ? skin?.hold(context, horizontal, bottom, top, noteWidth, false, true, noteColorStyle)
              : skin?.head(
                  context,
                  note.type,
                  horizontal,
                  bottom,
                  noteWidth,
                  false,
                  noteColorStyle,
                );
          if (!painted && !skin) {
            context.fillStyle = noteColor(palette, note.type);
            if (note.type === 2) {
              context.fillRect(
                horizontal - noteWidth / 2,
                top,
                noteWidth,
                Math.max(0, bottom - top),
              );
            }
            context.fillRect(horizontal - noteWidth / 2, bottom - 4, noteWidth, 8);
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
        context.globalAlpha = 0.5;
        context.strokeStyle = palette.outline;
        context.setLineDash([2, 4]);
        context.lineWidth = 1;
        drawEventGhost(
          context,
          change.before,
          bounds.x,
          bounds.width,
          vertical,
          ranges.get(`${lineIndex}:${change.type}`),
        );
        context.fillStyle = palette.selectionEventsFill;
        context.fillRect(bounds.x, top, bounds.width, Math.max(2, bottom - top));
        context.strokeStyle = palette.overlayValidStroke;
        context.setLineDash([5, 3]);
        context.lineWidth = 2.5;
        drawEventGhost(
          context,
          item,
          bounds.x,
          bounds.width,
          vertical,
          ranges.get(`${lineIndex}:${change.type}`),
        );
        context.globalAlpha = 1;
        context.font = canvasFont("caption");
        context.textAlign = "center";
        const format = (value: unknown) =>
          typeof value === "number" && Number.isFinite(value)
            ? Number(value.toFixed(3)).toString()
            : Array.isArray(value)
              ? value.join(",")
              : String(value ?? "");
        if (bottom - top > 24) {
          const labels: readonly [unknown, number][] = [
            [item.end ?? item.shader, Math.max(36, top + 13)],
            [item.start ?? item.shader, Math.min(canvas.clientHeight - 5, bottom - 4)],
          ];
          for (const [value, position] of labels) {
            context.fillStyle = palette.surface;
            context.fillRect(bounds.x + 2, position - 11, bounds.width - 4, 14);
            context.fillStyle = palette.foreground;
            context.fillText(
              format(value),
              bounds.x + bounds.width / 2,
              position,
              bounds.width - 8,
            );
          }
        }
        context.restore();
      }
    }
    context.restore();
  }
}
