/**
 * Product entry for the React shell: starts the owned backend and local service,
 * applies theme preferences, installs design-system hosts and editor surface
 * providers, and gates the shell behind startup readiness.
 */
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { Shell } from "./Shell.tsx";
import { EditorBackdrop } from "./EditorBackdrop.tsx";
import { useTooltipHost, setShortcutLookup } from "../../design/patterns/TooltipHost.tsx";
import { ControlHost } from "../../design/controls/ControlHost.tsx";
import { SettingsWindow } from "../screens/settings/SettingsWindow.tsx";
import { openSettings } from "../screens/settings/settingsWindowController.ts";
import { initializeUpdates } from "../screens/settings/updates/updateStore.ts";
import { preferences } from "../../core/state/preferences.ts";
import { values } from "../../core/state/values.ts";
import { setLongTaskBootState } from "../../core/state/longTasks.ts";

import { DEFAULT_THEME } from "../../core/theme/themes.ts";
import { activeTheme, setActiveTheme, subscribeActiveTheme } from "../../core/theme/activeTheme.ts";
import { applyTheme } from "../../core/theme/applyTheme.ts";
import { getThemePackage, replaceDiscoveredThemes } from "../../core/theme/registry.ts";
import { listExternalThemePackages } from "../../core/platform/desktop/themePackages.ts";
import { refreshExternalNoteSkins } from "../../core/platform/desktop/noteSkinPackages.ts";
import { loadPackagedExtensions, refreshPackagedExtensions } from "../platform/extensionLoader.ts";
import { syncNativeWindowTheme } from "../platform/desktop/windowTheme.ts";
import { localService } from "../../core/global/library/service.ts";
import { createDesktopPreferenceClient } from "../platform/preferencesClient.ts";
import {
  adoptRuntimePortSettings,
  initializeRuntimePorts,
} from "../platform/desktop/runtimePorts.ts";
import { NOTE_SKIN_EVENT, installNoteSkinBridge } from "../platform/noteSkinBridge.ts";
import { prepareBackendInstance, startBackend } from "../../core/platform/desktop/backend.ts";
import { cleanupCustomBackgrounds } from "../platform/desktop/customBackground.ts";
import { StartupView } from "../screens/startup/StartupView.tsx";
import { StartupBoundary } from "../screens/startup/StartupBoundary.tsx";
import type { StartupFailureSource } from "../screens/startup/startupDiagnostics.ts";
import { ExperimentalWarning } from "../screens/startup/ExperimentalWarning.tsx";
import { diagnosticText } from "../platform/diagnosticLog.ts";
import { ChartLoading } from "../screens/editor/workspace/document/loading/ChartLoading.tsx";
import { RecordingHosts } from "../screens/editor/workspace/recording/RecordingHosts.tsx";
import { TimingDetectionHost } from "../screens/editor/workspace/timingDetection/TimingDetectionHost.tsx";
import { CollaborationHosts } from "../screens/editor/workspace/collaboration/CollaborationHosts.tsx";
import { ExportDialog } from "../screens/editor/workspace/document/export/ExportDialog.tsx";
import { ModalScrimPortal } from "../../design/components/modal/ModalScrimPortal.tsx";
import { ModalHost } from "../overlays/modals/ModalHost.tsx";
import { SessionPrompts } from "../overlays/SessionPrompts.tsx";
import { ToastHost } from "../../design/patterns/ToastHost.tsx";
import { ScriptGuideHost } from "../platform/ScriptGuideHost.tsx";
import { OnboardingHost } from "../onboarding/OnboardingHost.tsx";
import { ExtensionOverlays } from "../platform/ExtensionOverlays.tsx";
import { WindowControls } from "../chrome/topbar/windowControls/WindowControls.tsx";
import { isDesktop } from "../../core/platform/environment.ts";
import "../../design/styles/index.less";
import { actionShortcuts, toolbar } from "../../core/shell/registries/toolbar.ts";
import { shortcutChips } from "../../design/components/keyboardHint/shortcutChips.ts";
import {
  getEditorVisibility,
  subscribeToEditorVisibility,
} from "../../core/edit/state/visibility.ts";
import { EditorProviderTree } from "../screens/editor/workspace/runtime/composition/EditorProviderTree.tsx";
import {
  EditorSessionProvider,
  useEditorSession,
} from "../screens/editor/workspace/runtime/providers/SessionProvider.tsx";
import {
  TimelineDomSurfaceProvider,
  createTimelineDomSurface,
} from "../screens/editor/workspace/timeline/surface/TimelineDomSurface.tsx";
import {
  PreviewSurfaceProvider,
  createPreviewSurface,
} from "../screens/editor/workspace/preview/surface/PreviewDomSurface.tsx";
import {
  InspectorSurfaceProvider,
  createInspectorSurface,
} from "../screens/editor/inspector/InspectorDomSurface.tsx";
import {
  TransportSurfaceProvider,
  createTransportSurface,
} from "../chrome/transport/TransportDomSurface.tsx";
import { useSetting } from "../screens/settings/useSetting.ts";
import { RouteRuntime } from "./routing/RouteRuntime.tsx";
import {
  applyWindowDisplaySettings,
  showDesktopWindow,
  type WindowDisplayMode,
} from "../platform/desktop/windowDisplay.ts";
import { readShortcutContext } from "../platform/shortcuts/shortcutContext.ts";

// Install the note-skin bridge at module load so the media layer can resolve
// bundled skins and announce changes before any skin is read.
installNoteSkinBridge();

/**
 * Root component: installs window controls and the startup boundary, then wraps
 * the session provider around the shell content.
 */
export function App() {
  return (
    <>
      {isDesktop() && <WindowControls />}
      <StartupBoundary>
        <EditorSessionProvider>
          <AppContent />
        </EditorSessionProvider>
      </StartupBoundary>
    </>
  );
}

/** Owns startup readiness, theme application, and the surface providers around the shell. */
function AppContent() {
  const editorSession = useEditorSession();
  const tooltip = useTooltipHost();
  const theme = useSyncExternalStore(subscribeActiveTheme, activeTheme, activeTheme);
  const setTheme = setActiveTheme;
  const editorVisibility = useSyncExternalStore(
    subscribeToEditorVisibility,
    getEditorVisibility,
    getEditorVisibility,
  );
  const [error, setError] = useState("");
  const [errorSource, setErrorSource] = useState<StartupFailureSource>("unknown");
  const [ready, setReady] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [timelineSurface] = useState(createTimelineDomSurface);
  const [previewSurface] = useState(createPreviewSurface);
  const [inspectorSurface] = useState(createInspectorSurface);
  const [transportSurface] = useState(createTransportSurface);
  const [backendReady, setBackendReady] = useState(false);
  const windowDisplayMode = useSetting<WindowDisplayMode>("window-display-mode", "windowed");
  const windowResolution = useSetting<string>("window-resolution", "auto");

  /** Tags editor construction/render failures without changing callback identity. */
  const handleEditorError = useCallback((value: string) => {
    if (value) {
      setLongTaskBootState("failed");
      setErrorSource("editor");
    }
    setError(value);
  }, []);

  /** Opens the background-task gate only after the editor is usable. */
  const handleEditorReady = useCallback((value: boolean) => {
    setReady(value);
    if (value) {
      setLongTaskBootState("ready");
    }
  }, []);

  useEffect(() => {
    applyTheme(theme);
    syncNativeWindowTheme(theme);
  }, [theme]);

  // Live folder sniffing: themes, skin folders, and Extension folders are
  // re-read on one timer, so dropping a package in place updates the UI without
  // a manual refresh. Each helper no-ops outside the desktop host.
  useEffect(() => {
    let cancelled = false;
    let themeSignature = "";
    const scan = async () => {
      const documents = await listExternalThemePackages();
      if (cancelled) {
        return;
      }
      const signature = JSON.stringify(documents);
      if (signature !== themeSignature) {
        themeSignature = signature;
        replaceDiscoveredThemes(documents);
        if (!getThemePackage(theme)) {
          setTheme(DEFAULT_THEME);
        } else {
          applyTheme(theme);
        }
      }
      void refreshPackagedExtensions();
      void refreshExternalNoteSkins();
    };
    void scan();
    const timer = window.setInterval(() => void scan(), 1500);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [theme, setTheme]);

  useEffect(() => {
    const suppressNativeMenus = (event: MouseEvent) => event.preventDefault();
    document.addEventListener("contextmenu", suppressNativeMenus, true);
    let cancelled = false;
    // The tooltip resolves live shortcut chips through this layer's toolbar
    // registry, so the lookup is installed here rather than in design.
    setShortcutLookup((actionId, shortcutId) => {
      const action = toolbar.node(actionId);
      if (action?.kind === "action") {
        return shortcutChips(actionShortcuts(action));
      }
      if (!shortcutId) {
        return [];
      }
      return shortcutChips(
        actionShortcuts({
          kind: "action",
          id: "tooltip",
          group: "editor",
          order: 0,
          label: "",
          tooltip: "",
          icon: "keyboard",
          shortcutId,
        }),
      );
    });

    // Construct the provider tree only after the owned backend is healthy.
    initializeRuntimePorts()
      .then(() => startBackend())
      .then(async () => {
        adoptRuntimePortSettings();
        await prepareBackendInstance();
        if (cancelled) {
          return;
        }
        const found = await localService({ refresh: true });
        if (found) {
          await preferences.attach(createDesktopPreferenceClient(found.library));
          // A crash between saving a replacement image and committing its
          // setting can leave an unreferenced file behind. Reconcile the
          // dedicated folder once the stored value is readable; a failed read
          // must never be mistaken for "no background is configured".
          if (preferences.status().durable) {
            const activeReference = values.byId.has("custom-background")
              ? String(values.byId.get("custom-background") ?? "")
              : "";
            void cleanupCustomBackgrounds(activeReference).catch((error: unknown) => {
              console.error("Could not clean unused settings images", error);
            });
          }
          // Extension consent is kept in durable preferences, so package
          // discovery runs only after the preference store attaches.
          await loadPackagedExtensions();
          if (!cancelled) {
            window.dispatchEvent(new Event(NOTE_SKIN_EVENT));
          }
        }
        if (cancelled) {
          return;
        }
        setBackendReady(true);
      })
      .catch((failure) => {
        if (!cancelled) {
          setLongTaskBootState("failed");
          setErrorSource("backend");
          setError(diagnosticText(failure));
        }
      });

    return () => {
      document.removeEventListener("contextmenu", suppressNativeMenus, true);
      cancelled = true;
    };
  }, [attempt]);

  // Update checks and automatic package downloads are background work. Wait
  // until the editor has crossed the startup barrier so a failed boot cannot
  // continue the update flow behind the startup report.
  useEffect(() => {
    if (ready && backendReady) {
      void initializeUpdates();
    }
  }, [backendReady, ready]);

  useEffect(() => {
    if (ready) {
      window.dispatchEvent(new Event("resize"));
    }
  }, [ready]);

  // Escape is the last-resort settings entry point. Menus, dialogs, control
  // popups, onboarding, and text fields all answer first; when none of them
  // owns the key, the home screen or editor opens Settings.
  useEffect(() => {
    if (!ready) {
      return undefined;
    }
    const onEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape" || event.isComposing || event.defaultPrevented) {
        return;
      }
      const context = readShortcutContext(event.target);
      if (
        context.modal !== "none" ||
        context.capturing ||
        context.textEntry ||
        context.surface !== null
      ) {
        return;
      }
      event.preventDefault();
      openSettings();
    };
    window.addEventListener("keydown", onEscape);
    return () => window.removeEventListener("keydown", onEscape);
  }, [ready]);

  // The native window starts hidden so the first visible frame already has its
  // restored geometry and the persisted display mode. Backend failure still
  // reveals the startup report instead of leaving a hidden process behind.
  useEffect(() => {
    if (!backendReady && !error) {
      return;
    }
    let cancelled = false;
    void applyWindowDisplaySettings(windowDisplayMode, windowResolution)
      .catch((failure) => {
        console.error("Could not apply the window display settings", failure);
      })
      .finally(() => {
        if (!cancelled) {
          void showDesktopWindow().catch((failure) => {
            console.error("Could not show the desktop window", failure);
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [backendReady, error, windowDisplayMode, windowResolution]);

  return (
    <TimelineDomSurfaceProvider surface={timelineSurface}>
      <PreviewSurfaceProvider surface={previewSurface}>
        <InspectorSurfaceProvider surface={inspectorSurface}>
          <TransportSurfaceProvider surface={transportSurface}>
            <EditorProviderTree
              session={editorSession}
              enabled={backendReady}
              resetKey={attempt}
              onReady={handleEditorReady}
              onError={handleEditorError}
            >
              <ModalScrimPortal />
              <RouteRuntime enabled={ready} />
              <div
                className="redux-app-shell"
                data-at-home={editorVisibility.atHome}
                aria-hidden={!ready}
                inert={!ready}
              >
                {!editorVisibility.atHome && <EditorBackdrop />}
                <Shell />
                <ExtensionOverlays scope="window" />
                <ModalHost />
                <SessionPrompts />
                <ScriptGuideHost />
                {ready && <OnboardingHost />}
                <ControlHost />
                <SettingsWindow theme={theme} setTheme={setTheme} />
                <ExperimentalWarning enabled={ready} />
                <ChartLoading />
                {/* The export question is about the document, not about a panel, so it
              hangs off the window frame beside the loading overlay — the other
              `workspace/document/` surface that asks about the whole document. */}
                <ExportDialog />
                <RecordingHosts />
                <TimingDetectionHost />
                <CollaborationHosts />
              </div>
              {/* The toast stack is a document-level peer of the app shell. A
                  modal scrim portals above the shell and must never clip, blur,
                  or inert the app's notices. */}
              {ready && (
                <ToastHost className={`app-toasts${editorVisibility.atHome ? " is-home" : ""}`} />
              )}
              {tooltip.element}
            </EditorProviderTree>
            {!ready && (
              <StartupView
                error={error}
                source={errorSource}
                retry={() => {
                  setLongTaskBootState("loading");
                  setError("");
                  setErrorSource("unknown");
                  setReady(false);
                  setBackendReady(false);
                  setAttempt((value) => value + 1);
                }}
              />
            )}
          </TransportSurfaceProvider>
        </InspectorSurfaceProvider>
      </PreviewSurfaceProvider>
    </TimelineDomSurfaceProvider>
  );
}
