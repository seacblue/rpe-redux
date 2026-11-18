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
  resolveDesktopSong: (song: string, assets: AssetMap, chartName: string) => string | undefined;
  loadMusic: (bytes: Uint8Array | string, name: string, updateMetadata?: boolean) => Promise<void>;
  missingMusic: (name: string) => void;
  selectLine: (index: number) => void;
  invalidate: () => void;
  waitForFirstRender: (task: LoadTask) => Promise<void>;
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
    if (chartDocument) {
      // An opened document is not allowed to expose the paged facade. The
      // editor's scene, timeline, and inspector all retain the chart reference
      // after replacement, so entering with placeholders would make missing
      // lines look like corrupt chart data and would page them in during play.
      // Paging remains available to library/storage seams, but the replacement
      // boundary always waits for the complete line graph.
      try {
        const started = performance.now();
        const indexedLines = chartDocument.index?.lines ?? [];
        const totalNotes = indexedLines.reduce((total, summary) => total + summary.noteCount, 0);
        const totalEvents = indexedLines.reduce((total, summary) => total + summary.eventCount, 0);
        const totalLines = chartDocument.lineCount;
        const progressTotal = totalNotes + totalEvents || totalLines;
        let lastProgressAt = 0;
        let lastProgressLine = -1;
        const publishMaterializeProgress = (progress: ChartMaterializeProgress) => {
          const now = performance.now();
          const lineChanged = progress.completedLines - lastProgressLine >= 8;
          const reachedEnd = progress.completedLines >= progress.totalLines;
          if (!reachedEnd && !lineChanged && now - lastProgressAt < 32) {
            return;
          }
          const objectTotal = totalNotes + totalEvents;
          const completed = objectTotal
            ? progress.completedNotes + progress.completedEvents
            : progress.completedLines;
          const combinedTotal = objectTotal || totalLines;
          task.update("content", Math.min(completed, combinedTotal), combinedTotal);
          lastProgressAt = now;
          lastProgressLine = progress.completedLines;
        };
        task.update("content", 0, progressTotal);
        await chartDocument.materializeAll({ onProgress: publishMaterializeProgress });
        reportOpenTiming("chart.materializeAll", performance.now() - started);
        // Keep the facade as the session chart: materializeAll has installed
        // every line into it, so no later playback request can page content in.
        chart = chartDocument.chart;
        chartDocumentForSession = chartDocument;
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

    const references = resourceReferences(
      chart,
      deps.currentAssets(),
      deps.currentChartName(),
      candidate.info,
    );
    const assets = deps.currentAssets();
    const songPath = references.song
      ? assetPath(assets, references.song, deps.currentChartName())
      : null;
    const songUri = songPath ? assets.uri?.(songPath) : undefined;
    task.update("audio", 0, 2);
    await loadingPaint();
    // The open is not usable without its track: a user who enters while the
    // decode is still running cannot hear the music and would have the playhead
    // restored underneath them when the background load finishes. Wait for the
    // decoded buffer here; waveform analysis remains asynchronous so playback
    // does not wait for it.
    const audioPromise = (async () => {
      const bytes =
        assetBytes(assets, references.song, deps.currentChartName()) ??
        (songPath && assets.read ? await assets.read(songPath) : undefined) ??
        songUri ??
        (candidate.desktop && references.song
          ? deps.resolveDesktopSong(references.song, assets, deps.currentChartName())
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
    await audioPromise;
    task.update("audio", 1, 2);
    deps.hitSounds.chart = chart;
    task.update("audio", 2, 2);

    if (deps.currentChart() === chart && candidate.project?.viewState) {
      const viewLine = candidate.project.viewState.lineIndex;
      if (
        typeof viewLine === "number" &&
        Number.isInteger(viewLine) &&
        chart.judgeLineList?.[viewLine]
      ) {
        deps.selectLine(viewLine);
      }
    }

    task.update("render", 0, 1);
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
    void audioPromise;
  };
}
