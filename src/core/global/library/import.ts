/**
 * Imports a chart and its resources into the SQLite library.
 *
 * Opening an external JSON/PEZ is an import, not a live file binding. The
 * caller supplies the already parsed chart and asset map; this module reads the
 * lazy bytes and writes a normal library project. A chart opened through the
 * streaming host is a document facade, so its text comes from the document's
 * line serializer instead of the placeholder lines on the facade object.
 */
import { serializeChart } from "../chart/chart.ts";
import { registeredChartDocument } from "../chart/streaming/chartDocumentRegistry.ts";
import type { AssetMap } from "../document/types.ts";
import { materializeAssets } from "./document.ts";
import { saveLibraryDocument, type LibrarySaveResult } from "./save.ts";
import { LocalLibraryError, type LocalLibrary } from "./client.ts";
import type { LibraryViewState } from "./types.ts";

/** Input for importing an opened document into the library. */
export interface LibraryImportInput {
  library: LocalLibrary;
  chart: unknown;
  name: string;
  assets: AssetMap;
  /** Existing project to refresh, or omitted to create a new one. */
  projectId?: string;
  group?: string;
  viewState?: LibraryViewState;
  assetFolders?: readonly string[];
  /** Reuse text the caller already produced. */
  chartJson?: string;
  onProgress?: (value: number) => void;
}

/**
 * Serialize the chart text a library import should store.
 *
 * A document-backed facade keeps only placeholder lines in memory; its
 * serializer streams the real lines from the native source. Charts parsed in
 * memory still use the shared whole-chart serializer.
 */
async function serializeImportedChart(chart: unknown): Promise<string> {
  const document =
    chart && typeof chart === "object" ? registeredChartDocument(chart as object) : undefined;
  if (document?.serialize) {
    const chunks: string[] = [];
    await document.serialize((chunk) => {
      chunks.push(chunk);
    });
    return chunks.join("");
  }
  if (document) {
    return serializeChart(await document.materializeAll());
  }
  return serializeChart(chart);
}

/** Import one opened document into the library. */
export async function importChartToLibrary(input: LibraryImportInput): Promise<LibrarySaveResult> {
  const chartJson = input.chartJson ?? (await serializeImportedChart(input.chart));
  const assets = await materializeAssets(input.assets);
  const saveInput = {
    library: input.library,
    ...(input.projectId ? { projectId: input.projectId } : {}),
    chart: input.chart,
    chartJson,
    name: input.name,
    assets,
    ...(input.group ? { group: input.group } : {}),
    ...(input.viewState ? { viewState: input.viewState } : {}),
    ...(input.assetFolders ? { assetFolders: input.assetFolders } : {}),
    ...(input.onProgress ? { onProgress: input.onProgress } : {}),
  };
  try {
    return await saveLibraryDocument(saveInput);
  } catch (error) {
    if (!(input.projectId && error instanceof LocalLibraryError && error.status === 404)) {
      throw error;
    }
    // A path catalogue can reference a project that no longer exists. Retry as
    // a new project so re-importing that source repairs the stale identity
    // instead of surfacing the backend's missing-resource response.
    return saveLibraryDocument({ ...saveInput, projectId: undefined });
  }
}
