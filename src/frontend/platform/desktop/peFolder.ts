/**
 * Adapter for reading an old PhiEditer installation.
 *
 * The local service classifies the folder and attaches the Settings.txt index
 * and resolved media paths. Unlike the RPE reader there is no native fallback:
 * the PEC conversion and library write still need the service, so a window
 * without it reports that the folder cannot be read instead of half-importing.
 */
import { isDesktop } from "../../../core/platform/environment.ts";
import { browserDevPorts } from "../../../core/platform/runtimePorts.ts";
import { localService } from "../../../core/global/library/service.ts";
import { t } from "../../../i18n/index.ts";
import type { PeFolderScan } from "../../../core/migration/pe.ts";

/** Ask the user for a PhiEditer root, or null when the dialog is cancelled. */
export async function choosePeFolder(): Promise<string | null> {
  if (!isDesktop()) {
    return null;
  }
  const { open } = await import("@tauri-apps/plugin-dialog");
  const selected = await open({
    directory: true,
    multiple: false,
    title: t("workspace.welcome.pe.pickFolder"),
  });
  return typeof selected === "string" ? selected : null;
}

/** Read the classification details for one PhiEditer root. */
export async function readPeFolder(path: string): Promise<PeFolderScan> {
  if (!isDesktop() && !browserDevPorts()) {
    throw new Error("PhiEditer import needs the desktop application.");
  }
  const found = await localService();
  if (!found) {
    throw new Error("The local service is not available.");
  }
  const { items } = await found.library.classifyDropped([path]);
  const details = items[0]?.peDetails;
  if (!details) {
    throw new Error("The folder is not a classified PhiEditer root.");
  }
  return details;
}
