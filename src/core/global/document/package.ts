/**
 * Builds the file map written into a PEZ or project export.
 *
 * Combines chart JSON, referenced assets and an `extra.json` carrying effects and
 * shader paint events. Entries are named the way native RPE packages name them:
 * the chart sits at the package root as `<id>.json`, and `info.txt` records the
 * same id as `Path`.
 */
import { serializeChart, type Chart } from "../chart/chart.ts";
import { projectChartForExport } from "../chart/exportProjection.ts";
import { decodeChartText } from "../../utils/text.ts";
import { serializeShaderEvent } from "../chart/shader/shaderEvents.ts";
import { normalizePath } from "../../utils/paths.ts";
import { buildInfoText } from "./info.ts";

/**
 * Build the entry map written into a PEZ or project export.
 *
 * Existing assets are kept, the chart JSON replaces any entry of the same name,
 * Info.txt retains unrecognized fields, and extra.json collects effects and
 * shader paint events. Paths are normalized before comparison.
 */
export function packageEntries(
  chart: Chart,
  assets: ReadonlyMap<string, Uint8Array>,
  chartName: string,
  options: { projected?: boolean } = {},
): Map<string, Uint8Array> {
  const output = new Map<string, Uint8Array>();
  const previousChart = normalizePath(chartName);
  for (const [name, bytes] of assets) {
    // The source chart entry is replaced by the projected chart below; keeping
    // the old name would leave two chart JSON files in the package.
    if (previousChart && normalizePath(name) === previousChart) {
      continue;
    }
    output.set(name, bytes);
  }
  const projected = options.projected ? chart : projectChartForExport(chart, chartName);
  const id = String(projected.META.id ?? "").trim();
  // PEZ stores every package file at the root; native RPE uses the project id
  // as the chart stem and as the Resources folder name.
  const entryName = `${id}.json`;
  output.set(entryName, new TextEncoder().encode(serializeChart(projected)));
  // PEZ is also consumed by RPE and community players that locate the chart
  // through Info.txt. Keep an existing sidecar's extra fields, but always make
  // the chart reference and required leading marker current.
  const infoKey =
    [...output.keys()].find((name) => normalizePath(name) === "info.txt") ?? "info.txt";
  const existingInfo = output.get(infoKey);
  output.set(
    infoKey,
    new TextEncoder().encode(
      buildInfoText(projected, entryName, existingInfo ? decodeChartText(existingInfo) : ""),
    ),
  );
  const effects: unknown[] = [projected.effects, projected.shaderEvents, projected.META?.effects]
    .filter(Array.isArray)
    .flat();
  for (const [lineIndex, line] of (projected.judgeLineList ?? []).entries()) {
    for (const event of line.extended?.paintEvents ?? []) {
      effects.push(serializeShaderEvent(event, lineIndex));
    }
  }
  if (effects.length || Array.isArray(projected.effects)) {
    const existing = [...output.keys()].find(
      (name) => normalizePath(name) === normalizePath("extra.json"),
    );
    const existingBytes = existing ? output.get(existing) : undefined;
    const extra = existingBytes ? JSON.parse(decodeChartText(existingBytes)) : {};
    output.set(
      existing ?? "extra.json",
      new TextEncoder().encode(JSON.stringify({ ...extra, effects }, null, 2)),
    );
  }
  return output;
}
