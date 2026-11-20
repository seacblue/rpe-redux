/**
 * The "restore a backup" question and its submit path.
 *
 * Choosing a backup is a two-step answer: the list shows what was saved and when,
 * and a confirmation states what the restore will overwrite. Both steps are one
 * queued modal, so a dismissal at either step applies nothing.
 */
import { t } from "../../../../../../i18n/index.ts";
import { createValue } from "../../../../../../core/state/values.ts";
import { dismissModal, presentModal } from "../../../../../overlays/modals/modalQueue.ts";
import { showNotice } from "../../../../../overlays/modals/prompts.ts";
import { localService } from "../../../../../../core/global/library/service.ts";
import type { LibrarySnapshotSummary } from "../../../../../../core/global/library/client.ts";

/** What the footer of the confirmation step can answer. */
export type RestoreDecision = "cancel" | "discard" | "save";

/** One open restore question and its current step. */
export interface RestoreState {
  /** Identifies the request; a fresh one starts at the list step. */
  id: number;
  projectId: string;
  title: string;
  snapshots: readonly LibrarySnapshotSummary[];
  /** The backup the user picked, or null while the list is showing. */
  selected: LibrarySnapshotSummary | null;
  /** False while the list is still loading. */
  loaded: boolean;
  /** Why the restore could not be applied, if it failed. */
  error: string;
  /** True while a restore is in flight, so a second answer cannot restack it. */
  pending: boolean;
}

/** How a chosen backup is applied, supplied by the editor host. */
export interface RestoreHost {
  /**
   * Append the chart on screen to the project's tree before the restore.
   *
   * This is the "save" answer: the unsaved work stops being unsaved by becoming a
   * node, so the restore that follows cannot lose it. It deliberately is not a
   * library commit — committing would replace the stored chart and the backup
   * being restored would no longer be a distinct point.
   */
  saveCurrentAsBackup(): Promise<void>;
  /** Reload a project chart the service just replaced. */
  reloadProject(projectId: string): Promise<void>;
}

const state = createValue<RestoreState | null>({ initial: null });
let nextId = 0;

/** The modal id for the request; one id keeps both steps on one dialog. */
const modalId = (id: number) => `restore-backup:${id}`;

/** Format a stored timestamp the way the rest of the library shows times. */
export function formatSnapshotTime(createdAt: string): string {
  const parsed = new Date(createdAt);
  return Number.isNaN(parsed.getTime()) ? createdAt : parsed.toLocaleString();
}

/** Publish the next state, or close the modal when it is null. */
function publish(next: RestoreState | null): void {
  const current = state.get();
  if (current && !next) {
    dismissModal(modalId(current.id));
  }
  state.set(next);
}

/** The pending restore question, if any. */
export const getRestoreState = state.get;

/** Subscribes to restore-question changes. */
export const subscribeRestoreState = state.subscribe;

/**
 * Open the backup list for one library project.
 *
 * A document without a library project has no tree; the caller reports that
 * before reaching here.
 */
export async function openRestorePrompt(projectId: string): Promise<void> {
  nextId += 1;
  const id = nextId;
  publish({
    id,
    projectId,
    title: t("editor.dialogs.restoreBackup.title"),
    snapshots: [],
    selected: null,
    loaded: false,
    error: "",
    pending: false,
  });
  presentModal(modalId(id), { onClose: () => publish(null) });

  /** Settle the list step once, and only while this request is still the open one. */
  const settle = (change: (current: RestoreState) => RestoreState): void => {
    const current = state.get();
    if (current?.id === id) {
      publish(change(current));
    }
  };
  try {
    const service = await localService();
    if (!service) {
      throw new Error(t("editor.app.error.libraryServiceDown"));
    }
    const history = await service.library.snapshots(projectId, { limit: 100 });
    settle((current) => ({ ...current, snapshots: history.snapshots, loaded: true }));
  } catch (error) {
    // A failed read still ends the list step, so the dialog explains the problem
    // instead of showing a loading line for a request that already failed.
    settle((current) => ({
      ...current,
      loaded: true,
      error: error instanceof Error ? error.message : String(error),
    }));
  }
}

/** Take the question down without applying anything. */
export function closeRestorePrompt(): void {
  publish(null);
}

/** Advance to the confirmation step for one backup. */
export function selectRestoreSnapshot(snapshot: LibrarySnapshotSummary): void {
  const current = state.get();
  if (!current) {
    return;
  }
  publish({ ...current, selected: snapshot, error: "" });
}

/**
 * Answer the confirmation step.
 *
 * `save` appends the chart on screen as a branch node first, so the restore does
 * not discard work the user chose to keep; a failed append keeps the question up
 * with the reason. The request is marked pending while it runs, so a second click
 * cannot start a second restore over the first.
 */
export async function resolveRestore(host: RestoreHost, decision: RestoreDecision): Promise<void> {
  const current = state.get();
  const snapshot = current?.selected;
  if (!current || !snapshot || current.pending) {
    return;
  }
  if (decision === "cancel") {
    publish(null);
    return;
  }
  publish({ ...current, pending: true, error: "" });
  try {
    if (decision === "save") {
      await host.saveCurrentAsBackup();
    }
    const service = await localService();
    if (!service) {
      throw new Error(t("editor.app.error.libraryServiceDown"));
    }
    // The service applies the provider manifest with the chart, so a failed
    // request leaves the project untouched. Only a success changes the document.
    await service.library.restoreSnapshot(snapshot.id);
    await host.reloadProject(current.projectId);
    publish(null);
  } catch (error) {
    const message = t("editor.dialogs.restoreBackup.failed", {
      message: error instanceof Error ? error.message : String(error),
    });
    const latest = state.get();
    if (latest?.id === current.id) {
      publish({ ...latest, pending: false, error: message });
    }
  }
}

/** Report that a document has no backups to restore. */
export function showNoBackups(): void {
  showNotice({
    title: t("editor.dialogs.restoreBackup.title"),
    description: t("editor.dialogs.restoreBackup.none"),
  });
}
