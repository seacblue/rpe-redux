/**
 * Maps a library project payload to the editor's unvalidated candidate shape.
 *
 * The home screen and a project reload need the same title fallback and project
 * reference; only the surrounding guard behavior differs.
 */
import type {
  EditorCandidate,
  UnvalidatedChart,
} from "../../../../../../core/global/document/types.ts";
import type { ChartDocument } from "../../../../../../core/global/chart/streaming/chartDocument.ts";
import type { LibraryViewState } from "../../../../../../core/global/library/types.ts";
import { parseChartEditSeconds } from "../../../../../../core/global/chart/editTime.ts";

interface LibraryProjectSource {
  name?: string;
  chart?: unknown;
  revision?: number;
  group?: string;
  background?: string;
  assetFolders?: string[];
  viewState?: LibraryViewState;
  editSeconds?: number;
}

/** Backfill chartTime for projects created before the chart root carried it. */
function chartWithProjectEditTime(project: LibraryProjectSource): unknown {
  if (!project.chart || typeof project.chart !== "object") {
    return project.chart;
  }
  const chart = project.chart as Record<string, unknown>;
  if (parseChartEditSeconds(chart.chartTime) !== null) {
    return project.chart;
  }
  const seconds = parseChartEditSeconds(project.editSeconds);
  return seconds === null ? project.chart : { ...chart, chartTime: seconds };
}

/** Maps a library project payload to an unvalidated editor candidate. */
export function libraryCandidate(project: LibraryProjectSource, id: string): EditorCandidate {
  const name =
    project.name || String((project.chart as UnvalidatedChart | null)?.META?.name ?? "chart.json");
  return {
    chart: chartWithProjectEditTime(project),
    name,
    project: {
      id,
      ...(project.revision !== undefined ? { revision: project.revision } : {}),
      ...(project.name ? { name: project.name } : {}),
      ...(project.group ? { group: project.group } : {}),
      ...(project.background ? { background: project.background } : {}),
      ...(project.assetFolders ? { assetFolders: project.assetFolders } : {}),
      ...(project.viewState ? { viewState: project.viewState } : {}),
    },
  };
}

/** Maps a streamed library document to an editor candidate. */
export function libraryDocumentCandidate(
  project: LibraryProjectSource,
  id: string,
  document: ChartDocument,
): EditorCandidate {
  const name = project.name || String(document.header.META.name ?? "") || "chart.json";
  return {
    chart: document.chart,
    chartDocument: document,
    ...(document.dispose ? { disposeDocument: () => document.dispose?.() } : {}),
    name,
    project: {
      id,
      ...(project.revision !== undefined ? { revision: project.revision } : {}),
      ...(project.name ? { name: project.name } : {}),
      ...(project.group ? { group: project.group } : {}),
      ...(project.background ? { background: project.background } : {}),
      ...(project.assetFolders ? { assetFolders: project.assetFolders } : {}),
      ...(project.viewState ? { viewState: project.viewState } : {}),
    },
  };
}
