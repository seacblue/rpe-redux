/**
 * Draws one schema value with the design control its kind names.
 *
 * Settings definitions and extension parameter schemas describe the same small
 * set of values. Keeping the dispatch here means a new control kind is added in
 * one place instead of once per form.
 */
import { useState, type ReactNode } from "react";
import { ColorField } from "../input/ColorField.tsx";
import { Input } from "../input/Input.tsx";
import { Textarea } from "../input/Textarea.tsx";
import { Select } from "../select/Select.tsx";
import { SliderField } from "../slider/SliderField.tsx";

export type SchemaControlKind = "text" | "number" | "range" | "toggle" | "select" | "color";

export interface SchemaControlOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SchemaControlProps {
  id: string;
  kind: SchemaControlKind;
  value: string | number | boolean;
  onChange(value: string | boolean): void;
  describedBy?: string;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  percentage?: boolean;
  placeholder?: string;
  multiline?: boolean;
  rows?: number;
  maxLength?: number;
  options?: readonly SchemaControlOption[];
  /** A leading disabled option, used by schemas that require an explicit pick. */
  emptyOption?: string;
  /** Optional control placed after the value, such as a line-allocation action. */
  trailing?: ReactNode;
  autoFocus?: boolean;
  disabled?: boolean;
}

/**
 * A value control driven by a schema kind.
 *
 * Number fields keep a local draft so a half-typed value is not committed, while
 * every valid keystroke still updates the owner. Other controls commit in the
 * event that changed them.
 */
export function SchemaControl({
  id,
  kind,
  value,
  onChange,
  describedBy,
  min,
  max,
  step,
  unit,
  percentage = false,
  placeholder,
  multiline = false,
  rows,
  maxLength,
  options,
  emptyOption,
  trailing,
  autoFocus,
  disabled,
}: SchemaControlProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const described = describedBy ? { "aria-describedby": describedBy } : {};
  const checked = value === true;
  const textValue = String(value ?? "");
  const shown = kind === "number" && draft !== null ? draft : textValue;

  /** Apply one changed control value; number fields keep an unparsable draft local. */
  const commit = (event: {
    currentTarget: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
  }) => {
    const target = event.currentTarget;
    const next =
      target instanceof HTMLInputElement && target.type === "checkbox"
        ? target.checked
        : target.value;
    if (kind === "number") {
      const nextValue = String(next);
      setDraft(nextValue);
      if (target instanceof HTMLInputElement && target.validity.valid) {
        onChange(nextValue);
      }
      return;
    }
    onChange(next);
  };

  let control: ReactNode;
  switch (kind) {
    case "toggle":
      control = (
        <Input
          id={id}
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={commit}
          {...described}
        />
      );
      break;
    case "range":
      control = (
        <SliderField
          id={id}
          min={min}
          max={max}
          step={step}
          value={shown}
          percentage={percentage}
          unit={unit}
          disabled={disabled}
          onChange={commit}
          aria-describedby={describedBy}
        />
      );
      break;
    case "number":
      control = (
        <span className="redux-setting-range">
          <Input
            id={id}
            type="number"
            min={min}
            max={max}
            step={step}
            value={shown}
            disabled={disabled}
            autoFocus={autoFocus}
            onChange={commit}
            {...described}
            onBlur={(event) => {
              const next = event.currentTarget.value;
              if (event.currentTarget.validity.valid && next !== textValue) {
                onChange(next);
              }
              setDraft(null);
            }}
            onNumericWheel={(next, target) => {
              if (target.validity.valid) {
                onChange(next);
              }
              setDraft(null);
            }}
          />
          {unit && <output className="redux-setting-value">{unit}</output>}
        </span>
      );
      break;
    case "select":
      control = (
        <Select id={id} value={textValue} disabled={disabled} onChange={commit} {...described}>
          {emptyOption !== undefined && (
            <option value="" disabled>
              {emptyOption}
            </option>
          )}
          {options?.map((option) => (
            <option key={option.value} value={option.value} disabled={option.disabled}>
              {option.label}
            </option>
          ))}
        </Select>
      );
      break;
    case "color":
      control = (
        <ColorField
          id={id}
          value={textValue}
          disabled={disabled}
          describedBy={describedBy}
          onChange={onChange}
        />
      );
      break;
    case "text":
      control = multiline ? (
        <Textarea
          id={id}
          rows={rows}
          maxLength={maxLength}
          value={textValue}
          placeholder={placeholder}
          disabled={disabled}
          autoFocus={autoFocus}
          spellCheck={false}
          autoComplete="off"
          onChange={commit}
          {...described}
        />
      ) : (
        <Input
          id={id}
          type="text"
          value={textValue}
          placeholder={placeholder}
          maxLength={maxLength}
          disabled={disabled}
          autoFocus={autoFocus}
          spellCheck={false}
          autoComplete="off"
          onChange={commit}
          {...described}
        />
      );
      break;
  }

  if (!trailing) {
    return control;
  }
  return (
    <span className="redux-schema-control">
      {control}
      {trailing}
    </span>
  );
}
