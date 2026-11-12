/**
 * The compact Inspector page layout: one list face above one property face.
 *
 * Each face scrolls independently. The seam is a fixed separator so a narrow
 * inspector still reaches every control without adding another interaction.
 */
import { useId, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";

/** Per-page defaults; pages may opt out of the resize interaction. */
export interface InspectorPageSplitProps {
  top: React.ReactNode;
  bottom: React.ReactNode;
  /** Accessible names for the two scroll regions and the seam. */
  topLabel: string;
  bottomLabel: string;
  /** Smallest useful face height in pixels. */
  minTop?: number;
  minBottom?: number;
  /** Initial share of the available height given to the top face. */
  initialRatio?: number;
  /** Whether the separator exposes the resize interaction. */
  resizable?: boolean;
}

/** Default top share; leaves most of the page for the selected object. */
const DEFAULT_RATIO = 0.42;

/** Restricts one split share to the range both faces can use. */
function clampRatio(ratio: number, height: number, minTop: number, minBottom: number): number {
  if (height <= 0) {
    return ratio;
  }
  const minimum = minTop / height;
  const maximum = 1 - minBottom / height;
  if (minimum >= maximum) {
    return 0.5;
  }
  return Math.min(maximum, Math.max(minimum, ratio));
}

/** A list/properties split for a compact Inspector page. */
export function InspectorPageSplit({
  top,
  bottom,
  topLabel,
  bottomLabel,
  minTop = 108,
  minBottom = 148,
  initialRatio = DEFAULT_RATIO,
  resizable = true,
}: InspectorPageSplitProps) {
  const container = useRef<HTMLDivElement>(null);
  const [ratio, setRatio] = useState(initialRatio);
  const ratioRef = useRef(ratio);
  const topId = useId();
  const bottomId = useId();

  /** Applies one share from the live container height. */
  const applyRatio = (next: number): void => {
    const height = container.current?.getBoundingClientRect().height ?? 0;
    const clamped = clampRatio(next, height, minTop, minBottom);
    ratioRef.current = clamped;
    setRatio(clamped);
  };

  /** Starts a pointer drag and follows it until pointer capture is released. */
  const startDrag = (event: PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const move = (moveEvent: globalThis.PointerEvent) => {
      const rect = container.current?.getBoundingClientRect();
      if (!rect || rect.height <= 0) {
        return;
      }
      applyRatio((moveEvent.clientY - rect.top) / rect.height);
    };
    const end = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
  };

  /** Resets the page's split to its authored share. */
  const reset = (): void => {
    ratioRef.current = initialRatio;
    setRatio(initialRatio);
  };

  /** Moves the seam by keyboard; Home and End reach the allowed extremes. */
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const step = event.shiftKey ? 0.1 : 0.04;
    if (event.key === "ArrowUp") {
      event.preventDefault();
      applyRatio(ratioRef.current - step);
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      applyRatio(ratioRef.current + step);
    } else if (event.key === "Home") {
      event.preventDefault();
      applyRatio(0);
    } else if (event.key === "End") {
      event.preventDefault();
      applyRatio(1);
    }
  };

  return (
    <div
      ref={container}
      className={`inspector-page-split${resizable ? "" : " is-static"}`}
      style={{
        gridTemplateRows: `minmax(0, ${ratio}fr) var(--space-3) minmax(0, ${1 - ratio}fr)`,
      }}
    >
      <div id={topId} className="inspector-page-split-top" aria-label={topLabel} role="region">
        {top}
      </div>
      <div
        className="inspector-page-split-seam"
        role="separator"
        aria-orientation="horizontal"
        aria-label={`${topLabel} / ${bottomLabel}`}
        {...(resizable
          ? {
              tabIndex: 0,
              "aria-controls": `${topId} ${bottomId}`,
              "aria-valuemin": 0,
              "aria-valuemax": 100,
              "aria-valuenow": Math.round(ratio * 100),
              onPointerDown: startDrag,
              onDoubleClick: reset,
              onKeyDown,
            }
          : {})}
      >
        <span className="inspector-page-split-grip" aria-hidden="true" />
      </div>
      <div
        id={bottomId}
        className="inspector-page-split-bottom"
        aria-label={bottomLabel}
        role="region"
      >
        {bottom}
      </div>
    </div>
  );
}
