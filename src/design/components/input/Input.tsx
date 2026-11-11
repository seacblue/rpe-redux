/**
 * Text and number input primitive: native control styling plus the design system's
 * optional step buttons, wheel stepping, slider readout, and exact slider entry.
 * Callers own the value and any parsing.
 */
import {
  forwardRef,
  useEffect,
  useRef,
  useImperativeHandle,
  useLayoutEffect,
  useState,
  type CSSProperties,
  type InputHTMLAttributes,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";
import { Icon } from "../icon/Icon.tsx";
import { useTranslation } from "../../../i18n/react.ts";
import { ratioOf, readoutText, writeRangeValueAtPointer } from "../../controls/sliderMode.ts";
import { writeInputValue } from "../../controls/nativeValue.ts";

/** Where a control's own text sits inside its box. */
export type InputTextAlign = "left" | "center" | "right";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  "data-tip-title"?: string;
  "data-tip-desc"?: string;
  /** Tooltip content shown under the title, or alone when the field has no title. */
  tipDescription?: string;
  "data-slider"?: string;
  "data-readout"?: string;
  "data-redux-wheel"?: "custom";
  /**
   * Inner text alignment. The design default is the trailing edge, where a
   * value sits beside its reset action or step buttons; a caller that is a
   * compact toolbar cell or a composed control names another edge explicitly.
   */
  textAlign?: InputTextAlign;
  /** A bounded step field that is a ring rather than a line: past `max` comes `min`. */
  stepWrap?: boolean;
  /**
   * Tri-state checkbox: `true` draws the design's minus and sets the native
   * `indeterminate` property. The click policy stays with the caller.
   */
  indeterminate?: boolean;
  onNumericWheel?: (value: string, target: HTMLInputElement) => void;
}

/**
 * Adding this class is the whole opt-in for the step buttons. Whether those
 * buttons walk a ring or stop at the ends is a separate, explicit `stepWrap` —
 * the bounds of a field say nothing about which of the two its caller wants.
 *
 * The class lands on the native control through the caller's `className`, which
 * is why the rendered buttons carry a name of their own: the two must not be one
 * class, or the overlay's positioning would apply to the field as well.
 */
const STEPPER_CLASS = "redux-stepper";

/** How long a press must be held before it repeats, and how fast it then fires. */
const HOLD_DELAY_MS = 400;
const HOLD_REPEAT_MS = 70;

/** `step="any"` and a missing `step` still have to mean one thing to a button. */
/** The step size a button uses, falling back to 1 for `step="any"` or a missing step. */
function stepSize(input: HTMLInputElement): number {
  const step = Number(input.step);
  return Number.isFinite(step) && step > 0 ? step : 1;
}

/** Read a numeric min/max attribute, or `undefined` when it is absent or not finite. */
function bound(raw: string): number | undefined {
  if (raw === "") {
    return undefined;
  }
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

/** Step grid arithmetic accumulates 0.30000000000000004 without this. */
function roundToStep(value: number, step: number): number {
  const decimals = (String(step).split(".")[1] ?? "").length;
  return Number(value.toFixed(Math.min(decimals + 6, 12)));
}

/**
 * The value one step away from what the field holds.
 *
 * `wrap` is the caller's explicit choice, not something the bounds imply. A ring
 * needs both ends, so with `wrap` and two bounds, past the last value comes the
 * first and before the first comes the last. Everything else folds at its ends
 * the way the native control does.
 *
 * An empty field reads as its lower end, which is the value it would take if
 * someone filled it in.
 */
function steppedValue(
  input: HTMLInputElement,
  direction: number,
  multiplier: number,
  wrap: boolean,
): number {
  const step = stepSize(input);
  const minimum = bound(input.min);
  const maximum = bound(input.max);
  const current = input.value === "" ? undefined : Number(input.value);
  const settled = current !== undefined && Number.isFinite(current) ? current : undefined;
  const base = settled ?? minimum ?? maximum ?? 0;
  if (wrap && minimum !== undefined && maximum !== undefined) {
    // The values a step can reach, counted from the lower end. A settled value
    // outside the bounds is fine here — the modulo brings it back.
    const count = Math.floor((maximum - minimum) / step) + 1;
    const index = Math.round((base - minimum) / step);
    const wrapped = (((index + direction * multiplier) % count) + count) % count;
    return roundToStep(minimum + wrapped * step, step);
  }
  const next = base + direction * step * multiplier;
  return roundToStep(Math.min(maximum ?? Infinity, Math.max(minimum ?? -Infinity, next)), step);
}

/** Writes a stepped value back and lets the field's own listeners hear about it. */
function stepField(input: HTMLInputElement, direction: number, multiplier = 1, wrap = false): void {
  writeInputValue(input, String(steppedValue(input, direction, multiplier, wrap)));
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

/** The readout style a range input declares, defaulting to the filled level bar. */
function rangeMode(props: InputProps): "level" | "range" {
  const explicit = props["data-slider"];
  if (explicit === "level" || explicit === "range") {
    return explicit;
  }
  return "level";
}

/**
 * Input types where a click replaces the whole value.
 *
 * Only a numeric entry field holds one value the user almost always wants to
 * retype, so selecting it on click is an affordance. Every other text field —
 * prose, a name, a path, a search query or a multi-token expression — places the
 * caret where the click landed so one token can be edited without selecting the
 * rest.
 */
function selectsValueOnClick(type: string | undefined): boolean {
  return type === "number";
}

/** The native input plus optional stepper buttons, slider readout, and manual entry overlay. */
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  {
    className = "",
    onClick,
    onWheel,
    onWheelCapture,
    onInput,
    onChange,
    onInvalid,
    onFocus,
    onBlur,
    onContextMenu,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel,
    onLostPointerCapture,
    onNumericWheel,
    stepWrap = false,
    indeterminate = false,
    textAlign = "right",
    title,
    tipDescription,
    ...props
  },
  ref,
) {
  const { t } = useTranslation();
  const element = useRef<HTMLInputElement>(null);
  const decoration = useRef<HTMLSpanElement>(null);
  const cancelled = useRef(new WeakSet<Event>());
  const onWheelRef = useRef(onWheel);
  const customWheel = Boolean(onWheel);
  /** The next click may replace the whole value; later clicks keep the caret. */
  const selectOnClick = useRef(false);
  const [rangeReadout, setRangeReadout] = useState({ text: "", ratio: 0 });
  const [manualEntry, setManualEntry] = useState(false);
  const [manualText, setManualText] = useState("");
  const manualField = useRef<HTMLInputElement>(null);
  const manualDone = useRef(false);
  /** The pointer that owns a range drag and whether it has written a new value. */
  const rangeDrag = useRef<{ pointerId: number; changed: boolean } | null>(null);
  /** Detaches window safety-net listeners when a range drag ends. */
  const rangeDragCleanup = useRef<(() => void) | null>(null);
  const [decorationBounds, setDecorationBounds] = useState({
    left: 0,
    top: 0,
    width: 0,
    height: 0,
  });
  const isLevelRange =
    props.type === "range" && props.hidden !== true && rangeMode(props) === "level";
  const readoutMode = props["data-readout"];
  const numericWheelMode = props["data-redux-wheel"];
  const isDecoratedCheckbox = props.type === "checkbox";
  const isStepper = props.type === "number" && className.split(/\s+/).includes(STEPPER_CLASS);

  const hold = useRef({ delay: 0, repeat: 0 });
  const stopHold = () => {
    window.clearTimeout(hold.current.delay);
    window.clearInterval(hold.current.repeat);
    hold.current.delay = 0;
    hold.current.repeat = 0;
  };

  const refreshReadout = (input: HTMLInputElement) => {
    if (!isLevelRange) {
      return;
    }
    // Keep the readout in React's event batch: a synchronous render here resets
    // a controlled input to its old prop before its onChange can read the new value.
    const text = readoutText(input);
    const ratio = ratioOf(input);
    setRangeReadout((current) =>
      current.text === text && current.ratio === ratio ? current : { text, ratio },
    );
  };

  // A range paints its own value inside the bar; the first paint and every
  // external value change need the readout without waiting for a user event.
  useEffect(() => {
    const input = element.current;
    if (!input || !isLevelRange) {
      return;
    }
    const text = readoutText(input);
    const ratio = ratioOf(input);
    setRangeReadout((current) =>
      current.text === text && current.ratio === ratio ? current : { text, ratio },
    );
  }, [isLevelRange, props.value, props.defaultValue]);

  useEffect(() => {
    if (!manualEntry) {
      return;
    }
    const field = manualField.current;
    field?.focus();
    field?.select();
  }, [manualEntry]);

  /** Opens the exact-value editor over the readout bar. */
  const beginManualEntry = () => {
    const input = element.current;
    if (!input || input.disabled || input.readOnly) {
      return;
    }
    manualDone.current = false;
    setManualText(input.value);
    setManualEntry(true);
  };

  /** Close the editor, optionally snapping its text back onto the native range. */
  const finishManualEntry = (commit: boolean) => {
    if (manualDone.current) {
      return;
    }
    manualDone.current = true;
    const input = element.current;
    const field = manualField.current;
    if (commit && input && field && field.value.trim() !== "") {
      const raw = Number(field.value);
      if (Number.isFinite(raw)) {
        const step = stepSize(input);
        const minimum = bound(input.min) ?? -Infinity;
        const maximum = bound(input.max) ?? Infinity;
        // Range values use `min` as their step base. Keeping the same base for
        // typed values prevents a non-zero minimum from snapping to an invalid
        // grid point before the bounds clamp runs.
        const stepBase = Number.isFinite(minimum) ? minimum : 0;
        const next = roundToStep(stepBase + Math.round((raw - stepBase) / step) * step, step);
        writeInputValue(input, String(Math.min(maximum, Math.max(minimum, next))));
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
        refreshReadout(input);
      }
    }
    setManualEntry(false);
  };

  useLayoutEffect(() => {
    const input = element.current;
    const node = decoration.current;
    const host = input?.parentElement;
    if (!input || !node || !host || (!isLevelRange && !isStepper)) {
      return;
    }
    const place = () => {
      if (getComputedStyle(host).position === "static") {
        host.style.position = "relative";
      }
      const hostBox = host.getBoundingClientRect();
      const inputBox = input.getBoundingClientRect();
      const style = getComputedStyle(host);
      const borderLeft = Number.parseFloat(style.borderLeftWidth) || 0;
      const borderTop = Number.parseFloat(style.borderTopWidth) || 0;
      setDecorationBounds({
        left: inputBox.left - hostBox.left - borderLeft,
        top: inputBox.top - hostBox.top - borderTop,
        width: input.clientWidth,
        height: input.clientHeight,
      });
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(input);
    observer.observe(host);
    window.addEventListener("resize", place);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", place);
    };
  }, [isLevelRange, isStepper, manualEntry]);

  useEffect(() => stopHold, []);

  /**
   * Finish a range drag once: detach the fallback, release capture, and report
   * one change when the drag wrote at least one new value.
   */
  const endRangeDrag = (pointerId?: number): void => {
    const drag = rangeDrag.current;
    if (!drag || (pointerId !== undefined && drag.pointerId !== pointerId)) {
      return;
    }
    rangeDrag.current = null;
    rangeDragCleanup.current?.();
    rangeDragCleanup.current = null;
    const input = element.current;
    if (input) {
      try {
        if (input.hasPointerCapture(drag.pointerId)) {
          input.releasePointerCapture(drag.pointerId);
        }
      } catch {
        /* The pointer may already be gone. */
      }
    }
    if (drag.changed && input) {
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }
  };

  /** Follow an active range drag with the pointer's current x-coordinate. */
  const moveRangeDrag = (pointerId: number, clientX: number): void => {
    const drag = rangeDrag.current;
    const input = element.current;
    if (!drag || drag.pointerId !== pointerId || !input) {
      return;
    }
    if (writeRangeValueAtPointer(input, clientX)) {
      drag.changed = true;
    }
  };

  /**
   * Take over a range drag from the native control.
   *
   * The native thumb stops updating once the pointer leaves the control, and its
   * rail ends are inset from the border, so dragging to an end is unreliable.
   * Capturing the pointer keeps the drag live across the rest of the window.
   * Window listeners remain attached as a second safety net because WebViews
   * can lose capture when the pointer crosses native or overlay surfaces.
   */
  const beginRangeDrag = (event: ReactPointerEvent<HTMLInputElement>): void => {
    const input = event.currentTarget;
    if (input.type !== "range" || event.button !== 0 || input.disabled || input.readOnly) {
      return;
    }
    // Suppressing the native press also suppresses its drag and click-to-set;
    // the value write below replaces both.
    event.preventDefault();
    // Keep the keyboard path alive: a prevented native press would not focus.
    input.focus({ preventScroll: true });
    endRangeDrag();
    const drag = { pointerId: event.pointerId, changed: false };
    rangeDrag.current = drag;
    const move = (pointer: PointerEvent) => {
      if (pointer.pointerId === drag.pointerId) {
        moveRangeDrag(drag.pointerId, pointer.clientX);
      }
    };
    const finish = (pointer: PointerEvent) => {
      if (pointer.pointerId === drag.pointerId) {
        endRangeDrag(drag.pointerId);
      }
    };
    window.addEventListener("pointermove", move, true);
    window.addEventListener("pointerup", finish, true);
    window.addEventListener("pointercancel", finish, true);
    rangeDragCleanup.current = () => {
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("pointerup", finish, true);
      window.removeEventListener("pointercancel", finish, true);
    };
    try {
      input.setPointerCapture(event.pointerId);
    } catch {
      /* The window listeners above are the fallback for platforms without capture. */
    }
    if (writeRangeValueAtPointer(input, event.clientX)) {
      drag.changed = true;
    }
  };

  useEffect(
    () => () => {
      rangeDragCleanup.current?.();
      rangeDragCleanup.current = null;
      rangeDrag.current = null;
    },
    [],
  );

  const startHold = (event: ReactPointerEvent<HTMLButtonElement>, direction: 1 | -1) => {
    const input = element.current;
    if (!input || input.disabled || input.readOnly) {
      return;
    }
    // Capture so the release lands here even when the pointer has left the
    // button, which is what makes a long press safe to start.
    event.currentTarget.setPointerCapture(event.pointerId);
    stopHold();
    const tick = () => {
      stepField(input, direction, 1, stepWrap);
      onNumericWheel?.(input.value, input);
    };
    tick();
    hold.current.delay = window.setTimeout(() => {
      hold.current.repeat = window.setInterval(tick, HOLD_REPEAT_MS);
    }, HOLD_DELAY_MS);
  };

  useImperativeHandle(ref, () => {
    const input = element.current;
    if (!input) {
      throw new Error("Input element is unavailable while binding its ref");
    }
    return input;
  }, []);
  // `indeterminate` is a DOM property, not an attribute, so React cannot carry
  // it as a prop. The layout effect writes it after every commit, which keeps a
  // tri-state decorator and the native state in step.
  useLayoutEffect(() => {
    const input = element.current;
    if (input && props.type === "checkbox") {
      input.indeterminate = indeterminate;
    }
  }, [indeterminate, props.type]);
  useLayoutEffect(() => {
    const input = element.current;
    if (!input || props.type !== "range" || !isLevelRange) {
      return;
    }
    setRangeReadout({
      text: readoutText(input),
      ratio: ratioOf(input),
    });
  }, [
    isLevelRange,
    props.type,
    props.value,
    props.defaultValue,
    props.min,
    props.max,
    props.step,
    readoutMode,
  ]);
  useEffect(() => {
    onWheelRef.current = onWheel;
  }, [onWheel]);
  // React delegates wheel through a passive listener, so a caller's custom
  // handler cannot keep the inspector from scrolling. Own the event natively so
  // the handler can prevent the default scroll.
  useEffect(() => {
    const input = element.current;
    if (!input || !customWheel) {
      return;
    }
    const wheel = (event: WheelEvent) => {
      onWheelRef.current?.(event as unknown as ReactWheelEvent<HTMLInputElement>);
    };
    input.addEventListener("wheel", wheel, { passive: false });
    return () => input.removeEventListener("wheel", wheel);
  }, [customWheel]);
  useEffect(() => {
    const input = element.current;
    if (!input || props.type !== "number" || numericWheelMode === "custom" || customWheel) {
      return;
    }
    const wheel = (event: WheelEvent) => {
      if (cancelled.current.has(event)) {
        event.preventDefault();
        return;
      }
      if (
        props.disabled ||
        props.readOnly ||
        document.activeElement !== input ||
        event.defaultPrevented ||
        event.deltaY === 0
      ) {
        return;
      }
      // React wheel handlers are passive in Chromium. Cancel the native step/scroll here.
      event.preventDefault();
      const multiplier = event.shiftKey ? 10 : event.ctrlKey ? 5 : 1;
      // The wheel takes the same path the buttons do, `stepWrap` and all; the
      // native step would stop dead at either end.
      if (isStepper) {
        stepField(input, event.deltaY < 0 ? 1 : -1, multiplier, stepWrap);
        onNumericWheel?.(input.value, input);
        return;
      }
      try {
        event.deltaY < 0 ? input.stepUp(multiplier) : input.stepDown(multiplier);
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
        onNumericWheel?.(input.value, input);
      } catch {
        /* step=any */
      }
    };
    input.addEventListener("wheel", wheel, { passive: false });
    return () => input.removeEventListener("wheel", wheel);
  }, [
    props.type,
    props.disabled,
    props.readOnly,
    numericWheelMode,
    customWheel,
    isStepper,
    stepWrap,
    onNumericWheel,
  ]);
  // The stepper column and the slider readout are siblings of a control whose
  // size the panel decides, so their box has to be measured. The checkbox tick
  // is not measured: its wrapper below is exactly the control's box.
  const overlayBox = {
    left: `${decorationBounds.left}px`,
    top: `${decorationBounds.top}px`,
    width: `${decorationBounds.width}px`,
    height: `${decorationBounds.height}px`,
  };
  const control = (
    <input
      ref={element}
      className={`redux-input ${className}`}
      // Some inspector fields attach a feature-specific nonpassive wheel
      // handler; this marker prevents the generic handler from duplicating it.
      data-redux-wheel={props["data-redux-wheel"]}
      data-redux-slider={props.type === "range" ? rangeMode(props) : undefined}
      {...props}
      autoComplete="off"
      data-text-align={textAlign}
      data-tip-title={props["data-tip-title"] ?? title}
      data-tip-desc={props["data-tip-desc"] ?? tipDescription}
      onInput={(event) => {
        onInput?.(event);
        refreshReadout(event.currentTarget);
      }}
      onChange={(event) => {
        onChange?.(event);
        refreshReadout(event.currentTarget);
      }}
      onInvalid={(event) => {
        // The design system paints its own invalid state; the WebView's native
        // validation bubble is not part of that surface.
        event.preventDefault();
        onInvalid?.(event);
      }}
      onFocus={(event) => {
        onFocus?.(event);
        // Each focus starts one select-all gesture; clicking again while the
        // field still has focus must leave the caret where the pointer landed.
        selectOnClick.current = selectsValueOnClick(event.currentTarget.type);
      }}
      onBlur={(event) => {
        onBlur?.(event);
        selectOnClick.current = false;
      }}
      onContextMenu={(event) => {
        onContextMenu?.(event);
        if (isLevelRange && !event.currentTarget.disabled && !event.currentTarget.readOnly) {
          event.preventDefault();
          beginManualEntry();
        }
      }}
      onPointerDown={(event) => {
        onPointerDown?.(event);
        beginRangeDrag(event);
      }}
      onPointerMove={(event) => {
        onPointerMove?.(event);
        moveRangeDrag(event.pointerId, event.clientX);
      }}
      onPointerUp={(event) => {
        onPointerUp?.(event);
        endRangeDrag(event.pointerId);
      }}
      onPointerCancel={(event) => {
        onPointerCancel?.(event);
        endRangeDrag(event.pointerId);
      }}
      onLostPointerCapture={(event) => {
        onLostPointerCapture?.(event);
        // Window listeners own the drag lifecycle when capture is lost.
      }}
      onClick={(event) => {
        onClick?.(event);
        if (selectOnClick.current && !event.currentTarget.disabled) {
          selectOnClick.current = false;
          // Keep this in the click phase so the browser has finished its native
          // caret placement before the shared field applies its select-all UX.
          event.currentTarget.select();
        }
      }}
      onWheelCapture={(event) => {
        onWheelCapture?.(event);
        if (event.defaultPrevented) {
          cancelled.current.add(event.nativeEvent);
        }
      }}
    />
  );
  if (isDecoratedCheckbox) {
    // The wrapper is exactly the native control's box. The tick and the thick
    // indeterminate bar are centred in it; checked/indeterminate state chooses
    // which one is visible.
    return (
      <span className="redux-checkbox">
        {control}
        <Icon name="check" size={16} className="redux-check redux-check-tick" />
        <span className="redux-check-bar" aria-hidden="true" />
      </span>
    );
  }
  return (
    <>
      {control}
      {isStepper && (
        <span ref={decoration} className="redux-stepper-buttons" style={overlayBox}>
          <button
            type="button"
            className="redux-stepper-button redux-stepper-up"
            // The field itself stays the keyboard path: arrows already step it,
            // so the buttons are the pointer affordance and add no tab stop.
            tabIndex={-1}
            aria-label={t("design.numberInput.increase")}
            data-tip-title={t("design.numberInput.increase")}
            disabled={props.disabled === true || props.readOnly === true}
            onPointerDown={(event) => startHold(event, 1)}
            onPointerUp={stopHold}
            onPointerCancel={stopHold}
            onLostPointerCapture={stopHold}
          >
            <Icon name="chevronDown" size={14} />
          </button>
          <button
            type="button"
            className="redux-stepper-button redux-stepper-down"
            tabIndex={-1}
            aria-label={t("design.numberInput.decrease")}
            data-tip-title={t("design.numberInput.decrease")}
            disabled={props.disabled === true || props.readOnly === true}
            onPointerDown={(event) => startHold(event, -1)}
            onPointerUp={stopHold}
            onPointerCancel={stopHold}
            onLostPointerCapture={stopHold}
          >
            <Icon name="chevronDown" size={14} />
          </button>
        </span>
      )}
      {isLevelRange && !manualEntry && (
        <span
          ref={decoration}
          className="redux-slider"
          aria-hidden="true"
          style={
            {
              ...overlayBox,
              "--redux-ratio": `${(rangeReadout.ratio * 100).toFixed(3)}%`,
              "--redux-track-width": `${decorationBounds.width}px`,
            } as CSSProperties
          }
        >
          <span className="redux-slider-fill" />
          <span className="redux-slider-value">{rangeReadout.text}</span>
          <span className="redux-slider-value-clip">
            <span>{rangeReadout.text}</span>
          </span>
        </span>
      )}
      {manualEntry && (
        <input
          ref={manualField}
          className="redux-slider-manual"
          type="number"
          style={overlayBox}
          min={props.min}
          max={props.max}
          step={props.step}
          value={manualText}
          aria-label={props["aria-label"]}
          onChange={(event) => setManualText(event.currentTarget.value)}
          onBlur={() => finishManualEntry(true)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              finishManualEntry(true);
            } else if (event.key === "Escape") {
              event.preventDefault();
              finishManualEntry(false);
            }
          }}
          onInvalid={(event) => event.preventDefault()}
        />
      )}
    </>
  );
});
