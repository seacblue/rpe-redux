/**
 * The declarative parameter vocabulary extensions expose in their UI.
 *
 * Supplies defaults, bounds, beat, text, select, judge-line and expression
 * validation, judge-line selection resolution, and expression legends; it
 * validates values but creates no host UI.
 */
import { parseBeat, formatBeat } from "../global/chart/timing/beat.ts";
import { BATCH_EXPRESSION_FUNCTION_NAMES, compileExpression } from "../utils/batchScript.ts";
import { expressionScopeFields, expressionScopeFor } from "../edit/multiEdit/plan.ts";
import { isRecord } from "../utils/guards.ts";
import type { ExtensionText } from "./i18n.ts";

/** A value that reaches a script after judge-line selections have been resolved. */
export type ExtensionParameterValue = string | number | boolean | readonly number[];

/** How a judge-line parameter turns its input into concrete line indices. */
export type ExtensionJudgeLineMode = "exact" | "range" | "global";

/** Candidate lines for the range mode; the host picks from them at run time. */
export interface ExtensionJudgeLineRangeSelection {
  readonly mode: "range";
  readonly lines: readonly number[];
}

/** Ask the host to pick from every judge line in the chart. */
export interface ExtensionJudgeLineGlobalSelection {
  readonly mode: "global";
}

/** A validated parameter value that still needs judge-line resolution. */
export type ExtensionParameterInput =
  ExtensionParameterValue | ExtensionJudgeLineRangeSelection | ExtensionJudgeLineGlobalSelection;

interface ExtensionParameterBase {
  readonly label?: ExtensionText;
  readonly description?: ExtensionText;
}

export interface ExtensionNumberParameter extends ExtensionParameterBase {
  readonly kind: "number";
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
  readonly default?: number;
  readonly unit?: ExtensionText;
}

export interface ExtensionBooleanParameter extends ExtensionParameterBase {
  readonly kind: "boolean";
  readonly default?: boolean;
}

export interface ExtensionTextParameter extends ExtensionParameterBase {
  readonly kind: "text";
  readonly multiline?: boolean;
  readonly maxLength?: number;
  readonly default?: string;
}

export interface ExtensionSelectOption {
  readonly value: string;
  readonly label: ExtensionText;
  readonly disabled?: boolean;
}

export interface ExtensionSelectParameter extends ExtensionParameterBase {
  readonly kind: "select";
  readonly options: readonly ExtensionSelectOption[];
  readonly default?: string;
}

/**
 * A judge-line target with a host picker.
 *
 * Without `count` or `multiple` the script receives one index. `count` fixes
 * how many lines it expects and makes the parameter a list when it is greater
 * than one; `multiple` without a count accepts an exact, unbounded list. Exact
 * lists keep the order they were written in. Range and global modes are only
 * offered where the count is known, and the host resolves them to concrete
 * indices when the script runs.
 */
export interface ExtensionJudgeLineParameter extends ExtensionParameterBase {
  readonly kind: "judgeLine";
  readonly count?: number;
  readonly multiple?: boolean;
  /** Restrict the host picker to an intentional subset of selection modes. */
  readonly modes?: readonly ExtensionJudgeLineMode[];
  readonly default?: number | readonly number[];
}

/** The positive expected line count, or undefined when the schema does not fix one. */
export function judgeLineCount(parameter: ExtensionJudgeLineParameter): number | undefined {
  return Number.isInteger(parameter.count) && (parameter.count as number) > 0
    ? (parameter.count as number)
    : undefined;
}

/** Whether the parameter crosses the script boundary as an array of indices. */
export function judgeLineIsMultiple(parameter: ExtensionJudgeLineParameter): boolean {
  return parameter.multiple === true || (judgeLineCount(parameter) ?? 1) > 1;
}

/**
 * Input modes offered for one parameter.
 *
 * An unbounded list has no expected count, so choosing a subset would be
 * arbitrary; it only accepts an exact list.
 */
export function judgeLineModes(
  parameter: ExtensionJudgeLineParameter,
): readonly ExtensionJudgeLineMode[] {
  const requested = parameter.modes?.filter((mode, index, modes) => {
    return ["exact", "range", "global"].includes(mode) && modes.indexOf(mode) === index;
  });
  if (requested?.length) {
    return requested;
  }
  if (parameter.multiple === true && judgeLineCount(parameter) === undefined) {
    return ["exact"];
  }
  return ["exact", "range", "global"];
}

export interface ExtensionColorParameter extends ExtensionParameterBase {
  readonly kind: "color";
  readonly default?: string;
}

export interface ExtensionBeatParameter extends ExtensionParameterBase {
  readonly kind: "beat";
  readonly default?: string;
}

export type ExtensionExpressionVocabulary = "notes" | "events";

export interface ExtensionExpressionParameter extends ExtensionParameterBase {
  readonly kind: "expression";
  readonly vocabulary: ExtensionExpressionVocabulary;
  readonly default?: string;
}

export interface ExtensionExpressionLegend {
  readonly vocabulary: ExtensionExpressionVocabulary;
  readonly fields: readonly string[];
  readonly functions: readonly string[];
  readonly hints: readonly ExtensionText[];
}

/** Return the planner-backed names and localized notes needed by an expression field. */
export function expressionLegend(
  vocabulary: ExtensionExpressionVocabulary,
): ExtensionExpressionLegend {
  return {
    vocabulary,
    fields: expressionScopeFields(vocabulary),
    functions: BATCH_EXPRESSION_FUNCTION_NAMES,
    hints: [
      { key: `extensions.parameters.expression.legend.${vocabulary}` },
      { key: "extensions.parameters.expression.legend.indices" },
      { key: "extensions.parameters.expression.legend.progress" },
      { key: "extensions.parameters.expression.legend.aliases" },
      { key: "extensions.parameters.expression.legend.functions" },
    ],
  };
}

/** One serializable parameter declaration understood by all extension hosts. */
export type ExtensionParameter =
  | ExtensionNumberParameter
  | ExtensionBooleanParameter
  | ExtensionTextParameter
  | ExtensionSelectParameter
  | ExtensionJudgeLineParameter
  | ExtensionColorParameter
  | ExtensionBeatParameter
  | ExtensionExpressionParameter;

/** The parameter declarations shown by the host, with an optional display order. */
export interface ExtensionParameterSchema {
  readonly parameters: Readonly<Record<string, ExtensionParameter>>;
  readonly order?: readonly string[];
}

export type ExtensionParameterIssue = {
  readonly key: string;
  readonly message: ExtensionText;
};

export type ParameterValidationResult =
  | { readonly ok: true; readonly values: Readonly<Record<string, ExtensionParameterInput>> }
  | { readonly ok: false; readonly issues: readonly ExtensionParameterIssue[] };

export type ParameterResolutionResult =
  | { readonly ok: true; readonly values: Readonly<Record<string, ExtensionParameterValue>> }
  | { readonly ok: false; readonly issues: readonly ExtensionParameterIssue[] };

/** Build a localized issue for one parameter key. */
const issue = (key: string, messageKey: string, params?: Record<string, string | number>) => ({
  key,
  message: params === undefined ? { key: messageKey } : { key: messageKey, params },
});

/** Whether the declaration supplies a value for an omitted input. */
function hasDefault(parameter: ExtensionParameter): boolean {
  return parameter.default !== undefined;
}

/** Declared order first, then remaining keys in declaration order. */
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

/** Parse a finite number from a number or a non-empty numeric string. */
function readNumber(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value !== "string" || value.trim() === "") {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

const JUDGE_LINE_INDEX = /^\d+$/;
const JUDGE_LINE_RANGE = /^(\d+)\s*[:-]\s*(\d+)$/;
const MAX_JUDGE_LINE_SPAN = 10_000;

/** One chart folder that can be used as a line-list completion token. */
export interface ExtensionJudgeLineGroup {
  readonly name: string;
  readonly indices: readonly number[];
}

/**
 * Read the compact line-list syntax (`3`, `1,3:5`, `2-4`) into ordered,
 * duplicate-free indices. Ranges always expand upward; the order of tokens is
 * preserved so an exact multi-line parameter can keep its authored order.
 */
export function parseJudgeLineList(
  raw: string,
  groups: readonly ExtensionJudgeLineGroup[] = [],
): number[] | null {
  const text = raw.trim();
  if (!text) {
    return null;
  }
  const result: number[] = [];
  const seen = new Set<number>();
  const groupByName = new Map(
    groups
      .map((group) => [group.name.trim().toLocaleLowerCase(), group] as const)
      .filter(([name]) => name.length > 0),
  );
  const add = (index: number): boolean => {
    if (!Number.isInteger(index) || index < 0) {
      return false;
    }
    if (!seen.has(index)) {
      seen.add(index);
      result.push(index);
    }
    return true;
  };
  for (const part of text.split(",")) {
    const token = part.trim();
    if (!token) {
      return null;
    }
    const group = groupByName.get(token.toLocaleLowerCase());
    if (group) {
      for (const index of group.indices) {
        if (!add(index)) {
          return null;
        }
      }
      continue;
    }
    const range = JUDGE_LINE_RANGE.exec(token);
    if (range) {
      let start = Number(range[1]);
      let end = Number(range[2]);
      if (start > end) {
        [start, end] = [end, start];
      }
      if (end - start > MAX_JUDGE_LINE_SPAN) {
        return null;
      }
      for (let index = start; index <= end; index += 1) {
        add(index);
      }
      continue;
    }
    if (!JUDGE_LINE_INDEX.test(token)) {
      return null;
    }
    add(Number(token));
  }
  return result.length ? result : null;
}

/** Write ordered indices back into the line-list syntax. */
export function formatJudgeLineList(lines: readonly number[]): string {
  return lines.join(",");
}

/** The mode carried by a raw judge-line value. */
export function judgeLineValueMode(raw: unknown): ExtensionJudgeLineMode {
  if (isRecord(raw)) {
    if (raw.mode === "range") {
      return "range";
    }
    if (raw.mode === "global") {
      return "global";
    }
  }
  return "exact";
}

/** Every concrete index named by a raw value, ignoring global selections. */
export function judgeLineValueLines(raw: unknown): readonly number[] {
  if (typeof raw === "number") {
    return Number.isInteger(raw) && raw >= 0 ? [raw] : [];
  }
  if (Array.isArray(raw)) {
    return raw.filter(
      (entry): entry is number =>
        typeof entry === "number" && Number.isInteger(entry) && entry >= 0,
    );
  }
  if (isRecord(raw) && raw.mode === "range" && Array.isArray(raw.lines)) {
    return judgeLineValueLines(raw.lines);
  }
  return [];
}

/** Validate a stored parameter value without interpreting it as a script fixture. */
export function isExtensionParameterInput(value: unknown): value is ExtensionParameterInput {
  if (
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  ) {
    return true;
  }
  if (Array.isArray(value)) {
    return value.every(
      (entry) => typeof entry === "number" && Number.isInteger(entry) && entry >= 0,
    );
  }
  if (!isRecord(value)) {
    return false;
  }
  if (value.mode === "global") {
    return true;
  }
  return (
    value.mode === "range" &&
    Array.isArray(value.lines) &&
    value.lines.every((entry) => typeof entry === "number" && Number.isInteger(entry) && entry >= 0)
  );
}

/** A validated judge-line value before ranges or globals are resolved. */
type ParsedJudgeLineValue =
  | { readonly mode: "exact"; readonly lines: readonly number[] }
  | { readonly mode: "range"; readonly lines: readonly number[] }
  | { readonly mode: "global" };

/** Read an ordered, duplicate-free index list, or null for invalid input. */
function readJudgeLineIndices(value: unknown): number[] | null {
  if (!Array.isArray(value) || value.length === 0) {
    return null;
  }
  const result: number[] = [];
  const seen = new Set<number>();
  for (const entry of value) {
    if (typeof entry !== "number" || !Number.isInteger(entry) || entry < 0) {
      return null;
    }
    if (!seen.has(entry)) {
      seen.add(entry);
      result.push(entry);
    }
  }
  return result.length ? result : null;
}

/** Normalize a number, list, or mode object into a validated judge-line value. */
function parseJudgeLineValue(
  raw: unknown,
  groups: readonly ExtensionJudgeLineGroup[] = [],
): ParsedJudgeLineValue | null {
  if (typeof raw === "number") {
    return Number.isInteger(raw) && raw >= 0 ? { mode: "exact", lines: [raw] } : null;
  }
  if (typeof raw === "string") {
    const lines = parseJudgeLineList(raw, groups);
    return lines ? { mode: "exact", lines } : null;
  }
  if (Array.isArray(raw)) {
    const lines = readJudgeLineIndices(raw);
    return lines ? { mode: "exact", lines } : null;
  }
  if (!isRecord(raw)) {
    return null;
  }
  if (raw.mode === "global") {
    return Object.keys(raw).length === 1 ? { mode: "global" } : null;
  }
  if (raw.mode === "range") {
    const lines = readJudgeLineIndices(raw.lines);
    return lines ? { mode: "range", lines } : null;
  }
  return null;
}

/** Validate one judge-line value against its mode, count, and line bound. */
function validateJudgeLine(
  key: string,
  parameter: ExtensionJudgeLineParameter,
  raw: unknown,
  lineCount: number | undefined,
  groups: readonly ExtensionJudgeLineGroup[],
): { value?: ExtensionParameterInput; issue?: ExtensionParameterIssue } {
  if (raw === "" || raw === undefined || (Array.isArray(raw) && raw.length === 0)) {
    return { issue: issue(key, "extensions.parameters.required") };
  }
  const parsed = parseJudgeLineValue(raw, groups);
  if (!parsed) {
    return { issue: issue(key, "extensions.parameters.judgeLine.invalid") };
  }
  const count = judgeLineCount(parameter);
  const need = count ?? 1;
  const multiple = judgeLineIsMultiple(parameter);
  const modes = judgeLineModes(parameter);
  if (lineCount !== undefined && lineCount < need) {
    return {
      issue: issue(key, "extensions.parameters.judgeLine.unavailable", { count: need }),
    };
  }
  if (parsed.mode === "global") {
    if (!modes.includes("global")) {
      return { issue: issue(key, "extensions.parameters.judgeLine.invalid") };
    }
    return { value: { mode: "global" } };
  }
  if (parsed.mode === "range") {
    if (!modes.includes("range")) {
      return { issue: issue(key, "extensions.parameters.judgeLine.invalid") };
    }
    if (parsed.lines.length < need) {
      return { issue: issue(key, "extensions.parameters.judgeLine.range", { count: need }) };
    }
    if (lineCount !== undefined && parsed.lines.some((index) => index >= lineCount)) {
      return { issue: issue(key, "extensions.parameters.judgeLine.invalid") };
    }
    return { value: { mode: "range", lines: Object.freeze([...parsed.lines]) } };
  }
  if (count !== undefined && parsed.lines.length !== count) {
    return { issue: issue(key, "extensions.parameters.judgeLine.count", { count }) };
  }
  if (!multiple && parsed.lines.length !== 1) {
    return {
      issue: issue(key, "extensions.parameters.judgeLine.count", { count: 1 }),
    };
  }
  if (lineCount !== undefined && parsed.lines.some((index) => index >= lineCount)) {
    return { issue: issue(key, "extensions.parameters.judgeLine.invalid") };
  }
  return {
    value: multiple ? Object.freeze([...parsed.lines]) : parsed.lines[0],
  };
}

/** Validate a number against its bounds and step origin. */
function validateNumber(
  key: string,
  parameter: ExtensionNumberParameter,
  raw: unknown,
): { value?: number; issue?: ExtensionParameterIssue } {
  const value = readNumber(raw);
  if (value === null) {
    return { issue: issue(key, "extensions.parameters.number.invalid") };
  }
  if (parameter.min !== undefined && value < parameter.min) {
    return { issue: issue(key, "extensions.parameters.number.minimum", { min: parameter.min }) };
  }
  if (parameter.max !== undefined && value > parameter.max) {
    return { issue: issue(key, "extensions.parameters.number.maximum", { max: parameter.max }) };
  }
  if (parameter.step !== undefined && Number.isFinite(parameter.step) && parameter.step > 0) {
    const origin = parameter.min ?? 0;
    const steps = (value - origin) / parameter.step;
    const nearest = Math.round(steps);
    if (Math.abs(steps - nearest) > 1e-9 * Math.max(1, Math.abs(steps))) {
      return { issue: issue(key, "extensions.parameters.number.step", { step: parameter.step }) };
    }
  }
  return { value };
}

/** Dispatch one raw value to the validator for its declared kind. */
function validateParameter(
  key: string,
  parameter: ExtensionParameter,
  raw: unknown,
  lineCount: number | undefined,
  groups: readonly ExtensionJudgeLineGroup[],
): { value?: ExtensionParameterInput; issue?: ExtensionParameterIssue } {
  switch (parameter.kind) {
    case "number":
      return validateNumber(key, parameter, raw);
    case "boolean":
      return typeof raw === "boolean"
        ? { value: raw }
        : { issue: issue(key, "extensions.parameters.boolean.invalid") };
    case "text":
      if (typeof raw !== "string") {
        return { issue: issue(key, "extensions.parameters.text.invalid") };
      }
      if (parameter.multiline !== true && /[\r\n]/.test(raw)) {
        return { issue: issue(key, "extensions.parameters.text.multiline") };
      }
      if (parameter.maxLength !== undefined && raw.length > parameter.maxLength) {
        return {
          issue: issue(key, "extensions.parameters.text.tooLong", {
            maxLength: parameter.maxLength,
          }),
        };
      }
      return { value: raw };
    case "select":
      if (typeof raw !== "string" || !parameter.options.some((option) => option.value === raw)) {
        return { issue: issue(key, "extensions.parameters.select.invalid") };
      }
      return { value: raw };
    case "judgeLine":
      return validateJudgeLine(key, parameter, raw, lineCount, groups);
    case "color":
      return typeof raw === "string" && /^#[0-9a-f]{6}$/i.test(raw)
        ? { value: raw }
        : { issue: issue(key, "extensions.parameters.color.invalid") };
    case "beat":
      if (typeof raw !== "string") {
        return { issue: issue(key, "extensions.parameters.beat.invalid") };
      }
      try {
        return { value: formatBeat(parseBeat(raw)) };
      } catch (error) {
        return {
          issue: issue(key, "extensions.parameters.beat.invalid", {
            detail: error instanceof Error ? error.message : String(error),
          }),
        };
      }
    case "expression":
      if (typeof raw !== "string") {
        return { issue: issue(key, "extensions.parameters.expression.invalid") };
      }
      try {
        const expression = compileExpression(raw);
        expression(expressionScopeFor(parameter.vocabulary));
        return { value: raw };
      } catch (error) {
        return {
          issue: issue(key, "extensions.parameters.expression.invalid", {
            detail: error instanceof Error ? error.message : String(error),
          }),
        };
      }
  }
}

/** Return the declared defaults without inventing values for required fields. */
export function defaultValues(
  schema: ExtensionParameterSchema,
): Readonly<Record<string, ExtensionParameterInput>> {
  const values: Record<string, ExtensionParameterInput> = {};
  for (const key of parameterKeys(schema)) {
    const parameter = schema.parameters[key];
    if (hasDefault(parameter)) {
      const value = parameter.default as ExtensionParameterInput;
      values[key] = Array.isArray(value) ? Object.freeze([...value]) : value;
    }
  }
  return values;
}

export interface ParameterValidationContext {
  /** Current chart line count; lets validation reject indices that no longer exist. */
  readonly lineCount?: number;
  /** Current folders; their names are accepted anywhere a line-list is accepted. */
  readonly judgeLineGroups?: readonly ExtensionJudgeLineGroup[];
}

/** Validate and normalize caller-provided values, filling only declared defaults. */
export function validateParameterValues(
  schema: ExtensionParameterSchema,
  raw: Readonly<Record<string, unknown>> | null | undefined,
  context: ParameterValidationContext = {},
): ParameterValidationResult {
  const values: Record<string, ExtensionParameterInput> = {};
  const issues: ExtensionParameterIssue[] = [];
  const input = raw && typeof raw === "object" ? raw : {};

  for (const key of parameterKeys(schema)) {
    const parameter = schema.parameters[key];
    const value = Object.hasOwn(input, key) ? input[key] : undefined;
    const candidate = value === undefined && hasDefault(parameter) ? parameter.default : value;
    if (candidate === undefined) {
      issues.push(issue(key, "extensions.parameters.required"));
      continue;
    }
    const result = validateParameter(
      key,
      parameter,
      candidate,
      context.lineCount,
      context.judgeLineGroups ?? [],
    );
    if (result.issue) {
      issues.push(result.issue);
    } else if (result.value !== undefined) {
      values[key] = result.value;
    }
  }

  return issues.length ? { ok: false, issues } : { ok: true, values };
}

export interface ParameterResolutionContext {
  /** Judge lines currently in the chart. */
  readonly lineCount: number;
  /** Injectable RNG in [0, 1); defaults to Math.random. */
  readonly random?: () => number;
}

/** Pick distinct candidates with the injected RNG, preserving candidate order. */
function pickRandomLines(
  candidates: readonly number[],
  count: number,
  random: () => number,
): readonly number[] {
  const pool = [...new Set(candidates)];
  const picks = new Set<number>();
  for (let index = 0; index < count && pool.length; index += 1) {
    const value = Number(random());
    const position = Number.isFinite(value)
      ? Math.min(pool.length - 1, Math.max(0, Math.floor(value * pool.length)))
      : 0;
    picks.add(pool.splice(position, 1)[0]);
  }
  // Keep the author's order for range candidates and the chart's order for
  // global picks, so event recipes receive a stable sequence.
  return candidates.filter((value) => picks.has(value));
}

/**
 * Turn range and global judge-line selections into concrete indices.
 *
 * Exact values are already concrete and pass through unchanged. Range picks
 * come from the candidate list in its written order; global picks come from
 * every line in the chart in chart order.
 */
export function resolveParameterValues(
  schema: ExtensionParameterSchema,
  values: Readonly<Record<string, ExtensionParameterInput>>,
  context: ParameterResolutionContext,
): ParameterResolutionResult {
  const resolved: Record<string, ExtensionParameterValue> = {};
  const issues: ExtensionParameterIssue[] = [];
  const random = context.random ?? Math.random;

  for (const key of parameterKeys(schema)) {
    const parameter = schema.parameters[key];
    const value = values[key];
    if (parameter.kind !== "judgeLine" || value === undefined) {
      if (value !== undefined && !isRecord(value)) {
        resolved[key] = value as ExtensionParameterValue;
      }
      continue;
    }
    const parsed = parseJudgeLineValue(value);
    if (!parsed) {
      issues.push(issue(key, "extensions.parameters.judgeLine.invalid"));
      continue;
    }
    const count = judgeLineCount(parameter);
    const need = count ?? 1;
    const multiple = judgeLineIsMultiple(parameter);
    if (parsed.mode === "global") {
      if (context.lineCount < need) {
        issues.push(issue(key, "extensions.parameters.judgeLine.unavailable", { count: need }));
        continue;
      }
      const all = Array.from({ length: context.lineCount }, (unused, index) => index);
      const picked = pickRandomLines(all, need, random);
      resolved[key] = multiple ? Object.freeze(picked) : (picked[0] ?? 0);
      continue;
    }
    if (parsed.mode === "range") {
      if (parsed.lines.length < need) {
        issues.push(issue(key, "extensions.parameters.judgeLine.range", { count: need }));
        continue;
      }
      const picked = pickRandomLines(parsed.lines, need, random);
      resolved[key] = multiple ? Object.freeze(picked) : (picked[0] ?? parsed.lines[0]);
      continue;
    }
    resolved[key] = multiple ? Object.freeze([...parsed.lines]) : (parsed.lines[0] as number);
  }

  return issues.length ? { ok: false, issues } : { ok: true, values: Object.freeze(resolved) };
}
