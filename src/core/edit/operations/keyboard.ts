/**
 * Executes editor shortcut actions that need a live timeline or session.
 *
 * Actions act on the current cursor and pending placement rather than on a
 * captured selection, and an action this module does not recognize leaves the
 * keyboard event unhandled so an outer surface can still act on it.
 */
import { eventKey, eventList } from "../events/eventTracks.ts";
import {
  clearSelection,
  scaleSelection,
  shiftEventEdge,
  shiftSelectionLine,
} from "../selection/control.ts";
import { nudgeSelection } from "../selection/edits.ts";
import { MAX_BASE_EVENT_LAYERS } from "../../global/chart/chartVocabulary.ts";
import type { EditorSession } from "../session/session.ts";
import type { TimelineArea } from "../timeline/types.ts";
import { isSystemCancelKey } from "../../shortcuts/keyMatching.ts";
import type { ShortcutEventLike } from "../../shortcuts/types.ts";
import { recordDiagnosticAction } from "../../diagnostics/interactionLog.ts";

export interface KeyboardActionEvent extends ShortcutEventLike {
  key: string;
  repeat?: boolean;
  preventDefault(): void;
  stopPropagation(): void;
}

interface EventKeyboardTarget {
  pending: { type: string; beat: number } | null;
  place(type?: string | null, beat?: number, easing?: number | null, instant?: boolean): boolean;
}

interface KeyboardTimeline {
  division: number;
  gridCount: number;
  eventTypes: string[];
  eventInteraction: Pick<EventKeyboardTarget, "pending">;
  addAtCursor(type: number): boolean;
  cancelPlacement(): void;
}

/** The live state the fixed Escape action resolves against. */
export interface FixedCancelState {
  hasPendingPlacement: boolean;
  hasSelection: boolean;
  samplingActive: boolean;
  curveMode: boolean;
  batchActive: boolean;
}

/**
 * Resolve Escape to the editor action it should run.
 *
 * Escape is a fixed system cancel key, not a rebindable shortcut: it cancels a
 * pending placement before it clears the selection, and surfaces that own their
 * own Escape handling (sampling, curve, and batch drags) keep it for themselves.
 */
export function fixedCancelAction(
  event: ShortcutEventLike,
  state: FixedCancelState,
): "placement.cancel" | "selection.clear" | undefined {
  if (!isSystemCancelKey(event)) {
    return undefined;
  }
  if (state.samplingActive || state.curveMode || state.batchActive) {
    return undefined;
  }
  if (state.hasPendingPlacement) {
    return "placement.cancel";
  }
  if (state.hasSelection) {
    return "selection.clear";
  }
  return undefined;
}

/** Keyboard action ids mapped to timeline note types and navigation directions. */
const NOTE_TYPE_BY_ACTION: Record<string, 1 | 2 | 3 | 4> = {
  "note.place.tap": 1,
  "note.place.drag": 4,
  "note.place.flick": 3,
  "note.place.hold": 2,
};

const PAGE_KEYS: Record<string, string> = {
  "selection.nudge.left": "ArrowLeft",
  "selection.nudge.right": "ArrowRight",
  "selection.nudge.up": "ArrowUp",
  "selection.nudge.down": "ArrowDown",
};

/** Resolve placement to the timeline currently under the pointer when known. */
export function resolveEditorShortcutArea(
  eventTargetArea: TimelineArea | undefined,
  hoveredArea: TimelineArea | undefined,
  activeCanvasArea: TimelineArea | undefined,
  fallback: TimelineArea,
): TimelineArea {
  return hoveredArea ?? eventTargetArea ?? activeCanvasArea ?? fallback;
}

/** Ctrl+Q/W/E/R/T select base layers 0-3 and the synthetic extended layer. */
const EVENT_LAYER_ACTIONS: Record<string, number> = {
  "event.layer.0": 0,
  "event.layer.1": 1,
  "event.layer.2": 2,
  "event.layer.3": 3,
  "event.layer.4": MAX_BASE_EVENT_LAYERS,
};

export interface EditorKeyboardActionDependencies {
  /**
   * A getter, not the session itself: opening a chart installs a new session, and a
   * captured reference would route every shortcut into the document that was open when
   * the binding was registered.
   */
  getSession(): EditorSession;
  timeline: KeyboardTimeline;
  eventInteraction: () => EventKeyboardTarget;
  save: () => Promise<unknown>;
  travel: (direction: "undo" | "redo") => void;
  copySelection: () => void;
  copySelectionAllLayers: () => void;
  cutSelection: () => void;
  pasteSelection: (options?: { mirror?: boolean; keepTime?: boolean }) => void;
  /** Seek to the clipboard's first or last beat; false when it is empty. */
  jumpToClipboard: (edge: "start" | "end") => boolean;
  /** Remove the active clipboard contents without touching history entries. */
  clearClipboard: () => void;
  selectEventLayer: (layer: number) => void;
  togglePlayback: () => Promise<unknown>;
  /** Start playback when stopped, without toggling a running transport. */
  startPlayback: () => Promise<unknown>;
  /** Stop playback and return to the start of the chart. */
  stopPlayback: () => void;
  /** Stop playback and keep the current position. */
  stopPlaybackStay: () => void;
  /** Seek to the start and play from there. */
  replayPlayback: () => Promise<unknown>;
  /** Toggle time snapping for placing and dragging objects. */
  toggleTimeSnap: () => void;
  showLineInfo: () => void;
  /** Opens the workspace sampler for the single selected event's anchor. */
  sampleSelection: (field: "start" | "end") => boolean;
  resetCamera: () => void;
  toggleGameUi: () => void;
  togglePreviewOnly: () => void;
  /** Start a held audition in the preview-only layout. */
  beginPreviewAudition: (restoreTime: boolean) => void;
  /** End the active held audition and restore its layout. */
  endPreviewAudition: () => void;
  openMultiLinePanel: () => void;
  captureCurve: (end: boolean) => void;
  deleteSelection: () => void;
  /** Delete the curve draft's selected segment or path. */
  deleteCurveSelection: () => void;
  currentBeat: () => number;
  seekBeat: (beat: number) => void;
  /** Select the neighbouring judge line; false when the chart has no lines. */
  stepLine: (direction: -1 | 1) => boolean;
  reportError: (error: unknown) => void;
}

/** Executes one matched editor shortcut and preserves its original event semantics. */
export async function runEditorKeyboardAction(
  event: KeyboardActionEvent,
  action: string,
  area: TimelineArea,
  deps: EditorKeyboardActionDependencies,
): Promise<void> {
  const { timeline } = deps;
  const session = deps.getSession();
  const surface = area === "events" ? "events" : "editor";
  let handled = true;
  try {
    if (
      event.repeat &&
      [
        "playback.pause",
        "playback.start",
        "playback.stop",
        "playback.stopStay",
        "playback.replay",
        "timeline.toggleSnapX",
        "view.showLineInfo",
        "view.toggleGameUi",
        "view.togglePreviewOnly",
        "view.previewAudition",
        "view.previewAuditionStay",
        "note.place.hold",
        "event.place",
        "note.place.tap",
        "workspace.multiLine.toggle",
        "workspace.multiLine.switchMode",
      ].includes(action)
    ) {
      recordDiagnosticAction(action, "shortcut", "ignored", surface);
      event.preventDefault();
      return;
    }
    if (action === "placement.cancel") {
      timeline.cancelPlacement();
    } else if (action === "selection.clear") {
      if (clearSelection(session)) {
        session.notify();
      }
    } else if (PAGE_KEYS[action]) {
      nudgeSelection(session, PAGE_KEYS[action], timeline.division, timeline.gridCount);
    } else if (action === "selection.scale.narrower") {
      scaleSelection(session, 0.95);
    } else if (action === "selection.scale.wider") {
      scaleSelection(session, 1.05);
    } else if (action === "selection.line.previous") {
      shiftSelectionLine(session, -1);
    } else if (action === "selection.line.next") {
      shiftSelectionLine(session, 1);
    } else if (action === "selection.event.start.earlier") {
      shiftEventEdge(session, "start", -1, timeline.division);
    } else if (action === "selection.event.start.later") {
      shiftEventEdge(session, "start", 1, timeline.division);
    } else if (action === "selection.event.end.earlier") {
      shiftEventEdge(session, "end", -1, timeline.division);
    } else if (action === "selection.event.end.later") {
      shiftEventEdge(session, "end", 1, timeline.division);
    } else if (
      timeline.eventInteraction.pending &&
      /^[0-9]$/.test(event.key) &&
      !event.ctrlKey &&
      !event.altKey
    ) {
      deps.eventInteraction().place(undefined, undefined, Number(event.key) || 10);
    } else if (action === "document.save") {
      event.preventDefault();
      await deps.save();
    } else if (action === "edit.undo") {
      deps.travel("undo");
    } else if (action === "edit.redo") {
      deps.travel("redo");
    } else if (action === "edit.selectAll") {
      if (session.focus === "events") {
        session.eventSelection = new Set(
          timeline.eventTypes.flatMap((type) =>
            eventList(session, type).map((event, index) => eventKey(type, index)),
          ),
        );
      } else if (session.multiLineActive && session.multiLineMode === "notes") {
        session.multiLineSelection = new Map(
          session.targetLineIndices.map((lineIndex) => [
            lineIndex,
            new Set(
              (session.chart.judgeLineList?.[lineIndex]?.notes ?? []).map((note, index) => index),
            ),
          ]),
        );
        session.selection = new Set(session.multiLineSelection.get(session.lineIndex) ?? []);
      } else {
        session.selection = new Set(session.notes.map((note, index) => index));
      }
      session.notify();
    } else if (action === "edit.copy") {
      deps.copySelection();
    } else if (action === "edit.copy.allLayers") {
      deps.copySelectionAllLayers();
    } else if (Object.hasOwn(EVENT_LAYER_ACTIONS, action)) {
      deps.selectEventLayer(EVENT_LAYER_ACTIONS[action]);
    } else if (action === "edit.cut") {
      deps.cutSelection();
    } else if (
      [
        "edit.paste",
        "edit.paste.keepTime",
        "edit.paste.mirror",
        "edit.paste.keepTimeMirror",
      ].includes(action)
    ) {
      deps.pasteSelection({
        keepTime: action === "edit.paste.keepTime" || action === "edit.paste.keepTimeMirror",
        mirror: action === "edit.paste.mirror" || action === "edit.paste.keepTimeMirror",
      });
    } else if (action === "edit.clipboard.jumpStart") {
      handled = deps.jumpToClipboard("start");
    } else if (action === "edit.clipboard.jumpEnd") {
      handled = deps.jumpToClipboard("end");
    } else if (action === "edit.clipboard.clear") {
      deps.clearClipboard();
    } else if (action === "playback.pause") {
      event.preventDefault();
      await deps.togglePlayback();
    } else if (action === "playback.start") {
      event.preventDefault();
      await deps.startPlayback();
    } else if (action === "playback.stop") {
      event.preventDefault();
      deps.stopPlayback();
    } else if (action === "playback.stopStay") {
      event.preventDefault();
      deps.stopPlaybackStay();
    } else if (action === "playback.replay") {
      event.preventDefault();
      await deps.replayPlayback();
    } else if (action === "timeline.toggleSnapX") {
      deps.toggleTimeSnap();
    } else if (action === "view.showLineInfo") {
      deps.showLineInfo();
    } else if (action === "event.sample.start" || action === "event.sample.end") {
      handled = deps.sampleSelection(action === "event.sample.end" ? "end" : "start");
    } else if (action === "view.resetCamera") {
      event.preventDefault();
      deps.resetCamera();
    } else if (action === "view.toggleGameUi") {
      deps.toggleGameUi();
    } else if (action === "view.togglePreviewOnly") {
      event.preventDefault();
      deps.togglePreviewOnly();
    } else if (action === "view.previewAudition" || action === "view.previewAuditionStay") {
      event.preventDefault();
      deps.beginPreviewAudition(action === "view.previewAudition");
    } else if (action === "workspace.multiLine.toggle") {
      // Selecting multiple lines already owns the mode. The shortcut opens the
      // settings surface and re-asserts the current mode.
      if (session.multiLineIndices.length >= 2) {
        session.setMultiLineEnabled(true, session.focus === "events" ? "events" : "notes");
      }
      deps.openMultiLinePanel();
    } else if (action === "workspace.multiLine.switchMode" && session.multiLineActive) {
      session.setMultiLineMode(session.multiLineMode === "events" ? "notes" : "events");
    } else if (
      action === "event.trajectory.capture.begin" ||
      action === "event.trajectory.capture.end"
    ) {
      deps.captureCurve(action === "event.trajectory.capture.end");
    } else if (area === "events" && ["note.place.tap", "event.place"].includes(action)) {
      handled = deps
        .eventInteraction()
        .place(undefined, undefined, undefined, action === "note.place.tap");
    } else if (
      ["note.place.tap", "note.place.drag", "note.place.flick", "note.place.hold"].includes(action)
    ) {
      handled = timeline.addAtCursor(NOTE_TYPE_BY_ACTION[action]);
    } else if (action === "editor.curve.delete") {
      deps.deleteCurveSelection();
    } else if (action === "edit.delete") {
      deps.deleteSelection();
    } else if (action === "navigation.line.previous" || action === "navigation.line.next") {
      deps.stepLine(action === "navigation.line.previous" ? -1 : 1);
    } else if (
      [
        "playback.step.previous",
        "playback.step.next",
        "navigation.time.previous",
        "navigation.time.next",
      ].includes(action)
    ) {
      const direction = action.endsWith("previous") ? -1 : 1;
      deps.seekBeat(Math.max(0, deps.currentBeat() + direction / timeline.division));
    } else {
      handled = false;
    }
    if (handled) {
      event.preventDefault();
      event.stopPropagation();
    }
    recordDiagnosticAction(action, "shortcut", handled ? "completed" : "ignored", surface);
  } catch (error) {
    event.preventDefault();
    recordDiagnosticAction(action, "shortcut", "failed", surface);
    deps.reportError(error);
  }
}

/**
 * Run the release half of a held editor shortcut.
 *
 * Only actions declared with `hold` reach here; the dispatcher records the key
 * that started them so a key-up, blur, or unmount always ends the temporary
 * state instead of leaving playback or a preview layout behind.
 */
export function runEditorShortcutRelease(
  action: string,
  deps: EditorKeyboardActionDependencies,
): void {
  if (action === "view.previewAudition" || action === "view.previewAuditionStay") {
    deps.endPreviewAudition();
  }
}
