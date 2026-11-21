/**
 * Product entry for the React shell: starts the owned backend and local service,
 * applies theme preferences, mounts the startup screen, and loads the editor
 * shell as a separate chunk after the first screen is on display.
 */
import { useCallback, useEffect, useState, useSyncExternalStore, type ComponentType } from "react";
import { preferences } from "../../core/state/preferences.ts";
import { values } from "../../core/state/values.ts";
import { setLongTaskBootState } from "../../core/state/longTasks.ts";

import { activeTheme, setActiveTheme, subscribeActiveTheme } from "../../core/theme/activeTheme.ts";
import { applyTheme } from "../../core/theme/applyTheme.ts";
import { refreshExternalThemes } from "./externalThemeCatalog.ts";
import { syncNativeWindowTheme } from "../platform/desktop/windowTheme.ts";
import { waitForLocalService } from "../../core/global/library/service.ts";
import { createDesktopPreferenceClient } from "../platform/preferencesClient.ts";
import {
  adoptRuntimePortSettings,
  initializeRuntimePorts,
} from "../platform/desktop/runtimePorts.ts";
import { NOTE_SKIN_EVENT } from "../platform/noteSkinEvents.ts";
import { ensureExtensionPipeline } from "../platform/extensionPipeline.ts";
import { prepareBackendInstance, startBackend } from "../../core/platform/desktop/backend.ts";
import { cleanupCustomBackgrounds } from "../platform/desktop/customBackground.ts";
import { StartupView } from "../screens/startup/StartupView.tsx";
import { StartupBoundary } from "../screens/startup/StartupBoundary.tsx";
import type { StartupFailureSource } from "../screens/startup/startupDiagnostics.ts";
import { diagnosticText } from "../platform/diagnosticLog.ts";
import { WindowControls } from "../chrome/topbar/windowControls/WindowControls.tsx";
import { isDesktop } from "../../core/platform/environment.ts";
import "../../design/styles/index.less";
import { useSetting } from "../screens/settings/useSetting.ts";
import {
  applyWindowDisplaySettings,
  dominantMonitorSignature,
  fitWindowToCurrentMonitor,
  showDesktopWindow,
  watchWindowMonitor,
  type WindowDisplayMode,
} from "../platform/desktop/windowDisplay.ts";
import { EditorShellBoundary } from "./EditorShellBoundary.tsx";
import type { EditorShellProps } from "./EditorShell.tsx";

/**
 * Loads the editor shell after the startup screen has mounted.
 *
 * The loader is a normal component rather than `lazy()` so a failed chunk import
 * can be reported to the startup report and retried by a new `resetKey`.
 */
function EditorShellLoader({ onError, resetKey, ...props }: EditorShellProps) {
  const [Shell, setShell] = useState<ComponentType<EditorShellProps> | null>(null);

  useEffect(() => {
    let cancelled = false;
    // The shell and the Extension/host-API pipeline load in parallel. The shell
    // renders only after both finish; the startup screen covers the wait.
    void Promise.all([ensureExtensionPipeline(), import("./EditorShell.tsx")]).then(
      ([, module]) => {
        if (!cancelled) {
          // Wrap the component in a function so React does not treat it as an
          // updater for the previous state value.
          setShell(() => module.EditorShell);
        }
      },
      (failure: unknown) => {
        if (!cancelled) {
          onError(diagnosticText(failure));
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [onError, resetKey]);

  if (!Shell) {
    return null;
  }
  return <Shell {...props} onError={onError} resetKey={resetKey} />;
}

/**
 * Root component: installs window controls and the startup boundary. The editor
 * session and shell live in a lazily loaded chunk.
 */
export function App() {
  return (
    <>
      {isDesktop() && <WindowControls />}
      <StartupBoundary>
        <AppContent />
      </StartupBoundary>
    </>
  );
}

/** Owns startup readiness, theme application, the backend handshake, and the window. */
function AppContent() {
  const theme = useSyncExternalStore(subscribeActiveTheme, activeTheme, activeTheme);
  const setTheme = setActiveTheme;
  const [error, setError] = useState("");
  const [errorSource, setErrorSource] = useState<StartupFailureSource>("unknown");
  const [ready, setReady] = useState(false);
  const [attempt, setAttempt] = useState(0);
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

  // Discover external packages once at startup so a persisted theme or skin
  // is available for the first paint. Continuous folder polling belongs to the
  // settings surfaces that list the packages; an idle editor does no package
  // I/O, and deleting a folder never interrupts the cached live session.
  useEffect(() => {
    void refreshExternalThemes();
  }, []);

  useEffect(() => {
    const suppressNativeMenus = (event: MouseEvent) => event.preventDefault();
    document.addEventListener("contextmenu", suppressNativeMenus, true);
    let cancelled = false;

    // Construct the provider tree only after the owned backend is healthy.
    initializeRuntimePorts()
      .then(() => startBackend())
      .then(async () => {
        adoptRuntimePortSettings();
        await prepareBackendInstance();
        if (cancelled) {
          return;
        }
        const found = await waitForLocalService();
        if (!found) {
          throw new Error("The local library service did not become ready during startup.");
        }
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
        // discovery runs only after the preference store attaches. The host API
        // and sandbox pipeline are separate chunks, shared with the editor shell.
        await ensureExtensionPipeline();
        const { loadPackagedExtensions } = await import("../platform/extensionLoader.ts");
        await loadPackagedExtensions();
        if (!cancelled) {
          window.dispatchEvent(new Event(NOTE_SKIN_EVENT));
        }
        if (cancelled) {
          return;
        }
        // Older profiles can only be classified by their stored entries; run
        // once, after durable preferences and packaged settings are declared.
        values.reconcileModifiedMetadata();
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

  // A window that moves to another display keeps its share of the screen. The
  // watcher waits for the move to settle, because resizing mid-drag fights the
  // pointer; while the window straddles two displays, the one holding most of
  // it decides the size. CSS pixels already follow the system DPI, so the
  // interface itself is never scaled a second time.
  useEffect(() => {
    if (!isDesktop() || windowDisplayMode !== "windowed" || windowResolution !== "auto") {
      return undefined;
    }
    let cancelled = false;
    let applied = "";
    const update = () => {
      void dominantMonitorSignature()
        .then(async (signature) => {
          if (cancelled || !signature || signature === applied) {
            return;
          }
          applied = signature;
          await fitWindowToCurrentMonitor();
        })
        .catch((failure: unknown) => {
          console.error("Could not fit the window to its display", failure);
        });
    };
    // Prime the identity so the first settled move on the same display is a
    // no-op instead of resizing a window the user already placed.
    void dominantMonitorSignature().then((signature) => {
      if (!cancelled) {
        applied = signature;
      }
    });
    const stop = watchWindowMonitor(update);
    return () => {
      cancelled = true;
      stop();
    };
  }, [windowDisplayMode, windowResolution]);

  return (
    <>
      <EditorShellBoundary key={attempt} onError={handleEditorError}>
        <EditorShellLoader
          enabled={backendReady}
          resetKey={attempt}
          ready={ready}
          onReady={handleEditorReady}
          onError={handleEditorError}
          theme={theme}
          setTheme={setTheme}
        />
      </EditorShellBoundary>
      {!ready && (
        <StartupView
          error={error}
          source={errorSource}
          resetKey={attempt}
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
    </>
  );
}
