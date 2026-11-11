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
