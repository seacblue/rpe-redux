/**
 * A range control with the value readout shown inside the track.
 *
 * Settings and script parameters share the same slider presentation; this
 * primitive owns the unit and percentage readout so callers only pass values.
 */
import type { ChangeEventHandler, InputHTMLAttributes, Ref } from "react";
import { Slider } from "./Slider.tsx";

export interface SliderFieldProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "type" | "value" | "min" | "max" | "step" | "onChange"
> {
  id: string;
  value: string | number;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  percentage?: boolean;
  /** Attach a surface handle directly to the range input. */
  inputRef?: Ref<HTMLInputElement>;
  onChange: ChangeEventHandler<HTMLInputElement>;
  /**
   * Runs once when a pointer, key, or focus interaction ends.
   *
   * Use this for settings that should not write on every drag step; `onChange`
   * still drives the live local readout.
   */
  onCommit?: (value: number) => void;
  [key: `data-${string}`]: unknown;
}

/** Keys that finish a keyboard adjustment when released. */
const COMMIT_KEYS = new Set([
  "ArrowLeft",
  "ArrowRight",
  "ArrowUp",
  "ArrowDown",
  "Home",
  "End",
  "PageUp",
  "PageDown",
]);

/** Wraps the shared slider with a readable value label. */
export function SliderField({
  id,
  value,
  min,
  max,
  step,
  unit,
  percentage = false,
  onChange,
  onCommit,
  onPointerUp,
  onKeyUp,
  onBlur,
  inputRef,
  ...props
}: SliderFieldProps) {
  const readout = percentage
    ? `${Math.round(Number(value) * (max === 100 ? 1 : 100))}%`
    : `${value}${unit ? ` ${unit}` : ""}`;
  return (
    <span className="redux-setting-range redux-setting-slider">
      <Slider
        ref={inputRef}
        id={id}
        min={min}
        max={max}
        step={step}
        value={value}
        data-slider="level"
        data-readout={percentage ? "percent" : "number"}
        onChange={onChange}
        aria-valuetext={readout}
        {...props}
        onPointerUp={(event) => {
          onPointerUp?.(event);
          if (!event.defaultPrevented) {
            onCommit?.(Number(event.currentTarget.value));
          }
        }}
        onKeyUp={(event) => {
          onKeyUp?.(event);
          if (!event.defaultPrevented && COMMIT_KEYS.has(event.key)) {
            onCommit?.(Number(event.currentTarget.value));
          }
        }}
        onBlur={(event) => {
          onBlur?.(event);
          if (!event.defaultPrevented) {
            onCommit?.(Number(event.currentTarget.value));
          }
        }}
      />
    </span>
  );
}
