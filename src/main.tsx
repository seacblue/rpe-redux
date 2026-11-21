/**
 * Browser entry point. Applies the initial language/theme, installs the small
 * startup shell, and mounts the single React root. The editor and the Extension
 * pipeline arrive as separate chunks after the startup screen paints.
 */
import { waitForBootStyles } from "./frontend/screens/startup/bootSplash.ts";
import { BootSplashHandoff } from "./frontend/screens/startup/BootSplashHandoff.tsx";
import { createRoot } from "react-dom/client";
import { App } from "./frontend/app/App.tsx";
import { detectLanguage, setLanguage } from "./i18n/index.ts";
import { PREFERENCE_SECTIONS, readPreference } from "./core/state/preferences.ts";
import { DEFAULT_THEME, type Theme } from "./core/theme/themes.ts";
import { applyTheme } from "./core/theme/applyTheme.ts";

import { installInteractionPolicy } from "./frontend/app/interactionPolicy.ts";
import { installDocumentTitle } from "./frontend/chrome/topbar/windowControls/windowTitle.ts";
import { initializeDeveloperMode } from "./core/platform/desktop/developer.ts";
import { hostKind } from "./core/platform/environment.ts";
import { isPerformanceHudWindow } from "./core/platform/desktop/performanceHudWindow.ts";
import { setBootRoute } from "./frontend/contracts/appRoute.ts";
import { initializeBootRoute } from "./frontend/app/routing/bootRoute.ts";
import { initializeLocationRoute } from "./frontend/app/routing/routeLocation.ts";
import { syncNativeWindowTheme } from "./frontend/platform/desktop/windowTheme.ts";
import { registerModalHost } from "./design/components/modal/Modal.tsx";
import { PortalHostProvider } from "./design/patterns/portalHost.tsx";
import { setLongTaskBootState } from "./core/state/longTasks.ts";
import { registerFloatingHost } from "./frontend/overlays/floatingHost.ts";
import { installFrontendDiagnosticCapture } from "./frontend/platform/diagnosticCapture.ts";
import { initializeDevDetectorRuntime } from "./frontend/platform/devDetectorRuntime.ts";

// Keep background operations behind the workspace boot barrier. The barrier is
// opened only after the editor assembly has published a usable workspace.
installFrontendDiagnosticCapture();
setLongTaskBootState("loading");
// Host-scoped chrome and settings read this before the first frame.
document.documentElement.dataset.host = hostKind();

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
registerFloatingHost(container);

if (isPerformanceHudWindow()) {
  // The detached HUD shares this HTML, so it also starts under the inline
  // splash. Wait for the deferred stylesheet and register the product-page
  // catalogs it reads, then hand off in the same commit.
  void Promise.all([
    waitForBootStyles(),
    import("./frontend/overlays/performance/PerformanceHudWindow.tsx"),
    import("./i18n/deferred.ts"),
  ]).then(([, module, catalogs]) => {
    catalogs.registerDeferredCatalogs();
    const PerformanceHud = module.PerformanceHudWindow;
    createRoot(container).render(
      <>
        <BootSplashHandoff />
        <PerformanceHud />
      </>,
    );
  });
} else {
  installDocumentTitle();
  installInteractionPolicy();
  void initializeDeveloperMode();
  // The runtime subscribes to the host policy and the detector switch, so a
  // late developer-mode answer starts capture without another call here.
  initializeDevDetectorRuntime();
  const renderApp = () =>
    createRoot(container).render(
      <PortalHostProvider host={container}>
        <BootSplashHandoff />
        <App />
      </PortalHostProvider>,
    );
  // A desktop chart link has to become the boot route before the editor
  // assembly decides whether to restore the last session. The web build also
  // deferred its application stylesheet so the inline splash could paint; wait
  // for that sheet before mounting React, then let the boot hand-off switch it
  // on and remove the splash in the same commit.
  const bootRoute = initializeBootRoute().catch((error: unknown) => {
    console.warn("Unable to resolve the boot route", error);
    return initializeLocationRoute();
  });
  void Promise.all([bootRoute, waitForBootStyles()]).then(([route]) => {
    setBootRoute(route);
    renderApp();
  });
}
