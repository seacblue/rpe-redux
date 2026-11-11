/**
 * Desktop delivery for `rperedux://` links.
 *
 * The native host stores the scheme argument received before the window exists;
 * the frontend reads it once before mounting. A room link waits here until the
 * collaboration runtime mounts, while a chart link becomes the boot route.
 */
import { invoke } from "@tauri-apps/api/core";

let pendingInvite: string | null = null;

/** Read and clear the scheme argument the native host received at launch. */
export async function readDesktopDeepLink(): Promise<string | null> {
  try {
    return await invoke<string | null>("take_deep_link");
  } catch (error) {
    console.warn("Unable to read the desktop deep link", error);
    return null;
  }
}

/** Hold a room invitation until its mounted surface consumes it. */
export function setPendingDesktopInvite(link: string): void {
  pendingInvite = link;
}

/** Consume the held room invitation, if any. */
export function takePendingDesktopInvite(): string | null {
  const link = pendingInvite;
  pendingInvite = null;
  return link;
}
