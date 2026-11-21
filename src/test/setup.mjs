/**
 * Register the deferred product-page catalogs before the unit suite runs.
 *
 * The browser registers these with the editor shell, which the unit tests never
 * mount. Loading the same pair through `--import` keeps tests that read runtime
 * text on the complete catalog without putting it back in the startup graph.
 */
import { registerDeferredCatalogs } from "../i18n/deferred.ts";

registerDeferredCatalogs();
