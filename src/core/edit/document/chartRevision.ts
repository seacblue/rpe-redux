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
import type { ChartRevisionSeed } from "../../global/chart/chartRevisionSeed.ts";
import { yieldToHost } from "../../utils/yieldToHost.ts";
import { registeredChartDocument } from "../../global/chart/streaming/chartDocumentRegistry.ts";
import {
  combineContentFingerprint,
  headerContentFingerprint,
  lineContentFingerprint,
  primeLineContentFingerprint,
} from "../../global/chart/chartContentHash.ts";

const wholeChartCache = new WeakMap<object, string>();
const headerCache = new WeakMap<object, string>();
const lineCache = new WeakMap<object, string>();
interface ChartFingerprintParts {
  readonly header: string;
  readonly lines: readonly string[];
  readonly digest: string;
}
const chartPartsCache = new WeakMap<object, ChartFingerprintParts>();
const warmPromises = new WeakMap<object, Promise<string>>();

/** Report optional browser-only fingerprint timings without coupling callers to the probe. */
function reportFingerprintTiming(stage: string, durationMs: number): void {
  const probe = (
    globalThis as typeof globalThis & {
      __reduxTransactionTimingProbe?: (value: { stage: string; durationMs: number }) => void;
    }
  ).__reduxTransactionTimingProbe;
  probe?.({ stage, durationMs });
}

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

/**
 * Installs line and child digests computed by a chart importer for a plain
 * parsed chart.
 *
 * The line objects may arrive through structured clone after the worker has
 * hashed them, so the digest is keyed to the received object identity here. The
 * per-line WeakMap cache is shared by every later revision: a copy-on-write
 * clone keeps untouched line object identities, so re-reading those digests
 * costs one WeakMap lookup instead of a whole-chart walk. Child digests let a
 * later copy-on-write edit rehash only the changed field instead of walking a
 * million-event sibling array again.
 */
export function installChartRevisionSeed(chart: Chart, seed: ChartRevisionSeed): void {
  const lines = chart.judgeLineList ?? [];
  for (let index = 0; index < lines.length && index < seed.lines.length; index += 1) {
    const line = lines[index];
    const seeded = seed.lines[index];
    if (!line || !seeded?.digest) {
      continue;
    }
    primeLineContentFingerprint(line, seeded.digest, seeded.childDigests, seeded.valueDigests);
    lineCache.set(line as object, seeded.digest);
  }
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
    const resolved = seeded ?? digest;
    const lineDigests = Object.freeze(parts.slice(1));
    wholeChartCache.set(chart, resolved);
    chartPartsCache.set(chart, {
      header: headerFingerprint(chart),
      lines: lineDigests,
      digest: resolved,
    });
    return resolved;
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
  const lineHashStarted = performance.now();
  const lineDigests = lines.map((line) => lineFingerprint(line));
  reportFingerprintTiming(
    "plan.afterFingerprint.fullLineHash",
    performance.now() - lineHashStarted,
  );
  const aggregateStarted = performance.now();
  const header = headerFingerprint(chart);
  const digest = combineContentFingerprint(header, lineDigests);
  reportFingerprintTiming(
    "plan.afterFingerprint.fullAggregate",
    performance.now() - aggregateStarted,
  );
  wholeChartCache.set(chart, digest);
  chartPartsCache.set(chart, {
    header,
    lines: Object.freeze([...lineDigests]),
    digest,
  });
  return digest;
}

/** Return a chart's canonical line digest vector, reusing the per-line cache. */
function chartFingerprintParts(chart: Chart): ChartFingerprintParts {
  const cached = chartPartsCache.get(chart);
  if (cached) {
    return cached;
  }
  const header = headerFingerprint(chart);
  const lines = Object.freeze((chart.judgeLineList ?? []).map((line) => lineFingerprint(line)));
  const digest = combineContentFingerprint(header, lines);
  const parts = { header, lines, digest };
  chartPartsCache.set(chart, parts);
  wholeChartCache.set(chart, digest);
  return parts;
}

/**
 * Fold a copy-on-write chart fingerprint by rehashing only changed judge lines.
 *
 * The caller must provide every changed line index and must keep the line count
 * unchanged. Structural line-list changes fall back to the canonical full walk
 * so insertion, deletion, and reorder operations retain their exact contract.
 */
export function chartFingerprintWithLineChanges(
  source: Chart,
  target: Chart,
  changedLineIndexes: Iterable<number>,
): string {
  const sourceLines = source.judgeLineList ?? [];
  const targetLines = target.judgeLineList ?? [];
  if (sourceLines.length !== targetLines.length) {
    return chartFingerprint(target) as string;
  }
  const base = chartFingerprintParts(source);
  const lineDigests = [...base.lines];
  const changedHashStarted = performance.now();
  for (const index of changedLineIndexes) {
    if (!Number.isInteger(index) || index < 0 || index >= targetLines.length) {
      return chartFingerprint(target) as string;
    }
    const line = targetLines[index];
    lineDigests[index] = lineFingerprint(line);
  }
  reportFingerprintTiming(
    "plan.afterFingerprint.changedLineHash",
    performance.now() - changedHashStarted,
  );
  const aggregateStarted = performance.now();
  const header = headerFingerprint(target);
  const digest = combineContentFingerprint(header, lineDigests);
  reportFingerprintTiming(
    "plan.afterFingerprint.incrementalAggregate",
    performance.now() - aggregateStarted,
  );
  const parts = {
    header,
    lines: Object.freeze(lineDigests),
    digest,
  };
  chartPartsCache.set(target, parts);
  wholeChartCache.set(target, digest);
  return digest;
}
