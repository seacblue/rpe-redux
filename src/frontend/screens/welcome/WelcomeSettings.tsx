/**
 * The home screen's settings entry point.
 *
 * It sits in the page header and uses the same action id and tooltip lookup as
 * the toolbar's settings action, while keeping the start screen independent of
 * the toolbar frame.
 */
import { IconButton } from "../../../design/components/button/IconButton.tsx";
import { useTranslation } from "../../../i18n/react.ts";
import { openSettings } from "../settings/settingsWindowController.ts";

/** Header button that opens the settings window from the home screen. */
export function WelcomeSettings() {
  const { t } = useTranslation();
  const label = t("workspace.welcome.settings");
  return (
    <IconButton
      icon="settings"
      label={label}
      className="redux-welcome-settings"
      data-tip-action="workspace.settings"
      onClick={() => openSettings()}
    />
  );
}
