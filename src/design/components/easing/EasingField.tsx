/**
 * Three connected boxes for one easing value: id, direction, family.
 *
 * It is a labelled row like every other inspector field, so it can be dropped
 * between ordinary fields. The id box keeps a text draft: a half-typed number is
 * committed once, on Enter or on blur, so typing `23` is one edit and not two.
 * An out-of-range draft turns the box invalid rather than clamped — the text the
 * author typed stays in place and the chart keeps its old value — and the two
 * lists only offer the combinations the format defines.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { FieldRow } from "../field/FieldRow.tsx";
import { Input } from "../input/Input.tsx";
import { Select } from "../select/Select.tsx";
import { t, type MessageKey } from "../../../i18n/index.ts";
import {
  EASING_FAMILIES,
  EASING_MAX,
  EASING_MIN,
  easingDirections,
  easingId,
  easingParts,
  isEasingId,
  rotateEasingDirection,
  rotateEasingFamily,
  stepEasingId,
  type EasingDirection,
  type EasingFamily,
} from "./easingTable.ts";
import { easingDirectionControlState } from "./easingFieldModel.ts";

export interface EasingFieldProps {
  /** The stored easing id. */
  value: number;
  onChange(value: number): void;
  label: string;
  disabled?: boolean;
}

const DASH = "—";

/**
 * The family names are the chart format's own vocabulary — a reader who knows
 * the format looks for `Sine`/`Quad`, not for a translation. They still go
 * through the catalog so a translation may relabel them without editing code.
 */
const FAMILY_KEYS: Record<EasingFamily, MessageKey> = {
  Linear: "design.easing.family.linear",
  Sine: "design.easing.family.sine",
  Quad: "design.easing.family.quad",
  Cubic: "design.easing.family.cubic",
  Quart: "design.easing.family.quart",
  Quint: "design.easing.family.quint",
  Expo: "design.easing.family.expo",
  Circ: "design.easing.family.circ",
  Back: "design.easing.family.back",
  Elastic: "design.easing.family.elastic",
  Bounce: "design.easing.family.bounce",
};

const DIRECTION_KEYS: Record<EasingDirection, MessageKey> = {
  In: "design.easing.direction.in",
  Out: "design.easing.direction.out",
  InOut: "design.easing.direction.inOut",
};

/** Labelled easing editor: numeric id, family, and direction as one value. */
export function EasingField({ value, onChange, label, disabled = false }: EasingFieldProps) {
  const [draft, setDraft] = useState({ source: value, text: String(value) });
  const idInput = useRef<HTMLInputElement>(null);
  const familySelect = useRef<HTMLSelectElement>(null);
  const directionSelect = useRef<HTMLSelectElement>(null);
  if (draft.source !== value) {
    setDraft({ source: value, text: String(value) });
  }
  const text = draft.source === value ? draft.text : String(value);
  const entered = text.trim() === "" ? Number.NaN : Number(text);
  const valid = isEasingId(entered);
  const { family, direction } = easingParts(value);
  const directions = easingDirections(family);
  const directionControl = easingDirectionControlState(directions.length > 0, disabled);

  /** The one place the id is written: valid text only, never a clamped value. */
  const commit = (candidate: string) => {
    const number = candidate.trim() === "" ? Number.NaN : Number(candidate);
    if (!isEasingId(number)) {
      // Keep the rejected text so it can be corrected; the value is untouched.
      return;
    }
    setDraft({ source: value, text: String(number) });
    if (number !== value) {
      onChange(number);
    }
  };

  /** Move to a family, keeping the current direction when that family supports it. */
  const setFamily = useCallback(
    (next: EasingFamily) => {
      if (next === "Linear") {
        onChange(1);
        return;
      }
      const nextDirections = easingDirections(next);
      const nextDirection = nextDirections.includes(direction) ? direction : nextDirections[0];
      const id = easingId(next, nextDirection ?? "Out");
      if (id !== null) {
        onChange(id);
      }
    },
    [direction, onChange],
  );

  // Each easing box owns its wheel: the id steps numerically, while the two
  // lists rotate through their available options. Native listeners keep the
  // inspector from scrolling, including when the pointer is over a select.
  useEffect(() => {
    const id = idInput.current;
    const familyControl = familySelect.current;
    const directionControlElement = directionSelect.current;
    const listen = (element: HTMLElement | null, handle: (direction: number) => void) => {
      if (!element) {
        return () => {};
      }
      const wheel = (event: WheelEvent) => {
        if (disabled || !event.deltaY || event.defaultPrevented) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        handle(-Math.sign(event.deltaY));
      };
      element.addEventListener("wheel", wheel, { passive: false });
      return () => element.removeEventListener("wheel", wheel);
    };

    const removeIdWheel = listen(id, (step) => {
      const enteredValue = text.trim() === "" ? Number.NaN : Number(text);
      const next = stepEasingId(isEasingId(enteredValue) ? enteredValue : value, step);
      setDraft({ source: value, text: String(next) });
      if (next !== value) {
        onChange(next);
      }
    });
    const removeFamilyWheel = listen(familyControl, (step) => {
      setFamily(rotateEasingFamily(family, step));
    });
    const removeDirectionWheel = listen(directionControlElement, (step) => {
      const next = rotateEasingDirection(directions, direction, step);
      if (next !== null) {
        const id = easingId(family, next);
        if (id !== null) {
          onChange(id);
        }
      }
    });
    return () => {
      removeIdWheel();
      removeFamilyWheel();
      removeDirectionWheel();
    };
  }, [disabled, direction, directions, family, onChange, setFamily, text, value]);

  return (
    <FieldRow
      layout="inline"
      density="compact"
      className={`easing-field${disabled ? " is-disabled" : ""}`}
      partialDisabled={!disabled && directionControl.disabled}
      label={label}
      control={(id) => (
        <div className="easing-field-controls">
          <Input
            ref={idInput}
            id={id}
            className="easing-field-id"
            type="number"
            textAlign="center"
            min={EASING_MIN}
            max={EASING_MAX}
            step={1}
            value={text}
            disabled={disabled}
            aria-invalid={!valid}
            aria-label={t("design.easing.id")}
            onChange={(event) => {
              const next = event.currentTarget.value;
              setDraft({ source: value, text: next });
              // A wheel notch or a stepper press arrives as a synthesized event
              // without an `inputType`; there is no second keystroke coming, so
              // commit it at once. Typing keeps the draft until Enter or blur.
              const native = event.nativeEvent as Event & { inputType?: string };
              if (native.inputType === undefined) {
                commit(next);
              }
            }}
            onBlur={() => commit(text)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                commit(event.currentTarget.value);
                event.currentTarget.blur();
              } else if (event.key === "Escape") {
                setDraft({ source: value, text: String(value) });
              }
            }}
          />
          <Select
            ref={directionSelect}
            className="easing-field-direction"
            value={directions.length ? (direction ?? DASH) : DASH}
            disabled={directionControl.disabled}
            aria-disabled={directionControl.ariaDisabled}
            tabIndex={directionControl.tabIndex}
            aria-label={t("design.easing.direction")}
            onChange={(event) => {
              const id = easingId(family, event.currentTarget.value as EasingDirection);
              if (id !== null) {
                onChange(id);
              }
            }}
          >
            {directions.length ? (
              directions.map((name) => (
                <option key={name} value={name}>
                  {t(DIRECTION_KEYS[name])}
                </option>
              ))
            ) : (
              <option value={DASH}>{DASH}</option>
            )}
          </Select>
          <Select
            ref={familySelect}
            className="easing-field-family"
            value={family}
            disabled={disabled}
            aria-label={t("design.easing.family")}
            onChange={(event) => setFamily(event.currentTarget.value as EasingFamily)}
          >
            {EASING_FAMILIES.map((name) => (
              <option key={name} value={name}>
                {t(FAMILY_KEYS[name])}
              </option>
            ))}
          </Select>
        </div>
      )}
    />
  );
}
