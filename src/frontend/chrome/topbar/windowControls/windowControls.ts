/**
 * Window control calls for the custom title bar.
 *
 * The fixed controls at the top-right and the File menu both drive these
 * actions. Every action is a no-op outside the desktop host, so the browser
 * build can render the same buttons.
 */
import { getCurrentWindow } from "@tauri-apps/api/window";
import { isDesktop } from "../../../../core/platform/environment.ts";

/** Lazily resolves the current desktop window handle. */
const currentWindow = () => getCurrentWindow();

/** Runs a minimize, maximize, or close call against the desktop window; no-op outside the host. */
export async function controlWindow(action: "minimize" | "maximize" | "close"): Promise<void> {
  if (!isDesktop()) {
    return;
  }
  const window = await currentWindow();
  if (action === "minimize") {
    await window.minimize();
  } else if (action === "maximize") {
    await window.toggleMaximize();
  } else {
    await window.close();
  }
}

/** Subscribes to native resize events so the maximize button can flip to restore. */
export async function observeWindowState(
  changed: (maximized: boolean) => void,
): Promise<() => void> {
  if (!isDesktop()) {
    return () => {};
  }
  const window = await currentWindow();
  const refresh = async () => changed(await window.isMaximized());
  let timer: ReturnType<typeof setTimeout> | undefined;
  // Dragging an edge emits a resize event per frame; one IPC round trip after
  // the drag settles is enough to update the caption button.
  const unlisten = await window.onResized(() => {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => {
      timer = undefined;
      void refresh().catch(() => {});
    }, 150);
  });
  await refresh();
  return () => {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
    unlisten();
  };
}
