/**
 * Home-screen runtime for opening projects and importing files.
 *
 * A file import writes the chart and its resources to SQLite without opening
 * the resulting library document. Explicit open actions own document loading;
 * a project with no assets can still find its source file and repair resources.
 */
import { localService } from "../../../core/global/library/service.ts";
import { t } from "../../../i18n/index.ts";
import { showToast } from "../../../design/patterns/ToastHost.tsx";
import { beginLoading, loadingProgress } from "../../../core/global/document/loading.ts";
import { TauriDocumentStore } from "../../../core/platform/desktop/documentStore.ts";
import type { LibraryProjectSummary } from "../../../core/global/library/client.ts";
import type { DropClassification } from "../../../core/global/document/dropIntake.ts";
import type { LoadTask } from "../../../core/global/document/loading.ts";
import { ProjectHome } from "./projectLibrary.ts";
import {
  confirmExportWarnings,
  showExportDialog,
} from "../editor/workspace/document/export/exportPrompt.ts";
import { openSettings } from "../settings/settingsWindowController.ts";
import type { AssetMap, EditorCandidate } from "../../../core/global/document/types.ts";
import type { LibraryProjectRef } from "../../../core/global/library/types.ts";
import type { Chart } from "../../../core/global/chart/chart.ts";
import { libraryDocumentCandidate } from "../editor/workspace/document/open/libraryCandidate.ts";
import {
  catalogIdFor,
  catalogPathFor,
  rememberCatalogPath,
} from "../../../core/global/library/libraryCatalog.ts";
import {
  materializeAssets,
  openLibraryChartDocument,
  openLibraryProject,
} from "../../../core/global/library/document.ts";
import { importChartToLibrary } from "../../../core/global/library/import.ts";
import { shouldRepairLibraryAssetsFromNativeRpe } from "./libraryAssetRepair.ts";
import { startLongTask, finishLongTask } from "../../../core/state/longTasks.ts";
import {
  chartExportWarnings,
  createChartExport,
  createChartTextExport,
} from "../../../core/global/document/export.ts";
import { download } from "../../platform/download.ts";
import {
  chooseRpeImport as chooseRpeFolderMigration,
  importRpePath,
  type RpeImportDeps,
} from "./rpeImport.ts";
import { choosePeImport as choosePeFolderMigration, importPeFolder } from "./peImport.ts";
import {
  chooseExternalImport as chooseExternalChartImport,
  importExternalPath,
  type ExternalImportDeps,
} from "./externalImport.ts";
import { importLoadProgress, importWriteProgress, throwIfAborted } from "./importProgress.ts";

/** Error raised when the local library service is unavailable. */
function libraryMissing(): Error {
  return new Error(t("editor.app.error.libraryServiceDown"));
}

/** Builds the PEZ export file name, replacing path-hostile characters. */
function exportFileName(name: string): string {
  const trimmed = name.trim() || "chart";
  return `${trimmed.replace(/[\\/:*?"<>|]/g, "_")}.pez`;
}

/** The chart's own title, falling back to the container's file name. */
function chartTitle(chart: unknown, fallback: string): string {
  if (chart && typeof chart === "object") {
    const meta = (chart as { META?: { name?: unknown } }).META;
    if (meta && typeof meta.name === "string" && meta.name.trim()) {
      return meta.name.trim();
    }
  }
  return fallback;
}

/** The last segment of a Windows or POSIX path, for a drop label. */
function pathLabel(value: string): string {
  return value.split(/[\\/]/).filter(Boolean).at(-1) ?? value;
}

/** The display name a classified package should show. */
function dropName(item: DropClassification): string {
  return item.name?.trim() || item.packageId?.trim() || pathLabel(item.path);
}

/**
 * Tell the user which package was detected and offer the owning settings page.
 *
 * The classifier only routes; installation and validation stay on the page so
 * a dropped package cannot bypass the existing consent or package checks.
 */
function offerPackageSettings(item: DropClassification, kind: "extension" | "skin"): void {
  const name = dropName(item);
  if (!item.valid) {
    showToast({
      message: t("workspace.welcome.drop.invalidPackage", { name }),
      level: "warning",
    });
    return;
  }
  showToast({
    message: t(
      kind === "extension"
        ? "workspace.welcome.drop.extensionDetected"
        : "workspace.welcome.drop.skinDetected",
      { name },
    ),
    level: "info",
    actions: [
      {
        label: t("workspace.welcome.drop.openSettings"),
        onSelect: () => openSettings(kind === "extension" ? "extensions" : "appearance.skin"),
      },
    ],
  });
}

/** Connects the home view's open and rename actions to the live editor session. */
export function createEditorHomeRuntime(deps: {
  documents: TauriDocumentStore | null;
  guardReplace(action: () => unknown): Promise<boolean>;
  loadCandidate(candidate: EditorCandidate, assets: AssetMap, task?: LoadTask): Promise<void>;
  reportError(error: unknown): void;
  getLibraryProject(): LibraryProjectRef | null;
  setLibraryProject(project: LibraryProjectRef | null): void;
}): ProjectHome {
  let latestOpenRequest = 0;

  /** Opens a library project and keeps feedback visible across the initial read. */
  const openLibraryProjectById = async (id: string): Promise<void> => {
    const requestId = ++latestOpenRequest;
    const task = beginLoading(id);
    try {
      const found = await localService();
      if (!found) {
        throw libraryMissing();
      }
      const opened = await openLibraryChartDocument(found.library, id);
      if (requestId !== latestOpenRequest) {
        opened.chartDocument.dispose?.();
        return;
      }
      if (!opened.project) {
        throw new Error(t("editor.app.error.projectMissing"));
      }
      await installOpenedProject(id, opened, task);
      if (loadingProgress.getSnapshot()?.id === task.id) {
        loadingProgress.dismiss();
      }
    } catch (error) {
      if (requestId !== latestOpenRequest) {
        return;
      }
      task.fail(error);
      throw error;
    }
  };

  /** Loads one already-read library project into the editor. */
  const installOpenedProject = async (
    id: string,
    opened: Awaited<ReturnType<typeof openLibraryChartDocument>>,
    task?: LoadTask,
  ): Promise<boolean> => {
    const candidate = libraryDocumentCandidate(opened.project, id, opened.chartDocument);
    if ([...(opened.assets.names?.() ?? [])].length === 0) {
      try {
        await repairAssets(id, { chart: candidate.chart, name: candidate.name });
      } catch (error) {
        // A missing source file must not make a chart with no resources
        // unopenable; the editor can still add assets later.
        console.warn("Unable to migrate library assets", error);
      }
    }
    await deps.documents?.close();
    await deps.loadCandidate(candidate, opened.assets, task);
    const current = loadingProgress.getSnapshot();
    if (task && current?.id === task.id && current.status === "loading") {
      task.complete();
    }
    return true;
  };

  /** Asks for the export container, then writes the library project. */
  const exportProject = async (id: string): Promise<void> => {
    const found = await localService();
    if (!found) {
      throw libraryMissing();
    }
    const opened = await openLibraryProject(found.library, id);
    const background = opened.project.background
      ? found.library.assetUrl(id, opened.project.background)
      : undefined;
    showExportDialog(
      opened.project.chart as Chart,
      opened.assets,
      opened.project.name,
      (name) => {
        showToast({
          message: t("editor.app.status.exported", { name }),
          level: "success",
          ...(background ? { media: { kind: "image" as const, src: background } } : {}),
        });
      },
      async ({ name, format }) => {
        const chart = opened.project.chart as Chart;
        if (format !== "pez") {
          const result = createChartTextExport(chart, opened.project.name, format, { name });
          if (!(await confirmExportWarnings(format, result.warningDetails))) {
            return null;
          }
          if (!deps.documents) {
            download(new Blob([result.text], { type: result.mime }), result.name);
            return result.name;
          }
          const exporter = new TauriDocumentStore();
          try {
            return await exporter.exportText(result.text, {
              name: result.name,
              extension: format === "official" ? "json" : "pec",
              filter: t(
                format === "official"
                  ? "system.document.officialFilter"
                  : "system.document.pecFilter",
              ),
            });
          } finally {
            await exporter.close();
          }
        }
        const assets = await materializeAssets(opened.assets);
        if (!deps.documents) {
          const result = createChartExport(chart, assets, opened.project.name, {
            name: exportFileName(name),
          });
          if (!(await confirmExportWarnings("pez", result.warnings))) {
            return null;
          }
          download(result.blob, result.name);
          return result.name;
        }
        if (
          !(await confirmExportWarnings(
            "pez",
            chartExportWarnings(chart, opened.project.name, "pez"),
          ))
        ) {
          return null;
        }
        const exporter = new TauriDocumentStore();
        try {
          const result = await exporter.export(chart, assets, {
            format: "pez",
            name: exportFileName(name),
          });
          return result?.path ?? null;
        } finally {
          await exporter.close();
        }
      },
    );
  };

  /**
   * Repairs assets for a project whose manifest is empty but whose source path is
   * remembered: read that file once, keep the current chart, and store its
   * resources.
   */
  const repairAssets = async (
    id: string,
    project: { chart: unknown; name: string },
  ): Promise<void> => {
    const path = catalogPathFor(id);
    const documents = deps.documents;
    if (!path || !documents) {
      return;
    }
    const found = await localService();
    if (!found) {
      return;
    }
    // Asset repair is only valid for an RPE JSON source. PE/PEC and official
    // charts have already been converted during import; reopening their source
    // through the native loader would surface the misleading "RPE JSON not
    // found" modal while the library project itself is perfectly usable.
    let item: DropClassification | undefined;
    try {
      const sourcePath = path.split("#", 1)[0];
      item = (await found.library.classifyDropped([sourcePath])).items[0];
    } catch {
      return;
    }
    if (!shouldRepairLibraryAssetsFromNativeRpe(item)) {
      return;
    }
    const opened = await documents.open(path);
    try {
      await importChartToLibrary({
        library: found.library,
        projectId: id,
        chart: project.chart,
        name: project.name,
        assets: opened.assets,
        onProgress: (value) => opened.task.update("read", Math.round(value * 100), 100),
      });
    } finally {
      await documents.close();
    }
  };

  /**
   * Reads one dropped chart and writes it to the library without opening it.
   *
   * A throwaway native store keeps the hidden editor document untouched when
   * the home screen is shown over an open chart.
   */
  const importFile = async (path: string): Promise<string | null> => {
    if (!deps.documents) {
      throw new Error(t("editor.app.notice.desktopOnlyOpenFile"));
    }
    const name = pathLabel(path);
    let taskId = "";
    let cancelled = false;
    const projectId = await new Promise<string | null>((resolve, reject) => {
      taskId = startLongTask({
        label: "workspace.welcome.import.title",
        detail: name,
        stage: t("workspace.welcome.importing", { name }),
        async run({ report, signal }) {
          const loader = new TauriDocumentStore();
          try {
            const opened = await loader.openForImport(
              path,
              (loadStage, completed, total) =>
                report(
                  t("workspace.welcome.importing", { name }),
                  importLoadProgress(loadStage, completed, total),
                ),
              signal,
            );
            throwIfAborted(signal);
            const found = await localService();
            if (!found) {
              throw libraryMissing();
            }
            throwIfAborted(signal);
            const existing = catalogIdFor(path);
            const imported = await importChartToLibrary({
              library: found.library,
              ...(existing ? { projectId: existing } : {}),
              chart: opened.candidate.chart,
              name: chartTitle(opened.candidate.chart, opened.candidate.name),
              assets: opened.assets,
              signal,
              onProgress: (value) =>
                report(t("workspace.welcome.importing", { name }), importWriteProgress(value)),
            });
            rememberCatalogPath(path, imported.projectId);
            report("", 1);
            try {
              void refreshHome().catch((error) => deps.reportError(error));
            } catch (error) {
              deps.reportError(error);
            }
            showToast({
              message: t("workspace.welcome.drop.imported", { name: imported.name }),
              level: "success",
            });
            resolve(imported.projectId);
          } catch (error) {
            if (signal.aborted) {
              cancelled = true;
              resolve(null);
            } else {
              reject(error);
            }
            throw error;
          } finally {
            await loader.close().catch(() => undefined);
          }
        },
      });
    });
    if (cancelled || projectId === null) {
      return null;
    }
    finishLongTask(taskId, { status: "completed" });
    return projectId;
  };

  /**
   * Opens one library project into the editor.
   *
   * The caller has already made the unsaved-changes decision, so this does the
   * work itself instead of going back through `guardReplace` and asking twice.
   * Used by the drop flow after the save prompt.
   */
  const openImported = async (id: string): Promise<void> => {
    await openLibraryProjectById(id);
  };

  let projectHome: ProjectHome | null = null;
  const refreshHome = () => projectHome?.refresh() ?? Promise.resolve();
  const rpeDeps: RpeImportDeps = {
    documents: deps.documents,
    reportError: deps.reportError,
    refresh: refreshHome,
  };
  const externalDeps: ExternalImportDeps = {
    reportError: deps.reportError,
    refresh: refreshHome,
  };
  /**
   * Convert one external chart package path and open the project it imported.
   *
   * Returns false when the path is not a supported external format so the
   * native open path keeps owning RPE documents. The caller has already handled
   * the unsaved-changes decision for the open that led here.
   */
  const openExternalChartFile = async (path: string): Promise<boolean> => {
    const projectId = await importExternalPath(path, externalDeps);
    if (!projectId) {
      return false;
    }
    await openImported(projectId);
    return true;
  };
  /** Ask the local service which owner a drop belongs to. */
  const classifyPaths = async (
    paths: readonly string[],
  ): Promise<readonly DropClassification[]> => {
    const found = await localService();
    if (!found) {
      throw libraryMissing();
    }
    const result = await found.library.classifyDropped(paths);
    return result.items;
  };
  const home = new ProjectHome({
    importRpePath: (path) => importRpePath(path, rpeDeps),
    importRpeInstallation: (path, details) => importRpePath(path, rpeDeps, details),
    importPeInstallation: (path, details) => importPeFolder(path, rpeDeps, details),
    importExternalPath: (path) => importExternalPath(path, externalDeps),
    classifyPaths,
    importExtension: async (item) => offerPackageSettings(item, "extension"),
    importSkin: async (item) => offerPackageSettings(item, "skin"),
    unsupportedDrop: (item) => {
      showToast({
        message: t("workspace.welcome.drop.unsupported", { name: dropName(item) }),
        level: "warning",
      });
    },
    importExternalChart: openExternalChartFile,
    chooseRpeImport: () => chooseRpeFolderMigration(rpeDeps),
    choosePeImport: () => choosePeFolderMigration(rpeDeps),
    chooseExternalImport: () => chooseExternalChartImport(externalDeps),
    openProject: async (id) => {
      return deps.guardReplace(() => openLibraryProjectById(id));
    },
    openImported,
    importFile,
    exportProject,
    reportError: deps.reportError,
    changed: (project: LibraryProjectSummary) => {
      const current = deps.getLibraryProject();
      if (current?.id === project.id) {
        deps.setLibraryProject({ ...current, ...project });
      }
    },
  });
  projectHome = home;
  return home;
}
