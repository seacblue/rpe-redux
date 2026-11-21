/**
 * Theme packages that live on disk.
 *
 * A package dropped into one of the host's `themes/` roots is discovered at
 * startup, and an imported package is written into the user's data directory so
 * it survives an update of a portable build. Validation stays in
 * `core/theme/packages.ts`: the host only reads and writes documents.
 */
import { invoke } from "@tauri-apps/api/core";
import { isDesktop } from "../environment.ts";
import type { DiscoveredTheme } from "../../theme/registry.ts";

/** Every package document found in the host's theme roots, with its origin. */
export async function listExternalThemePackages(): Promise<readonly DiscoveredTheme[]> {
  if (!isDesktop()) {
    return [];
  }
  try {
    const found = await invoke<Record<string, unknown>[]>("list_theme_packages");
    return found.flatMap((entry) => {
      const payload = entry?.["document"];
      if (payload === undefined) {
        return [];
      }
      const source = entry["source"] === "portable" ? "portable" : "user";
      return [{ payload, source }];
    });
  } catch (error) {
    // An empty list means "no packages"; a failed scan must not remove the
    // packages already painted or registered.
    console.error("Unable to scan theme packages", error);
    throw error;
  }
}

/** Writes one package document into the user theme folder and returns its path. */
export async function installExternalThemePackage(document: string): Promise<string> {
  if (!isDesktop()) {
    return "";
  }
  return invoke<string>("install_theme_package", { document });
}

/** Deletes an imported package. Built-in packages are refused by the host. */
export async function removeExternalThemePackage(id: string): Promise<void> {
  if (!isDesktop()) {
    return;
  }
  await invoke("remove_theme_package", { id });
}
