/**
 * The chart a new document starts from.
 *
 * Kept beside `chart.ts` rather than inside it: the blank shell is the minimal
 * shape a parser or a test wants, while the starter chart is a product decision
 * about how much room a new author should begin with.
 */
import { createChart, createLine, type Chart } from "./chart.ts";

/**
 * How many judge lines a brand-new chart starts with.
 *
 * A blank chart with a single line looks finished but has nowhere to place a
 * second layer, and adding a line was the step new authors missed most.
 * Twenty-four lines is the working set most charts need before any of them is
 * deleted or renamed; each one starts with no notes.
 */
export const STARTER_LINE_COUNT = 24;

/**
 * Create the chart a new document starts from.
 *
 * This is the blank shell plus the starter judge lines. It is deliberately
 * separate from `createChart`, which stays the minimal shell a parser or a test
 * uses when it wants exactly one line.
 */
export function createStarterChart(): Chart {
  const chart = createChart();
  chart.judgeLineList = Array.from({ length: STARTER_LINE_COUNT }, () => createLine());
  return chart;
}
