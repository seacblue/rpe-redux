/**
 * RPE folder migration for the welcome screen.
 *
 * A native installation is reviewed row by row; other scans keep the single
 * summary confirmation. The approved settings/hotkeys are applied and each
 * selected chart folder is opened through the same temporary document store
 * used by a dropped chart. Every chart failure is collected instead of aborting
 * the rest.
 */
import { applyRpeMigrationPlan } from "../../../core/migration/apply.ts";
import {
  createRpeMigrationPlan,
  filterRpeMigrationPlan,
  type RpeFolderScan,
  type RpeImportSelection,
} from "../../../core/migration/rpe.ts";
import { importChartToLibrary } from "../../../core/global/library/import.ts";
import { catalogIdFor, rememberCatalogPath } from "../../../core/global/library/libraryCatalog.ts";
import { localService } from "../../../core/global/library/service.ts";
import { TauriDocumentStore } from "../../../core/platform/desktop/documentStore.ts";
import { isDesktop } from "../../../core/platform/environment.ts";
import { startLongTask } from "../../../core/state/longTasks.ts";
import { t } from "../../../i18n/index.ts";
import { showToast } from "../../../design/patterns/ToastHost.tsx";
import { showImportReport } from "../../overlays/modals/importReportPrompt.ts";
import { type ImportIssue, type ImportReport } from "./importReport.ts";
import { requestConfirm } from "../../overlays/modals/prompts.ts";
import { requestRpeImportReview } from "./rpeImportReview.ts";
import { chooseRpeFolder, readRpeFolder } from "../../platform/desktop/rpeFolder.ts";
import { importLoadProgress, importWriteProgress, throwIfAborted } from "./importProgress.ts";
import { ImportTaskScheduler } from "./importTaskScheduler.ts";

/** Host callbacks the migration needs from the mounted editor. */
export interface RpeImportDeps {
  readonly documents: TauriDocumentStore | null;
  reportError(error: unknown): void;
  refresh(): Promise<void>;
}

/** Counts reported after one confirmed migration. */
export interface RpeImportSummary {
  readonly charts: number;
  readonly settings: number;
  readonly shortcuts: number;
  readonly warnings: number;
  /** Library projects created or updated by this migration, in chart order. */
  readonly projectIds: readonly string[];
}

/** Human-readable confirmation summary for a scan. */
function summaryText(scan: RpeFolderScan): string {
  const parts: string[] = [];
  if (scan.charts.length) {
    parts.push(t("workspace.welcome.rpe.chartCount", { count: scan.charts.length }));
  }
  if (scan.settingsText) {
    parts.push(t("workspace.welcome.rpe.settingsFound"));
  }
  if (scan.hotkeysText) {
    parts.push(t("workspace.welcome.rpe.hotkeysFound"));
  }
  return parts.join(", ");
}

/**
 * Import the selected charts and apply the selected settings sidecars.
 *
 * Without a selection the whole scan is applied, which keeps the smaller
 * single-folder confirmation working. Each selected chart gets its own
 * retained background task, so one completed chart can settle independently
 * while the next chart continues. The summary stays a normal notice: it is the
 * short answer an import produces, not a job that can still be cancelled.
 */
export async function migrateRpeScan(
  scan: RpeFolderScan,
  deps: RpeImportDeps,
  selection?: RpeImportSelection,
): Promise<RpeImportSummary> {
  const plan = createRpeMigrationPlan(
    scan.settingsText,
    scan.hotkeysText,
    scan.uiText,
    scan.divisionColorText,
  );
  const approved = selection ? filterRpeMigrationPlan(plan, selection) : plan;
  const selectedCharts = selection ? new Set(selection.chartPaths) : null;
  const charts = selectedCharts
    ? scan.charts.filter((chart) => selectedCharts.has(chart.path))
    : scan.charts;
  const applied = applyRpeMigrationPlan(approved);
  // Batch-level differences (the folder's own sidecars) have no single chart to
  // attach to; per-chart failures are recorded beside their project instead.
  const batchIssues: ImportIssue[] = [
    ...scan.warnings.map((detail) => ({ scope: "", detail })),
    ...applied.warnings.map((detail) => ({ scope: "", detail })),
  ];
  const issues: ImportIssue[] = [...batchIssues];
  const documents = deps.documents;
  if (!documents) {
    showToast({ message: t("workspace.welcome.rpe.desktopOnly"), level: "warning" });
    return Object.freeze({
      charts: 0,
      settings: applied.settings,
      shortcuts: applied.shortcuts,
      warnings: issues.length + 1,
      projectIds: [],
    });
  }
  const chartReports: ImportReport[] = [];
  const projectIds = new Array<string | undefined>(charts.length);
  const scheduler = new ImportTaskScheduler(charts.map((chart) => chart.estimatedBytes));
  const taskRuns = charts.map(
    (chart, index) =>
      new Promise<void>((resolve) => {
        try {
          startLongTask({
            label: "workspace.welcome.import.chartTask",
            detail: chart.name,
            stage: t("workspace.welcome.rpe.importingChart", { name: chart.name }),
            async run({ report, signal }) {
              const stage = t("workspace.welcome.rpe.importingChart", { name: chart.name });
              const loader = new TauriDocumentStore();
              try {
                report(stage, 0);
                await scheduler.acquire(index, signal);
                report(stage, 0);
                const opened = await loader.openForImport(
                  chart.path,
                  (loadStage, completed, total) =>
                    report(stage, importLoadProgress(loadStage, completed, total)),
                  signal,
                );
                throwIfAborted(signal);
                const found = await localService();
                if (!found) {
                  throw new Error(t("editor.app.error.libraryServiceDown"));
                }
                throwIfAborted(signal);
                const existing = catalogIdFor(chart.path);
                const result = await importChartToLibrary({
                  library: found.library,
                  ...(existing ? { projectId: existing } : {}),
                  chart: opened.candidate.chart,
                  name: chart.name || opened.candidate.name,
                  group: chart.group,
                  assets: opened.assets,
                  signal,
                  onProgress: (value) => report(stage, importWriteProgress(value)),
                });
                rememberCatalogPath(chart.path, result.projectId);
                projectIds[index] = result.projectId;
                report("", 1);
                try {
                  void deps.refresh().catch((error) => deps.reportError(error));
                } catch (error) {
                  deps.reportError(error);
                }
              } catch (error) {
                if (!signal.aborted) {
                  issues.push({
                    scope: chart.name,
                    detail: error instanceof Error ? error.message : String(error),
                  });
                }
                throw error;
              } finally {
                await loader.close().catch(() => undefined);
                scheduler.release(index);
                resolve();
              }
            },
          });
        } catch (error) {
          issues.push({
            scope: chart.name,
            detail: error instanceof Error ? error.message : String(error),
          });
          resolve();
        }
      }),
  );
  await Promise.all(taskRuns);
  const importedProjectIds = projectIds.filter((id): id is string => id !== undefined);
  const summary: RpeImportSummary = Object.freeze({
    charts: importedProjectIds.length,
    settings: applied.settings,
    shortcuts: applied.shortcuts,
    warnings: issues.length,
    projectIds: importedProjectIds,
  });
  const source = t("workspace.welcome.rpe.title");
  const reportAction =
    chartReports.length || batchIssues.length
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
      charts: summary.charts,
      settings: summary.settings,
      shortcuts: summary.shortcuts,
      warnings: summary.warnings,
    }),
    level: summary.warnings ? "warning" : "success",
    ...(reportAction.length ? { actions: reportAction } : {}),
  });
  return summary;
}

/**
 * Read one path and, when it is an RPE root, confirm and import it.
 *
 * A native installation (PhiEdit.exe plus Resources) opens the row-by-row
 * review so settings and charts can be selected independently. A drop already
 * carries the classification details; the folder picker reads them on demand.
 * Other RPE chart folders keep the smaller summary confirmation. Returns null
 * when the path has no RPE sidecars or chart folders, which lets the home screen
 * fall back to the ordinary single-file import. An empty list means the
 * migration was declined or imported nothing; otherwise the ids name the
 * projects it wrote.
 */
export async function importRpePath(
  path: string,
  deps: RpeImportDeps,
  details?: RpeFolderScan,
): Promise<readonly string[] | null> {
  let scan: RpeFolderScan;
  if (details) {
    scan = details;
  } else {
    try {
      scan = await readRpeFolder(path);
    } catch {
      return null;
    }
  }
  if (!scan.charts.length && !scan.settingsText && !scan.hotkeysText && !scan.uiText) {
    return null;
  }
  if (scan.installation) {
    const plan = createRpeMigrationPlan(
      scan.settingsText,
      scan.hotkeysText,
      scan.uiText,
      scan.divisionColorText,
    );
    const selection = await requestRpeImportReview(scan, plan);
    if (!selection) {
      return [];
    }
    const summary = await migrateRpeScan(scan, deps, selection);
    return summary.projectIds;
  }
  const confirmed = await requestConfirm({
    title: t("workspace.welcome.rpe.confirmTitle"),
    description: t("workspace.welcome.rpe.confirmDescription", { summary: summaryText(scan) }),
    label: t("workspace.welcome.rpe.confirm"),
    cancelLabel: t("common.action.cancel"),
  });
  if (!confirmed) {
    return [];
  }
  const summary = await migrateRpeScan(scan, deps);
  return summary.projectIds;
}

/** Ask for an RPE root and migrate it; false when the dialog or scan is cancelled. */
export async function chooseRpeImport(deps: RpeImportDeps): Promise<boolean> {
  if (!isDesktop()) {
    showToast({ message: t("workspace.welcome.rpe.desktopOnly"), level: "warning" });
    return false;
  }
  const path = await chooseRpeFolder();
  if (!path) {
    return false;
  }
  const ids = await importRpePath(path, deps);
  if (ids === null) {
    showToast({ message: t("workspace.welcome.rpe.notFound"), level: "warning" });
    return false;
  }
  return ids.length > 0;
}
