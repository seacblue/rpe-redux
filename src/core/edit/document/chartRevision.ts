/**
 * Computes the canonical chart revision used by every document-facing seam.
 *
 * The identity of a chart is its content, and callers only compare these
 * strings for equality (dirty tracking, save/load revisions, and Code Cell preconditions).
 *
 * Line digests ignore editor-only object ids so a streamed line has the same
 * digest before and after materialization. Header, line, and whole-chart digests
 * are WeakMap-backed, and the streaming document can seed a facade or a
 * materialized snapshot with its own aggregate.
 */

import { type Chart } from "../../global/chart/chart.ts";
import { yieldToHost } from "../../utils/yieldToHost.ts";
import { registeredChartDocument } from "../../global/chart/streaming/chartDocumentRegistry.ts";
import {
  combineContentFingerprint,
  headerContentFingerprint,
  lineContentFingerprint,
} from "../../global/chart/streaming/chartContentHash.ts";

const wholeChartCache = new WeakMap<object, string>();
const headerCache = new WeakMap<object, string>();
const lineCache = new WeakMap<object, string>();
const warmPromises = new WeakMap<object, Promise<string>>();

/** Fingerprint of the chart fields outside `judgeLineList`. */
function headerFingerprint(chart: Chart): string {
  const cached = headerCache.get(chart);
  if (cached) {
    return cached;
  }
  const digest = headerContentFingerprint(chart);
  headerCache.set(chart, digest);
  return digest;
}

/** Cached content fingerprint of one judge line, ignoring editor-only ids. */
function lineFingerprint(line: unknown): string {
  if (!line || typeof line !== "object") {
    return lineContentFingerprint(line);
  }
  const cached = lineCache.get(line);
  if (cached) {
    return cached;
  }
  const digest = lineContentFingerprint(line);
  lineCache.set(line, digest);
  return digest;
}

/** Async line fingerprint that yields after the current slice budget. */
async function lineFingerprintAsync(line: unknown, state: { deadline: number }): Promise<string> {
  const cached = line && typeof line === "object" ? lineCache.get(line) : undefined;
  if (cached) {
    return cached;
  }
  const digest = lineFingerprint(line);
  if (performance.now() >= state.deadline) {
    await yieldToHost();
    state.deadline = performance.now() + 6;
  }
  return digest;
}

/** Seed a fingerprint computed off-thread for a freshly installed chart. */
export function primeChartFingerprint(chart: Chart, fingerprint: string): void {
  wholeChartCache.set(chart, fingerprint);
}

/**
 * Warm the fingerprint cache without holding the UI thread for one long task.
 *
 * Document installation yields between lines so the loading surface and pointer
 * overlays keep painting; edit boundaries use the synchronous version.
 */
export function warmChartFingerprintAsync(chart: Chart): Promise<string> {
  const active = warmPromises.get(chart);
  if (active) {
    return active;
  }
  const document = registeredChartDocument(chart);
  if (document) {
    return Promise.resolve(document.fingerprint());
  }
  const seeded = wholeChartCache.get(chart);
  const work = (async () => {
    const lines = chart.judgeLineList ?? [];
    const parts: string[] = [headerFingerprint(chart)];
    const state = { deadline: performance.now() + 6 };
    for (const line of lines) {
      parts.push(await lineFingerprintAsync(line, state));
    }
    const digest = combineContentFingerprint(headerFingerprint(chart), parts.slice(1));
    wholeChartCache.set(chart, seeded ?? digest);
    return seeded ?? digest;
  })().finally(() => {
    warmPromises.delete(chart);
  });
  warmPromises.set(chart, work);
  return work;
}

/** Computes the canonical chart revision used by every document-facing seam. */
export function chartFingerprint(chart: Chart): string;
export function chartFingerprint(chart: Chart | null | undefined): string | null;
export function chartFingerprint(chart: Chart | null | undefined): string | null {
  if (!chart) {
    return null;
  }
  const document = registeredChartDocument(chart);
  if (document) {
    return document.fingerprint();
  }
  const cached = wholeChartCache.get(chart);
  if (cached) {
    return cached;
  }
  const lines = chart.judgeLineList ?? [];
  const digest = combineContentFingerprint(
    headerFingerprint(chart),
    lines.map((line) => lineFingerprint(line)),
  );
  wholeChartCache.set(chart, digest);
  return digest;
}

/** Header digest used by the streaming document and line index. */
export function chartHeaderFingerprint(chart: Chart): string {
  return headerFingerprint(chart);
}

/** One line digest used by the streaming document and line index. */
export function chartLineFingerprint(line: unknown): string {
  return lineFingerprint(line);
}

/** Combine a header digest and ordered line digests into one chart digest. */
export function combineChartFingerprint(
  headerDigest: string,
  lineDigests: readonly string[],
): string {
  return combineContentFingerprint(headerDigest, lineDigests);
}
