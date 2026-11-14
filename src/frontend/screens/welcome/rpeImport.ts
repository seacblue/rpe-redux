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
import type { FailureContext } from "../../../core/contracts/failure.ts";
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
import { startLongTask, finishLongTask } from "../../../core/state/longTasks.ts";
import { t } from "../../../i18n/index.ts";
import { showToast } from "../../../design/patterns/ToastHost.tsx";
import { showImportReport } from "../../overlays/modals/importReportPrompt.ts";
import { writeRpeHotkeyRecord } from "../settings/shortcuts/rpeHotkeyReport.ts";
import { openSettings } from "../settings/settingsWindowController.ts";
import { recordImportReport, type ImportIssue, type ImportReport } from "./importReport.ts";
import { requestConfirm } from "../../overlays/modals/prompts.ts";
import { requestRpeImportReview } from "./rpeImportReview.ts";
import { readRpeFolder } from "../../platform/desktop/rpeFolder.ts";

/** Host callbacks the migration needs from the mounted editor. */
export interface RpeImportDeps {
  readonly documents: TauriDocumentStore | null;
  reportError(error: unknown, context?: FailureContext): void;
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
 * single-folder confirmation working. The scan runs as one retained background
 * task, so its progress stays reachable from the task list after the review is
 * gone. The summary stays a normal notice: it is the short answer an import
 * produces, not a job that can still be cancelled.
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
  // Keep the hotkey mapping for the shortcut page: applied entries explain the
  // new bindings, and the rest explain why a familiar key is missing. Skipped
  // shortcuts leave the previous record alone.
  if (!selection || selection.applyShortcuts) {
    writeRpeHotkeyRecord(approved.hotkeys.entries);
  }
  // Batch-level differences (the folder's own sidecars) have no single chart to
  // attach to; per-chart failures are recorded beside their project instead.
  const batchIssues: ImportIssue[] = [
    ...scan.warnings.map((detail) => ({ scope: "", detail })),
    ...applied.warnings.map((detail) => ({ scope: "", detail })),
  ];
  const issues: ImportIssue[] = [...batchIssues];
  const total = charts.length;
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
  let summary: RpeImportSummary = Object.freeze({
    charts: 0,
    settings: applied.settings,
    shortcuts: applied.shortcuts,
    warnings: issues.length,
    projectIds: [],
  });
  // One task id is reserved before work starts and settled from the run's own
  // outcome, so a failure still leaves a finished row in the list.
  let taskId = "";
  let failed = false;
  await new Promise<void>((resolve) => {
    taskId = startLongTask({
      label: "workspace.welcome.rpe.title",
      stage: t("workspace.welcome.rpe.importing", { count: total }),
      async run({ report }) {
        let imported = 0;
        // Per-chart issues become that project's compatibility report; the
        // aggregate list feeds the notice's single "view" action.
        const chartReports: ImportReport[] = [];
        const projectIds: string[] = [];
        try {
          for (const [index, chart] of charts.entries()) {
            report(
              t("workspace.welcome.rpe.importingChart", { name: chart.name }),
              total ? index / total : null,
            );
            const loader = new TauriDocumentStore();
            const chartIssues: ImportIssue[] = [];
            let loadTask: { complete(): void; fail(error: unknown): void } | null = null;
            try {
              const opened = await loader.open(chart.path);
              loadTask = opened.task;
              const found = await localService();
              if (!found) {
                throw new Error(t("editor.app.error.libraryServiceDown"));
              }
              const existing = catalogIdFor(chart.path);
              const result = await importChartToLibrary({
                library: found.library,
                ...(existing ? { projectId: existing } : {}),
                chart: opened.candidate.chart,
                name: chart.name || opened.candidate.name,
                group: chart.group,
                assets: opened.assets,
                onProgress: (value) => opened.task.update("read", Math.round(value * 100), 100),
              });
              rememberCatalogPath(chart.path, result.projectId);
              loadTask.complete();
              imported += 1;
              projectIds.push(result.projectId);
              if (chartIssues.length) {
                const report: ImportReport = {
                  projectId: result.projectId,
                  title: chart.name || opened.candidate.name,
                  source: t("workspace.welcome.rpe.title"),
                  issues: [...chartIssues],
                };
                recordImportReport(report);
                chartReports.push(report);
                issues.push(...chartIssues);
              }
            } catch (error) {
              loadTask?.fail(error);
              const issue: ImportIssue = {
                scope: chart.name,
                detail: error instanceof Error ? error.message : String(error),
              };
              chartIssues.push(issue);
              issues.push(issue);
            } finally {
              await loader.close().catch(() => undefined);
            }
          }
          report("", total ? 1 : null);
          try {
            await deps.refresh();
          } catch (error) {
            deps.reportError(error, { operation: "welcome.import.rpe.refresh" });
          }
          summary = Object.freeze({
            charts: imported,
            settings: applied.settings,
            shortcuts: applied.shortcuts,
            warnings: issues.length,
            projectIds: [...projectIds],
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
          const hotkeyAction = approved.hotkeys.entries.length
            ? [
                {
                  label: t("workspace.welcome.rpe.viewHotkeys"),
                  onSelect: () => openSettings("shortcuts"),
                },
              ]
            : [];
          const actions = [...reportAction, ...hotkeyAction];
          showToast({
            message: t("workspace.welcome.rpe.done", {
              charts: summary.charts,
              settings: summary.settings,
              shortcuts: summary.shortcuts,
              warnings: summary.warnings,
            }),
            level: summary.warnings ? "warning" : "success",
            ...(actions.length ? { actions } : {}),
          });
        } catch (error) {
          // A chart-level failure is collected above; anything that escapes is
          // the scan itself failing, and the row must say so instead of ending
          // as a completed job.
          failed = true;
          summary = Object.freeze({
            charts: imported,
            settings: applied.settings,
            shortcuts: applied.shortcuts,
            warnings: issues.length + 1,
            projectIds: [],
          });
          throw error instanceof Error ? error : new Error(String(error));
        } finally {
          resolve();
        }
      },
    });
  });
  if (!failed) {
    finishLongTask(taskId, { status: "completed" });
  }
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
