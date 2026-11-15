/**
 * Resolves chart-relative asset names against a document's asset map.
 *
 * Handles lazy desktop stores that know names before bytes, snapshots that keep
 * those names, and the info and resource references an opened chart needs.
 */
import { type Chart } from "../chart/chart.ts";
import type { AssetMap } from "./types.ts";
import { decodeChartText } from "../../utils/text.ts";
import { parseInfo } from "./info.ts";
import { cachedNormalizePath } from "../../io/pathCache.ts";

/** Every known asset name, including paths whose bytes are not loaded yet. */
export function assetNames(
  assets: ReadonlyMap<string, unknown> & { names?: () => Iterable<string> },
): Iterable<string> {
  return assets.names?.() ?? assets.keys();
}

/** Copy loaded bytes without losing the lazy names and hash metadata of a store. */
export function snapshotAssets(assets: AssetMap): AssetMap {
  const snapshot = new Map(assets) as AssetMap & {
    hashes?: Map<string, string>;
    original?: Map<string, Uint8Array>;
  };
  const names = new Set(assetNames(assets));
  snapshot.names = () => names;
  snapshot.uri = assets.uri?.bind(assets);
  snapshot.read = assets.read?.bind(assets);
  const metadata = assets as AssetMap & {
    hashes?: Map<string, string>;
    original?: Map<string, Uint8Array>;
  };
  if (metadata.hashes) {
    snapshot.hashes = new Map(metadata.hashes);
  }
  if (metadata.original) {
    snapshot.original = new Map(metadata.original);
  }
  return snapshot;
}

/** Loaded bytes for a chart-relative asset name, or `null` when unresolved. */
export function assetBytes(
  assets: ReadonlyMap<string, Uint8Array>,
  name: string | undefined,
  chartName = "",
): Uint8Array | null {
  const path = assetPath(assets, name, chartName);
  return path ? (assets.get(path) ?? null) : null;
}

/**
 * Resolve a chart-relative name to the exact key in the asset map.
 *
 * Tries the chart's directory first, then the bare and normalized names, then a
 * unique basename match. Returns `null` when the name is empty or ambiguous.
 */
export function assetPath(
  assets: ReadonlyMap<string, unknown> & { names?: () => Iterable<string> },
  name: string | undefined,
  chartName = "",
): string | null {
  if (!name) {
    return null;
  }
  const chartPath = chartName.replaceAll("\\", "/");
  const directory = chartPath.includes("/")
    ? chartPath.slice(0, chartPath.lastIndexOf("/") + 1)
    : "";
  const names = [...assetNames(assets)];
  if (names.includes(directory + name)) {
    return directory + name;
  }
  if (names.includes(name)) {
    return name;
  }
  const normalized = cachedNormalizePath(name);
  for (const target of [cachedNormalizePath(directory + name), normalized]) {
    const exact = names.filter((path) => cachedNormalizePath(path) === target);
    if (exact.length === 1) {
      return exact[0];
    }
  }
  const matches = names.filter(
    (path) => cachedNormalizePath(path).split("/").at(-1) === normalized.split("/").at(-1),
  );
  return matches.length === 1 ? matches[0] : null;
}

/** Info.txt entries whose `Chart` reference resolves to `chartName`. */
export function matchingInfo(
  assets: ReadonlyMap<string, Uint8Array> & { names?: () => Iterable<string> },
  chartName: string,
): [string, Uint8Array][] {
  const matches: [string, Uint8Array][] = [];
  for (const assetName of assetNames(assets)) {
    const name = assetName.replaceAll("\\", "/");
    if (name.split("/").at(-1)?.toLowerCase() !== "info.txt") {
      continue;
    }
    const bytes = assets.get(assetName);
    if (!bytes) {
      continue;
    }
    const reference = parseInfo(decodeChartText(bytes)).Chart;
    const directory = name.slice(0, name.lastIndexOf("/") + 1);
    if (
      Boolean(reference) &&
      cachedNormalizePath(directory + reference) === cachedNormalizePath(chartName)
    ) {
      matches.push([name, bytes]);
    }
  }
  return matches;
}

/**
 * Choose the audio and image names an opened chart should use.
 *
 * Prefers authored metadata, then a matching Info.txt reference, then a unique
 * asset with the expected extension in the chart's directory.
 */
export function resourceReferences(
  chart: Chart,
  assets: ReadonlyMap<string, Uint8Array> & { names?: () => Iterable<string> },
  chartName: string,
  fallback: Record<string, string> = {},
): { song: string; background: string } {
  const matches = matchingInfo(assets, chartName);
  const info = matches.length === 1 ? parseInfo(decodeChartText(matches[0][1])) : fallback;
  const normalizedChart = cachedNormalizePath(chartName);
  const directory = normalizedChart.split("/").slice(0, -1).join("/");
  const stem = (normalizedChart.split("/").at(-1) ?? "").replace(/\.[^.]+$/, "");
  /** Rebase an Info.txt reference onto the chart's directory when they differ. */
  const infoReference = (key: string): string => {
    const value = info[key];
    if (!value || matches.length !== 1) {
      return value;
    }
    const infoDirectory = matches[0][0].replaceAll("\\", "/").split("/").slice(0, -1).join("/");
    return cachedNormalizePath(infoDirectory) === directory
      ? value
      : (infoDirectory ? infoDirectory + "/" : "") + value;
  };
  /** Find a unique asset in the chart directory with a matching extension. */
  const infer = (extensions: RegExp): string => {
    const candidates = [...assetNames(assets)].filter(
      (name) =>
        !name.startsWith("__redux/") &&
        extensions.test(name) &&
        cachedNormalizePath(name).split("/").slice(0, -1).join("/") === directory,
    );
    const sameStem = candidates.filter(
      (name) =>
        (cachedNormalizePath(name).split("/").at(-1) ?? "").replace(/\.[^.]+$/, "") === stem,
    );
    return sameStem.length === 1 ? sameStem[0] : candidates.length === 1 ? candidates[0] : "";
  };
  /** Prefer a name that exists, then an inferred file, then the first authored name. */
  const resolve = (names: (string | undefined)[], extensions: RegExp): string => {
    const present = names.filter((name): name is string => Boolean(name));
    return (
      present.find((name) => Boolean(assetPath(assets, name, chartName))) ||
      infer(extensions) ||
      present[0] ||
      ""
    );
  };
  return {
    song: resolve(
      [chart.META.song, infoReference("Song")],
      /\.(mp3|ogg|wav|flac|m4a|aac|opus|webm)$/i,
    ),
    background: resolve(
      [chart.META.background, infoReference("Picture")],
      /\.(png|jpe?g|webp|gif|bmp|avif)$/i,
    ),
  };
}
