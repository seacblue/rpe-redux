/**
 * Song-time input for the recording range.
 *
 * The field edits a draft string and commits the parsed time on blur or Enter.
 * The recording panel decides whether the committed time belongs inside the
 * available interval, so this control only owns the text-to-time relation.
 */
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Input } from "../../../../../design/components/input/Input.tsx";
import { useTranslation } from "../../../../../i18n/react.ts";
import { formatRecordingTime, parseRecordingTime } from "./recordingTime.ts";

export interface RecordingTimeFieldProps {
  /** Optional id for the input, so a FieldRow label can target it. */
  id?: string;
  /** The committed song time in seconds. */
  value: number;
  /** The largest value the owner will accept; larger values stay invalid. */
  max: number;
  disabled?: boolean;
  /** Apply a time. Return false when the owner refused it. */
  onCommit(seconds: number): boolean | void;
}

/** Edits one committed song time through a readable time string. */
export function RecordingTimeField({
  id,
  value,
  max,
  disabled = false,
  onCommit,
}: RecordingTimeFieldProps) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(() => formatRecordingTime(value));
  const [invalid, setInvalid] = useState(false);
  const lastValue = useRef(value);

  // The owner is the source of truth: a value changed by the beat field or by
  // opening the pane replaces the draft. A rejected draft leaves it untouched.
  useEffect(() => {
    if (value !== lastValue.current) {
      lastValue.current = value;
      setDraft(formatRecordingTime(value));
      setInvalid(false);
    }
  }, [value]);

  /** Parse the draft and hand a bounded value to the owner. */
  const commit = (): void => {
    const parsed = parseRecordingTime(draft);
    if (parsed === null || parsed < 0 || parsed > max) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    setDraft(formatRecordingTime(parsed));
    if (Math.abs(parsed - value) < 1e-9) {
      return;
    }
    const accepted = onCommit(parsed) !== false;
    setInvalid(!accepted);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      event.currentTarget.blur();
    } else if (event.key === "Escape") {
      event.preventDefault();
      setDraft(formatRecordingTime(value));
      setInvalid(false);
    }
  };

  return (
    <Input
      id={id}
      type="text"
      inputMode="decimal"
      spellCheck={false}
      autoComplete="off"
      placeholder="0:00.000"
      value={draft}
      disabled={disabled}
      aria-invalid={invalid || undefined}
      data-tip-title={invalid ? t("editor.recording.invalidTime") : undefined}
      onChange={(event) => {
        setDraft(event.currentTarget.value);
        setInvalid(false);
      }}
      onBlur={commit}
      onKeyDown={onKeyDown}
    />
  );
}
