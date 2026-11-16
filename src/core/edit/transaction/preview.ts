/** Plans, caches, and consumes script transaction previews without touching history. */
import { assertChart, normalizeChartObjectIds, type Chart } from "../../global/chart/chart.ts";
import {
  assertChartHeaderStructure,
  assertEventStructure,
  assertJudgeLineFields,
  assertJudgeLineStructure,
  assertNoteStructure,
} from "../../global/chart/chartValidation.ts";
import { containsCycle } from "../../global/chart/cycles.ts";
import { extensionRegistry } from "../../extensions/runtime.ts";
import type { ChartObjectId } from "../../global/chart/identity.ts";
import { fingerprintJsonText } from "../../utils/fingerprint.ts";
import { chartFingerprintWithLineChanges } from "../document/chartRevision.ts";
import type { EditorSession } from "../session/session.ts";
import type { NoteChangeHint } from "../../global/chart/runtime/noteChangeHints.ts";
import type {
  ChartTransactionPreviewResult,
  ChartTransactionRequest,
  ChartTransactionResult,
  TransactionCommitOptions,
  TransactionIssue,
} from "./contract.ts";
import { isChartTransactionRequest } from "./contract.ts";
import {
  NOISE_LINE_FIELD,
  noiseLineSettings,
  validNoiseLineSettings,
} from "../../global/chart/noise/noiseLine.ts";
import { lineNoiseConflicts } from "../../global/chart/noise/lineNoiseConflicts.ts";
import {
  applyRequest,
  commitTransaction,
  fingerprint,
  freezeIds,
  freezeIssues,
  issue,
  result,
  transactionChart,
  transactionLabel,
  type MutableTransactionState,
} from "./apply.ts";

interface PlannedTransaction {
  readonly session: EditorSession;
  readonly previewId: string;
  readonly requestFingerprint: string;
  readonly beforeFingerprint: string;
  readonly afterFingerprint: string;
  readonly expectedGeneration?: number;
  readonly chart: Chart;
  readonly label: string;
  readonly affectedObjectIds: readonly ChartObjectId[];
  readonly changedLineIndexes: readonly number[];
  readonly noteChangeHints: readonly NoteChangeHint[];
  readonly estimatedBytes: number;
  readonly status: "previewed" | "unchanged";
  readonly dispose: () => void;
}

/** Validate one line's noise constraints without rescanning unrelated lines. */
function validateNoiseLine(state: MutableTransactionState, index: number): void {
  const line = state.chart.judgeLineList?.[index];
  if (!line) {
    return;
  }
  if (Object.hasOwn(line, NOISE_LINE_FIELD) && !validNoiseLineSettings(line)) {
    state.issues.push(issue("noise.line.invalid", `judgeLineList[${index}]`, line.id));
    return;
  }
  if (!noiseLineSettings(line)) {
    return;
  }
  const conflicts = lineNoiseConflicts(line);
  if (conflicts.notes || conflicts.alphaEvents || conflicts.speedEvents) {
    state.issues.push(issue("noise.line.incompatible", `judgeLineList[${index}]`, line.id));
  }
}

/** Validate touched lines after the source chart has passed one complete scan. */
function validateTouchedNoiseLines(state: MutableTransactionState): void {
  for (const index of state.clonedLines) {
    validateNoiseLine(state, index);
  }
}

/** Keep the first transaction safe while making later line-local plans cheap. */
function validateTransactionNoise(session: EditorSession, state: MutableTransactionState): void {
  if (!validatedNoiseCharts.has(session.chart)) {
    for (const [index] of (state.chart.judgeLineList ?? []).entries()) {
      validateNoiseLine(state, index);
    }
    if (!state.issues.some((entry) => entry.code.startsWith("noise.line."))) {
      validatedNoiseCharts.add(session.chart);
      validatedNoiseCharts.add(state.chart);
    }
    return;
  }
  validateTouchedNoiseLines(state);
  validatedNoiseCharts.add(state.chart);
}

type PlannedTransactionDraft = Omit<PlannedTransaction, "dispose">;

type TransactionPlanOutcome =
  { readonly plan: PlannedTransactionDraft } | { readonly result: ChartTransactionResult };

const previewPlans = new WeakMap<EditorSession, PlannedTransaction>();
/** Charts whose complete noise-line state has already passed transaction validation. */
const validatedNoiseCharts = new WeakSet<object>();
let nextPreviewId = 1;

/** Report optional browser-only transaction timings without coupling the kernel to the UI. */
function reportTransactionTiming(sample: {
  stage: string;
  durationMs: number;
  status?: ChartTransactionResult["status"];
}): void {
  const probe = (
    globalThis as typeof globalThis & {
      __reduxTransactionTimingProbe?: (value: typeof sample) => void;
    }
  ).__reduxTransactionTimingProbe;
  probe?.(sample);
}

/** Freeze mutable planner note deltas before they cross the transaction boundary. */
function freezeNoteChangeHints(
  hints: MutableTransactionState["noteChangeHints"],
): readonly NoteChangeHint[] {
  if (!hints?.size) {
    return Object.freeze([]);
  }
  return Object.freeze(
    [...hints.entries()].map(([lineIndex, value]) =>
      Object.freeze({
        lineIndex,
        noteIndexes: Object.freeze([...value.noteIndexes].sort((left, right) => left - right)),
        kind: value.kind,
        overlapChanged: value.overlapChanged,
      }),
    ),
  );
}

/** Drops one cached preview and its history subscription. */
function clearPlan(session: EditorSession, plan = previewPlans.get(session)): void {
  if (!plan || previewPlans.get(session) !== plan) {
    return;
  }
  previewPlans.delete(session);
  plan.dispose();
}

/** Caches a preview and clears it when the session history changes. */
function storePlan(plan: PlannedTransactionDraft): PlannedTransaction {
  clearPlan(plan.session);
  const storedRef: { value?: PlannedTransaction } = {};
  const disposeSubscription = plan.session.history.subscribe(() =>
    clearPlan(plan.session, storedRef.value),
  );
  const stored: PlannedTransaction = { ...plan, dispose: disposeSubscription };
  storedRef.value = stored;
  previewPlans.set(plan.session, stored);
  return stored;
}

/** Builds a frozen preview result envelope. */
function previewResult(
  status: ChartTransactionPreviewResult["status"],
  affectedObjectIds: readonly ChartObjectId[],
  issues: readonly TransactionIssue[],
  previewId: string | null,
): ChartTransactionPreviewResult {
  return Object.freeze({
    status,
    affectedObjectIds: freezeIds(affectedObjectIds),
    issues: freezeIssues(issues),
    previewId,
  });
}

/** Fingerprints the serialized request; null when it cannot be serialized. */
function requestFingerprint(request: ChartTransactionRequest): string | null {
  try {
    const serialized = JSON.stringify(request);
    return serialized === undefined ? null : fingerprintJsonText(serialized);
  } catch {
    return null;
  }
}

/** Validate only transaction-owned structures when the chart has no validator hook. */
function validateTransactionChart(chart: Chart, state: MutableTransactionState): void {
  // Extension validators own the complete chart contract when installed.
  if (extensionRegistry.hasHook("chart:validate")) {
    assertChart(chart);
    return;
  }
  assertChartHeaderStructure(chart);
  for (const lineIndex of state.clonedLines) {
    const line = chart.judgeLineList?.[lineIndex];
    if (line) {
      if (state.fullLineValidation?.has(lineIndex)) {
        assertJudgeLineStructure(line, lineIndex);
      } else {
        assertJudgeLineFields(line, lineIndex);
      }
    }
  }
  for (const changed of state.changedNotes ?? []) {
    if (containsCycle(changed.note)) {
      throw new Error("Chart contains a cyclic note value");
    }
    assertNoteStructure(changed.note, `judgeLineList[${changed.lineIndex}]`, changed.noteIndex);
  }
  for (const changed of state.changedEvents ?? []) {
    if (containsCycle(changed.event)) {
      throw new Error("Chart contains a cyclic event value");
    }
    assertEventStructure(
      changed.event,
      changed.track,
      `judgeLineList[${changed.lineIndex}].events`,
      changed.eventIndex,
    );
  }
}

/** Applies a request to a working chart and returns either a plan or a failure. */
function planChartTransaction(
  session: EditorSession | null,
  request: unknown,
  expectedFingerprint?: string,
  currentGeneration?: number,
): TransactionPlanOutcome {
  if (!session) {
    return { result: result("unavailable", null, null, [], [issue("editor.unavailable")], null) };
  }
  if (!session.fingerprintReady) {
    return {
      result: result("rejected", null, null, [], [issue("editor.fingerprintPending")], null),
    };
  }
  const beforeFingerprintStarted = performance.now();
  const beforeFingerprint = fingerprint(session.chart);
  reportTransactionTiming({
    stage: "plan.beforeFingerprint",
    durationMs: performance.now() - beforeFingerprintStarted,
  });
  if (expectedFingerprint !== undefined && beforeFingerprint !== expectedFingerprint) {
    return {
      result: result("conflict", beforeFingerprint, beforeFingerprint, [], [], null, {
        code: "chartFingerprint",
        expectedFingerprint,
        currentFingerprint: beforeFingerprint,
      }),
    };
  }
  if (!session.editable) {
    return {
      result: result(
        "rejected",
        beforeFingerprint,
        beforeFingerprint,
        [],
        [issue("editor.readOnly")],
        null,
      ),
    };
  }
  if (!isChartTransactionRequest(request)) {
    return {
      result: result(
        "rejected",
        beforeFingerprint,
        beforeFingerprint,
        [],
        [issue("request.object.required")],
        null,
      ),
    };
  }
  if (
    request.expectedGeneration !== undefined &&
    (!Number.isSafeInteger(request.expectedGeneration) || request.expectedGeneration < 0)
  ) {
    return {
      result: result(
        "rejected",
        beforeFingerprint,
        beforeFingerprint,
        [],
        [issue("request.expectedGeneration.invalid")],
        null,
      ),
    };
  }
  if (
    request.expectedGeneration !== undefined &&
    currentGeneration !== undefined &&
    request.expectedGeneration !== currentGeneration
  ) {
    return {
      result: result(
        "rejected",
        beforeFingerprint,
        beforeFingerprint,
        [],
        [
          issue(
            "stale_read",
            undefined,
            undefined,
            `Expected chart generation ${request.expectedGeneration}, current generation is ${currentGeneration}`,
          ),
        ],
        null,
      ),
    };
  }
  const cloneStarted = performance.now();
  const chart = transactionChart(session.chart);
  reportTransactionTiming({ stage: "plan.clone", durationMs: performance.now() - cloneStarted });
  const state: MutableTransactionState = {
    chart,
    issues: [],
    affected: [],
    usedIds: new Set(),
    usedIdsReady: false,
    relationTouched: new Set(),
    clonedLines: new Set(),
    fullLineValidation: new Set(),
    retainedBytes: 64,
  };
  const applyStarted = performance.now();
  applyRequest(state, request);
  reportTransactionTiming({ stage: "plan.apply", durationMs: performance.now() - applyStarted });
  const noiseStarted = performance.now();
  validateTransactionNoise(session, state);
  reportTransactionTiming({ stage: "plan.noise", durationMs: performance.now() - noiseStarted });
  if (state.issues.length) {
    return {
      result: result(
        "rejected",
        beforeFingerprint,
        beforeFingerprint,
        [],
        freezeIssues(state.issues),
        null,
      ),
    };
  }
  try {
    const validationStarted = performance.now();
    const sameLineCount = chart.judgeLineList?.length === session.chart.judgeLineList?.length;
    // Copy-on-write transactions already know exactly which line slots they
    // replaced. Keep structural edits on the full safe path, but avoid walking
    // all 741 untouched lines for an update to one note or event.
    normalizeChartObjectIds(
      chart,
      undefined,
      session.chart,
      sameLineCount ? [...state.clonedLines] : undefined,
    );
    validateTransactionChart(chart, state);
    reportTransactionTiming({
      stage: "plan.validate",
      durationMs: performance.now() - validationStarted,
    });
    const afterFingerprintStarted = performance.now();
    const afterFingerprint =
      session.chartDocument && chart.judgeLineList?.length === session.chartDocument.lineCount
        ? session.chartDocument.previewFingerprint(chart, state.clonedLines)
        : chartFingerprintWithLineChanges(session.chart, chart, state.clonedLines);
    reportTransactionTiming({
      stage: "plan.afterFingerprint",
      durationMs: performance.now() - afterFingerprintStarted,
    });
    const changed = beforeFingerprint !== afterFingerprint;
    const requestFingerprintStarted = performance.now();
    const requestKey = requestFingerprint(request);
    reportTransactionTiming({
      stage: "plan.requestFingerprint",
      durationMs: performance.now() - requestFingerprintStarted,
    });
    if (!requestKey) {
      return {
        result: result(
          "rejected",
          beforeFingerprint,
          beforeFingerprint,
          [],
          [issue("request.unserializable")],
          null,
        ),
      };
    }
    return {
      plan: {
        session,
        previewId: `transaction-preview-${nextPreviewId++}`,
        requestFingerprint: requestKey,
        beforeFingerprint,
        afterFingerprint,
        expectedGeneration: request.expectedGeneration,
        chart,
        label: transactionLabel(request),
        affectedObjectIds: freezeIds(changed ? state.affected : []),
        changedLineIndexes: Object.freeze([...state.clonedLines]),
        noteChangeHints: freezeNoteChangeHints(state.noteChangeHints),
        estimatedBytes: state.retainedBytes ?? 64,
        status: changed ? "previewed" : "unchanged",
      },
    };
  } catch (error) {
    return {
      result: result(
        "rejected",
        beforeFingerprint,
        beforeFingerprint,
        [],
        [
          issue(
            "chart.validation.failed",
            undefined,
            undefined,
            error instanceof Error ? error.message : String(error),
          ),
        ],
        null,
      ),
    };
  }
}

/** Converts a cached plan into its public preview result. */
function previewResultFor(plan: PlannedTransaction): ChartTransactionPreviewResult {
  return previewResult(plan.status, plan.affectedObjectIds, [], plan.previewId);
}

/** Document replacement creates a new session; a changed chart also invalidates its old plan. */
export function previewChartTransaction(
  session: EditorSession | null,
  request: unknown,
  options: Pick<TransactionCommitOptions, "currentGeneration"> = {},
): ChartTransactionPreviewResult {
  if (session && isChartTransactionRequest(request)) {
    const active = previewPlans.get(session);
    const currentFingerprint = fingerprint(session.chart);
    const requestKey = requestFingerprint(request);
    if (
      active &&
      active.beforeFingerprint === currentFingerprint &&
      requestKey !== null &&
      active.requestFingerprint === requestKey
    ) {
      return previewResultFor(active);
    }
    if (active && active.beforeFingerprint !== currentFingerprint) {
      clearPlan(session, active);
    }
  }

  const outcome = planChartTransaction(session, request, undefined, options.currentGeneration);
  if ("result" in outcome) {
    return previewResult(
      outcome.result.status === "committed"
        ? "previewed"
        : outcome.result.status === "conflict"
          ? "rejected"
          : outcome.result.status,
      outcome.result.affectedObjectIds,
      outcome.result.issues,
      null,
    );
  }
  return previewResultFor(storePlan(outcome.plan));
}

/** Validate a transaction without retaining a preview that another caller can consume. */
export function validateChartTransaction(
  session: EditorSession | null,
  request: unknown,
  options: Pick<TransactionCommitOptions, "currentGeneration"> = {},
): ChartTransactionPreviewResult {
  const outcome = planChartTransaction(session, request, undefined, options.currentGeneration);
  if ("result" in outcome) {
    return previewResult(
      outcome.result.status === "committed"
        ? "previewed"
        : outcome.result.status === "conflict"
          ? "rejected"
          : outcome.result.status,
      outcome.result.affectedObjectIds,
      outcome.result.issues,
      null,
    );
  }
  return previewResult(outcome.plan.status, outcome.plan.affectedObjectIds, [], null);
}

/** Consumes one cached preview after checking that its base chart is current. */
function applyPreviewTransaction(
  session: EditorSession | null,
  previewId: string,
  options: TransactionCommitOptions = {},
): ChartTransactionResult {
  if (!session) {
    return result("unavailable", null, null, [], [issue("editor.unavailable")], null);
  }
  const plan = previewPlans.get(session);
  if (!plan || plan.previewId !== previewId) {
    const currentFingerprint = fingerprint(session.chart);
    return result(
      "rejected",
      currentFingerprint,
      currentFingerprint,
      [],
      [issue("preview.notFound", undefined, undefined, previewId)],
      null,
    );
  }
  clearPlan(session, plan);
  const currentFingerprint = fingerprint(session.chart);
  if (
    plan.expectedGeneration !== undefined &&
    options.currentGeneration !== undefined &&
    plan.expectedGeneration !== options.currentGeneration
  ) {
    return result(
      "rejected",
      currentFingerprint,
      currentFingerprint,
      [],
      [
        issue(
          "stale_read",
          undefined,
          undefined,
          `Expected chart generation ${plan.expectedGeneration}, current generation is ${options.currentGeneration}`,
        ),
      ],
      null,
    );
  }
  if (currentFingerprint !== plan.beforeFingerprint) {
    return result(
      "rejected",
      currentFingerprint,
      currentFingerprint,
      [],
      [issue("preview.stale", undefined, undefined, previewId)],
      null,
    );
  }
  return commitTransaction(
    session,
    plan.chart,
    plan.label,
    plan.beforeFingerprint,
    plan.affectedObjectIds,
    {
      ...options,
      validatedNoise: true,
      afterFingerprint: plan.afterFingerprint,
      estimatedBytes: plan.estimatedBytes,
      changedLineIndexes: plan.changedLineIndexes,
      noteChangeHints: plan.noteChangeHints,
    },
  );
}

/** Discards one cached preview; false when the id does not match. */
export function cancelPreviewTransaction(
  session: EditorSession | null,
  previewId: string,
): boolean {
  if (!session) {
    return false;
  }
  const plan = previewPlans.get(session);
  if (!plan || plan.previewId !== previewId) {
    return false;
  }
  clearPlan(session, plan);
  return true;
}

/** Applies a new request or consumes one existing preview exactly once. */
export function applyChartTransaction(
  session: EditorSession | null,
  requestOrPreviewId?: unknown,
  previewId?: string,
  options: TransactionCommitOptions = {},
): ChartTransactionResult {
  if (previewId !== undefined) {
    return applyPreviewTransaction(session, previewId, options);
  }
  if (typeof requestOrPreviewId === "string") {
    return applyPreviewTransaction(session, requestOrPreviewId, options);
  }
  if (requestOrPreviewId === undefined && session) {
    const active = previewPlans.get(session);
    if (active) {
      return applyPreviewTransaction(session, active.previewId, options);
    }
  }
  const planStarted = performance.now();
  const outcome = planChartTransaction(
    session,
    requestOrPreviewId,
    options.expectedFingerprint,
    options.currentGeneration,
  );
  reportTransactionTiming({
    stage: "plan",
    durationMs: performance.now() - planStarted,
    status:
      "result" in outcome
        ? outcome.result.status
        : outcome.plan.status === "previewed"
          ? "committed"
          : "unchanged",
  });
  if ("result" in outcome) {
    return outcome.result;
  }
  clearPlan(outcome.plan.session);
  const commitStarted = performance.now();
  const committed = commitTransaction(
    outcome.plan.session,
    outcome.plan.chart,
    outcome.plan.label,
    outcome.plan.beforeFingerprint,
    outcome.plan.affectedObjectIds,
    {
      ...options,
      validatedNoise: true,
      afterFingerprint: outcome.plan.afterFingerprint,
      estimatedBytes: outcome.plan.estimatedBytes,
      changedLineIndexes: outcome.plan.changedLineIndexes,
      noteChangeHints: outcome.plan.noteChangeHints,
    },
  );
  reportTransactionTiming({
    stage: "commit",
    durationMs: performance.now() - commitStarted,
    status: committed.status,
  });
  return committed;
}
