/**
 * Restores and samples the last workspace session for the editor composition.
 *
 * The runtime maps the live session and viewport to the small preference
 * record, giving the composition root one object to wire.
 */
import { values, type ValueCell } from "../../../../../core/state/values.ts";
import { loadingProgress } from "../../../../../core/global/document/loading.ts";
import { localService } from "../../../../../core/global/library/service.ts";
import {
  openLibraryProject,
  openLibraryChartDocument,
} from "../../../../../core/global/library/document.ts";
import type { AssetMap, EditorCandidate } from "../../../../../core/global/document/types.ts";
import type { EditorSession } from "../../../../../core/edit/session/session.ts";
import type { TauriDocumentStore } from "../../../../../core/platform/desktop/documentStore.ts";
import type { WorkspaceDocumentState } from "../runtime/providers/DocumentProvider.tsx";
import type { TimelineViewport } from "../timeline/viewport/timelineViewport.ts";
import { libraryCandidate, libraryDocumentCandidate } from "../document/open/libraryCandidate.ts";
import { createExternalResourceOpenSession } from "../document/open/externalResourceOpen.ts";
import {
  clearWorkspaceSession,
  readWorkspaceSession,
  type WorkspaceSession,
  type WorkspaceSessionDocument,
  type WorkspaceSessionPanels,
  type WorkspaceSessionView,
} from "../../../../../core/edit/session/workspaceSession.ts";
import { createWorkspaceSessionKeeper } from "./workspaceSessionKeeper.ts";
import { closeInspector, openInspector } from "../../inspector/controller.ts";
import { setChartInfoExpanded } from "../../../../chrome/statusbar/chartInfoPresenter.ts";
import { getDrawerState, openDrawerPane } from "../../../../chrome/drawer/drawerPanes.ts";

/** Editor services the workspace-session record reads and restores. */
export interface WorkspaceSessionRuntimeDependencies {
  documents: TauriDocumentStore | null;
  hasDocument(): boolean;
  document: Pick<WorkspaceDocumentState, "chartName" | "libraryProject">;
  session(): EditorSession;
  viewport: TimelineViewport;
  chartSeconds(): number;
  activeInspector: ValueCell<string>;
  getChartInfoExpanded(): boolean;
  seek(seconds: number): void;
  loadCandidate(candidate: EditorCandidate, assets: AssetMap): Promise<void>;
  invalidate(): void;
  renderSession(): void;
}

/** Restores, samples, and clears the last workspace session. */
export interface WorkspaceSessionRuntime {
  restore(): Promise<void>;
  clear(): void;
  dispose(): void;
}

/** Bind the last-session record to the live editor and the desktop document host. */
export function createWorkspaceSessionRuntime(
  deps: WorkspaceSessionRuntimeDependencies,
): WorkspaceSessionRuntime {
  const documentRef = (): WorkspaceSessionDocument | null => {
    // A saved library reference is the durable identity even when the native
    // store is still mounted for a document imported from a file.
    const id = deps.document.libraryProject?.id;
    if (id) {
      return { kind: "project", id, name: deps.document.chartName };
    }
    const path = deps.documents?.current?.path;
    return path ? { kind: "path", path, name: deps.document.chartName } : null;
  };

  /** Captures the playhead, line, and multi-line view state to persist. */
  const view = (): WorkspaceSessionView => {
    const current = deps.session();
    const viewport = deps.viewport;
    return {
      playheadSeconds: Math.max(0, deps.chartSeconds()),
      originBeat: viewport.origin,
      lineIndex: current.lineIndex,
      multiLine: {
        enabled: current.multiLineEnabled,
        mode: current.multiLineMode,
        merge: current.multiLineMerge,
        indices: [...current.multiLineIndices],
      },
      multiLineScroll:
        typeof viewport.multiLineScroll === "number"
          ? viewport.multiLineScroll
          : { ...viewport.multiLineScroll },
      multiLineZoom: { ...viewport.multiLineZoom },
    };
  };

  /** Captures the open panel state to persist. */
  const panels = (): WorkspaceSessionPanels => {
    const drawer = getDrawerState();
    return {
      activeInspector: deps.activeInspector.get(),
      chartInfoExpanded: deps.getChartInfoExpanded(),
      drawerPane: drawer.open ? drawer.pane : undefined,
      drawerOpen: drawer.open,
    };
  };

  const openWithExternalResources = deps.documents
    ? createExternalResourceOpenSession((path, options) => deps.documents!.open(path, options))
    : null;

  const keeper = createWorkspaceSessionKeeper({
    hasDocument: deps.hasDocument,
    document: documentRef,
    view,
    panels,
  });

  /** Opens a native document path and installs its candidate. */
  const openPath = async (path: string): Promise<boolean> => {
    if (!openWithExternalResources) {
      return false;
    }
    const opened = await openWithExternalResources(path);
    await deps.loadCandidate(opened.candidate, opened.assets);
    return true;
  };

  /** Reopens the saved project, falling back to its native path. */
  const openSavedDocument = async (saved: WorkspaceSession): Promise<boolean> => {
    const reference = saved.documentRef;
    if (reference.kind === "path" && reference.path) {
      return openPath(reference.path);
    }
    if (!reference.id) {
      return false;
    }
    const found = await localService();
    if (!found) {
      return false;
    }
    if (found.library.supportsChartStream()) {
      try {
        const opened = await openLibraryChartDocument(found.library, reference.id);
        await deps.loadCandidate(
          libraryDocumentCandidate(opened.project, reference.id, opened.chartDocument),
          opened.assets,
        );
        return true;
      } catch {
        // Older services and malformed streams fall back to the whole-project
        // read so session restore keeps its existing recovery path.
      }
    }
    const opened = await openLibraryProject(found.library, reference.id);
    if (!opened.project) {
      return reference.path ? openPath(reference.path) : false;
    }
    await deps.loadCandidate(libraryCandidate(opened.project, reference.id), opened.assets);
    return true;
  };

  /** Applies saved playhead, viewport, selection, and panel state. */
  const applyView = (saved: WorkspaceSession): void => {
    const current = deps.session();
    const offset = Number(current.chart.META.offset ?? 0) / 1000;
    deps.seek(Math.max(0, saved.view.playheadSeconds + offset));
    deps.viewport.setOrigin(saved.view.originBeat, "session");
    const line = saved.view.lineIndex;
    if (Number.isInteger(line) && current.chart.judgeLineList?.[line]) {
      current.selectLine(line);
    }
    const indices = saved.view.multiLine.indices.filter(
      (index) => current.chart.judgeLineList?.[index],
    );
    current.setMultiLineSelection(indices);
    current.setMultiLineMode(saved.view.multiLine.mode);
    current.setMultiLineMerge(saved.view.multiLine.merge);
    if (saved.view.multiLineZoom) {
      deps.viewport.setMultiLineZoom("notes", saved.view.multiLineZoom.notes);
      deps.viewport.setMultiLineZoom("events", saved.view.multiLineZoom.events);
    }
    if (saved.view.multiLineScroll !== undefined) {
      deps.viewport.multiLineScroll = saved.view.multiLineScroll;
    }
    if (saved.panels.activeInspector) {
      openInspector(saved.panels.activeInspector, deps.activeInspector);
    } else {
      closeInspector(deps.activeInspector);
    }
    const savedDrawerPane = saved.panels.drawerPane;
    // Chart metadata used to be a drawer page. A session written before that
    // move still names it here; restore the visible intent as its inspector page
    // instead of leaving the inspector empty or selecting an unknown drawer id.
    const legacyMetadataDrawer = saved.panels.drawerOpen && savedDrawerPane === "metadata";
    if (legacyMetadataDrawer) {
      openInspector("metadata", deps.activeInspector);
    } else if (saved.panels.drawerOpen && savedDrawerPane) {
      // A restored drawer reopens visibly through the one drawer write entry;
      // a pane id that is no longer registered leaves it closed.
      openDrawerPane(savedDrawerPane);
    }
    setChartInfoExpanded(true);
    deps.invalidate();
    deps.renderSession();
  };

  /** Restores the last session when enabled; a missing document starts empty. */
  const restore = async (): Promise<void> => {
    if (!values.byId.get<boolean>("session-restore")) {
      return;
    }
    const saved = readWorkspaceSession();
    if (!saved) {
      return;
    }
    try {
      if (!(await openSavedDocument(saved))) {
        clearWorkspaceSession();
        return;
      }
      applyView(saved);
    } catch (error) {
      // A missing last document is a normal empty start; dismiss the loading
      // modal published before the store reported the failure.
      loadingProgress.dismiss();
      clearWorkspaceSession();
      console.warn("Unable to restore the last workspace session", error);
    }
  };

  return {
    restore,
    clear: keeper.clear,
    dispose: keeper.dispose,
  };
}
