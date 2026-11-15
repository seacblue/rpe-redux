/** Viewport calculations for keyboard-selected library cards. */

/** Minimal list geometry required to reveal a selected card. */
export interface LibraryListViewport {
  scrollTop: number;
  clientHeight: number;
  scrollHeight: number;
  /** Viewport-relative top edge from getBoundingClientRect(). */
  top: number;
}

/** Card rectangle required to reveal a selected card. */
export interface LibraryCardGeometry {
  /** Viewport-relative top edge from getBoundingClientRect(). */
  top: number;
  /** Viewport-relative bottom edge from getBoundingClientRect(). */
  bottom: number;
}

/** Return the bounded scrollTop, or null when the card is already visible. */
export function librarySelectionScrollTop(
  viewport: LibraryListViewport,
  card: LibraryCardGeometry,
): number | null {
  const contentTop = viewport.scrollTop + card.top - viewport.top;
  const contentBottom = viewport.scrollTop + card.bottom - viewport.top;
  const viewportTop = viewport.scrollTop;
  const viewportBottom = viewportTop + viewport.clientHeight;
  const maxScrollTop = Math.max(0, viewport.scrollHeight - viewport.clientHeight);
  const clamp = (value: number): number => Math.min(maxScrollTop, Math.max(0, value));
  if (contentTop < viewportTop) {
    return clamp(contentTop);
  }
  if (contentBottom > viewportBottom) {
    return clamp(contentBottom - viewport.clientHeight);
  }
  return null;
}
