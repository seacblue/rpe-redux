/**
 * Provides the shared privacy projection used by diagnostics values and
 * support-bundle summaries.
 *
 * The projection is deliberately bounded and structural: callers must still
 * choose an allowlist for user content such as chart metadata and frame data.
 */
import { isRecord } from "../utils/guards.ts";

/** Values that survive diagnostics redaction and JSON serialization. */
export type DiagnosticsValue =
  | string
  | number
  | boolean
  | null
  | readonly DiagnosticsValue[]
  | { readonly [key: string]: DiagnosticsValue };

const REDACTED = "[redacted]";
const sensitiveKey =
  /(?:path|file|directory|folder|origin|url|token|secret|password|credential|authorization|cookie|resource|bytes|base64|chart|audio|image|texture|project|recent|library|email)/i;
const absolutePath = /(?:[a-z]:[\\/]|\\\\|file:|https?:\/\/)[^\s"'<>]*/gi;
const email = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const secretAssignment =
  /\b(?:token|secret|password|authorization|cookie|api[_-]?key)\b\s*[:=]\s*[^\s,;]+/gi;

/** Remove common embedded secrets and host identifiers from one string. */
export function redactDiagnosticText(value: string): string {
  return value
    .slice(0, 256)
    .replace(secretAssignment, (match) => `${match.slice(0, match.search(/[:=]/))}${REDACTED}`)
    .replace(absolutePath, REDACTED)
    .replace(email, REDACTED);
}

/** Recursively drop sensitive keys and bound strings, arrays, and depth. */
export function redactDiagnosticValue(value: unknown, key = "", depth = 0): DiagnosticsValue {
  if (sensitiveKey.test(key)) {
    return REDACTED;
  }
  if (value === null || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : REDACTED;
  }
  if (typeof value === "string") {
    return redactDiagnosticText(value);
  }
  if (depth >= 3 || !isRecord(value)) {
    return REDACTED;
  }
  if (Array.isArray(value)) {
    return Object.freeze(
      value.slice(0, 32).map((item) => redactDiagnosticValue(item, key, depth + 1)),
    );
  }
  const result: Record<string, DiagnosticsValue> = {};
  for (const [childKey, childValue] of Object.entries(value).slice(0, 32)) {
    result[childKey] = redactDiagnosticValue(childValue, childKey, depth + 1);
  }
  return Object.freeze(result);
}
