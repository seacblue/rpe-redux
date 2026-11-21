/**
 * The editor rail, workbench, settings, and overlays.
 *
 * `App` loads this module as a lazy chunk after the startup screen is already on
 * screen. It owns the editor session, the surface providers, the provider tree,
 * the shell, and every editor-scoped overlay; keeping them here lets the startup
 * payload stay limited to the shell chrome and the startup screen itself.
 */
import { useEffect, useState, useSyncExternalStore } from "react";
import { Shell } from "./Shell.tsx";
import { EditorBackdrop } from "./EditorBackdrop.tsx";
import { useTooltipHost, setShortcutLookup } from "../../design/patterns/TooltipHost.tsx";
import { ControlHost } from "../../design/controls/ControlHost.tsx";
import { SettingsWindow } from "../screens/settings/SettingsWindow.tsx";
import { initializeUpdates } from "../screens/settings/updates/updateStore.ts";
import { actionShortcuts, toolbar } from "../../core/shell/registries/toolbar.ts";
import { shortcutChips } from "../../design/components/keyboardHint/shortcutChips.ts";
import {
  getEditorVisibility,
  subscribeToEditorVisibility,
} from "../../core/edit/state/visibility.ts";
import {
  EditorSessionProvider,
  useEditorSession,
} from "../screens/editor/workspace/runtime/providers/SessionProvider.tsx";
import { EditorProviderTree } from "../screens/editor/workspace/runtime/composition/EditorProviderTree.tsx";
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
import { ModalScrimPortal } from "../../design/components/modal/ModalScrimPortal.tsx";
import { ModalHost } from "../overlays/modals/ModalHost.tsx";
import { SessionPrompts } from "../overlays/SessionPrompts.tsx";
import { ToastHost } from "../../design/patterns/ToastHost.tsx";
import { ScriptGuideHost } from "../platform/ScriptGuideHost.tsx";
import { OnboardingHost } from "../onboarding/OnboardingHost.tsx";
import { ExtensionOverlays } from "../platform/ExtensionOverlays.tsx";
import { ExperimentalWarning } from "../screens/startup/ExperimentalWarning.tsx";
import { ChartLoading } from "../screens/editor/workspace/document/loading/ChartLoading.tsx";
import { RecordingHosts } from "../screens/editor/workspace/recording/RecordingHosts.tsx";
import { TimingDetectionHost } from "../screens/editor/workspace/timingDetection/TimingDetectionHost.tsx";
import { CollaborationHosts } from "../screens/editor/workspace/collaboration/CollaborationHosts.tsx";
import { ExportDialog } from "../screens/editor/workspace/document/export/ExportDialog.tsx";
import { RestoreBackupDialog } from "../screens/editor/workspace/document/restore/RestoreBackupDialog.tsx";
import { RouteRuntime } from "./routing/RouteRuntime.tsx";
import { readShortcutContext } from "../platform/shortcuts/shortcutContext.ts";
import { consumeEscape } from "../platform/shortcuts/escapeHandlers.ts";
import { installNoteSkinBridge } from "../platform/noteSkinBridge.ts";
import { NOTE_SKIN_EVENT } from "../platform/noteSkinEvents.ts";
import { refreshExternalNoteSkins } from "../../core/platform/desktop/noteSkinPackages.ts";
import { installLoadingPaint } from "../screens/editor/workspace/document/loading/loadingPaint.ts";
import { registerDeferredCatalogs } from "../../i18n/deferred.ts";
import { loadUiFont } from "../platform/uiFont.ts";
import type { Theme } from "../../core/theme/themes.ts";

// Register the product-page text with the shell's chunk, start the CJK face
// without blocking the first shell paint, and install the note-skin
// bridge/loading paint with the surfaces they serve.
registerDeferredCatalogs();
void loadUiFont();
installNoteSkinBridge();
installLoadingPaint();

/** Inputs the startup layer hands to the lazily loaded editor shell. */
export interface EditorShellProps {
  /** Whether the owned backend and preference store are ready. */
  readonly enabled: boolean;
  /** Bumped when the startup retry should rebuild the editor tree. */
  readonly resetKey: number;
  /** Whether the editor has crossed the startup barrier. */
  readonly ready: boolean;
  /** Publishes editor construction readiness to the startup gate. */
  readonly onReady: (ready: boolean) => void;
  /** Publishes an editor construction failure to the startup report. */
  readonly onError: (error: string) => void;
  /** Active theme id for the settings window. */
  readonly theme: Theme;
  /** Applies a theme selected in the settings window. */
  readonly setTheme: (theme: Theme) => void;
}

/** Editor shell mounted inside the lazy chunk's editor session provider. */
export function EditorShell(props: EditorShellProps) {
  return (
    <EditorSessionProvider>
      <EditorShellContent {...props} />
    </EditorSessionProvider>
  );
}

/** Builds the surface handles, installs editor-global effects, and renders the shell. */
function EditorShellContent({
  enabled,
  resetKey,
  ready,
  onReady,
  onError,
  theme,
  setTheme,
}: EditorShellProps) {
  const editorSession = useEditorSession();
  const tooltip = useTooltipHost();
  const editorVisibility = useSyncExternalStore(
    subscribeToEditorVisibility,
    getEditorVisibility,
    getEditorVisibility,
  );
  const [timelineSurface] = useState(createTimelineDomSurface);
  const [previewSurface] = useState(createPreviewSurface);
  const [inspectorSurface] = useState(createInspectorSurface);
  const [transportSurface] = useState(createTransportSurface);

  useEffect(() => {
    // The tooltip resolves live shortcut chips through the toolbar registry, so
    // the lookup is installed here rather than in design.
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
  }, []);

  useEffect(() => {
    // External skins are discovered with the shell so the media layer is live
    // before the editor assembly starts. The backend repeats the event after
    // packaged Extensions load, which is harmless and keeps both paths current.
    void refreshExternalNoteSkins();
    window.dispatchEvent(new Event(NOTE_SKIN_EVENT));
  }, []);

  // Update checks and automatic package downloads are background work. Wait
  // until the editor has crossed the startup barrier so a failed boot cannot
  // continue the update flow behind the startup report.
  useEffect(() => {
    if (ready && enabled) {
      void initializeUpdates();
    }
  }, [enabled, ready]);

  useEffect(() => {
    if (ready) {
      window.dispatchEvent(new Event("resize"));
    }
  }, [ready]);

  // Escape is a cancel/close key only. Menus, dialogs, control popups,
  // onboarding, text fields, and active editor surfaces answer first; when no
  // surface owns it, the key is consumed without changing the destination.
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
      // Give surface-owned Escape handlers one turn to claim the key. If no
      // surface can close, Escape remains a no-op instead of opening Settings.
      window.setTimeout(() => {
        if (event.defaultPrevented) {
          return;
        }
        event.preventDefault();
        consumeEscape();
      }, 0);
    };
    window.addEventListener("keydown", onEscape);
    return () => window.removeEventListener("keydown", onEscape);
  }, [ready]);

  return (
    <TimelineDomSurfaceProvider surface={timelineSurface}>
      <PreviewSurfaceProvider surface={previewSurface}>
        <InspectorSurfaceProvider surface={inspectorSurface}>
          <TransportSurfaceProvider surface={transportSurface}>
            <EditorProviderTree
              session={editorSession}
              enabled={enabled}
              resetKey={resetKey}
              onReady={onReady}
              onError={onError}
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
                {/* A restore is a document-wide question that also opens from the
                    home library, so it mounts beside the export question. */}
                <RestoreBackupDialog />
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
          </TransportSurfaceProvider>
        </InspectorSurfaceProvider>
      </PreviewSurfaceProvider>
    </TimelineDomSurfaceProvider>
  );
}
