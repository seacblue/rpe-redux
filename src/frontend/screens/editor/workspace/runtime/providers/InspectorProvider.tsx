/** Owns inspector panes, their shared editor adapters, and inspector lifecycle. */
import { createContext, useContext, type ReactNode } from "react";
import { t } from "../../../../../../i18n/index.ts";
import type { AssetMap } from "../../../../../../core/global/document/types.ts";
import { assetNames } from "../../../../../../core/global/document/resources.ts";
import type { EditorSession } from "../../../../../../core/edit/session/session.ts";
import { EventIssueMonitor } from "../../../../../../core/edit/validation/eventIssueMonitor.ts";
import type { EditorSessionRuntime } from "./SessionProvider.tsx";
import type { EditorTempoSource } from "../session/tempoSource.ts";
import type { EditorUiState } from "../composition/editorUiState.ts";
import type { EditorFeedback } from "../session/feedback.ts";
import type { ProjectImages } from "../../../../../../core/media/images.ts";
import type { TauriDocumentStore } from "../../../../../../core/platform/desktop/documentStore.ts";
import type { ResourceScope } from "../../../../../../core/utils/resourceScope.ts";
import type { Timeline } from "../../timeline/surface/timeline.ts";
import {
  openInspector,
  closeInspector,
  bindInspectorLifecycle,
} from "../../../inspector/controller.ts";
import {
  LinePanel,
  type LinePanelAsset,
} from "../../../../global/sections/lines/linePanelController.ts";
import { MultiEditPanel } from "../../../inspector/multiEdit/multiEdit.ts";
import { MultiLinePanel } from "../../../inspector/multiLine/MultiLinePanel.tsx";
import { TrajectoryPanel } from "../../../inspector/trajectory/trajectoryPanel.ts";
import { createAssetLibraryRuntime } from "../../../../global/sections/assets/assetLibraryRuntime.ts";
import { bumpCollaborationAssetRevision } from "../../../../../../core/collaboration/ui.ts";
import { createCurveEditor } from "../../../inspector/curveNotes/curveEditor.ts";
import { viewControls } from "../commands/viewControls.ts";
import type { EditorTimelineMode } from "../commands/viewControls.ts";
import { pickFiles } from "../../../../../platform/filePicker.ts";

/** The document fields the inspector panes read and mutate. */
export interface InspectorDocumentState {
  assets: AssetMap;
  assetFolders: Set<string>;
  chartName: string;
  markAssetDirty(): void;
}

/** Inspector panes, their shared adapters, and pane routing for one mount. */
export interface InspectorRuntime {
  readonly multiEdit: MultiEditPanel;
  readonly trajectoryPanel: TrajectoryPanel;
  readonly multiLinePanel: MultiLinePanel;
  readonly eventIssues: EventIssueMonitor;
  readonly linePanel: LinePanel;
  readonly assetLibrary: ReturnType<typeof createAssetLibraryRuntime>;
  readonly curveEditor: ReturnType<typeof createCurveEditor>;
  readonly activatePane: (name: string) => void;
  readonly closePane: () => void;
  readonly openMultiLinePanel: () => void;
  readonly showSingleTimeline: (mode: EditorTimelineMode) => void;
}

const InspectorRuntimeContext = createContext<InspectorRuntime | null>(null);

/** Publishes the inspector runtime to descendants, or null before it exists. */
export function InspectorProvider({
  runtime,
  children,
}: {
  runtime: InspectorRuntime | null;
  children: ReactNode;
}) {
  return (
    <InspectorRuntimeContext.Provider value={runtime}>{children}</InspectorRuntimeContext.Provider>
  );
}

/** Reads the inspector runtime, or null while it is not mounted. */
export function useInspectorRuntime(): InspectorRuntime | null {
  return useContext(InspectorRuntimeContext);
}

/** Builds the inspector panes and binds their lifecycle to the editor scope. */
export function createInspectorRuntime(options: {
  scope: ResourceScope;
  inspector: HTMLElement;
  trajectoryOverlay: HTMLCanvasElement;
  ui: EditorUiState;
  session: EditorSessionRuntime;
  timeline: Timeline;
  tempo: EditorTempoSource;
  document: InspectorDocumentState;
  images: ProjectImages;
  documents: TauriDocumentStore | null;
  invalidate(): void;
  notify: EditorFeedback["notify"];
  reportError: EditorFeedback["reportError"];
  renderSession(): void;
  persistEditor(): void;
}): InspectorRuntime {
  const getSession = () => options.session.current;
  // The monitor follows the active session. It returns early while the chart
  // object is unchanged, so selection-only notifications never scan the chart.
  const eventIssues = new EventIssueMonitor();
  let issueSession: EditorSession | null = null;
  const syncEventIssues = () => eventIssues.update(getSession().chart);
  const bindIssueSession = () => {
    const next = getSession();
    if (next === issueSession) {
      return;
    }
    issueSession?.removeEventListener("change", syncEventIssues);
    issueSession = next;
    issueSession.addEventListener("change", syncEventIssues);
    syncEventIssues();
  };
  bindIssueSession();
  options.scope.add(options.session.subscribe(bindIssueSession));
  options.scope.add(() => {
    issueSession?.removeEventListener("change", syncEventIssues);
    issueSession = null;
  });
  const activatePane = (name: string) => {
    if (name) {
      openInspector(name, options.ui.activeInspector);
    } else {
      closeInspector(options.ui.activeInspector);
    }
  };
  const closePane = () => activatePane("");
  const multiEdit = new MultiEditPanel(getSession, options.timeline, {
    state: options.ui.multiEdit,
    invalidate: options.invalidate,
    notify: options.notify,
    scrollInspectorToTop: () => {
      options.inspector.scrollTop = 0;
    },
  });
  const trajectoryPanel = new TrajectoryPanel(
    options.trajectoryOverlay,
    () => ({
      session: getSession(),
      timeline: options.timeline,
      tempo: options.tempo.get(),
      previewVisible: false,
    }),
    {
      invalidate: options.invalidate,
      notify: options.notify,
      activate: activatePane,
      setOverlayVisible: options.ui.trajectoryOverlay.set,
      state: options.ui.trajectoryPanel,
    },
  );
  const multiLinePanel = new MultiLinePanel(getSession, {
    state: options.ui.multiLinePanel,
    timeline: options.timeline,
    render: options.renderSession,
  });
  // Filled in once the asset library exists; the panel only calls it later.
  let addTexture = async (): Promise<string[]> => [];
  const linePanel = new LinePanel(getSession, {
    state: options.ui.linePanel,
    notify: options.notify,
    getAssets: (): LinePanelAsset[] => {
      const result: LinePanelAsset[] = [];
      const assets = options.document.assets;
      for (const name of assetNames(assets)) {
        const bytes = assets.get(name);
        if (bytes) {
          result.push({ name, bytes });
          continue;
        }
        const url = assets.uri?.(name);
        if (url) {
          result.push({ name, url });
        }
      }
      return result;
    },
    afterTexture: () =>
      options.images.load(getSession().chart, options.document.assets, options.document.chartName),
    onAddTexture: () => addTexture(),
  });
  const assetLibrary = createAssetLibraryRuntime({
    state: options.ui.assetLibrary,
    getSession,
    getAssets: () => options.document.assets,
    getAssetFolders: () => options.document.assetFolders,
    getChartName: () => options.document.chartName,
    attachAssets: (nextAssets) => options.documents?.assets?.attach(nextAssets),
    setAssets: (nextAssets) => {
      options.document.assets = nextAssets;
    },
    setAssetFolders: (nextFolders) => {
      options.document.assetFolders = nextFolders;
    },
    markDirty: options.document.markAssetDirty,
    onAssetsChanged: bumpCollaborationAssetRevision,
    images: options.images,
    notify: options.notify,
    renderSession: options.renderSession,
  });
  addTexture = async () => {
    const files = await pickFiles({ accept: "image/*", multiple: true });
    if (!files?.length) {
      return [];
    }
    const before = new Set(options.document.assets.keys());
    await assetLibrary.addFiles(files);
    // The library may have renamed a collision, so the keys it added are read
    // back from the document after the change.
    return [...options.document.assets.keys()].filter((name) => !before.has(name));
  };
  const curveEditor = createCurveEditor({
    getDivision: () => options.timeline.viewport.division,
    getNotes: () => getSession().notes,
    state: options.ui.curve,
    setPickMode: options.ui.curve.pickMode.set,
    activatePane: () => activatePane("curve"),
    showSingleNoteTimeline: () => viewControls.showSingleNoteTimeline(),
    closePane,
    invalidate: options.invalidate,
    notify: options.notify,
    reportError: options.reportError,
    commit: (notes) => {
      getSession().focus = "notes";
      getSession().eventSelection.clear();
      getSession().insertNotes(notes, t("editor.app.curve.commitGenerate"));
    },
  });
  options.timeline.gestures.curvePick = curveEditor.pick;
  options.timeline.gestures.curvePickPoint = curveEditor.pickPoint;
  options.timeline.gestures.curveGhost = curveEditor.ghost;
  options.scope.add(() => closeInspector(options.ui.activeInspector));
  options.scope.add(bindInspectorLifecycle("multi", { onClose: () => multiEdit.hide() }));
  // Panes stay mounted while hidden, so leaving the curve pane must end its
  // draft; otherwise the timeline keeps painting a ghost for an invisible editor.
  options.scope.add(bindInspectorLifecycle("curve", { onClose: () => curveEditor.deactivate() }));
  options.scope.add(
    bindInspectorLifecycle("trajectory", { onClose: () => trajectoryPanel.hide() }),
  );
  options.scope.add(
    bindInspectorLifecycle("multi-line", { onOpen: () => multiLinePanel.render() }),
  );
  options.scope.add(() => options.ui.bpmForm.clear());
  activatePane(options.ui.activeInspector.get());
  return {
    multiEdit,
    trajectoryPanel,
    multiLinePanel,
    eventIssues,
    linePanel,
    assetLibrary,
    curveEditor,
    activatePane,
    closePane,
    openMultiLinePanel: () => activatePane("multi-line"),
    showSingleTimeline: (mode) => viewControls.showSingleTimeline(mode),
  };
}
