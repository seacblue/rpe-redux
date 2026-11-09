/**
 * Developer actions and their shortcuts.
 *
 * They are filed under the developer category and become available when the
 * desktop host enables developer mode or the settings page's logo gesture has
 * revealed the developer section. The application menu has no Developer
 * section; these shortcuts and the Developer settings buttons are the entry
 * points. The performance monitor is the exception: its F3 shortcut remains
 * available in release hosts.
 */
import { invoke } from "@tauri-apps/api/core";
import { toolbar } from "../../../../core/shell/registries/toolbar.ts";
import {
  developerMode,
  requestDevtoolsToggle,
} from "../../../../core/platform/desktop/developer.ts";
import { isDeveloperRevealed } from "../../../../core/state/developerReveal.ts";
import { isDesktop } from "../../../../core/platform/environment.ts";
import { tearOffPerformanceHud } from "../../../../core/platform/desktop/performanceHudWindow.ts";
import { SHORTCUT_CATEGORIES } from "../../../../core/shortcuts/categories.ts";
import {
  isPerformanceHudEnabled,
  performanceHudPosition,
  setPerformanceHudDetached,
  togglePerformanceHud,
} from "../../../overlays/performance/performanceHud.ts";
import { openDiagnosticLogs } from "../../../platform/diagnosticLog.ts";
import {
  copyDeveloperReport,
  copyDiagnostics,
  copySelection,
  showDiagnostics,
  toggleDeveloperProbe,
} from "../developer/DeveloperToolsOverlay.tsx";

/** Open the application data directory in the desktop shell. */
function openAppDataFolder(): void {
  if (!isDesktop()) {
    return;
  }
  void invoke("open_app_data_folder").catch(() => undefined);
}

/** Reload the WebView so a source change can be picked up without restarting. */
function reloadInterface(): void {
  window.location.reload();
}

/** Show the monitor before tearing it off into its always-on-top window. */
function detachPerformanceHud(): void {
  if (!isDesktop()) {
    return;
  }
  if (!isPerformanceHudEnabled()) {
    togglePerformanceHud();
  }
  setPerformanceHudDetached(true);
  void tearOffPerformanceHud(performanceHudPosition.get()).catch(() => {
    setPerformanceHudDetached(false);
  });
}

const DEVELOPER_ACTIONS = [
  {
    id: "developer.devtools",
    label: "chrome.developer.devtools",
    tooltip: "chrome.developer.devtoolsHint",
    icon: "keyboard",
    shortcuts: [{ key: "F12" }],
    run: () => requestDevtoolsToggle(),
  },
  {
    id: "developer.probe",
    label: "chrome.developer.probe",
    icon: "select",
    shortcuts: [{ key: "P", modifiers: ["CTRL", "SHIFT"] }],
    run: toggleDeveloperProbe,
  },
  {
    id: "developer.copySelection",
    label: "chrome.developer.copySelection",
    icon: "clipboard",
    shortcuts: [{ key: "A", modifiers: ["CTRL", "SHIFT"] }],
    run: copySelection,
  },
  {
    id: "developer.copyReport",
    label: "chrome.developer.copyReport",
    icon: "copy",
    shortcuts: [{ key: "X", modifiers: ["CTRL", "SHIFT"] }],
    run: copyDeveloperReport,
  },
  {
    id: "developer.performanceHud",
    label: "chrome.developer.performanceHud",
    icon: "monitor",
    shortcuts: [{ key: "F3" }],
    run: togglePerformanceHud,
  },
  {
    id: "developer.detachPerformanceHud",
    label: "chrome.developer.detachPerformanceHud",
    icon: "external",
    shortcuts: [],
    run: detachPerformanceHud,
  },
  {
    id: "developer.showDiagnostics",
    label: "chrome.developer.showDiagnostics",
    icon: "info",
    shortcuts: [],
    run: showDiagnostics,
  },
  {
    id: "developer.copyDiagnostics",
    label: "chrome.developer.copyDiagnostics",
    icon: "copy",
    shortcuts: [],
    run: copyDiagnostics,
  },
  {
    id: "developer.openAppData",
    label: "chrome.developer.openAppData",
    icon: "open",
    shortcuts: [],
    run: openAppDataFolder,
  },
  {
    id: "developer.openLogs",
    label: "chrome.developer.openLogs",
    icon: "external",
    shortcuts: [],
    run: () => {
      void openDiagnosticLogs();
    },
  },
  {
    id: "developer.reload",
    label: "chrome.developer.reload",
    icon: "refresh",
    shortcuts: [],
    run: reloadInterface,
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
