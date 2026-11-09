/**
 * Developer actions and their shortcuts.
 *
 * They are filed under the developer category and become available when the
 * desktop host enables developer mode or the settings page's logo gesture has
 * revealed the developer section. The application menu has no Developer
 * section; the shortcut registry and the Developer settings page are the entry
 * points. The performance monitor is the exception: its F3 shortcut remains
 * available in release hosts.
 */
import { toolbar } from "../../../../core/shell/registries/toolbar.ts";
import {
  developerMode,
  requestDevtoolsToggle,
} from "../../../../core/platform/desktop/developer.ts";
import { isDeveloperRevealed } from "../../../../core/state/developerReveal.ts";
import { SHORTCUT_CATEGORIES } from "../../../../core/shortcuts/categories.ts";
import { togglePerformanceHud } from "../../../overlays/performance/performanceHud.ts";

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
] as const;

/**
 * The performance monitor is a frontend surface, so its F3 shortcut stays
 * available even in a release host. The menu still hides the developer section;
 * only the monitor can be toggled by a key that the user already knows.
 */
const ALWAYS_AVAILABLE_ACTIONS: ReadonlySet<string> = new Set(["developer.performanceHud"]);
/** Whether the action is listed in the developer menu for the current host policy. */
const developerVisible = (id: string): boolean =>
  ALWAYS_AVAILABLE_ACTIONS.has(id) || developerMode.get() || isDeveloperRevealed();

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
      visible: () => developerVisible(definition.id),
      // Visibility hides this surface until the host or the logo gesture opens
      // it. The action carries the real behavior, so a context-menu click and a
      // shortcut take the same path.
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
