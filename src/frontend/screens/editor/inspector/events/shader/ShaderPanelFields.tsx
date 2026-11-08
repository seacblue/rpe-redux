/** Owns the form controls the shader panel composes: value fields, a beat field, and a chooser. */
import { useRef, useState } from "react";
import { FieldRow } from "../../../../../../design/components/field/FieldRow.tsx";
import { Input } from "../../../../../../design/components/input/Input.tsx";
import { Select } from "../../../../../../design/components/select/Select.tsx";
import { BeatField } from "../../beat/BeatField.tsx";
import { nudgeBeat, type Beat } from "../../../../../../core/global/chart/timing/beat.ts";
import type { EditorSession } from "../../../../../../core/edit/session/session.ts";

/** A text or number field. The value is a string; the owner parses and validates it. */
export function Field({
  title,
  value,
  kind = "text",
  step = 0.1,
  min,
  max,
  session,
  setLiveEventEdit,
  refresh,
  apply,
}: {
  title: string;
  value: string | number;
  kind?: string;
  step?: number;
  min?: number;
  max?: number;
  session: EditorSession;
  setLiveEventEdit(active: boolean): void;
  refresh(): void;
  apply(text: string, quiet: boolean, input: HTMLInputElement): void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState(String(value));

  /** Stores the text and hands it to the owner. */
  const commit = (text: string, quiet: boolean, input: HTMLInputElement) => {
    setDraft(text);
    apply(text, quiet, input);
  };

  /** Adds one step within the field's bounds and commits it. */
  const nudge = (direction: number, input: HTMLInputElement) => {
    const current = Number(draft);
    if (!Number.isFinite(current)) {
      return;
    }
    const minimum = min ?? -Infinity;
    const maximum = max ?? Infinity;
    const next = String(
      Number(Math.max(minimum, Math.min(maximum, current + direction * step)).toFixed(10)),
    );
    commit(next, false, input);
  };

  return (
    <FieldRow
      layout="inline"
      density="compact"
      label={title}
      control={(id) => (
        <Input
          id={id}
          ref={inputRef}
          type={kind}
          step={kind === "number" ? step : undefined}
          min={min}
          max={max}
          value={draft}
          onFocus={() => {
            setLiveEventEdit(true);
          }}
          onBlur={(event) => {
            setLiveEventEdit(false);
            const input = event.currentTarget;
            queueMicrotask(() => {
              const container = input.closest(".shader-inspector");
              if (
                container?.isConnected &&
                !session.liveEventEdit &&
                !container.contains(document.activeElement)
              ) {
                refresh();
              }
            });
          }}
          onInput={(event) => commit(event.currentTarget.value, true, event.currentTarget)}
          onChange={(event) => commit(event.currentTarget.value, false, event.currentTarget)}
          onWheel={(event) => {
            const inputElement = event.currentTarget;
            if (kind !== "number") {
              return;
            }
            if (!event.deltaY || inputElement.disabled || inputElement.readOnly) {
              return;
            }
            event.preventDefault();
            event.stopPropagation();
            nudge(-Math.sign(event.deltaY), inputElement);
          }}
        />
      )}
    />
  );
}

/**
 * A beat field: the three stored parts and exact nudging by one grid division.
 * The owner decides whether the committed beat is acceptable.
 */
export function BeatControl({
  title,
  value,
  division,
  accepts,
  disabled = false,
  dataField,
  session,
  setLiveEventEdit,
  refresh,
  reportError,
  onCommit,
}: {
  title: string;
  value: Beat;
  division: number;
  accepts?(beat: Beat): boolean;
  disabled?: boolean;
  dataField?: string;
  session: EditorSession;
  setLiveEventEdit(active: boolean): void;
  refresh(): void;
  reportError(error: unknown): void;
  onCommit(beat: Beat): boolean | void;
}) {
  return (
    <FieldRow
      layout="inline"
      density="compact"
      label={title}
      control={
        <BeatField
          value={value}
          accepts={accepts}
          disabled={disabled}
          dataField={dataField}
          onNudge={(beat, direction) => {
            try {
              return nudgeBeat(beat, direction, division || 4);
            } catch (error) {
              reportError(error);
              return beat;
            }
          }}
          onFocusChange={(focused) => {
            setLiveEventEdit(focused);
            if (focused) {
              return;
            }
            // Refresh once focus has left the whole control, not one of its boxes.
            queueMicrotask(() => {
              if (!session.liveEventEdit) {
                refresh();
              }
            });
          }}
          onCommit={onCommit}
        />
      }
    />
  );
}

/** One option rendered by a labeled select; adjacent options with the same group share a heading. */
export interface SelectOption {
  value: string;
  label: string;
  group?: string;
}

/** Renders a labeled select from value/label options. */
export function SelectField({
  title,
  value,
  options,
  disabled = false,
  onChange,
}: {
  title: string;
  value: string;
  options: readonly SelectOption[];
  disabled?: boolean;
  onChange(value: string): void;
}) {
  return (
    <FieldRow
      layout="inline"
      density="compact"
      label={title}
      control={(id) => (
        <Select
          id={id}
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.currentTarget.value)}
        >
          {options.map((option, index) => {
            const previous = options[index - 1];
            if (option.group && option.group !== previous?.group) {
              const group = option.group;
              const grouped = options.slice(index).findIndex((item) => item.group !== group);
              const end = grouped < 0 ? options.length : index + grouped;
              return (
                <optgroup key={`group:${group}`} label={group}>
                  {options.slice(index, end).map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </optgroup>
              );
            }
            if (option.group) {
              return null;
            }
            return (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            );
          })}
        </Select>
      )}
    />
  );
}
