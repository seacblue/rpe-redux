/**
 * The curve-note form: two anchors, the shape between them, and one commit.
 *
 * Each anchor is an exact beat, edited in the three parts of `BeatField` instead
 * of a `3:1/2` text that has to be parsed: each box holds one part (a decimal is
 * normalized into the triple when the box is left), and an end that would land
 * before the start is refused by the field itself. The remaining fields keep their
 * own text draft, so a half-typed number does not move the curve.
 */
import { useEffect, useRef, useState, type WheelEvent } from "react";
import { BeatField } from "../beat/BeatField.tsx";
import { EasingField } from "../../../../../design/components/easing/EasingField.tsx";
import { InlineAlert } from "../../../../../design/components/alert/InlineAlert.tsx";
import { EasingPreview } from "../../../../../design/components/easing/EasingPreview.tsx";
import { FieldRow } from "../../../../../design/components/field/FieldRow.tsx";
import { FieldReset } from "../../../../../design/components/field/FieldReset.tsx";
import { Input } from "../../../../../design/components/input/Input.tsx";
import { Select } from "../../../../../design/components/select/Select.tsx";
import { compareBeats, type Beat } from "../../../../../core/global/chart/timing/beat.ts";
import { useTranslation } from "../../../../../i18n/react.ts";

export interface CurveFieldValues {
  startTime: Beat;
  endTime: Beat;
  startX: number;
  endX: number;
  density: number;
  type: number;
  easingType: number;
}

export interface CurveFieldLabels {
  startTime: string;
  endTime: string;
  startX: string;
  endX: string;
  density: string;
  type: string;
  easing: string;
}

type BeatKey = "startTime" | "endTime";
type NumberFieldKey = "startX" | "endX" | "density" | "type" | "easingType";
const NUMBER_FIELD_KEYS: NumberFieldKey[] = ["startX", "endX", "density", "type", "easingType"];

/** The text draft covers the numeric fields; the anchors own their own boxes. */
function toDraft(values: CurveFieldValues): Record<NumberFieldKey, string> {
  return {
    startX: String(values.startX),
    endX: String(values.endX),
    density: String(values.density),
    type: String(values.type),
    easingType: String(values.easingType),
  };
}

/** Reads the numeric text draft back into numbers. */
function toValues(draft: Record<NumberFieldKey, string>): Record<NumberFieldKey, number> {
  return {
    startX: Number(draft.startX),
    endX: Number(draft.endX),
    density: Number(draft.density),
    type: Number(draft.type),
    easingType: Number(draft.easingType),
  };
}

/** Renders the curve form and reports complete value sets upward. */
export function CurveFieldsView({
  labels,
  values,
  error,
  preview,
  onInput,
  onPreviewChange,
}: {
  labels: CurveFieldLabels;
  values: CurveFieldValues;
  error: string | null;
  preview: boolean;
  onInput(values: CurveFieldValues): void;
  onPreviewChange(preview: boolean): void;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(() => toDraft(values));
  const fields = useRef<
    Partial<Record<NumberFieldKey, HTMLInputElement | HTMLSelectElement | null>>
  >({});
  useEffect(() => {
    const externalDraft = toDraft(values);
    setDraft((current) => {
      let changed = false;
      const next = { ...current };
      for (const key of NUMBER_FIELD_KEYS) {
        if (document.activeElement !== fields.current[key] && next[key] !== externalDraft[key]) {
          next[key] = externalDraft[key];
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [values]);

  const apply = (next: Record<NumberFieldKey, string>) => {
    setDraft(next);
    onInput({ ...values, ...toValues(next) });
  };

  const commitBeat =
    (key: BeatKey) =>
    (beat: Beat): boolean => {
      const next: CurveFieldValues =
        key === "startTime" ? { ...values, startTime: beat } : { ...values, endTime: beat };
      onInput({ ...next, ...toValues(draft) });
      return true;
    };

  // The two anchors bound the stretch the curve is generated across, so the
  // owner refuses a start after the end and an end before the start.
  const acceptsBeat =
    (key: BeatKey) =>
    (beat: Beat): boolean =>
      key === "startTime"
        ? compareBeats(beat, values.endTime) <= 0
        : compareBeats(beat, values.startTime) >= 0;

  const wheel = (key: NumberFieldKey, step: number) => (event: WheelEvent<HTMLInputElement>) => {
    if (!event.deltaY || event.currentTarget.disabled || event.currentTarget.readOnly) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const direction = -Math.sign(event.deltaY);
    const value = Number(draft[key]) + direction * step;
    if (!Number.isFinite(value)) {
      return;
    }
    apply({ ...draft, [key]: String(value) });
  };

  const beatInput = (key: BeatKey, id?: string) => (
    <BeatField
      id={id}
      value={values[key]}
      accepts={acceptsBeat(key)}
      onCommit={commitBeat(key)}
      dataField={key}
    />
  );

  const numberInput = (
    key: "startX" | "endX" | "density",
    step: number,
    id?: string,
    describedBy?: string,
  ) => (
    <Input
      id={id}
      type="number"
      step="any"
      value={draft[key]}
      aria-describedby={describedBy}
      onWheel={wheel(key, step)}
      onChange={(event) => {
        // A half-typed number (`-`, `.`) is not a value: the draft holds it and
        // the curve moves only once it parses.
        const next = { ...draft, [key]: event.currentTarget.value };
        setDraft(next);
        if (event.currentTarget.value.trim() !== "" && Number.isFinite(Number(next[key]))) {
          onInput({ ...values, ...toValues(next) });
        }
      }}
    />
  );

  return (
    <>
      <FieldRow
        layout="inline"
        label={labels.startTime}
        control={(id) => beatInput("startTime", id)}
      />
      <FieldRow layout="inline" label={labels.endTime} control={(id) => beatInput("endTime", id)} />
      <FieldRow
        layout="inline"
        label={labels.startX}
        control={(id, describedBy) => numberInput("startX", 1, id, describedBy)}
      />
      <FieldRow
        layout="inline"
        label={labels.endX}
        control={(id, describedBy) => numberInput("endX", 1, id, describedBy)}
      />
      <FieldRow
        layout="inline"
        label={labels.density}
        control={(id, describedBy) => numberInput("density", 0.25, id, describedBy)}
      />
      <FieldRow
        layout="inline"
        label={labels.type}
        control={(id) => (
          <Select
            id={id}
            ref={(input) => {
              fields.current.type = input;
            }}
            value={draft.type}
            onInput={(event) => apply({ ...draft, type: event.currentTarget.value })}
          >
            <option value="1">{t("editorPanels.inspector.noteType.tap")}</option>
            <option value="2">{t("editorPanels.inspector.noteType.hold")}</option>
            <option value="3">{t("editorPanels.inspector.noteType.flick")}</option>
            <option value="4">{t("editorPanels.inspector.noteType.drag")}</option>
          </Select>
        )}
      />
      <EasingField
        label={labels.easing}
        value={values.easingType}
        onChange={(easingType) => apply({ ...draft, easingType: String(easingType) })}
      />
      <EasingPreview event={{ easingType: values.easingType }} />
      <FieldRow
        layout="inline"
        label={t("editorPanels.curve.previewToggle")}
        reset={
          <FieldReset
            field="result-ghost"
            label={t("editorPanels.curve.previewToggle")}
            dirty={!preview}
            onReset={() => onPreviewChange(true)}
          />
        }
        control={(id) => (
          <Input
            id={id}
            type="checkbox"
            checked={preview}
            onChange={(event) => onPreviewChange(event.currentTarget.checked)}
          />
        )}
      />
      {error && <InlineAlert className="curve-error">{error}</InlineAlert>}
    </>
  );
}
