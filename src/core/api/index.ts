/**
 * Owns the host facade assembled from the owning registries and editor services.
 *
 * Internal features register through those owners. Packaged Extensions receive
 * a capability-gated view through `context.api`; the full facade is installed
 * as `window.redux` only by the development server, debug builds, and attached
 * automation. This module is the compatibility boundary for that surface.
 *
 * Minimal browser usage:
 * ```js
 * window.redux.values.byId.get("editor.rate");
 * window.redux.playback.seek(12);
 * console.log(window.redux.playback.state().value);
 * ```
 *
 * Adding a handle is an API compatibility decision: an additive change keeps
 * the application version, while a change to an existing shape or meaning is a
 * breaking change and raises the application MAJOR version.
 */
import { contextMenu as contextMenuApi } from "./contextMenu.ts";
import { library as libraryApi } from "./library.ts";
import { settings as settingsApi } from "./settings.ts";
import { shortcuts as shortcutsApi } from "./shortcuts.ts";
import { sidebar as sidebarApi } from "./sidebar.ts";
import { toolbar as toolbarApi } from "./toolbar.ts";
import { values as valuesApi } from "./values.ts";
import { playback as playbackFacade } from "./playback.ts";
import { selection as selectionApi } from "./selection.ts";
import { document as documentApi } from "./document.ts";
import { chart as chartApi } from "./chart.ts";
import { recipe as recipeApi } from "./recipe.ts";
import { transaction as transactionApi } from "./transaction.ts";
import { diagnostics as diagnosticsApi } from "./diagnostics.ts";
import { extensions as extensionsApi } from "./extensions.ts";
import { hitTest as hitTestApi } from "./hitTest.ts";
import { preview as previewApi } from "./preview.ts";
import { layout as layoutApi } from "./layout.ts";
import { theme as themeApi } from "./theme.ts";
import { workspace as workspaceApi } from "./workspace.ts";
import { help as helpApi } from "./help.ts";
import { BUILD_APP_VERSION } from "../platform/buildInfo.ts";
import { guardDevFacade } from "../dev/apiGuard.ts";

export const settings = settingsApi;
export const shortcuts = shortcutsApi;
export const toolbar = toolbarApi;
export const sidebar = sidebarApi;
export const contextMenu = contextMenuApi;
export const values = valuesApi;
export const playback = playbackFacade;
export const library = libraryApi;
export const selection = selectionApi;
export const document = documentApi;
export const chart = chartApi;
export const transaction = transactionApi;
export const recipe = recipeApi;
export const diagnostics = diagnosticsApi;
export const extensions = extensionsApi;
export const hitTest = hitTestApi;
export const preview = previewApi;
export const layout = layoutApi;
export const theme = themeApi;
export const workspace = workspaceApi;
export const help = helpApi;

/** The complete host facade shared by every public handle. */
export const redux = Object.freeze({
  /** The application version; the only version this contract exposes. */
  get version(): string {
    return BUILD_APP_VERSION;
  },
  settings,
  shortcuts,
  toolbar,
  sidebar,
  contextMenu,
  values,
  playback,
  library,
  selection,
  document,
  chart,
  transaction,
  recipe,
  diagnostics,
  extensions,
  hitTest,
  preview,
  layout,
  theme,
  workspace,
  help,
});

/** The complete public facade type; feature contracts stay with their handles. */
export type ReduxApi = typeof redux;

declare global {
  interface Window {
    redux?: ReduxApi;
  }
}

/** Install the stable plugin-facing API on the browser window. */
export function installReduxApi(target: Window = window): void {
  // The global handle exists only for the browser dev server and the debug
  // build that smoke/automation starts. Packaged Extensions use their gated
  // context API, and release builds receive no global.
  const debugBuild =
    import.meta.env?.DEV === true ||
    (globalThis as { __REDUX_TEST_API__?: unknown }).__REDUX_TEST_API__ === true;
  if (!debugBuild) {
    return;
  }
  // The property is installed once and is neither writable nor configurable, so
  // every consumer keeps seeing the same host contract.
  if (Object.hasOwn(target, "redux")) {
    return;
  }
  Object.defineProperty(target, "redux", {
    configurable: false,
    enumerable: true,
    writable: false,
    // The global exists only in development and debug builds, so the developer
    // guard stays off the released path. It rebuilds the frozen facade rather
    // than proxying it, because wrapped values would violate Proxy invariants.
    value: guardDevFacade(redux),
  });
}
