/**
 * A labelled design-system knob with vertical pointer adjustment.
 *
 * The field keeps the normal label/control relationship while the knob owns
 * the interaction model: vertical drag, wheel, and keyboard value changes.
 */
import {
  useId,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";

// A 64px vertical travel covers the complete range with a direct linear map.
const DRAG_PIXELS_PER_FULL_RANGE = 64;

export interface KnobFieldProps {
  /** Text shown beside the knob and exposed as its accessible name. */
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  percentage?: boolean;
  disabled?: boolean;
  onChange(value: number): void;
}

interface KnobDragState {
  pointerId: number;
  startY: number;
  startValue: number;
}

/** Render a labelled knob field for compact numeric controls. */
export function KnobField({
  label,
  value,
  min = 0,
  max = 1,
  step = 0.01,
  percentage = false,
  disabled = false,
  onChange,
}: KnobFieldProps) {
  const controlId = useId();
  const labelId = `${controlId}-label`;
  return (
    <div className="redux-knob-field" data-disabled={disabled || undefined}>
      <label id={labelId} htmlFor={controlId} className="redux-knob-label">
        {label}
      </label>
      <Knob
        id={controlId}
        ariaLabel={label}
        value={value}
        min={min}
        max={max}
        step={step}
        percentage={percentage}
        disabled={disabled}
        onChange={onChange}
      />
    </div>
  );
}

interface KnobProps {
  id: string;
  ariaLabel: string;
  value: number;
  min: number;
  max: number;
  step: number;
  percentage: boolean;
  disabled: boolean;
  onChange(value: number): void;
}

/** Own the accessible slider semantics and pointer gesture for one knob. */
function Knob({ id, ariaLabel, value, min, max, step, percentage, disabled, onChange }: KnobProps) {
  const drag = useRef<KnobDragState | null>(null);
  const [dragging, setDragging] = useState(false);
  const boundedValue = normalizeValue(value, min, max, step);
  const ratio = rangeRatio(boundedValue, min, max);
  const readout = formatValue(boundedValue, min, max, percentage);
  const style = {
    "--knob-ratio": ratio,
    "--knob-angle": `${-135 + ratio * 270}deg`,
  } as CSSProperties;

  const changeBy = (amount: number) => {
    onChange(normalizeValue(boundedValue + amount, min, max, step));
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (disabled || event.button !== 0) {
      return;
    }
    event.currentTarget.focus();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = {
      pointerId: event.pointerId,
      startY: event.clientY,
      startValue: boundedValue,
    };
    setDragging(true);
    event.preventDefault();
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const active = drag.current;
    if (!active || active.pointerId !== event.pointerId) {
      return;
    }
    const range = max - min;
    const delta = ((active.startY - event.clientY) / DRAG_PIXELS_PER_FULL_RANGE) * range;
    onChange(normalizeValue(active.startValue + delta, min, max, step));
  };

  const stopDragging = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (drag.current?.pointerId !== event.pointerId) {
      return;
    }
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    drag.current = null;
    setDragging(false);
  };

  const onWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    if (disabled || event.deltaY === 0) {
      return;
    }
    event.preventDefault();
    changeBy(event.deltaY < 0 ? step : -step);
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (disabled) {
      return;
    }
    switch (event.key) {
      case "ArrowUp":
      case "ArrowRight":
        changeBy(step);
        break;
      case "ArrowDown":
      case "ArrowLeft":
        changeBy(-step);
        break;
      case "PageUp":
        changeBy(step * 10);
        break;
      case "PageDown":
        changeBy(-step * 10);
        break;
      case "Home":
        onChange(min);
        break;
      case "End":
        onChange(max);
        break;
      default:
        return;
    }
    event.preventDefault();
  };

  return (
    <div
      id={id}
      className="redux-knob"
      role="slider"
      tabIndex={disabled ? -1 : 0}
      aria-label={ariaLabel}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={boundedValue}
      aria-valuetext={readout}
      aria-disabled={disabled || undefined}
      data-dragging={dragging || undefined}
      style={style}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={stopDragging}
      onPointerCancel={stopDragging}
      onWheel={onWheel}
      onKeyDown={onKeyDown}
    >
      <span className="redux-knob-mark" aria-hidden="true" />
      <span className="redux-knob-value" aria-hidden="true">
        {readout}
      </span>
    </div>
  );
}

/** Clamp and step a controlled value before publishing it to the owner. */
function normalizeValue(value: number, min: number, max: number, step: number): number {
  const bounded = Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
  if (step <= 0) {
    return bounded;
  }
  const stepped = min + Math.round((bounded - min) / step) * step;
  return Number(Math.min(max, Math.max(min, stepped)).toFixed(8));
}

/** Convert a bounded value to the 0…1 range used by the knob arc. */
function rangeRatio(value: number, min: number, max: number): number {
  return max === min ? 0 : Math.min(1, Math.max(0, (value - min) / (max - min)));
}

/** Format the value shown inside the knob and announced to assistive tech. */
function formatValue(value: number, min: number, max: number, percentage: boolean): string {
  if (percentage) {
    const percent = max === 100 ? value : rangeRatio(value, min, max) * 100;
    return `${Math.round(percent)}%`;
  }
  return `${value}`;
}
