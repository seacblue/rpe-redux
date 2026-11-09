/** Script parameter dialog and its global host: schema, remembered values, and pending requests. */
import { createElement, useEffect, useRef, useState, type FormEvent } from "react";
import { connectScriptParameterHost } from "../../../../../core/extensions/scriptUi.ts";
import { scriptRegistry } from "../../../../../core/extensions/scripts.ts";
import { getSelectionSession } from "../../../../../core/edit/selection/api.ts";
import {
  allocateScriptJudgeLine,
  releaseScriptJudgeLines,
  type ScriptJudgeLineAllocation,
} from "./judgeLineAllocation.ts";
import {
  defaultValues,
  expressionLegend,
  formatJudgeLineList,
  isExtensionParameterInput,
  judgeLineCount,
  judgeLineIsMultiple,
  judgeLineModes,
  judgeLineValueLines,
  judgeLineValueMode,
  parseJudgeLineList,
  validateParameterValues,
  type ExtensionJudgeLineMode,
  type ExtensionParameter,
  type ExtensionParameterInput,
  type ExtensionParameterIssue,
  type ExtensionParameterSchema,
} from "../../../../../core/extensions/parameters.ts";
import {
  resolveExtensionText,
  type ExtensionText,
  type ExtensionTranslations,
} from "../../../../../core/extensions/i18n.ts";
import { PREFERENCE_SECTIONS } from "../../../../../core/state/preferences.ts";
import { defineValue, values } from "../../../../../core/state/values.ts";
import { tRaw } from "../../../../../i18n/index.ts";
import { useTranslation } from "../../../../../i18n/react.ts";
import { Button } from "../../../../../design/components/button/Button.tsx";
import { IconButton } from "../../../../../design/components/button/IconButton.tsx";
import { Segmented } from "../../../../../design/components/segmented/Segmented.tsx";
import { FieldRow } from "../../../../../design/components/field/FieldRow.tsx";
import { SchemaControl } from "../../../../../design/components/field/SchemaControl.tsx";
import {
  dismissModal,
  presentModal,
  type ModalOptions,
} from "../../../../overlays/modals/modalQueue.ts";

export interface ParameterFormProps {
  readonly owner: string;
  readonly scriptId: string;
  readonly schema: ExtensionParameterSchema;
  readonly translations?: ExtensionTranslations;
  readonly initialValues?: Readonly<Record<string, unknown>>;
  onSubmit(values: Readonly<Record<string, ExtensionParameterInput>>): void;
  onCancel(): void;
}

export interface ParameterFormRequest {
  readonly owner: string;
  readonly scriptId: string;
  readonly schema: ExtensionParameterSchema;
  readonly translations?: ExtensionTranslations;
  readonly initialValues?: Readonly<Record<string, unknown>>;
  readonly title: string;
  readonly description?: string;
}
const MEMORY_ID_PREFIX = "extension-parameter-memory:";
let nextRequestId = 0;
function memoryKey(owner: string, scriptId: string): string {
  return `${owner}:${scriptId}`;
}
function memoryValueId(owner: string, scriptId: string): string {
  return `${MEMORY_ID_PREFIX}${memoryKey(owner, scriptId)}`;
}
function isParameterRecord(value: unknown): value is Record<string, ExtensionParameterInput> {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.values(value).every(isExtensionParameterInput)
  );
}

/** Defines the persistent value cell on first use and returns its id. */
function ensureMemoryValue(owner: string, scriptId: string): string {
  const id = memoryValueId(owner, scriptId);
  if (!values.byId.has(id)) {
    defineValue<string>({
      id,
      storageKey: memoryKey(owner, scriptId),
      initial: "{}",
      persist: PREFERENCE_SECTIONS.settings,
      validate(value) {
        if (typeof value !== "string") {
          throw new TypeError("Extension parameter memory must be JSON text");
        }
        const parsed: unknown = JSON.parse(value);
        if (!isParameterRecord(parsed)) {
          throw new TypeError("Extension parameter memory must be an object");
        }
      },
    });
  }
  return id;
}

function parseMemory(raw: string): Record<string, ExtensionParameterInput> | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    return isParameterRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Returns remembered values that still satisfy the current schema. */
export function readRememberedParameterValues(
  owner: string,
  scriptId: string,
  schema: ExtensionParameterSchema,
): Readonly<Record<string, ExtensionParameterInput>> | null {
  const id = ensureMemoryValue(owner, scriptId);
  const parsed = parseMemory(values.byId.get<string>(id));
  if (!parsed) {
    return null;
  }
  const result = validateParameterValues(schema, parsed);
  return result.ok ? Object.freeze({ ...result.values }) : null;
}

/** Returns remembered values, falling back to schema defaults. */
export function rememberedOrDefaultParameterValues(
  owner: string,
  scriptId: string,
  schema: ExtensionParameterSchema,
): Readonly<Record<string, ExtensionParameterInput>> {
  return readRememberedParameterValues(owner, scriptId, schema) ?? defaultValues(schema);
}

function rememberParameterValues(
  owner: string,
  scriptId: string,
  valuesToRemember: Readonly<Record<string, ExtensionParameterInput>>,
): void {
  const id = ensureMemoryValue(owner, scriptId);
  values.byId.set(id, JSON.stringify(valuesToRemember));
}

/** Clears one script's remembered parameter values. */
export function forgetRememberedParameterValues(owner: string, scriptId: string): void {
  const id = ensureMemoryValue(owner, scriptId);
  values.byId.set(id, "{}");
}

/** Declared schema order first, then any keys the order omits. */
function parameterKeys(schema: ExtensionParameterSchema): string[] {
  const keys: string[] = [];
  const seen = new Set<string>();
  for (const key of schema.order ?? []) {
    if (Object.hasOwn(schema.parameters, key) && !seen.has(key)) {
      seen.add(key);
      keys.push(key);
    }
  }
  for (const key of Object.keys(schema.parameters)) {
    if (!seen.has(key)) {
      seen.add(key);
      keys.push(key);
    }
  }
  return keys;
}

/** Initial form values: supplied value, schema default, or empty by kind. */
function seedValues(
  schema: ExtensionParameterSchema,
  initialValues: Readonly<Record<string, unknown>> | undefined,
): Record<string, unknown> {
  const defaults = defaultValues(schema);
  const valuesToEdit: Record<string, unknown> = {};
  for (const key of parameterKeys(schema)) {
    const parameter = schema.parameters[key];
    if (initialValues && Object.hasOwn(initialValues, key)) {
      valuesToEdit[key] = initialValues[key];
    } else if (Object.hasOwn(defaults, key)) {
      valuesToEdit[key] = defaults[key];
    } else if (parameter.kind === "boolean") {
      valuesToEdit[key] = false;
    } else {
      valuesToEdit[key] = "";
    }
  }
  return valuesToEdit;
}

function textFor(
  owner: string,
  translations: ExtensionTranslations | undefined,
  value: ExtensionText | undefined,
  fallback: string,
): string {
  return resolveExtensionText(owner, translations, value ?? fallback);
}
function issueText(
  owner: string,
  translations: ExtensionTranslations | undefined,
  issue: ExtensionParameterIssue | undefined,
): string | null {
  return issue ? resolveExtensionText(owner, translations, issue.message) : null;
}

function fieldId(owner: string, scriptId: string, key: string): string {
  return `extension-parameter-${owner}-${scriptId}-${key}`.replace(/[^a-zA-Z0-9_-]/g, "-");
}

interface JudgeLineOption {
  readonly index: number;
  readonly name: string;
}

function judgeLineIndex(value: unknown): number | null {
  if (value === "" || value === null || value === undefined) {
    return null;
  }
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isInteger(parsed) ? parsed : null;
}

interface JudgeLineDraft {
  readonly mode: ExtensionJudgeLineMode;
  readonly text: string;
}

/** Builds the mode and text draft for one judge-line parameter. */
function judgeLineDraftFor(parameter: ExtensionParameter, raw: unknown): JudgeLineDraft {
  const requested = judgeLineValueMode(raw);
  const mode =
    parameter.kind === "judgeLine" && !judgeLineModes(parameter).includes(requested)
      ? "exact"
      : requested;
  return {
    mode,
    text: mode === "global" ? "" : formatJudgeLineList(judgeLineValueLines(raw)),
  };
}

function judgeLineDrafts(
  schema: ExtensionParameterSchema,
  valuesToEdit: Readonly<Record<string, unknown>>,
): Record<string, JudgeLineDraft> {
  const drafts: Record<string, JudgeLineDraft> = {};
  for (const key of parameterKeys(schema)) {
    const parameter = schema.parameters[key];
    if (parameter.kind === "judgeLine") {
      drafts[key] = judgeLineDraftFor(parameter, valuesToEdit[key]);
    }
  }
  return drafts;
}

/** Apply mode and text drafts to validation values; malformed lists become empty. */
function draftedValues(
  schema: ExtensionParameterSchema,
  valuesToEdit: Readonly<Record<string, unknown>>,
  drafts: Readonly<Record<string, JudgeLineDraft>>,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...valuesToEdit };
  for (const key of parameterKeys(schema)) {
    const parameter = schema.parameters[key];
    const draft = drafts[key];
    if (parameter.kind !== "judgeLine" || !draft) {
      continue;
    }
    if (draft.mode === "global") {
      result[key] = { mode: "global" };
      continue;
    }
    const lines = parseJudgeLineList(draft.text) ?? [];
    if (draft.mode === "range") {
      result[key] = { mode: "range", lines };
    } else if (judgeLineIsMultiple(parameter)) {
      result[key] = lines;
    }
  }
  return result;
}

/** Renders the control for one parameter kind. */
function ParameterControl({
  owner,
  translations,
  parameter,
  value,
  id,
  describedBy,
  lineOptions,
  canAllocateLine,
  judgeLineDraft,
  onAllocateLine,
  onJudgeLineModeChange,
  onJudgeLineTextChange,
  onChange,
}: {
  owner: string;
  translations?: ExtensionTranslations;
  parameter: ExtensionParameter;
  value: unknown;
  id: string;
  describedBy?: string;
  lineOptions: readonly JudgeLineOption[];
  canAllocateLine: boolean;
  judgeLineDraft?: JudgeLineDraft;
  onAllocateLine(): void;
  onJudgeLineModeChange(mode: ExtensionJudgeLineMode): void;
  onJudgeLineTextChange(text: string): void;
  onChange(value: unknown): void;
}) {
  switch (parameter.kind) {
    case "number":
      return (
        <SchemaControl
          id={id}
          kind={parameter.min !== undefined && parameter.max !== undefined ? "range" : "number"}
          value={typeof value === "number" ? value : String(value ?? "")}
          min={parameter.min}
          max={parameter.max}
          step={parameter.step}
          unit={
            parameter.unit ? resolveExtensionText(owner, translations, parameter.unit) : undefined
          }
          onChange={(next) => onChange(next)}
          describedBy={describedBy}
        />
      );
    case "boolean":
      return (
        <SchemaControl
          id={id}
          kind="toggle"
          value={value === true}
          onChange={(next) => onChange(next)}
          describedBy={describedBy}
        />
      );
    case "text":
      return (
        <SchemaControl
          id={id}
          kind="text"
          multiline={parameter.multiline}
          maxLength={parameter.maxLength}
          rows={4}
          value={String(value ?? "")}
          onChange={(next) => onChange(next)}
          describedBy={describedBy}
        />
      );
    case "select": {
      const selected = String(value ?? "");
      return (
        <SchemaControl
          id={id}
          kind="select"
          value={selected}
          emptyOption={selected ? undefined : tRaw("extensions.parameters.required")}
          options={parameter.options.map((option) => ({
            value: option.value,
            label: resolveExtensionText(owner, translations, option.label),
            disabled: option.disabled,
          }))}
          onChange={(next) => onChange(next)}
          describedBy={describedBy}
        />
      );
    }
    case "judgeLine": {
      const draft = judgeLineDraft ?? judgeLineDraftFor(parameter, value);
      const modes = judgeLineModes(parameter);
      const count = judgeLineCount(parameter) ?? 1;
      const multiple = judgeLineIsMultiple(parameter);
      const allocate = (
        <IconButton
          icon="lineAdd"
          size={16}
          variant="outlined"
          label={tRaw("workspace.scripts.parameters.judgeLine.allocate")}
          title={tRaw("workspace.scripts.parameters.judgeLine.allocateHint")}
          disabled={!canAllocateLine}
          onClick={onAllocateLine}
        />
      );
      const listControl = (
        <SchemaControl
          id={id}
          kind="text"
          value={draft.text}
          placeholder={tRaw("workspace.scripts.parameters.judgeLine.placeholder")}
          onChange={(next) => onJudgeLineTextChange(String(next))}
          describedBy={describedBy}
          trailing={allocate}
        />
      );
      const index = judgeLineIndex(value);
      const selected = index !== null && lineOptions.some((option) => option.index === index);
      const exactControl = (
        <SchemaControl
          id={id}
          kind="select"
          value={selected ? String(index) : ""}
          emptyOption={tRaw(
            value === "" || value === undefined
              ? "extensions.parameters.required"
              : "extensions.parameters.judgeLine.invalid",
          )}
          options={lineOptions.map((option) => ({
            value: String(option.index),
            label: tRaw("workspace.scripts.parameters.judgeLine.option", {
              index: option.index,
              name: option.name || tRaw("model.line.untitled"),
            }),
          }))}
          onChange={(next) => onChange(Number(next))}
          describedBy={describedBy}
          trailing={allocate}
        />
      );
      return (
        <div className="redux-parameter-line-control">
          {modes.length > 1 && (
            <Segmented
              ariaLabel={tRaw("workspace.scripts.parameters.judgeLine.modeLabel")}
              value={draft.mode}
              options={modes.map((mode) => ({
                value: mode,
                label: tRaw(`workspace.scripts.parameters.judgeLine.mode.${mode}`),
                title: tRaw(`workspace.scripts.parameters.judgeLine.mode.${mode}Hint`),
              }))}
              onChange={(mode) => onJudgeLineModeChange(mode)}
            />
          )}
          <div className="redux-parameter-line-row">
            {draft.mode === "global" ? (
              <span className="redux-parameter-line-hint" role="status">
                {tRaw("workspace.scripts.parameters.judgeLine.globalHint", { count })}
              </span>
            ) : draft.mode === "range" || multiple ? (
              listControl
            ) : (
              exactControl
            )}
          </div>
        </div>
      );
    }
    case "color":
      return (
        <SchemaControl
          id={id}
          kind="color"
          value={typeof value === "string" ? value : "#000000"}
          onChange={(next) => onChange(next)}
          describedBy={describedBy}
        />
      );
    case "beat":
      return (
        <SchemaControl
          id={id}
          kind="beat"
          value={String(value ?? "")}
          onChange={(next) => onChange(next)}
          describedBy={describedBy}
        />
      );
    case "expression":
      return (
        <SchemaControl
          id={id}
          kind="text"
          value={String(value ?? "")}
          onChange={(next) => onChange(next)}
          describedBy={describedBy}
        />
      );
  }
}

/** Lists the fields, functions, and hints an expression parameter offers. */
function ExpressionLegend({
  owner,
  translations,
  parameter,
}: {
  owner: string;
  translations?: ExtensionTranslations;
  parameter: Extract<ExtensionParameter, { kind: "expression" }>;
}) {
  const { t } = useTranslation();
  const legend = expressionLegend(parameter.vocabulary);
  return (
    <div className="redux-parameter-legend">
      <small>{t("workspace.scripts.parameters.fields", { value: legend.fields.join(", ") })}</small>
      <small>
        {t("workspace.scripts.parameters.functions", { value: legend.functions.join(", ") })}
      </small>
      {legend.hints.map((hint, index) => (
        <small key={`${typeof hint === "string" ? hint : hint.key}-${index}`}>
          {resolveExtensionText(owner, translations, hint)}
        </small>
      ))}
    </div>
  );
}

/** Renders the parameter schema and resolves the request on submit or cancel. */
export function ParameterForm({
  owner,
  scriptId,
  schema,
  translations,
  initialValues,
  onSubmit,
  onCancel,
}: ParameterFormProps) {
  const { t } = useTranslation();
  const [initial] = useState(() => seedValues(schema, initialValues));
  const [valuesToEdit, setValuesToEdit] = useState<Record<string, unknown>>(initial);
  const [lineDrafts, setLineDrafts] = useState<Record<string, JudgeLineDraft>>(() =>
    judgeLineDrafts(schema, initial),
  );
  const [, setLineRevision] = useState(0);
  const createdLines = useRef<ScriptJudgeLineAllocation[]>([]);
  const submitted = useRef(false);
  const session = getSelectionSession();
  const lineOptions = (session?.chart.judgeLineList ?? []).map((line, index) => ({
    index,
    name: line.Name ?? "",
  }));
  const currentValues = draftedValues(schema, valuesToEdit, lineDrafts);
  const validation = validateParameterValues(schema, currentValues, {
    lineCount: lineOptions.length,
  });
  const issues = new Map(validation.ok ? [] : validation.issues.map((entry) => [entry.key, entry]));
  const canSubmit = validation.ok;
  const canAllocateLine = Boolean(session && !session.readOnly);

  useEffect(
    () => () => {
      if (submitted.current) {
        return;
      }
      const allocations = createdLines.current;
      createdLines.current = [];
      releaseScriptJudgeLines(allocations);
    },
    [],
  );

  const update = (key: string, value: unknown) => {
    setValuesToEdit((current) => ({ ...current, [key]: value }));
  };
  const updateLineDraft = (key: string, draft: JudgeLineDraft) => {
    setLineDrafts((current) => ({ ...current, [key]: draft }));
  };
  const changeLineMode = (key: string, mode: ExtensionJudgeLineMode) => {
    const parameter = schema.parameters[key];
    if (parameter.kind !== "judgeLine") {
      return;
    }
    const draft = lineDrafts[key] ?? judgeLineDraftFor(parameter, valuesToEdit[key]);
    let text = draft.text;
    if (draft.mode === "exact" && !judgeLineIsMultiple(parameter)) {
      text = formatJudgeLineList(judgeLineValueLines(currentValues[key]));
    }
    if (mode === "exact" && !judgeLineIsMultiple(parameter)) {
      const lines = parseJudgeLineList(text) ?? [];
      update(key, lines[0] ?? "");
    }
    updateLineDraft(key, { mode, text });
  };
  const changeLineText = (key: string, text: string) => {
    const draft = lineDrafts[key];
    if (!draft) {
      return;
    }
    updateLineDraft(key, { ...draft, text });
  };
  const allocateLine = (key: string) => {
    const assignedElsewhere = parameterKeys(schema)
      .filter((other) => other !== key && schema.parameters[other].kind === "judgeLine")
      .flatMap((other) => judgeLineValueLines(currentValues[other]));
    const allocation = allocateScriptJudgeLine({
      exclude: assignedElsewhere,
      name: t("workspace.scripts.parameters.judgeLine.createdName"),
    });
    if (!allocation) {
      return;
    }
    if (allocation.created && !createdLines.current.some((entry) => entry.id === allocation.id)) {
      createdLines.current = [...createdLines.current, allocation];
    }
    const parameter = schema.parameters[key];
    const draft = lineDrafts[key];
    if (
      parameter.kind === "judgeLine" &&
      draft?.mode !== "global" &&
      (judgeLineIsMultiple(parameter) || draft?.mode === "range")
    ) {
      const lines = parseJudgeLineList(draft?.text ?? "") ?? [];
      if (!lines.includes(allocation.index)) {
        lines.push(allocation.index);
        updateLineDraft(key, {
          mode: draft?.mode ?? "exact",
          text: formatJudgeLineList(lines),
        });
      }
    } else {
      update(key, allocation.index);
    }
    setLineRevision((revision) => revision + 1);
  };
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSubmit) {
      return;
    }
    submitted.current = true;
    rememberParameterValues(owner, scriptId, validation.values);
    onSubmit(validation.values);
  };

  return (
    <form className="redux-parameter-form" onSubmit={submit} autoComplete="off">
      <div className="redux-parameter-fields">
        {parameterKeys(schema).map((key) => {
          const parameter = schema.parameters[key];
          const id = fieldId(owner, scriptId, key);
          const issue = issues.get(key);
          const error = issueText(owner, translations, issue);
          const label = textFor(owner, translations, parameter.label, key);
          return (
            <FieldRow
              key={key}
              divided
              striped
              htmlFor={id}
              idPrefix={id}
              label={label}
              description={
                parameter.description
                  ? resolveExtensionText(owner, translations, parameter.description)
                  : undefined
              }
              error={error}
              footer={
                parameter.kind === "expression" ? (
                  <ExpressionLegend
                    owner={owner}
                    translations={translations}
                    parameter={parameter}
                  />
                ) : undefined
              }
              control={(_, describedBy) => (
                <ParameterControl
                  owner={owner}
                  translations={translations}
                  parameter={parameter}
                  value={currentValues[key]}
                  id={id}
                  describedBy={describedBy}
                  lineOptions={lineOptions}
                  canAllocateLine={canAllocateLine}
                  judgeLineDraft={parameter.kind === "judgeLine" ? lineDrafts[key] : undefined}
                  onAllocateLine={() => allocateLine(key)}
                  onJudgeLineModeChange={(mode) => changeLineMode(key, mode)}
                  onJudgeLineTextChange={(text) => changeLineText(key, text)}
                  onChange={(value) => update(key, value)}
                />
              )}
            />
          );
        })}
      </div>
      <div className="redux-parameter-actions">
        <span className="redux-parameter-actions-spacer" />
        <Button variant="outlined" type="button" onClick={onCancel}>
          {t("common.action.cancel")}
        </Button>
        <Button variant="solid" type="submit" disabled={!canSubmit}>
          {t("workspace.scripts.run")}
        </Button>
      </div>
    </form>
  );
}

const pendingRequests = new Map<
  string,
  (values: Readonly<Record<string, ExtensionParameterInput>> | null) => void
>();

/** Removes and dismisses one pending request, then resolves it. */
function finishRequest(
  id: string,
  values: Readonly<Record<string, ExtensionParameterInput>> | null,
): void {
  const resolve = pendingRequests.get(id);
  if (!resolve) {
    return;
  }
  pendingRequests.delete(id);
  dismissModal(id);
  resolve(values);
}

/** Opens the parameter modal and resolves with its values or null on cancel. */
export function requestParameterValues(
  options: ParameterFormRequest,
): Promise<Readonly<Record<string, ExtensionParameterInput>> | null> {
  const id = `extension-parameters:${++nextRequestId}`;
  return new Promise((resolve) => {
    pendingRequests.set(id, resolve);
    const children = createElement(ParameterForm, {
      owner: options.owner,
      scriptId: options.scriptId,
      schema: options.schema,
      translations: options.translations,
      initialValues: options.initialValues,
      onSubmit: (values: Readonly<Record<string, ExtensionParameterInput>>) =>
        finishRequest(id, values),
      onCancel: () => finishRequest(id, null),
    });
    const modal: ModalOptions = {
      label: options.title,
      description: options.description,
      onClose: () => finishRequest(id, null),
      children,
    };
    presentModal(id, modal);
  });
}

/** Connects the global parameter host; the returned callback disconnects it. */
export function installParameterFormHost(): () => void {
  return connectScriptParameterHost({
    collect(owner, scriptId, schema, initial) {
      // Every parameterized run asks the user: remembered values only prefill the
      // modal, so pressing the script's single action never skips the overlay.
      const remembered = readRememberedParameterValues(owner, scriptId, schema);
      const key = `${owner}:${scriptId}`;
      const label = scriptRegistry.list().find((script) => script.id === key)?.label;
      return requestParameterValues({
        owner,
        scriptId,
        schema,
        initialValues: remembered ?? initial,
        title: tRaw("workspace.scripts.parameters.title", {
          script: label === undefined ? key : tRaw(label),
        }),
        description: tRaw("workspace.scripts.parameters.description"),
      });
    },
  });
}
