/**
 * The View menu's two commands for the workspace layout editor.
 *
 * The toolbar and the rail are customized separately: each command opens the
 * overlay on its own surface and saves to its own preference key, so arranging
 * one never rewrites the other. Both are menu-only actions — the point is to
 * change the chrome, so they must not become one more thing to arrange.
 */
import { toolbar } from "../../../../core/shell/registries/toolbar.ts";
import { openLayoutEditor } from "../../../../core/shell/layoutEditorState.ts";

/** Register the two layout editor commands and return their disposers. */
export function registerLayoutEditorActions(): (() => void)[] {
  return [
    toolbar.register({
      kind: "action",
      id: "view.customizeToolbar",
      group: "workspace",
      order: 190,
      icon: "layout",
      label: "layoutEditor.toolbarMenuLabel",
      tooltip: "layoutEditor.toolbarMenuHint",
      run: () => openLayoutEditor("toolbar"),
    }),
    toolbar.register({
      kind: "action",
      id: "view.customizeSidebar",
      group: "workspace",
      order: 191,
      icon: "panelRight",
      label: "layoutEditor.sidebarMenuLabel",
      tooltip: "layoutEditor.sidebarMenuHint",
      run: () => openLayoutEditor("sidebar"),
    }),
  ];
}
