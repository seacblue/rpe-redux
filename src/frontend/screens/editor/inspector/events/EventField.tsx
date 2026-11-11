/** Owns one editable event field: its draft value, its commit, and its value formatting. */
import { useCallback, useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { BeatField } from "../beat/BeatField.tsx";
import { FieldRow } from "../../../../../design/components/field/FieldRow.tsx";
import { Input } from "../../../../../design/components/input/Input.tsx";
import {
  formatBeat,
  compareBeats,
  type Beat,
} from "../../../../../core/global/chart/timing/beat.ts";
import {
  eventFieldBounds,
  eventFieldNativeStep,
  normalizeEventNumber,
  parseEventArray,
  steppedEventValue,
  type FieldKey,
  type ValueKind,
} from "./eventFieldModel.ts";
import {
  transformEvents,
  assertMultiEventSelectionStructure,
} from "../../../../../core/edit/events/eventEdits.ts";
import { captureSelection } from "../../../../../core/edit/selection/snapshot.ts";
import {
  commitSelectionEdit,
  editCapturedSelection,
} from "../../../../../core/edit/selection/edits.ts";
import type { JudgeLineEvent } from "../../../../../core/global/chart/chart.ts";
import type { EditorSession } from "../../../../../core/edit/session/session.ts";
import { numericWheel } from "../../../../../design/controls/numericWheel.ts";
import { writeInputValue } from "../../../../../design/controls/nativeValue.ts";
import { EVENT_WHEEL_STEPS } from "../../../../../core/global/chart/editing/noteEditing.ts";
import { judgeLineTraits } from "../../../../../core/global/chart/line/lineTraits.ts";
import { t } from "../../../../../i18n/index.ts";

interface EventFieldProps {
  session: EditorSession;
  eventType: string;
  event: JudgeLineEvent;
  field: FieldKey;
  title: string;
  kind: ValueKind;
  reportError: (error: unknown) => void;
  refresh: () => void;
  setLiveEventEdit: (active: boolean) => void;
  /** Exact move by one grid division; `null` when the move was refused. */
  onNudge: (value: Beat, direction: number) => Beat | null;
  disabled?: boolean;
}

/** Formats one event field for its input. */
export function displayValue(event: JudgeLineEvent, key: FieldKey): string {
  if (key === "startTime" || key === "endTime") {
    return formatBeat(event[key]);
  }
  const raw = event[key];
  if (Array.isArray(raw)) {
    return raw.join(", ");
  }
  return String(raw ?? (key === "easingRight" ? 1 : 0));
}

/** Applies one transform through the multi-line or single-line edit path. */
export function applyEventTransform(
  session: EditorSession,
  label: string,
  transform: (event: JudgeLineEvent, type: string) => JudgeLineEvent,
): void {
  if (session.multiLineActive && session.multiLineMode === "events") {
    const result = editCapturedSelection(captureSelection(session), { event: transform });
    assertMultiEventSelectionStructure(result.chart, result.eventLayer, result.multiEventSelection);
    commitSelectionEdit(session, result, label, {}, { skipValidation: true });
  } else {
    transformEvents(session, label, transform);
  }
}

/** Edits one selected-event field and commits it through the session. */
export function EventField({
  session,
  eventType,
  event,
  field,
  title,
  kind,
  reportError,
  refresh,
  setLiveEventEdit,
  onNudge,
  disabled = false,
}: EventFieldProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const focusValue = useRef<string | null>(null);
  const noiseSize =
    judgeLineTraits(session.line).isNoise &&
    (eventType === "scaleXEvents" || eventType === "scaleYEvents");
  const step =
    field === "easingLeft" || field === "easingRight"
      ? 0.05
      : field === "linkgroup"
        ? 1
        : (session.eventWheelSteps?.[eventType] ??
          (noiseSize ? 5 : (EVENT_WHEEL_STEPS[eventType] ?? 1)));

  /** Parses the input by field kind and writes it through the event transform. */
  const update = useCallback(
    (inputValue: string, quiet: boolean) => {
      try {
        let value: number | number[] | string;
        if (kind === "array") {
          const values = parseEventArray(inputValue);
          if (!values) {
            throw new Error(t("editorPanels.inspector.event.colorInvalid"));
          }
          value = values;
        } else if (kind === "number") {
          const parsed = Number(inputValue);
          if (!inputValue.trim() || !Number.isFinite(parsed)) {
            return;
          }
          value = normalizeEventNumber(field, parsed);
        } else {
          value = inputValue;
        }
        applyEventTransform(
          session,
          t("editorPanels.inspector.event.modify", { field: title }),
          (current) => ({
            ...current,
            [field]: value,
            ...(current.inst && (field === "start" || field === "end")
              ? { start: value, end: structuredClone(value) }
              : {}),
          }),
        );
      } catch (error) {
        if (!quiet) {
          reportError(error);
        }
      }
    },
    [field, kind, reportError, session, title],
  );
  const updateRef = useRef(update);

  useEffect(() => {
    updateRef.current = update;
  }, [update]);

  useEffect(() => {
    const input = inputRef.current;
    if (!input) {
      return;
    }
    if (kind === "number") {
      numericWheel(input, step, undefined, () => updateRef.current(input.value, false));
    }
  }, [kind, step]);

  // `EventInspectorView` only asks for a beat field on the two anchors, so the
  // stored triple can be read off the field itself.
  const beatValue: Beat = field === "startTime" ? event.startTime : event.endTime;

  const commitBeat = (beat: Beat): boolean => {
    if (compareBeats(beat, beatValue) === 0) {
      return true;
    }
    try {
      applyEventTransform(
        session,
        t("editorPanels.inspector.event.modify", { field: title }),
        (current) => ({ ...current, [field]: beat }),
      );
      return true;
    } catch (error) {
      reportError(error);
      return false;
    }
  };

  // A refused nudge reports the failure and leaves the beat where it was.
  const nudgeBeat = (beat: Beat, direction: number): Beat => onNudge(beat, direction) ?? beat;

  const onBeatFocusChange = (focused: boolean) => {
    if (focused) {
      setLiveEventEdit(true);
      return;
    }
    setLiveEventEdit(false);
    queueMicrotask(() => {
      if (!session.liveEventEdit) {
        refresh();
      }
    });
  };

  const bounds = eventFieldBounds(field);
  // Free event values use `step="any"` so the native control never reports a
  // step mismatch for a value the author typed. The arrow keys below keep the
  // same stepping the native control would have provided.
  const nativeStep = kind === "number" ? eventFieldNativeStep(field, step) : "any";
  const freeNumeric = kind === "number" && nativeStep === "any";

  /** Steps a free-form event value with the arrow keys without native validation. */
  const onArrowStep = (keyEvent: ReactKeyboardEvent<HTMLInputElement>) => {
    if (!freeNumeric || (keyEvent.key !== "ArrowUp" && keyEvent.key !== "ArrowDown")) {
      return;
    }
    keyEvent.preventDefault();
    const input = keyEvent.currentTarget;
    const value = Number(input.value);
    if (!Number.isFinite(value)) {
      return;
    }
    const multiplier = keyEvent.shiftKey ? 10 : keyEvent.ctrlKey ? 5 : 1;
    const direction = keyEvent.key === "ArrowUp" ? 1 : -1;
    writeInputValue(input, String(steppedEventValue(value, step, direction, multiplier)));
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  };

  const input = (
    <Input
      ref={inputRef}
      key={`${field}:${displayValue(event, field)}`}
      id={`event-field-${field}`}
      type={kind === "number" ? "number" : "text"}
      data-redux-wheel={kind === "number" ? "custom" : undefined}
      step={nativeStep}
      min={bounds.min}
      max={bounds.max}
      data-inspector-field={field}
      disabled={disabled}
      defaultValue={displayValue(event, field)}
      onKeyDown={onArrowStep}
      onFocus={(focusEvent) => {
        focusValue.current = focusEvent.currentTarget.value;
        setLiveEventEdit(true);
      }}
      onInput={(inputEvent) => {
        // One live commit channel: `onInput` is the per-keystroke draft and
        // `onBlur` is the loud final commit. The shared Input dispatches both
        // `input` and `change` for its stepper/wheel gestures, so handling
        // both would commit every gesture twice.
        if (kind !== "number" || inputEvent.currentTarget.value.trim()) {
          update(inputEvent.currentTarget.value, true);
        }
      }}
      onBlur={() => {
        const value = inputRef.current?.value ?? "";
        if (value !== focusValue.current) {
          update(value, false);
        }
        focusValue.current = null;
        setLiveEventEdit(false);
        queueMicrotask(() => {
          if (!session.liveEventEdit) {
            refresh();
          }
        });
      }}
    />
  );

  return (
    <FieldRow
      layout="inline"
      density="compact"
      htmlFor={`event-field-${field}`}
      label={title}
      control={(id) =>
        kind === "beat" ? (
          <BeatField
            id={id}
            value={beatValue}
            onCommit={commitBeat}
            onNudge={nudgeBeat}
            onFocusChange={onBeatFocusChange}
            disabled={disabled}
            dataField={field}
          />
        ) : (
          input
        )
      }
    />
  );
}
