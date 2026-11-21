/**
 * Owns the bounded developer findings store behind the F4 detector.
 *
 * The store is host-independent: the frontend decides when developer surfaces
 * are open and calls `setDevCaptureEnabled`. Every report is deduplicated by
 * kind, source, and message, so a repeated bad call shows one row with a count
 * instead of flooding the panel.
 */

/** The categories the detector reports. */
export type DevFindingKind = "deprecated" | "out-of-range" | "invalid" | "error";

/** One deduplicated developer finding. */
export interface DevFinding {
  readonly id: string;
  readonly kind: DevFindingKind;
  readonly source: string;
  readonly message: string;
  readonly detail?: string;
  readonly count: number;
  readonly firstAt: number;
  readonly lastAt: number;
  readonly stack?: readonly string[];
}

/** The fields a caller supplies for one finding. */
export interface DevFindingInput {
  readonly kind: DevFindingKind;
  readonly source: string;
  readonly message: string;
  readonly detail?: string;
  /** Pre-captured stack; the detector captures one when omitted. */
  readonly stack?: string;
}

/** New rows kept at once; older rows are evicted first. */
export const MAX_DEV_FINDINGS = 500;
/** New distinct rows accepted per second, so a loop cannot flood the panel. */
export const MAX_DEV_FINDINGS_PER_SECOND = 25;

let captureEnabled = false;
let findings: readonly DevFinding[] = Object.freeze([]);
let byId = new Map<string, DevFinding>();
let windowStartedAt = 0;
let windowAccepted = 0;
const listeners = new Set<() => void>();

/** Turn capture on or off; the frontend owns the developer-surface policy. */
export function setDevCaptureEnabled(enabled: boolean): void {
  captureEnabled = enabled;
}

/** Whether findings are being collected. */
export function isDevCaptureEnabled(): boolean {
  return captureEnabled;
}

/** The current findings, newest last. */
export function getDevFindings(): readonly DevFinding[] {
  return findings;
}

/** Subscribe to finding changes. */
export function subscribeDevFindings(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Drop every finding and reset the rate window. */
export function clearDevFindings(): void {
  findings = Object.freeze([]);
  byId = new Map();
  windowAccepted = 0;
  windowStartedAt = 0;
  notify();
}

/** Capture a short stack from the current call site. */
function captureStack(): readonly string[] | undefined {
  try {
    const stack = new Error().stack;
    if (!stack) {
      return undefined;
    }
    const frames = stack
      .split("\n")
      .slice(1)
      .map((line) => line.trim())
      .filter((line) => /[\\/]src[\\/]/u.test(line))
      .slice(0, 6);
    return frames.length > 0 ? Object.freeze(frames) : undefined;
  } catch {
    return undefined;
  }
}

/** Notify every subscriber once. */
function notify(): void {
  for (const listener of [...listeners]) {
    listener();
  }
}

/** Rebuild one row so consumers always see a frozen value. */
function freezeFinding(finding: DevFinding): DevFinding {
  return Object.freeze({
    ...finding,
    ...(finding.stack ? { stack: Object.freeze([...finding.stack]) } : {}),
  });
}

/**
 * Record one finding.
 *
 * A repeated `kind + source + message` increments its counter. New rows are
 * rate limited per second and the buffer keeps only the newest
 * `MAX_DEV_FINDINGS` entries.
 */
export function reportDevFinding(input: DevFindingInput): void {
  if (!captureEnabled) {
    return;
  }
  const now = Date.now();
  const id = `${input.kind}|${input.source}|${input.message}`;
  const existing = byId.get(id);
  if (existing) {
    const updated = freezeFinding({
      ...existing,
      count: existing.count + 1,
      lastAt: now,
      ...(input.detail !== undefined && existing.detail === undefined
        ? { detail: input.detail }
        : {}),
    });
    byId.set(id, updated);
    findings = Object.freeze(findings.map((entry) => (entry.id === id ? updated : entry)));
    notify();
    return;
  }

  if (now - windowStartedAt >= 1000) {
    windowStartedAt = now;
    windowAccepted = 0;
  }
  if (windowAccepted >= MAX_DEV_FINDINGS_PER_SECOND) {
    return;
  }
  windowAccepted += 1;

  const finding = freezeFinding({
    id,
    kind: input.kind,
    source: input.source,
    message: input.message,
    ...(input.detail === undefined ? {} : { detail: input.detail }),
    count: 1,
    firstAt: now,
    lastAt: now,
    stack: input.stack === undefined ? captureStack() : input.stack.split("\n").filter(Boolean),
  });
  byId.set(id, finding);
  const next = [...findings, finding];
  findings = Object.freeze(next.length > MAX_DEV_FINDINGS ? next.slice(-MAX_DEV_FINDINGS) : next);
  notify();
}
