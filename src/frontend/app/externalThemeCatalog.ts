/**
 * External theme discovery shared by startup and the theme picker.
 *
 * The registry keeps parsed packages, so a folder scan only replaces documents
 * that changed. The shell scans once at startup so a persisted external theme
 * can paint the first frame; the picker scans again only while it is on screen,
 * because a dropped theme cannot affect anything until someone opens the list.
 */
import { listExternalThemePackages } from "../../core/platform/desktop/themePackages.ts";
import {
  getThemePackage,
  replaceDiscoveredThemes,
  type DiscoveredTheme,
} from "../../core/theme/registry.ts";
import { DEFAULT_THEME } from "../../core/theme/themes.ts";
import { activeTheme, setActiveTheme } from "../../core/theme/activeTheme.ts";
import { applyTheme } from "../../core/theme/applyTheme.ts";
import { syncNativeWindowTheme } from "../platform/desktop/windowTheme.ts";

let signature = "";
let refreshPromise: Promise<void> | null = null;

/** Re-scan external theme documents and re-apply the active package. */
export function refreshExternalThemes(): Promise<void> {
  refreshPromise ??= scan().finally(() => {
    refreshPromise = null;
  });
  return refreshPromise;
}

/**
 * Replace the external set only after a successful scan.
 *
 * A transient host failure must not look like "every external theme was
 * removed", which would drop the active theme and its cached glyphs.
 */
async function scan(): Promise<void> {
  let documents: readonly DiscoveredTheme[];
  try {
    documents = await listExternalThemePackages();
  } catch {
    return;
  }
  const next = JSON.stringify(documents);
  if (next === signature) {
    return;
  }
  signature = next;
  replaceDiscoveredThemes(documents);
  const theme = activeTheme();
  if (!getThemePackage(theme)) {
    setActiveTheme(DEFAULT_THEME);
    applyTheme(DEFAULT_THEME);
    syncNativeWindowTheme(DEFAULT_THEME);
    return;
  }
  // A same-id package can change its palette without changing the preference.
  applyTheme(theme);
  syncNativeWindowTheme(theme);
}
