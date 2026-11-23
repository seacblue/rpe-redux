/**
 * Chart-file import for the browser host.
 *
 * The desktop importer reads native paths through the document store. A web
 * host has no paths, so the picked File objects go through the same parser and
 * library writer as an opened chart, without registering the files as the live
 * document. Each archive candidate becomes its own library project.
 */
import { openFiles } from "../../../core/global/document/import.ts";
import type { OpenCandidate } from "../../../core/global/document/types.ts";
import { importChartToLibrary } from "../../../core/global/library/import.ts";
import { localService } from "../../../core/global/library/service.ts";
import { startLongTask } from "../../../core/state/longTasks.ts";
import { t } from "../../../i18n/index.ts";
import { showToast } from "../../../design/patterns/ToastHost.tsx";
import { parseChartEntriesOffThread } from "../editor/workspace/document/open/chartParseOffThread.ts";
import { openChartDocumentFromBytes } from "../editor/workspace/document/open/chartStreamOffThread.ts";
import { readZipOffThread } from "../editor/workspace/document/open/zipReadOffThread.ts";
import { importWriteProgress, throwIfAborted } from "./importProgress.ts";
import { importExternalFiles } from "./externalImport.ts";

/** Host callbacks a browser import reports through. */
export interface BrowserImportDeps {
  reportError(error: unknown): void;
  refresh(): Promise<void>;
}

/** The chart's own title, falling back to the picked file name. */
function chartTitle(candidate: OpenCandidate): string {
  const meta = (candidate.chart as { META?: { name?: unknown } } | null)?.META;
  return typeof meta?.name === "string" && meta.name.trim() ? meta.name.trim() : candidate.name;
}

/** Release streaming documents the importer no longer needs. */
function disposeCandidates(candidates: readonly OpenCandidate[]): void {
  for (const candidate of candidates) {
    candidate.disposeDocument?.();
  }
}

/**
 * Import picked chart files into the browser library.
 *
 * One archive expands into every RPE JSON it contains, so multi-chart PEZ
 * packages keep all of their charts. Progress is retained as a background task
 * because the welcome page may unmount while the import is still writing.
 * Returns the created or refreshed project ids in chart order.
 */
export async function importBrowserChartFiles(
  files: readonly File[],
  deps: BrowserImportDeps,
): Promise<readonly string[]> {
  if (!files.length) {
    return [];
  }
  // External formats share the .json extension with RPE charts, so let their
  // content detector claim only official JSON/PEC files before the ordinary
  // RPE/PEZ importer handles the selection.
  const external = await importExternalFiles(files, deps);
  if (external !== null) {
    return external;
  }
  const found = await localService();
  if (!found) {
    throw new Error(t("editor.app.error.libraryServiceDown"));
  }
  let cancelled = false;
  const projectIds = await new Promise<string[]>((resolve, reject) => {
    startLongTask({
      label: "workspace.welcome.import.title",
      detail: files.map((file) => file.name).join(", "),
      stage: t("workspace.welcome.importing", { name: files[0].name }),
      async run({ report, signal }) {
        let candidates: readonly OpenCandidate[] = [];
        try {
          report(t("workspace.welcome.importing", { name: files[0].name }), 0);
          const opened = await openFiles(
            files,
            undefined,
            parseChartEntriesOffThread,
            readZipOffThread,
            openChartDocumentFromBytes,
          );
          if (!opened) {
            resolve([]);
            return;
          }
          candidates = opened.candidates;
          const ids: string[] = [];
          for (const candidate of candidates) {
            throwIfAborted(signal);
            const name = chartTitle(candidate);
            const stage = t("workspace.welcome.importing", { name });
            report(stage, 0.2);
            const imported = await importChartToLibrary({
              library: found.library,
              chart: candidate.chart,
              name,
              assets: opened.assets,
              signal,
              onProgress: (value) => report(stage, importWriteProgress(value)),
            });
            ids.push(imported.projectId);
            report("", 1);
            showToast({
              message: t("workspace.welcome.drop.imported", { name: imported.name }),
              level: "success",
            });
          }
          void deps.refresh().catch(deps.reportError);
          resolve(ids);
        } catch (error) {
          if (signal.aborted) {
            cancelled = true;
            resolve([]);
          } else {
            reject(error);
          }
          throw error;
        } finally {
          disposeCandidates(candidates);
        }
      },
    });
  });
  if (cancelled || projectIds.length === 0) {
    return [];
  }
  return projectIds;
}
