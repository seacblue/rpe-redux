/**
 * Frontend contribution points for settings content that is not a schema row.
 *
 * The core settings registry describes values and their labels. A few rows need
 * a bespoke control, some groups need column headings above their rows, and a
 * few categories are whole pages instead of rows. Those are visual facts, so
 * the frontend owns them here: a feature registers its control, column heading,
 * or page next to the component that draws it, and the settings window asks this
 * registry instead of carrying a switch over built-in keys.
 */
import type { ComponentType } from "react";
import type { MessageKey } from "../../../i18n/index.ts";
import type { SettingDefinition } from "../../../core/settings/types.ts";
import type { Theme } from "../../../core/theme/themes.ts";

/** Props passed to a custom control registered for one setting key. */
export interface SettingControlProps {
  readonly field: SettingDefinition;
}

/** Props passed to a registered category page. */
export interface SettingsPageContext {
  readonly theme: Theme;
  readonly setTheme: (theme: Theme) => void;
  readonly openCategory: (key: string) => void;
  /** True while this page owns the visible section; pages can defer work until then. */
  readonly active: boolean;
  /** The active settings search text, or an empty string outside search. */
  readonly query: string;
}

/** A category page that replaces the schema rows as the page body. */
export interface SettingsPageDefinition {
  /** Words that make this page reachable from the settings search box. */
  readonly keywords?: MessageKey;
  /**
   * Extra visible strings the page owns, such as its current control values.
   * The page returns text already translated for the active language.
   */
  readonly searchText?: () => readonly string[];
  /** Pages that paint their own heading can omit the generic page title. */
  readonly hideTitle?: boolean;
  readonly component: ComponentType<SettingsPageContext>;
}

const controls = new Map<string, ComponentType<SettingControlProps>>();
const groupColumns = new Map<string, ComponentType>();
const pages = new Map<string, SettingsPageDefinition>();

/** Register the control for one `control: "custom"` setting key. */
export function registerSettingControl(
  key: string,
  component: ComponentType<SettingControlProps>,
): () => void {
  controls.set(key, component);
  return () => {
    if (controls.get(key) === component) {
      controls.delete(key);
    }
  };
}

/**
 * Register column headings for one group key.
 *
 * `SettingsFields` renders the component after the group heading and before the
 * first row. The component draws its own empty leading column plus the control
 * column, matching the field row grid so headings sit over their controls.
 */
export function registerSettingGroupColumns(group: string, component: ComponentType): () => void {
  groupColumns.set(group, component);
  return () => {
    if (groupColumns.get(group) === component) {
      groupColumns.delete(group);
    }
  };
}

/** Register a category page that replaces schema rows as the page body. */
export function registerSettingsPage(key: string, page: SettingsPageDefinition): () => void {
  pages.set(key, page);
  return () => {
    if (pages.get(key) === page) {
      pages.delete(key);
    }
  };
}

/** The custom control registered for a setting key, or null. */
export function settingControlFor(key: string): ComponentType<SettingControlProps> | null {
  return controls.get(key) ?? null;
}

/** The column-heading component registered for a group key, or null. */
export function settingGroupColumnsFor(group: string): ComponentType | null {
  return groupColumns.get(group) ?? null;
}

/** The page registered for a category key, or null. */
export function settingsPageFor(key: string): SettingsPageDefinition | null {
  return pages.get(key) ?? null;
}
