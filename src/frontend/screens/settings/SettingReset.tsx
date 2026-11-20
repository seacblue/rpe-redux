/**
 * The per-setting reset affordance.
 *
 * It appears when the committed value differs from the schema default or when
 * the user has explicitly committed the setting, so a value they edited back to
 * its default can still be cleared. Clicking writes the default through the
 * reset path, which also clears that provenance.
 */
import { IconButton } from "../../../design/components/button/IconButton.tsx";
import { useTranslation } from "../../../i18n/react.ts";
import type { SettingDefinition, SettingValue } from "../../../core/settings/types.ts";
import { settingText } from "./settingsCatalog.ts";
import { settingShowsReset } from "./settingResetState.ts";
import { useSetting, useSettingModified } from "./useSetting.ts";

/** Reset one setting to its schema default; hidden when neither condition applies. */
export function SettingReset({
  field,
  onReset,
  disabled = false,
}: {
  field: SettingDefinition;
  onReset(field: SettingDefinition): void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const fallback = field.default;
  const current = useSetting<SettingValue>(field.key, fallback ?? "");
  const modified = useSettingModified(field.key);
  if (!settingShowsReset(field, current, modified)) {
    return null;
  }
  const name = settingText(field.label);
  return (
    <IconButton
      icon="undo"
      size={16}
      variant="ghost"
      className="redux-setting-reset"
      label={t("settings.reset.label", { name })}
      title={t("settings.reset.tooltip")}
      disabled={disabled}
      onClick={() => onReset(field)}
    />
  );
}
