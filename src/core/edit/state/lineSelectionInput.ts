/**
 * Parses the toolbar and multi-line line fields into an ordered selection.
 *
 * The grammar is a union of one or more parts separated by the ASCII comma,
 * the CJK comma, or whitespace. A part is:
 *
 * - one index (`3`), clamped to the document's nearest existing line;
 * - an inclusive range (`2:5`, `2-5`, `2：5`) with an optional `/step`
 *   (`80:119/5`). A missing step means 1, the end is always included, and a
 *   reversed range is read in ascending order;
 * - a folder name, matched before numbers so a folder named `3` stays a
 *   folder. Matching ignores case and surrounding spaces. A name containing
 *   spaces must be a whole comma-separated part; an unspaced name may sit
 *   beside numeric tokens. Creating or renaming a folder strips commas and
 *   parentheses, so a declared name is always one writable token.
 *
 * Multi-line mode appends the active line as an annotation: `0-15 (3)` is the
 * selection `0-15` on active line `3`. A trailing parenthesized number is
 * therefore an annotation, not a member; a single parenthesized index (`(3)`)
 * is accepted as that one line. This also keeps RPE-style labels such as
 * `1(0)` readable.
 *
 * The returned lines keep the written token order and are duplicate-free. The
 * parser never merges adjacent tokens or sorts the union: `5,3,1` stays
 * `5,3,1`, and the formatter writes each token back as it was written.
 */
import type { Chart } from "../../global/chart/chart.ts";
import { groupNames, lineGroupIndex } from "../../global/chart/line/lineGroups.ts";
import {
  formatLineSelectionTokens,
  lineSelectionGroupName,
  resolveLineSelection,
  tokensFromLines,
  type LineSelectionGroup,
  type LineSelectionToken,
} from "./lineSelectionTokens.ts";

/** One parsed line selection, ordered as the user wrote it. */
export interface LineSelectionInput {
  /** The line the timeline switches to: the annotation when present, else the union's first line. */
  line: number;
  /** Every named line, in written order and without duplicates. */
  lines: readonly number[];
  /** The annotation's line when the text carried one, so a caller can prefer its own focus. */
  current?: number;
  /** The authored tokens behind `lines`, in written order. */
  tokens: readonly LineSelectionToken[];
}

const SINGLE = /^-?\d+$/;
const RANGE = /^(-?\d+)\s*[:：-]\s*(-?\d+)(?:\s*\/\s*(\d+))?$/;
const PARENTHESIZED_ONLY = /^[（(]\s*(-?\d+)\s*[)）]$/u;
const PARENTHESIZED_TAIL = /\s*[（(]\s*(-?\d+)\s*[)）]\s*$/u;
const COMMA = /[,，]/u;
const WHITESPACE = /\s+/u;
const OPERATOR_SPACES = /(\d)\s*([:：/-])\s*(\d)/gu;

/** Build the folder descriptors the expression parser matches against. */
export function lineSelectionGroups(chart: Chart | null | undefined): LineSelectionGroup[] {
  const names = groupNames(chart ?? undefined);
  const buckets = names.map((): number[] => []);
  for (const [index, line] of (chart?.judgeLineList ?? []).entries()) {
    const group = lineGroupIndex(line);
    buckets[group]?.push(index);
  }
  return names.map((name, index) => ({ index, name, indices: buckets[index] }));
}

/**
 * Write programmatic line indices as the compact form a field shows.
 *
 * The input order is preserved; only adjacent values in that order become one
 * range. This helper is for index lists, not for text the user typed — the
 * expression formatter writes each authored token separately.
 */
export function formatLineSelection(lines: readonly number[]): string {
  return formatLineSelectionTokens(tokensFromLines(lines));
}

/**
 * The multi-line field's text for a programmatic line list: the compact union
 * plus its active line in parentheses, or the single line by itself.
 */
export function formatLineSelectionDisplay(lines: readonly number[], activeLine: number): string {
  const tokens = tokensFromLines(lines);
  const text = formatLineSelectionTokens(tokens);
  if (!text || resolveLineSelection(tokens, lines).length <= 1) {
    return text;
  }
  const active = Number.isInteger(activeLine) && activeLine >= 0 ? activeLine : lines[0];
  return `${text} (${active})`;
}

/** Remove a trailing `(X)` annotation and read its line, when one is present. */
function splitAnnotations(text: string): { selection: string; current: number | null } {
  const only = PARENTHESIZED_ONLY.exec(text);
  if (only) {
    return { selection: only[1], current: Number(only[1]) };
  }
  const tail = PARENTHESIZED_TAIL.exec(text);
  if (!tail) {
    return { selection: text, current: null };
  }
  return {
    selection: text.slice(0, tail.index).trim(),
    current: Number(tail[1]),
  };
}

/** Match one written part against the declared folder names and labels. */
function matchGroup(
  text: string,
  groups: readonly LineSelectionGroup[],
): LineSelectionGroup | null {
  const wanted = text.trim().toLocaleLowerCase();
  if (!wanted) {
    return null;
  }
  return (
    groups.find(
      (group) =>
        group.name.trim().toLocaleLowerCase() === wanted ||
        (group.label ?? "").trim().toLocaleLowerCase() === wanted,
    ) ?? null
  );
}

/**
 * Read one typed line selection.
 *
 * Returns `null` for text that names no existing line, including an empty
 * field, a token that is neither an index, a range, nor a declared folder, a
 * non-positive step, and a union whose parts are all outside the document.
 * The caller decides whether a refusal is an error or simply leaves the
 * current selection alone.
 */
export function parseLineSelectionInput(
  raw: string,
  available: readonly number[],
  groups: readonly LineSelectionGroup[] = [],
): LineSelectionInput | null {
  const text = raw.trim();
  if (!text || !available.length) {
    return null;
  }
  const { selection, current } = splitAnnotations(text);
  if (!selection) {
    return null;
  }
  const known = new Set(available);
  const minimum = Math.min(...available);
  const maximum = Math.max(...available);
  const clampIndex = (value: number): number => Math.min(maximum, Math.max(minimum, value));
  const tokens: LineSelectionToken[] = [];
  for (const part of selection.split(COMMA)) {
    const trimmed = part.trim();
    if (!trimmed) {
      continue;
    }
    // A folder name may contain spaces, so test the whole comma-separated part
    // before whitespace is treated as a separator.
    const wholeGroup = matchGroup(trimmed, groups);
    if (wholeGroup) {
      tokens.push({
        kind: "group",
        group: wholeGroup.index,
        name: lineSelectionGroupName(wholeGroup),
      });
      continue;
    }
    const normalized = trimmed.replace(OPERATOR_SPACES, "$1$2$3");
    for (const tokenText of normalized.split(WHITESPACE)) {
      if (!tokenText) {
        continue;
      }
      const group = matchGroup(tokenText, groups);
      if (group) {
        tokens.push({ kind: "group", group: group.index, name: lineSelectionGroupName(group) });
        continue;
      }
      const range = RANGE.exec(tokenText);
      if (range) {
        const step = range[3] === undefined ? 1 : Number(range[3]);
        if (!Number.isInteger(step) || step <= 0) {
          return null;
        }
        let start = clampIndex(Number(range[1]));
        let end = clampIndex(Number(range[2]));
        if (start > end) {
          [start, end] = [end, start];
        }
        tokens.push({ kind: "range", start, end, step });
        continue;
      }
      if (!SINGLE.test(tokenText)) {
        return null;
      }
      tokens.push({ kind: "line", line: clampIndex(Number(tokenText)) });
    }
  }
  if (!tokens.length) {
    return null;
  }
  const lines = resolveLineSelection(tokens, known, groups);
  if (!lines.length) {
    return null;
  }
  // A union's annotation names the active line; on a single line it is only a
  // readable label (RPE writes a parent's index as `1(0)`), so the line itself
  // stays the selection.
  const annotation = current === null ? null : clampIndex(current);
  const carriesActive = lines.length > 1 && annotation !== null;
  return {
    line: carriesActive ? annotation : lines[0],
    lines,
    tokens,
    ...(carriesActive ? { current: annotation } : {}),
  };
}
