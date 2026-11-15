/** Persists the welcome library's selected group filter beside its other view preferences. */
import { PREFERENCE_SECTIONS, preferences } from "../../../core/state/preferences.ts";

/** The welcome preference field holding the explicitly selected group names. */
const GROUP_FILTER_KEY = "libraryGroupFilter";

/** Read the welcome preference record without assuming it exists. */
function welcomeRecord(): Record<string, unknown> {
  const value = preferences.read<unknown>(PREFERENCE_SECTIONS.welcome, null);
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

/** Return the saved selection, or null when the default is all groups. */
export function getLibraryGroupFilter(): readonly string[] | null {
  const value = welcomeRecord()[GROUP_FILTER_KEY];
  if (!Array.isArray(value)) {
    return null;
  }
  return [...new Set(value.filter((group): group is string => typeof group === "string"))];
}

/** Persist the selected group names; an empty list intentionally selects none. */
export function setLibraryGroupFilter(groups: readonly string[]): void {
  preferences.write(PREFERENCE_SECTIONS.welcome, {
    ...welcomeRecord(),
    [GROUP_FILTER_KEY]: [...new Set(groups)],
  });
}
