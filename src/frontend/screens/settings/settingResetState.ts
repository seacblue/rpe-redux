/**
 * Decides when a settings row offers its reset affordance.
 *
 * The reset action follows the value shown by the control. A value that is
 * already equal to its default needs no reset, regardless of how it got there.
 */
import type { SettingDefinition, SettingValue } from "../../../core/settings/types.ts";

/** Whether the committed value differs from the schema default under its control's comparison. */
export function settingDiffers(field: SettingDefinition, current: SettingValue): boolean {
  const fallback = field.default;
  if (fallback === undefined) {
    return false;
  }
  if (field.control === "toggle") {
    return current !== fallback;
  }
  const currentText = String(current);
  const fallbackText = String(fallback);
  if (currentText === fallbackText) {
    return false;
  }
  if (field.control === "number" || field.control === "range") {
    const value = Number(current);
    const defaultValue = Number(fallback);
    if (Number.isFinite(value) && Number.isFinite(defaultValue)) {
      return value !== defaultValue;
    }
  }
  if (field.control === "color") {
    return currentText.trim().toUpperCase() !== fallbackText.trim().toUpperCase();
  }
  return true;
}

/** Whether one row should render the reset action. */
export function settingShowsReset(field: SettingDefinition, current: SettingValue): boolean {
  if (field.default === undefined || field.control === "action") {
    return false;
  }
  return settingDiffers(field, current);
}
