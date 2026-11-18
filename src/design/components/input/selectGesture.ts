/**
 * Click-versus-drag decisions for the shared input's select-all affordance.
 *
 * A numeric entry field holds one value the user almost always wants to retype,
 * so an in-place press replaces the whole value with a selection. The browser
 * also dispatches a `click` at the end of a range drag, after it has applied the
 * drag's own selection, and a `Shift`-click asks to extend rather than replace.
 * This module is the pure decision layer: whether a press became a range, and
 * whether the click that ends it may still select the whole value. The DOM
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

/** One input's select-all gesture: whether it is armed and what the press did. */
export interface SelectGesture {
  /** A click on this focus may replace the whole value. */
  readonly armed: boolean;
  /** A press is being followed; false between presses. */
  readonly pressed: boolean;
  /** Where the followed press landed. */
  readonly originX: number;
  readonly originY: number;
  /** The followed press travelled far enough to be a range selection. */
  readonly dragged: boolean;
}

/** The idle gesture: nothing armed, no press being followed. */
export const IDLE_SELECT_GESTURE: SelectGesture = Object.freeze({
  armed: false,
  pressed: false,
  originX: 0,
  originY: 0,
  dragged: false,
});

/** One fact that can change the gesture. */
export type SelectGestureEvent =
  | { readonly type: "focus"; readonly selectsValue: boolean }
  | { readonly type: "blur" }
  | { readonly type: "press"; readonly x: number; readonly y: number }
  | { readonly type: "move"; readonly x: number; readonly y: number }
  | { readonly type: "release"; readonly x: number; readonly y: number }
  | { readonly type: "click"; readonly shiftKey: boolean };

/** The gesture after one event, plus the host work the event asks for. */
export interface SelectGestureOutcome {
  /** State to carry into the next event. */
  readonly gesture: SelectGesture;
  /** This click must select the whole value. */
  readonly selectAll: boolean;
  /** Stop following the press on the window; it ended or became a range. */
  readonly release: boolean;
}

/** An outcome that keeps the gesture and asks for no host work. */
function quiet(gesture: SelectGesture): SelectGestureOutcome {
  return { gesture, selectAll: false, release: false };
}

/**
 * Applies one event to the input's select-all gesture.
 *
 * A press is followed until it releases. Travel beyond `SELECT_CLICK_SLOP_PX`
 * makes it a range selection, which disarms the gesture immediately: a release
 * outside the field dispatches no click, so the click handler cannot be the only
 * place that ends it.
 */
export function reduceSelectGesture(
  gesture: SelectGesture,
  event: SelectGestureEvent,
): SelectGestureOutcome {
  switch (event.type) {
    case "focus":
      return quiet({ ...IDLE_SELECT_GESTURE, armed: event.selectsValue });
    case "blur":
      return quiet(IDLE_SELECT_GESTURE);
    case "press":
      return quiet({
        ...gesture,
        pressed: true,
        originX: event.x,
        originY: event.y,
        dragged: false,
      });
    case "move": {
      if (!gesture.pressed || gesture.dragged || !travelled(gesture, event)) {
        return quiet(gesture);
      }
      return {
        gesture: { ...gesture, armed: false, dragged: true },
        selectAll: false,
        release: true,
      };
    }
    case "release": {
      if (!gesture.pressed) {
        return quiet(gesture);
      }
      const dragged = gesture.dragged || travelled(gesture, event);
      return {
        gesture: { ...gesture, armed: gesture.armed && !dragged, pressed: false, dragged },
        selectAll: false,
        release: true,
      };
    }
    case "click": {
      const selectAll = gesture.armed && !gesture.dragged && !event.shiftKey;
      return {
        gesture: { ...gesture, armed: false, dragged: false },
        selectAll,
        release: false,
      };
    }
  }
}

/** Whether a point lies beyond the click slop from the press that opened the gesture. */
function travelled(gesture: SelectGesture, point: { x: number; y: number }): boolean {
  const dx = point.x - gesture.originX;
  const dy = point.y - gesture.originY;
  return dx * dx + dy * dy >= SELECT_CLICK_SLOP_PX * SELECT_CLICK_SLOP_PX;
}
