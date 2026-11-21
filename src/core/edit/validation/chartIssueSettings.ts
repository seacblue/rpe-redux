/**
 * Reads the Chart issues settings into the options one scan takes.
 *
 * The settings page exposes only the switch and the density threshold, so every
 * other model value keeps its default here. That is deliberate: the estimate has
 * to stay conservative, and a knob that only makes it less reliable is not worth
 * a row. The stored values are text, so this module is the one place that parses
 * them back and clamps them into a usable model.
 */
import { values } from "../../state/values.ts";
import {
  DEFAULT_NOTE_DENSITY_OPTIONS,
  type NoteDensityOptions,
} from "../validation/noteDensityScan.ts";
import type { ChartIssueScanOptions } from "../validation/chartIssueScan.ts";
import {
  CHART_ISSUE_KIND_DEFINITIONS,
  type ChartIssueKind,
} from "../validation/chartIssueTypes.ts";

/** Read one stored number, falling back when the value is absent or unparsable. */
function numberValue(key: string, fallback: number): number {
  if (!values.byId.has(key)) {
    return fallback;
  }
  const parsed = Number(values.byId.get<string | number>(key));
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** Read one stored boolean; an absent value falls back. */
function booleanValue(key: string, fallback: boolean): boolean {
  if (!values.byId.has(key)) {
    return fallback;
  }
  const stored = values.byId.get<boolean | string>(key);
  return typeof stored === "boolean" ? stored : fallback;
}

/** The density model as the settings page currently describes it. */
export function readNoteDensityOptions(): NoteDensityOptions {
  const defaults = DEFAULT_NOTE_DENSITY_OPTIONS;
  return {
    ...defaults,
    caution: Math.max(1, Math.round(numberValue("chart-issues-density-caution", defaults.caution))),
  };
}

/** Whether the background scan should run at all. */
export function readChartIssuesEnabled(): boolean {
  return booleanValue("chart-issues-enabled", true);
}

/** How long an edit may settle before the next scan starts, in milliseconds. */
export function readChartIssuesScanDelay(): number {
  return 600;
}

/** The full scan request the publisher schedules. */
export function readChartIssueScanOptions(): ChartIssueScanOptions {
  const checks: Partial<Record<ChartIssueKind, boolean>> = {};
  for (const definition of CHART_ISSUE_KIND_DEFINITIONS) {
    checks[definition.kind] = booleanValue(definition.settingKey, true);
  }
  return {
    checks,
    densityOptions: readNoteDensityOptions(),
  };
}

/** Settings whose change invalidates a published scan. */
export const CHART_ISSUE_SETTING_KEYS: readonly string[] = [
  "chart-issues-enabled",
  "chart-issues-density-caution",
  ...CHART_ISSUE_KIND_DEFINITIONS.map((definition) => definition.settingKey),
];

/** Call `listener` whenever a scan-relevant setting changes. */
export function subscribeChartIssueSettings(listener: () => void): () => void {
  const stops = CHART_ISSUE_SETTING_KEYS.filter((key) => values.byId.has(key)).map((key) =>
    values.byId.subscribe(key, listener),
  );
  return () => {
    for (const stop of stops) {
      stop();
    }
  };
}
