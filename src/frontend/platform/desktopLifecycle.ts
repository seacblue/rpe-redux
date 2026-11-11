/**
 * Binds the editor session to the desktop window.
 *
 * Window titles, file-open events, drag-and-drop, and the close guard all arrive
 * here, so the packaged app drives the same document flow as the browser build.
 */
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { TauriDocumentStore } from "../../core/platform/desktop/documentStore.ts";
import { FILE_DRAG_EVENT } from "../../core/shell/shellEventNames.ts";
import { requestActiveModalClose } from "../../design/components/modal/Modal.tsx";
import { bindWindowTitle } from "../chrome/topbar/windowControls/windowTitle.ts";

export interface DesktopLifecycleBindings {
  documents: TauriDocumentStore | null;
  addCleanup(cleanup: () => void): void;
  /** Open paths requested by the file association or the open-file event. */
  openPaths(paths: string[]): Promise<void>;
  /** Handle paths dropped on the window; the active surface decides the action. */
  dropPaths(paths: string[]): Promise<void>;
  /** Reopen the last document and restore its view/panel state. */
  restoreLastSession(): Promise<void>;
  /** Release the route mirror once startup files or a restored session settle. */
  markBootSettled(): void;
  /** Persist the last workspace state and flush durable preferences before exit. */
  persistSession(): Promise<void>;
  pendingSave(): Promise<void> | null;
  /** One prompt that combines unsaved edits and any active room exit. */
  confirmClose(): Promise<boolean>;
  dispose(): void;
  reportError(error: unknown): void;
  notifyUnsupported(): void;
}

/** Browser-only startup: restore the library session and mark the host surface. */
export interface BrowserLifecycleBindings {
  /** Reopen the project recorded by the last workspace session. */
  restoreLastSession(): Promise<void>;
  reportError(error: unknown): void;
}

/**
 * Bind the browser host.
 *
 * A browser page has no native window, file association, or drag-drop path
 * source, but the chart library and the workspace-session record are shared
 * with the desktop build. Restoring that record makes a refresh reopen the
 * project the developer was editing without a Tauri window.
 */
export function bindBrowserLifecycle(bindings: BrowserLifecycleBindings): void {
  document.body.dataset.environment = "browser";
  void bindings.restoreLastSession().catch(bindings.reportError);
}

type DesktopExitGuard = () => Promise<boolean>;
const desktopExitGuards = new Set<DesktopExitGuard>();

/** Register an auxiliary surface that must approve a native window close. */
export function registerDesktopExitGuard(guard: DesktopExitGuard): () => void {
  desktopExitGuards.add(guard);
  return () => desktopExitGuards.delete(guard);
}

/** Ask mounted auxiliary surfaces before the document close workflow runs. */
async function confirmDesktopExitGuards(): Promise<boolean> {
  for (const guard of desktopExitGuards) {
    if (!(await guard())) {
      return false;
    }
  }
  return true;
}

/** Connects the editor session to Tauri window, file, and shutdown events. */
export function bindDesktopLifecycle(bindings: DesktopLifecycleBindings): void {
  const { documents } = bindings;
  if (!documents) {
    document.body.dataset.environment = "unsupported";
    bindings.notifyUnsupported();
    bindings.markBootSettled();
    return;
  }

  document.body.dataset.environment = "desktop";
  Promise.resolve()
    .then(async () => {
      const window = getCurrentWindow();
      // The webview title is not the window title on Windows, so hand the
      // frame the same string `document.title` carries.
      bindings.addCleanup(bindWindowTitle(window));

      // Register the close guard first: a modal can open before the optional
      // file and drag-drop listeners finish binding.
      bindings.addCleanup(
        await window.onCloseRequested(async (event) => {
          event.preventDefault();
          if (!(await requestActiveModalClose())) {
            return;
          }
          if (!(await confirmDesktopExitGuards())) {
            return;
          }
          if (!(await bindings.confirmClose())) {
            return;
          }
          const pending = bindings.pendingSave();
          if (pending) {
            await pending;
          }
          try {
            await bindings.persistSession();
          } catch (error) {
            bindings.reportError(error);
          }
          // A cleanup failure must not cancel the quit the user already
          // confirmed; report it and destroy the window anyway.
          try {
            bindings.dispose();
          } catch (error) {
            bindings.reportError(error);
          }
          await window.destroy();
        }),
      );
      bindings.addCleanup(
        await listen("redux-open-files", (event) => bindings.openPaths(event.payload as string[])),
      );
      bindings.addCleanup(
        await window.onDragDropEvent((event) => {
          globalThis.window.dispatchEvent(
            new CustomEvent(FILE_DRAG_EVENT, { detail: event.payload.type }),
          );
          if (event.payload.type === "drop") {
            void bindings.dropPaths(event.payload.paths);
          }
        }),
      );
      const paths = await invoke<string[]>("startup_files");
      if (paths.length) {
        await bindings.openPaths(paths);
      } else {
        await bindings.restoreLastSession();
      }
    })
    .catch(bindings.reportError)
    .finally(() => bindings.markBootSettled());
}
