/**
 * Judge-line page: the compact Inspector stack and the expanded line workspace.
 *
 * The tree, selection, bulk fields, texture picker, and folder operations are the
 * same components in both layouts. The compact page stacks tree above form; the
 * workspace shows both columns at full height.
 */
import { useCallback, useEffect, useSyncExternalStore } from "react";
import { useTranslation } from "../../../../../i18n/react.ts";
import { values } from "../../../../../core/state/values.ts";
import { lineGroupLabels } from "../../../editor/workspace/lineLabels.ts";
import {
  useEditorRuntime,
  useEditorRuntimeValue,
} from "../../../editor/workspace/runtime/composition/EditorRuntime.tsx";
import { useEditorSession } from "../../../editor/workspace/runtime/providers/SessionProvider.tsx";
import { useInspectorRuntime } from "../../../editor/workspace/runtime/providers/InspectorProvider.tsx";
import {
  registerWorkspaceMode,
  type WorkspaceModeDefinition,
} from "../../../editor/workspace/container/workspaceModes.ts";
import { registerInspectorPanel } from "../../../editor/inspector/controller.ts";
import { registerInspectorSidebar } from "../../../editor/inspector/inspectorShell.ts";
import {
  getEditorVisibility,
  subscribeToEditorVisibility,
} from "../../../../../core/edit/state/visibility.ts";
import { LinesPanel } from "./LinesPanel.tsx";
import type { LinePanelSnapshot } from "./model.ts";
import { GLOBAL_PAGE_TUTORIALS } from "../../tutorials.ts";

const hasDocument = {
  get: () => getEditorVisibility().hasDocument,
  subscribe: subscribeToEditorVisibility,
};

const EMPTY_SELECTION: readonly number[] = Object.freeze([]);

/** The toolbar-owned line selection, used for the workspace summary. */
function useSharedLineSelection(): readonly number[] {
  return useSyncExternalStore(
    useCallback((listener) => values.byId.subscribe("editor.lineSelection", listener), []),
    useCallback(
      () => values.byId.get<readonly number[]>("editor.lineSelection") ?? EMPTY_SELECTION,
      [],
    ),
    () => EMPTY_SELECTION,
  );
}

/**
 * Keeps the line-panel snapshot bound to the installed session.
 *
 * The tree and form are two faces of one panel instance, so the page runs the
 * panel's render lifecycle once for whichever layout is mounted.
 */
function useLinePanelBinding(): LinePanelSnapshot | null {
  const runtime = useEditorRuntime();
  const inspector = useInspectorRuntime();
  const sessionRuntime = useEditorSession();
  const linePanel = useEditorRuntimeValue(
    (current) => current.ui.linePanel,
    null as LinePanelSnapshot | null,
  );
  const session = useSyncExternalStore(
    sessionRuntime.subscribe,
    () => sessionRuntime.current,
    () => sessionRuntime.current,
  );
  useEffect(() => {
    if (!runtime || !inspector) {
      return;
    }
    let frame = 0;
    const render = () => inspector.linePanel.render();
    const schedule = () => {
      if (frame) {
        return;
      }
      frame = requestAnimationFrame(() => {
        frame = 0;
        render();
      });
    };
    render();
    session.addEventListener("change", schedule);
    return () => {
      if (frame) {
        cancelAnimationFrame(frame);
      }
      session.removeEventListener("change", schedule);
    };
  }, [runtime, inspector, session]);
  return linePanel;
}

/** One judge-line page at the compact or workspace layout. */
function LinesPage({ layout }: { layout: "compact" | "workspace" }) {
  useLinePanelBinding();
  return <LinesPanel showTitle={false} variant={layout === "workspace" ? "split" : "stacked"} />;
}

/** The compact page: the tree above the selected line's properties. */
function LinesInspectorPage() {
  return <LinesPage layout="compact" />;
}

/** The expanded workspace summary and full-height tree/form columns. */
function LinesStudio() {
  const { t } = useTranslation();
  const linePanel = useEditorRuntimeValue(
    (runtime) => runtime.ui.linePanel,
    null as LinePanelSnapshot | null,
  );
  const selected = useSharedLineSelection();
  const chart = linePanel?.props.session.chart;
  const lines = chart?.judgeLineList ?? [];
  const groups = chart ? lineGroupLabels(chart).length : 0;
  const selectedCount = lines.length
    ? Math.max(1, Math.min(selected.length || 1, lines.length))
    : 0;
  return (
    <div className="lines-studio">
      <div className="studio-summary">
        <strong>{t("chrome.linesStudio.lines", { count: lines.length })}</strong>
        <span className="studio-summary-separator" aria-hidden="true" />
        <span>{t("chrome.linesStudio.groups", { count: groups })}</span>
        <span className="studio-summary-separator" aria-hidden="true" />
        <span>{t("chrome.linesStudio.selected", { count: selectedCount })}</span>
      </div>
      <LinesPage layout="workspace" />
    </div>
  );
}

const mode: WorkspaceModeDefinition = {
  id: "lines",
  order: 30,
  label: "chrome.pane.lines",
  icon: "grid",
  component: LinesStudio,
  requiresDocument: true,
};

const disposePanel = registerInspectorPanel({
  id: "lines",
  component: LinesInspectorPage,
  label: "chrome.pane.lines",
  icon: "grid",
  tutorial: GLOBAL_PAGE_TUTORIALS.lines,
  workspaceMode: "lines",
  editsChart: true,
});

const disposeSidebar = registerInspectorSidebar({
  id: "lines",
  order: 30,
  panelId: "lines",
  icon: "grid",
  label: "chrome.pane.lines",
  domId: "lines-pane",
  visibility: hasDocument,
});

const disposeMode = registerWorkspaceMode(mode);

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    disposeMode();
    disposeSidebar();
    disposePanel();
  });
}
