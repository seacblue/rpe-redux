/**
 * Two-or-more mutually exclusive choices, laid out as a labelled row.
 *
 * The inspector uses it where a radio group would be correct but a stack of
 * radios costs a row per option: the label sits on the left like every other
 * field, and the choices sit on the right as one connected control. It owns no
 * product state; callers pass the current value and receive the next one.
 *
 * The selected fill is one absolutely positioned thumb, measured from the
 * selected option and moved with a spring. The option itself stays transparent,
 * so switching slides the fill instead of fading two separate backgrounds.
 */
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

export interface SegmentedOption<T extends string> {
  value: T;
  label: ReactNode;
  /** Tooltip and accessible name for icon-only choices. */
  title?: string;
  ariaLabel?: string;
  disabled?: boolean;
}

export interface SegmentedProps<T extends string> {
  /** Visible row label. Omitted when the choices name what they switch. */
  label?: ReactNode;
  /** Names the group for assistive technology when there is no visible label. */
  ariaLabel?: string;
  value: T;
  options: readonly SegmentedOption<T>[];
  onChange(value: T): void;
  disabled?: boolean;
  className?: string;
}

/** A labelled radio group laid out as one connected control. */
export function Segmented<T extends string>({
  label,
  ariaLabel,
  value,
  options,
  onChange,
  disabled = false,
  className = "",
}: SegmentedProps<T>) {
  const optionsRef = useRef<HTMLDivElement>(null);
  const [thumb, setThumb] = useState<{ x: number; width: number } | null>(null);

  useLayoutEffect(() => {
    const container = optionsRef.current;
    if (!container) {
      return undefined;
    }
    /** Measure the selected option relative to the control's padding box. */
    const measure = () => {
      const selected = container.querySelector<HTMLElement>(".redux-segmented-option.is-selected");
      if (!selected) {
        setThumb(null);
        return;
      }
      // Layout metrics, not client rects: a dialog that is still scaling in
      // reports transformed rectangles, and a width taken from one would be
      // permanently too small. The option's offset parent is the positioned
      // options box, so these values are already in the control's own pixels.
      const next = {
        x: selected.offsetLeft,
        width: selected.offsetWidth,
      };
      setThumb((previous) =>
        previous && previous.x === next.x && previous.width === next.width ? previous : next,
      );
    };
    measure();
    if (typeof ResizeObserver === "undefined") {
      return undefined;
    }
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    return () => observer.disconnect();
  }, [options, value]);

  return (
    <div className={`redux-segmented ${className}`}>
      {label !== undefined && <span className="redux-segmented-label">{label}</span>}
      <div
        className="redux-segmented-options"
        role="radiogroup"
        aria-label={ariaLabel}
        ref={optionsRef}
      >
        {thumb && (
          <span
            className="redux-segmented-thumb"
            aria-hidden="true"
            style={{ transform: `translateX(${thumb.x}px)`, width: `${thumb.width}px` }}
          />
        )}
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={selected}
              className={`redux-segmented-option${selected ? " is-selected" : ""}`}
              disabled={disabled || option.disabled}
              aria-label={option.ariaLabel ?? option.title}
              data-tip-title={option.title}
              onClick={() => {
                if (!selected) {
                  onChange(option.value);
                }
              }}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
