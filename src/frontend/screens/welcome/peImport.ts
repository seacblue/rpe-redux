/**
 * PhiEditer installation import for the welcome screen.
 *
 * A dropped PhiEditer root is reviewed row by row: its Settings.txt preferences
 * become editable settings and its Settings.txt chart index becomes the chart
 * list. Each selected PEC chart is converted with the same external-format
 * converter as a standalone PEC file, then paired with the song and cover the
 * index names before the library import.
 */
import { applyRpeMigrationPlan } from "../../../core/migration/apply.ts";
import {
  filterRpeMigrationPlan,
  type RpeFolderScan,
  type RpeImportSelection,
  type RpeMigrationPlan,
} from "../../../core/migration/rpe.ts";
import {
  createPeMigrationPlan,
  peChartMediaNames,
  type PeChart,
  type PeFolderScan,
} from "../../../core/migration/pe.ts";
import { parseExternalChartText } from "../../../core/global/chart/formats/external.ts";
import type { AssetMap } from "../../../core/global/document/types.ts";
import { importChartToLibrary } from "../../../core/global/library/import.ts";
import { catalogIdFor, rememberCatalogPath } from "../../../core/global/library/libraryCatalog.ts";
import { localService } from "../../../core/global/library/service.ts";
import { isDesktop } from "../../../core/platform/environment.ts";
import { startLongTask, finishLongTask } from "../../../core/state/longTasks.ts";
import { t } from "../../../i18n/index.ts";
import { showToast } from "../../../design/patterns/ToastHost.tsx";
import { showImportReport } from "../../overlays/modals/importReportPrompt.ts";
import { showImportProgress } from "../../overlays/modals/importProgressPrompt.tsx";
import { recordImportReport, type ImportIssue, type ImportReport } from "./importReport.ts";
import { readPickedBytes } from "../../platform/desktop/externalChart.ts";
import { readPeFolder } from "../../platform/desktop/peFolder.ts";
import { requestRpeImportReview } from "./rpeImportReview.ts";
import type { RpeImportDeps } from "./rpeImport.ts";

/** Counts reported after one confirmed PhiEditer import. */
export interface PeImportSummary {
  readonly charts: number;
  readonly settings: number;
  readonly warnings: number;
  readonly projectIds: readonly string[];
}

/** Read one chart file as text through the native reader. */
async function readChartText(path: string): Promise<string> {
  const bytes = await readPickedBytes(path);
  return new TextDecoder("utf-8").decode(bytes);
}

/**
 * Build the review scan for one PhiEditer folder.
 *
 * The settings text is already converted into the plan, so the review shows the
 * same setting rows as an RPE migration without re-parsing the sidecar.
 */
function reviewScan(scan: PeFolderScan): RpeFolderScan {
  return {
    root: scan.root,
    installation: true,
    source: "phiediter",
    settingsText: null,
    hotkeysText: null,
    uiText: null,
    charts: scan.charts,
    warnings: scan.warnings,
  };
}

/** Import one converted chart with its media, and return its project id. */
async function importPeChart(
  chart: PeChart,
  group: string,
  assets: AssetMap,
): Promise<{ projectId: string; warnings: readonly string[] }> {
  const text = await readChartText(chart.path);
  const { song: songName, picture: pictureName } = peChartMediaNames(chart);
  const converted = parseExternalChartText(text, {
    name: chart.name,
    composer: chart.composer,
    charter: chart.charter,
    level: chart.group,
    song: songName,
    background: pictureName,
  });
  if (!converted) {
    throw new Error(`PhiEditer chart could not be converted: ${chart.chart || chart.folder}`);
  }
  // The converter keeps the metadata it was given; the asset names only become
  // references when the importer actually stages those bytes.
  converted.chart.META.song = songName && assets.has(songName) ? songName : "";
  converted.chart.META.background = pictureName && assets.has(pictureName) ? pictureName : "";
  const found = await localService();
  if (!found) {
    throw new Error(t("editor.app.error.libraryServiceDown"));
  }
  const existing = catalogIdFor(chart.path);
  const result = await importChartToLibrary({
    library: found.library,
    ...(existing ? { projectId: existing } : {}),
    chart: converted.chart,
    name: chart.name,
    group,
    assets,
  });
  return { projectId: result.projectId, warnings: converted.warnings };
}

/** Import the selected charts and apply the selected PhiEditer preferences. */
async function migratePeScan(
  scan: PeFolderScan,
  deps: RpeImportDeps,
  selection: RpeImportSelection,
  onTaskStart?: (taskId: string, total: number) => void,
): Promise<readonly string[]> {
  const plan: RpeMigrationPlan = createPeMigrationPlan(scan.settingsText);
  const approved = filterRpeMigrationPlan(plan, selection);
  const selected = new Set(selection.chartPaths);
  const charts = scan.charts.filter((chart) => selected.has(chart.path));
  const applied = applyRpeMigrationPlan(approved);
  const batchIssues: ImportIssue[] = [
    ...scan.warnings.map((detail) => ({ scope: "", detail })),
    ...applied.warnings.map((detail) => ({ scope: "", detail })),
  ];
  const issues: ImportIssue[] = [...batchIssues];
  const projectIds: string[] = [];
  let taskId = "";
  await new Promise<void>((resolve) => {
    taskId = startLongTask({
      label: "workspace.welcome.pe.title",
      stage: t("workspace.welcome.rpe.importing", { count: charts.length }),
      async run({ report }) {
        const chartReports: ImportReport[] = [];
        try {
          for (const [index, chart] of charts.entries()) {
            report(
              t("workspace.welcome.rpe.importingChart", { name: chart.name }),
              charts.length ? index / charts.length : null,
            );
            const assets = new Map<string, Uint8Array>();
            try {
              const { song: songName, picture: pictureName } = peChartMediaNames(chart);
              if (chart.songPath && songName) {
                assets.set(songName, await readPickedBytes(chart.songPath));
              }
              if (chart.picturePath && pictureName) {
                assets.set(pictureName, await readPickedBytes(chart.picturePath));
              }
              const imported = await importPeChart(chart, "PhiEditer", assets);
              projectIds.push(imported.projectId);
              rememberCatalogPath(chart.path, imported.projectId);
              if (imported.warnings.length) {
                const chartIssues: ImportIssue[] = imported.warnings.map((detail) => ({
                  scope: chart.name,
                  detail,
                }));
                const issueReport: ImportReport = {
                  projectId: imported.projectId,
                  title: chart.name,
                  source: t("workspace.welcome.pe.title"),
                  issues: chartIssues,
                };
                recordImportReport(issueReport);
                chartReports.push(issueReport);
                issues.push(...chartIssues);
              }
            } catch (error) {
              issues.push({
                scope: chart.name,
                detail: error instanceof Error ? error.message : String(error),
              });
            }
          }
          report("", charts.length ? 1 : null);
          try {
            await deps.refresh();
          } catch (error) {
            deps.reportError(error, { operation: "welcome.import.pe.refresh" });
          }
          const source = t("workspace.welcome.pe.title");
          const reportAction = issues.length
            ? [
                {
                  label: t("workspace.welcome.importReport.action"),
                  onSelect: () =>
                    showImportReport(source, [
                      ...chartReports,
                      ...(batchIssues.length
                        ? [
                            {
                              projectId: "__batch__",
                              title: source,
                              source,
                              issues: batchIssues,
                            },
                          ]
                        : []),
                    ]),
                },
              ]
            : [];
          showToast({
            message: t("workspace.welcome.rpe.done", {
              charts: projectIds.length,
              settings: applied.settings,
              shortcuts: 0,
              warnings: issues.length,
            }),
            level: issues.length ? "warning" : "success",
            ...(reportAction.length ? { actions: reportAction } : {}),
          });
        } finally {
          resolve();
        }
      },
    });
    // Expose the bar only after the task exists; a fast import settles it at once.
    onTaskStart?.(taskId, charts.length);
  });
  finishLongTask(taskId, { status: "completed" });
  return Object.freeze(projectIds);
}

/**
 * Read one dropped PhiEditer installation, review it, and import what was kept.
 *
 * A drop already carries the classification details; the folder picker reads
 * them on demand. Null means the path is not a usable PhiEditer root, while an
 * empty list means the review was declined or nothing was selected.
 */
export async function importPeFolder(
  path: string,
  deps: RpeImportDeps,
  details?: PeFolderScan,
): Promise<readonly string[] | null> {
  if (!isDesktop()) {
    showToast({ message: t("workspace.welcome.pe.desktopOnly"), level: "warning" });
    return null;
  }
  let scan: PeFolderScan;
  if (details) {
    scan = details;
  } else {
    try {
      scan = await readPeFolder(path);
    } catch {
      return null;
    }
  }
  if (!scan.installation && !scan.charts.length) {
    return null;
  }
  const plan = createPeMigrationPlan(scan.settingsText);
  const selection = await requestRpeImportReview(reviewScan(scan), plan);
  if (!selection) {
    return [];
  }
  const selected = new Set(selection.chartPaths);
  const total = scan.charts.reduce(
    (count, chart) => (selected.has(chart.path) ? count + 1 : count),
    0,
  );
  return migratePeScan(scan, deps, selection, (taskId) => showImportProgress(taskId, total));
}
