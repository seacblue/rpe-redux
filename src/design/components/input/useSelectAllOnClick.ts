/**
 * DOM wiring for the shared input's select-all gesture.
 *
 * The decisions live in `selectGesture.ts`. This hook keeps one gesture per
 * input and reports the two facts that matter: where a press landed, and where
 * the click that ended it fired. Nothing is measured while the button is held.
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
  /** Focus left: drop the gesture and forget the browser's remembered selection. */
  blur(field: HTMLInputElement): void;
  /** A press landed; remember where, without deciding anything yet. */
  press(point: { x: number; y: number }): void;
  /** Whether this click, fired at `point`, replaces the value. */
  click(point: { x: number; y: number; shiftKey: boolean }): boolean;
}

/**
 * Forget the selection a number field keeps after focus leaves.
 *
 * A number input refuses the range API, so the browser restores whatever was
 * selected when focus returns. Once a click has selected the whole value, the
 * next focus would restore that full selection before the user has pressed
 * anything, and their drag would start from a replaced value. Swapping the type
 * to `text` makes the selection addressable, and collapsing it there is the only
 * way to clear the remembered state.
 */
export function forgetRememberedSelection(field: HTMLInputElement): void {
  if (field.type !== "number") {
    return;
  }
  field.type = "text";
  try {
    field.setSelectionRange(field.value.length, field.value.length);
  } catch {
    /* A field without a text selection keeps its state as it was. */
  }
  field.type = "number";
}

/** Tracks the arming, the press origin, and the click of one input. */
export function useSelectAllOnClick(): SelectAllOnClick {
  const gesture = useRef<SelectGesture>(IDLE_SELECT_GESTURE);

  /** Apply one event and report whether the click selects the whole value. */
  const dispatch = useCallback((event: Parameters<typeof reduceSelectGesture>[1]): boolean => {
    const outcome = reduceSelectGesture(gesture.current, event);
    gesture.current = outcome.gesture;
    return outcome.selectAll;
  }, []);

  const focus = useCallback(
    (type: string | undefined) => {
      dispatch({ type: "focus", selectsValue: selectsValueOnClick(type) });
    },
    [dispatch],
  );
  const blur = useCallback(
    (field: HTMLInputElement) => {
      dispatch({ type: "blur" });
      forgetRememberedSelection(field);
    },
    [dispatch],
  );
  const press = useCallback(
    (point: { x: number; y: number }) => {
      dispatch({ type: "press", x: point.x, y: point.y });
    },
    [dispatch],
  );
  const click = useCallback(
    (point: { x: number; y: number; shiftKey: boolean }) =>
      dispatch({ type: "click", x: point.x, y: point.y, shiftKey: point.shiftKey }),
    [dispatch],
  );

  useEffect(
    () => () => {
      gesture.current = IDLE_SELECT_GESTURE;
    },
    [],
  );

  return { focus, blur, press, click };
}
