/**
 * Developer-only boundary checks and reporting helpers.
 *
 * Every helper is cheap and returns a boolean so an existing validation path
 * can report a finding without changing its behavior. The API guard and the
 * value/settings seams use these helpers instead of inventing message formats.
 */
import { reportDevFinding, type DevFindingKind } from "./detector.ts";

/** Options for a numeric range check. */
export interface DevRangeOptions {
  readonly integer?: boolean;
  readonly minExclusive?: boolean;
  readonly maxExclusive?: boolean;
}

/** Format a scalar for a finding without dumping a large payload. */
export function formatDevValue(value: unknown): string {
  if (typeof value === "string") {
    return value.length > 120 ? `${value.slice(0, 117)}...` : value;
  }
  if (typeof value === "number" || typeof value === "boolean" || value == null) {
    return String(value);
  }
  try {
    const text = JSON.stringify(value);
    return text.length > 120 ? `${text.slice(0, 117)}...` : text;
  } catch {
    return String(value);
  }
}

/** Report one finding from an arbitrary source. */
export function devReport(
  kind: DevFindingKind,
  source: string,
  message: string,
  detail?: string,
): void {
  reportDevFinding({ kind, source, message, ...(detail === undefined ? {} : { detail }) });
}

/** Report a deprecated API call with its replacement. */
export function devReportDeprecatedApi(source: string, replacement: string): void {
  devReport("deprecated", source, replacement);
}

/** Report a numeric or index value outside its contract. */
export function devCheckRange(
  source: string,
  value: unknown,
  minimum: number,
  maximum: number,
  options: DevRangeOptions = {},
): boolean {
  const lowerOk = options.minExclusive ? Number(value) > minimum : Number(value) >= minimum;
  const upperOk = options.maxExclusive ? Number(value) < maximum : Number(value) <= maximum;
  const integerOk = options.integer ? Number.isInteger(value) : true;
  if (typeof value === "number" && Number.isFinite(value) && lowerOk && upperOk && integerOk) {
    return true;
  }
  const bounds = `${options.minExclusive ? "(" : "["}${minimum}, ${maximum}${
    options.maxExclusive ? ")" : "]"
  }`;
  devReport(
    "out-of-range",
    source,
    `Expected a${options.integer ? "n integer" : " number"} in ${bounds}, received ${formatDevValue(value)}`,
  );
  return false;
}

/** Report an array index outside `[0, length)`. */
export function devCheckIndex(source: string, value: unknown, length: number): boolean {
  if (Number.isInteger(value) && Number(value) >= 0 && Number(value) < length) {
    return true;
  }
  devReport(
    "out-of-range",
    source,
    `Expected an index in [0, ${length}), received ${formatDevValue(value)}`,
  );
  return false;
}

/** Report a value outside a closed set. */
export function devCheckOneOf(
  source: string,
  value: unknown,
  allowed: readonly (string | number | boolean)[],
): boolean {
  if (allowed.some((candidate) => Object.is(candidate, value))) {
    return true;
  }
  devReport(
    "invalid",
    source,
    `Expected one of ${allowed.map(formatDevValue).join(", ")}, received ${formatDevValue(value)}`,
  );
  return false;
}

/** Report a non-finite number. */
export function devCheckFinite(source: string, value: unknown): boolean {
  if (typeof value === "number" && Number.isFinite(value)) {
    return true;
  }
  devReport("out-of-range", source, `Expected a finite number, received ${formatDevValue(value)}`);
  return false;
}

/** Report a validation error that a caller is about to rethrow. */
export function devReportValidation(source: string, error: unknown): void {
  const kind: DevFindingKind = error instanceof RangeError ? "out-of-range" : "invalid";
  devReport(kind, source, error instanceof Error ? error.message : String(error));
}

/** Report a caught error or rejected promise at an API boundary. */
export function devReportError(source: string, error: unknown, detail?: string): void {
  devReport(
    error instanceof RangeError ? "out-of-range" : "error",
    source,
    error instanceof Error ? error.message : String(error),
    detail,
  );
}

/** Inspect an `ApiResult` or transaction/page status and report failures. */
export function devInspectResult(source: string, value: unknown, detail?: string): void {
  if (!value || typeof value !== "object") {
    return;
  }
  const record = value as Record<string, unknown>;
  if (record.ok === false && record.error && typeof record.error === "object") {
    const error = record.error as Record<string, unknown>;
    devReport(
      typeof error.code === "string" && error.code === "invalid_request" ? "invalid" : "error",
      source,
      typeof error.message === "string" ? error.message : String(error.code ?? "request failed"),
      detail,
    );
    return;
  }
  // A successful envelope carries the domain status under `value`; a page
  // status can also arrive directly, so inspect both shapes.
  const payload =
    record.ok === true && record.value && typeof record.value === "object"
      ? (record.value as Record<string, unknown>)
      : record;
  if (payload.status === "invalid_request") {
    devReport(
      "invalid",
      source,
      `Request was rejected: ${String(payload.reason ?? "invalid_request")}`,
      detail,
    );
    return;
  }
  if (payload.status === "rejected" || payload.status === "conflict") {
    const issues = Array.isArray(payload.issues) ? payload.issues : [];
    if (issues.length > 0) {
      for (const issue of issues.slice(0, 8)) {
        const entry = issue && typeof issue === "object" ? (issue as Record<string, unknown>) : {};
        devReport(
          "error",
          source,
          `${String(entry.code ?? payload.status)}: ${String(entry.message ?? "request rejected")}`,
          typeof entry.path === "string" ? `path: ${entry.path}` : detail,
        );
      }
      return;
    }
    devReport("error", source, `Request status: ${String(payload.status)}`, detail);
  }
}
