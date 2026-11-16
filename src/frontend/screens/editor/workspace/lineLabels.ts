/**
 * Localized labels for chart lines and line groups, resolved at the visible
 * surface instead of being written back into the chart. Naming rules live in
 * core chart modules; this file only adapts them to the active language.
 */
import { t } from "../../../../i18n/index.ts";
import { CATALOGS } from "../../../../i18n/messages/index.ts";
import { interpolate } from "../../../../i18n/types.ts";
import type { Chart, JudgeLine } from "../../../../core/global/chart/chart.ts";
import { groupNames, lineGroupIndex } from "../../../../core/global/chart/line/lineGroups.ts";

/** Recognises generated line names written by any supported language. */
const generatedLineNameCache = new Map<number, ReadonlySet<string>>();

function generatedLineNames(index: number): ReadonlySet<string> {
  const cached = generatedLineNameCache.get(index);
  if (cached) {
    return cached;
  }
  const names = new Set<string>();
  for (const catalog of Object.values(CATALOGS)) {
    const name = interpolate(catalog["model.line.defaultName"], { index });
    names.add(name);
    names.add(name.replace(" ", ""));
  }
  generatedLineNameCache.set(index, names);
  return names;
}

/** Localized group name for a line, falling back to the first group label. */
export function lineGroupName(chart: Chart | undefined, lineOrIndex: JudgeLine | number): string {
  const line = typeof lineOrIndex === "number" ? chart?.judgeLineList?.[lineOrIndex] : lineOrIndex;
  const names = lineGroupLabels(chart);
  return names[lineGroupIndex(line)] ?? names[0] ?? "";
}

/** Turns unnamed chart groups into localized labels only at the visible surface. */
export function lineGroupLabels(chart: Chart | undefined): string[] {
  return groupNames(chart).map((name, index) => {
    if (name) {
      return name;
    }
    return index === 0 ? t("model.line.defaultGroup") : t("model.line.group", { index });
  });
}

/** True when the line belongs to the unnamed first group. */
export function isDefaultLineGroup(chart: Chart | undefined, lineOrIndex: JudgeLine | number) {
  return (
    lineGroupIndex(
      typeof lineOrIndex === "number" ? chart?.judgeLineList?.[lineOrIndex] : lineOrIndex,
    ) === 0
  );
}

/** True when the line carries no custom name or a generated default name. */
export function isDefaultLineName(line: JudgeLine | undefined, index: number): boolean {
  const name = String(line?.Name ?? "").trim();
  return !name || generatedLineNames(index + 1).has(name) || name === t("model.line.untitled");
}

/** Display name for a line, using the shared Untitled fallback when unnamed. */
export function lineNameLabel(line: JudgeLine | undefined, index: number): string {
  return isDefaultLineName(line, index) ? t("model.line.untitled") : String(line?.Name).trim();
}

/**
 * The descriptive part of a line's label, without the leading line number.
 *
 * Surfaces that draw the number in its own column use this so the name never
 * repeats the localized `Line {index}` prefix. Every line keeps a name: an
 * unnamed line resolves to `Untitled` instead of collapsing to a bare number.
 */
export function lineDisplayName(chart: Chart | undefined, index: number): string {
  const line = chart?.judgeLineList?.[index] ?? {};
  const parts: string[] = [];
  if (!isDefaultLineGroup(chart, line)) {
    parts.push(lineGroupName(chart, line));
  }
  parts.push(
    isDefaultLineName(line, index)
      ? t("model.line.untitled")
      : String(line.Name).trim() || t("model.line.untitled"),
  );
  return parts.join(".");
}

/** Full line label with the optional localized line-number prefix. */
export function lineDisplayLabel(
  chart: Chart | undefined,
  index: number,
  { includeIndex = true }: { includeIndex?: boolean } = {},
): string {
  const parts: string[] = [];
  if (includeIndex) {
    parts.push(t("model.line.label", { index }));
  }
  const name = lineDisplayName(chart, index);
  if (name) {
    parts.push(name);
  }
  return parts.join(".") || t("model.line.label", { index });
}
