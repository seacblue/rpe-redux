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

/** Return a stable eight-digit folder id used by flat PEZ packages. */
function folderHash(path: string): string {
  let hash = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(path)) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/**
 * Flatten a relative asset path for players that only read package-root files.
 *
 * Each directory keeps its readable name and receives a stable hash of its
 * position, so `images/background.png` becomes `images<hash>_background.png`.
 * The hash is deterministic rather than regenerated on every export: chart
 * references remain stable and repeated exports do not create needless diffs.
 */
export function flattenPezAssetName(name: string): string {
  const normalized = normalizePath(name);
  const parts = normalized.split("/").filter(Boolean);
  if (parts.length < 2) {
    return normalized;
  }
  const file = parts.pop()!;
  const folders: string[] = [];
  for (let index = 0; index < parts.length; index += 1) {
    const path = parts.slice(0, index + 1).join("/");
    folders.push(`${parts[index]}${folderHash(path)}`);
  }
  return [...folders, file].join("_");
}

/** Rewrite chart fields that carry resource names after a package flatten. */
function remapChartResources(chart: Chart, remap: ReadonlyMap<string, string>): void {
  const rewrite = (value: unknown): unknown =>
    typeof value === "string" ? (remap.get(normalizePath(value)) ?? value) : value;
  const meta = chart.META as (Chart["META"] & Record<string, unknown>) | undefined;
  if (meta) {
    for (const key of ["song", "background"] as const) {
      meta[key] = rewrite(meta[key]) as never;
    }
  }
  for (const line of chart.judgeLineList ?? []) {
    line.Texture = rewrite(line.Texture) as string;
    for (const note of line.notes ?? []) {
      note.hitsound = rewrite(note.hitsound) as string;
      note.hitSound = rewrite(note.hitSound) as string;
    }
    for (const event of line.extended?.paintEvents ?? []) {
      for (const key of ["shader", "source", "shaderPath"] as const) {
        event[key] = rewrite(event[key]) as never;
      }
    }
  }
  const effectLists = [chart.effects, chart.shaderEvents, chart.META?.effects].flatMap((effects) =>
    Array.isArray(effects) ? effects : [],
  );
  for (const effect of effectLists) {
    if (!effect || typeof effect !== "object") {
      continue;
    }
    for (const key of ["shader", "source", "shaderPath"] as const) {
      const record = effect as Record<string, unknown>;
      if (key in record) {
        record[key] = rewrite(record[key]);
      }
    }
  }
}

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
  const projected = options.projected
    ? structuredClone(chart)
    : projectChartForExport(chart, chartName);
  const remap = new Map<string, string>();
  const used = new Set<string>();
  for (const [name, bytes] of assets) {
    // The source chart entry is replaced by the projected chart below; keeping
    // the old name would leave two chart JSON files in the package.
    if (previousChart && normalizePath(name) === previousChart) {
      continue;
    }
    const flattened = flattenPezAssetName(name);
    let outputName = flattened;
    let suffix = 1;
    while (used.has(outputName)) {
      outputName = `${suffix}-${flattened}`;
      suffix += 1;
    }
    used.add(outputName);
    remap.set(normalizePath(name), outputName);
    output.set(outputName, bytes);
  }
  remapChartResources(projected, remap);
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

/**
 * Prepare the generated sidecar for a native PEZ export.
 *
 * Native export already owns chart and archive writing. This helper only
 * replaces the sidecar entry in the staged asset map so the native writer
 * cannot copy an outdated `extra.json` from the opened document.
 */
export function preparePezExportAssets(
  chart: Chart,
  assets: ReadonlyMap<string, Uint8Array>,
  chartName: string,
): Map<string, Uint8Array> {
  const packaged = packageEntries(chart, assets, chartName, { projected: true });
  const extraName = [...packaged.keys()].find(
    (name) => normalizePath(name) === normalizePath("extra.json"),
  );
  if (!extraName) {
    return new Map(assets);
  }
  const extra = packaged.get(extraName);
  if (!extra) {
    return new Map(assets);
  }
  const output = new Map(assets);
  output.set(extraName, extra);
  return output;
}
