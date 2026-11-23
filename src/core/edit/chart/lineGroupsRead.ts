/** Builds the detached, lightweight judge-line folder readout for Extensions. */
import type { Chart } from "../../global/chart/chart.ts";
import { groupLineIndices, groupNames } from "../../global/chart/line/lineGroups.ts";
import type { ChartReadLineGroup } from "./api.ts";

/** Return folder names and current line indices without materializing the chart. */
export function readLineGroups(chart: Chart | null): readonly ChartReadLineGroup[] {
  if (!chart) {
    return Object.freeze([]);
  }
  return Object.freeze(
    groupNames(chart).map((name, index) =>
      Object.freeze({
        index,
        name,
        lineIndices: Object.freeze(groupLineIndices(chart, index)),
      }),
    ),
  );
}
