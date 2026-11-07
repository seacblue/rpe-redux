/**
 * Browser entry point. Installs the plugin facade and host bridges, resolves the
 * initial theme/language preferences, and mounts the single React root.
 */
import { installLoadingPaint } from "./frontend/screens/editor/workspace/document/loading/loadingPaint.ts";
import { createRoot } from "react-dom/client";
import { App } from "./frontend/app/App.tsx";
import { installReduxApi, redux } from "./core/api/index.ts";
import { connectExtensionApi } from "./core/extensions/extensionApi.ts";
import { detectLanguage, setLanguage } from "./i18n/index.ts";
import { PREFERENCE_SECTIONS, readPreference } from "./core/state/preferences.ts";
import { DEFAULT_THEME, type Theme } from "./core/theme/themes.ts";
import { applyTheme } from "./core/theme/applyTheme.ts";

import { installInteractionPolicy } from "./frontend/app/interactionPolicy.ts";
import { installDocumentTitle } from "./frontend/chrome/topbar/windowControls/windowTitle.ts";
import { initializeDeveloperMode } from "./core/platform/desktop/developer.ts";
import { installExtensionStyleHost } from "./frontend/platform/extensionStyleHost.ts";
import { installExtensionThemeTokens } from "./frontend/platform/extensionThemeTokens.ts";
import { installScriptUiHost } from "./frontend/platform/ScriptUiHost.tsx";
import { installExtensionRecovery } from "./frontend/platform/extensionShortcutBridge.ts";
import { installExtensionUiHost } from "./frontend/platform/extensionUiHost.ts";
import { installCodeCellBridge } from "./frontend/platform/codeCellBridge.ts";
import { codeCellRuntime, installCodeCellApi } from "./core/codecell/runtime.ts";
import { connectCodeCellGuide } from "./core/edit/codecell/guide.ts";
import codeCellGuide from "../sdk/llm-guide.md?raw";
import { createExtensionSandbox } from "./frontend/platform/extensionSandbox.tsx";
import { extensionRuntime } from "./core/extensions/extensionRuntime.ts";
import { isDesktop } from "./core/platform/environment.ts";
import { invoke } from "@tauri-apps/api/core";
import { isPerformanceHudWindow } from "./core/platform/desktop/performanceHudWindow.ts";
import { PerformanceHudWindow } from "./frontend/overlays/performance/PerformanceHudWindow.tsx";
import { syncNativeWindowTheme } from "./frontend/platform/desktop/windowTheme.ts";
import { registerModalHost } from "./design/components/modal/Modal.tsx";

/**
 * Pick the language before the first paint.
 *
 * The stored choice wins; with no stored choice the machine's own preference
 * decides, and a machine that asks for neither English nor Chinese gets English.
 * `setLanguage` also writes `<html lang>`, which is why this runs before React
 * mounts rather than inside a component: the first frame should never flash the
 * wrong language, and a font that keys off `lang` should never swap.
 */
setLanguage(readPreference<string | null>(PREFERENCE_SECTIONS.language, null) ?? detectLanguage());
const initialTheme = readPreference<Theme>(PREFERENCE_SECTIONS.appearance, DEFAULT_THEME);
applyTheme(initialTheme);
syncNativeWindowTheme(initialTheme);
const container = document.getElementById("root");
if (!container) {
  throw new Error("index.html is missing .redux-app-root");
}
// Dialogs stay under the app root for the design-scoped native controls while
// becoming siblings of the shell, so a nested dialog is not trapped in the
// opening window's stacking context.
registerModalHost(container);

if (isPerformanceHudWindow()) {
  createRoot(container).render(<PerformanceHudWindow />);
} else {
  installDocumentTitle();
  installReduxApi();
  installCodeCellApi(window);
  connectExtensionApi(redux);
  installExtensionStyleHost();
  installExtensionThemeTokens();
  installScriptUiHost();
  installExtensionUiHost();
  installCodeCellBridge();
  extensionRuntime.setSandboxFactory(createExtensionSandbox);
  codeCellRuntime.setSandboxFactory(createExtensionSandbox);
  connectCodeCellGuide(codeCellGuide);
  installExtensionRecovery();
  if (isDesktop()) {
    const heartbeat = globalThis.setInterval(() => {
      void invoke("extension_watchdog_heartbeat", {
        active: document.visibilityState === "visible" && extensionRuntime.list().length > 0,
      }).catch(() => undefined);
    }, 2000);
    window.addEventListener("beforeunload", () => globalThis.clearInterval(heartbeat), {
      once: true,
    });
  }
  installLoadingPaint();
  installInteractionPolicy();
  void initializeDeveloperMode();
  createRoot(container).render(<App />);
}
