/** Owns inspector panes, their shared editor adapters, and inspector lifecycle. */
import { createContext, useContext, type ReactNode } from "react";
import { t } from "../../../../../../i18n/index.ts";
import type { AssetMap } from "../../../../../../core/global/document/types.ts";
import type { Chart } from "../../../../../../core/global/chart/chart.ts";
import {
  assetNames,
  missingChartResources,
} from "../../../../../../core/global/document/resources.ts";
import type { EditorSession } from "../../../../../../core/edit/session/session.ts";
import { EventIssueMonitor } from "../../../../../../core/edit/validation/eventIssueMonitor.ts";
import {
  readChartIssueScanOptions,
  readChartIssuesEnabled,
  readChartIssuesScanDelay,
  subscribeChartIssueSettings,
} from "../../../../../../core/edit/validation/chartIssueSettings.ts";
import { ChartIssueWorkerClient } from "./chartIssueWorker.ts";
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
import { flushBeatFieldScope } from "../../../inspector/beat/BeatField.tsx";
import { clearNoteDraftSelection } from "../../../inspector/notes/noteInspector.ts";
import { clearEventDraftSelection } from "../../../inspector/events/EventField.tsx";
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
import type { ChartIssue } from "../../../../../../core/edit/validation/chartIssueTypes.ts";

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
  // The monitor follows the active session, but the scan runs in a worker: a
  // session notification only schedules one, and a burst of edits collapses
  // into a single scan of the newest chart.
  const issueWorker = new ChartIssueWorkerClient();
  const eventIssues = new EventIssueMonitor((input) => issueWorker.scan(input));
  let issueSession: EditorSession | null = null;
  let issueTimer: number | null = null;
  let issueSettings: (() => void) | null = null;
  /** The full snapshot produced for the current paged document, if any. */
  let issueSnapshot: { document: unknown; revision: number; chart: Chart } | null = null;
  /**
   * Return the chart a scan must read.
   *
   * A library document pages its lines: an unloaded line is a placeholder with
   * empty notes and events, and its marker is a process-local Symbol that does
   * not survive a worker post. Scanning the facade would therefore report a
   * clean chart. A paged document is materialized per content revision, and the
   * scan reads that snapshot until the document changes.
   */
  const issueChart = async (session: EditorSession): Promise<Chart> => {
    const document = session.chartDocument;
    if (!document) {
      return session.chart;
    }
    const revision = session.contentRevision;
    if (issueSnapshot?.document === document && issueSnapshot.revision === revision) {
      return issueSnapshot.chart;
    }
    const chart = await document.materializeAll();
    issueSnapshot = { document, revision, chart };
    issueWorker.resetLines();
    return chart;
  };
  const scanEventIssues = () => {
    issueTimer = null;
    // Switching the check off has to withdraw what it already published: the
    // badge and the pane would otherwise keep showing a stale result.
    if (!readChartIssuesEnabled()) {
      eventIssues.clear();
      return;
    }
    const session = issueSession;
    if (!session) {
      return;
    }
    const missingResourceIssues: ChartIssue[] =
      readChartIssueScanOptions().checks["missing-resource"] === false
        ? []
        : missingChartResources(
            session.chart,
            options.document.assets,
            options.document.chartName,
          ).map((resource) => ({
            kind: "missing-resource",
            severity: "fatal",
            target: "resource",
            id: `missing-resource:${resource.name}`,
            lineIndex: -1,
            lineId: "",
            lineName: "",
            layer: -1,
            extended: false,
            track: "",
            firstEventIndex: -1,
            secondEventIndex: -1,
            firstEventId: "",
            secondEventId: "",
            startTime: [0, 0, 1] as [number, number, number],
            endTime: [0, 0, 1] as [number, number, number],
            startSeconds: 0,
            endSeconds: 0,
            beat: 0,
            endBeat: 0,
            resourceName: resource.name,
            resourceKind: resource.kind,
          }));
    eventIssues.setExternalIssues(missingResourceIssues);
    const document = session.chartDocument;
    if (!document) {
      eventIssues.request({
        chart: session.chart,
        options: readChartIssueScanOptions(),
      });
      return;
    }
    // The issue scan needs the whole line graph. A streamed document may still
    // be materializing while the session is installed, so wait for the next
    // publication after the last line lands.
    if (document.unloadedLineCount() > 0) {
      return;
    }
    // A paged chart needs an async materialize step first; the request is
    // dropped when the document moved on while the snapshot was built, because
    // the newest notification already scheduled its own scan.
    const revision = session.contentRevision;
    void issueChart(session)
      .then((chart) => {
        if (
          issueSession === session &&
          session.chartDocument === document &&
          session.contentRevision === revision &&
          readChartIssuesEnabled()
        ) {
          eventIssues.request({ chart, options: readChartIssueScanOptions() });
        }
      })
      .catch(() => undefined);
  };
  /** An edit settles before it is scanned, so a burst costs one scan. */
  const scheduleEventIssues = () => {
    if (issueTimer !== null) {
      window.clearTimeout(issueTimer);
    }
    const delay = readChartIssuesScanDelay();
    issueTimer = window.setTimeout(scanEventIssues, delay);
  };
  /**
   * A settings change is not an edit: the author is looking at the result and
   * expects the new threshold applied now, so the pending debounce is dropped
   * instead of waited out.
   */
  const rescanEventIssues = () => {
    if (issueTimer !== null) {
      window.clearTimeout(issueTimer);
      issueTimer = null;
    }
    scanEventIssues();
  };
  const bindIssueSession = () => {
    const next = getSession();
    if (next === issueSession) {
      return;
    }
    issueSession?.removeEventListener("change", scheduleEventIssues);
    issueSession = next;
    issueSession.addEventListener("change", scheduleEventIssues);
    scanEventIssues();
  };
  bindIssueSession();
  options.scope.add(options.session.subscribe(bindIssueSession));
  // A changed threshold or kind switch invalidates the published list, so the
  // rescan starts at once instead of waiting for the edit debounce.
  issueSettings = subscribeChartIssueSettings(rescanEventIssues);
  options.scope.add(() => {
    issueSession?.removeEventListener("change", scheduleEventIssues);
    issueSession = null;
    issueSettings?.();
    issueSettings = null;
    if (issueTimer !== null) {
      window.clearTimeout(issueTimer);
      issueTimer = null;
    }
    issueWorker.dispose();
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
  options.scope.add(options.session.subscribe(() => multiEdit.resetForDocument()));
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
  options.timeline.gestures.curveQuickPick = curveEditor.quickPick;
  options.timeline.gestures.curveGhost = curveEditor.ghost;
  options.scope.add(
    bindInspectorLifecycle("notes", {
      onClose: () => {
        const session = getSession();
        flushBeatFieldScope("notes", () => {
          session.noteDraftActive = false;
        });
        clearNoteDraftSelection(session);
      },
    }),
  );
  options.scope.add(
    bindInspectorLifecycle("events", {
      onClose: () => {
        const session = getSession();
        flushBeatFieldScope("events", () => {
          session.liveEventEdit = false;
        });
        clearEventDraftSelection(session);
      },
    }),
  );
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
