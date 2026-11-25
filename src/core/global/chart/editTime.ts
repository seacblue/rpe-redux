/** Parses and projects the persisted active editing time shared by chart formats. */
import type { Chart } from "./chart.ts";

/** Convert a chart-time value from JSON or Info.txt into non-negative seconds. */
export function parseChartEditSeconds(value: unknown): number | null {
  const numeric =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim() !== ""
        ? Number(value.trim())
        : Number.NaN;
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : null;
}

/** Read chartTime first, then the RPE Info.txt EditTime fallback. */
export function chartEditSeconds(
  chart: Pick<Chart, "chartTime">,
  info?: Readonly<Record<string, unknown>>,
): number {
  const chartValue = parseChartEditSeconds(chart.chartTime);
  if (chartValue !== null) {
    return chartValue;
  }
  return parseChartEditSeconds(info?.EditTime ?? info?.editTime ?? info?.edittime) ?? 0;
}

/** Return a persistence snapshot carrying the supplied active editing total. */
export function withChartEditSeconds<T extends { chartTime?: unknown }>(
  chart: T,
  seconds: number,
): T & { chartTime: number } {
  return { ...chart, chartTime: parseChartEditSeconds(seconds) ?? 0 };
}
