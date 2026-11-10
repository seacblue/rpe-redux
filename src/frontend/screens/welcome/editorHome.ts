/**
 * Home-screen runtime for opening projects and importing files.
 *
 * A file import writes the chart and its resources to SQLite, then opens the
 * resulting library document. A project with no assets can still find the file
 * it was mirrored from once and repair its resource store.
 */
import { localService } from "../../../core/global/library/service.ts";
import { t } from "../../../i18n/index.ts";
import { showToast } from "../../../design/patterns/ToastHost.tsx";
import { loadingProgress } from "../../../core/global/document/loading.ts";
import { TauriDocumentStore } from "../../../core/platform/desktop/documentStore.ts";
import type { LibraryProjectSummary } from "../../../core/global/library/client.ts";
import type { DropClassification } from "../../../core/global/document/dropIntake.ts";
import type { LoadTask } from "../../../core/global/document/loading.ts";
import { ProjectHome } from "./projectLibrary.ts";
import { showExportDialog } from "../editor/workspace/document/export/exportPrompt.ts";
import { openSettings } from "../settings/settingsWindowController.ts";
import type { AssetMap, EditorCandidate } from "../../../core/global/document/types.ts";
import type { LibraryProjectRef } from "../../../core/global/library/types.ts";
import type { Chart } from "../../../core/global/chart/chart.ts";
import {
  libraryCandidate,
  libraryDocumentCandidate,
} from "../editor/workspace/document/open/libraryCandidate.ts";
import {
  catalogIdFor,
  catalogPathFor,
  rememberCatalogPath,
} from "../../../core/global/library/libraryCatalog.ts";
import {
  materializeAssets,
  openLibraryProject,
  openLibraryChartDocument,
} from "../../../core/global/library/document.ts";
import { importChartToLibrary } from "../../../core/global/library/import.ts";
import { createChartExport, createChartTextExport } from "../../../core/global/document/export.ts";
import { download } from "../../platform/download.ts";
import {
  chooseRpeImport as chooseRpeFolderMigration,
  importRpePath,
  type RpeImportDeps,
} from "./rpeImport.ts";
import {
  chooseExternalImport as chooseExternalChartImport,
  importExternalPath,
  type ExternalImportDeps,
} from "./externalImport.ts";

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
  guardReplace(action: () => unknown): unknown;
  loadCandidate(candidate: EditorCandidate, assets: AssetMap, task?: LoadTask): Promise<void>;
  reportError(error: unknown): void;
  getLibraryProject(): LibraryProjectRef | null;
  setLibraryProject(project: LibraryProjectRef | null): void;
}): ProjectHome {
  /** Opens a library project by id into the editor. */
  const openLibrary = async (id: string): Promise<void> => {
    const found = await localService();
    if (!found) {
      throw libraryMissing();
    }
    try {
      const opened = await openLibraryChartDocument(found.library, id);
      await deps.loadCandidate(
        libraryDocumentCandidate(opened.project, id, opened.chartDocument),
        opened.assets,
      );
      return;
    } catch {
      // Older services or malformed streams use the whole-project fallback.
    }
    const opened = await openLibraryProject(found.library, id);
    await deps.loadCandidate(libraryCandidate(opened.project, id), opened.assets);
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
          if (result.warnings.length) {
            showToast({
              message: t("editor.dialogs.exportDialog.warnings", {
                count: result.warnings.length,
              }),
              level: "warning",
            });
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
          download(result.blob, result.name);
          return result.name;
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
    const loader = new TauriDocumentStore();
    let task: { complete(): void; fail(error: unknown): void } | null = null;
    try {
      const opened = await loader.open(path);
      task = opened.task;
      const found = await localService();
      if (!found) {
        throw libraryMissing();
      }
      const existing = catalogIdFor(path);
      const imported = await importChartToLibrary({
        library: found.library,
        ...(existing ? { projectId: existing } : {}),
        chart: opened.candidate.chart,
        name: chartTitle(opened.candidate.chart, opened.candidate.name),
        assets: opened.assets,
        onProgress: (value) => opened.task.update("read", Math.round(value * 100), 100),
      });
      rememberCatalogPath(path, imported.projectId);
      task.complete();
      showToast({
        message: t("workspace.welcome.drop.imported", { name: imported.name }),
        level: "success",
      });
      return imported.projectId;
    } catch (error) {
      task?.fail(error);
      loadingProgress.dismiss();
      throw error;
    } finally {
      await loader.close().catch(() => undefined);
    }
  };

  /**
   * Opens one library project into the editor.
   *
   * The caller has already made the unsaved-changes decision, so this does the
   * work itself instead of going back through `guardReplace` and asking twice.
   * Used by the drop flow after the save prompt.
   */
  const openImported = async (id: string): Promise<void> => {
    const found = await localService();
    if (!found) {
      throw libraryMissing();
    }
    const opened = await openLibraryProject(found.library, id);
    if (!opened.project) {
      throw new Error(t("editor.app.error.projectMissing"));
    }
    await installOpenedProject(id, opened);
  };

  /** Repairs missing assets, closes the old document, and installs the project. */
  const installOpenedProject = async (
    id: string,
    opened: Awaited<ReturnType<typeof openLibraryProject>>,
  ): Promise<boolean> => {
    if ([...(opened.assets.names?.() ?? [])].length === 0) {
      try {
        await repairAssets(id, opened.project as { chart: unknown; name: string });
      } catch (error) {
        // A missing source file must not make a chart with no resources
        // unopenable; the editor can still add assets later.
        console.warn("Unable to migrate library assets", error);
      }
    }
    await deps.documents?.close();
    await openLibrary(id);
    return true;
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
    chooseExternalImport: () => chooseExternalChartImport(externalDeps),
    openProject: async (id) => {
      const found = await localService();
      if (!found) {
        throw libraryMissing();
      }
      const opened = await openLibraryProject(found.library, id);
      if (!opened.project) {
        throw new Error(t("editor.app.error.projectMissing"));
      }
      return deps.guardReplace(() => installOpenedProject(id, opened));
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
