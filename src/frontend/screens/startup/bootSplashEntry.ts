/**
 * Browser entry for the inline startup splash.
 *
 * Loaded before the application entry so the static card can start reporting
 * the first-paint download while the application module graph is still
 * arriving. All behaviour lives in `bootSplash.ts`, which the application also
 * imports for its stylesheet wait and hand-off.
 */
import { installBootSplash } from "./bootSplash.ts";

installBootSplash();
