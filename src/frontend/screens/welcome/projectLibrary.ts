/**
 * Composition root for the home library.
 *
 * The project controller and published card snapshot are wired together here
 * for the editor host.
 */
import type { LibraryProjectSummary } from "../../../core/global/library/client.ts";
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
  /** Open a project stored in the local SQLite library. */
  openProject: (id: string) => Promise<unknown>;
  /** Open an imported project after the caller already handled unsaved changes. */
  openImported?: (id: string) => Promise<unknown>;
  /** Read a chart file into the library without opening it. */
  importFile: (path: string) => Promise<string | null>;
  /** Import a dropped/selected RPE root; null when the path is not an RPE folder. */
  importRpePath?: (path: string) => Promise<readonly string[] | null>;
  /** Import an official/PEC chart path; null when the path is not that format. */
  importExternalPath?: (path: string) => Promise<string | null>;
  /** Ask for an RPE root and run the confirmed migration. */
  chooseRpeImport?: () => Promise<unknown>;
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
  private readonly openProject: (id: string) => Promise<unknown>;
  private readonly openImported?: (id: string) => Promise<unknown>;
  private readonly importExternalPath?: (path: string) => Promise<string | null>;
  private readonly chooseRpe?: () => Promise<unknown>;
  private readonly chooseExternal?: () => Promise<unknown>;
  private readonly reportError: (error: unknown) => void;

  /** Wires the card adapter and the project controller to the host callbacks. */
  constructor({
    openProject,
    openImported,
    importFile,
    importRpePath,
    importExternalPath,
    chooseRpeImport,
    chooseExternalImport,
    exportProject,
    reportError,
    changed,
  }: ProjectHomeOptions) {
    this.importFile = importFile;
    this.importRpePath = importRpePath;
    this.openProject = openProject;
    this.openImported = openImported;
    this.importExternalPath = importExternalPath;
    this.chooseRpe = chooseRpeImport;
    this.chooseExternal = chooseExternalImport;
    this.reportError = reportError;
    this.cards = new HomeProjectCardsAdapter({
      onOpenProject: (id) => openProject(id).catch(reportError),
      onExportProject: (id) => exportProject(id).catch(reportError),
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

  /** Ask for an official/PEC chart and import it; failures go through the reporter. */
  async chooseExternalImport(): Promise<void> {
    try {
      await this.chooseExternal?.();
    } catch (error) {
      this.reportError(error);
    }
  }

  /**
   * Imports dropped files into the library and refreshes the home snapshot.
   *
   * Returns the projects it created or updated, in the order the drop supplied
   * them; one bad file must not stop the rest of the drop, and the failure is
   * reported by the same surface that owns the import action.
   */
  async importPaths(paths: readonly string[]): Promise<readonly string[]> {
    const imported: string[] = [];
    for (const path of paths) {
      try {
        if (this.importRpePath) {
          const ids = await this.importRpePath(path);
          if (ids !== null) {
            imported.push(...ids);
            continue;
          }
        }
        if (this.importExternalPath) {
          const id = await this.importExternalPath(path);
          if (id) {
            imported.push(id);
            continue;
          }
        }
        const id = await this.importFile(path);
        if (id) {
          imported.push(id);
        }
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

  /** Opens one library project after an import; the caller handled unsaved work. */
  async open(id: string): Promise<void> {
    await (this.openImported ?? this.openProject)(id);
  }

  /** Releases the controller and the card adapter. */
  dispose(): void {
    this.library.dispose();
    this.cards.dispose();
  }
}
