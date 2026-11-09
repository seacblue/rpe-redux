/**
 * Navigation actions for workspace surfaces.
 *
 * Each action owns its run callback and its toolbar/sidebar placement. There is
 * no page-menu layer: library, resume, settings, and skins are ordinary actions.
 */
import { toolbar } from "../../../../core/shell/registries/toolbar.ts";
import { editorChromeCommands } from "../../../contracts/editorCommands.ts";
import { openSettings } from "../../../screens/settings/settingsWindowController.ts";
import { SHORTCUT_CATEGORIES } from "../../../../core/shortcuts/categories.ts";
import { getEditorVisibility } from "../../../../core/edit/state/visibility.ts";

/**
 * Workspace navigation actions, grouped by the task they serve.
 */
export function registerWorkspaceActions() {
  return [
    toolbar.register({
      kind: "action",
      id: "document.library",
      group: "document",
      order: 10,
      // The title-bar brand is the visible home affordance. The action stays
      // registered for its shortcut and the shortcut editor, but draws no button.
      toolbar: false,
      icon: "home",
      label: "chrome.menu.file.titleScreen",
      tooltip: "chrome.menu.file.titleScreen",
      shortcuts: [{ key: "H", modifiers: ["CTRL", "SHIFT"] }],
      shortcutCategory: SHORTCUT_CATEGORIES.workspace,
      shortcutScope: "workspace",
      enabled: () => !getEditorVisibility().atHome,
      run: () => editorChromeCommands()?.navigation.openLibrary(),
    }),
    toolbar.register({
      kind: "action",
      id: "workspace.settings",
      group: "app",
      order: 10,
      row: 1,
      icon: "settings",
      // The toolbar and File menu share this action so the shortcut stays stable.
      label: "chrome.settings.open",
      tooltip: "chrome.menu.file.settingsHint",
      shortcuts: [{ key: "K", modifiers: ["CTRL"] }],
      shortcutCategory: SHORTCUT_CATEGORIES.workspace,
      shortcutScope: "app",
      run: () => openSettings(),
    }),
    toolbar.register({
      kind: "action",
      id: "workspace.noteSkin",
      group: "workspace",
      order: 150,
      icon: "palette",
      label: "chrome.menu.tools.noteSkin",
      tooltip: "chrome.menu.tools.noteSkinHint",
      run: () => openSettings("appearance.skin"),
    }),
  ];
}
