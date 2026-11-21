/**
 * Pure accounting for the inline startup splash.
 *
 * The build writes the byte size of every script, stylesheet, and preloaded
 * chunk the first page needs. The splash pairs that manifest with Resource
 * Timing entries to show determinate progress and the observed transfer rate.
 * These helpers stay DOM-free so the Node suite can pin the arithmetic without
 * booting a browser.
 */

/** The subset of a Resource Timing entry the splash reads. */
export interface BootResourceTiming {
  readonly name: string;
  readonly initiatorType?: string;
  readonly transferSize?: number;
  readonly encodedBodySize?: number;
  readonly decodedBodySize?: number;
  readonly startTime?: number;
  readonly responseEnd?: number;
  /** HTTP status when the browser exposes it; 0 marks a blocked or failed fetch. */
  readonly responseStatus?: number;
}

/** One progress sample for the splash's bar and status line. */
export interface BootProgressSnapshot {
  /** Bytes completed for the files the build listed, or every observed file. */
  readonly loadedBytes: number;
  /** Total bytes the build listed; zero when the page carries no manifest. */
  readonly totalBytes: number;
  /** Bytes that actually crossed the network, used for the transfer rate. */
  readonly transferredBytes: number;
  /** Manifest files that have a completed Resource Timing entry. */
  readonly loadedAssets: number;
  /** Files the build listed; zero without a manifest. */
  readonly totalAssets: number;
  /** Files observed when the build carries no manifest (development). */
  readonly observedAssets: number;
  /** Completed share of the manifest in 0…1; zero when the total is unknown. */
  readonly ratio: number;
  /** Whether every listed file has completed. */
  readonly complete: boolean;
}

const BYTE_UNITS = ["B", "KB", "MB", "GB"] as const;

/** Resolve one asset URL against the document base the page was served from. */
export function bootAssetKey(url: string, baseUri: string): string {
  try {
    return new URL(url, baseUri).href;
  } catch {
    return url;
  }
}

/** Build the absolute-URL to byte-size index the runtime matches against. */
export function bootAssetIndex(
  assets: Readonly<Record<string, number>>,
  baseUri: string,
): Map<string, number> {
  const index = new Map<string, number>();
  for (const [url, size] of Object.entries(assets)) {
    if (Number.isFinite(size) && size > 0) {
      index.set(bootAssetKey(url, baseUri), size);
    }
  }
  return index;
}

/**
 * Whether an observed resource belongs to the boot download in development.
 *
 * Scripts carry the module graph. Stylesheet links are module-transformed in
 * development, but a plain link rule still catches a sheet served directly.
 * Fonts, images, and API traffic are deliberately excluded: the splash reports
 * the code needed for the first paint, not later data.
 */
export function isBootResource(timing: BootResourceTiming): boolean {
  if (timing.initiatorType === "script") {
    return true;
  }
  return timing.initiatorType === "link" && /\.(?:m?js|css)(?:[?#]|$)/u.test(timing.name);
}

/**
 * Whether a resource belongs to a visible surface load rather than an API call.
 *
 * Startup and chart loading include the scripts/stylesheets they need plus the
 * images, fonts, and library resource requests they paint. Loopback health and
 * preference probes are bookkeeping, not loading work.
 */
export function isUiResource(timing: BootResourceTiming): boolean {
  if (isBootResource(timing)) {
    return true;
  }
  if (timing.initiatorType === "img" || timing.initiatorType === "css") {
    return true;
  }
  if (timing.initiatorType === "fetch" || timing.initiatorType === "xmlhttprequest") {
    return !/\/api\/(?:health|preferences)(?:[?#]|$)/u.test(timing.name);
  }
  return false;
}

/** Whether an entry describes a blocked or failed response. */
function failedTiming(timing: BootResourceTiming): boolean {
  return (
    typeof timing.responseStatus === "number" &&
    (timing.responseStatus < 200 || timing.responseStatus >= 400)
  );
}

/** Body bytes for one completed entry, falling back to the expected file size. */
function completedBytes(timing: BootResourceTiming, expected: number): number {
  const decoded = timing.decodedBodySize ?? 0;
  const encoded = timing.encodedBodySize ?? 0;
  return decoded > 0 ? decoded : encoded > 0 ? encoded : expected;
}

/**
 * Summarize the Resource Timing entries observed so far.
 *
 * With a manifest, only listed URLs count: the progress denominator is the
 * first-paint payload the build measured. Without one, the runtime reports the
 * bytes and file count it has seen, and the bar stays indeterminate.
 */
export function summarizeBootProgress(
  timings: readonly BootResourceTiming[],
  assets: ReadonlyMap<string, number>,
  include: (timing: BootResourceTiming) => boolean = isBootResource,
): BootProgressSnapshot {
  const seen = new Set<string>();
  let loadedBytes = 0;
  let transferredBytes = 0;
  let loadedAssets = 0;
  let observedAssets = 0;
  let totalBytes = 0;
  for (const size of assets.values()) {
    totalBytes += size;
  }
  for (const timing of timings) {
    if (seen.has(timing.name) || failedTiming(timing)) {
      continue;
    }
    if (assets.size > 0) {
      const expected = assets.get(timing.name);
      if (expected === undefined) {
        continue;
      }
      seen.add(timing.name);
      loadedAssets += 1;
      observedAssets += 1;
      loadedBytes += Math.min(expected, completedBytes(timing, expected));
      transferredBytes += timing.transferSize ?? timing.encodedBodySize ?? 0;
      continue;
    }
    if (!include(timing)) {
      continue;
    }
    seen.add(timing.name);
    observedAssets += 1;
    loadedBytes += completedBytes(timing, 0);
    transferredBytes += timing.transferSize ?? timing.encodedBodySize ?? 0;
  }
  const totalAssets = assets.size;
  return {
    loadedBytes,
    totalBytes,
    transferredBytes,
    loadedAssets,
    totalAssets,
    observedAssets,
    ratio: totalBytes > 0 ? Math.min(1, loadedBytes / totalBytes) : 0,
    complete: totalAssets > 0 && loadedAssets >= totalAssets,
  };
}

/** Bytes per second over the elapsed boot window; zero before any transfer. */
export function bootTransferRate(snapshot: BootProgressSnapshot, elapsedMs: number): number {
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0 || snapshot.transferredBytes <= 0) {
    return 0;
  }
  return snapshot.transferredBytes / (elapsedMs / 1000);
}

/** Human byte size with one decimal once the value reaches a larger unit. */
export function formatByteSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < BYTE_UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const digits = unit === 0 || value >= 100 ? 0 : 1;
  return `${value.toFixed(digits)} ${BYTE_UNITS[unit]}`;
}

/** Human transfer rate; null when no bytes crossed the network. */
export function formatTransferRate(bytesPerSecond: number): string | null {
  if (!Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) {
    return null;
  }
  return `${formatByteSize(bytesPerSecond)}/s`;
}
