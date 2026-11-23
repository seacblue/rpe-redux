/**
 * The per-setting reset affordance.
 *
 * It appears when the committed value differs from the schema default. Clicking
 * writes the default through the reset path, which also clears its provenance.
 */
import { IconButton } from "../../../design/components/button/IconButton.tsx";
import { useTranslation } from "../../../i18n/react.ts";
import type { SettingDefinition, SettingValue } from "../../../core/settings/types.ts";
import { settingText } from "./settingsCatalog.ts";
import { settingShowsReset } from "./settingResetState.ts";
import { useSetting } from "./useSetting.ts";

/** Reset one setting to its schema default when its value differs. */
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
  if (!settingShowsReset(field, current)) {
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
