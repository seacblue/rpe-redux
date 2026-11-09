/**
 * Help-page action that starts the current settings panel's guided tutorial.
 *
 * The settings row resolves the action through the toolbar registry. Closing
 * settings first lets the anchored coach card point at the editor shell.
 */
import { toolbar } from "../../../../core/shell/registries/toolbar.ts";
import { openOnboardingGuide } from "../../../overlays/help/onboardingGuide.ts";
import { closeSettings } from "../settingsWindowController.ts";

const dispose = toolbar.register({
  kind: "action",
  id: "help.onboarding",
  group: "settings",
  order: 60,
  icon: "help",
  label: "settings.field.onboarding-guide.label",
  tooltip: "settings.field.onboarding-guide.label",
  toolbar: false,
  run: () => {
    closeSettings();
    requestAnimationFrame(() => openOnboardingGuide());
  },
});

if (import.meta.hot) {
  import.meta.hot.dispose(dispose);
}
