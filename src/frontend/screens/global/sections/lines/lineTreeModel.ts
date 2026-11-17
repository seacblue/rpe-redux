/**
 * Shared identity and folder helpers for the judge-line folder tree.
 *
 * The tree keeps multi-selection in the stable mounted panel while chart
 * indices move during reorder and deletion, so line ids are the durable key.
 * The index fallback covers a line without an id. Folder bucketing clamps
 * imported group indices the same way the tree does.
 */
import type { Chart, JudgeLine } from "../../../../../core/global/chart/chart.ts";
import { groupNames, lineGroupIndex } from "../../../../../core/global/chart/line/lineGroups.ts";

/** Stable key for one line while it stays in the current chart. */
export function lineTreeKey(lines: readonly JudgeLine[], index: number): string {
  const id = String(lines[index]?.id ?? "").trim();
  return id || `index:${index}`;
}

/**
 * Line indices the tree shows inside one folder.
 *
 * An imported chart may point a line outside the declared groups; the tree
 * folds those lines into the last folder, so the properties panel and the
 * "select every line in this folder" action use the same bucket.
 */
export function lineFolderIndices(chart: Chart | undefined, folder: number): number[] {
  const lines = chart?.judgeLineList ?? [];
  const last = Math.max(0, groupNames(chart).length - 1);
  const target = Math.min(Math.max(folder, 0), last);
  return lines.flatMap((line, index) =>
    Math.min(Math.max(lineGroupIndex(line), 0), last) === target ? [index] : [],
  );
}

/** True when line order or folder assignment differs between two charts. */
export function lineTreeChanged(before: Chart, after: Chart): boolean {
  const beforeLines = before.judgeLineList ?? [];
  const afterLines = after.judgeLineList ?? [];
  if (beforeLines.length !== afterLines.length) {
    return true;
  }
  return afterLines.some(
    (line, index) =>
      String(line.id ?? index) !== String(beforeLines[index]?.id ?? index) ||
      line.Group !== beforeLines[index]?.Group,
  );
}

/**
 * The selected line that should receive focus after one row leaves the tree.
 *
 * The current line keeps focus while it is still selected and the removed row
 * was a different line; otherwise the nearest remaining selected line wins.
 */
export function lineFocusAfterRemoval(
  removed: number,
  selected: ReadonlySet<string>,
  lines: readonly JudgeLine[],
  lineIndices: ReadonlyMap<string, number>,
  currentIndex: number,
): number {
  if (removed !== currentIndex && selected.has(lineTreeKey(lines, currentIndex))) {
    return currentIndex;
  }
  let best = currentIndex;
  let bestDistance = Infinity;
  for (const id of selected) {
    const index = lineIndices.get(id);
    if (index === undefined) {
      continue;
    }
    const distance = Math.abs(index - removed);
    if (distance < bestDistance) {
      best = index;
      bestDistance = distance;
    }
  }
  return best;
}
