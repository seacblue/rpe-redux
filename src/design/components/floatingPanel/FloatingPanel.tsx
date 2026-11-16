/**
 * Shared draggable floating panel chrome for compact editor surfaces.
 *
 * The primitive owns the title-bar drag contract, viewport clamping, and the
 * header/body/footer structure. Callers own the panel content and persistence
 * of the position they receive from `onPositionChange`.
 */
import {
  forwardRef,
  useEffect,
  useRef,
  type CSSProperties,
  type HTMLAttributes,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { clampFloatingPanelPosition } from "./floatingPanelPlacement.ts";

/** A viewport-relative position for a floating panel. */
export interface FloatingPanelPosition {
  left: number;
  top: number;
}

/** Props for a compact panel with a draggable title bar and optional footer. */
export interface FloatingPanelProps {
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
  style?: CSSProperties;
  position?: FloatingPanelPosition;
  onPositionChange?: (position: FloatingPanelPosition) => void;
  /** Keep the panel below a host-owned top bar while it is being dragged. */
  safeTop?: number;
  role?: HTMLAttributes<HTMLDivElement>["role"];
  "aria-label"?: string;
  onPointerDown?: (event: ReactPointerEvent<HTMLDivElement>) => void;
}

interface DragState {
  pointerId: number;
  offsetX: number;
  offsetY: number;
}

/** Read the host chrome inset shared by every draggable floating surface. */
function floatingPanelSafeTop(): number {
  if (typeof document === "undefined") {
    return 0;
  }
  const value = Number.parseFloat(
    getComputedStyle(document.documentElement).getPropertyValue("--titlebar-height"),
  );
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

/** Shared floating panel with one drag implementation for all panel owners. */
export const FloatingPanel = forwardRef<HTMLDivElement, FloatingPanelProps>(function FloatingPanel(
  {
    title,
    children,
    footer,
    className = "",
    style,
    position,
    onPositionChange,
    safeTop,
    role = "dialog",
    "aria-label": ariaLabel,
    onPointerDown,
  },
  forwardedRef,
) {
  const panel = useRef<HTMLDivElement>(null);
  const drag = useRef<DragState | null>(null);
  const removeDragListeners = useRef<(() => void) | null>(null);
  const safeTopInset = safeTop ?? floatingPanelSafeTop();

  useEffect(
    () => () => {
      removeDragListeners.current?.();
    },
    [],
  );

  /** Start tracking a primary-button drag from the shared title bar. */
  const beginDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !onPositionChange) {
      return;
    }
    const element = panel.current;
    if (!element) {
      return;
    }
    const bounds = element.getBoundingClientRect();
    const pointerId = event.pointerId;
    drag.current = {
      pointerId,
      offsetX: event.clientX - bounds.left,
      offsetY: event.clientY - bounds.top,
    };
    event.preventDefault();
    const move = (moveEvent: PointerEvent) => {
      const current = drag.current;
      const currentPanel = panel.current;
      if (!current || current.pointerId !== moveEvent.pointerId || !currentPanel) {
        return;
      }
      onPositionChange(
        clampFloatingPanelPosition(
          moveEvent.clientX - current.offsetX,
          moveEvent.clientY - current.offsetY,
          { width: currentPanel.offsetWidth, height: currentPanel.offsetHeight },
          safeTopInset,
          { width: window.innerWidth, height: window.innerHeight },
        ),
      );
    };
    const finish = (finishEvent: PointerEvent) => {
      if (finishEvent.pointerId !== pointerId) {
        return;
      }
      drag.current = null;
      removeDragListeners.current?.();
    };
    const cleanup = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      if (removeDragListeners.current === cleanup) {
        removeDragListeners.current = null;
      }
    };
    removeDragListeners.current?.();
    removeDragListeners.current = cleanup;
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
  };

  const panelStyle: CSSProperties = {
    ...style,
    ...(position ? { left: position.left, top: position.top } : {}),
  };

  return (
    <div
      ref={(node) => {
        panel.current = node;
        if (typeof forwardedRef === "function") {
          forwardedRef(node);
        } else if (forwardedRef) {
          forwardedRef.current = node;
        }
      }}
      className={`redux-floating-panel ${className}`.trim()}
      style={panelStyle}
      role={role}
      aria-label={ariaLabel}
      onPointerDown={onPointerDown}
    >
      <div
        className="redux-floating-panel-header"
        onPointerDown={beginDrag}
        data-draggable={Boolean(onPositionChange)}
      >
        <span className="redux-floating-panel-title">{title}</span>
        <span className="redux-floating-panel-grip" aria-hidden="true">
          ⠿
        </span>
      </div>
      <div className="redux-floating-panel-body">{children}</div>
      {footer ? <div className="redux-floating-panel-footer">{footer}</div> : null}
    </div>
  );
});
