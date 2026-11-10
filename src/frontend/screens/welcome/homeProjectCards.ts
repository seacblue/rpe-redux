/**
 * Snapshot and adapter for the home screen's library cards.
 *
 * The SQLite library is the only source of charts; this adapter resolves cover
 * and audio URLs and forwards the card actions to their owning controller. The
 * load phase travels with the list so the surface can draw a skeleton on the
 * first read and keep stale cards visible when a refresh fails.
 */
import { createValue } from "../../../core/state/values.ts";
import type { ResourcePhase } from "../../../core/io/resourceState.ts";
import {
  projectAssetUrl,
  serverOrigin,
  type LibraryProjectSummary,
} from "../../../core/global/library/client.ts";
import type { LibrarySort } from "./librarySort.ts";

/** A library project with its media resolved for the card grid. */
export interface HomeLibraryProject extends LibraryProjectSummary {
  /** Server URL for the project's stored cover, when it has one. */
  coverUrl?: string;
  /** Server URL for the project's stored audio track, when it has one. */
  audioUrl?: string;
}

/** Load state shown beside the cards. */
export interface HomeLibraryStatus {
  readonly phase: ResourcePhase;
  readonly error: string;
  /** The cards predate the last failed refresh and remain usable. */
  readonly stale: boolean;
}

/** Published home cards plus the actions each card invokes. */
export interface HomeProjectCardsSnapshot extends HomeLibraryStatus {
  libraryProjects: HomeLibraryProject[];
  onOpenProject(id: string): void;
  onExportProject(id: string): void;
  onDelete(project: LibraryProjectSummary): void;
  onSort(sort: LibrarySort): void;
  onRetry(): void;
}

/** Callbacks the card adapter forwards to its owning controller. */
export interface HomeProjectCardsActions {
  onOpenProject(id: string): void;
  onExportProject(id: string): void;
  onDelete(project: LibraryProjectSummary): void;
  onSort(sort: LibrarySort): void;
  onRetry(): void;
}

/** List and load state handed from the controller to the adapter. */
export interface HomeProjectCardsUpdate extends HomeLibraryStatus {
  readonly projects: readonly LibraryProjectSummary[];
}

const cards = createValue<HomeProjectCardsSnapshot | null>({ initial: null });
export const getHomeProjectCardsSnapshot = cards.get;
export const subscribeHomeProjectCards = cards.subscribe;
export const setHomeProjectCardsSnapshot = cards.set;

/** Publishes the sidecar's project list in its requested sort order. */
export class HomeProjectCardsAdapter {
  private projects: LibraryProjectSummary[] = [];
  private status: HomeLibraryStatus = Object.freeze({
    phase: "loading",
    error: "",
    stale: false,
  });
  private disposed = false;
  private readonly actions: HomeProjectCardsActions;

  /** Stores the controller callbacks and publishes the initial skeleton state. */
  constructor(actions: HomeProjectCardsActions) {
    this.actions = actions;
    this.publish();
  }

  /** Replace the published project list and its load state. */
  updateProjects(update: HomeProjectCardsUpdate | readonly LibraryProjectSummary[]): void {
    if (this.disposed) {
      return;
    }
    const next: HomeProjectCardsUpdate = Array.isArray(update)
      ? { projects: update, phase: "ready", error: "", stale: false }
      : (update as HomeProjectCardsUpdate);
    this.projects = [...next.projects];
    this.status = Object.freeze({
      phase: next.phase,
      error: next.error,
      stale: next.stale,
    });
    this.publish();
  }

  /** Release the shared snapshot when the home surface unmounts. */
  dispose(): void {
    this.disposed = true;
    setHomeProjectCardsSnapshot(null);
  }

  /** Resolves media URLs and publishes the snapshot, or null once disposed. */
  private publish(): void {
    if (this.disposed) {
      return;
    }
    const origin = serverOrigin();
    const libraryProjects = this.projects.map((project): HomeLibraryProject => {
      const coverUrl = project.background
        ? projectAssetUrl(origin, project.id, project.background)
        : "";
      const audioUrl = project.song ? projectAssetUrl(origin, project.id, project.song) : "";
      return {
        ...project,
        ...(coverUrl ? { coverUrl } : {}),
        ...(audioUrl ? { audioUrl } : {}),
      };
    });
    setHomeProjectCardsSnapshot({
      ...this.status,
      libraryProjects,
      ...this.actions,
    });
  }
}
