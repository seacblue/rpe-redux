/**
 * Judge-line group lookup over `chart.judgeLineGroup` and each line's `Group` field.
 *
 * Names are trimmed, reserved names receive collision-free numeric suffixes,
 * group index 0 is the fallback, and structural reassignment belongs to the
 * editor surfaces.
 */
import type { Chart, JudgeLine } from "../chart.ts";

/** RPE keyword that selects every judge line in a multi-line expression. */
export const MULTI_LINE_ALL_KEYWORD = "all";

/** Case-insensitive names reserved by the multi-line selection grammar. */
const RESERVED_LINE_GROUP_NAMES = new Set([MULTI_LINE_ALL_KEYWORD]);
/** Characters a folder expression cannot carry as part of one token. */
const GROUP_NAME_FORBIDDEN = /[，,()（）]/gu;

/** Case-insensitive key used for folder-name collision checks. */
function groupNameKey(value: string): string {
  return value.trim().toLocaleLowerCase();
}

/** Declared group names, trimmed; an absent list reads as one unnamed group. */
export function groupNames(chart: Chart | undefined): string[] {
  // A missing field means one unnamed group; an explicit empty array means the
  // user removed every group and stays empty.
  if (!Array.isArray(chart?.judgeLineGroup)) {
    return [""];
  }
  return chart.judgeLineGroup.map((name) => String(name ?? "").trim());
}

/** Return whether a folder name would collide with a multi-line keyword. */
export function isReservedLineGroupName(name: string): boolean {
  return RESERVED_LINE_GROUP_NAMES.has(groupNameKey(name));
}

/**
 * Sanitize one folder name and suffix a reserved word until it is available.
 *
 * `occupiedNames` is the set of names that must remain distinct from the
 * result. Suffixes start at one and use the first case-insensitive gap.
 */
export function sanitizeLineGroupName(name: string, occupiedNames: readonly string[] = []): string {
  const safe = name.replace(GROUP_NAME_FORBIDDEN, "").trim();
  if (!isReservedLineGroupName(safe)) {
    return safe;
  }
  const occupied = new Set(occupiedNames.map(groupNameKey));
  let suffix = 1;
  let candidate = `${safe}${suffix}`;
  while (occupied.has(groupNameKey(candidate))) {
    suffix += 1;
    candidate = `${safe}${suffix}`;
  }
  return candidate;
}

/** Normalize legacy folder names in place before a chart enters the editor. */
export function normalizeLineGroupNames(chart: Chart): Chart {
  if (!Array.isArray(chart.judgeLineGroup)) {
    return chart;
  }
  const original = chart.judgeLineGroup.map((name) => String(name ?? ""));
  const normalized: string[] = [];
  for (const name of original) {
    normalized.push(sanitizeLineGroupName(name, [...original, ...normalized]));
  }
  if (normalized.some((name, index) => name !== original[index])) {
    chart.judgeLineGroup = normalized;
  }
  return chart;
}

/** The line's group index; invalid or missing values read as the default group 0. */
export function lineGroupIndex(line: JudgeLine | undefined): number {
  const value = Number(line?.Group ?? 0);
  return Number.isInteger(value) && value >= 0 ? value : 0;
}

/** Line indices belonging to `groupIndex`, in chart order. */
export function groupLineIndices(chart: Chart | undefined, groupIndex: number): number[] {
  return (chart?.judgeLineList ?? []).flatMap((line, index) =>
    lineGroupIndex(line) === groupIndex ? [index] : [],
  );
}
