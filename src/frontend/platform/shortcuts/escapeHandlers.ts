/**
 * Owns the window-level Escape consumer registry.
 *
 * The application root dispatches Escape handling after the current key event
 * reaches all surfaces. Active surfaces register a consumer here so they can
 * claim a plain Escape; an unclaimed Escape is a no-op.
 */

/** A surface Escape consumer; true means the key was handled. */
export type EscapeHandler = () => boolean;

const handlers = new Set<EscapeHandler>();

/** Register one active surface's Escape consumer and return its disposer. */
export function registerEscapeHandler(handler: EscapeHandler): () => void {
  handlers.add(handler);
  return () => handlers.delete(handler);
}

/** Let the most recently mounted active surface consume Escape. */
export function consumeEscape(): boolean {
  for (const handler of [...handlers].reverse()) {
    if (handler()) {
      return true;
    }
  }
  return false;
}
