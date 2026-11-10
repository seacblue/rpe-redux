/**
 * Scans RPE chart JSON into a small header plus per-line source ranges without
 * building the full chart object graph. The scanner validates JSON structure
 * enough to slice values safely; each slice is still parsed with `JSON.parse`
 * so number and string semantics stay identical to the normal loader.
 */
import type { ChartLineRange } from "./chartStreamTypes.ts";

/** Header fields and line ranges read from one chart JSON text. */
export interface ChartJsonScan {
  readonly text: string;
  readonly header: Record<string, unknown>;
  readonly headerRaw: Record<string, string>;
  readonly lineRanges: readonly ChartLineRange[];
  readonly keyOrder: readonly string[];
}

/** Thrown when the source is not a complete JSON object. */
export class ChartJsonScanError extends Error {
  readonly name = "ChartJsonScanError";
}

/** Return the next non-whitespace index at or after `start`. */
function skipWhitespace(text: string, start: number): number {
  let index = start;
  while (index < text.length) {
    const code = text.charCodeAt(index);
    if (code === 0x20 || code === 0x09 || code === 0x0a || code === 0x0d) {
      index++;
      continue;
    }
    break;
  }
  return index;
}

/** Require one punctuation character and return the index after it. */
function expect(text: string, index: number, character: string): number {
  if (text[index] !== character) {
    throw new ChartJsonScanError(`Expected ${character} at ${index}`);
  }
  return index + 1;
}

/** Scan a JSON string and return the index after its closing quote. */
function scanString(text: string, start: number): number {
  let index = start + 1;
  while (index < text.length) {
    const code = text.charCodeAt(index);
    if (code === 0x22) {
      return index + 1;
    }
    if (code === 0x5c) {
      // Skip the escaped character; a `\u` escape's hex digits are ordinary
      // characters for the scanner and are validated by JSON.parse later.
      index += 2;
      continue;
    }
    index++;
  }
  throw new ChartJsonScanError("Unterminated JSON string");
}

/** Scan a JSON number and return the index after its last character. */
function scanNumber(text: string, start: number): number {
  let index = start;
  while (index < text.length) {
    const code = text.charCodeAt(index);
    const numeric =
      (code >= 0x30 && code <= 0x39) ||
      code === 0x2d ||
      code === 0x2b ||
      code === 0x2e ||
      code === 0x45 ||
      code === 0x65;
    if (!numeric) {
      break;
    }
    index++;
  }
  if (index === start) {
    throw new ChartJsonScanError(`Expected a JSON value at ${start}`);
  }
  return index;
}

/** Scan one JSON value and return the index after it. */
function scanValue(text: string, start: number): number {
  const index = skipWhitespace(text, start);
  const character = text[index];
  if (character === '"') {
    return scanString(text, index);
  }
  if (character === "{") {
    return scanObject(text, index);
  }
  if (character === "[") {
    return scanArray(text, index);
  }
  if (character === "-" || (character >= "0" && character <= "9")) {
    return scanNumber(text, index);
  }
  if (text.startsWith("true", index)) {
    return index + 4;
  }
  if (text.startsWith("false", index)) {
    return index + 5;
  }
  if (text.startsWith("null", index)) {
    return index + 4;
  }
  throw new ChartJsonScanError(`Expected a JSON value at ${index}`);
}

/** Scan an object, validating its key/value punctuation. */
function scanObject(text: string, start: number): number {
  let index = expect(text, start, "{");
  index = skipWhitespace(text, index);
  if (text[index] === "}") {
    return index + 1;
  }
  while (index < text.length) {
    index = skipWhitespace(text, index);
    index = expect(text, index, '"');
    index = scanString(text, index - 1);
    index = expect(text, skipWhitespace(text, index), ":");
    index = scanValue(text, index);
    index = skipWhitespace(text, index);
    if (text[index] === ",") {
      index = skipWhitespace(text, index + 1);
      continue;
    }
    return expect(text, index, "}");
  }
  throw new ChartJsonScanError("Unterminated JSON object");
}

/** Scan an array, validating its element punctuation. */
function scanArray(text: string, start: number, ranges?: ChartLineRange[]): number {
  let index = expect(text, start, "[");
  index = skipWhitespace(text, index);
  if (text[index] === "]") {
    return index + 1;
  }
  while (index < text.length) {
    const elementStart = index;
    index = scanValue(text, index);
    ranges?.push({ start: elementStart, end: index });
    index = skipWhitespace(text, index);
    if (text[index] === ",") {
      index = skipWhitespace(text, index + 1);
      continue;
    }
    return expect(text, index, "]");
  }
  throw new ChartJsonScanError("Unterminated JSON array");
}

/** Scan one top-level JSON array into element source ranges. */
export function scanJsonArrayRanges(text: string): ChartLineRange[] {
  const ranges: ChartLineRange[] = [];
  const start = skipWhitespace(text, 0);
  const end = scanArray(text, start, ranges);
  if (skipWhitespace(text, end) !== text.length) {
    throw new ChartJsonScanError("Trailing content after JSON array");
  }
  return ranges;
}

/** Scan the `judgeLineList` array and record each element's source range. */
function scanLineArray(
  text: string,
  start: number,
): { readonly next: number; readonly ranges: ChartLineRange[] } {
  const ranges: ChartLineRange[] = [];
  let index = expect(text, start, "[");
  index = skipWhitespace(text, index);
  if (text[index] === "]") {
    return { next: index + 1, ranges };
  }
  while (index < text.length) {
    const elementStart = index;
    const elementEnd = scanValue(text, elementStart);
    ranges.push({ start: elementStart, end: elementEnd });
    index = skipWhitespace(text, elementEnd);
    if (text[index] === ",") {
      index = skipWhitespace(text, index + 1);
      continue;
    }
    return { next: expect(text, index, "]"), ranges };
  }
  throw new ChartJsonScanError("Unterminated judgeLineList array");
}

/** Parse one top-level value; the caller keeps its raw slice for round trips. */
function parseHeaderValue(raw: string, key: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    throw new ChartJsonScanError(`Invalid JSON value for ${key}`);
  }
}

/**
 * Scan chart JSON into a header and line ranges.
 *
 * The scanner accepts any top-level key order. `judgeLineList` elements are
 * never parsed here; callers parse only the ranges they need.
 */
export function scanChartJson(text: string): ChartJsonScan {
  const header: Record<string, unknown> = {};
  const headerRaw: Record<string, string> = {};
  const keyOrder: string[] = [];
  const lineRanges: ChartLineRange[] = [];
  let index = skipWhitespace(text, 0);
  index = expect(text, index, "{");
  index = skipWhitespace(text, index);
  if (text[index] === "}") {
    index++;
  } else {
    while (index < text.length) {
      const keyStart = index;
      expect(text, keyStart, '"');
      const keyEnd = scanString(text, keyStart);
      const key = JSON.parse(text.slice(keyStart, keyEnd)) as string;
      index = expect(text, skipWhitespace(text, keyEnd), ":");
      index = skipWhitespace(text, index);
      if (key === "judgeLineList") {
        const scanned = scanLineArray(text, index);
        lineRanges.push(...scanned.ranges);
        index = scanned.next;
      } else {
        const valueStart = index;
        const valueEnd = scanValue(text, valueStart);
        const raw = text.slice(valueStart, valueEnd);
        headerRaw[key] = raw;
        header[key] = parseHeaderValue(raw, key);
        index = valueEnd;
      }
      keyOrder.push(key);
      index = skipWhitespace(text, index);
      if (text[index] === ",") {
        index = skipWhitespace(text, index + 1);
        continue;
      }
      index = expect(text, index, "}");
      break;
    }
  }
  index = skipWhitespace(text, index);
  if (index !== text.length) {
    throw new ChartJsonScanError("Trailing content after chart JSON");
  }
  return { text, header, headerRaw, lineRanges, keyOrder };
}
