/**
 * Owns the host-only drawer navigation handle exposed to automation.
 *
 * The window has one authoring surface: the editor. Document-wide pages open in
 * the drawer, and its selection is the one piece of shell state this handle
 * exposes. The mounted frontend owns that state and supplies a reader; package
 * code receives no capability for this handle, so it never reaches the gated
 * Extension facade.
 */
import { readDrawerPane } from "../shell/drawerPane.ts";
import { openDrawer } from "../shell/drawerOpen.ts";

/** Drawer navigation exposed to the development facade and automation. */
export const workspace = Object.freeze({
  /** The drawer pane selected most recently. */
  drawerPane: (): string => readDrawerPane(),
  /**
   * Open one registered drawer pane.
   *
   * The mounted drawer validates the id and publishes the open/pane record, so a
   * caller never changes a hidden state. A blank id, an unmounted drawer, or an
   * unknown pane returns false and leaves the selection untouched.
   */
  openDrawerPane: (id: string): boolean => {
    const value = id.trim();
    return Boolean(value) && openDrawer(value);
  },
});

/** The host-only workspace handle: drawer navigation for automation. */
export type WorkspaceApi = typeof workspace;
