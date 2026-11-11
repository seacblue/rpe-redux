/**
 * The sidecar-backed project list behind the home screen.
 *
 * Loading, sorting, patching, copying, editing, and removing projects happen
 * here. The list uses the shared resource state so a first read is a skeleton,
 * a failed refresh retains the previous cards, and a superseded load cannot
 * overwrite a newer one.
 */
import { localService } from "../../../core/global/library/service.ts";
import { forgetCatalogProject } from "../../../core/global/library/libraryCatalog.ts";
import type {
  LibraryProjectSummary,
  LocalLibrary,
  ProjectPatch,
} from "../../../core/global/library/client.ts";
import { ResourceState } from "../../../core/io/resourceState.ts";
import { t } from "../../../i18n/index.ts";
import { getLibrarySort, setLibrarySort, type LibrarySort } from "./librarySort.ts";
import { openProjectPrompt, closeProjectPrompt } from "./library/projectPrompts.ts";
import type { ProjectEditValues } from "./library/projectPrompts.ts";
import type { HomeProjectCardsUpdate } from "./homeProjectCards.ts";

const GROUP_FALLBACK = () => t("editor.home.ungrouped");

/** Monotonic so a recreated controller still reports a fresh failure to the page. */
let nextRemoveFailureNonce = 0;

/** Callbacks the controller uses to report failures and publish the list. */
export interface LibraryProjectsControllerOptions {
  reportError(error: unknown): void;
  changed(update: HomeProjectCardsUpdate): void;
  changedProject?(project: LibraryProjectSummary): void;
}

/** Owns the sidecar-backed project list, its sort order, and its CRUD flows. */
export class LibraryProjectsController {
  private readonly state: ResourceState<readonly LibraryProjectSummary[]>;
  private readonly unsubscribe: () => void;
  private disposed = false;
  private library: LocalLibrary | null = null;
  private sort: LibrarySort = getLibrarySort();
  private removingProjectId: string | null = null;
  private removeFailure: HomeProjectCardsUpdate["removeFailure"] = null;
  private readonly options: LibraryProjectsControllerOptions;

  /** Stores the host callbacks and starts from the persisted sort. */
  constructor(options: LibraryProjectsControllerOptions) {
    this.options = options;
    this.state = new ResourceState<readonly LibraryProjectSummary[]>({
      initial: null,
      load: async (signal) => {
        const found = await localService();
        if (signal.aborted) {
          throw Object.assign(new Error("The library load was cancelled"), { name: "AbortError" });
        }
        this.library = found?.library ?? null;
        if (!this.library) {
          throw new Error(t("editor.home.error.libraryServiceDown"));
        }
        const result = await this.library.list({
          limit: 500,
          sort: this.sort.field,
          direction: this.sort.direction,
        });
        return result.projects ?? [];
      },
      fallback: (_error, previous) => previous,
    });
    this.unsubscribe = this.state.subscribe(() => this.publish());
    this.publish();
  }

  /** Reloads the listing with the current sort, ignoring stale responses. */
  async refresh(): Promise<void> {
    await this.state.load();
  }

  /** Aborts an in-flight read and loads the sort or mutation result again. */
  private async reload(): Promise<void> {
    await this.state.reload();
  }

  /** Persist the requested order and reload the list from the service. */
  async setSort(sort: LibrarySort): Promise<void> {
    if (sort.field === this.sort.field && sort.direction === this.sort.direction) {
      return;
    }
    this.sort = sort;
    setLibrarySort(sort);
    await this.reload();
  }

  /** Runs one library mutation against the live service, then reloads the list. */
  async withLibrary<T>(action: (library: LocalLibrary) => T | Promise<T>): Promise<T> {
    const found = await localService();
    if (!found) {
      throw new Error(t("editor.home.error.libraryServiceDown"));
    }
    const result = await action(found.library);
    await this.reload();
    return result;
  }

  /** Updates project metadata and returns the updated summary. */
  patch(id: string, values: ProjectPatch): Promise<{ project: LibraryProjectSummary }> {
    return this.withLibrary((library) => library.update(id, values));
  }

  /** Duplicates a project under a suffixed name. */
  copy(project: LibraryProjectSummary): Promise<void> {
    return this.withLibrary(async (library) => {
      await library.duplicate(
        project.id,
        t("editor.home.duplicateNameSuffix", { name: project.name }),
      );
    });
  }

  /** Opens the confirmation prompt that removes a project. */
  remove(project: LibraryProjectSummary): void {
    openProjectPrompt({
      kind: "remove",
      title: t("editor.home.removeTitle"),
      description: t("editor.home.removeBody"),
      submit: () => this.submitRemove(project),
    });
  }

  /** Opens the prompt that edits the chart metadata shown on the detail card. */
  edit(project: LibraryProjectSummary): void {
    openProjectPrompt({
      kind: "edit",
      title: t("editor.home.editTitle"),
      description: t("editor.home.editBody"),
      name: project.name,
      composer: project.composer,
      charter: project.charter,
      level: project.level,
      group: project.group || GROUP_FALLBACK(),
      submit: (values) => this.submitEdit(project, values),
    });
  }

  /** Stops accepting refresh results. */
  dispose(): void {
    this.disposed = true;
    this.unsubscribe();
    this.state.dispose();
  }

  /** Deletes the project once the prompt is confirmed. */
  private async submitRemove(project: LibraryProjectSummary): Promise<void> {
    // The prompt is already answered. Publish the pending state before the
    // request so the card becomes a skeleton immediately, then keep the failure
    // for the page to reselect that chart when the service refuses.
    closeProjectPrompt();
    this.removingProjectId = project.id;
    this.removeFailure = null;
    this.publish();
    try {
      await this.withLibrary(async (library) => {
        const result = await library.remove(project.id);
        forgetCatalogProject(project.id);
        return result;
      });
    } catch (error) {
      this.removeFailure = {
        projectId: project.id,
        nonce: (nextRemoveFailureNonce += 1),
      };
      this.options.reportError(error);
    } finally {
      this.removingProjectId = null;
      this.publish();
    }
  }

  /** Applies the edited library metadata, patching the chart's META when needed. */
  private async submitEdit(
    project: LibraryProjectSummary,
    values: ProjectEditValues,
  ): Promise<void> {
    const name = values.name.trim();
    if (!name) {
      throw new Error(t("editor.home.error.nameRequired"));
    }
    const composer = values.composer.trim();
    const charter = values.charter.trim();
    const level = values.level.trim();
    const group = values.group.trim() || GROUP_FALLBACK();
    const metadataChanged =
      composer !== project.composer || charter !== project.charter || level !== project.level;
    const updated = await this.withLibrary(async (library) => {
      const patch: ProjectPatch = { name, group };
      if (metadataChanged) {
        // The service derives composer, charter, and level from the chart META;
        // a metadata-only edit therefore patches the chart it already stores.
        const { project: full } = await library.get(project.id);
        const chart =
          typeof full.chart === "object" && full.chart !== null ? structuredClone(full.chart) : {};
        const writable = chart as Record<string, unknown>;
        const meta =
          typeof writable.META === "object" && writable.META !== null
            ? (writable.META as Record<string, unknown>)
            : {};
        writable.META = { ...meta, composer, charter, level };
        patch.chart = writable;
      }
      return library.update(project.id, patch);
    });
    this.options.changedProject?.({ ...project, ...updated.project });
  }

  /** Sends the current list and load state to the card adapter. */
  private publish(): void {
    if (this.disposed) {
      return;
    }
    const snapshot = this.state.getSnapshot();
    this.options.changed({
      projects: snapshot.value ?? [],
      phase: snapshot.phase === "idle" ? "loading" : snapshot.phase,
      error: snapshot.error,
      stale: snapshot.stale,
      removingProjectId: this.removingProjectId,
      removeFailure: this.removeFailure,
    });
  }
}
