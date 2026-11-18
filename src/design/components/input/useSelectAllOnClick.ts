/**
 * DOM wiring for the shared input's select-all gesture.
 *
 * The decisions live in `selectGesture.ts`; this hook keeps one gesture per
 * input, follows a press on the window so a drag that leaves the short field is
 * still measured, and hands the click handler its verdict.
 */
import { useCallback, useEffect, useRef } from "react";
import {
  IDLE_SELECT_GESTURE,
  reduceSelectGesture,
  selectsValueOnClick,
  type SelectGesture,
} from "./selectGesture.ts";

/** The gesture's entry points, called from the input's own event handlers. */
export interface SelectAllOnClick {
  /** Focus arrived: a numeric field arms the select-all click. */
  focus(type: string | undefined): void;
  /** Focus left: nothing is armed any more. */
  blur(): void;
  /** A press landed: follow it until it ends to see whether it draws a range. */
  press(point: { pointerId: number; x: number; y: number }): void;
  /** Whether this click replaces the value; a range or a Shift-click does not. */
  click(shiftKey: boolean): boolean;
}

/** Tracks the arming, the press, and the click of one input's select-all gesture. */
export function useSelectAllOnClick(): SelectAllOnClick {
  const gesture = useRef<SelectGesture>(IDLE_SELECT_GESTURE);
  const cleanup = useRef<(() => void) | null>(null);

  /** Apply one event and run the host work it asks for. */
  const dispatch = useCallback((event: Parameters<typeof reduceSelectGesture>[1]): boolean => {
    const outcome = reduceSelectGesture(gesture.current, event);
    gesture.current = outcome.gesture;
    if (outcome.release) {
      cleanup.current?.();
      cleanup.current = null;
    }
    return outcome.selectAll;
  }, []);

  const focus = useCallback(
    (type: string | undefined) => {
      dispatch({ type: "focus", selectsValue: selectsValueOnClick(type) });
    },
    [dispatch],
  );
  const blur = useCallback(() => {
    dispatch({ type: "blur" });
  }, [dispatch]);

  const press = useCallback(
    (point: { pointerId: number; x: number; y: number }) => {
      cleanup.current?.();
      cleanup.current = null;
      dispatch({ type: "press", x: point.x, y: point.y });
      const follow = (pointer: PointerEvent) => {
        if (pointer.pointerId === point.pointerId) {
          dispatch({
            type: pointer.type === "pointermove" ? "move" : "release",
            x: pointer.clientX,
            y: pointer.clientY,
          });
        }
      };
      window.addEventListener("pointermove", follow, true);
      window.addEventListener("pointerup", follow, true);
      window.addEventListener("pointercancel", follow, true);
      cleanup.current = () => {
        window.removeEventListener("pointermove", follow, true);
        window.removeEventListener("pointerup", follow, true);
        window.removeEventListener("pointercancel", follow, true);
      };
    },
    [dispatch],
  );

  const click = useCallback(
    (shiftKey: boolean) => dispatch({ type: "click", shiftKey }),
    [dispatch],
  );

  useEffect(
    () => () => {
      cleanup.current?.();
      cleanup.current = null;
      gesture.current = IDLE_SELECT_GESTURE;
    },
    [],
  );

  return { focus, blur, press, click };
}
