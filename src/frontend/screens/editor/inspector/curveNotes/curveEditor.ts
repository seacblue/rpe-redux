/**
 * Coordinates curve-editor canvas interaction and field updates.
 *
 * The curve model supplies values and labels; this module translates pointer
 * edits into model actions and invalidates the preview. Curve mathematics and
 * inspector-pane selection stay outside this file.
 */
import { flushSync } from "react-dom";
import {
  beatCopy,
  compareBeats,
  fromNumber,
  normalizeBeat,
} from "../../../../../core/global/chart/timing/beat.ts";
import { planCurveNotes } from "../../../../../core/global/chart/editing/curveNotes.ts";
import { t } from "../../../../../i18n/index.ts";
import type { JudgeLineNote } from "../../../../../core/global/chart/chart.ts";
import type { CurveQuickAnchor, CurveQuickPhase, CurveQuickSnapshot, CurveState } from "./model.ts";
import { DEFAULT_CURVE_FIELD_VALUES } from "./model.ts";
import type { CurveFieldValues } from "./CurveFieldsView.tsx";
import { createCurveGhostCache } from "./ghostCache.ts";
import type { CurveAnchor } from "../../../../../core/edit/timeline/types.ts";
import type { TimelineNote } from "../../../../../core/edit/timeline/types.ts";

/** Host callbacks the curve editor uses without owning the session or timeline. */
export interface CurveEditorDependencies {
  state: CurveState;
  getDivision(): number;
  getNotes(): readonly JudgeLineNote[];
  setPickMode(mode: "start" | "end" | null): void;
  activatePane(): void;
  /** Leave multi-line editing and show the ordinary note timeline for picking. */
  showSingleNoteTimeline(): void;
  closePane(): void;
  invalidate(): void;
  notify(message: string, severity?: string): void;
  reportError(error: unknown): void;
  commit(notes: JudgeLineNote[]): void;
}

/** Creates the curve editor bound to one mounted editor tree. */
export function createCurveEditor(deps: CurveEditorDependencies) {
  const ghostCache = createCurveGhostCache();
  let start: CurveAnchor | null | undefined;
  let end: CurveAnchor | null | undefined;
  let anchorMode: "start" | "end" | null = null;
  let open = false;
  let lastGhostError: string | null = null;
  let previewEnabled = true;
  let values: CurveFieldValues = { ...DEFAULT_CURVE_FIELD_VALUES };
  let quickActive = false;
  let quickPhase: CurveQuickPhase = "start";
  let quickStartLine: number | undefined;
  let quickEndLine: number | undefined;
  let quickType = DEFAULT_CURVE_FIELD_VALUES.type;
  let lastQuickKey = "";

  /** A curve note type, or the pane's current type when it is not a curve type. */
  function curveQuickType(noteType: number): number {
    return [1, 2, 3, 4].includes(noteType) ? noteType : values.type;
  }

  /** Stable identity for one quick anchor in the published snapshot. */
  function quickAnchorKey(anchor: CurveQuickAnchor | null): string {
    return anchor
      ? `${anchor.startTime.join("/")}@${anchor.positionX}#${anchor.lineIndex ?? ""}`
      : "-";
  }

  /** Publishes the quick panel read model, skipping an unchanged snapshot. */
  function publishQuick(): void {
    const snapshot: CurveQuickSnapshot = {
      visible: quickActive && open && start !== null && end !== null,
      phase: quickPhase,
      start: start
        ? {
            startTime: beatCopy(start.startTime),
            positionX: start.positionX,
            ...(quickStartLine === undefined ? {} : { lineIndex: quickStartLine }),
          }
        : null,
      end: end
        ? {
            startTime: beatCopy(end.startTime),
            positionX: end.positionX,
            ...(quickEndLine === undefined ? {} : { lineIndex: quickEndLine }),
          }
        : null,
      type: quickType,
      easingType: values.easingType,
    };
    const key = [
      snapshot.visible ? 1 : 0,
      snapshot.phase,
      quickAnchorKey(snapshot.start),
      quickAnchorKey(snapshot.end),
      snapshot.type,
      snapshot.easingType,
    ].join("|");
    if (key === lastQuickKey) {
      return;
    }
    lastQuickKey = key;
    deps.state.quick.set(snapshot);
  }

  /** Stops the quick pick without changing the values the pane still shows. */
  function hideQuick(): void {
    quickActive = false;
    quickPhase = "start";
    quickStartLine = undefined;
    quickEndLine = undefined;
    publishQuick();
  }

  /** Publishes the current draft to the pane and repaints the ghost. */
  function updatePanel(): void {
    if (!open) {
      return;
    }
    const fieldValues: CurveFieldValues = { ...values };
    flushSync(() =>
      deps.state.fields.set({
        labels: {
          startTime: t("editor.app.curve.startBeat"),
          endTime: t("editor.app.curve.endBeat"),
          startX: t("editor.app.curve.startX"),
          endX: t("editor.app.curve.endX"),
          density: t("editor.app.curve.density"),
          type: t("editor.app.curve.type"),
          easing: t("editor.app.curve.easing"),
        },
        values: fieldValues,
        // A beat box commits only a complete triple and the owner refuses the
        // two impossible orders, so the form has no half-typed anchor left to
        // report; a failed generation reports through `reportError` instead.
        error: null,
        preview: previewEnabled,
        onInput: updateFields,
        onPreviewChange: setPreview,
      }),
    );
    publishQuick();
    deps.invalidate();
  }

  /** Stores edited form values and republishes them. */
  function updateFields(next: CurveFieldValues): void {
    values = { ...next };
    ghostCache.invalidate();
    updatePanel();
    deps.invalidate();
  }

  /** Shows or hides the generated-notes ghost; the draft itself stays as it is. */
  function setPreview(enabled: boolean): void {
    if (previewEnabled === enabled) {
      return;
    }
    previewEnabled = enabled;
    ghostCache.invalidate();
    updatePanel();
    deps.invalidate();
  }

  /** Opens the pane and seeds both anchors from the current draft. */
  function openPanel(): void {
    open = true;
    ghostCache.invalidate();
    start = {
      startTime: beatCopy(values.startTime),
      positionX: values.startX,
      type: values.type,
    };
    end = {
      startTime: beatCopy(values.endTime),
      positionX: values.endX,
      type: values.type,
    };
    anchorMode = null;
    hideQuick();
    deps.setPickMode(null);
    deps.activatePane();
    updatePanel();
  }

  /** Closes the pane and clears the draft anchors. */
  function closePanel(): void {
    open = false;
    ghostCache.invalidate();
    start = null;
    end = null;
    anchorMode = null;
    hideQuick();
    deps.setPickMode(null);
    deps.closePane();
    deps.invalidate();
  }

  /** Starts picking the start or end anchor from the timeline. */
  function capture(endAnchor: boolean): void {
    if (!open) {
      openPanel();
    }
    hideQuick();
    deps.showSingleNoteTimeline();
    anchorMode = endAnchor ? "end" : "start";
    if (endAnchor && !start) {
      anchorMode = null;
      deps.setPickMode(null);
      throw new Error(t("editor.app.curve.needStart"));
    }
    deps.setPickMode(endAnchor ? "end" : "start");
  }

  /** Writes a picked anchor into the draft; returns false when none is pending. */
  function applyAnchor(anchor: CurveAnchor, lineIndex?: number): boolean {
    if (anchorMode === "start") {
      start = anchor;
      quickStartLine = lineIndex;
      anchorMode = null;
      if (quickActive) {
        quickPhase = start && end ? "complete" : "end";
      }
      deps.setPickMode(null);
      values.startTime = normalizeBeat(anchor.startTime);
      values.startX = anchor.positionX;
      ghostCache.invalidate();
      updatePanel();
      deps.invalidate();
      return true;
    }
    if (!start) {
      anchorMode = null;
      deps.setPickMode(null);
      deps.notify(t("editor.app.curve.needStart"), "warning");
      return true;
    }
    end = anchor;
    quickEndLine = lineIndex;
    anchorMode = null;
    if (quickActive) {
      quickPhase = "complete";
    }
    deps.setPickMode(null);
    values.endTime = normalizeBeat(anchor.startTime);
    values.endX = anchor.positionX;
    ghostCache.invalidate();
    updatePanel();
    deps.invalidate();
    return true;
  }

  /** Uses a timeline note as the pending anchor. */
  function pick(note: TimelineNote, _index?: number, lineIndex?: number): boolean {
    if (!anchorMode) {
      return false;
    }
    return applyAnchor(
      {
        startTime: beatCopy(note.startTime),
        positionX: note.positionX,
        type: note.type,
      },
      lineIndex,
    );
  }

  /**
   * Starts or advances a quick pick from a Ctrl+clicked note.
   *
   * The first note is the start and puts the editor in end-pick mode; the next
   * note completes the draft. A Ctrl+click after both anchors starts a new
   * curve, so repeated Ctrl+clicks never merge two intended selections.
   */
  function quickPick(note: TimelineNote, _index?: number, lineIndex?: number): boolean {
    if (!open) {
      openPanel();
    }
    deps.showSingleNoteTimeline();
    const anchor: CurveAnchor = {
      startTime: beatCopy(note.startTime),
      positionX: note.positionX,
      type: note.type,
    };
    quickActive = true;
    if (quickPhase !== "end" || !start) {
      quickPhase = "end";
      start = anchor;
      quickStartLine = lineIndex;
      end = null;
      quickEndLine = undefined;
      quickType = curveQuickType(anchor.type);
      values.startTime = normalizeBeat(anchor.startTime);
      values.startX = anchor.positionX;
      values.endTime = normalizeBeat(anchor.startTime);
      values.endX = anchor.positionX;
      anchorMode = "end";
      deps.setPickMode("end");
    } else {
      quickPhase = "complete";
      end = anchor;
      quickEndLine = lineIndex;
      values.endTime = normalizeBeat(anchor.startTime);
      values.endX = anchor.positionX;
      anchorMode = null;
      deps.setPickMode(null);
    }
    ghostCache.invalidate();
    updatePanel();
    deps.invalidate();
    return true;
  }

  /** Pick an arbitrary grid point, independent of any existing note. */
  function pickPoint(beat: number, positionX: number): boolean {
    if (!anchorMode || !Number.isFinite(beat) || !Number.isFinite(positionX)) {
      return false;
    }
    return applyAnchor({
      startTime: fromNumber(beat),
      positionX,
      type: values.type,
    });
  }

  /** Generates the curve notes and commits them through the host. */
  function generate(): void {
    if (quickActive && !end) {
      deps.notify(t("editor.app.curve.needEnd"), "warning");
      return;
    }
    // Quick picks may be made in either click order. Generation always runs
    // forward in time, so a start after the end swaps both anchors first.
    if (compareBeats(values.startTime, values.endTime) > 0) {
      values = {
        ...values,
        startTime: values.endTime,
        endTime: values.startTime,
        startX: values.endX,
        endX: values.startX,
      };
      updatePanel();
    }
    try {
      const plan = planCurveNotes({
        ...values,
        type: quickActive ? quickType : values.type,
        division: deps.getDivision(),
        existing: deps.getNotes(),
      });
      if (!plan.generated.length && compareBeats(values.startTime, values.endTime) !== 0) {
        throw new Error(t("editor.app.curve.nothingToGenerate"));
      }
      deps.commit(plan.notes);
      closePanel();
      deps.notify(t("editor.app.curve.generated", { count: plan.notes.length }), "success");
    } catch (error) {
      deps.reportError(error);
    }
  }

  /** Changes the quick panel's own note type without touching the pane's fields. */
  function setQuickType(type: number): void {
    if (![1, 2, 3, 4].includes(type) || type === quickType) {
      return;
    }
    quickType = type;
    ghostCache.invalidate();
    publishQuick();
    deps.invalidate();
  }

  /** Changes only the easing preset while the quick panel is open. */
  function setEasing(easingType: number): void {
    if (
      !Number.isInteger(easingType) ||
      easingType < 1 ||
      easingType > 29 ||
      easingType === values.easingType
    ) {
      return;
    }
    values = { ...values, easingType };
    ghostCache.invalidate();
    updatePanel();
    deps.invalidate();
  }

  /** Drops both quick anchors and returns anchor picking to idle. */
  function dismissQuick(): void {
    quickActive = false;
    quickPhase = "start";
    quickStartLine = undefined;
    quickEndLine = undefined;
    anchorMode = null;
    start = null;
    end = null;
    deps.setPickMode(null);
    ghostCache.invalidate();
    updatePanel();
    deps.invalidate();
  }

  /** Clears the anchors, pick mode, and open flag without notifying the host. */
  function resetDraft(): void {
    anchorMode = null;
    start = null;
    end = null;
    open = false;
    quickActive = false;
    quickPhase = "start";
    quickStartLine = undefined;
    quickEndLine = undefined;
    ghostCache.invalidate();
    publishQuick();
  }

  /** Returns the preview notes, reporting each new ghost error once. */
  function ghost(): TimelineNote[] {
    if (!previewEnabled) {
      return [];
    }
    let failed = false;
    const result = ghostCache.get({
      active: open,
      start,
      end,
      values: quickActive ? { ...values, type: quickType } : values,
      division: deps.getDivision(),
      notes: deps.getNotes(),
      onError: (error) => {
        failed = true;
        const message = error instanceof Error ? error.message : String(error);
        if (message !== lastGhostError) {
          lastGhostError = message;
          deps.reportError(error);
        }
      },
    });
    if (!failed) {
      lastGhostError = null;
    }
    return result;
  }

  return {
    get isOpen() {
      return open;
    },
    updatePanel,
    openPanel,
    closePanel,
    capture,
    pick,
    quickPick,
    pickPoint,
    generate,
    setEasing,
    setQuickType,
    dismissQuick,
    resetDraft,
    setPreview,
    deactivate: () => {
      // Leaving the pane must also end an in-progress anchor pick; otherwise a
      // hidden curve editor would keep consuming the next note click. Repaint
      // immediately so the timeline drops the ghost before the next pointer
      // event can invalidate it.
      open = false;
      anchorMode = null;
      quickActive = false;
      quickPhase = "start";
      quickStartLine = undefined;
      quickEndLine = undefined;
      ghostCache.invalidate();
      publishQuick();
      deps.setPickMode(null);
      deps.invalidate();
    },
    ghost,
  };
}
