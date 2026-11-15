/**
 * Detects charts written in an older RPE layout and materializes the fields the
 * current editor expects.
 *
 * The editor reads and writes one current layout, so opening an older document
 * makes its implied line defaults explicit before math and export rely on them.
 */
import { BUILD_APP_VERSION } from "../../platform/buildInfo.ts";
import { compareVersions, isVersion, normalizeVersion } from "../../utils/version.ts";
import {
  COMPATIBILITY_LINE_Z_ORDER,
  CURRENT_RPE_VERSION,
  NO_LINE_PARENT,
  type Chart,
} from "./chart.ts";
import { isRecord } from "../../utils/guards.ts";

/** How a Redux export version compares with the running application. */
export type ReduxVersionStatus = "missing" | "invalid" | "older" | "current" | "newer";

/** What a parsed document declares and whether opening it needs conversion. */
export interface ChartCompatibilityReport {
  /** The declared RPEVersion, or null when the field is absent or unusable. */
  readonly rpeVersion: number | null;
  /** The declared application version from a Redux export, when valid. */
  readonly reduxVersion: string | null;
  /** Semantic relation between `reduxVersion` and the running application. */
  readonly reduxVersionStatus: ReduxVersionStatus;
  /** True when the chart cannot be opened without writing current-format fields. */
  readonly requiresConversion: boolean;
  /** Missing line defaults a conversion would materialize. */
  readonly missingLineFields: number;
}

/** A converted (or unchanged) chart plus the report for its source. */
export interface ChartConversion {
  readonly chart: Chart;
  /** The report for the source chart, before conversion. */
  readonly report: ChartCompatibilityReport;
  readonly converted: boolean;
}

/** One line field conversion fills when it is absent, with its version-aware value. */
type LineDefault = readonly [field: string, value: (sourceVersion: number | null) => unknown];

/** Every line default conversion materializes, in one table. */
const LINE_DEFAULTS: readonly LineDefault[] = [
  // A child line keeps its own angle unless the chart explicitly opts into
  // inheriting the parent's rotation.
  ["rotateWithFather", () => false],
  ["anchor", () => [0.5, 0.5]],
  ["isGif", () => false],
  ["bpmfactor", () => 1],
  ["father", () => NO_LINE_PARENT],
  ["isCover", () => 1],
  ["zOrder", () => COMPATIBILITY_LINE_Z_ORDER],
  ["extended", () => ({})],
];

/** Read `META.RPEVersion` as a finite number, or null when it is absent. */
function declaredVersion(chart: Record<string, unknown>): number | null {
  const meta = isRecord(chart.META) ? chart.META : null;
  const version = meta?.RPEVersion;
  return typeof version === "number" && Number.isFinite(version) ? version : null;
}

/** Read the Redux export version and classify it against the running application. */
function declaredReduxVersion(meta: Record<string, unknown> | null): {
  value: string | null;
  status: ReduxVersionStatus;
} {
  const raw = meta?.ReduxVersion;
  if (raw === undefined) {
    return { value: null, status: "missing" };
  }
  if (typeof raw !== "string") {
    return { value: null, status: "invalid" };
  }
  const value = normalizeVersion(raw);
  if (!isVersion(value)) {
    return { value: null, status: "invalid" };
  }
  const comparison = compareVersions(value, BUILD_APP_VERSION);
  return {
    value,
    status: comparison > 0 ? "newer" : comparison < 0 ? "older" : "current",
  };
}

/** Count line defaults that a conversion would materialize. */
function missingLineFieldCount(lines: unknown): number {
  if (!Array.isArray(lines)) {
    return 0;
  }
  let count = 0;
  for (const line of lines) {
    if (!isRecord(line)) {
      continue;
    }
    for (const [field] of LINE_DEFAULTS) {
      if (line[field] === undefined) {
        count++;
      }
    }
  }
  return count;
}

/**
 * Report whether a parsed chart predates the editor's current format.
 *
 * A chart with no usable `META.RPEVersion` counts as older. The check is
 * read-only, so malformed documents still reach structural validation.
 */
export function detectChartCompatibility(value: unknown): ChartCompatibilityReport {
  if (!isRecord(value) || !isRecord(value.META)) {
    return {
      rpeVersion: null,
      reduxVersion: null,
      reduxVersionStatus: "missing",
      requiresConversion: false,
      missingLineFields: 0,
    };
  }
  const rpeVersion = declaredVersion(value);
  const redux = declaredReduxVersion(value.META);
  return {
    rpeVersion,
    reduxVersion: redux.value,
    reduxVersionStatus: redux.status,
    requiresConversion: rpeVersion === null || rpeVersion < CURRENT_RPE_VERSION,
    missingLineFields: missingLineFieldCount(value.judgeLineList),
  };
}

/** Copy a line and fill absent fields from `LINE_DEFAULTS`. */
function convertLine(line: unknown, sourceVersion: number | null): unknown {
  if (!isRecord(line)) {
    return line;
  }
  const next = { ...line };
  for (const [field, value] of LINE_DEFAULTS) {
    if (next[field] === undefined) {
      next[field] = value(sourceVersion);
    }
  }
  return next;
}

/**
 * Convert a parsed chart to the current RPE layout.
 *
 * Unknown fields and untouched values are preserved. The function is pure: the
 * caller receives a new chart object and line objects for every changed line.
 */
export function convertChartToCurrentVersion(
  value: unknown,
  report: ChartCompatibilityReport = detectChartCompatibility(value),
  onProgress?: (completed: number, total: number) => void,
): ChartConversion | null {
  if (!isRecord(value) || !isRecord(value.META)) {
    return null;
  }
  if (!report.requiresConversion) {
    return { chart: value as Chart, report, converted: false };
  }
  const sourceLines = Array.isArray(value.judgeLineList) ? value.judgeLineList : null;
  onProgress?.(0, sourceLines?.length ?? 0);
  const lines = sourceLines
    ? sourceLines.map((line, index) => {
        const converted = convertLine(line, report.rpeVersion);
        onProgress?.(index + 1, sourceLines.length);
        return converted;
      })
    : value.judgeLineList;
  return {
    chart: {
      ...value,
      META: { ...value.META, RPEVersion: CURRENT_RPE_VERSION },
      ...(lines === value.judgeLineList ? {} : { judgeLineList: lines }),
    } as Chart,
    report,
    converted: true,
  };
}
