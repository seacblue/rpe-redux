/**
 * Provides the browser or Tauri system text clipboard to editor features while
 * keeping navigator access out of host-independent chart and edit modules.
 */
import type { SystemClipboard } from "../../core/edit/clipboard/clipboardFormat.ts";

/** Returns the system clipboard when the host exposes the async Clipboard API. */
export function systemClipboard(): SystemClipboard | null {
  if (typeof navigator === "undefined" || !navigator.clipboard) {
    return null;
  }
  return {
    readText: () => navigator.clipboard.readText(),
    writeText: (text) => navigator.clipboard.writeText(text),
  };
}
