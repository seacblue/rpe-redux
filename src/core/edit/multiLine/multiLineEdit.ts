/**
 * Parses and formats the multi-line target selection.
 *
 * An expression accepts indices, inclusive ranges and line-group names; the
 * results are deduplicated and sorted so operations see a stable line order
 * regardless of how the text was written.
 */
import { t } from "../../../i18n/index.ts";
import { groupLineIndices, groupNames } from "../../global/chart/line/lineGroups.ts";
import type { Chart } from "../../global/chart/chart.ts";
import type { EditorShortcutDefinition } from "../shortcuts/declarations.ts";

/** Keeps valid unique line indices in ascending order. */
export function normalizeLineIndices(
  indices: readonly number[] | null | undefined,
  lineCount: number,
): number[] {
  return [
    ...new Set(
      (indices ?? []).filter((index) => Number.isInteger(index) && index >= 0 && index < lineCount),
    ),
  ].sort((a, b) => a - b);
}

/** Parses indices, inclusive ranges, and group names; throws on invalid tokens. */
export function parseLineExpression(
  text: string,
  lineCount: number,
  chart: Chart | null = null,
): number[] {
  const values: number[] = [];
  const groups = new Map(groupNames(chart ?? undefined).map((name, index) => [name, index]));
  for (const token of String(text ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)) {
    const range = token.split(":");
    const groupIndex = groups.get(token);
    if (range.length === 1 && groupIndex !== undefined) {
      values.push(...groupLineIndices(chart ?? undefined, groupIndex));
    } else if (range.length === 1 && /^[-+]?\d+$/.test(token)) {
      values.push(Number(token));
    } else if (range.length === 2 && /^[-+]?\d+$/.test(range[0]) && /^[-+]?\d+$/.test(range[1])) {
      const start = Number(range[0]);
      const end = Number(range[1]);
      if (start > end) {
        throw new Error(t("editor.commands.multiLineEdit.error.invalidRange", { range: token }));
      }
      for (let index = start; index <= end; index++) {
        values.push(index);
      }
    } else {
      throw new Error(t("editor.commands.multiLineEdit.error.unparsableLine", { token }));
    }
  }
  return normalizeLineIndices(values, lineCount);
}

/** Formats indices using group names first, then numeric runs. */
export function formatLineExpression(
  indices: readonly number[] | null | undefined,
  chart: Chart | null = null,
): string {
  const values = normalizeLineIndices(indices, Number.MAX_SAFE_INTEGER);
  const tokens: string[] = [];
  const remaining = new Set(values);
  if (chart) {
    for (const [groupIndex, name] of groupNames(chart).entries()) {
      if (groupIndex === 0 || !name || /\s/.test(name)) {
        continue;
      }
      const members = groupLineIndices(chart, groupIndex);
      if (members.length && members.every((index) => remaining.has(index))) {
        tokens.push(name);
        members.forEach((index) => remaining.delete(index));
      }
    }
  }
  const numeric = [...remaining].sort((left, right) => left - right);
  for (let index = 0; index < numeric.length;) {
    let end = index;
    while (end + 1 < numeric.length && numeric[end + 1] === numeric[end] + 1) {
      end++;
    }
    const length = end - index + 1;
    tokens.push(
      length >= 3 ? `${numeric[index]}:${numeric[end]}` : numeric.slice(index, end + 1).join(" "),
    );
    index = end + 1;
  }
  return tokens.join(" ");
}

// ------------------------------------------------------------------ shortcuts

/** The multi-line workspace is opened, closed and switched from these keys. */
export const multiLineShortcuts: readonly EditorShortcutDefinition[] = [
  {
    id: "workspace.multiLine.toggle",
    category: "editor.selection",
    title: "shortcuts.editor.toggleMultiLine",
    scope: "editor",
    // J and K are adjacent home-row keys, clear of the left-hand placement
    // keys. The sampling pane still owns the workspace while a sample is active.
    defaults: [{ key: "J" }],
    enabledFor: (context) => !context.samplingActive,
  },
  {
    id: "workspace.multiLine.switchMode",
    category: "editor.selection",
    title: "shortcuts.editor.switchMultiLineMode",
    scope: "editor",
    defaults: [{ key: "K" }],
    enabledFor: (context) => !context.samplingActive,
  },
];
