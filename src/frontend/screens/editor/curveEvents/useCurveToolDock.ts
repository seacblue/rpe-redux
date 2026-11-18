/**
 * Drag state for the floating curve tool dock.
 *
 * The dock is positioned in pixels inside the overlay layer. This hook owns only
 * that position and the pointer capture arithmetic; the dock's buttons stay in
 * `CurveToolDock`.
 */
import { useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import type { WindowPosition } from "./overlayModel.ts";

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

/** Track the dock's layer-local position and return its drag handler. */
export function useCurveToolDock(layer: RefObject<HTMLDivElement | null>): {
  position: WindowPosition;
  beginDrag(event: ReactPointerEvent<HTMLDivElement>): void;
} {
  const [position, setPosition] = useState<WindowPosition>({ x: 16, y: 16 });
  const dragWindow = useRef<{ pointerId: number; offsetX: number; offsetY: number } | null>(null);

  /** Start a drag from the dock's grip or background. */
  const beginDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) {
      return;
    }
    const dock = event.currentTarget;
    event.preventDefault();
    const rect = dock.getBoundingClientRect();
    const pointerId = event.pointerId;
    dragWindow.current = {
      pointerId,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
    };
    const move = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) {
        return;
      }
      const bounds = layer.current?.getBoundingClientRect();
      const current = dock.getBoundingClientRect();
      if (!bounds) {
        return;
      }
      setPosition({
        x: clamp(
          moveEvent.clientX - bounds.left - (dragWindow.current?.offsetX ?? 0),
          0,
          Math.max(0, bounds.width - current.width),
        ),
        y: clamp(
          moveEvent.clientY - bounds.top - (dragWindow.current?.offsetY ?? 0),
          0,
          Math.max(0, bounds.height - current.height),
        ),
      });
    };
    const finish = () => {
      dragWindow.current = null;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
  };

  return { position, beginDrag };
}
