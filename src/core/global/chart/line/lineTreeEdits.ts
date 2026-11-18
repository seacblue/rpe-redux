/**
 * Structural edits for the judge-line folder tree: assigning lines to folders
 * and managing the single level of line groups.
 *
 * A line's number is its position in `judgeLineList`; lines are never reordered
 * inside a folder, so changing folders leaves every number untouched. Group
 * nesting is deliberately absent: `judgeLineGroup` is a flat list, and a line's
 * `Group` is a flat index into it.
 */
import { t } from "../../../../i18n/index.ts";
import type { Chart } from "../chart.ts";
import { lineGroupIndex } from "./lineGroups.ts";

/** Group names as stored, untrimmed; an absent list reads as one unnamed group. */
function rawGroupNames(chart: Chart): string[] {
  if (!Array.isArray(chart.judgeLineGroup)) {
    return [""];
  }
  return chart.judgeLineGroup.map((name) => String(name ?? ""));
}

/** Return the group names after checking that `index` addresses one. */
function requireGroup(chart: Chart, index: number): string[] {
  const names = rawGroupNames(chart);
  if (!Number.isInteger(index) || index < 0 || index >= names.length) {
    throw new Error(t("editor.commands.lineCommands.error.invalidIndex"));
  }
  return names;
}

/** Characters the line field cannot read inside a folder name. */
const GROUP_NAME_FORBIDDEN = /[，,()（）]/gu;

/**
 * Remove characters a folder expression cannot carry.
 *
 * A folder name is written in the line field, where commas separate tokens and
 * parentheses mark the active line. Creating or renaming a folder silently
 * drops those characters instead of rejecting the name; the caller still owns
 * the empty-name and duplicate-name rules.
 */
export function sanitizeLineGroupName(name: string): string {
  return name.replace(GROUP_NAME_FORBIDDEN, "").trim();
}

/**
 * Assign lines to a folder without changing their order.
 *
 * The flat list order is the line number, so a folder move only rewrites
 * `Group`. Keeping the order makes numbers stable across folders and leaves
 * every folder listing its lines in ascending number order.
 */
export function assignLinesToGroup(
  chart: Chart,
  sourceIndices: readonly number[],
  groupIndex: number,
): Chart {
  requireGroup(chart, groupIndex);
  const lines = chart.judgeLineList ?? [];
  const targets = new Set(
    sourceIndices.filter((index) => Number.isInteger(index) && index >= 0 && index < lines.length),
  );
  if (!targets.size) {
    return chart;
  }
  let changed = false;
  const nextLines = lines.map((line, index) => {
    if (!targets.has(index) || lineGroupIndex(line) === groupIndex) {
      return line;
    }
    changed = true;
    return { ...line, Group: groupIndex };
  });
  return changed ? { ...chart, judgeLineList: nextLines } : chart;
}

/** Reorder the flat group list and remap every line's `Group` index. */
export function reorderLineGroup(chart: Chart, from: number, to: number): Chart {
  const names = requireGroup(chart, from);
  requireGroup(chart, to);
  if (from === to) {
    return chart;
  }
  const order = names.map((unused, index) => index);
  order.splice(to, 0, order.splice(from, 1)[0]);
  const destinations = new Map<number, number>(
    order.map((oldIndex, newIndex): [number, number] => [oldIndex, newIndex]),
  );
  const lines = (chart.judgeLineList ?? []).map((line) => ({
    ...line,
    Group: destinations.get(lineGroupIndex(line)) ?? lineGroupIndex(line),
  }));
  return {
    ...chart,
    judgeLineGroup: order.map((oldIndex) => names[oldIndex]),
    judgeLineList: lines,
  };
}

/** Append a new, empty folder. The caller owns duplicate and empty-name checks. */
export function addLineGroup(chart: Chart, name: string): Chart {
  return {
    ...chart,
    judgeLineGroup: [...rawGroupNames(chart), sanitizeLineGroupName(name)],
  };
}

/** Rename one flat folder without touching the lines it contains. */
export function renameLineGroup(chart: Chart, index: number, name: string): Chart {
  const names = requireGroup(chart, index);
  names[index] = sanitizeLineGroupName(name);
  return { ...chart, judgeLineGroup: names };
}

/**
 * Remove a folder and move its lines to the default folder.
 *
 * The default folder is removable once it is empty, so the tree can reach a
 * truly empty state. Every later group can move down into the gap.
 */
export function removeLineGroup(chart: Chart, index: number): Chart {
  const names = requireGroup(chart, index);
  const lines = chart.judgeLineList ?? [];
  // Only an empty group 0 may be removed directly; other groups must be emptied first.
  if (index === 0 && lines.some((line) => lineGroupIndex(line) === 0)) {
    throw new Error(t("editor.commands.lineCommands.error.groupNotEmpty"));
  }
  const nextLines = lines.map((line) => {
    const current = lineGroupIndex(line);
    return {
      ...line,
      Group: current === index ? 0 : current > index ? current - 1 : current,
    };
  });
  return {
    ...chart,
    judgeLineGroup: names.filter((unused, current) => current !== index),
    judgeLineList: nextLines,
  };
}
