/**
 * Desktop developer capabilities.
 *
 * The host decides whether a packaged build is allowed to expose developer
 * entry points. The browser-side feature can therefore keep its actions and
 * visibility stable while ordinary release builds hide them.
 *
 * The cell starts closed on every host, including the development server: a
 * debug build flag is a host policy answer, never a build-mode shortcut, so
 * nothing but the About page's logo gesture opens the developer section in a
 * browser loop. Otherwise the loop would exercise a product state a release
 * build never has, and a developer shortcut would look working until it ships.
 */
import { invoke } from "@tauri-apps/api/core";
import { createValue } from "../../state/values.ts";
import { isDesktop } from "../environment.ts";

const mode = createValue<boolean>({ initial: false });

/** Read-only developer-mode cell for the shell and action registry. */
export const developerMode = Object.freeze({
  get: mode.get,
  subscribe: mode.subscribe,
});

/** Resolve the host policy before the shell advertises developer controls. */
export async function initializeDeveloperMode(): Promise<boolean> {
  if (!isDesktop()) {
    return mode.get();
  }
  try {
    mode.set(await invoke<boolean>("developer_mode"));
  } catch {
    mode.set(false);
  }
  return mode.get();
}

/** Request the native DevTools toggle after synchronously checking host policy. */
export function requestDevtoolsToggle():
  | { status: "committed" }
  | { status: "unavailable"; reason: "developer_mode_disabled" | "desktop_unavailable" } {
  if (!developerMode.get()) {
    return { status: "unavailable", reason: "developer_mode_disabled" };
  }
  if (!isDesktop()) {
    return { status: "unavailable", reason: "desktop_unavailable" };
  }
  void invoke("developer_toggle_devtools");
  return { status: "committed" };
}
