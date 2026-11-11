/**
 * Registers the shell's shared built-in contributions.
 *
 * Topbar actions and their shortcuts are registered as one batch; the returned
 * disposer removes them all. Editor toolbar rows register with the editor mode,
 * so this file only wires shared actions and host handles.
 */
import { registerFileActions } from "./actions/fileActions.ts";
import { registerEditActions } from "./actions/editActions.ts";
import { registerWorkspaceActions } from "./actions/workspaceActions.ts";
import { registerViewActions } from "./actions/viewActions.ts";
import { registerToolsActions } from "./actions/toolsActions.ts";
import { toolbar } from "../../../core/shell/registries/toolbar.ts";
import { registerToolbarShortcuts } from "../../../core/shell/registries/toolbarShortcuts.ts";
import { registerTransportControls } from "../transport/register.ts";
import { registerDeveloperActions } from "./actions/developerActions.ts";
import { registerHelpActions } from "./actions/helpActions.ts";
import { registerFileSettingsActions } from "../../screens/settings/files/fileSettingsActions.ts";
import { connectSettingsOpen } from "../../../core/api/settings.ts";
import { connectHelpApi } from "../../../core/api/help.ts";
import { openSettings } from "../../screens/settings/settingsWindowController.ts";
import { openChangelog } from "../../screens/settings/updates/changelog.ts";
import { openOnboardingGuide } from "../../overlays/help/onboardingGuide.ts";

/** Registers shared built-in actions, shortcuts, and host API handles; returns their disposer. */
export function registerBuiltins(): () => void {
  const remove = [
    connectSettingsOpen((page) => openSettings(page)),
    connectHelpApi({
      changelog: () => openChangelog(),
      guide: () => openOnboardingGuide(),
    }),
    ...registerFileActions(),
    ...registerEditActions(),
    ...registerWorkspaceActions(),
    ...registerViewActions(),
    ...registerToolsActions(),
    ...registerHelpActions(),
    ...registerFileSettingsActions(),
    registerDeveloperActions(),
    registerTransportControls(),
    // Each action's own `run` becomes its rebindable shortcut.
    registerToolbarShortcuts(toolbar.getSnapshot()),
  ];
  return () => remove.forEach((dispose) => dispose());
}
