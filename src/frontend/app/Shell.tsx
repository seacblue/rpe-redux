/**
 * The desktop window frame: title bar, toolbar, workbench or start page, status
 * bar, and the overlay hosts mounted outside the workspace.
 */
import { memo, useEffect, useState, useSyncExternalStore } from "react";
import { TitleBar } from "../chrome/topbar/TitleBar.tsx";
import { WindowResizeHandles } from "../chrome/WindowResizeHandles.tsx";
import { Toolbar } from "../chrome/toolbar/Toolbar.tsx";
import { registerBuiltins } from "../chrome/topbar/registerBuiltins.ts";
import { toolbar } from "../../core/shell/registries/toolbar.ts";
import { TOOLBAR_REFRESH_EVENT } from "../../core/shell/shellEventNames.ts";
import { Workbench } from "./Workbench.tsx";
import { activeSurface } from "./modeRegistry.ts";
import { connectEditorChromeHost } from "../screens/editor/workspace/runtime/composition/editorChromeHost.ts";
import { WelcomePage } from "../screens/welcome/WelcomePage.tsx";
import { StatusBar } from "../chrome/statusbar/StatusBar.tsx";
import { TimelineMenu } from "../screens/editor/workspace/timeline/contextMenu/TimelineMenu.tsx";
import {
  getEditorVisibility,
  subscribeToEditorVisibility,
} from "../../core/edit/state/visibility.ts";
import { PerformanceHud } from "../overlays/performance/PerformanceHud.tsx";
import { InputOverlays } from "../screens/editor/workspace/stage/inputOverlays/InputOverlays.tsx";
import { CoverBackdrop } from "./CoverBackdrop.tsx";

// Bind the editor's chrome commands before the actions that call them are
// registered. The rail's own buttons come with the panes: each one registers
// its action and its button from
// `frontend/screens/editor/inspector/inspectorShell.ts`.
const unregisterEditorHost = connectEditorChromeHost();
const unregister = registerBuiltins();
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    unregister();
    unregisterEditorHost();
  });
}

/**
 * The window frame: top bar, sibling toolbar (including chart progress), editor
 * workspace, start page, and status bar. The workspace itself draws the chart.
 */
export const Shell = memo(function Shell() {
  const [welcomeCoverUrl, setWelcomeCoverUrl] = useState("");
  const editorVisibility = useSyncExternalStore(
    subscribeToEditorVisibility,
    getEditorVisibility,
    getEditorVisibility,
  );
  useEffect(() => {
    const refreshToolbar = () => toolbar.refresh();
    window.addEventListener(TOOLBAR_REFRESH_EVENT, refreshToolbar);
    return () => {
      window.removeEventListener(TOOLBAR_REFRESH_EVENT, refreshToolbar);
    };
  }, []);
  // Focus rings stay hidden for pointer and Space/Enter activation; the global
  // focus policy still shows them for Tab navigation.
  return (
    <>
      <WindowResizeHandles />
      {editorVisibility.atHome && <CoverBackdrop scope="welcome" url={welcomeCoverUrl} />}
      <TitleBar />
      <div className="shell-body">
        <Toolbar rows={activeSurface.toolbarRows} />
        <div className="shell-content">
          <div className="theme-ambient" aria-hidden="true" />
          <Workbench atHome={editorVisibility.atHome} />
          <WelcomePage onCoverUrlChange={setWelcomeCoverUrl} />
        </div>
        <StatusBar hidden={editorVisibility.atHome} />
      </div>
      <TimelineMenu />
      <InputOverlays />
      <PerformanceHud />
    </>
  );
});
