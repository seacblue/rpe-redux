/**
 * The editing operations shared by menus, the top bar, and context actions.
 *
 * Undo, redo, clipboard verbs, and delete are connected by the mounted editor;
 * select-all remains a keyboard/context command because it depends on the
 * current editor focus surface. Nothing is connected while the shell is at the
 * start page, and every operation here does nothing then.
 */
import { t } from "../../../i18n/index.ts";
import type { HistoryBeatRange } from "../session/history.ts";
import type { EditorSession } from "../session/session.ts";
import { selectiveUndoLatest, type SelectiveUndoResult } from "../session/selectiveUndo.ts";
import { createLateBound } from "../../utils/lateBound.ts";

export interface HistoryTravelOptions {
  getSession(): EditorSession;
  cancelPlacement(): void;
  notify(message: string, level?: string, duration?: number): void;
  /** Reveal the edited beat span after a successful undo or redo. */
  jumpToEdit?(range: HistoryBeatRange): void;
}

/** Reports the outcome of a collaborative undo without claiming unapplied work. */
function notifyCollaborativeUndo(
  result: SelectiveUndoResult,
  notify: HistoryTravelOptions["notify"],
): void {
  if (result.status === "committed") {
    notify(
      t("editor.app.notice.travel", {
        action: t("common.action.undo"),
        label: t("workspace.history.collaborativeUndo"),
      }),
      "success",
    );
    return;
  }
  if (result.status === "conflict") {
    notify(t("workspace.history.undoConflict", { paths: result.paths.join(", ") }), "error");
    return;
  }
  if (result.status === "rejected") {
    notify(t("workspace.history.undoRejected"), "error");
    return;
  }
  notify(t("workspace.history.undoUnavailable"), "warning");
}

/** Builds undo/redo actions that cancel placement and report the entry they travel to. */
export function createHistoryTravel({
  getSession,
  cancelPlacement,
  notify,
  jumpToEdit,
}: HistoryTravelOptions) {
  /** Reveal the beat span the last successful history move touched. */
  function reveal(session: EditorSession): void {
    if (session.lastEditBeatRange) {
      jumpToEdit?.(session.lastEditBeatRange);
    }
  }

  /** Cancels pending placement, then travels one step or reports an empty stack. */
  function travel(direction: "undo" | "redo"): void {
    cancelPlacement();
    const session = getSession();
    if (session.collaborationActive) {
      if (direction === "redo") {
        notify(t("workspace.history.redoUnavailable"), "warning");
        return;
      }
      const result = selectiveUndoLatest(session, t("workspace.history.collaborativeUndo"));
      notifyCollaborativeUndo(result, notify);
      if (result.status === "committed") {
        reveal(session);
      }
      return;
    }
    const entry = (direction === "undo" ? session.history.undoStack : session.history.redoStack).at(
      -1,
    );
    if (!entry) {
      notify(
        direction === "undo"
          ? t("editor.app.notice.nothingToUndo")
          : t("editor.app.notice.nothingToRedo"),
        "warning",
      );
      return;
    }
    if (!session.travel(direction)) {
      return;
    }
    reveal(session);
    notify(
      t("editor.app.notice.travel", {
        action: direction === "undo" ? t("common.action.undo") : t("common.action.redo"),
        label: entry.label,
      }),
      "success",
    );
  }
  return { travel };
}

export interface EditingBindings {
  historyTravel: ReturnType<typeof createHistoryTravel>;
  /** The clipboard verbs reach the same selection clipboard as the shortcuts. */
  copy(): void;
  cut(): void;
  paste(): void;
  remove(): void;
}

const editingBinding = createLateBound<EditingBindings>();

/** Hands the mounted editor's history and clipboard to the operations below. */
export function connectEditing(bindings: EditingBindings): () => void {
  return editingBinding.bind(bindings);
}

/** Travels one step back; does nothing while no editor is mounted. */
export function undo(): void {
  editingBinding.value()?.historyTravel.travel("undo");
}

/** Travels one step forward; does nothing while no editor is mounted. */
export function redo(): void {
  editingBinding.value()?.historyTravel.travel("redo");
}

/** Pastes the selection clipboard; does nothing while no editor is mounted. */
export function paste(): void {
  editingBinding.value()?.paste();
}

/** Copies the selection; does nothing while no editor is mounted. */
export function copy(): void {
  editingBinding.value()?.copy();
}

/** Cuts the selection; does nothing while no editor is mounted. */
export function cut(): void {
  editingBinding.value()?.cut();
}

/** Deletes the selection; does nothing while no editor is mounted. */
export function remove(): void {
  editingBinding.value()?.remove();
}

/** The edit operations, as the toolbar and the shortcut editor see them. */
export const editing = Object.freeze({ undo, redo, copy, cut, paste, remove });
