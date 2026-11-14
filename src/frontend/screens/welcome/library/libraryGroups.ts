/** Shared library-group vocabulary for the welcome page and its persistence boundary. */

/** The canonical group assigned to projects without an explicit group. */
export const DEFAULT_LIBRARY_GROUP = "Default";

/** Returns the canonical stored/displayed value for a project group. */
export function normalizeLibraryGroup(group: string | null | undefined): string {
  const trimmed = group?.trim() ?? "";
  return trimmed || DEFAULT_LIBRARY_GROUP;
}
