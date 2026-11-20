/**
 * A drag and keyboard seam between the workspace and one panel beside it.
 *
 * The seam owns the gesture only: the caller keeps the size, clamps it to the
 * current viewport, and persists the result. Arrow keys move the seam, Shift
 * moves it faster, and a double click restores the default size. The visible
 * line sits on the panel edge; the hit area extends a few pixels either side so
 * a thin divider is still easy to grab.
 *
 * The editor's shortcut dispatcher listens on the window capture phase, so a
 * seam cannot outrank it with a listener of its own. The arrow keys therefore go
 * through the shared first-refusal registry (`registerKeyClaim`) while the seam
 * holds focus, exactly like the other mounted surfaces that own keys.
 */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { registerKeyClaim } from "../../../frontend/platform/shortcuts/keyClaims.ts";

/** Which side of the seam the resized region occupies. */
export type SplitterOrientation = "horizontal" | "vertical";

export interface SplitterProps {
  /** `horizontal` divides top from bottom; `vertical` divides left from right. */
  orientation: SplitterOrientation;
  /** Accessible name for the separator. */
  label: string;
  /** The owned region's current size in CSS pixels. */
  value: number;
  min: number;
  max: number;
  /** The size restored by a double click. */
  defaultValue: number;
  /** Whether the owned region is after the seam (below it or to its right). */
  invert?: boolean;
  /** Extra class naming the seam inside the shell layout. */
  className?: string;
  /** Called with the proposed size in CSS pixels. */
  onChange(value: number): void;
}

/** Arrow-key travel, and the larger step Shift asks for. */
const KEY_STEP = 4;
const KEY_STEP_LARGE = 16;

/**
 * The seam primitive.
 *
 * `aria-orientation` names the line, not the axis it resizes: a seam between
 * rows is horizontal and reports a vertical movement through the arrow keys.
 */
export function Splitter({
  orientation,
  label,
  value,
  min,
  max,
  defaultValue,
  invert = false,
  className,
  onChange,
}: SplitterProps) {
  const drag = useRef<{ pointerId: number; origin: number; value: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const seamRef = useRef<HTMLDivElement>(null);
  const horizontal = orientation === "horizontal";
  const clamp = useCallback((next: number) => Math.min(Math.max(next, min), max), [min, max]);
  /**
   * Move the seam by one key step.
   *
   * `grow` names the direction the owned region grows in, and `invert` flips the
   * pointer axis for a region that sits before the seam, so the same arrow always
   * means "make this region bigger" or "make it smaller" in both stays.
   */
  const step = useCallback(
    (grow: boolean, large: boolean) => {
      const direction = (grow ? 1 : -1) * (invert ? -1 : 1);
      onChange(clamp(value + direction * (large ? KEY_STEP_LARGE : KEY_STEP)));
    },
    [clamp, invert, onChange, value],
  );
  // The dispatcher runs on the window capture phase, so a focused seam asks it
  // for the arrow keys through the shared claims instead of matching them itself.
  useEffect(() => {
    const stepRef = { current: step };
    stepRef.current = step;
    return registerKeyClaim((event, context) => {
      if (context.textEntry || context.modal !== "none") {
        return false;
      }
      if (document.activeElement !== seamRef.current) {
        return false;
      }
      if (event.key === "Home" || event.key === "End") {
        onChange(event.key === "Home" ? min : max);
        event.preventDefault();
        return true;
      }
      const grow = horizontal ? event.key === "ArrowDown" : event.key === "ArrowRight";
      const shrink = horizontal ? event.key === "ArrowUp" : event.key === "ArrowLeft";
      if (!grow && !shrink) {
        return false;
      }
      stepRef.current(grow, event.shiftKey);
      event.preventDefault();
      return true;
    });
  }, [horizontal, min, max, onChange, step]);
  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) {
      return;
    }
    drag.current = {
      pointerId: event.pointerId,
      origin: horizontal ? event.clientY : event.clientX,
      value,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
    event.preventDefault();
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) {
      return;
    }
    const travel = (horizontal ? event.clientY : event.clientX) - current.origin;
    onChange(clamp(current.value + travel * (invert ? -1 : 1)));
  };
  const finishDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) {
      return;
    }
    drag.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };
  return (
    <div
      ref={seamRef}
      className={[
        "layout-splitter",
        horizontal ? "layout-splitter--horizontal" : "layout-splitter--vertical",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      role="separator"
      tabIndex={0}
      aria-orientation={orientation}
      aria-label={label}
      aria-valuemin={Math.round(min)}
      aria-valuemax={Math.round(max)}
      aria-valuenow={Math.round(value)}
      data-dragging={dragging ? "true" : undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={finishDrag}
      onPointerCancel={finishDrag}
      onDoubleClick={() => onChange(defaultValue)}
    />
  );
}
