/**
 * RPE folder migration for the welcome screen.
 *
 * A scan is confirmed once, then settings/hotkeys are applied and each chart
 * folder is opened through the same temporary document store used by a dropped
 * chart. Every chart failure is collected instead of aborting the rest.
 */
import { applyRpeMigrationPlan } from "../../../core/migration/apply.ts";
import { createRpeMigrationPlan, type RpeFolderScan } from "../../../core/migration/rpe.ts";
import { importChartToLibrary } from "../../../core/global/library/import.ts";
import { catalogIdFor, rememberCatalogPath } from "../../../core/global/library/libraryCatalog.ts";
import { localService } from "../../../core/global/library/service.ts";
import { TauriDocumentStore } from "../../../core/platform/desktop/documentStore.ts";
import { isDesktop } from "../../../core/platform/environment.ts";
import { startLongTask, finishLongTask } from "../../../core/state/longTasks.ts";
import { t } from "../../../i18n/index.ts";
import { showToast } from "../../../design/patterns/ToastHost.tsx";
import { showImportReport } from "../../overlays/modals/importReportPrompt.ts";
import { writeRpeHotkeyRecord } from "../settings/shortcuts/rpeHotkeyReport.ts";
import { openSettings } from "../settings/settingsWindowController.ts";
import { recordImportReport, type ImportIssue, type ImportReport } from "./importReport.ts";
import { requestConfirm } from "../../overlays/modals/prompts.ts";
import { chooseRpeFolder, scanRpeFolder } from "../../platform/desktop/rpeFolder.ts";

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
 * Import every chart in a confirmed scan and apply its settings sidecars.
 *
 * The scan runs as one retained background task, so its progress stays
 * reachable from the task list after the confirmation dialog is gone. The
 * summary stays a normal notice: it is the short answer an import produces, not
 * a job that can still be cancelled.
 */
export async function migrateRpeScan(
  scan: RpeFolderScan,
  deps: RpeImportDeps,
): Promise<RpeImportSummary> {
  const plan = createRpeMigrationPlan(scan.settingsText, scan.hotkeysText, scan.uiText);
  const applied = applyRpeMigrationPlan(plan);
  // Keep the hotkey mapping for the shortcut page: applied entries explain the
  // new bindings, and the rest explain why a familiar key is missing.
  writeRpeHotkeyRecord(plan.hotkeys.entries);
  // Batch-level differences (the folder's own sidecars) have no single chart to
  // attach to; per-chart failures are recorded beside their project instead.
  const batchIssues: ImportIssue[] = [
    ...scan.warnings.map((detail) => ({ scope: "", detail })),
    ...applied.warnings.map((detail) => ({ scope: "", detail })),
  ];
  const issues: ImportIssue[] = [...batchIssues];
  const total = scan.charts.length;
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
          for (const [index, chart] of scan.charts.entries()) {
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
            deps.reportError(error);
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
          const hotkeyAction = plan.hotkeys.entries.length
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
 * Scan one path and, when it is an RPE root, confirm and import it.
 *
 * Returns null when the path has no RPE sidecars or chart folders, which lets the
 * home screen fall back to the ordinary single-file import. An empty list means
 * the migration was declined or imported nothing; otherwise the ids name the
 * projects it wrote.
 */
export async function importRpePath(
  path: string,
  deps: RpeImportDeps,
): Promise<readonly string[] | null> {
  let scan: RpeFolderScan;
  try {
    scan = await scanRpeFolder(path);
  } catch {
    return null;
  }
  if (!scan.charts.length && !scan.settingsText && !scan.hotkeysText) {
    return null;
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
