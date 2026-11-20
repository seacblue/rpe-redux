/**
 * Decides when a settings row offers its reset affordance.
 *
 * Provenance and value equality are independent: a user can edit a value back
 * to its default and still need the reset action to clear that history, and a
 * programmatic write can move a value away from its default without a user
 * commit. The row shows the action for either case.
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
export function settingShowsReset(
  field: SettingDefinition,
  current: SettingValue,
  modified: boolean,
): boolean {
  if (field.default === undefined || field.control === "action") {
    return false;
  }
  return modified || settingDiffers(field, current);
}
