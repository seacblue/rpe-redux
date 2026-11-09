/**
 * Composes the live editor runtime from document, playback, preview, timeline,
 * inspector, and shell providers.
 *
 * This is the composition root: it supplies providers with the current session
 * and feature-local surfaces, connects core APIs, and registers teardown in one scope.
 * Feature modules own behavior; this file defines no other state store or React tree.
 */
/* eslint-disable max-lines -- the composition root wires feature modules; behavior lives in them. */
import {
  collaborationPreparing,
  collaborationRoom,
  roomNeedsExitConfirmation,
} from "../../../../../../core/collaboration/ui.ts";
import { createTimelineEventAction } from "../../timeline/events/eventActions.ts";
import { createTimelineMarkers, createTimelineOverview } from "../providers/TimelineProvider.tsx";
import { createPlaybackRuntime } from "../providers/PlaybackProvider.tsx";
import { createPreviewRuntime } from "../providers/PreviewProvider.tsx";
import { createTimelineRuntime } from "../providers/TimelineProvider.tsx";
import { createInspectorRuntime } from "../providers/InspectorProvider.tsx";
import { createDocumentRuntime } from "../providers/DocumentProvider.tsx";
import { openAssets as openDocumentAssets } from "../../document/lifecycle/service.ts";
import type { EditorSurfaces } from "./editorSurfaces.ts";
import type { Chart } from "../../../../../../core/global/chart/chart.ts";
import type { AssetMap } from "../../../../../../core/global/document/types.ts";
import { disposeProperties } from "../../../inspector/notes/noteInspector.ts";
import { requestConfirm, requestExitChoice } from "../../../../../overlays/modals/prompts.ts";
import { MODAL_PRIORITY } from "../../../../../overlays/modals/modalQueue.ts";
import { registerEditorShortcuts } from "../../../../../../core/edit/shortcuts/shortcutCatalog.ts";
import { t } from "../../../../../../i18n/index.ts";
import { bindClipboardHistoryPersistence } from "../../../../../../core/edit/clipboard/clipboardHistoryPersistence.ts";
import { openInspector, closeInspector } from "../../../inspector/controller.ts";
import { nudgeBeat, type Beat } from "../../../../../../core/global/chart/timing/beat.ts";
import { createEditorHomeRuntime } from "../../../../welcome/editorHome.ts";
import { connectRpeImport } from "../../../../welcome/rpeImportService.ts";
import { connectExternalImport } from "../../../../welcome/externalImportService.ts";
import { bindWorkspaceNavigation } from "../commands/workspaceNavigation.ts";
import {
  getEditorRegionSnapshot,
  showsAuthoringRegion,
  viewControls,
} from "../commands/viewControls.ts";
import { EditorEditClock } from "../../../../../../core/edit/state/editClock.ts";
import { EditorChartInfoPresenter } from "../../../../../chrome/statusbar/chartInfoPresenter.ts";
import {
  bindBrowserLifecycle,
  bindDesktopLifecycle,
} from "../../../../../platform/desktopLifecycle.ts";
import { bindEditorWindowEvents } from "../../../../../platform/windowEvents.ts";
import { preferences } from "../../../../../../core/state/preferences.ts";
import { getDrawerState } from "../../../../../chrome/drawer/drawerPanes.ts";
import { createWorkspaceSessionRuntime } from "../../session/workspaceSessionRuntime.ts";
import { bindCurveActions } from "../../../inspector/curveNotes/actions.ts";
import { bindTrajectoryAction } from "../../../inspector/trajectory/actions.ts";
import { bindAnalysisActions } from "../../../../settings/audio/analysisActions.ts";
import { connectTransport } from "../commands/transport.ts";
import {
  persistEditorSettings,
  readEditorRefreshRate,
} from "../../../../settings/editorDisplaySettings.ts";
import { bindTimelineNavigation } from "../../timeline/interaction/timelineNavigation.ts";
import { stageWheelAction } from "../../timeline/interaction/stageWheelOwnership.ts";
import { freeCameraState } from "../../stage/freeCamera/freeCamera.ts";
import { curvePreviewMode } from "../../../curveEvents/mode.ts";
import { samplingSession } from "../../../sampling/samplingSession.ts";
import {
  TimelineZoomAnimator,
  timelineZoomFactor,
} from "../../timeline/interaction/timelineZoom.ts";
import { bindTimelineMarkerResize } from "../../../../../chrome/transport/timelineMarkerResize.ts";
import { TimelineMarkers } from "../../../../../chrome/transport/TimelineMarkers.tsx";
import {
  getEditorVisibility,
  setEditorVisibility,
} from "../../../../../../core/edit/state/visibility.ts";
import { displayValues } from "../../../../settings/editorDisplaySettings.ts";
import { values } from "../../../../../../core/state/values.ts";
import {
  editorLine,
  editorLineSelection,
  editorScale,
} from "../../../../../../core/edit/state/publishedValues.ts";
import { connectHitTestApi } from "../../../../../../core/edit/hitTest/api.ts";
import { connectPreviewApi } from "../../../../../../core/edit/preview/api.ts";
import { connectLayoutApi } from "../../../../../../core/edit/layout/api.ts";

import { isDesktop } from "../../../../../../core/platform/environment.ts";
import { TauriDocumentStore } from "../../../../../../core/platform/desktop/documentStore.ts";
import { ResourceScope } from "../../../../../../core/utils/resourceScope.ts";
import type { EditorCandidate } from "../../../../../../core/global/document/types.ts";
import type { LoadTask } from "../../../../../../core/global/document/loading.ts";
import type { LibraryProjectRef } from "../../../../../../core/global/library/types.ts";
import { createEditorFrameRuntime } from "../frame/frameRuntime.ts";
import { createEditorSessionRenderer } from "../bridge/sessionRenderer.ts";
import { serializeChartOffThread } from "../../document/save/chartSerializeOffThread.ts";
import { bindCurrentDocumentStore } from "../../../../../platform/documentStoreHandle.ts";
import { bindEditorPlayback } from "../../preview/playback/playbackBindings.ts";
import { bindEditorSelection } from "../bindings/selectionBindings.ts";
import { createEditorFeedback } from "../session/feedback.ts";
import { clearToasts } from "../../../../../../design/patterns/ToastHost.tsx";
import { getChartInfoExpanded } from "../../../../../chrome/statusbar/chartInfoPresenter.ts";
import { bindEditorInteractions } from "../bindings/editorBindings.ts";
import { canvasShortcutTarget } from "../input/canvasShortcutTarget.ts";
import type { CanvasShortcutTarget } from "../../../../../platform/shortcuts/canvasShortcuts.ts";
import type { PrefixDigitSequenceSubmission } from "../../../../../../core/shortcuts/prefixDigitSequence.ts";
import { bindEditorLanguageRefresh } from "../bindings/languageRefresh.ts";
import { createHitTestPicker, createPreviewGeometryReader } from "../bindings/hitTestBindings.ts";
import { createPreviewApiHost } from "../bindings/previewBindings.ts";
import { createLayoutApiHost } from "../bindings/layoutBindings.ts";
import { bindPreviewSelection } from "../../preview/interaction/previewSelection.ts";
import { createEditorRuntime, type EditorRuntime } from "./EditorRuntime.tsx";
import { createEditorUiState } from "./editorUiState.ts";
import type { EditorSessionRuntime } from "../providers/SessionProvider.tsx";
registerEditorShortcuts();

/** Builds the editor's services, bindings, and providers for one mounted session. */
export function createEditorAssembly(
  surfaces: EditorSurfaces,
  session: EditorSessionRuntime,
): { runtime: EditorRuntime } {
  const documents = isDesktop() ? new TauriDocumentStore(serializeChartOffThread) : null;
  const scope = new ResourceScope();
  scope.add(bindCurrentDocumentStore(documents));
  const ui = createEditorUiState();
  const runtimeValues = {
    scrollSpeed: values.getHandle<string | undefined>("scroll-speed"),
    autosaveEnabled: values.getHandle<boolean>("autosave-enabled"),
    autosaveSeconds: values.getHandle<string | undefined>("autosave-seconds"),
  };
  const frameRuntime = createEditorFrameRuntime();
  const { invalidate } = frameRuntime;
  // Canvas colours are not CSS: the timeline and preview keep their own palette
  // cache, so a theme switch schedules one more editor frame after the document
  // properties change.
  scope.listen(window, "redux-theme", () => invalidate());
  scope.add(() => disposeProperties(ui.notes));
  scope.add(() => ui.events.clear());
  scope.add(() => ui.curve.fields.set(null));
  const documentState = {
    /** Assets decoded for the open chart, keyed by chart resource name. */
    assets: new Map() as AssetMap,
    /** Folder metadata used by the asset inspector. */
    assetFolders: new Set<string>(),
    /** Whether an asset mutation still needs persistence. */
    assetDirty: false,
    /** Display name used when no library project supplies one. */
    chartName: "chart.json",
    /** Library record associated with the current document, if any. */
    libraryProject: null as LibraryProjectRef | null,
    /** Last draft kept for the unsaved-document recovery path. */
    lastDraftDocument: undefined as Chart | undefined,
    markAssetDirty() {
      documentState.assetDirty = true;
    },
  };
  const tempo = session.tempo;
  const feedback = createEditorFeedback();
  const { notify, failureMessage, reportError } = feedback;
  const atHome = () => getEditorVisibility().atHome;
  const hasDocument = () => getEditorVisibility().hasDocument;
  setEditorVisibility({ atHome: true, hasDocument: false, dirty: false });
  /** Records the chart last written to the recovery store. */
  function setLastDraftDocument(chart: Chart): void {
    documentState.lastDraftDocument = chart;
  }
  /** Publishes whether a document is installed for the frame and navigation gates. */
  function setHasDocument(value: boolean): void {
    setEditorVisibility({ ...getEditorVisibility(), hasDocument: value });
  }
  const sessionRendererRef: { current?: ReturnType<typeof createEditorSessionRenderer> } = {};
  /** Repaints the session-derived readouts and panel contents synchronously. */
  function renderSession() {
    sessionRendererRef.current?.render();
    // Republishing here covers the effects that settle outside a history entry
    // — a save marking its baseline, or an asset commit.
    publishDirty();
  }
  let sessionRenderFrame = 0;
  /**
   * Coalesces session repaints into one frame and schedules a draw.
   *
   * The document installer reattaches this callback to every replacement
   * session, so publishing the dirty flag here keeps the title and status bars
   * following the session that currently owns the chart.
   */
  function scheduleSessionRender(): void {
    publishDirty();
    invalidate();
    if (sessionRenderFrame) {
      return;
    }
    sessionRenderFrame = requestAnimationFrame(() => {
      sessionRenderFrame = 0;
      sessionRendererRef.current?.render();
    });
  }
  scope.add(() => {
    if (sessionRenderFrame) {
      cancelAnimationFrame(sessionRenderFrame);
      sessionRenderFrame = 0;
    }
  });
  /** Opens the named inspector pane, or closes the active one for an empty name. */
  function activatePane(name: string) {
    if (name) {
      openInspector(name, ui.activeInspector);
    } else {
      closeInspector(ui.activeInspector);
    }
  }
  /** Closes the active inspector pane. */
  function closePane() {
    activatePane("");
  }
  const editClock = new EditorEditClock();
  const offsetSeconds = () => Number(session.current.chart.META.offset ?? 0) / 1000;
  const previewRuntime = createPreviewRuntime({
    preview: surfaces.preview,
    session,
    ui,
    invalidate,
    notify,
    openAssets: () => {
      void openDocumentAssets();
    },
    atHome,
    offsetSeconds,
    tempo: tempo.get,
  });
  const {
    audio,
    hitSounds,
    realtimePreview,
    lineInfo,
    timelineActivity,
    images,
    timelineThumbnail,
  } = previewRuntime;

  let timelineMarkerController: TimelineMarkers | null = null;
  /** Edits one event of the given type at the current beat by default. */
  function editEvent(type: string, index: number | null, beat = currentBeat()) {
    editTimelineEvent(type, index, beat);
  }
  const timelineRuntime = createTimelineRuntime({
    shell: surfaces.timeline,
    spectrumCanvas: surfaces.transport.scrubberSpectrum,
    scope,
    session,
    tempo: tempo.get,
    preview: previewRuntime,
    ui,
    invalidate,
    notify,
    reportError,
    persistEditor,
    offsetSeconds,
    editEvent,
    openTimelineContextMenu,
    selectOverviewLine,
    atHome,
    hasDocument,
  });
  const {
    timeline,
    layerButtons,
    audioAnalysis,
    scrubberSpectrum,
    eventInteraction,
    noteSourceToast,
    batchControls,
    selectionOverlay,
    lineSwitcher,
    clipboardHistory,
    selectionClipboard,
  } = timelineRuntime;
  // Hit-test geometry is demand-driven: `getCollisionGeometry()` performs one
  // complete preview pass and caches it by draw revision.
  scope.add(
    connectHitTestApi({
      pick: createHitTestPicker({ preview: realtimePreview, timeline }),
      getPreviewGeometry: createPreviewGeometryReader({ preview: realtimePreview }),
    }),
  );
  // Live object geometry is demand-driven too: subscribing turns collection on
  // for normal preview paints, so one snapshot follows each rendered frame.
  scope.add(
    connectPreviewApi(
      createPreviewApiHost({
        preview: realtimePreview,
      }),
    ),
  );
  scope.add(connectLayoutApi(createLayoutApiHost()));
  const inspectorRuntime = createInspectorRuntime({
    scope,
    inspector: surfaces.inspector.inspector,
    trajectoryOverlay: surfaces.inspector.trajectoryOverlay,
    ui,
    session,
    timeline,
    tempo,
    document: documentState,
    images,
    documents,
    invalidate,
    notify,
    reportError,
    renderSession,
    persistEditor,
  });
  const { multiEdit, trajectoryPanel, multiLinePanel, linePanel, assetLibrary, curveEditor } =
    inspectorRuntime;
  batchControls.onCommit = () => multiEdit.clearPreview();
  scope.add(
    bindClipboardHistoryPersistence(clipboardHistory, (message) => notify(message, "error")),
  );
  scope.add(
    bindAnalysisActions({
      audioAnalysis,
      offsetSeconds,
      reportError,
    }),
  );
  scope.add(bindCurveActions(curveEditor));
  scope.add(bindTrajectoryAction(() => trajectoryPanel.open()));
  const playbackRuntime = createPlaybackRuntime({
    session,
    preview: previewRuntime,
    timeline,
    documents,
    assets: () => documentState.assets,
    setLastDraftDocument,
    notify,
    failureMessage,
    invalidate,
    offsetSeconds,
    tempo: tempo.get,
  });
  const {
    chartSeconds,
    currentBeat,
    playback,
    playbackMetrics,
    autoSave,
    seekBeat,
    togglePlayback,
  } = playbackRuntime;
  scope.add(playbackRuntime.dispose);
  createTimelineMarkers({
    root: surfaces.transport.timelineMarkers,
    scrubber: surfaces.transport.scrubber,
    notesCanvas: surfaces.timeline.notes,
    timeline,
    audio,
    timelineActivity,
    session,
    offsetSeconds,
    playback: playbackRuntime,
    trajectoryPanel,
    ui,
    setController: (controller: TimelineMarkers) => {
      timelineMarkerController = controller;
    },
  });
  const timelineOverview = createTimelineOverview({
    densityCanvas: surfaces.timeline.noteDensity,
    historyCanvas: surfaces.timeline.history,
    scope,
    timeline,
    timelineActivity,
    timelineThumbnail,
    audio,
    session,
    tempo,
    chartSeconds,
    offsetSeconds,
    playback: playbackRuntime,
    ui,
    densityBarsEnabled: () => values.byId.get<boolean>("timeline-density-bars-enabled"),
    hoverPreviewEnabled: () => values.byId.get<boolean>("timeline-hover-preview-enabled"),
    visibility: { hasDocument, atHome },
  });
  // Alt+wheel writes the scale continuously; persisting it re-applies every
  // editor setting, so writes are coalesced when the gesture pauses.
  let scalePersistTimer: ReturnType<typeof setTimeout> | null = null;
  /** Persists the current timeline scale once the zoom gesture settles. */
  const scheduleScalePersist = () => {
    if (scalePersistTimer !== null) {
      clearTimeout(scalePersistTimer);
    }
    scalePersistTimer = setTimeout(() => {
      scalePersistTimer = null;
      persistEditor();
    }, 180);
  };
  scope.add(() => {
    if (scalePersistTimer === null) {
      return;
    }
    clearTimeout(scalePersistTimer);
    scalePersistTimer = null;
    persistEditor();
  });
  const zoomAnimator = new TimelineZoomAnimator(
    timeline.viewport,
    invalidate,
    () => {
      editorScale.set(String(timeline.viewport.scale));
      scheduleScalePersist();
    },
    () => audio.playing || playback.pending,
  );
  scope.add(() => zoomAnimator.cancel());
  const zoomTimelineVertically = (event: WheelEvent, direction: -1 | 1): boolean => {
    const target = event.target;
    if (!(target instanceof Node) || !surfaces.timeline.stage.contains(target)) {
      return false;
    }
    const notes = timeline.notesCanvas;
    const events = timeline.eventsCanvas;
    const canvas =
      target instanceof HTMLCanvasElement && (target === notes || target === events)
        ? target
        : notes.clientWidth > 0
          ? notes
          : events.clientWidth > 0
            ? events
            : null;
    if (!canvas || !event.deltaY) {
      return false;
    }
    const delta = event.deltaMode === 0 ? event.deltaY : event.deltaY * 100;
    const directedDelta = direction === 1 ? -Math.abs(delta) : Math.abs(delta);
    return zoomAnimator.request(timelineZoomFactor(directedDelta));
  };
  const timelineNavigation = bindTimelineNavigation({
    timeline,
    session: () => session.current,
    seekByBeats: playbackRuntime.seekByBeats,
    wheelSettings: () => ({
      scrollSpeed: Number(runtimeValues.scrollSpeed.get() ?? 5),
      scrollAcceleration: displayValues.scrollAcceleration.get(),
    }),
    lineSwitcher,
    zoomVertical: zoomTimelineVertically,
  });
  // The preview and overview are under the timeline's stage, while progress is
  // a separate toolbar surface. Keep one wheel command so all three surfaces
  // seek the same transport and use the same inversion/acceleration settings.
  // A visible camera surface owns the gesture even if its overlay did not stop
  // propagation, so curve, free-camera, and sampling wheels never reach it.
  scope.listen(
    surfaces.timeline.stage,
    "wheel",
    (event) => {
      const target = event.target;
      if (target === surfaces.timeline.notes || target === surfaces.timeline.events) {
        return;
      }
      const action = stageWheelAction({
        freeCamera: freeCameraState.get().active,
        curvePreview: curvePreviewMode.get(),
        sampling: Boolean(samplingSession.get().target),
        defaultPrevented: event.defaultPrevented,
      });
      if (action === "camera") {
        return;
      }
      timelineNavigation.wheel(event);
    },
    { passive: false },
  );
  scope.listen(
    surfaces.transport.scrubberWrap,
    "wheel",
    (event) => timelineNavigation.wheel(event),
    { passive: false },
  );
  /** Selects one line for navigation and clears any pending batch placement. */
  function selectOverviewLine(index: number) {
    if (!Number.isInteger(index) || !session.current.chart.judgeLineList?.[index]) {
      return false;
    }
    batchControls.cancel();
    timeline.cancelPlacement();
    // A line chosen from the overview replaces the shared multi-line selection.
    editorLineSelection.set([index]);
    session.current.selectLine(index);
    editorLine.set(String(index));
    return true;
  }
  /** Resolves a passive line-jump submission through the overview selection path. */
  function handleLineJump(submission: PrefixDigitSequenceSubmission): void {
    if (submission.kind === "invalid") {
      notify({
        message: t("editor.app.notice.lineJumpInvalid"),
        level: "warning",
        duration: 4000,
        key: "editor.lineJump",
      });
      return;
    }
    if (submission.kind === "empty") {
      return;
    }
    const index = submission.value;
    if (selectOverviewLine(index)) {
      return;
    }
    const lineCount = session.current.chart.judgeLineList?.length ?? 0;
    if (!lineCount) {
      return;
    }
    notify({
      message: t("editor.app.notice.lineJumpMissing", { line: index, max: lineCount - 1 }),
      level: "warning",
      duration: 4000,
      key: "editor.lineJump",
    });
  }
  scope.add(
    bindPreviewSelection({
      stage: surfaces.timeline.stage,
      preview: realtimePreview,
      timeline,
      getSession: () => session.current,
      canSelectPreview: () => !showsAuthoringRegion(getEditorRegionSnapshot()),
      scope,
    }),
  );
  const home: ReturnType<typeof createEditorHomeRuntime> = createEditorHomeRuntime({
    documents,
    guardReplace,
    loadCandidate,
    reportError,
    getLibraryProject: () => documentState.libraryProject,
    setLibraryProject: (project) => {
      documentState.libraryProject = project;
    },
  });
  scope.add(connectRpeImport(() => home.chooseRpeImport()));
  scope.add(connectExternalImport(() => home.chooseExternalImport()));
  // Debug and automation builds expose the same drop entry point the window
  // uses, so a test can route local paths without synthesizing an OS drag. The
  // probe shares the test flag with the public facade and dies with the scope.
  if ((globalThis as { __REDUX_TEST_API__?: unknown }).__REDUX_TEST_API__ === true) {
    Object.defineProperty(globalThis, "__REDUX_DROP_PATHS__", {
      configurable: true,
      value: (paths: string[]) => home.importPaths(paths),
    });
    scope.add(() => {
      delete (globalThis as { __REDUX_DROP_PATHS__?: unknown }).__REDUX_DROP_PATHS__;
    });
  }
  const workspaceNavigationBinding = bindWorkspaceNavigation({
    atHome,
    hasDocument,
    clearNoteSourceToast: () => noteSourceToast.clear(),
    resetLineSwitcher: () => lineSwitcher.reset(),
    setMuteCurrentLine: (muted) => {
      hitSounds.onlyCurrentLine = muted;
    },
    setLineInfoVisible: lineInfo.setVisible,
    pausePlayback: () => playback.pause(),
    cancelTimelinePlacement: () => timeline.cancelPlacement(),
    refreshHome: () => home.refresh(),
    invalidate,
    hasUnsavedChanges: () => session.current.history.dirty || documentState.assetDirty,
    save,
    closeDocument: closeTheDocument,
    reportError,
  });
  scope.add(workspaceNavigationBinding.dispose);
  const workspaceNavigation = workspaceNavigationBinding.navigation;

  /** Forwards a context-menu request to the marker controller when it exists. */
  function openTimelineContextMenu(event: MouseEvent, canvas: HTMLCanvasElement | null = null) {
    timelineMarkerController?.openContextMenu(event, canvas);
  }
  /** Repaints the transport markers after the session or duration changes. */
  function renderTimelineMarkers() {
    timelineMarkerController?.render();
  }

  /** Writes the timeline, preview, audio, and hit-sound settings to preferences. */
  function persistEditor() {
    persistEditorSettings({
      timeline: timeline.viewport,
      realtimePreview,
      audio,
      hitSounds,
    });
  }

  const updateLineInfo = lineInfo.update;

  sessionRendererRef.current = createEditorSessionRenderer({
    data: {
      notes: ui.notes,
      session: () => session.current,
      timeline,
      tempo: {
        get: tempo.get,
        setEntries: tempo.setEntries.bind(tempo),
      },
      hitSounds,
      currentBeat,
      updateLineInfo,
      syncMedia: () => documentRuntime.metadataMedia.sync(),
    },
    readouts: {
      editClock,
      createChartInfoPresenter: () => new EditorChartInfoPresenter(),
      renderTimelineMarkers,
    },
    panels: {
      ui,
      timeline,
      layerButtons,
      multiEdit,
      multiLinePanel,
      currentBeat,
      reportError,
      notify,
      nudgeBeatInput,
    },
    selection: {
      layer: () => timeline.gestures.layer,
      state: () => ({
        multiEditCommitting: Boolean(multiEdit.committing),
        trajectoryActive: Boolean(trajectoryPanel.active),
        curveEditorOpen: curveEditor.isOpen,
      }),
      effects: {
        syncMulti: () => multiEdit.sync(),
        activatePane: (name) => {
          // Only the curve pane is deactivated when another pane takes over, so
          // a later non-pointer selection cannot resurrect it underneath.
          if (name !== "curve") {
            curveEditor.deactivate();
          }
          activatePane(name);
        },
        openMulti: (focus) => multiEdit.open(focus),
        deactivateCurve: () => curveEditor.deactivate(),
        openTrajectory: (event, lineIndex, layer) => trajectoryPanel.open(event, lineIndex, layer),
        closePane: () => {
          curveEditor.deactivate();
          closePane();
        },
      },
    },
    activePane: () => ui.activeInspector.get(),
    invalidate,
  });

  session.current.addEventListener("change", scheduleSessionRender);
  /**
   * Republish the unsaved flag whenever the document can have changed.
   *
   * `history.dirty` flips on the first edit and back on save; an asset mutation
   * sets `assetDirty` without a history entry, so both are read here and the
   * title bar sees one value.
   */
  function publishDirty(): void {
    const current = getEditorVisibility();
    const dirty =
      current.hasDocument && (session.current.history.dirty || documentState.assetDirty);
    if (dirty !== current.dirty) {
      setEditorVisibility({ ...current, dirty });
    }
  }
  const documentRuntime = createDocumentRuntime({
    scope,
    documents,
    // A native archive open that holds no RPE chart is converted through the
    // external import pipeline instead of surfacing `pez_chart_missing`.
    openExternalChart: (path) => home.importExternalChartFile(path),
    session,
    ui,
    document: documentState,
    resources: {
      preview: {
        audio: previewRuntime.audio,
        hitSounds: previewRuntime.hitSounds,
        images: previewRuntime.images,
        lineInfoScene: previewRuntime.lineInfoScene,
        realtimePreview: previewRuntime.realtimePreview,
      },
      timeline: {
        audioAnalysis: timelineRuntime.audioAnalysis,
        clipboardHistory: timelineRuntime.clipboardHistory,
        lineSwitcher: timelineRuntime.lineSwitcher,
        scrubberSpectrumLoader: timelineRuntime.scrubberSpectrumLoader,
        timeline: timelineRuntime.timeline,
      },
      playback: {
        autoSave: playbackRuntime.autoSave,
        playback: playbackRuntime.playback,
      },
      inspector: {
        assetLibrary: inspectorRuntime.assetLibrary,
        curveEditor: inspectorRuntime.curveEditor,
        trajectoryPanel: inspectorRuntime.trajectoryPanel,
      },
    },
    invalidate,
    renderSession,
    scheduleRenderSession: scheduleSessionRender,
    resetSelectionView: () => {
      sessionRendererRef.current?.resetSelectionRouting();
      const active = ui.activeInspector.get();
      // Curve authoring keeps its inspector through stray workspace clicks.
      if (active !== "curve" && active !== "curve-preview") {
        closePane();
      }
    },
    resetEditClock: () => editClock.reset(),
    setHasDocument,
    hasDocument,
    setHome: workspaceNavigation.setHome,
    reportError,
    notify,
    renderTimelineMarkers,
    chartSeconds,
    offsetSeconds,
    waitForFirstRender: frameRuntime.waitForFirstRender,
  });
  const { documentSaver } = documentRuntime;
  /** Runs a document action after the unsaved-changes confirmation. */
  function guardReplace(action: () => unknown, title?: string): void {
    documentRuntime.guardReplace(action, title);
  }
  /** Loads a parsed candidate through the document runtime. */
  async function loadCandidate(
    candidate: EditorCandidate,
    nextAssets: AssetMap,
    task?: LoadTask,
  ): Promise<void> {
    return documentRuntime.loadCandidate(candidate, nextAssets, task);
  }
  /** Saves the live document into the library. */
  function save(): Promise<unknown> {
    return documentRuntime.save();
  }
  /** Closes the document and clears its workspace-session record when accepted. */
  function closeTheDocument(): void {
    if (documentRuntime.closeDocument()) {
      workspaceSession.clear();
    }
  }
  scope.add(
    connectTransport({
      togglePlayback,
      seekBeat,
      playback,
      getSession: () => session.current,
      invalidate,
      reportError,
    }),
  );
  const editTimelineEvent = createTimelineEventAction({
    getSession: () => session.current,
    timeline,
    currentBeat,
    activateEventsPane: () => activatePane("events"),
    notify,
  });
  /** One exact grid division, shared by every beat control on this session. */
  function nudgeBeatInput(value: Beat, direction: number): Beat | null {
    try {
      return nudgeBeat(value, direction, timeline.viewport.division);
    } catch (error) {
      reportError(error);
      return null;
    }
  }
  let activeCanvas: CanvasShortcutTarget | null = null;
  const resolveCanvasTarget = (event: Event): CanvasShortcutTarget | null => {
    const target = canvasShortcutTarget(event, surfaces, session.current.focus);
    if (target) {
      activeCanvas = target;
    }
    return target;
  };
  const { applySettings: applyDisplaySettings } = bindEditorInteractions({
    runtime: {
      scope,
      getSession: () => session.current,
      persistEditor,
      invalidate,
      atHome,
      hasDocument,
      canvasTarget: resolveCanvasTarget,
      activeCanvasTarget: () => activeCanvas,
      clearCanvasTarget: () => {
        activeCanvas = null;
      },
      currentBeat,
      seekBeat,
      save,
      reportError,
      notify,
      lineJump: handleLineJump,
      cancelTimelineZoom: () => zoomAnimator.cancel(),
    },
    timeline: {
      timeline,
      audioAnalysis,
      lineSwitcher,
      eventInteraction,
      progress: ui.progress,
    },
    playback: {
      audio,
      hitSounds,
      realtimePreview,
      playback,
      togglePlayback,
    },
    editing: {
      linePanel,
      curveEditor,
      batchControls,
      lineInfo,
      selectionClipboard,
      openMultiLinePanel: inspectorRuntime.openMultiLinePanel,
      showLineInfo: () => {
        lineInfo.toggle();
        updateLineInfo();
      },
      resetCamera: () => viewControls.resetCamera(),
      toggleGameUi: () => viewControls.toggleGameUi(),
      closePane,
    },
  });

  bindEditorWindowEvents(
    {
      hasUnsavedChanges: () => session.current.history.dirty || documentState.assetDirty,
      invalidate,
      resetFrameTimestamp: frameRuntime.resetFrameTimestamp,
    },
    scope,
  );
  scope.add(
    bindTimelineMarkerResize({
      stage: surfaces.timeline.stage,
      scrubber: surfaces.transport.scrubberWrap,
      renderMarkers: renderTimelineMarkers,
      drawScrubberSpectrum: () => scrubberSpectrum.draw(),
      invalidate,
      disposeMarkers: () => timelineMarkerController?.dispose(),
    }),
  );
  frameRuntime.install({
    contentRefreshRate: readEditorRefreshRate,
    visibility: {
      atHome,
      hasDocument,
      documentHidden: () => document.hidden,
    },
    clock: {
      audio,
      timeline,
      lineSwitcher,
      editClock,
      hitSounds,
      session: () => session.current,
      tempo: tempo.get,
      chartSeconds,
      invalidate,
    },
    drawing: {
      audio,
      playbackPending: () => playback.pending,
      timeline,
      batchControls,
      lineSwitcher,
      multiEdit,
      selectionOverlay,
      timelineOverview,
      trajectoryPanel,
      audioAnalysis,
      realtimePreview,
      offsetSeconds,
      updateLineInfo,
      completeFirstRender: frameRuntime.completeFirstRender,
      authoringRegionVisible: () => showsAuthoringRegion(getEditorRegionSnapshot()),
    },
    readouts: {
      notes: ui.notes,
      audio,
      timeline,
      progress: ui.progress,
      editClock,
      chartSeconds,
      chartInfoVisible: () => getChartInfoExpanded(),
      chartInfoPresenter: () => sessionRendererRef.current?.chartInfoPresenter(),
    },
    autosave: {
      clock: autoSave,
      session: () => session.current,
      lastDraftDocument: () => documentState.lastDraftDocument,
      enabled: () => runtimeValues.autosaveEnabled.get(),
      seconds: () => Number(runtimeValues.autosaveSeconds.get() ?? 60),
    },
    metrics: playbackMetrics,
  });
  applyDisplaySettings();
  viewControls.applyRegionVisibility();
  renderSession();
  workspaceNavigation.setHome(true);
  frameRuntime.wake();
  bindEditorLanguageRefresh({
    scope,
    hasDocument,
    getSession: () => session.current,
    notes: ui.notes,
    getTempo: tempo.get,
    reportError,
    onNudge: nudgeBeatInput,
  });

  timeline.gestures.eventPlacementType = timeline.eventTypes[0];

  let disposePlayback = () => {};
  let disposeSelection = () => {};
  const confirmExit = () =>
    requestConfirm({
      title: t("editor.app.dialog.exitUnsavedTitle"),
      description: t("editor.app.dialog.exitUnsavedBody"),
      label: t("editor.app.dialog.exitDiscard"),
      cancelLabel: t("editor.app.dialog.exitKeep"),
      destructive: true,
      priority: MODAL_PRIORITY.closePrompt,
    });
  scope.add(clearToasts);
  scope.add(() => disposePlayback());
  scope.add(() => disposeSelection());
  scope.add(() => frameRuntime.dispose());
  scope.add(() => home.dispose());
  scope.add(() => trajectoryPanel.dispose());
  scope.add(() => sessionRendererRef.current?.dispose());
  scope.add(() => multiEdit.dispose());
  scope.add(() => previewRuntime.dispose());
  scope.add(() => audioAnalysis.setBuffer(null));
  scope.add(() => documents?.close());
  scope.add(() => lineSwitcher.reset());
  scope.add(() => multiLinePanel.dispose());
  scope.add(() => linePanel.dispose());
  scope.add(() => assetLibrary.dispose());
  scope.add(() => session.current.removeEventListener("change", renderSession));
  scope.add(() => ui.notes.livePosition.set(null));
  const dispose = () => scope.dispose();
  disposePlayback = bindEditorPlayback({
    getSession: () => session.current,
    tempo: tempo.get,
    audio,
    playback,
    offsetSeconds,
    hasDocument,
    invalidate,
    preview: realtimePreview,
    images,
    metrics: playbackMetrics,
  });
  disposeSelection = bindEditorSelection(() => session.current, timeline, selectionClipboard);
  const workspaceSession = createWorkspaceSessionRuntime({
    documents,
    hasDocument,
    document: documentState,
    session: () => session.current,
    viewport: timeline.viewport,
    chartSeconds,
    activeInspector: ui.activeInspector,
    getChartInfoExpanded,
    seek: (seconds) => playback.seek(seconds),
    loadCandidate: (candidate, assets) =>
      documentRuntime.loadCandidate(candidate, assets, undefined, "restore"),
    invalidate,
    renderSession,
  });
  scope.add(workspaceSession.dispose);

  if (documents) {
    bindDesktopLifecycle({
      documents,
      addCleanup: (cleanup) => scope.add(cleanup),
      openPaths: documentRuntime.openPaths,
      // A drop is an import first: the file lands in the library whatever the
      // current document is. Opening it is a second step that goes through the
      // unsaved-changes decision, so a drop never silently discards edits.
      dropPaths: async (paths) => {
        if (atHome()) {
          await home.importPaths(paths);
          return;
        }
        const drawer = getDrawerState();
        if (drawer.open && drawer.pane === "assets") {
          await assetLibrary.importPaths(paths);
          return;
        }
        const imported = await home.importPaths(paths);
        if (!imported.length) {
          return;
        }
        if (imported.length > 1) {
          // A folder can yield several charts; opening one of them without asking
          // would pick for the user, so the library keeps them and the notice says
          // where they went.
          notify(t("editor.app.notice.droppedManyImported", { count: imported.length }), "info");
          return;
        }
        const target = imported[0];
        const dirty = session.current.history.dirty || documentState.assetDirty;
        if (dirty) {
          const choice = await requestExitChoice({
            title: t("editor.app.dialog.unsavedChangesTitle"),
            description: t("editor.app.dialog.unsavedChangesBody"),
            saveLabel: t("common.action.save"),
            discardLabel: t("editor.app.dialog.openWithoutSaving"),
            cancelLabel: t("common.action.cancel"),
            priority: MODAL_PRIORITY.closePrompt,
          });
          if (choice === "cancel") {
            return;
          }
          if (choice === "save") {
            const result = await documentRuntime.save();
            if (!result || result.status === "save_conflict") {
              return;
            }
          }
        }
        await home.open(target);
      },
      restoreLastSession: workspaceSession.restore,
      persistSession: async () => {
        // A normal close clears the record so the next launch starts empty; only
        // periodic samples survive a crash or update restart.
        workspaceSession.clear();
        workspaceSession.dispose();
        await preferences.flush();
      },
      pendingSave: () => documentSaver.pending?.then(() => undefined) ?? null,
      isDirty: () => session.current.history.dirty || documentState.assetDirty,
      confirmExit,
      confirmCollaborationExit: () => {
        if (!roomNeedsExitConfirmation(collaborationRoom.get(), collaborationPreparing.get())) {
          return Promise.resolve(true);
        }
        return requestConfirm({
          title: t("workspace.collaboration.exitTitle"),
          description: t("workspace.collaboration.exitBody"),
          label: t("workspace.collaboration.exitConfirm"),
          destructive: true,
          priority: MODAL_PRIORITY.closePrompt,
        });
      },
      dispose,
      reportError,
      notifyUnsupported: () => notify(t("editor.app.notice.desktopEnvironment"), "warning"),
    });
  } else {
    bindBrowserLifecycle({
      restoreLastSession: workspaceSession.restore,
      reportError,
    });
  }
  const runtime = createEditorRuntime({
    getSession: () => session.current,
    timeline,
    audio,
    preview: realtimePreview,
    scope,
    documents,
    ui,
    providers: {
      session,
      preview: previewRuntime,
      timeline: timelineRuntime,
      playback: playbackRuntime,
      inspector: inspectorRuntime,
      document: documentRuntime,
    },
    dispose,
  });
  return { runtime };
}
