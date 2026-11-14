/**
 * The events the shell broadcasts on `window`.
 *
 * They are the seam between the chrome and the workspace: an action's `run`
 * dispatches one, and the module that owns the behavior listens for it. Keeping
 * the names here means a listener never has to import the module that raises
 * them, and an action never has to import the editor.
 */

/** Asks the editor to open its export dialog. */
export const EXPORT_DOCUMENT_EVENT = "redux:export-document";
/** Requests chart import without opening any imported project. */
export const IMPORT_CHART_EVENT = "redux:import-chart";
/** Requests chart import followed by an explicit open action for one result. */
export const IMPORT_AND_OPEN_CHART_EVENT = "redux:import-and-open-chart";
/** Broadcasts the window's file-drag phase so the active surface can answer it. */
export const FILE_DRAG_EVENT = "redux:file-drag";
/** Requests the mounted workspace to activate one inspector pane. */
export const OPEN_INSPECTOR_EVENT = "redux:open-inspector";
/**
 * Requests closing one inspector pane. The mounted inspector ignores the
 * request unless that pane is active, so a package cannot close another route.
 */
export const CLOSE_INSPECTOR_EVENT = "redux:close-inspector";
/** Requests the line inspector to show its batch/property face. */
export const OPEN_LINE_PROPERTIES_EVENT = "redux:open-line-properties";
/** Asks the toolbar's metadata row to unfold its form. */
export const OPEN_METADATA_EVENT = "redux:open-metadata";
/**
 * Asks the shell to re-read the state behind its actions: an action's `checked`,
 * `enabled` and `visible` are read while a row renders, so whoever changes that
 * state announces it. See `Contributions.refresh`.
 */
export const TOOLBAR_REFRESH_EVENT = "redux:toolbar-refresh";
/** Announces that a registered shortcut ran, so transient surfaces can dismiss. */
export const SHORTCUT_DISPATCHED_EVENT = "redux:shortcut-dispatched";
/** Announces that the modal stack opened, closed, or changed its active layer. */
export const MODAL_STACK_EVENT = "redux:modal-stack";
