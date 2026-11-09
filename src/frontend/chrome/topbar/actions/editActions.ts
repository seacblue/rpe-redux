/**
 * Undo, redo, clipboard, and selection actions.
 *
 * Each shares its availability with the editor shortcut it names, so an
 * unavailable edit is disabled wherever it appears.
 */
import { toolbar, type ToolbarAction } from "../../../../core/shell/registries/toolbar.ts";
import type { MessageKey } from "../../../../i18n/index.ts";
import { getEditorHistorySnapshot } from "../../../../core/edit/session/history.ts";
import { getEditorVisibility } from "../../../../core/edit/state/visibility.ts";
import { editing } from "../../../../core/edit/operations/editing.ts";

interface EditorActionSpec {
  /** The action id, and the editor shortcut whose availability it shares. */
  id: string;
  shortcutId:
    | "edit.undo"
    | "edit.redo"
    | "edit.copy"
    | "edit.cut"
    | "edit.paste"
    | "edit.delete"
    | "edit.selectAll";
  run(): void;
  /** The visible action label. */
  label: MessageKey;
  /** Message key for the tooltip and shortcut editor. */
  tooltip: MessageKey;
  icon: ToolbarAction["icon"];
  separatorBefore?: boolean;
  destructive?: boolean;
  toolbar?: boolean;
}

/**
 * The editor's actions, in the order they appear.
 *
 * Each entry names the editor operation it runs. That is the whole link: there
 * is no element id between a button and the editor, so the mapping cannot go
 * stale because a control moved.
 */
const EDITOR_ACTIONS: EditorActionSpec[] = [
  {
    id: "edit.undo",
    shortcutId: "edit.undo",
    run: () => editing.undo(),
    label: "common.action.undo",
    icon: "undo",
    tooltip: "chrome.menu.edit.undoHint",
  },
  {
    id: "edit.redo",
    shortcutId: "edit.redo",
    run: () => editing.redo(),
    label: "common.action.redo",
    icon: "redo",
    tooltip: "chrome.menu.edit.redoHint",
  },
  {
    id: "edit.copy",
    shortcutId: "edit.copy",
    run: () => editing.copy(),
    label: "common.action.copy",
    icon: "copy",
    tooltip: "shortcuts.editor.copy",
    separatorBefore: true,
    toolbar: false,
  },
  {
    id: "edit.cut",
    shortcutId: "edit.cut",
    run: () => editing.cut(),
    label: "shortcuts.editor.cut",
    icon: "cut",
    tooltip: "shortcuts.editor.cut",
    toolbar: false,
  },
  {
    id: "edit.paste",
    shortcutId: "edit.paste",
    run: () => editing.paste(),
    label: "common.action.paste",
    icon: "paste",
    tooltip: "chrome.menu.edit.pasteHint",
    toolbar: false,
  },
  {
    id: "edit.delete",
    shortcutId: "edit.delete",
    run: () => editing.remove(),
    label: "common.action.delete",
    icon: "trash",
    tooltip: "shortcuts.editor.delete",
    separatorBefore: true,
    destructive: true,
    toolbar: false,
  },
  {
    id: "edit.selectAll",
    shortcutId: "edit.selectAll",
    run: () => undefined,
    label: "shortcuts.editor.selectAll",
    icon: "select",
    tooltip: "shortcuts.editor.selectAll",
    toolbar: false,
  },
];
/** Registers the editor actions; returns their disposers in declaration order. */
export function registerEditActions() {
  return EDITOR_ACTIONS.map((action, order) =>
    toolbar.register({
      kind: "action",
      id: action.id,
      group: "editor",
      order: 200 + order,
      label: action.label,
      icon: action.icon,
      tooltip: action.tooltip,
      // Undo and redo are top-bar controls. Paste remains a shared context
      // action.
      toolbar: action.toolbar ?? true,
      separatorBefore: action.separatorBefore,
      destructive: action.destructive,
      contexts: ["notes", "events"],
      shortcutId: action.shortcutId,
      // Document history follows the document, while
      // the remaining actions edit the timeline selection.
      shortcutScope:
        action.id === "edit.undo" || action.id === "edit.redo" ? "workspace" : "editor",
      run: action.run,
      enabled: () => {
        const visibility = getEditorVisibility();
        if (visibility.atHome || !visibility.hasDocument) {
          return false;
        }
        const history = getEditorHistorySnapshot();
        return action.shortcutId === "edit.undo"
          ? history.canUndo
          : action.shortcutId === "edit.redo"
            ? history.canRedo
            : true;
      },
    }),
  );
}
