/**
 * Structural judge-line edits: delete, duplicate and re-parent.
 *
 * Every helper returns a new chart with `father` links and shader line references
 * remapped to the resulting indices, so callers never fix references themselves.
 */
import { t } from "../../../../i18n/index.ts";
import { remapShaderLines } from "../shader/shaderEvents.ts";
import type { Chart, JudgeLine } from "../chart.ts";

/** A chart whose judge line list is known to be present and dense. */
type ChartWithLines = Chart & { judgeLineList: JudgeLine[] };

/** Throw unless `index` addresses a line in `chart`. */
function requireLine(chart: Chart, index: number): asserts chart is ChartWithLines {
  if (!Number.isInteger(index) || !chart.judgeLineList?.[index]) {
    throw new Error(t("editor.commands.lineCommands.error.invalidIndex"));
  }
}

/** Remove a line, reparent its children to the root, and remap shader references. */
export function deleteLine(chart: Chart, index: number): Chart {
  requireLine(chart, index);
  const lines = chart.judgeLineList
    .filter((line, current) => current !== index)
    .map((line) => {
      if (line.father === index) {
        return { ...line, father: -1 };
      }
      if (Number(line.father) > index) {
        return { ...line, father: Number(line.father) - 1 };
      }
      return line;
    });
  const destinations = new Map<number, number>(
    chart.judgeLineList.flatMap((line, current): [number, number][] =>
      current === index ? [] : [[current, current > index ? current - 1 : current]],
    ),
  );
  return remapShaderLines(chart, { ...chart, judgeLineList: lines }, destinations);
}

/** Append a deep copy of a line with a suffixed name and its shader effects. */
export function duplicateLine(chart: Chart, index: number): Chart {
  requireLine(chart, index);
  const line = structuredClone(chart.judgeLineList[index]);
  line.Name = t("editor.commands.lineCommands.duplicateNameSuffix", {
    name: line.Name || t("editor.commands.lineCommands.defaultName"),
  });
  return remapShaderLines(
    chart,
    { ...chart, judgeLineList: [...chart.judgeLineList, line] },
    new Map<number, number>(
      chart.judgeLineList.map((line, index): [number, number] => [index, index]),
    ),
    index,
  );
}

/** Point a line at `parent`, rejecting cycles and invalid indices. */
export function setLineParent(chart: Chart, index: number, parent: number): Chart {
  return setLineParents(chart, [index], parent);
}

/**
 * Point several lines at one parent as one validated structural edit.
 *
 * Validation reads the prospective parent map before writing any line, so a
 * failed batch cannot leave a partially re-parented chart and a selection that
 * includes the parent is rejected when it would create a cycle.
 */
export function setLineParents(chart: Chart, indices: readonly number[], parent: number): Chart {
  const lines = chart.judgeLineList;
  if (!lines) {
    throw new Error(t("editor.commands.lineCommands.error.invalidIndex"));
  }
  const targets = [...new Set(indices)];
  targets.forEach((target) => requireLine(chart, target));
  if (!Number.isInteger(parent) || parent < -1) {
    throw new Error(t("editor.commands.lineCommands.error.invalidIndex"));
  }
  if (parent !== -1) {
    requireLine(chart, parent);
  }

  const targetSet = new Set(targets);
  const originalParent = (index: number): number => {
    const value = lines[index]?.father;
    const resolved = value === undefined || value === null || value === "" ? -1 : Number(value);
    if (!Number.isInteger(resolved) || resolved < -1 || resolved >= lines.length) {
      throw new Error(t("editor.commands.lineCommands.error.invalidIndex"));
    }
    return resolved;
  };
  const nextParent = (index: number): number =>
    targetSet.has(index) ? parent : originalParent(index);

  for (const index of targets) {
    const visited = new Set<number>();
    let ancestor = index;
    while (ancestor !== -1) {
      if (visited.has(ancestor)) {
        throw new Error(t("editor.commands.lineCommands.error.parentCycle"));
      }
      visited.add(ancestor);
      ancestor = nextParent(ancestor);
    }
  }

  const nextLines = [...lines];
  let changed = false;
  for (const index of targets) {
    if (originalParent(index) !== parent) {
      nextLines[index] = { ...nextLines[index], father: parent };
      changed = true;
    }
  }
  return changed ? { ...chart, judgeLineList: nextLines } : chart;
}
