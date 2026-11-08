/**
 * The settings window's view of the settings registry.
 *
 * Categories, fields, navigation lookup, and translated text are read here so the
 * React surfaces never reach into the registry themselves.
 */
import { CATALOGS } from "../../../i18n/messages/index.ts";
import { t, tRaw, type MessageKey } from "../../../i18n/index.ts";
import type {
  SettingDefinition,
  SettingText,
  SettingsNavigation,
} from "../../../core/settings/types.ts";
import { settingsRegistry } from "../../../core/settings/settings.ts";
import { values } from "../../../core/state/values.ts";
import "../../../core/settings/features/index.ts";
import { settingsPageFor } from "./settingsContributions.ts";
import { matchesSettingsSearch } from "./settingsSearch.ts";

/** Registry navigation and definition readers bound for the settings UI. */
export const settingsNavigations = settingsRegistry.navigations.bind(settingsRegistry);
/** Child navigation entries for one category key. */
export const settingsNavigationChildren =
  settingsRegistry.navigationChildren.bind(settingsRegistry);
/** Every registered setting definition. */
export const settingsDefinitions = settingsRegistry.definitions.bind(settingsRegistry);
/** Subscribe to catalog registration changes. */
export const subscribeSettingsCatalog = settingsRegistry.subscribe;

/** Resolve host setting keys with t(), and compressed Extension keys with tRaw(). */
export function settingText(value: SettingText): string {
  if (typeof value === "string") {
    return value.startsWith("extension::") ? tRaw(value) : t(value as MessageKey);
  }
  return tRaw(value.key, value.params);
}

/** English catalog text for host keys, used as a secondary search alias. */
function englishSettingText(value: SettingText): string | undefined {
  return typeof value === "string" && !value.startsWith("extension::")
    ? CATALOGS.en[value as MessageKey]
    : undefined;
}

/** One translated string and, in Chinese mode, its English catalog alias. */
interface SettingsSearchText {
  text: string;
  english?: string;
}

/** Resolve one schema text into the strings settings search compares. */
function searchTextOf(value: SettingText): SettingsSearchText {
  const text = settingText(value);
  const english = englishSettingText(value);
  return english !== undefined && english !== text ? { text, english } : { text };
}

/**
 * Text a setting's control shows: the committed value, the value Reset restores,
 * the percentage or unit readout, and every selectable dropdown option.
 *
 * Range bounds are deliberately not expanded into every step. A single port
 * range would add tens of thousands of aliases and make a short numeric query
 * match most of the catalog.
 */
function settingValueSearchText(definition: SettingDefinition): SettingsSearchText[] {
  const entries: SettingsSearchText[] = [];
  const seen = new Set<string>();
  /** Add one visible string once. */
  const add = (text: string, english?: string): void => {
    const trimmed = text.trim();
    if (!trimmed || seen.has(trimmed)) {
      return;
    }
    seen.add(trimmed);
    entries.push(
      english !== undefined && english !== trimmed ? { text: trimmed, english } : { text: trimmed },
    );
  };
  /** Add a stored or default scalar value. */
  const addValue = (value: unknown): void => {
    if (typeof value === "string" || typeof value === "number") {
      add(String(value));
    }
  };
  const current = values.byId.has(definition.key)
    ? values.byId.get<unknown>(definition.key)
    : definition.default;
  addValue(current);
  addValue(definition.default);

  if (definition.control === "range" || definition.control === "number") {
    const value = typeof current === "number" ? current : Number(current);
    if (Number.isFinite(value)) {
      if (definition.control === "range") {
        // Keep the slider readout in step with `SettingControl` and `SliderField`.
        const percentage =
          definition.percentage ??
          (definition.min === 0 && (definition.max === 1 || definition.max === 100));
        if (percentage) {
          add(`${Math.round(value * (definition.max === 100 ? 1 : 100))}%`);
        } else if (definition.unit) {
          add(`${value} ${settingText(definition.unit)}`);
        }
      } else if (definition.unit) {
        add(`${value} ${settingText(definition.unit)}`);
      }
    }
  } else if (definition.control === "select") {
    for (const option of definition.options) {
      const label = searchTextOf(option.label);
      add(label.text, label.english);
      add(option.value);
    }
  }
  return entries;
}

/** Extra visible strings contributed by one settings page for the search box. */
export function settingsPageSearchText(key: string): string[] {
  return [...(settingsPageFor(key)?.searchText?.() ?? [])];
}

/** Resolve a navigation key to its first page, or the key itself when it is a page. */
export function settingsNavigationTarget(key: string): string {
  const navigation = settingsRegistry.navigations().find((entry) => entry.key === key);
  if (!navigation) {
    return key;
  }
  return settingsRegistry.navigationChildren(key)[0]?.key ?? navigation.key;
}

/** Walk a navigation list from a key to its root, root first. */
export function navigationPathFrom(
  entries: readonly SettingsNavigation[],
  key: string,
): SettingsNavigation[] {
  const path: SettingsNavigation[] = [];
  let current = entries.find((entry) => entry.key === key);
  while (current) {
    path.unshift(current);
    current = current.parent ? entries.find((entry) => entry.key === current?.parent) : undefined;
  }
  return path;
}

/** The root-first path from the registry for one navigation key. */
export function settingsNavigationPath(key: string): SettingsNavigation[] {
  return navigationPathFrom(settingsRegistry.navigations(), key);
}

/** One translated breadcrumb segment for a search result. */
export interface SettingsSearchPathEntry {
  key: string;
  text: string;
}

/** Build one flat, translated path for a schema row shown by settings search. */
export function settingsSearchPath(definition: SettingDefinition): SettingsSearchPathEntry[] {
  const candidates = [
    ...settingsNavigationPath(definition.navigation).map((entry) => ({
      key: entry.key,
      text: settingText(entry.label),
    })),
    {
      key: `group:${definition.navigation}:${definition.group}`,
      text: settingText(definition.group),
    },
    // The row itself renders its label and description, so the breadcrumb ends
    // at the group.
  ];
  const path: SettingsSearchPathEntry[] = [];
  for (const candidate of candidates) {
    const text = candidate.text.trim();
    if (!text || path.at(-1)?.text === text) {
      continue;
    }
    path.push({ key: candidate.key, text });
  }
  return path;
}

/** The schema rows that belong to one navigation page. */
export function settingsFields(navigation: string): SettingDefinition[] {
  return settingsRegistry
    .definitions()
    .filter((definition) => definition.navigation === navigation);
}

/** Search the translated text and control values visible to the user. */
export function searchSettings(query: unknown): SettingDefinition[] {
  const text = String(query ?? "");
  const definitions = settingsRegistry.definitions();
  if (!text.trim()) {
    return [...definitions];
  }
  const navigations = settingsRegistry.navigations();
  return definitions.filter((definition) => {
    const navigation = navigations.find((entry) => entry.key === definition.navigation);
    const parent = navigation?.parent
      ? navigations.find((entry) => entry.key === navigation.parent)
      : undefined;
    const fields: SettingsSearchText[] = [
      searchTextOf(definition.label),
      ...(definition.description ? [searchTextOf(definition.description)] : []),
      searchTextOf(definition.group),
      ...(navigation ? [searchTextOf(navigation.label)] : []),
      ...(parent ? [searchTextOf(parent.label)] : []),
      ...settingValueSearchText(definition),
    ];
    return fields.some(({ text: value, english }) => matchesSettingsSearch(value, text, english));
  });
}

/** Rows with the same group key share one translated heading. */
export function groupedSettings(
  definitions: readonly SettingDefinition[],
): { id: string; title: SettingDefinition["group"]; entries: SettingDefinition[] }[] {
  const groups = new Map<SettingDefinition["group"], SettingDefinition[]>();
  for (const definition of definitions) {
    let group = groups.get(definition.group);
    if (group === undefined) {
      group = [];
      groups.set(definition.group, group);
    }
    group.push(definition);
  }
  return [...groups].map(([id, entries]) => ({ id, title: id, entries }));
}
