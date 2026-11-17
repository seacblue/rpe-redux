/**
 * The non-modifier keys currently held down.
 *
 * The dispatcher writes this set from key, pointer, and blur events; matching
 * reads it to complete a held-key chord such as `E+MOUSE2`. Physical identities
 * are tracked separately from key tokens so a key-up still releases the right
 * entry when a modifier changed the event's `key` value. Modifiers stay out of
 * the set: they are already represented by the event's modifier flags.
 */
import { normalizeShortcutKey } from "./keys.ts";

const BARE_MODIFIERS = new Set(["CTRL", "ALT", "SHIFT", "META"]);

/** Physical input identity → the shortcut token it currently holds. */
const physicalTokens = new Map<string, string>();
/** Token → how many physical inputs are holding it. */
const tokenCounts = new Map<string, number>();
/** The distinct held tokens, kept in step with the counts for allocation-free reads. */
const heldTokens = new Set<string>();

/** Record one non-modifier input as held. */
export function pressShortcutKey(physical: string, token: string): void {
  const normalized = normalizeShortcutKey(token);
  if (!physical || BARE_MODIFIERS.has(normalized)) {
    return;
  }
  const previous = physicalTokens.get(physical);
  if (previous === normalized) {
    return;
  }
  if (previous !== undefined) {
    decrement(previous);
  }
  physicalTokens.set(physical, normalized);
  tokenCounts.set(normalized, (tokenCounts.get(normalized) ?? 0) + 1);
  heldTokens.add(normalized);
}

/** Release one physical input. */
export function releaseShortcutKey(physical: string): void {
  const token = physicalTokens.get(physical);
  if (token === undefined) {
    return;
  }
  physicalTokens.delete(physical);
  decrement(token);
}

/** Drop every held input, as window focus loss and capture start do. */
export function clearShortcutKeys(): void {
  physicalTokens.clear();
  tokenCounts.clear();
  heldTokens.clear();
}

/** The token set a chord matcher reads; empty when no non-modifier input is down. */
export function heldShortcutKeys(): ReadonlySet<string> {
  return heldTokens;
}

/** Remove one token reference, deleting the entry when its last holder releases. */
function decrement(token: string): void {
  const count = tokenCounts.get(token);
  if (count === undefined) {
    return;
  }
  if (count <= 1) {
    tokenCounts.delete(token);
    heldTokens.delete(token);
  } else {
    tokenCounts.set(token, count - 1);
  }
}
