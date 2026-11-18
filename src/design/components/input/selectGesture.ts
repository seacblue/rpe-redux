/**
 * Click-versus-drag decisions for the shared input's select-all affordance.
 *
 * A numeric entry field holds one value the user almost always wants to retype,
 * so a press that ends where it started replaces the whole value with a
 * selection. The browser also dispatches that `click` at the end of a range
 * drag, after it has applied the drag's own selection, and a `Shift`-click asks
 * to extend rather than replace.
 *
 * Nothing is decided while the button is held: the press only records where it
 * landed, and the click that ends it — dispatched at the release point — is
 * compared against that origin. This module is the pure decision layer; the DOM
 * wiring in `useSelectAllOnClick.ts` only reports events and performs the
 * selection.
 */

/** Distance, in pixels, a press may travel and still count as a click. */
export const SELECT_CLICK_SLOP_PX = 4;

/**
 * Input types where an in-place press replaces the whole value.
 *
 * Only a numeric entry field holds one value the user almost always wants to
 * retype, so selecting it on click is an affordance. Every other text field —
 * prose, a name, a path, a search query or a multi-token expression — places the
 * caret where the click landed so one token can be edited without selecting the
 * rest.
 */
export function selectsValueOnClick(type: string | undefined): boolean {
  return type === "number";
}

/** The press that has not ended yet, remembered by where it landed. */
export interface SelectGesture {
  /** A click on this focus may replace the whole value. */
  readonly armed: boolean;
  /** Where the current press landed, or null when no press is in flight. */
  readonly origin: { readonly x: number; readonly y: number } | null;
}

/** The idle gesture: nothing armed and no press in flight. */
export const IDLE_SELECT_GESTURE: SelectGesture = Object.freeze({
  armed: false,
  origin: null,
});

/** One fact that can change the gesture. */
export type SelectGestureEvent =
  | { readonly type: "focus"; readonly selectsValue: boolean }
  | { readonly type: "blur" }
  | { readonly type: "press"; readonly x: number; readonly y: number }
  | { readonly type: "click"; readonly x: number; readonly y: number; readonly shiftKey: boolean };

/** The gesture after one event, plus the host work the event asks for. */
export interface SelectGestureOutcome {
  /** State to carry into the next event. */
  readonly gesture: SelectGesture;
  /** This click must select the whole value. */
  readonly selectAll: boolean;
}

/** An outcome that keeps the gesture and asks for no host work. */
function quiet(gesture: SelectGesture): SelectGestureOutcome {
  return { gesture, selectAll: false };
}

/**
 * Applies one event to the input's select-all gesture.
 *
 * A press only records its origin. The click that ends it decides: staying
 * within `SELECT_CLICK_SLOP_PX` of that origin selects the whole value, while a
 * longer travel leaves the selection the browser drew during the drag alone.
 * Because the deciding event is the click, a drag released outside the field
 * never asks for anything — the handler does not run at all.
 */
export function reduceSelectGesture(
  gesture: SelectGesture,
  event: SelectGestureEvent,
): SelectGestureOutcome {
  switch (event.type) {
    case "focus":
      // The browser focuses the field as the mousedown default action, which
      // lands after the pointerdown that already recorded this press. Keeping
      // the origin is what lets the click compare against the real press.
      return quiet({ ...gesture, armed: event.selectsValue });
    case "blur":
      return quiet(IDLE_SELECT_GESTURE);
    case "press":
      return quiet({ ...gesture, origin: { x: event.x, y: event.y } });
    case "click": {
      const selectAll = gesture.armed && !event.shiftKey && !travelled(gesture.origin, event);
      return { gesture: IDLE_SELECT_GESTURE, selectAll };
    }
  }
}

/** Whether the click released beyond the slop from the press that opened it. */
function travelled(
  origin: SelectGesture["origin"],
  point: { readonly x: number; readonly y: number },
): boolean {
  // A click with no press behind it — a keyboard activation — landed in place.
  if (!origin) {
    return false;
  }
  const dx = point.x - origin.x;
  const dy = point.y - origin.y;
  return dx * dx + dy * dy >= SELECT_CLICK_SLOP_PX * SELECT_CLICK_SLOP_PX;
}
