/** Read and write colon-separated fields from an RPE package Info.txt. */
import type { Chart } from "../chart/chart.ts";
import { chartEditSeconds, parseChartEditSeconds } from "../chart/editTime.ts";

/** Lower-case keys mapped to the casing RPE writes into Info.txt. */
const CANONICAL_INFO_KEYS: Readonly<Record<string, string>> = {
  chart: "Chart",
  song: "Song",
  picture: "Picture",
  illustration: "Illustration",
  name: "Name",
  path: "Path",
  level: "Level",
  composer: "Composer",
  charter: "Charter",
  edittime: "EditTime",
};

/** Sidecar key order used when writing Info.txt, matching native RPE exports. */
const INFO_ORDER = [
  "Name",
  "Path",
  "Song",
  "Picture",
  "Chart",
  "Level",
  "Composer",
  "Charter",
  "EditTime",
  "Illustration",
] as const;

/** Fill metadata gaps in a chart from its package sidecar without overwriting it. */
export function mergeInfoIntoMeta(chart: Chart, info: Record<string, string>): void {
  const fields: [keyof Chart["META"], string][] = [
    ["name", "Name"],
    ["composer", "Composer"],
    ["charter", "Charter"],
    ["illustration", "Illustration"],
    ["level", "Level"],
    ["song", "Song"],
    ["background", "Picture"],
  ];
  for (const [key, infoKey] of fields) {
    if (!String(chart.META[key] ?? "").trim() && info[infoKey]) {
      (chart.META as Record<string, unknown>)[key] = info[infoKey];
    }
  }
  if (parseChartEditSeconds(chart.chartTime) === null) {
    const seconds = parseChartEditSeconds(info.EditTime);
    if (seconds !== null) {
      chart.chartTime = seconds;
    }
  }
}

/**
 * Parse colon-separated Info.txt lines into a field map.
 *
 * Known keys adopt canonical casing; a line containing only `#` is a marker and
 * is skipped.
 */
export function parseInfo(text: string): Record<string, string> {
  const info: Record<string, string> = {};
  for (const line of text.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    if (line.trim() === "#") {
      continue;
    }
    const separator = line.indexOf(":");
    if (separator > 0) {
      const key = line.slice(0, separator).trim();
      info[CANONICAL_INFO_KEYS[key.toLowerCase()] ?? key] = line.slice(separator + 1).trim();
    }
  }
  return info;
}

/**
 * Produce a spec-shaped RPE Info.txt while retaining caller-specific sidecar
 * fields. Existing values act as fallbacks when a chart does not author the
 * matching metadata, so opening and re-exporting a package does not erase its
 * display metadata.
 */
export function buildInfoText(chart: Chart, chartName: string, existing = ""): string {
  const previous = parseInfo(existing);
  const authored: Record<string, string> = {
    Name: String(chart.META.name ?? "").trim(),
    Composer: String(chart.META.composer ?? "").trim(),
    Charter: String(chart.META.charter ?? "").trim(),
    Illustration: String(chart.META.illustration ?? "").trim(),
    Level: String(chart.META.level ?? "").trim(),
    Chart: chartName.replaceAll("\\", "/").trim(),
    Song: String(chart.META.song ?? "").trim(),
    Picture: String(chart.META.background ?? "").trim(),
    Path: String(chart.META.id ?? "").trim(),
  };
  const editSeconds = chartEditSeconds(chart);
  if (parseChartEditSeconds(chart.chartTime) !== null) {
    authored.EditTime = editSeconds.toFixed(3);
  }
  const values: Record<string, string> = { ...previous, ...authored };
  for (const key of INFO_ORDER) {
    if (!values[key] && previous[key]) {
      values[key] = previous[key];
    }
  }
  const lines: string[] = ["#"];
  for (const key of INFO_ORDER) {
    if (values[key]) {
      lines.push(`${key}: ${values[key]}`);
    }
  }
  for (const [key, value] of Object.entries(values)) {
    if (!INFO_ORDER.includes(key as (typeof INFO_ORDER)[number]) && value) {
      lines.push(`${key}: ${value}`);
    }
  }
  return `${lines.join("\r\n")}\r\n`;
}
