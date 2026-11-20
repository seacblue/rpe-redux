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
import { Splitter } from "../../design/components/splitter/Splitter.tsx";
import { useTranslation } from "../../i18n/react.ts";
import {
  useLayoutProportions,
  useLayoutRegion,
  useViewportSize,
} from "./layout/useLayoutProportions.ts";
import { LayoutEditor } from "../overlays/layoutEditor/LayoutEditor.tsx";
import { followSavedArrangement, syncPaintedLayout } from "../../core/shell/layoutEditorState.ts";

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
  const { t } = useTranslation();
  const [welcomeCoverUrl, setWelcomeCoverUrl] = useState("");
  useLayoutProportions();
  const viewport = useViewportSize();
  const toolbarSeam = useLayoutRegion("toolbar", viewport);
  const statusbarSeam = useLayoutRegion("statusbar", viewport);
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
  // The chrome paints the saved arrangement from the first frame, and follows it
  // afterwards: the durable preferences arrive from SQLite after this mount, so a
  // one-shot read would keep showing the authored layout for the whole session.
  useEffect(() => {
    syncPaintedLayout();
    return followSavedArrangement();
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
        <Splitter
          orientation="horizontal"
          className="layout-splitter--toolbar"
          label={t("chrome.splitter.toolbar")}
          value={toolbarSeam.value}
          min={toolbarSeam.min}
          max={toolbarSeam.max}
          defaultValue={toolbarSeam.defaultValue}
          onChange={toolbarSeam.setPixels}
        />
        <div className="shell-content">
          <div className="theme-ambient" aria-hidden="true" />
          <Workbench atHome={editorVisibility.atHome} />
          <WelcomePage onCoverUrlChange={setWelcomeCoverUrl} />
        </div>
        <StatusBar hidden={editorVisibility.atHome} />
        <Splitter
          orientation="horizontal"
          className="layout-splitter--statusbar"
          label={t("chrome.splitter.statusbar")}
          value={statusbarSeam.value}
          min={statusbarSeam.min}
          max={statusbarSeam.max}
          defaultValue={statusbarSeam.defaultValue}
          onChange={statusbarSeam.setPixels}
          invert
        />
      </div>
      <TimelineMenu />
      <InputOverlays />
      <PerformanceHud />
      <LayoutEditor />
    </>
  );
});
