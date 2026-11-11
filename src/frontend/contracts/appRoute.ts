/**
 * The contract between the window's route adapter and the mounted editor.
 *
 * `App` parses the address before React mounts, the editor consumes that boot
 * destination while it restores or opens a document, and the route runtime
 * drives later history changes through these late-bound actions. Keeping the
 * seam here lets screens and the editor read routes without importing `app/`.
 */
import type { AppRoute } from "../../core/shell/route.ts";
import { createLateBound } from "../../core/utils/lateBound.ts";
import { createValue } from "../../core/state/values.ts";

/** The destination read from the address before the first render. */
const bootRoute = createValue<AppRoute | null>({ initial: null });

/** Publish the boot destination; the first editor assembly consumes it. */
export function setBootRoute(route: AppRoute): void {
  bootRoute.set(route);
}

/** Read the boot destination without clearing it. */
export function getBootRoute(): AppRoute | null {
  return bootRoute.get();
}

/** Whether the first restore/open attempt has finished and the URL may mirror state. */
const bootSettled = createValue<boolean>({ initial: false });

/** Read whether boot work finished. */
export const getBootSettled = bootSettled.get;

/** Subscribe to the boot-settled flag. */
export const subscribeBootSettled = bootSettled.subscribe;

/** Mark the first restore/open attempt as finished. */
export function markBootSettled(): void {
  bootSettled.set(true);
}

/** Keep a rebuilt editor assembly from mirroring before its own boot work runs. */
export function resetBootSettled(): void {
  bootSettled.set(false);
}

/**
 * Editor operations the route adapter needs when history changes.
 *
 * Each operation is guarded by the editor's own prompts; a `false` result means
 * the user cancelled or the target could not be opened, so the URL has to be
 * restored from the live editor state.
 */
export interface RouteDocumentActions {
  /** Open one library project, or resolve false when the open was cancelled. */
  openProject(projectId: string): Promise<boolean>;
  /** Hide the workspace and show the library, or resolve false when cancelled. */
  leaveEditor(): Promise<boolean>;
  /** Show the already mounted document without opening it again. */
  showEditor(): void;
}

const actions = createLateBound<RouteDocumentActions>();

/** Bind the mounted editor's route operations; returns the disposer. */
export function bindRouteDocumentActions(next: RouteDocumentActions): () => void {
  return actions.bind(next);
}

/** Read the mounted editor's route operations, or null before the editor exists. */
export function routeDocumentActions(): RouteDocumentActions | null {
  return actions.value();
}
