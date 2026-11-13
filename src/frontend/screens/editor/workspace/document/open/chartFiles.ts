/**
 * Opens chart files chosen from the platform picker: reads archives off-thread,
 * parses candidates, and hands them to the document's replace guard. File-format
 * rules live in core document modules; this file owns only the open flow.
 */
import {
  beginLoading,
  loadingPaint,
  loadingProgress,
} from "../../../../../../core/global/document/loading.ts";
import { openFiles } from "../../../../../../core/global/document/import.ts";
import type { OpenCandidate } from "../../../../../../core/global/document/types.ts";
import { parseChartEntriesOffThread } from "./chartParseOffThread.ts";
import { openChartDocumentFromBytes, openChartStreamFromChunks } from "./chartStreamOffThread.ts";
import { readZipOffThread } from "./zipReadOffThread.ts";

interface ChartFileOpenOptions {
  guardReplace: (action: () => unknown) => unknown;
  loadCandidate: (candidate: OpenCandidate, assets: Map<string, Uint8Array>) => Promise<void>;
  chooseCandidates: (candidates: OpenCandidate[], assets: Map<string, Uint8Array>) => void;
  reportError: (error: unknown) => void;
}

/** Chart file extensions the web picker offers; the desktop store filters natively. */
export const CHART_FILE_ACCEPT = ".json,.pez,.zip";

/**
 * Loads chart files chosen from the platform picker.
 *
 * The loading order is the flow's own: the progress task starts before the first
 * paint so the dialog is on screen while the archive is read, and the replace
 * guard runs only once the candidates are in hand.
 */
export async function openChartFiles(
  files: readonly File[],
  options: ChartFileOpenOptions,
): Promise<void> {
  if (!files.length) {
    return;
  }
  const task = beginLoading(files[0].name);
  try {
    await loadingPaint();
    if (files.length === 1 && /\.json$/i.test(files[0].name)) {
      try {
        const opened = await openChartStreamFromChunks(files[0].stream(), files[0].name);
        const candidate: OpenCandidate = {
          name: files[0].name,
          chart: opened.document.chart,
          chartDocument: opened.document,
          disposeDocument: () => opened.dispose(),
        };
        loadingProgress.dismiss();
        options.guardReplace(() => {
          options.loadCandidate(candidate, new Map()).catch(options.reportError);
        });
        return;
      } catch {
        // Fall through to the whole-entry parser so diagnostics and malformed
        // JSON still get the existing explanation.
      }
    }
    const loaded = await openFiles(
      [...files],
      task,
      parseChartEntriesOffThread,
      readZipOffThread,
      openChartDocumentFromBytes,
    );
    if (!loaded) {
      loadingProgress.dismiss();
      return;
    }
    const proceed = () => {
      if (loaded.candidates.length === 1) {
        options.loadCandidate(loaded.candidates[0], loaded.assets).catch(options.reportError);
      } else {
        options.chooseCandidates(loaded.candidates, loaded.assets);
      }
    };
    loadingProgress.dismiss();
    options.guardReplace(proceed);
  } catch (error) {
    task.fail(error);
    options.reportError(error);
  }
}
