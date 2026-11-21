/**
 * Developer actions and their shortcuts.
 *
 * They are filed under the developer category and become available when the
 * desktop host enables developer mode or the settings page's logo gesture has
 * revealed the developer section. The application menu has no Developer
 * section; the shortcut registry and the Developer settings page are the entry
 * points, and a shortcut is only dispatched while the host or the gesture has
 * opened that section.
 */
import { toolbar } from "../../../../core/shell/registries/toolbar.ts";
import {
  developerMode,
  requestDevtoolsToggle,
} from "../../../../core/platform/desktop/developer.ts";
import { isDeveloperRevealed } from "../../../../core/state/developerReveal.ts";
import { SHORTCUT_CATEGORIES } from "../../../../core/shortcuts/categories.ts";
import { togglePerformanceHud } from "../../../overlays/performance/performanceHud.ts";
import { toggleDevDetectorPanel } from "../../../overlays/devDetector/devDetector.ts";

const DEVELOPER_ACTIONS = [
  {
    id: "developer.devtools",
    label: "chrome.developer.devtools",
    icon: "keyboard",
    shortcuts: [{ key: "F12" }],
    run: () => requestDevtoolsToggle(),
  },
  {
    id: "developer.performanceHud",
    label: "chrome.developer.performanceHud",
    icon: "monitor",
    shortcuts: [{ key: "F3" }],
    run: togglePerformanceHud,
  },
  {
    id: "developer.detector",
    label: "chrome.developer.detector",
    icon: "monitor",
    shortcuts: [{ key: "F4" }],
    run: toggleDevDetectorPanel,
  },
] as const;

/**
 * Whether the developer section is open for the current host policy.
 *
 * The shortcut bridge turns this same rule into the action's `enabled` state, so
 * `F3` reaches the performance monitor only while the host has enabled developer
 * mode or the About-page gesture has revealed the section. A release host is
 * therefore silent until one of those opens it, and the key stops answering
 * again when the gesture closes the section.
 */
const developerVisible = (): boolean => developerMode.get() || isDeveloperRevealed();

/** Registers the developer actions; returns a disposer for all of them. */
export function registerDeveloperActions(): () => void {
  const toolbarDisposers = DEVELOPER_ACTIONS.map((definition, order) =>
    toolbar.register({
      kind: "action",
      id: definition.id,
      group: "developer",
      order: 300 + order,
      label: definition.label,
      tooltip: definition.label,
      icon: definition.icon,
      shortcuts: definition.shortcuts,
      shortcutCategory: SHORTCUT_CATEGORIES.developer,
      shortcutScope: "instrument",
      toolbar: false,
      visible: developerVisible,
      // Visibility hides this surface until the host or the logo gesture opens
      // it, and it is also what makes the key answer: the shortcut bridge reads
      // `actionAvailable`, which is this predicate plus the runner. The action
      // carries the real behavior, so a context-menu click and a shortcut take
      // the same path.
      enabled: () => true,
      run: definition.run,
    }),
  );
  return () => {
    for (const dispose of toolbarDisposers) {
      dispose();
    }
  };
}
