/**
 * Search text for the shortcut settings page.
 *
 * Shortcut rows are not schema settings, so the settings search cannot derive
 * their values from a definition. This module names what the page shows: the
 * category and command titles, the current key caps, and the registered defaults
 * that Reset restores.
 */
import { displayText } from "../../../../core/shortcuts/keys.ts";
import type { ShortcutCategory, ShortcutView } from "../../../../core/shortcuts/types.ts";
import { matchesSettingsSearch } from "../settingsSearch.ts";

/** Resolve host shortcut message keys for the active interface language. */
export interface ShortcutSearchTitles {
  text(key: string): string;
  /** English catalog text, kept searchable while the interface is Chinese. */
  english?(key: string): string | undefined;
}

/** A title in the active language plus its English alias when they differ. */
function titleTerms(key: string, titles: ShortcutSearchTitles): string[] {
  const text = titles.text(key);
  const english = titles.english?.(key);
  return english !== undefined && english !== text ? [text, english] : [text];
}

/** Visible strings of one command: titles, current bindings, and defaults. */
export function shortcutSearchTerms(view: ShortcutView, titles: ShortcutSearchTitles): string[] {
  return [
    ...titleTerms(view.title, titles),
    ...view.bindings.map(displayText),
    ...view.defaults.map(displayText),
  ];
}

/** Every searchable string on the shortcut page. */
export function shortcutPageSearchTerms(
  categories: readonly ShortcutCategory[],
  views: readonly ShortcutView[],
  titles: ShortcutSearchTitles,
): string[] {
  return [
    ...categories.flatMap((category) => titleTerms(category.title, titles)),
    ...views.flatMap((view) => shortcutSearchTerms(view, titles)),
  ];
}

/** Whether one command row matches the query, including its category title. */
export function shortcutMatchesSearch(
  view: ShortcutView,
  category: ShortcutCategory,
  query: string,
  titles: ShortcutSearchTitles,
): boolean {
  return [...titleTerms(category.title, titles), ...shortcutSearchTerms(view, titles)].some(
    (text) => matchesSettingsSearch(text, query),
  );
}
