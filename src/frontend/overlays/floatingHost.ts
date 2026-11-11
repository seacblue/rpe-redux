/**
 * The app-root host for non-modal floating surfaces.
 *
 * A floating panel can open from anywhere in the provider tree; mounting it
 * beside the app shell keeps it above inspector and workspace stacking contexts
 * while the entry point keeps the design-system scope on the same subtree.
 */
let host: HTMLElement | null = null;

/** Registers the element that owns the floating layer. */
export function registerFloatingHost(element: HTMLElement | null): void {
  host = element;
}

/** The registered floating host, or null before the entry point mounts. */
export function readFloatingHost(): HTMLElement | null {
  return host;
}
