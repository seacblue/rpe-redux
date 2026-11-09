/**
 * Theme selection on General → Interface.
 *
 * Built-in themes and installed packages share one list, and the chosen package
 * is persisted through the shared theme preference. A package carries its
 * palette, glyphs, and chrome recipe together, so selecting one swaps the whole
 * visual system rather than a set of colours.
 */
import { useSyncExternalStore } from "react";
import type { Theme } from "../../../../core/theme/themes.ts";
import { getThemes } from "../../../../core/theme/themes.ts";
import {
  activeTheme,
  setActiveTheme,
  subscribeActiveTheme,
} from "../../../../core/theme/activeTheme.ts";
import { getThemePackage } from "../../../../core/theme/registry.ts";
import { PREFERENCE_SECTIONS, writePreference } from "../../../../core/state/preferences.ts";
import { Select } from "../../../../design/components/select/Select.tsx";
import { useTranslation } from "../../../../i18n/react.ts";
import { registerSettingControl, type SettingControlProps } from "../settingsContributions.ts";
import { packageName } from "../../../../core/utils/packageName.ts";

/** Theme picker with the active package's display name. */
export function ThemeControl({ field }: SettingControlProps) {
  const { t, language } = useTranslation();
  const theme = useSyncExternalStore(subscribeActiveTheme, activeTheme, activeTheme);
  /** Label a theme option with its package source when it is not built in. */
  const themeLabel = (option: ReturnType<typeof getThemes>[number]) => {
    const name = packageName(option.name, language);
    const pkg = getThemePackage(option.id);
    const customUi = pkg
      ? Object.keys(pkg.ui?.slots ?? {}).length > 0 ||
        Object.keys(pkg.ui?.components ?? {}).length > 0
      : false;
    const source = option.source === "builtin" ? name : `${name}, ${option.source}`;
    return customUi ? `${source}, ${t("settings.theme.customUi.badge")}` : source;
  };

  return (
    <Select
      id={field.key}
      value={theme}
      onChange={(event) => {
        writePreference(PREFERENCE_SECTIONS.icons, "");
        setActiveTheme(event.target.value as Theme);
      }}
    >
      {getThemes().map((option) => (
        <option key={option.id} value={option.id}>
          {themeLabel(option)}
        </option>
      ))}
    </Select>
  );
}

registerSettingControl("appearance-skin", ThemeControl);
