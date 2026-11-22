/**
 * Open and close the settings dialog from anywhere in the shell.
 *
 * The window owns its own content state, while this controller also publishes a
 * small snapshot so the window's address query can follow the visible page
 * without threading React state through the shell.
 */
import { createValue } from "../../../core/state/values.ts";

/** Window event a caller dispatches to open the dialog, optionally on a category. */
export const OPEN_SETTINGS_EVENT = "redux-open-settings";
/** Window event a caller dispatches to close the dialog. */
export const CLOSE_SETTINGS_EVENT = "redux-close-settings";

/**
 * A local package the settings window should review as soon as it opens.
 *
 * A dropped ZIP or folder is classified by the intake service, but installation
 * still goes through the ordinary review and consent dialog; this carries the
 * path from the drop surface to that dialog without installing anything itself.
 */
export interface PendingLocalPackage {
  /** Absolute path to the dropped folder or ZIP. */
  readonly path: string;
}

const pendingLocalPackage = createValue<PendingLocalPackage | null>({
  initial: null,
  equals: (left, right) => left?.path === right?.path,
});

/** Read the local package waiting for review, if any. */
export const getPendingLocalPackage = pendingLocalPackage.get;

/** Subscribe to the pending-package slot. */
export const subscribePendingLocalPackage = pendingLocalPackage.subscribe;

/** Publish a dropped package for the install dialog, replacing any older one. */
export function requestLocalPackageReview(path: string): void {
  const trimmed = path.trim();
  if (!trimmed) {
    return;
  }
  pendingLocalPackage.set({ path: trimmed });
  openSettings("extensions");
}

/** Take the pending package once, so a later dialog open does not reuse it. */
export function takePendingLocalPackage(): string | null {
  const pending = pendingLocalPackage.get();
  pendingLocalPackage.set(null);
  return pending?.path ?? null;
}

/** The visible settings state the route adapter mirrors into the query. */
export interface SettingsWindowSnapshot {
  readonly open: boolean;
  /** The resolved page key; empty while the dialog is closed. */
  readonly category: string;
}

const windowState = createValue<SettingsWindowSnapshot>({
  initial: { open: false, category: "" },
  equals: (left, right) => left.open === right.open && left.category === right.category,
});

/** Read the visible settings snapshot. */
export const getSettingsWindowState = windowState.get;
/** Subscribe to visible settings changes. */
export const subscribeSettingsWindowState = windowState.subscribe;

/** Publish the visible settings state after a page or open-state change. */
export function publishSettingsWindowState(open: boolean, category: string): void {
  windowState.set({ open, category: open ? category : "" });
}

/** Ask the mounted settings window to open, optionally on a category key. */
export function openSettings(category?: string): void {
  window.dispatchEvent(new CustomEvent(OPEN_SETTINGS_EVENT, { detail: { category } }));
}

/** Ask the mounted settings window to close. */
export function closeSettings(): void {
  window.dispatchEvent(new Event(CLOSE_SETTINGS_EVENT));
}
