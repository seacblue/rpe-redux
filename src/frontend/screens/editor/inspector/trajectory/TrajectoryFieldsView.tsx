/**
 * The trajectory option form: geometry, trim, easing, and expression fields
 * driven by field descriptor tables.
 *
 * Values leave as strings; core parses and validates them when the event is
 * created, so the form never coerces an expression into a number.
 */
import { useState, type ChangeEvent } from "react";
import { t, type MessageKey } from "../../../../../i18n/index.ts";
import { Button } from "../../../../../design/components/button/Button.tsx";
import { FieldRow } from "../../../../../design/components/field/FieldRow.tsx";
import { FieldRows } from "../../../../../design/components/field/FieldRows.tsx";
import { Input } from "../../../../../design/components/input/Input.tsx";
import { Select } from "../../../../../design/components/select/Select.tsx";
import { BeatField } from "../beat/BeatField.tsx";
import type { Beat } from "../../../../../core/global/chart/timing/beat.ts";
import { secureRandomIntInclusive } from "../../../../../core/utils/random.ts";
import { COMMON_FIELDS, type TrajectoryOptionBag } from "./trajectoryPanelControls.ts";

const EXPRESSION_FIELDS: Array<[string, MessageKey]> = [
  ["xExpression", "editorPanels.trajectory.field.xExpression"],
  ["yExpression", "editorPanels.trajectory.field.yExpression"],
  ["parameterStart", "editorPanels.trajectory.field.parameterStart"],
  ["parameterEnd", "editorPanels.trajectory.field.parameterEnd"],
  ["radiusExpression", "editorPanels.trajectory.field.radiusExpression"],
  ["angleStart", "editorPanels.trajectory.field.angleStart"],
  ["angleEnd", "editorPanels.trajectory.field.angleEnd"],
  ["rotationExpression", "editorPanels.trajectory.field.rotationExpression"],
];

const EASING_FIELDS: Array<[string, MessageKey]> = [
  ["easingX", "editorPanels.trajectory.field.easingX"],
  ["easingY", "editorPanels.trajectory.field.easingY"],
];

/** Renders one labeled trajectory input or select. */
function Field({
  fieldKey,
  label,
  value,
  type = "text",
  min,
  max,
  step,
  choices,
  hidden = false,
  disabled = false,
  tipDescription,
  onChange,
}: {
  fieldKey: string;
  label: string;
  value: unknown;
  type?: string;
  min?: number;
  max?: number;
  step?: number;
  choices?: Array<[string, string]>;
  hidden?: boolean;
  disabled?: boolean;
  tipDescription?: string;
  onChange(value: unknown): void;
}) {
  const input = choices ? (
    <Select
      id={fieldKey}
      data-key={fieldKey}
      value={String(value ?? "")}
      onChange={(event) => onChange(event.currentTarget.value)}
    >
      {choices.map(([optionValue, text]) => (
        <option value={optionValue} key={optionValue}>
          {text}
        </option>
      ))}
    </Select>
  ) : (
    <Input
      id={fieldKey}
      data-key={fieldKey}
      type={type}
      disabled={disabled}
      min={min}
      max={max}
      step={step ?? "any"}
      checked={type === "checkbox" ? Boolean(value) : undefined}
      value={type === "checkbox" ? undefined : String(value ?? "")}
      onChange={(event) => onChange(readInputValue(event))}
      aria-describedby={tipDescription ? `${fieldKey}-description` : undefined}
    />
  );

  return (
    <FieldRow
      layout="inline"
      density="compact"
      hidden={hidden}
      htmlFor={fieldKey}
      idPrefix={fieldKey}
      label={label}
      description={tipDescription}
      control={input}
    />
  );
}

/** Reads a checkbox or numeric input as its typed value. */
function readInputValue(event: ChangeEvent<HTMLInputElement>): unknown {
  const input = event.currentTarget;
  return input.type === "checkbox"
    ? input.checked
    : ["number", "range"].includes(input.type)
      ? input.value.trim()
        ? Number(input.value)
        : NaN
      : input.value;
}

/** Seed input with a randomize action. */
function SeedField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: unknown;
  onChange(value: unknown): void;
}) {
  const randomize = () => {
    const previous = Number(value);
    const next = (previous + 1 + secureRandomIntInclusive(0, 100000)) % 100001;
    onChange(next);
  };
  return (
    <FieldRow
      layout="inline"
      density="compact"
      label={label}
      control={(id) => (
        <span className="trajectory-seed">
          <Input
            id={id}
            data-key="seed"
            type="number"
            min="0"
            max="100000"
            step="1"
            value={String(value ?? "0")}
            onChange={(event) => onChange(readInputValue(event))}
          />
          <Button
            type="button"
            variant="ghost"
            aria-label={t("editorPanels.trajectory.randomize")}
            data-tip-title={t("editorPanels.trajectory.randomize")}
            onClick={randomize}
          >
            ⚄
          </Button>
        </span>
      )}
    />
  );
}

/** Renders the trajectory option form and reports complete value sets. */
export function TrajectoryFieldsView({
  startTime,
  endTime,
  options,
  segments,
  splitSettings,
  replace,
  fieldsRevision,
  optionsRevision,
  onChange,
}: {
  startTime: Beat;
  endTime: Beat;
  options: TrajectoryOptionBag;
  segments: number;
  splitSettings: { simplify: boolean; tolerance: number };
  replace: boolean | undefined;
  fieldsRevision: number;
  optionsRevision: number;
  onChange(values: Record<string, unknown>): void;
}) {
  const createValues = () => ({
    ...options,
    startTime,
    endTime,
    segments,
    simplify: splitSettings.simplify,
    tolerance: splitSettings.tolerance,
    replace: Boolean(replace),
    parametersJson: JSON.stringify(options.parameters ?? {}),
  });
  const [values, setValues] = useState<Record<string, unknown>>(createValues);
  const [syncedRevisions, setSyncedRevisions] = useState({ fieldsRevision, optionsRevision });
  if (
    fieldsRevision !== syncedRevisions.fieldsRevision ||
    optionsRevision !== syncedRevisions.optionsRevision
  ) {
    setValues((previous) => ({
      ...previous,
      ...(fieldsRevision !== syncedRevisions.fieldsRevision ? { startTime, endTime } : {}),
      ...(optionsRevision !== syncedRevisions.optionsRevision
        ? { ...options, parametersJson: JSON.stringify(options.parameters ?? {}) }
        : {}),
    }));
    setSyncedRevisions({ fieldsRevision, optionsRevision });
  }
  const update = (key: string, value: unknown) => {
    const next = { ...values, [key]: value };
    setValues(next);
    onChange(next);
  };
  return (
    <div className="trajectory-fields">
      <FieldRows>
        <FieldRow
          layout="inline"
          density="compact"
          label={t("editorPanels.inspector.field.startTime")}
          control={(id) => (
            <BeatField
              id={id}
              value={startTime}
              dataField="startTime"
              onCommit={(beat) => update("startTime", beat)}
            />
          )}
        />
        <FieldRow
          layout="inline"
          density="compact"
          label={t("editorPanels.inspector.field.endTime")}
          control={(id) => (
            <BeatField
              id={id}
              value={endTime}
              dataField="endTime"
              onCommit={(beat) => update("endTime", beat)}
            />
          )}
        />
        <Field
          fieldKey="mode"
          label={t("editorPanels.trajectory.field.mode")}
          value={values.mode}
          onChange={(value) => update("mode", value)}
          choices={[
            ["parametric", t("editorPanels.trajectory.mode.parametric")],
            ["polar", t("editorPanels.trajectory.mode.polar")],
          ]}
        />
        {EXPRESSION_FIELDS.map(([key, labelKey]) => {
          return (
            <Field
              key={key}
              fieldKey={key}
              label={t(labelKey)}
              value={values[key]}
              onChange={(value) => update(key, value)}
              hidden={
                key === "xExpression" ||
                key === "yExpression" ||
                key === "parameterStart" ||
                key === "parameterEnd"
                  ? options.mode === "polar"
                  : key === "radiusExpression" || key === "angleStart" || key === "angleEnd"
                    ? options.mode !== "polar"
                    : false
              }
              disabled={key === "rotationExpression" && Boolean(options.tangentRotation)}
            />
          );
        })}
        <Field
          fieldKey="tangentRotation"
          label={t("editorPanels.trajectory.field.tangentRotation")}
          value={values.tangentRotation}
          type="checkbox"
          onChange={(value) => update("tangentRotation", value)}
        />
        {EASING_FIELDS.map(([key, labelKey]) => {
          return (
            <Field
              key={key}
              fieldKey={key}
              label={t(labelKey)}
              value={values[key]}
              type="number"
              min={1}
              max={29}
              step={1}
              onChange={(value) => update(key, value)}
            />
          );
        })}
        {COMMON_FIELDS.map(([key, labelKey, type, min, max, step]) => {
          return key === "seed" ? (
            <SeedField
              key={key}
              label={t(labelKey)}
              value={values[key]}
              onChange={(value) => update(key, value)}
            />
          ) : (
            <Field
              key={key}
              fieldKey={key}
              label={t(labelKey)}
              value={values[key]}
              type={type}
              min={min}
              max={max}
              step={step}
              onChange={(value) => update(key, value)}
            />
          );
        })}
        <Field
          fieldKey="parametersJson"
          label={t("editorPanels.trajectory.field.parametersJson")}
          value={values.parametersJson}
          tipDescription={t("editorPanels.trajectory.parametersJsonHint")}
          onChange={(value) => update("parametersJson", value)}
        />
        <Field
          fieldKey="segments"
          label={t("editorPanels.trajectory.field.segments")}
          value={values.segments}
          type="number"
          min={4}
          max={8192}
          step={1}
          onChange={(value) => update("segments", value)}
        />
        <Field
          fieldKey="simplify"
          label={t("editorPanels.trajectory.field.simplify")}
          value={values.simplify}
          type="checkbox"
          onChange={(value) => update("simplify", value)}
        />
        <Field
          fieldKey="tolerance"
          label={t("editorPanels.trajectory.field.tolerance")}
          value={values.tolerance}
          type="number"
          min={0.001}
          max={10000}
          step={0.1}
          disabled={!splitSettings.simplify}
          onChange={(value) => update("tolerance", value)}
        />
        <Field
          fieldKey="replace"
          label={t("editorPanels.trajectory.field.replace")}
          value={values.replace}
          type="checkbox"
          onChange={(value) => update("replace", value)}
        />
      </FieldRows>
    </div>
  );
}
