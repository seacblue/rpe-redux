/**
 * Composition root for the home library.
 *
 * The project controller and published card snapshot are wired together here
 * for the editor host.
 */
import type { LibraryProjectSummary } from "../../../core/global/library/client.ts";
import { dropRoute, type DropClassification } from "../../../core/global/document/dropIntake.ts";
import { HomeProjectCardsAdapter } from "./homeProjectCards.ts";
import { LibraryProjectsController } from "./libraryProjectsController.ts";
import type { LibrarySort } from "./librarySort.ts";

export type { HomeProjectCardsSnapshot } from "./homeProjectCards.ts";
export {
  getHomeProjectCardsSnapshot,
  setHomeProjectCardsSnapshot,
  subscribeHomeProjectCards,
} from "./homeProjectCards.ts";

/** Host callbacks the home library needs to open, import, export, and report. */
interface ProjectHomeOptions {
  /** Open a project stored in the local SQLite library; false when cancelled. */
  openProject: (id: string) => Promise<boolean>;
  /** Open an imported project after the caller already handled unsaved changes. */
  openImported?: (id: string) => Promise<unknown>;
  /** Read a chart file into the library without opening it. */
  importFile: (path: string) => Promise<string | null>;
  /** Import a dropped/selected RPE root; null when the path is not an RPE folder. */
  importRpePath?: (path: string) => Promise<readonly string[] | null>;
  /** Open the review for a native RPE installation; null when classification failed. */
  importRpeInstallation?: (
    path: string,
    details?: DropClassification["details"],
  ) => Promise<readonly string[] | null>;
  /** Open the review for an old PhiEditer installation; null when classification failed. */
  importPeInstallation?: (
    path: string,
    details?: DropClassification["peDetails"],
  ) => Promise<readonly string[] | null>;
  /** Import an official/PEC chart path; null when the path is not that format. */
  importExternalPath?: (path: string) => Promise<string | null>;
  /** Ask the backend to classify dropped paths before choosing an importer. */
  classifyPaths?: (paths: readonly string[]) => Promise<readonly DropClassification[]>;
  /** Route a recognized Extension package to its settings surface. */
  importExtension?: (item: DropClassification) => Promise<unknown>;
  /** Route a recognized note-skin package to its settings surface. */
  importSkin?: (item: DropClassification) => Promise<unknown>;
  /** Report a drop the backend could not route. */
  unsupportedDrop?: (item: DropClassification) => void;
  /**
   * Convert one external chart package and open its library project.
   * Returns false when the path is not a supported external format.
   */
  importExternalChart?: (path: string) => Promise<boolean>;
  /** Ask for an RPE root and run the confirmed migration. */
  chooseRpeImport?: () => Promise<unknown>;
  /** Ask for a PhiEditer root and run the confirmed import. */
  choosePeImport?: () => Promise<unknown>;
  /** Ask for an official/PEC chart and import it. */
  chooseExternalImport?: () => Promise<unknown>;
  /** Write a library project to a chart file chosen by the user. */
  exportProject: (id: string) => Promise<unknown>;
  reportError: (error: unknown) => void;
  /** Called after a rename/patch so the caller can repaint its own state. */
  changed?: (project: LibraryProjectSummary) => void;
}

/** Composes welcome-page controllers and owns their shared lifetime. */
export class ProjectHome {
  readonly cards: HomeProjectCardsAdapter;
  readonly library: LibraryProjectsController;
  private readonly importFile: (path: string) => Promise<string | null>;
  private readonly importRpePath?: (path: string) => Promise<readonly string[] | null>;
  private readonly importRpeInstallation?: (
    path: string,
    details?: DropClassification["details"],
  ) => Promise<readonly string[] | null>;
  private readonly importPeInstallation?: (
    path: string,
    details?: DropClassification["peDetails"],
  ) => Promise<readonly string[] | null>;
  private readonly openProjectAction: (id: string) => Promise<boolean>;
  private readonly openImported?: (id: string) => Promise<unknown>;
  private readonly importExternalPath?: (path: string) => Promise<string | null>;
  private readonly classifyPaths?: (
    paths: readonly string[],
  ) => Promise<readonly DropClassification[]>;
  private readonly importExtension?: (item: DropClassification) => Promise<unknown>;
  private readonly importSkin?: (item: DropClassification) => Promise<unknown>;
  private readonly unsupportedDrop?: (item: DropClassification) => void;
  private readonly importExternalChart?: (path: string) => Promise<boolean>;
  private readonly chooseRpe?: () => Promise<unknown>;
  private readonly choosePe?: () => Promise<unknown>;
  private readonly chooseExternal?: () => Promise<unknown>;
  private readonly reportError: (error: unknown) => void;

  /** Wires the card adapter and the project controller to the host callbacks. */
  constructor({
    openProject,
    openImported,
    importFile,
    importRpePath,
    importRpeInstallation,
    importPeInstallation,
    importExternalPath,
    classifyPaths,
    importExtension,
    importSkin,
    unsupportedDrop,
    importExternalChart,
    chooseRpeImport,
    choosePeImport,
    chooseExternalImport,
    exportProject,
    reportError,
    changed,
  }: ProjectHomeOptions) {
    this.importFile = importFile;
    this.importRpePath = importRpePath;
    this.importRpeInstallation = importRpeInstallation;
    this.importPeInstallation = importPeInstallation;
    this.openProjectAction = openProject;
    this.openImported = openImported;
    this.importExternalPath = importExternalPath;
    this.classifyPaths = classifyPaths;
    this.importExtension = importExtension;
    this.importSkin = importSkin;
    this.unsupportedDrop = unsupportedDrop;
    this.importExternalChart = importExternalChart;
    this.chooseRpe = chooseRpeImport;
    this.choosePe = choosePeImport;
    this.chooseExternal = chooseExternalImport;
    this.reportError = reportError;
    this.cards = new HomeProjectCardsAdapter({
      onOpenProject: (id) => {
        void this.openProject(id).catch(reportError);
      },
      onExportProject: (id) => exportProject(id).catch(reportError),
      onRenameProject: (project) => this.library.edit(project),
      onDelete: (project) => this.library.remove(project),
      onSort: (sort: LibrarySort) => {
        void this.library.setSort(sort).catch(reportError);
      },
      onRetry: () => {
        void this.refresh().catch(reportError);
      },
    });
    this.library = new LibraryProjectsController({
      reportError,
      changed: (update) => this.cards.updateProjects(update),
      changedProject: changed,
    });
  }

  /**
   * Open one library project.
   *
   * Returns false when the replace guard was cancelled; the caller can then
   * leave the address bar on the document that is actually open.
   */
  openProject(id: string): Promise<boolean> {
    return this.openProjectAction(id);
  }

  /** Reloads the library listing into the published card snapshot. */
  async refresh(): Promise<void> {
    await this.library.refresh();
  }

  /** Ask for an RPE root and import it; failures go through the shared reporter. */
  async chooseRpeImport(): Promise<void> {
    try {
      await this.chooseRpe?.();
    } catch (error) {
      this.reportError(error);
    }
  }

  /** Ask for a PhiEditer root and import it; failures go through the reporter. */
  async choosePeImport(): Promise<void> {
    try {
      await this.choosePe?.();
    } catch (error) {
      this.reportError(error);
    }
  }

  /** Ask for an official/PEC chart and import it; failures go through the reporter. */
  async chooseExternalImport(): Promise<void> {
    try {
      await this.chooseExternal?.();
    } catch (error) {
      this.reportError(error);
    }
  }

  /**
   * Convert one external chart package and open the project it imported.
   *
   * Returns false when the host has no converter or the path is not a supported
   * external format, so the caller can keep its own failure path.
   */
  importExternalChartFile(path: string): Promise<boolean> {
    return this.importExternalChart?.(path) ?? Promise.resolve(false);
  }

  /**
   * Imports dropped files into the library and refreshes the home snapshot.
   *
   * Returns the projects it created or updated, in the order the drop supplied
   * them; one bad file must not stop the rest of the drop, and the failure is
   * reported by the same surface that owns the import action. The backend
   * classification picks the owner first; when it is unavailable the legacy
   * probe order keeps drops working.
   */
  async importPaths(paths: readonly string[]): Promise<readonly string[]> {
    if (!paths.length) {
      return [];
    }
    let classified: readonly DropClassification[] | null = null;
    if (this.classifyPaths) {
      try {
        classified = await this.classifyPaths(paths);
      } catch (error) {
        this.reportError(error);
      }
    }
    const imported: string[] = [];
    for (const path of paths) {
      try {
        const item = classified?.find((entry) => entry.path === path);
        const ids = item ? await this.importClassified(item) : await this.importSequentially(path);
        imported.push(...ids);
      } catch (error) {
        this.reportError(error);
      }
    }
    if (imported.length) {
      try {
        await this.refresh();
      } catch (error) {
        this.reportError(error);
      }
    }
    return imported;
  }

  /** Imports one path through the classifier's route. */
  private async importClassified(item: DropClassification): Promise<readonly string[]> {
    const route = dropRoute(item);
    switch (route.action) {
      case "rpe-installation": {
        let ids: readonly string[] | null = null;
        if (this.importRpeInstallation) {
          ids = await this.importRpeInstallation(route.path, item.details);
        } else if (this.importRpePath) {
          ids = await this.importRpePath(route.path);
        }
        if (ids === null) {
          this.unsupportedDrop?.(item);
          return [];
        }
        return ids;
      }
      case "pe-installation": {
        const ids = this.importPeInstallation
          ? await this.importPeInstallation(route.path, item.peDetails)
          : null;
        if (ids === null) {
          this.unsupportedDrop?.(item);
          return [];
        }
        return ids;
      }
      case "chart-rpe": {
        const ids = this.importRpePath ? await this.importRpePath(route.path) : null;
        if (ids !== null) {
          return ids;
        }
        const id = await this.importFile(route.entry);
        return id ? [id] : [];
      }
      case "chart-external": {
        const id = this.importExternalPath ? await this.importExternalPath(route.path) : null;
        if (!id) {
          this.unsupportedDrop?.(item);
        }
        return id ? [id] : [];
      }
      case "extension":
        if (this.importExtension) {
          await this.importExtension(item);
        } else {
          this.unsupportedDrop?.(item);
        }
        return [];
      case "skin":
        if (this.importSkin) {
          await this.importSkin(item);
        } else {
          this.unsupportedDrop?.(item);
        }
        return [];
      case "unsupported":
        this.unsupportedDrop?.(item);
        return [];
    }
  }

  /** Legacy probe order used when the classification service is unreachable. */
  private async importSequentially(path: string): Promise<readonly string[]> {
    if (this.importRpePath) {
      const ids = await this.importRpePath(path);
      if (ids !== null) {
        return ids;
      }
    }
    if (this.importExternalPath) {
      const id = await this.importExternalPath(path);
      if (id) {
        return [id];
      }
    }
    const id = await this.importFile(path);
    return id ? [id] : [];
  }

  /** Opens one library project after an import; the caller handled unsaved work. */
  async open(id: string): Promise<void> {
    await (this.openImported ?? this.openProjectAction)(id);
  }

  /** Releases the controller and the card adapter. */
  dispose(): void {
    this.library.dispose();
    this.cards.dispose();
  }
}
