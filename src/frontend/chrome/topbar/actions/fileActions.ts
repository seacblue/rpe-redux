/**
 * New, open, save, export, and library actions.
 *
 * Each action owns its run callback and resolves its text through the message
 * catalog. The toolbar and the shortcut editor are the only surfaces that read
 * them; no menu descriptor sits in between.
 */
import { toolbar } from "../../../../core/shell/registries/toolbar.ts";
import { EXPORT_DOCUMENT_EVENT } from "../../../../core/shell/shellEventNames.ts";
import { getEditorVisibility } from "../../../../core/edit/state/visibility.ts";
import { editorChromeCommands } from "../../../contracts/editorCommands.ts";
import { SHORTCUT_CATEGORIES } from "../../../../core/shortcuts/categories.ts";

/**
 * The File action group.
 *
 * `label` and `tooltip` are message keys, not text: the toolbar, its tooltips,
 * and the shortcut editor all resolve them through the same catalog entry.
 */
export function registerFileActions() {
  return [
    toolbar.register({
      kind: "action",
      id: "file.new",
      group: "file",
      order: 1,
      row: 2,
      icon: "new",
      label: "chrome.menu.file.new",
      tooltip: "chrome.menu.file.new",
      shortcuts: [{ key: "N", modifiers: ["CTRL"] }],
      shortcutCategory: SHORTCUT_CATEGORIES.file,
      shortcutScope: "app",
      run: () => editorChromeCommands()?.documents.newDocument(),
    }),
    toolbar.register({
      kind: "action",
      id: "file.open",
      group: "file",
      order: 2,
      row: 2,
      icon: "open",
      label: "chrome.menu.file.open",
      tooltip: "chrome.menu.file.open",
      shortcuts: [{ key: "O", modifiers: ["CTRL"] }],
      shortcutCategory: SHORTCUT_CATEGORIES.file,
      shortcutScope: "app",
      run: () => editorChromeCommands()?.documents.openDocument(),
    }),
    toolbar.register({
      kind: "action",
      id: "document.save",
      group: "file",
      order: 3,
      row: 2,
      toolbar: false,
      icon: "save",
      label: "common.action.save",
      tooltip: "common.action.save",
      shortcuts: [{ key: "S", modifiers: ["CTRL"] }],
      shortcutId: "document.save",
      shortcutScope: "app",
      enabled: () => !getEditorVisibility().atHome,
      run: () => editorChromeCommands()?.documents.saveDocument(),
    }),
    toolbar.register({
      kind: "action",
      id: "file.export",
      group: "file",
      order: 3.5,
      row: 2,
      icon: "export",
      label: "editor.dialogs.exportDialog.title",
      tooltip: "editor.dialogs.exportDialog.title",
      enabled: () => !getEditorVisibility().atHome,
      run: () => window.dispatchEvent(new Event(EXPORT_DOCUMENT_EVENT)),
    }),
    toolbar.register({
      kind: "divider",
      id: "toolbar.rule.file",
      order: 4,
      row: 2,
    }),
    toolbar.register({
      kind: "action",
      id: "document.close",
      group: "document",
      order: 60,
      separatorBefore: true,
      icon: "home",
      label: "chrome.menu.file.closeDocument",
      tooltip: "chrome.menu.file.closeDocumentHint",
      enabled: () => !getEditorVisibility().atHome,
      run: () => editorChromeCommands()?.documents.closeDocument(),
    }),
  ];
}
