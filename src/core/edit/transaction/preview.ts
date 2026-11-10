/** Plans, caches, and consumes script transaction previews without touching history. */
import { assertChart, normalizeChartObjectIds, type Chart } from "../../global/chart/chart.ts";
import type { ChartObjectId } from "../../global/chart/identity.ts";
import { fingerprintJsonText } from "../../utils/fingerprint.ts";
import type { EditorSession } from "../session/session.ts";
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
  readonly chart: Chart;
  readonly label: string;
  readonly affectedObjectIds: readonly ChartObjectId[];
  readonly status: "previewed" | "unchanged";
  readonly dispose: () => void;
}

type PlannedTransactionDraft = Omit<PlannedTransaction, "dispose">;

type TransactionPlanOutcome =
  { readonly plan: PlannedTransactionDraft } | { readonly result: ChartTransactionResult };

const previewPlans = new WeakMap<EditorSession, PlannedTransaction>();
let nextPreviewId = 1;

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

/** Applies a request to a working chart and returns either a plan or a failure. */
function planChartTransaction(
  session: EditorSession | null,
  request: unknown,
  expectedFingerprint?: string,
): TransactionPlanOutcome {
  if (!session) {
    return { result: result("unavailable", null, null, [], [issue("editor.unavailable")], null) };
  }
  const beforeFingerprint = fingerprint(session.chart);
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
  const chart = transactionChart(session.chart);
  const state: MutableTransactionState = {
    chart,
    issues: [],
    affected: [],
    usedIds: new Set(),
    usedIdsReady: false,
    relationTouched: new Set(),
    clonedLines: new Set(),
  };
  applyRequest(state, request);
  for (const [index, line] of (chart.judgeLineList ?? []).entries()) {
    if (Object.hasOwn(line, NOISE_LINE_FIELD) && !validNoiseLineSettings(line)) {
      state.issues.push(issue("noise.line.invalid", `judgeLineList[${index}]`, line.id));
      continue;
    }
    if (!noiseLineSettings(line)) {
      continue;
    }
    const conflicts = lineNoiseConflicts(line);
    if (conflicts.notes || conflicts.alphaEvents || conflicts.speedEvents) {
      state.issues.push(issue("noise.line.incompatible", `judgeLineList[${index}]`, line.id));
    }
  }
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
    normalizeChartObjectIds(chart);
    assertChart(chart);
    const afterFingerprint = fingerprint(chart);
    const changed = beforeFingerprint !== afterFingerprint;
    const requestKey = requestFingerprint(request);
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
        chart,
        label: transactionLabel(request),
        affectedObjectIds: freezeIds(changed ? state.affected : []),
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

  const outcome = planChartTransaction(session, request);
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
): ChartTransactionPreviewResult {
  const outcome = planChartTransaction(session, request);
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
    { ...options, validatedNoise: true },
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
  const outcome = planChartTransaction(session, requestOrPreviewId, options.expectedFingerprint);
  if ("result" in outcome) {
    return outcome.result;
  }
  clearPlan(outcome.plan.session);
  return commitTransaction(
    outcome.plan.session,
    outcome.plan.chart,
    outcome.plan.label,
    outcome.plan.beforeFingerprint,
    outcome.plan.affectedObjectIds,
    { ...options, validatedNoise: true },
  );
}
