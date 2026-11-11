/* eslint-disable max-lines -- this provider owns the mounted document lifecycle seams. */
/** Owns document replacement, loading, music, persistence, and file actions. */
import { createContext, useContext, type ReactNode } from "react";
import { EXPORT_DOCUMENT_EVENT } from "../../../../../../core/shell/shellEventNames.ts";
import { assetPath, resourceReferences } from "../../../../../../core/global/document/resources.ts";
import type { LoadTask } from "../../../../../../core/global/document/loading.ts";
import type { ChartDiagnostic } from "../../../../../../core/global/chart/diagnostics.ts";
import {
  createChart,
  CURRENT_RPE_VERSION,
  type Chart,
} from "../../../../../../core/global/chart/chart.ts";
import { createStarterChart } from "../../../../../../core/global/chart/starterChart.ts";
import {
  convertChartToCurrentVersion,
  detectChartCompatibility,
} from "../../../../../../core/global/chart/compatibility.ts";
import { BUILD_APP_VERSION } from "../../../../../../core/platform/buildInfo.ts";
import {
  bumpCollaborationAssetRevision,
  collaborationPendingAssets,
  collaborationRoomDocument,
} from "../../../../../../core/collaboration/ui.ts";
import type { AssetMap, EditorCandidate } from "../../../../../../core/global/document/types.ts";
import { materializeAssets } from "../../../../../../core/global/library/document.ts";
import { openFiles } from "../../../../../../core/global/document/import.ts";
import { parseChartEntriesOffThread } from "../../document/open/chartParseOffThread.ts";
import { readZipOffThread } from "../../document/open/zipReadOffThread.ts";
import type { SaveResult } from "../../../../../../core/global/document/desktopTypes.ts";
import { connectDocumentApi } from "../../../../../../core/edit/document/api.ts";
import { connectChartApi } from "../../../../../../core/edit/chart/api.ts";
import { connectTransactionApi } from "../../../../../../core/edit/transaction/service.ts";
import { getEditorVisibility } from "../../../../../../core/edit/state/visibility.ts";
import type { EditorSessionRuntime } from "./SessionProvider.tsx";
import type { EditorUiState } from "../composition/editorUiState.ts";
import type { PreviewRuntime } from "./PreviewProvider.tsx";
import type { TimelineRuntime } from "./TimelineProvider.tsx";
import type { PlaybackRuntime } from "./PlaybackProvider.tsx";
import type { InspectorRuntime } from "./InspectorProvider.tsx";
import type { ResourceScope } from "../../../../../../core/utils/resourceScope.ts";
import type { TauriDocumentStore } from "../../../../../../core/platform/desktop/documentStore.ts";
import type { LibraryProjectRef } from "../../../../../../core/global/library/types.ts";
import { createDocumentRelease } from "../../document/lifecycle/release.ts";
import { createSessionInstaller } from "../../document/lifecycle/sessionInstaller.ts";
import { createDocumentPresentation } from "../../document/lifecycle/presentation.ts";
import { createDocumentReplacer } from "../../document/lifecycle/replacer.ts";
import {
  createQueuedCandidateLoader,
  type PreparedEditorCandidate,
} from "../../document/lifecycle/queuedCandidateLoader.ts";
import { createDocumentSaver } from "../../document/save/saver.ts";
import { editorProjectId } from "../../../../../../core/edit/state/publishedValues.ts";
import { showToast } from "../../../../../../design/patterns/ToastHost.tsx";
import { createMusicLoader } from "../../document/open/musicLoader.ts";
import { createMetadataMedia } from "../../document/open/metadataMedia.ts";
import { createCandidateLoader } from "../../document/open/candidateLoader.ts";
import { openNativeChartPath } from "../../document/open/nativeOpenFallback.ts";
import {
  createDocumentLeaseManager,
  documentKeyForCandidateName,
  documentKeyForPath,
  documentKeyForProject,
  type DocumentLeaseHandle,
} from "../../document/open/documentLease.ts";
import { localService } from "../../../../../../core/global/library/service.ts";
import { serverOrigin } from "../../../../../../core/global/library/client.ts";
import { editorDocumentCoverUrl } from "../../../../../app/coverBackdropUrl.ts";
import {
  connectDocumentService,
  resolveNewChartDetectionAfterAudio,
} from "../../document/lifecycle/service.ts";
import type { DocumentLoadReason } from "../../document/lifecycle/service.ts";
import { showExportDialog } from "../../document/export/exportPrompt.ts";
import { setProgressDuration } from "../../../../../chrome/transport/chartProgressState.ts";
import { displayValues } from "../../../../settings/editorDisplaySettings.ts";
import { requestChoice, requestConfirm } from "../../../../../overlays/modals/prompts.ts";
import { t } from "../../../../../../i18n/index.ts";
import { extensionRegistry } from "../../../../../../core/extensions/runtime.ts";
import { createDocumentChangeCoordinator } from "../../../../../../core/edit/document/changeCoordinator.ts";
import { toDocumentRevisions } from "../../../../../../core/contracts/revisions.ts";
import { chartFingerprint } from "../../../../../../core/edit/document/chartRevision.ts";
import { createDiskChangeObserver } from "../../../../../../core/edit/document/diskChangeObserver.ts";
import {
  createDiskChangeResolver,
  type DiskChangeAction,
} from "../../../../../../core/edit/document/diskChangeResolution.ts";
import { connectCodeCellApi } from "../../../../../../core/edit/codecell/api.ts";
import { createCodeCellAdapter } from "../../../../../../core/edit/codecell/adapter.ts";
import { codeCellRuntime } from "../../../../../../core/codecell/runtime.ts";
import { codeExecutionEnabled } from "../../../../../../core/codecell/enabled.ts";
import type {
  PreviewFrameImage,
  PreviewFrameSpec,
} from "../../../../../../core/edit/preview/frame.ts";
import type { SessionMutationGate } from "../../../../../../core/edit/session/session.ts";
import {
  clearTimingDetectionPending,
  markTimingDetectionPending,
  notifyTimingDetectionAudioLoaded,
  openTimingDetection,
  takeTimingDetectionPending,
} from "../../timingDetection/timingDetectionState.ts";
import { readTimingDetectionPreference } from "../../document/lifecycle/newChartDetectionPreference.ts";

/** Mutable document fields shared by the inspectors and save paths. */
export interface WorkspaceDocumentState {
  assets: AssetMap;
  assetFolders: Set<string>;
  assetDirty: boolean;
  chartName: string;
  libraryProject: LibraryProjectRef | null;
  lastDraftDocument: Chart | undefined;
  markAssetDirty(): void;
}

/** Document loading, saving, replacement, and file actions for one editor mount. */
export interface DocumentRuntime {
  readonly metadataMedia: ReturnType<typeof createMetadataMedia>;
  readonly replaceChart: (
    chart: Chart,
    name: string,
    assets?: AssetMap,
    folders?: string[],
    loadImages?: boolean,
    diagnostics?: ChartDiagnostic[],
    readOnly?: boolean,
  ) => void;
  /** Install an authoritative external chart as an unsaved open document. */
  readonly adoptChart: (chart: Chart, name: string) => void;
  readonly loadCandidate: (
    candidate: EditorCandidate,
    assets: AssetMap,
    task?: LoadTask,
    reason?: DocumentLoadReason,
  ) => Promise<void>;
  readonly save: () => Promise<SaveResult | null>;
  readonly saveAs: () => Promise<SaveResult | null>;
  /**
   * Commit a background library revision for crash recovery without marking the
   * live session saved. The browser host uses it because it has no native
   * recovery store.
   */
  readonly backup: (onProgress?: (value: number) => void) => Promise<SaveResult | null>;
  readonly documentSaver: ReturnType<typeof createDocumentSaver>;
  readonly currentAssets: () => AssetMap;
  readonly currentChartName: () => string;
  /** The open chart's cover URL, resolved through the library or its asset map. */
  readonly coverUrl: () => string;
  /** Install a verified room asset and refresh the surfaces that use it. */
  readonly adoptAsset: (name: string, bytes: Uint8Array) => void;
  readonly guardReplace: (action: () => unknown, title?: string) => Promise<boolean>;
  readonly installBlankChart: () => void;
  readonly closeDocument: () => boolean;
  /** Close the open document without a close hook; used to discard a room copy. */
  readonly discardDocument: () => void;
  readonly openPaths: (paths: string[]) => Promise<void>;
}

/** The document lifecycle only consumes these slices of the feature runtimes. */
type DocumentPreviewResources = Pick<
  PreviewRuntime,
  "audio" | "hitSounds" | "images" | "lineInfoScene" | "realtimePreview"
> & {
  /** Renders one detached chart frame for the Code Cell frame route. */
  readonly captureFrame: (request: PreviewFrameSpec) => Promise<PreviewFrameImage>;
};

type DocumentTimelineResources = Pick<
  TimelineRuntime,
  "audioAnalysis" | "clipboardHistory" | "lineSwitcher" | "scrubberSpectrumLoader" | "timeline"
>;

type DocumentPlaybackResources = Pick<PlaybackRuntime, "autoSave" | "playback">;

type DocumentInspectorResources = Pick<
  InspectorRuntime,
  "assetLibrary" | "curveEditor" | "trajectoryPanel"
>;

interface DocumentRuntimeResources {
  preview: DocumentPreviewResources;
  timeline: DocumentTimelineResources;
  playback: DocumentPlaybackResources;
  inspector: DocumentInspectorResources;
}

const DocumentRuntimeContext = createContext<DocumentRuntime | null>(null);

/** Publishes the document runtime to descendants, or null before it exists. */
export function DocumentProvider({
  runtime,
  children,
}: {
  runtime: DocumentRuntime | null;
  children: ReactNode;
}) {
  return (
    <DocumentRuntimeContext.Provider value={runtime}>{children}</DocumentRuntimeContext.Provider>
  );
}

/** Reads the document runtime, or null while it is not mounted. */
export function useDocumentRuntime(): DocumentRuntime | null {
  return useContext(DocumentRuntimeContext);
}

/** Builds the document lifecycle, APIs, and persistence bindings for one mount. */
export function createDocumentRuntime(options: {
  scope: ResourceScope;
  documents: TauriDocumentStore | null;
  /**
   * Converts one external chart package and opens the imported project; false
   * when the path is not a supported external format. Used only when a native
   * archive open finds no RPE chart entry.
   */
  openExternalChart?: (path: string) => Promise<boolean>;
  session: Pick<EditorSessionRuntime, "current" | "replace">;
  ui: Pick<EditorUiState, "progress">;
  document: WorkspaceDocumentState;
  resources: DocumentRuntimeResources;
  invalidate(): void;
  renderSession(): void;
  scheduleRenderSession?(): void;
  resetSelectionView(): void;
  resetEditClock(): void;
  /** Active seconds on the editor clock, used to accumulate charting time. */
  currentEditSeconds(): number;
  setHasDocument(value: boolean): void;
  hasDocument(): boolean;
  setHome(value: boolean): void;
  reportError(error: unknown): void;
  notify(message: string, severity?: string): void;
  renderTimelineMarkers(): void;
  chartSeconds(): number;
  offsetSeconds(): number;
  waitForFirstRender(task: LoadTask): Promise<void>;
}): DocumentRuntime {
  const getSession = () => options.session.current;
  const getAssets = () => options.document.assets;
  const getChartName = () => options.document.chartName;
  const { preview, timeline, playback, inspector } = options.resources;
  const documentCoordinator = createDocumentChangeCoordinator();
  const mutationGate: SessionMutationGate = {
    run: (kind, operation) =>
      documentCoordinator.admitSync({
        kind,
        run: operation,
        // `History.record` already fingerprinted the chart it just committed;
        // asking `chartFingerprint` for the same object is a WeakMap hit instead
        // of a second full-chart serialization (~400 ms on a 30k-event chart).
        // The saved baseline comes from history so the coordinator mirrors one
        // dirty-state owner rather than maintaining a second saved chart.
        revisions: () => {
          const history = getSession().history;
          return {
            chartFingerprint: history.fingerprint(),
            savedChartFingerprint: history.savedFingerprint,
          };
        },
      }),
  };
  options.session.current.setMutationGate(mutationGate);
  /** Whether the open document has unsaved chart or asset changes. */
  const isDirty = (): boolean =>
    options.hasDocument() && (getSession().history.dirty || options.document.assetDirty);
  /**
   * Point the document at a library project, or clear it.
   *
   * The published id lets chrome outside the document runtime — the title bar's
   * compatibility badge — know which imported project is on screen.
   */
  const assignLibraryProject = (project: LibraryProjectRef | null): void => {
    options.document.libraryProject = project;
    editorProjectId.set(project?.id ?? "");
  };
  const mediaState: { current?: ReturnType<typeof createMetadataMedia> } = {};
  const replaceChart = createDocumentReplacer({
    releasePrevious: createDocumentRelease({
      lineSwitcher: timeline.lineSwitcher,
      lineInfoScene: preview.lineInfoScene,
      assetLibrary: inspector.assetLibrary,
      trajectory: inspector.trajectoryPanel,
      playback: playback.playback,
      audio: preview.audio,
      preview: preview.realtimePreview,
      clearAnalysis: () => timeline.audioAnalysis.setBuffer(null),
      clearSpectrum: timeline.scrubberSpectrumLoader.clear,
      hitSounds: preview.hitSounds,
      images: preview.images,
      disposeChartDocument: () => getSession().chartDocument?.dispose?.(),
      clearLibraryProject: () => {
        assignLibraryProject(null);
      },
    }),
    install: createSessionInstaller({
      session: {
        current: getSession,
        replace: options.session.replace,
      },
      mutationGate,
      history: {
        clipboard: timeline.clipboardHistory,
        limit: () => Number(displayValues.historyLimit.get() ?? 150),
        onChange: () => {
          if (options.scheduleRenderSession) {
            options.scheduleRenderSession();
          } else {
            options.renderSession();
          }
        },
      },
      resetSelectionView: options.resetSelectionView,
      recovery: {
        clearDraft: () => {
          options.document.lastDraftDocument = undefined;
        },
        autoSave: playback.autoSave,
      },
      resetCurveDraft: inspector.curveEditor.resetDraft,
      installRecord: (document) => {
        clearTimingDetectionPending();
        options.document.assets = document.assets;
        options.document.assetFolders = document.folders;
        options.document.assetDirty = false;
        options.document.chartName = document.name;
        preview.realtimePreview.setShaderChartName(document.name);
        mediaState.current?.reset();
      },
      resetEditClock: options.resetEditClock,
      hitSounds: preview.hitSounds,
      images: preview.images,
    }),
    synchronize: createDocumentPresentation({
      timeline: timeline.timeline,
      setProgressDuration: (seconds) => setProgressDuration(options.ui.progress, seconds),
      renderSession: options.renderSession,
      setHasDocument: options.setHasDocument,
      setHome: options.setHome,
    }),
  });
  /**
   * Adopt a chart supplied by another authority, such as a room snapshot.
   *
   * The normal open/create paths complete the document coordinator themselves.
   * This path bypasses the file loader, so it must publish the new generation
   * and chart fingerprint here; otherwise a save sees a stale generation and
   * the document cannot acquire a local library copy.
   */
  const adoptChart = (chart: Chart, name: string): void => {
    replaceChart(chart, name);
    documentCoordinator.replaceDocument({
      chartFingerprint: chartFingerprint(chart),
      savedChartFingerprint: null,
    });
  };

  const loadMusic = createMusicLoader({
    loadAudio: (bytes, name) => preview.audio.load(bytes, name),
    pause: () => playback.playback.pause(),
    seek: (seconds) => playback.playback.seek(seconds),
    chartSeconds: options.chartSeconds,
    offsetSeconds: options.offsetSeconds,
    getSession,
    setAnalysisSource: (source) => timeline.audioAnalysis.setSource(source),
    analysisEnabled: () => timeline.audioAnalysis.enabled,
    ensureAnalysis: () => timeline.audioAnalysis.ensureData(),
    reportError: options.reportError,
    setAsset: (name, bytes) => getAssets().set(name, bytes),
    setProgressDuration: (duration) => setProgressDuration(options.ui.progress, duration),
    duration: () => preview.audio.duration,
    queueSpectrum: timeline.scrubberSpectrumLoader.queue,
    renderTimelineMarkers: options.renderTimelineMarkers,
    commitLabel: () => t("editor.app.commit.selectMusic"),
    onLoaded: () => {
      notifyTimingDetectionAudioLoaded();
      const pendingMode = takeTimingDetectionPending(getSession());
      if (pendingMode === "ask") {
        void resolveNewChartDetectionAfterAudio(getSession()).catch(options.reportError);
      } else if (pendingMode === "detect") {
        openTimingDetection("new-chart");
      }
    },
  });
  const media = createMetadataMedia({
    getSession,
    getAssets,
    getChartName,
    images: preview.images,
    loadMusic,
    clearMusic: () => {
      preview.audio.clear();
      timeline.audioAnalysis.setBuffer(null);
      timeline.scrubberSpectrumLoader.clear();
    },
    reportError: options.reportError,
    changed: options.renderSession,
  });
  mediaState.current = media;
  options.scope.add(media.dispose);
  const loadCandidateResources = createCandidateLoader({
    images: preview.images,
    hitSounds: preview.hitSounds,
    replaceChart,
    setLibraryProject: (project) => {
      assignLibraryProject(project);
    },
    currentChart: () => getSession().chart,
    currentAssets: getAssets,
    currentChartName: getChartName,
    resolveDesktopSong: (song, assets, name) =>
      options.documents?.assets?.url(assetPath(assets, song, name) ?? song),
    loadMusic,
    missingMusic: (name) => {
      if (collaborationRoomDocument.get() || collaborationPendingAssets.get().includes(name)) {
        return;
      }
      options.notify(t("editor.app.status.musicMissing", { name }), "warning");
    },
    selectLine: (index) => getSession().selectLine(index),
    invalidate: options.invalidate,
    waitForFirstRender: options.waitForFirstRender,
  });
  const documentLeases = createDocumentLeaseManager({
    library: async () => (await localService())?.library ?? null,
  });
  /** Acquires cross-instance occupancy, prompting while the document is occupied. */
  const acquireDocumentLease = async (
    documentKey: string | null,
    chartName: string,
  ): Promise<DocumentLeaseHandle | null> => {
    while (true) {
      const result = await documentLeases.tryAcquire(documentKey, chartName);
      if (result.status === "acquired") {
        return result.handle;
      }
      const frontendPort =
        result.owner.frontendPort && result.owner.frontendPort > 0
          ? String(result.owner.frontendPort)
          : t("workspace.document.occupancy.unknownPort");
      const backendPort =
        result.backendPort > 0
          ? String(result.backendPort)
          : t("workspace.document.occupancy.unknownPort");
      const choice = await requestChoice<"frontend" | "backend" | "reconcile">({
        title: t("workspace.document.occupancy.title"),
        description: t("workspace.document.occupancy.description", {
          name: result.chartName,
        }),
        detail: t("workspace.document.occupancy.detail", {
          frontend: frontendPort,
          backend: backendPort,
        }),
        entries: ["frontend", "backend", "reconcile"],
        actionsClassName: "modal-actions-inline",
        label: (entry) =>
          entry === "frontend"
            ? t("workspace.document.occupancy.frontend")
            : entry === "backend"
              ? t("workspace.document.occupancy.backend")
              : t("workspace.document.occupancy.reconcile"),
      });
      if (!choice) {
        return null;
      }
      if (choice === "frontend") {
        const cleared = await documentLeases.clearFrontend(result.owner.id);
        if (!cleared) {
          showToast(t("workspace.document.occupancy.clearFailed"), "warning");
          return null;
        }
      } else if (choice === "backend") {
        await documentLeases.clearBackend(result.documentKey);
      } else {
        for (let attempt = 0; attempt < 3; attempt += 1) {
          if (await documentLeases.reconcile(result.documentKey)) {
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
      }
    }
  };
  /** Validates a candidate and offers conversion when the chart format needs it. */
  const prepareCandidate = async (
    candidate: EditorCandidate,
  ): Promise<PreparedEditorCandidate | null> => {
    const report = detectChartCompatibility(candidate.chart);
    if (!report.requiresConversion) {
      if (report.reduxVersionStatus !== "newer") {
        return candidate;
      }
      const confirmed = await requestConfirm({
        title: t("workspace.document.compatibility.newerTitle"),
        description: t("workspace.document.compatibility.newerDescription", {
          version: report.reduxVersion ?? "",
          current: BUILD_APP_VERSION,
        }),
        label: t("workspace.document.compatibility.openAnyway"),
        cancelLabel: t("workspace.document.compatibility.cancel"),
      });
      return confirmed ? candidate : null;
    }
    const confirmed = await requestConfirm({
      title: t("workspace.document.compatibility.title"),
      description:
        report.rpeVersion === null
          ? t("workspace.document.compatibility.descriptionUnknown")
          : t("workspace.document.compatibility.description", { version: report.rpeVersion }),
      detail: report.missingLineFields
        ? t("workspace.document.compatibility.detail", {
            version: CURRENT_RPE_VERSION,
            count: report.missingLineFields,
          })
        : undefined,
      label: t("workspace.document.compatibility.convert"),
      cancelLabel: t("workspace.document.compatibility.cancel"),
    });
    if (!confirmed) {
      return null;
    }
    const conversion = convertChartToCurrentVersion(candidate.chart, report);
    return conversion
      ? { ...candidate, chart: conversion.chart, converted: conversion.converted }
      : null;
  };
  // The saver is created after the loader because its helpers read the same
  // document state, and conversion saves only after replacement leaves the queue.
  const conversionSaver: { current: (() => Promise<unknown>) | null } = { current: null };
  const candidateLoader = createQueuedCandidateLoader({
    coordinator: documentCoordinator,
    prepareCandidate,
    commitConverted: () => conversionSaver.current?.() ?? Promise.resolve(null),
    acquireDocumentLease,
    documentKeyForCandidate: (candidate) =>
      candidate.project?.id
        ? documentKeyForProject(candidate.project.id)
        : documentKeyForCandidateName(candidate.name),
    documentKeyForPath,
    restoreDocument: async (path) => {
      if (!options.documents) {
        return;
      }
      if (path) {
        await options.documents.open(path);
      } else {
        await options.documents.close();
      }
    },
    openDocument: (path, openOptions) => {
      if (!options.documents) {
        throw new Error(t("workspace.document.error.pathUnavailable"));
      }
      return options.documents.open(path, openOptions);
    },
    loadCandidateResources,
    currentChartFingerprint: () => chartFingerprint(getSession().chart),
    currentDiskSnapshot: () => options.documents?.current?.disk_snapshot ?? null,
    currentChartName: getChartName,
    currentPath: () => options.documents?.current?.path ?? null,
    currentChart: () => getSession().chart,
    awaitFingerprint: () => getSession().warmFingerprint(),
  });
  const { loadCandidate } = candidateLoader;
  /**
   * Open one native chart path, converting an external package when the native
   * reader finds no RPE chart in the archive.
   */
  const openNativeChart = (path: string): Promise<void> =>
    openNativeChartPath(path, {
      open: (target) => candidateLoader.openPath(target),
      ...(options.openExternalChart ? { importExternalChart: options.openExternalChart } : {}),
    });
  /** Ask for one chart file and open it through the native/external path. */
  const chooseNativeChart = async (): Promise<void> => {
    if (!options.documents) {
      throw new Error(t("workspace.document.error.pathUnavailable"));
    }
    const path = await options.documents.chooseOpenPath();
    if (path) {
      await openNativeChart(path);
    }
  };
  let diskObserver: ReturnType<typeof createDiskChangeObserver> | null = null;
  const documentSaver = createDocumentSaver({
    documents: options.documents,
    currentSession: getSession,
    currentGeneration: () => documentCoordinator.snapshot().revisions.generation,
    currentAssets: getAssets,
    currentChartName: getChartName,
    currentLibraryProject: () => options.document.libraryProject,
    currentSourcePath: () => options.documents?.current?.path ?? null,
    currentAssetFolders: () => [...options.document.assetFolders],
    currentEditSeconds: options.currentEditSeconds,
    setAssetDirty: (dirty) => {
      options.document.assetDirty = dirty;
    },
    setLibraryProject: (project) => {
      assignLibraryProject(project);
    },
    setChartName: (name) => {
      options.document.chartName = name;
      preview.realtimePreview.setShaderChartName(name);
    },
    renderSession: options.renderSession,
    onSaved: (_snapshot, result, generation) => {
      const current = documentCoordinator.snapshot();
      if (
        current.lifecycle !== "open" ||
        result.status !== "saved" ||
        current.revisions.generation !== generation
      ) {
        return;
      }
      if (result.disk_snapshot) {
        diskObserver?.markSelfWrite(result.disk_snapshot);
      }
      // runSave publishes the saved fingerprint and rescans after the
      // coordinator accepts the save; this callback only records the native
      // write so the disk observer can recognize it.
    },
  });
  /** Saves through the change coordinator, honoring the before-save hook. */
  const runSave = (
    saveAs: boolean,
    path?: string,
    backup = false,
    onProgress?: (value: number) => void,
  ) => {
    if (!getSession().editable) {
      return Promise.resolve(null);
    }
    if (!path && collaborationRoomDocument.get()) {
      if (!backup) {
        showToast(t("workspace.collaboration.roomChartSaveBlocked"), "warning");
      }
      return Promise.resolve(null);
    }
    const payload = { saveAs, cancel: false };
    extensionRegistry.emitHook("document:before-save", payload);
    if (payload.cancel) {
      return Promise.resolve(null);
    }
    const generation = documentCoordinator.snapshot().revisions.generation;
    return documentCoordinator
      .submit<SaveResult | null>({
        kind: "save",
        expected: { generation },
        run: async ({ state }) => {
          const value = await documentSaver.save(
            saveAs,
            path,
            backup ? { quiet: true, ...(onProgress ? { onProgress } : {}) } : {},
          );
          if (value?.status !== "saved") {
            return { status: "accepted", value };
          }
          // A background backup keeps the live unsaved baseline and revision
          // state untouched; only an explicit save publishes the fingerprint.
          if (backup) {
            return { status: "accepted", value };
          }
          // The saver has already marked the history baseline. This is the
          // single saved-fingerprint write for an explicit save.
          const history = getSession().history;
          return {
            status: "accepted",
            value,
            revisions: {
              chartFingerprint: history.fingerprint(),
              savedChartFingerprint: history.savedFingerprint,
              diskSnapshot: value.disk_snapshot ?? state.revisions.diskSnapshot,
              source: "synced" as const,
            },
          };
        },
      })
      .then((admitted) => {
        if (admitted.status !== "accepted") {
          return null;
        }
        const result = admitted.value ?? null;
        if (!backup && result?.status === "saved") {
          void diskObserver?.rescan();
        }
        if (!backup && result?.status === "saved" && extensionRegistry.hasEvent("document:saved")) {
          extensionRegistry.emitEvent("document:saved", {
            name: getChartName(),
            path: result.path,
            chart: structuredClone(getSession().chart),
          });
        }
        return result;
      });
  };
  const save = () => runSave(false);
  const saveAs = () => runSave(true);
  const backup = (onProgress?: (value: number) => void) =>
    runSave(false, undefined, true, onProgress);
  conversionSaver.current = save;

  const diskResolver = createDiskChangeResolver({
    isDirty,
    revision: () => {
      const current = documentCoordinator.snapshot();
      return {
        chartFingerprint: current.revisions.chartFingerprint,
        generation: current.revisions.generation,
      };
    },
    readDiskSnapshot: () => options.documents?.diskSnapshot() ?? Promise.resolve(null),
    reloadFromDisk: async (expected) => {
      const path = options.documents?.current?.path;
      if (!path) {
        throw new Error(t("workspace.document.error.pathUnavailable"));
      }
      await candidateLoader.openPath(path, "open", expected);
    },
    retainLocal: () => undefined,
    saveAs: async () => {
      const result = await saveAs();
      if (result?.status !== "saved") {
        throw new Error(t("workspace.document.error.saveFailed"));
      }
    },
  });

  /** Asks how to reconcile an external disk change and applies the answer. */
  const resolveDiskObservation = async (snapshot: string | null): Promise<void> => {
    for (;;) {
      const dirty = isDirty();
      const promptState = documentCoordinator.snapshot();
      const actions: readonly DiskChangeAction[] = dirty
        ? ["reload", "retain", "save-as"]
        : ["reload", "retain"];
      const action = await requestChoice({
        title: t("workspace.document.diskChange.title"),
        description: `${t(
          dirty
            ? "workspace.document.diskChange.dirtyBody"
            : "workspace.document.diskChange.cleanBody",
        )} ${t("workspace.document.diskChange.limitation")}`,
        entries: actions,
        label: (value) =>
          t(
            value === "reload"
              ? "workspace.document.diskChange.reload"
              : value === "retain"
                ? "workspace.document.diskChange.keepLocal"
                : "workspace.document.diskChange.saveAs",
          ),
      });
      if (!action) {
        return;
      }
      const result = await diskResolver.resolve({
        snapshot,
        dirty,
        chartFingerprint: promptState.revisions.chartFingerprint,
        generation: promptState.revisions.generation,
        action,
      });
      if (result.status === "stale" && result.reason === "dirty_state_changed") {
        continue;
      }
      if (result.status === "stale") {
        options.notify(t("workspace.document.diskChange.stale"), "warning");
        return;
      }
      if (result.status === "retained") {
        options.notify(t("workspace.document.diskChange.retained"), "warning");
        return;
      }
      if (result.status === "failed") {
        options.reportError(result.error);
      }
      return;
    }
  };

  /** Refresh changed loose-document resources before resolving the disk state. */
  const refreshExternalResources = async (): Promise<boolean> => {
    const changed =
      (await options.documents?.assets?.refreshFromDisk(getAssets())) ?? ([] as string[]);
    if (!changed.length) {
      return false;
    }
    // Shader invalidation is synchronous up to the async source read, so the
    // preview can repaint as soon as the external editor has written the file.
    preview.realtimePreview.reloadShaderSources(changed);
    bumpCollaborationAssetRevision();
    void preview.images
      .load(getSession().chart, getAssets(), getChartName())
      .catch(options.reportError);
    void inspector.assetLibrary.render();
    return true;
  };

  if (options.documents) {
    let diskDecision: Promise<void> | null = null;
    diskObserver = createDiskChangeObserver({
      coordinator: documentCoordinator,
      events: {
        subscribe: (listener) => options.documents?.listenForDiskChanges(listener) ?? (() => {}),
      },
      probe: () => options.documents?.diskSnapshot() ?? Promise.resolve(null),
      onObservation: (observation) => {
        if (
          (observation.status === "external-pending" || observation.status === "conflict") &&
          !diskDecision
        ) {
          const refresh = refreshExternalResources().catch((error) => {
            options.reportError(error);
            return false;
          });
          if (!isDirty() && options.documents) {
            void refresh.then((changed) => {
              if (changed) {
                void diskObserver?.rescan();
              }
            });
            return;
          }
          diskDecision = refresh
            .then(() => resolveDiskObservation(observation.snapshot))
            .catch(options.reportError)
            .finally(() => {
              diskDecision = null;
              void diskObserver?.rescan();
            });
        }
      },
    });
    void diskObserver.start().catch(options.reportError);
    options.scope.add(diskObserver.dispose);
  }
  /** Runs a document action once the unsaved-changes prompt is accepted. */
  function guardReplace(
    action: () => unknown,
    title = t("editor.app.dialog.switchChart"),
  ): Promise<boolean> {
    const run = async (): Promise<boolean> => {
      try {
        await action();
        return true;
      } catch (error) {
        options.reportError(error);
        return false;
      }
    };
    if (!(getSession().history.dirty || options.document.assetDirty)) {
      return run();
    }
    return requestConfirm({
      title,
      description: t("editor.dialogs.dialog.unsavedChanges"),
      destructive: true,
    }).then((confirmed) => (confirmed ? run() : false));
  }
  /** Replaces the open document with a blank chart and no name on disk. */
  const installBlankChart = () => replaceChart(createChart(), "chart.json");
  /**
   * Creates an empty document and saves it into the library immediately.
   *
   * A failed load restores the previous document. A failed initial save leaves
   * the new chart open so the user can retry with Save.
   */
  async function createBlankChartDocument(
    trigger: "ask-after-audio" | "detect-after-audio" | "none" = "none",
  ): Promise<void> {
    const next = createStarterChart();
    const assets: AssetMap = new Map();
    const previous = getSession();
    const previousAssets = getAssets();
    const previousName = getChartName();
    const previousProject = options.document.libraryProject;
    const previousAssetDirty = options.document.assetDirty;
    const previousFolders = options.document.assetFolders;
    const previousDraft = options.document.lastDraftDocument;
    const previousDesktop = options.documents?.current ?? undefined;
    const wasAtHome = getEditorVisibility().atHome;
    const hadDocument = options.hasDocument();
    try {
      await loadCandidate(
        { chart: next, name: "chart.json" },
        assets,
        undefined,
        "create",
        undefined,
        async () => {
          await options.documents?.close();
        },
      );
      if (getSession().chart !== next) {
        throw new Error(t("editorPanels.newChart.unavailable"));
      }
    } catch (error) {
      if (getSession().chart === next) {
        try {
          await loadCandidate(
            {
              chart: previous.chart,
              name: previousName,
              project: previousProject ?? undefined,
              desktop: previousDesktop,
            },
            previousAssets,
            undefined,
            "restore",
          );
        } catch (restoreError) {
          options.reportError(restoreError);
        }
        getSession().removeEventListener("change", options.renderSession);
        options.session.replace(previous);
        previous.addEventListener("change", options.renderSession);
        timeline.clipboardHistory.attach(previous);
        options.document.assets = previousAssets;
        options.document.chartName = previousName;
        assignLibraryProject(previousProject);
        options.document.assetFolders = previousFolders;
        options.document.assetDirty = previousAssetDirty;
        options.document.lastDraftDocument = previousDraft;
        media.reset();
        preview.hitSounds.setProject(previous.chart, previousAssets, previousName);
        options.resetSelectionView();
        options.setHasDocument(hadDocument);
        options.setHome(wasAtHome);
        options.renderSession();
      }
      throw error;
    }
    if (trigger !== "none") {
      markTimingDetectionPending(getSession(), trigger === "ask-after-audio" ? "ask" : "detect");
    }
    getSession().history.markUnsaved();
    documentCoordinator.admitSync({
      kind: "save",
      run: () => undefined,
      revisions: () => ({ savedChartFingerprint: null }),
    });
    options.document.assetDirty = false;
    options.renderSession();
    // A new chart is a library project from the start. Creating the project now,
    // rather than on the first manual save, keeps it in the home library and
    // gives the session a revision to save against. The save reports its own
    // failure toast; reportError adds the diagnostic detail and recovery path.
    try {
      await save();
    } catch (error) {
      options.reportError(error);
    }
  }
  /** Installs the blank placeholder and publishes the closed-document state. */
  const finishClose = (coordinatorAlreadyClosed = false) => {
    clearTimingDetectionPending();
    installBlankChart();
    if (!coordinatorAlreadyClosed) {
      documentCoordinator.closeDocument();
    }
    options.setHasDocument(false);
    preview.hitSounds.setProject(null, new Map(), "");
    options.setHome(true);
    extensionRegistry.emitEvent("document:closed", {
      name: "",
      path: null,
      chart: null,
    });
  };
  /** Runs the before-close hook and reports whether closing may proceed. */
  const approveClose = (): boolean => {
    const payload = { cancel: false };
    extensionRegistry.emitHook("document:before-close", payload);
    return !payload.cancel;
  };
  /** Starts closing the document and returns false when an extension cancels it. */
  const closeDocument = (): boolean => {
    if (!approveClose()) {
      return false;
    }
    void documentCoordinator
      .submitClose(async () => {
        await documentLeases.releaseCurrent();
        finishClose(true);
      })
      .catch(options.reportError);
    return true;
  };
  /** Discards a temporary room document without letting a close hook retain it. */
  const discardDocument = (): void => {
    void documentCoordinator
      .submitClose(async () => {
        await documentLeases.releaseCurrent();
        finishClose(true);
      })
      .catch(options.reportError);
  };
  /** Describes the open document for the public document API. */
  const documentDescriptor = () => {
    const current = options.documents?.current;
    if (!options.hasDocument()) {
      return { status: "empty" as const, path: null, name: "", format: "memory" as const };
    }
    if (!current) {
      return {
        status: "open" as const,
        path: null,
        name: options.document.chartName,
        format: "memory" as const,
      };
    }
    return {
      status: "open" as const,
      path: current.path,
      name: current.chart_name,
      format: current.packed ? ("pez" as const) : ("json" as const),
    };
  };
  /** Closes the document for the public API, rejecting when the close is refused. */
  const closeForApi = async () => {
    if (!approveClose()) {
      throw new Error(t("workspace.document.error.closeCancelled"));
    }
    const admitted = await documentCoordinator.submitClose(async () => {
      await options.documents?.close();
      await documentLeases.releaseCurrent();
      finishClose(true);
    });
    if (admitted.status !== "accepted") {
      throw new Error(
        admitted.status === "rejected"
          ? (admitted.message ?? admitted.reason)
          : t("system.document.loadCancelled"),
      );
    }
  };
  /** Creates a named in-memory document for the public API. */
  const createForApi = async (name: string, chart: Chart) => {
    const payload = { cancel: false };
    extensionRegistry.emitHook("document:before-create", payload);
    if (payload.cancel) {
      throw new Error(t("workspace.document.error.createCancelled"));
    }
    const lease = await acquireDocumentLease(null, name);
    if (!lease) {
      throw new Error(t("system.document.loadCancelled"));
    }
    try {
      const admitted = await documentCoordinator.submitReplacement(async (load) => {
        options.document.chartName = name;
        replaceChart(chart, name);
        if (
          !load.complete({
            chartFingerprint: chartFingerprint(chart),
            savedChartFingerprint: chartFingerprint(chart),
          })
        ) {
          throw new Error(t("system.document.loadCancelled"));
        }
        await options.documents?.close();
        if (extensionRegistry.hasEvent("document:created")) {
          extensionRegistry.emitEvent("document:created", {
            name: getChartName(),
            path: options.documents?.current?.path ?? null,
            chart: structuredClone(getSession().chart),
          });
        }
      });
      if (admitted.status !== "accepted") {
        throw new Error(
          admitted.status === "rejected"
            ? (admitted.message ?? admitted.reason)
            : t("system.document.loadCancelled"),
        );
      }
      await lease.commit();
      if (readTimingDetectionPreference() === "always") {
        markTimingDetectionPending(getSession());
      }
    } catch (error) {
      await lease.cancel();
      throw error;
    }
  };
  /** Opens a native path for the public API. */
  const openPathForApi = async (path: string) => {
    if (!options.documents) {
      throw new Error(t("workspace.document.error.pathUnavailable"));
    }
    await openNativeChart(path);
  };
  /** Parses chart bytes for the public API and installs the single candidate. */
  const openBytesForApi = async (
    bytes: Uint8Array,
    name: string,
  ): Promise<"loaded" | "multiple"> => {
    const opened = await openFiles(
      [
        {
          name,
          arrayBuffer: async () => bytes.slice().buffer,
        },
      ],
      undefined,
      parseChartEntriesOffThread,
      readZipOffThread,
    );
    if (!opened) {
      throw new Error(t("workspace.document.error.bytesMissing"));
    }
    if (opened.candidates.length !== 1) {
      return "multiple";
    }
    await loadCandidate(
      opened.candidates[0],
      opened.assets,
      undefined,
      "open",
      undefined,
      async () => {
        await options.documents?.close();
      },
    );
    return "loaded";
  };
  /** Saves for the public API, returning the native result status. */
  const saveForApi = async (path?: string): Promise<"saved" | "save_conflict"> => {
    if (!options.hasDocument()) {
      throw new Error(t("workspace.document.error.noDocument"));
    }
    if (!getSession().editable) {
      throw new Error(t("workspace.document.error.readOnly"));
    }
    const result = await runSave(Boolean(path), path);
    if (!result) {
      throw new Error(t("workspace.document.error.saveFailed"));
    }
    return result.status;
  };
  options.scope.add(
    connectDocumentApi({
      descriptor: documentDescriptor,
      fingerprint: () => documentCoordinator.snapshot().revisions.chartFingerprint,
      chart: () => (options.hasDocument() ? getSession().chart : null),
      dirty: () =>
        options.hasDocument() && (getSession().history.dirty || options.document.assetDirty),
      create: createForApi,
      openPath: openPathForApi,
      openBytes: openBytesForApi,
      save: saveForApi,
      close: closeForApi,
    }),
  );
  options.scope.add(
    connectChartApi({
      chart: () => (options.hasDocument() ? getSession().chart : null),
      revision: () => ({
        chartFingerprint: documentCoordinator.snapshot().revisions.chartFingerprint,
        generation: documentCoordinator.snapshot().revisions.generation,
      }),
    }),
  );
  options.scope.add(
    connectTransactionApi({ session: () => (options.hasDocument() ? getSession() : null) }),
  );
  options.scope.add(
    connectCodeCellApi(
      createCodeCellAdapter({
        state: () => ({ revisions: toDocumentRevisions(documentCoordinator.snapshot().revisions) }),
        code: {
          run: (request) => codeCellRuntime.run(request),
        },
        frame: (request) => options.resources.preview.captureFrame(request),
        enabled: codeExecutionEnabled,
      }),
    ),
  );
  options.scope.add(
    codeCellRuntime.connectRevisions(() =>
      toDocumentRevisions(documentCoordinator.snapshot().revisions),
    ),
  );
  options.scope.add(
    connectDocumentService({
      documents: options.documents,
      openNativeDocument: () => chooseNativeChart(),
      guardReplace,
      createBlankChart: createBlankChartDocument,
      hasUnsavedChanges: () =>
        options.hasDocument() && (getSession().history.dirty || options.document.assetDirty),
      loadCandidate,
      save,
      saveAs,
      closeDocument,
      pickMedia: (kind) => media.pick(kind),
      getAssets,
      getSession,
      getChartName,
      setLibraryProject: (project) => {
        assignLibraryProject(project);
      },
      renderSession: options.renderSession,
      notify: options.notify,
      reportError: options.reportError,
      assetLibrary: inspector.assetLibrary,
    }),
  );
  options.scope.listen(window, EXPORT_DOCUMENT_EVENT, () => {
    void (async () => {
      // A library document has no native asset store behind it. Materialize the
      // lazy map once so PEZ export includes every referenced resource.
      const live = getAssets();
      const backgroundPath = assetPath(live, getSession().chart.META.background, getChartName());
      const background = backgroundPath ? live.uri?.(backgroundPath) : undefined;
      const assets =
        options.document.libraryProject?.id && !options.documents?.current
          ? await materializeAssets(live)
          : new Map(live);
      showExportDialog(getSession().chart, assets, getChartName(), (name) => {
        // A compact cover thumbnail is a recognition cue in the completion toast.
        showToast({
          message: t("editor.app.status.exported", { name }),
          level: "success",
          ...(background ? { media: { kind: "image" as const, src: background } } : {}),
        });
      });
    })().catch(options.reportError);
  });
  /** Opens the first dropped path, guarding unsaved changes. */
  const openPaths = async (paths: string[]): Promise<void> => {
    const documents = options.documents;
    const path = paths[0];
    if (!path || !documents) {
      return;
    }
    if (getSession().history.dirty || options.document.assetDirty) {
      guardReplace(() => openNativeChart(path));
      return;
    }
    await openNativeChart(path);
  };
  let assetReloadTimer: number | null = null;
  /** Coalesces asset-driven image reloads into one delayed decode. */
  const scheduleImageReload = (): void => {
    if (assetReloadTimer !== null) {
      return;
    }
    assetReloadTimer = window.setTimeout(() => {
      assetReloadTimer = null;
      const chart = getSession().chart;
      void preview.images.load(chart, getAssets(), getChartName()).catch(options.reportError);
    }, 80);
  };
  options.scope.add(() => {
    if (assetReloadTimer !== null) {
      window.clearTimeout(assetReloadTimer);
      assetReloadTimer = null;
    }
  });

  /** Installs a room asset, reloads its media, and marks the document dirty. */
  const adoptAsset = (name: string, bytes: Uint8Array): void => {
    const assets = getAssets();
    assets.set(name, bytes);
    options.document.assetDirty = true;
    const chart = getSession().chart;
    const references = resourceReferences(chart, assets, getChartName());
    if (name === references.song) {
      void loadMusic(bytes, name, false).catch(options.reportError);
    } else {
      scheduleImageReload();
    }
    preview.hitSounds.setProject(chart, assets, getChartName());
    void preview.hitSounds.prepare().catch(options.reportError);
    options.invalidate();
  };

  /** Resolve the chart cover through the library project or the document assets. */
  const coverUrl = (): string => {
    const chart = getSession().chart;
    const project = options.document.libraryProject;
    return editorDocumentCoverUrl(
      serverOrigin(),
      project?.id ?? "",
      chart,
      getAssets(),
      getChartName(),
      project?.background || "",
    );
  };

  return {
    metadataMedia: media,
    replaceChart,
    adoptChart,
    currentAssets: getAssets,
    currentChartName: getChartName,
    coverUrl,
    adoptAsset,
    loadCandidate,
    save,
    saveAs,
    backup,
    documentSaver,
    guardReplace,
    installBlankChart,
    closeDocument,
    discardDocument,
    openPaths,
  };
}
