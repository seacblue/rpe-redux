/**
 * Tool actions that open no inspector pane.
 *
 * They join the shared tools category so the toolbar, context menus, and the
 * shortcut editor all see them; pane-backed tools register from the inspector
 * instead.
 */
import { toolbar } from "../../../../core/shell/registries/toolbar.ts";
import { getEditorVisibility } from "../../../../core/edit/state/visibility.ts";
import { openAudioAnalysis } from "../../../screens/settings/audio/analysisActions.ts";

/**
 * The tools that are not inspector panes.
 *
 * Inspector panels register their own action through `registerInspectorTool` in
 * `frontend/screens/editor/inspector/inspectorShell.ts`. Audio analysis opens the
 * settings window and draws on the timeline.
 */
export function registerToolsActions() {
  return [
    toolbar.register({
      kind: "action",
      id: "editor.audio-analysis-tool",
      group: "editor",
      order: 300,
      separatorBefore: true,
      label: "chrome.pane.audio",
      icon: "waves",
      tooltip: "chrome.pane.audio",
      // The rail has no button for it and the toolbar has its own control, so the
      // action lives in the shortcut editor alone.
      toolbar: false,
      run: openAudioAnalysis,
      enabled: () => {
        const visibility = getEditorVisibility();
        return visibility.hasDocument && !visibility.atHome;
      },
    }),
  ];
}
