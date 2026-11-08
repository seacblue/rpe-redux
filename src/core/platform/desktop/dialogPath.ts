/**
 * Remembers the last directory used by the native file dialogs.
 *
 * Open/save pickers are intentionally separate from document state: the user
 * expects the next picker to resume where the previous one ended, even if it
 * belongs to a different feature. The preference section is keyed by dialog
 * kind so a backup picker cannot pull the chart picker into an unrelated folder.
 */
import { PREFERENCE_SECTIONS, preferenceStorage } from "../../state/preferences.ts";

/** Callers that remember and restore native dialog locations. */
export type DialogKind =
  "chart" | "media" | "image" | "audio" | "theme" | "skin" | "backup" | "update" | "recording";

const storage = preferenceStorage(PREFERENCE_SECTIONS.dialogs);
const LAST_DIRECTORY = "last";

/** Extract a file's parent directory, preserving a Windows drive root. */
function directoryOf(path: string): string | undefined {
  const slash = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  if (slash < 0) {
    return undefined;
  }
  if (slash === 0) {
    return path[0];
  }
  const directory = path.slice(0, slash);
  // Keep a Windows drive root as `C:\` rather than the drive-relative `C:`.
  return /^[a-z]:$/i.test(directory) ? `${directory}\\` : directory;
}

/** Join a directory and name using the separator the directory already uses. */
function join(directory: string, name: string): string {
  const separator = directory.includes("\\") ? "\\" : "/";
  return directory.endsWith("/") || directory.endsWith("\\")
    ? `${directory}${name}`
    : `${directory}${separator}${name}`;
}

/** The remembered directory for a kind, falling back to the last used one. */
export function dialogDirectory(kind: DialogKind): string | undefined {
  const specific = storage.getItem(`directory:${kind}`);
  if (specific) {
    return specific;
  }
  const last = storage.getItem(LAST_DIRECTORY);
  return last || undefined;
}

/** A `defaultPath` safe to pass to the native dialog for this kind. */
export function dialogDefaultPath(kind: DialogKind, name?: string): string | undefined {
  const directory = dialogDirectory(kind);
  if (!directory) {
    return name;
  }
  return name ? join(directory, name) : directory;
}

/** Remember the directory that contained a chosen file. */
export function rememberDialogFile(kind: DialogKind, path: string): void {
  const directory = directoryOf(path);
  if (!directory) {
    return;
  }
  storage.setItem(`directory:${kind}`, directory);
  storage.setItem(LAST_DIRECTORY, directory);
}

/** Remember a directory chosen directly, such as an extraction folder. */
export function rememberDialogDirectory(kind: DialogKind, path: string): void {
  if (!path) {
    return;
  }
  storage.setItem(`directory:${kind}`, path);
  storage.setItem(LAST_DIRECTORY, path);
}

/** Remember the directory of the first file in a multi-selection. */
export function rememberDialogFiles(kind: DialogKind, paths: readonly string[]): void {
  const first = paths[0];
  if (first) {
    rememberDialogFile(kind, first);
  }
}
