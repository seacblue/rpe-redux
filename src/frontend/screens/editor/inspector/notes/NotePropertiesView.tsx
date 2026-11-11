/**
 * Renders the note property controls and owns only their drafts.
 *
 * Typing stays local, and leaving a field or submitting the form commits through
 * the descriptor's own apply callback; the view never derives a chart edit.
 */
import { useEffect, useRef, useState, type FormEvent, type Ref } from "react";
import { numericWheel } from "../../../../../design/controls/numericWheel.ts";
import { InspectorEmpty } from "../InspectorEmpty.tsx";
import { BeatField } from "../beat/BeatField.tsx";
import { FieldRow } from "../../../../../design/components/field/FieldRow.tsx";
import { FieldRows } from "../../../../../design/components/field/FieldRows.tsx";
import { ColorField } from "../../../../../design/components/input/ColorField.tsx";
import { Input } from "../../../../../design/components/input/Input.tsx";
import { Select } from "../../../../../design/components/select/Select.tsx";
import { SliderField } from "../../../../../design/components/slider/SliderField.tsx";
import { useEditorRuntimeValue } from "../../workspace/runtime/composition/EditorRuntime.tsx";
import { useEditingFeature } from "../../../settings/editingCapabilities.ts";
import type { NotePropertyField } from "./model.ts";

interface ControlProps {
  field: NotePropertyField;
  liveValue: string | null;
}

/** Renders one note property control by descriptor kind. */
function PropertyControlView({ field, liveValue }: ControlProps) {
  const input = useRef<HTMLInputElement | HTMLSelectElement>(null);
  const focusValue = useRef<string | null>(null);
  const [focused, setFocused] = useState(false);
  const [draft, setDraft] = useState(field.value);
  useEffect(() => {
    const element = input.current;
    if (!element || element instanceof HTMLSelectElement || field.kind === "select") {
      return;
    }
    if (field.kind === "number") {
      numericWheel(element, field.step ?? 1, undefined, () => field.apply?.(element));
    } else if (field.kind === "duration") {
      numericWheel(element, 1, (direction) => {
        const next = field.wheel?.(direction);
        if (next !== null && next !== undefined) {
          setDraft(next);
        }
      });
    }
  }, [field]);

  // A beat is three parts, not text: the control commits the exact triple the
  // owner accepts, and moving it is exact in that triple.
  if (field.kind === "beat" && field.beat && field.applyBeat) {
    return (
      <FieldRow
        layout="inline"
        density="compact"
        htmlFor={`note-field-${field.key}`}
        label={field.label}
        control={
          <BeatField
            id={`note-field-${field.key}`}
            value={field.beat}
            onCommit={(beat) => field.applyBeat?.(beat)}
            onNudge={field.nudge}
            accepts={field.accepts}
            disabled={field.disabled}
            dataField={field.key}
            onFocusChange={(isFocused) => (isFocused ? field.focus() : field.blur())}
          />
        }
      />
    );
  }

  if (field.kind === "color") {
    return (
      <FieldRow
        layout="inline"
        density="compact"
        htmlFor={`note-field-${field.key}`}
        idPrefix={`note-field-${field.key}`}
        label={field.label}
        description={field.tipDescription}
        control={
          <ColorField
            id={`note-field-${field.key}`}
            value={field.value || "#ffffff"}
            disabled={field.disabled}
            describedBy={field.tipDescription ? `note-field-${field.key}-description` : undefined}
            onChange={(value) => field.apply?.({ value })}
          />
        }
      />
    );
  }

  if (field.kind === "boolean") {
    return (
      <FieldRow
        layout="inline"
        density="compact"
        htmlFor={`note-field-${field.key}`}
        label={field.label}
        control={
          <Input
            id={`note-field-${field.key}`}
            type="checkbox"
            checked={field.value === "1"}
            disabled={field.disabled}
            data-inspector-field={field.key}
            onChange={(event) => field.apply?.({ value: event.currentTarget.checked ? "1" : "0" })}
            onFocus={field.focus}
            onBlur={field.blur}
          />
        }
      />
    );
  }

  if (field.kind === "slider") {
    return (
      <FieldRow
        layout="inline"
        density="compact"
        htmlFor={`note-field-${field.key}`}
        idPrefix={`note-field-${field.key}`}
        label={field.label}
        description={field.tipDescription}
        control={
          <SliderField
            id={`note-field-${field.key}`}
            min={Number(field.min ?? 0)}
            max={Number(field.max ?? 255)}
            step={field.step ?? 1}
            value={field.value}
            data-inspector-field={field.key}
            disabled={field.disabled}
            aria-describedby={
              field.tipDescription ? `note-field-${field.key}-description` : undefined
            }
            aria-label={field.label}
            onChange={(event) => field.apply?.(event.currentTarget)}
            onFocus={field.focus}
            onBlur={field.blur}
          />
        }
      />
    );
  }

  const positionField = field.key === "positionX";
  const appliesOnInput = positionField;
  const controlledValue = positionField || field.kind === "duration";
  const inputProps = {
    ref: input as Ref<HTMLInputElement>,
    id: `note-field-${field.key}`,
    ...(positionField
      ? { value: focused ? draft : (liveValue ?? field.value) }
      : controlledValue
        ? { value: draft }
        : { defaultValue: field.value }),
    min: field.min,
    max: field.max,
    disabled: field.disabled,
    "aria-describedby": field.tipDescription ? `note-field-${field.key}-description` : undefined,
    placeholder: field.placeholder,
    "data-inspector-field": field.key,
    "data-redux-wheel": "custom" as const,
    onInput: (event: FormEvent<HTMLInputElement>) => {
      if (controlledValue) {
        setDraft(event.currentTarget.value);
      }
      if (appliesOnInput && event.currentTarget.value.trim()) {
        field.apply?.(event.currentTarget);
      }
    },
    onFocus: () => {
      focusValue.current = input.current?.value ?? null;
      setFocused(true);
      field.focus();
    },
    onBlur: () => {
      const control = input.current;
      if (control instanceof HTMLInputElement && control.value !== focusValue.current) {
        field.apply?.(control);
        if (field.kind === "duration") {
          setDraft(control.value);
        }
      }
      focusValue.current = null;
      setFocused(false);
      field.blur();
    },
  };

  return (
    <FieldRow
      layout="inline"
      density="compact"
      htmlFor={`note-field-${field.key}`}
      idPrefix={`note-field-${field.key}`}
      label={field.label}
      description={field.tipDescription}
      control={
        field.kind === "select" ? (
          <Select
            ref={input as Ref<HTMLSelectElement>}
            id={`note-field-${field.key}`}
            data-inspector-field={field.key}
            defaultValue={field.value}
            onChange={(event) => field.apply?.(event.currentTarget)}
            onFocus={field.focus}
            onBlur={field.blur}
          >
            {field.options?.map(([value, label]) => (
              <option value={value} key={value}>
                {label}
              </option>
            ))}
          </Select>
        ) : (
          <Input
            {...inputProps}
            ref={input as Ref<HTMLInputElement>}
            type={field.kind === "text" ? "text" : "number"}
            step={field.kind === "number" ? (field.step ?? 1) : undefined}
          />
        )
      }
    />
  );
}

/** Renders the visible note property fields or the empty hint. */
export function NotePropertiesView({
  fields,
  empty,
  emptyHint,
}: {
  fields: NotePropertyField[];
  empty: boolean;
  emptyHint: string;
}) {
  const livePosition = useEditorRuntimeValue((runtime) => runtime.ui.notes.livePosition, null);
  const fakeNotesEnabled = useEditingFeature("fakeNotes");
  const noteSpeedEnabled = useEditingFeature("noteSpeed");
  const noteSizeEnabled = useEditingFeature("noteSize");
  const noteAlphaEnabled = useEditingFeature("noteAlpha");
  const noteYOffsetEnabled = useEditingFeature("noteYOffset");
  const noteVisibleTimeEnabled = useEditingFeature("noteVisibleTime");
  const noteColorEnabled = useEditingFeature("noteColor");
  const noteHitSoundEnabled = useEditingFeature("noteHitSound");
  const optionalFields: Record<string, boolean> = {
    speed: noteSpeedEnabled,
    size: noteSizeEnabled,
    alpha: noteAlphaEnabled,
    yOffset: noteYOffsetEnabled,
    visibleTime: noteVisibleTimeEnabled,
    color: noteColorEnabled,
    hitSound: noteHitSoundEnabled,
  };
  // Hiding the capability must not trap a chart that already authors the value:
  // a non-default value is the reason its control is still rendered.
  const visibleFields = fields.filter((field) => {
    if (field.key === "isFake") {
      return fakeNotesEnabled || field.present === true || field.value === "1";
    }
    const enabled = optionalFields[field.key];
    return enabled === undefined || enabled || field.present === true;
  });
  return empty ? (
    <InspectorEmpty>{emptyHint}</InspectorEmpty>
  ) : (
    <FieldRows>
      {visibleFields.map((field) => (
        <PropertyControlView
          field={field}
          key={field.key}
          liveValue={field.key === "positionX" ? livePosition : null}
        />
      ))}
    </FieldRows>
  );
}
