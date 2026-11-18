/**
 * First-refusal claims for keys a mounted React surface owns before the editor
 * dispatcher matches its own shortcuts.
 *
 * The dispatcher listens on the window capture phase, so a surface that mounts
 * later cannot outrank it with another capture listener. Surfaces register a
 * claim here instead; the dispatcher asks them with the shortcut context it
 * already classified. A claim returns true only when it handled the event.
 */
import type { ShortcutContext } from "../../../core/shortcuts/types.ts";

export type KeyClaim = (event: KeyboardEvent, context: ShortcutContext) => boolean;

const claims = new Set<KeyClaim>();

/** Register one surface claim; the returned disposer removes it. */
export function registerKeyClaim(claim: KeyClaim): () => void {
  claims.add(claim);
  return () => {
    claims.delete(claim);
  };
}

/**
 * Ask registered surfaces in reverse registration order; the most recently
 * mounted surface outranks the page underneath it. True means the event was
 * consumed and must not reach the editor's own shortcut matching.
 */
export function claimKey(event: KeyboardEvent, context: ShortcutContext): boolean {
  for (const claim of [...claims].reverse()) {
    if (claim(event, context)) {
      return true;
    }
  }
  return false;
}
