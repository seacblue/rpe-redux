/**
 * Display formatting shared by the home library's cards and welcome panel.
 *
 * Counts follow the active language's grouping, and timestamps use short
 * relative units so the narrow detail column stays readable.
 */
import type { Language } from "../../../../i18n/locale.ts";

/** How one relative-time unit is represented in milliseconds. */
const RELATIVE_UNITS: readonly [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 365 * 24 * 60 * 60 * 1000],
  ["month", 30 * 24 * 60 * 60 * 1000],
  ["week", 7 * 24 * 60 * 60 * 1000],
  ["day", 24 * 60 * 60 * 1000],
  ["hour", 60 * 60 * 1000],
  ["minute", 60 * 1000],
];

/** Formats a count with the active language's grouping. */
export function formatCount(value: number, language: Language): string {
  return new Intl.NumberFormat(language === "zh" ? "zh-CN" : "en").format(value);
}

/** Formats an ISO timestamp as a short relative time; invalid values fall back to a dash. */
export function formatRelativeTime(value: string, language: Language): string {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) {
    return "—";
  }
  const delta = time - Date.now();
  const magnitude = Math.abs(delta);
  const [unit, size] = RELATIVE_UNITS.find(([, unitSize]) => magnitude >= unitSize) ?? [
    "minute",
    60 * 1000,
  ];
  return new Intl.RelativeTimeFormat(language === "zh" ? "zh-CN" : "en", {
    numeric: "auto",
  }).format(Math.round(delta / size), unit);
}

/**
 * Formats accumulated charting seconds as compact y/d/h/m/s parts.
 *
 * Zero leading units are skipped so a short session stays readable; a total of
 * zero seconds still renders as `0s`.
 */
export function formatChartingTime(seconds: number): string {
  let total = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  const years = Math.floor(total / (365 * 24 * 60 * 60));
  total -= years * 365 * 24 * 60 * 60;
  const days = Math.floor(total / (24 * 60 * 60));
  total -= days * 24 * 60 * 60;
  const hours = Math.floor(total / (60 * 60));
  total -= hours * 60 * 60;
  const minutes = Math.floor(total / 60);
  const secs = total - minutes * 60;
  const parts: string[] = [];
  if (years > 0) {
    parts.push(`${years}y`);
  }
  if (days > 0) {
    parts.push(`${days}d`);
  }
  if (hours > 0) {
    parts.push(`${hours}h`);
  }
  if (minutes > 0) {
    parts.push(`${minutes}m`);
  }
  if (secs > 0 || parts.length === 0) {
    parts.push(`${secs}s`);
  }
  return parts.join(" ");
}
