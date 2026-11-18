/**
 * Pointer-approach reveal for floating controls that sit faint over a field.
 *
 * The hook reports whether the pointer is inside the control or within
 * `PROXIMITY_REVEAL_DISTANCE_PX` of its box, so the control becomes fully
 * visible while the pointer is still approaching it rather than only after it
 * is hovered. The distance rule lives in `proximityReveal.ts`; this file maps
 * pointer movement onto it and owns the listener lifecycle.
 *
 * Measurements are coalesced into one animation frame and the returned state
 * changes only when the approach threshold is crossed, so ordinary pointer
 * movement never re-renders the caller.
 */
import { useEffect, useRef, useState, type RefObject } from "react";
import { isPointNearRect, PROXIMITY_REVEAL_DISTANCE_PX } from "./proximityReveal.ts";

/** Handle returned to the control that opts into the approach reveal. */
export interface ProximityRevealHandle<T extends HTMLElement> {
  /** Attach to the control whose box the pointer approaches. */
  readonly ref: RefObject<T | null>;
  /** Whether the pointer is inside the control or within its proximity margin. */
  readonly revealed: boolean;
}

/** Tracks pointer proximity for one floating control. */
export function useProximityReveal<T extends HTMLElement>(
  marginPx: number = PROXIMITY_REVEAL_DISTANCE_PX,
): ProximityRevealHandle<T> {
  const ref = useRef<T>(null);
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    const control = ref.current;
    if (!control) {
      return undefined;
    }
    /** Last client-space pointer position; null while the pointer is away. */
    let pointer: { x: number; y: number } | null = null;
    let frame: number | null = null;

    const measure = (): void => {
      frame = null;
      if (pointer === null) {
        return;
      }
      const near = isPointNearRect(control.getBoundingClientRect(), pointer.x, pointer.y, marginPx);
      setRevealed((current) => (current === near ? current : near));
    };

    const scheduleMeasure = (): void => {
      if (frame === null) {
        frame = window.requestAnimationFrame(measure);
      }
    };

    const onPointerMove = (event: PointerEvent): void => {
      pointer = { x: event.clientX, y: event.clientY };
      scheduleMeasure();
    };

    const forgetPointer = (): void => {
      pointer = null;
      setRevealed(false);
    };

    window.addEventListener("pointermove", onPointerMove, { passive: true });
    window.addEventListener("blur", forgetPointer);
    document.documentElement.addEventListener("pointerleave", forgetPointer);
    // The control can move under a stationary pointer when a field scrolls or
    // the workspace resizes, so re-check the stored position after layout changes.
    window.addEventListener("scroll", scheduleMeasure, { capture: true, passive: true });
    window.addEventListener("resize", scheduleMeasure);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("blur", forgetPointer);
      document.documentElement.removeEventListener("pointerleave", forgetPointer);
      window.removeEventListener("scroll", scheduleMeasure, true);
      window.removeEventListener("resize", scheduleMeasure);
      if (frame !== null) {
        window.cancelAnimationFrame(frame);
      }
    };
  }, [marginPx]);

  return { ref, revealed };
}
