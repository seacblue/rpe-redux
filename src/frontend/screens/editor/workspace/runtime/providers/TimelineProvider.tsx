/** Owns the timeline interaction resources that share one Timeline instance. */
import { createContext, useContext, type ReactNode } from "react";
import { ClipboardHistory } from "../../../../../../core/edit/clipboard/clipboardHistory.ts";
import { AudioAnalysis } from "../../timeline/audioAnalysis/audioAnalysis.ts";
import { BatchControls } from "../../stage/batchControls/batchControls.ts";
import { LayerButtons } from "../../timeline/layers/layerButtons.ts";
import { NoteSourceToastController } from "../../stage/noteSource/noteSourceToastController.ts";
import { ScrubberSpectrum } from "../../../../../chrome/transport/scrubberSpectrum.ts";
import { SelectionOverlay } from "../../timeline/selection/selectionOverlay.ts";
import { Timeline } from "../../timeline/surface/timeline.ts";
import { TimelineMarkers } from "../../../../../chrome/transport/TimelineMarkers.tsx";
import { TimelineOverview } from "../../timeline/overview/timelineOverview.ts";
import { bindMultiLineScroll } from "../../timeline/multiLine/multiLineScrollBinding.ts";
import { createLineSwitcher } from "../../timeline/lineSwitcher/lineSwitcherBindings.ts";
import { createScrubberSpectrumLoader } from "../../../../../chrome/transport/scrubberSpectrumLoader.ts";
import { createSelectionClipboard } from "../../../../../../core/edit/clipboard/selectionClipboard.ts";
import { clipboardBeatRange } from "../../../../../../core/edit/clipboard/operations.ts";
import { clipboardBeat } from "../../timeline/interaction/clipboardTarget.ts";
import { t } from "../../../../../../i18n/index.ts";
import { hasOpenModal } from "../../../../../../design/components/modal/Modal.tsx";
import { values } from "../../../../../../core/state/values.ts";
import type { PreviewRuntime } from "./PreviewProvider.tsx";
import type { EditorSessionRuntime } from "./SessionProvider.tsx";
import type { EditorTempoSource } from "../session/tempoSource.ts";
import type { PlaybackRuntime } from "./PlaybackProvider.tsx";
import type { TrajectoryPanel } from "../../../inspector/trajectory/trajectoryPanel.ts";
import type { EditorUiState } from "../composition/editorUiState.ts";
import type { TimelineSurface } from "../composition/editorSurfaces.ts";
import type { ResourceScope } from "../../../../../../core/utils/resourceScope.ts";
import type { TempoMap } from "../../../../../../core/global/chart/timing/tempo.ts";

/** Interaction resources that share the mounted timeline instance. */
export interface TimelineRuntime {
  readonly timeline: Timeline;
  readonly layerButtons: LayerButtons;
  readonly audioAnalysis: AudioAnalysis;
  readonly scrubberSpectrum: ScrubberSpectrum;
  readonly scrubberSpectrumLoader: ReturnType<typeof createScrubberSpectrumLoader>;
  readonly eventInteraction: () => Timeline["gestures"]["eventInteraction"];
  readonly noteSourceToast: NoteSourceToastController;
  readonly batchControls: BatchControls;
  readonly selectionOverlay: SelectionOverlay;
  readonly lineSwitcher: ReturnType<typeof createLineSwitcher>;
  readonly clipboardHistory: ClipboardHistory;
  readonly selectionClipboard: ReturnType<typeof createSelectionClipboard>;
}

const TimelineRuntimeContext = createContext<TimelineRuntime | null>(null);

/** Publishes the timeline runtime to descendants, or null before it exists. */
export function TimelineProvider({
  runtime,
  children,
}: {
  runtime: TimelineRuntime | null;
  children: ReactNode;
}) {
  return (
    <TimelineRuntimeContext.Provider value={runtime}>{children}</TimelineRuntimeContext.Provider>
  );
}

/** Reads the timeline runtime, or null while it is not mounted. */
export function useTimelineRuntime(): TimelineRuntime | null {
  return useContext(TimelineRuntimeContext);
}

/** Creates the transport marker controller and hands it to the caller. */
export function createTimelineMarkers(options: {
  root: HTMLDivElement;
  scrubber: HTMLInputElement;
  notesCanvas: HTMLCanvasElement;
  timeline: Timeline;
  audio: PreviewRuntime["audio"];
  timelineActivity: PreviewRuntime["timelineActivity"];
  session: EditorSessionRuntime;
  offsetSeconds(): number;
  playback: PlaybackRuntime;
  trajectoryPanel: TrajectoryPanel;
  ui: EditorUiState;
  setController(controller: TimelineMarkers): void;
}): void {
  options.setController(
    new TimelineMarkers({
      root: options.root,
      scrubber: options.scrubber,
      notesCanvas: options.notesCanvas,
      getSession: () => options.session.current,
      timeline: options.timeline,
      duration: () =>
        options.audio.duration > 0
          ? options.audio.duration
          : options.timelineActivity.duration || 1,
      offsetSeconds: options.offsetSeconds,
      seek: (time) => options.playback.playback.seek(time),
      splitTrajectory: (event, lineIndex, layerIndex) => {
        options.trajectoryPanel.open(event, lineIndex, layerIndex);
        options.trajectoryPanel.split();
      },
      state: options.ui.timelineMarkers,
      setTimelineMenu: options.ui.timelineMenu.set,
    }),
  );
}

/** Creates the overview strip bound to the live session and playback. */
export function createTimelineOverview(options: {
  densityCanvas: HTMLCanvasElement;
  historyCanvas: HTMLCanvasElement;
  scope: ResourceScope;
  timeline: Timeline;
  timelineActivity: PreviewRuntime["timelineActivity"];
  timelineThumbnail: PreviewRuntime["timelineThumbnail"];
  audio: PreviewRuntime["audio"];
  session: EditorSessionRuntime;
  tempo: EditorTempoSource;
  chartSeconds(): number;
  offsetSeconds(): number;
  playback: PlaybackRuntime;
  ui: EditorUiState;
  densityBarsEnabled(): boolean;
  hoverPreviewEnabled(): boolean;
  clipboardRangesEnabled(): boolean;
  rangeBarOpacity(): number;
  visibility: { hasDocument(): boolean; atHome(): boolean };
}): TimelineOverview {
  const overview = new TimelineOverview({
    densityCanvas: options.densityCanvas,
    historyCanvas: options.historyCanvas,
    timeline: options.timeline,
    activity: options.timelineActivity,
    thumbnail: options.timelineThumbnail,
    bindings: options.ui.timelineBindings,
    densityBarsEnabled: options.densityBarsEnabled,
    hoverPreviewEnabled: options.hoverPreviewEnabled,
    clipboardRangesEnabled: options.clipboardRangesEnabled,
    rangeBarOpacity: options.rangeBarOpacity,
    getSnapshot: () => {
      const session = options.session.current;
      return {
        chart: session.chart,
        tempo: options.tempo.get(),
        lineIndex: session.lineIndex,
        layer: options.timeline.gestures.layer,
        extended: options.timeline.gestures.extended,
        mediaDuration: options.audio.duration,
        currentSeconds: options.chartSeconds(),
        offsetSeconds: options.offsetSeconds(),
        historyRevision: session.history.revision,
        bpmFactor: session.line?.bpmfactor ?? 1,
        clipboardRange: clipboardBeatRange(session),
        pasteRange: session.lastPasteBeatRange,
        hasDocument: options.visibility.hasDocument(),
        atHome: options.visibility.atHome(),
      };
    },
    seek: (seconds) => options.playback.playback.seek(seconds),
  });
  options.scope.add(() => overview.dispose());
  return overview;
}

/** Builds the timeline and its layer, analysis, clipboard, and scroll helpers. */
export function createTimelineRuntime(options: {
  shell: TimelineSurface;
  spectrumCanvas: HTMLCanvasElement;
  scope: ResourceScope;
  session: EditorSessionRuntime;
  tempo(): TempoMap;
  preview: PreviewRuntime;
  ui: EditorUiState;
  invalidate(): void;
  notify(message: string, severity?: string): void;
  reportError(error: unknown): void;
  persistEditor(): void;
  offsetSeconds(): number;
  editEvent: ConstructorParameters<typeof Timeline>[6];
  openTimelineContextMenu: ConstructorParameters<typeof Timeline>[11];
  selectOverviewLine(index: number): boolean;
  atHome(): boolean;
  hasDocument(): boolean;
}): TimelineRuntime {
  const getSession = () => options.session.current;
  const timeline = new Timeline(
    options.shell.notes,
    options.shell.noteBatch,
    options.shell.events,
    options.shell.eventBatch,
    getSession,
    options.tempo,
    options.editEvent,
    options.invalidate,
    options.ui.timelineBindings,
    options.ui.multiLineScroll,
    options.reportError,
    options.openTimelineContextMenu,
    options.shell.notesBackdrop,
    options.shell.eventsBackdrop,
    options.shell.notesPlayhead,
    options.shell.eventsPlayhead,
  );
  options.scope.add(() => timeline.dispose());

  const layerButtons = new LayerButtons(getSession, timeline, options.ui.layerButtons);
  options.scope.add(() => layerButtons.dispose());

  const scrubberSpectrum = new ScrubberSpectrum(options.spectrumCanvas);
  const scrubberSpectrumLoader = createScrubberSpectrumLoader({
    audio: options.preview.audio,
    spectrum: scrubberSpectrum,
  });
  options.scope.add(scrubberSpectrumLoader.dispose);

  const audioAnalysis = new AudioAnalysis(
    options.shell.audioAnalysisOverlay,
    () => timeline,
    () => options.preview.audio,
    options.ui.audioAnalysis,
  );
  // The audio-analysis controls are ordinary settings rows; mirror their values
  // into the runtime and redraw, so the strip follows the settings page.
  const analysisKeys = [
    "audio-analysis-enabled",
    "audio-analysis-alpha",
    "audio-analysis-width",
    "audio-analysis-curve",
  ] as const;
  /** Copies analysis settings into the strip and repaints it. */
  const syncAnalysis = () => {
    if (values.byId.has("audio-analysis-enabled")) {
      audioAnalysis.enabled = values.byId.get<boolean>("audio-analysis-enabled");
      audioAnalysis.alpha = Number(values.byId.get<string>("audio-analysis-alpha") ?? 0.5);
      audioAnalysis.width = Number(values.byId.get<string>("audio-analysis-width") ?? 0.62);
      audioAnalysis.curve = Number(values.byId.get<string>("audio-analysis-curve") ?? 1);
      scrubberSpectrum.curve = audioAnalysis.curve;
      scrubberSpectrum.draw();
    }
    audioAnalysis.draw(options.offsetSeconds());
  };
  const analysisSubscriptions = analysisKeys
    .filter((key) => values.byId.has(key))
    .map((key) => values.byId.subscribe(key, syncAnalysis));
  options.scope.add(() => analysisSubscriptions.forEach((dispose) => dispose()));
  syncAnalysis();
  options.scope.add(() => audioAnalysis.cancel());

  const eventInteraction = () => timeline.gestures.eventInteraction;
  const noteSourceHover = values.getHandle<boolean>("note-source-hover");
  const noteSourceToast = new NoteSourceToastController({
    enabled: () => noteSourceHover.get(),
    atHome: options.atHome,
    multiLineActive: () => getSession().multiLineActive,
    lineExists: (lineIndex) => Boolean(getSession().chart.judgeLineList?.[lineIndex]),
    textForLine: (lineIndex) => t("editor.app.notice.noteSource", { line: lineIndex }),
    invalidate: options.invalidate,
  });
  options.scope.add(() => noteSourceToast.dispose());
  timeline.gestures.onNoteHover = (entry) => noteSourceToast.hover(entry);
  options.scope.add(
    bindMultiLineScroll(
      options.ui.multiLineScroll,
      timeline,
      () => (getSession().multiLineMode === "events" ? "events" : "notes"),
      options.invalidate,
    ),
  );

  const batchControls = new BatchControls(
    options.shell.stage,
    timeline,
    getSession,
    () => !options.atHome(),
    options.reportError,
    options.scope,
    options.ui.batchControls,
  );
  options.scope.add(() => batchControls.dispose());

  const selectionOverlay = new SelectionOverlay(
    options.shell.stage,
    options.shell.selectionOverlay,
    timeline,
    options.scope,
  );
  const lineSwitcher = createLineSwitcher(
    options.shell.stage,
    () => ({
      chart: getSession().chart,
      tempo: options.tempo(),
      seconds: options.preview.audio.time - options.offsetSeconds(),
      selected: getSession().lineIndex,
      layer: timeline.gestures.layer,
      extended: timeline.gestures.extended,
      start: timeline.viewport.timeAt(timeline.viewport.viewHeight()),
      end: timeline.viewport.timeAt(0),
      visible: options.hasDocument() && !options.atHome() && !hasOpenModal(),
    }),
    options.ui.lineSwitcher,
    { select: options.selectOverviewLine },
  );
  options.scope.add(() => lineSwitcher.dispose());

  const clipboardHistory = new ClipboardHistory();
  const selectionClipboard = createSelectionClipboard({
    session: getSession,
    targetLine: () =>
      timeline.gestures.hoverArea === "events"
        ? timeline.viewport.lineIndexAt(
            timeline.gestures.eventCursor?.x ?? 0,
            timeline.eventsCanvas.clientWidth,
            "events",
          )
        : timeline.viewport.lineIndexAt(
            timeline.gestures.cursor?.x ?? 0,
            timeline.notesCanvas.clientWidth,
            "notes",
          ),
    targetBeat: () => clipboardBeat(timeline),
    clipboardMode: () => timeline.gestures.clipboardMode,
    setClipboardMode: (mode) => {
      timeline.gestures.clipboardMode = mode;
    },
    history: clipboardHistory,
    notify: options.notify,
    copiedMessage: (count) => t("editor.app.status.copiedObjects", { count }),
    invalidate: options.invalidate,
  });
  timeline.gestures.notify = (message, level = "warning") => options.notify(message, level);
  options.preview.attachSkin(timeline, options.scope);

  return {
    timeline,
    layerButtons,
    audioAnalysis,
    scrubberSpectrum,
    scrubberSpectrumLoader,
    eventInteraction,
    noteSourceToast,
    batchControls,
    selectionOverlay,
    lineSwitcher,
    clipboardHistory,
    selectionClipboard,
  };
}
