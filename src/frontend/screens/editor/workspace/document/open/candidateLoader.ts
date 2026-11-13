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
import type { ChartDocument } from "../../../../../../core/global/chart/streaming/chartDocument.ts";
import { PAGED_PRELOAD_MAX_LINES } from "../../../../../../core/global/chart/streaming/chartStreamTypes.ts";
import { extensionRuntime } from "../../../../../../core/extensions/extensionRuntime.ts";
import { codeExecutionEnabled } from "../../../../../../core/codecell/enabled.ts";
import { collaborationRoomDocument } from "../../../../../../core/collaboration/ui.ts";
import { loadingPaint, type LoadTask } from "../../../../../../core/global/document/loading.ts";
import { HitSounds } from "../../../../../../core/media/hitsounds.ts";
import { ProjectImages } from "../../../../../../core/media/images.ts";
import type { EditorCandidate } from "../../../../../../core/global/document/types.ts";
import type { ChartRevisionSeed } from "../../../../../../core/global/chart/chartRevisionSeed.ts";
import type { LibraryProjectRef } from "../../../../../../core/global/library/types.ts";
import { t } from "../../../../../../i18n/index.ts";

const YIELD_INTERVAL = 512;
/** Keep dense event charts paged even when they contain relatively few lines. */
const PAGED_LINE_THRESHOLD = 10_000;
/** Avoid eagerly materializing a chart whose indexed object graph is already large. */
const PAGED_OBJECT_THRESHOLD = 100_000;

/** Yield while visiting large note/event collections so loading progress can paint. */
async function reportChartObjectProgress(chart: Chart, task: LoadTask): Promise<void> {
  const lines = chart.judgeLineList ?? [];
  const noteTotal = lines.reduce((count, line) => count + (line.notes?.length ?? 0), 0);
  let notesDone = 0;
  task.update("notes", 0, noteTotal);
  for (const line of lines) {
    for (const _note of line.notes ?? []) {
      notesDone++;
      if (notesDone % YIELD_INTERVAL === 0) {
        task.update("notes", notesDone, noteTotal);
        await loadingPaint();
      }
    }
  }
  task.update("notes", noteTotal, noteTotal);

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
  let eventsDone = 0;
  task.update("events", 0, eventTotal);
  for (const line of lines) {
    for (const layer of [...(line.eventLayers ?? []), line.extended]) {
      for (const events of Object.values(layer ?? {})) {
        if (!Array.isArray(events)) {
          continue;
        }
        for (const _event of events) {
          eventsDone++;
          if (eventsDone % YIELD_INTERVAL === 0) {
            task.update("events", eventsDone, eventTotal);
            await loadingPaint();
          }
        }
      }
    }
  }
  task.update("events", eventTotal, eventTotal);
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
}

/** Owns the ordered work needed to turn a parsed candidate into a loaded editor document. */
export function createCandidateLoader(deps: CandidateLoaderDependencies) {
  return async (candidate: EditorCandidate, nextAssets: AssetMap, task: LoadTask) => {
    task.update("notes");
    await loadingPaint();
    const chartDocument = candidate.chartDocument;
    let chart: Chart | undefined;
    let chartDocumentForSession: ChartDocument | undefined;
    let revisionSeed: ChartRevisionSeed | undefined;
    let diagnostics: NonNullable<EditorCandidate["diagnostics"]> = [];
    if (chartDocument) {
      const initialLine = candidate.project?.viewState?.lineIndex ?? 0;
      if (
        Number.isInteger(initialLine) &&
        initialLine >= 0 &&
        initialLine < chartDocument.lineCount
      ) {
        await chartDocument.ensureAncestors(initialLine);
      }
      // Large documents keep their paged session; normal documents materialize
      // eagerly so every existing surface sees a complete object graph.
      // Extensions and collaboration still consume the synchronous full chart,
      // so they force eager mode rather than seeing paged placeholders.
      const pagedAllowed =
        !extensionRuntime.hasEnabled() &&
        !codeExecutionEnabled() &&
        !collaborationRoomDocument.get();
      const indexedObjectCount =
        chartDocument.index?.lines.reduce(
          (total, summary) => total + summary.noteCount + summary.eventCount,
          0,
        ) ?? 0;
      const denseChart = indexedObjectCount > PAGED_OBJECT_THRESHOLD;
      const usePagedSession =
        pagedAllowed && (chartDocument.lineCount > PAGED_LINE_THRESHOLD || denseChart);
      if (usePagedSession) {
        try {
          // Dense charts often have unbounded event lines. Preloading their
          // initial time window would still materialize every line, so the
          // selected line and its ancestors are the only startup reads.
          if (!denseChart) {
            await chartDocument.ensureTime(0, 60, { maxLines: PAGED_PRELOAD_MAX_LINES });
          }
          chart = chartDocument.chart;
          chartDocumentForSession = chartDocument;
        } catch {
          // A conservative window exceeded its cap; fall through to eager mode.
        }
      }
      if (!chartDocumentForSession) {
        try {
          await chartDocument.materializeAll();
          // The session must hold the document facade, not the detached
          // materialized snapshot, so later resource loading sees the same
          // chart identity. The facade now contains every materialized line.
          chart = chartDocument.chart;
          // Keep the document for streamed saves and canonical fingerprints.
          // Its worker/source is released with the session, not here.
          chartDocumentForSession = chartDocument;
        } catch (error) {
          candidate.disposeDocument?.();
          throw error;
        }
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
    await deps.images.load(
      textureChart,
      deps.currentAssets(),
      deps.currentChartName(),
      candidate.info,
      (done, total) => task.update("textures", done, total),
    );
    if (deps.currentChart() !== chart) {
      return;
    }

    const references = resourceReferences(
      chart,
      deps.currentAssets(),
      deps.currentChartName(),
      candidate.info,
    );
    const songPath = references.song
      ? assetPath(deps.currentAssets(), references.song, deps.currentChartName())
      : null;
    const songUri = songPath ? deps.currentAssets().uri?.(songPath) : undefined;
    const bytes =
      assetBytes(deps.currentAssets(), references.song, deps.currentChartName()) ??
      songUri ??
      (candidate.desktop && references.song
        ? deps.resolveDesktopSong(references.song, deps.currentAssets(), deps.currentChartName())
        : undefined);
    task.update("audio", 0, 2);
    await loadingPaint();
    if (bytes) {
      await deps.loadMusic(bytes, references.song, false);
    } else if (references.song) {
      deps.missingMusic(references.song);
    }
    task.update("audio", 1, 2);
    deps.hitSounds.chart = chart;
    await deps.hitSounds.prepare();
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
    await deps.waitForFirstRender(task);
  };
}
