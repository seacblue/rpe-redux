/**
 * One frame-driven measurement loop for every floating surface.
 *
 * A menu, picker, select, or colour panel can stay open while its anchor moves:
 * the list behind it scrolls, a panel animates open, the timeline advances, or
 * playback shifts the row the surface belongs to. Measuring from each surface
 * would mean one scroll listener, one resize observer, and one lifecycle poll
 * per surface.
 *
 * Instead every surface registers the elements it depends on here. A single
 * `requestAnimationFrame` loop measures those elements, reports a box once when
 * it changes, and reports `null` when the element leaves the document or becomes
 * invisible. The loop runs only while at least one surface is registered.
 */

/** Why a listener is being notified. */
export type FloatingAnchorChange = "measure" | "viewport" | "scroll";

/** Receives the anchor box, or `null` when the anchor is gone. */
export type FloatingAnchorListener = (
  box: DOMRectReadOnly | null,
  change: FloatingAnchorChange,
  event?: Event,
) => void;

interface AnchorEntry {
  listeners: Set<FloatingAnchorListener>;
  box: DOMRectReadOnly | null;
}

const anchors = new Map<Element, AnchorEntry>();
let frame = 0;
let listening = false;

/** Measure one element as a floating anchor, or `null` when it cannot anchor. */
function measure(element: Element): DOMRectReadOnly | null {
  if (!element.isConnected || element.getClientRects().length === 0) {
    return null;
  }
  if (element.checkVisibility?.({ checkVisibilityCSS: true }) === false) {
    return null;
  }
  return element.getBoundingClientRect();
}

/** Whether two measurements describe the same box within layout rounding. */
function sameBox(first: DOMRectReadOnly | null, second: DOMRectReadOnly | null): boolean {
  if (!first || !second) {
    return first === second;
  }
  return (
    Math.abs(first.left - second.left) < 0.5 &&
    Math.abs(first.top - second.top) < 0.5 &&
    Math.abs(first.width - second.width) < 0.5 &&
    Math.abs(first.height - second.height) < 0.5
  );
}

/** Publish one measurement and update the stored box before calling listeners. */
function publish(
  entry: AnchorEntry,
  box: DOMRectReadOnly | null,
  change: FloatingAnchorChange,
  event?: Event,
): void {
  entry.box = box;
  for (const listener of [...entry.listeners]) {
    try {
      listener(box, change, event);
    } catch (error) {
      // One broken surface must not stop the shared loop for every other one.
      globalThis.reportError?.(error);
    }
  }
}

/** Re-measure every registered anchor once. */
function measureAll(change: FloatingAnchorChange): void {
  for (const [element, entry] of anchors) {
    const box = measure(element);
    if (change === "viewport" || !sameBox(entry.box, box)) {
      publish(entry, box, change);
    }
  }
}

/** The single frame callback. */
function tick(): void {
  frame = 0;
  measureAll("measure");
  schedule();
}

/** Ensure the shared loop is running. */
function schedule(): void {
  if (!frame && anchors.size > 0) {
    frame = requestAnimationFrame(tick);
  }
}

/** A window resize changes the space a surface can occupy even when the anchor is still. */
function onViewportResize(): void {
  measureAll("viewport");
}

/**
 * One capture listener reports scrolling to every open surface. A surface decides
 * whether the scroll moves it, leaves it alone, or should close; the tracker
 * never inspects the target itself.
 */
function onScroll(event: Event): void {
  for (const entry of anchors.values()) {
    publish(entry, entry.box, "scroll", event);
  }
}

/** Subscribe one element to the shared loop. Returns a release function. */
export function trackFloatingAnchor(
  element: Element,
  listener: FloatingAnchorListener,
): () => void {
  let entry = anchors.get(element);
  if (!entry) {
    entry = { listeners: new Set(), box: measure(element) };
    anchors.set(element, entry);
  }
  entry.listeners.add(listener);
  listener(entry.box, "measure");
  if (!listening) {
    listening = true;
    window.addEventListener("resize", onViewportResize);
    document.addEventListener("scroll", onScroll, true);
  }
  schedule();
  return () => {
    const current = anchors.get(element);
    if (!current) {
      return;
    }
    current.listeners.delete(listener);
    if (current.listeners.size > 0) {
      return;
    }
    anchors.delete(element);
    if (anchors.size === 0) {
      if (frame) {
        cancelAnimationFrame(frame);
        frame = 0;
      }
      if (listening) {
        listening = false;
        window.removeEventListener("resize", onViewportResize);
        document.removeEventListener("scroll", onScroll, true);
      }
    }
  };
}
