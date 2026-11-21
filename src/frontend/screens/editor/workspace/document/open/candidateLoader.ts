/**
 * Turns parsed chart candidates into an installed editor document: validates and
 * sanitizes the chart, attaches external resources, and loads media. Asset and
 * media owners stay with their features; the document service calls this loader.
 */
import {
  assertChart,
  isChartObjectIdsNormalized,
  stripLegacyTrajectory,
  type Chart,
} from "../../../../../../core/global/chart/chart.ts";
import { stripReduxExportVersion } from "../../../../../../core/global/chart/exportProjection.ts";
import {
  ChartLoadError,
  collectChartDiagnostics,
  sanitizeChartForReadOnly,
} from "../../../../../../core/global/chart/diagnostics.ts";
import {
  assetBytes,
  assetPath,
  resourceReferences,
} from "../../../../../../core/global/document/resources.ts";
import { attachExternalEffects } from "../../../../../../core/global/document/effects.ts";
import { type AssetMap } from "../../../../../../core/global/document/types.ts";
import type {
  ChartDocument,
  ChartMaterializeProgress,
} from "../../../../../../core/global/chart/streaming/chartDocument.ts";
import { loadingPaint, type LoadTask } from "../../../../../../core/global/document/loading.ts";
import { HitSounds } from "../../../../../../core/media/hitsounds.ts";
import { ProjectImages } from "../../../../../../core/media/images.ts";
import type { EditorCandidate } from "../../../../../../core/global/document/types.ts";
import type { ChartRevisionSeed } from "../../../../../../core/global/chart/chartRevisionSeed.ts";
import type { LibraryProjectRef } from "../../../../../../core/global/library/types.ts";
import { t } from "../../../../../../i18n/index.ts";

const YIELD_INTERVAL = 512;
/** Report one open-stage duration to the optional browser benchmark probe. */
function reportOpenTiming(stage: string, durationMs: number): void {
  const probe = (
    globalThis as typeof globalThis & {
      __reduxDocumentLoadTimingProbe?: (sample: { stage: string; durationMs: number }) => void;
    }
  ).__reduxDocumentLoadTimingProbe;
  probe?.({ stage, durationMs });
}

/** Yield while visiting large note/event collections so loading progress can paint. */
async function reportChartObjectProgress(chart: Chart, task: LoadTask): Promise<void> {
  const lines = chart.judgeLineList ?? [];
  const noteTotal = lines.reduce((count, line) => count + (line.notes?.length ?? 0), 0);
  const eventTotal = lines.reduce(
    (count, line) =>
      count +
      [...(line.eventLayers ?? []), line.extended].reduce(
        (sum, layer) =>
          sum +
          Object.values(layer ?? {}).reduce(
            (layerSum, events) => layerSum + (Array.isArray(events) ? events.length : 0),
            0,
          ),
        0,
      ),
    0,
  );
  const objectTotal = noteTotal + eventTotal;
  const progressTotal = objectTotal || lines.length;
  let notesDone = 0;
  let eventsDone = 0;
  task.update("content", 0, progressTotal);
  let processed = 0;
  const report = async () => {
    const completed = objectTotal ? notesDone + eventsDone : processed;
    task.update("content", completed, progressTotal);
    await loadingPaint();
  };
  for (const line of lines) {
    for (const _note of line.notes ?? []) {
      notesDone++;
      processed++;
      if (processed % YIELD_INTERVAL === 0) {
        await report();
      }
    }
    for (const layer of [...(line.eventLayers ?? []), line.extended]) {
      for (const events of Object.values(layer ?? {})) {
        if (!Array.isArray(events)) {
          continue;
        }
        for (const _event of events) {
          eventsDone++;
          processed++;
          if (processed % YIELD_INTERVAL === 0) {
            await report();
          }
        }
      }
    }
  }
  task.update("content", progressTotal, progressTotal);
}

/** Services the candidate loader needs from the mounted editor. */
export interface CandidateLoaderDependencies {
  images: ProjectImages;
  hitSounds: HitSounds;
  replaceChart: (
    chart: Chart,
    name: string,
    assets: AssetMap,
    folders: string[],
    loadImages: boolean,
    diagnostics?: EditorCandidate["diagnostics"],
    readOnly?: boolean,
    document?: ChartDocument,
    revisionSeed?: ChartRevisionSeed,
  ) => void;
  setLibraryProject: (project: LibraryProjectRef | null) => void;
  currentChart: () => Chart;
  currentAssets: () => AssetMap;
  currentChartName: () => string;
  /** Active line on the installed session, used to seed a paged open. */
  currentLineIndex: () => number;
  resolveDesktopSong: (song: string, assets: AssetMap, chartName: string) => string | undefined;
  loadMusic: (bytes: Uint8Array | string, name: string, updateMetadata?: boolean) => Promise<void>;
  missingMusic: (name: string) => void;
  selectLine: (index: number) => void;
  invalidate: () => void;
  waitForFirstRender: (task: LoadTask) => Promise<void>;
  /** Compile the complete preview scene before the first visible frame. */
  preparePreview?: (task: LoadTask) => Promise<void>;
  reportError?: (error: unknown) => void;
}

/** Owns the ordered work needed to turn a parsed candidate into a loaded editor document. */
export function createCandidateLoader(deps: CandidateLoaderDependencies) {
  return async (candidate: EditorCandidate, nextAssets: AssetMap, task: LoadTask) => {
    task.update("content");
    await loadingPaint();
    const chartDocument = candidate.chartDocument;
    let chart: Chart | undefined;
    let chartDocumentForSession: ChartDocument | undefined;
    let revisionSeed: ChartRevisionSeed | undefined;
    let diagnostics: NonNullable<EditorCandidate["diagnostics"]> = [];
    let audioPromise: Promise<void> | null = null;
    let fingerprintReady: Promise<void> = Promise.resolve();
    let installed = false;
    /**
     * Read the candidate's track into the shared audio host.
     *
     * The track does not depend on the installed session, so an open starts it
     * beside the line materialization instead of leaving the progress bar at
     * the audio stage after the chart is already parsed.
     */
    const loadAudio = (
      chartForAudio: Chart,
      assets: AssetMap,
      chartName: string,
    ): Promise<void> => {
      const references = resourceReferences(chartForAudio, assets, chartName, candidate.info);
      const songPath = references.song ? assetPath(assets, references.song, chartName) : null;
      const songUri = songPath ? assets.uri?.(songPath) : undefined;
      return (async () => {
        const bytes =
          assetBytes(assets, references.song, chartName) ??
          (songPath && assets.read ? await assets.read(songPath) : undefined) ??
          songUri ??
          (candidate.desktop && references.song
            ? deps.resolveDesktopSong(references.song, assets, chartName)
            : undefined);
        if (!bytes) {
          if (references.song) {
            deps.missingMusic(references.song);
          }
          return;
        }
        const audioStarted = performance.now();
        await deps.loadMusic(bytes, references.song, false);
        reportOpenTiming("media.music", performance.now() - audioStarted);
      })().catch((error) => {
        deps.reportError?.(error);
      });
    };
    if (chartDocument) {
      // The editor only opens once every line is materialized. A paged document
      // still keeps the index-driven progress totals and the document-backed
      // fingerprint, but the replacement boundary never exposes placeholders.
      try {
        const started = performance.now();
        const indexedLines = chartDocument.index?.lines ?? [];
        const totalNotes = indexedLines.reduce((total, summary) => total + summary.noteCount, 0);
        const totalEvents = indexedLines.reduce((total, summary) => total + summary.eventCount, 0);
        const totalLines = chartDocument.lineCount;
        // Every line contributes, whether or not it carries notes or events.
        // Counting objects alone lets the bar reach 100% while empty or sparse
        // lines are still being parsed, which looks like a stalled open.
        const progressTotal = totalNotes + totalEvents + totalLines;
        let lastProgressAt = 0;
        let lastProgressLine = -1;
        const publishMaterializeProgress = (progress: ChartMaterializeProgress) => {
          const now = performance.now();
          const lineChanged = progress.completedLines - lastProgressLine >= 8;
          const reachedEnd = progress.completedLines >= progress.totalLines;
          if (!reachedEnd && !lineChanged && now - lastProgressAt < 32) {
            return;
          }
          const completed =
            progress.completedNotes + progress.completedEvents + progress.completedLines;
          task.update("content", Math.min(completed, progressTotal), progressTotal);
          lastProgressAt = now;
          lastProgressLine = progress.completedLines;
        };
        task.update("content", 0, progressTotal);
        chart = chartDocument.chart;
        chartDocumentForSession = chartDocument;
        // Install before decoding the track: replacement releases the previous
        // audio owner. The loading surface still covers the editor, and every
        // line is materialized before the first visible frame.
        deps.replaceChart(
          chart,
          candidate.name,
          nextAssets,
          candidate.project?.assetFolders ?? [],
          false,
          diagnostics,
          Boolean(candidate.readOnly || diagnostics.length),
          chartDocument,
          revisionSeed,
        );
        deps.setLibraryProject(candidate.project ?? null);
        installed = true;
        // Audio and the browser digest pool do not depend on materialized
        // lines, so both run beside the line parse. By the time the content
        // stage reaches 100%, the track and hashes are normally ready.
        chartDocument.startFingerprintHydration?.();
        fingerprintReady = chartDocument.whenFingerprintReady();
        audioPromise = loadAudio(chart, nextAssets, candidate.name);
        await chartDocument.materializeAll({ onProgress: publishMaterializeProgress });
        reportOpenTiming("chart.materializeAll", performance.now() - started);
      } catch (error) {
        candidate.disposeDocument?.();
        throw error;
      }
    } else {
      // Parsed candidates already passed the whole-chart gate in the parser or
      // worker and carry their diagnostics, so the main thread does not need to
      // strip, collect, or validate them again.
      const parsedAndValidated =
        candidate.diagnostics !== undefined &&
        candidate.diagnostics.length === 0 &&
        isChartObjectIdsNormalized(candidate.chart as Chart);
      if (!parsedAndValidated) {
        stripLegacyTrajectory(candidate.chart);
        stripReduxExportVersion(candidate.chart);
      }
      const collected = candidate.diagnostics ?? collectChartDiagnostics(candidate.chart);
      diagnostics =
        candidate.diagnostics ??
        collected.map((entry) => ({
          ...entry,
          path: `${candidate.name}:${entry.path}`,
        }));
      const resolved = (
        diagnostics.length ? sanitizeChartForReadOnly(candidate.chart) : candidate.chart
      ) as Chart | null;
      if (!resolved) {
        throw new ChartLoadError(
          diagnostics,
          `${candidate.name}: ${t("model.chart.invalidDocument")}`,
        );
      }
      if (!parsedAndValidated) {
        assertChart(resolved);
      }
      revisionSeed = parsedAndValidated ? candidate.revisionSeed : undefined;
      await reportChartObjectProgress(resolved, task);
      attachExternalEffects([{ name: candidate.name, chart: resolved }], nextAssets);
      chart = resolved;
    }
    if (!chart) {
      throw new ChartLoadError(
        diagnostics,
        `${candidate.name}: ${t("model.chart.invalidDocument")}`,
      );
    }
    if (!installed) {
      deps.replaceChart(
        chart,
        candidate.name,
        nextAssets,
        candidate.project?.assetFolders ?? [],
        false,
        diagnostics,
        Boolean(candidate.readOnly || diagnostics.length),
        chartDocumentForSession,
        revisionSeed,
      );
      deps.setLibraryProject(candidate.project ?? null);
      // Start the track only after the old audio owner was released; the
      // decode then overlaps textures, scene preparation, and the first frame.
      audioPromise = loadAudio(chart, nextAssets, candidate.name);
    }

    const viewLine = candidate.project?.viewState?.lineIndex;
    const activeLine = deps.currentLineIndex();
    const requestedLine =
      typeof viewLine === "number" && Number.isInteger(viewLine) && chart.judgeLineList?.[viewLine]
        ? viewLine
        : Number.isInteger(activeLine) && chart.judgeLineList?.[activeLine]
          ? activeLine
          : null;
    const initialLine = requestedLine;

    task.update("textures");
    await loadingPaint();
    const textureChart = chartDocumentForSession?.index
      ? {
          ...chart,
          judgeLineList: chartDocumentForSession.index.assetNames
            .filter((name) => /\.(png|jpe?g|webp|gif|bmp|avif)$/i.test(name))
            .map((name) => ({ Texture: name })),
        }
      : chart;
    const textureStarted = performance.now();
    await deps.images.load(
      textureChart,
      deps.currentAssets(),
      deps.currentChartName(),
      candidate.info,
      (done, total) => task.update("textures", done, total),
    );
    reportOpenTiming("media.images", performance.now() - textureStarted);
    if (deps.currentChart() !== chart) {
      return;
    }

    task.update("audio", 0, 2);
    await loadingPaint();
    if (audioPromise) {
      await audioPromise;
    }
    task.update("audio", 1, 2);
    deps.hitSounds.chart = chart;
    task.update("audio", 2, 2);

    if (deps.currentChart() === chart && initialLine !== null) {
      deps.selectLine(initialLine);
    }

    task.update("render", 0, 1);
    // Compile the first scene in bounded slices so the loading surface keeps
    // painting; entering with a partial scene would be a different bug.
    await deps.preparePreview?.(task);
    // A deferred digest stream must finish before the first frame, or the
    // session would open read-only and change under the author a moment later.
    await fingerprintReady;
    deps.invalidate();
    const renderStarted = performance.now();
    await deps.waitForFirstRender(task);
    reportOpenTiming("render.firstFrame", performance.now() - renderStarted);
    // Hit sounds are not required for the first frame and can decode several
    // bundled files on the main thread. Let the editor settle before starting
    // that optional cache fill; playback also calls prepare() on demand.
    const scheduleHitSounds = () => {
      void (async () => {
        const hitSoundStarted = performance.now();
        await deps.hitSounds.prepare();
        reportOpenTiming("media.hitSounds", performance.now() - hitSoundStarted);
      })().catch((error) => {
        deps.reportError?.(error);
      });
    };
    if (typeof requestIdleCallback === "function") {
      requestIdleCallback(scheduleHitSounds, { timeout: 1000 });
    } else {
      setTimeout(scheduleHitSounds, 250);
    }
  };
}
