/** Add wheel stepping to an input; callers may own the value through `update`. */
import { writeInputValue } from "./nativeValue.ts";

/** Attach a non-passive wheel handler that steps the value or delegates to `update`. */
export function numericWheel(
  input: HTMLInputElement,
  step = 1,
  update?: (direction: number) => void,
  onValueChange?: () => void,
): () => void {
  const wheel = (event: WheelEvent) => {
    if (!event.deltaY || input.disabled || input.readOnly) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const direction = -Math.sign(event.deltaY);
    if (update) {
      update(direction);
      return;
    }
    const value = Number(input.value);
    if (!Number.isFinite(value)) {
      return;
    }
    const minimum = input.min === "" ? -Infinity : Number(input.min);
    const maximum = input.max === "" ? Infinity : Number(input.max);
    writeInputValue(
      input,
      String(Number(Math.max(minimum, Math.min(maximum, value + direction * step)).toFixed(10))),
    );
    if (onValueChange) {
      onValueChange();
    } else {
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }
  };
  input.addEventListener("wheel", wheel, { passive: false });
  return () => input.removeEventListener("wheel", wheel);
}
