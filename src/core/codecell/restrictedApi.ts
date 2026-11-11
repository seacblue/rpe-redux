/**
 * Wraps the public facade for one code cell so transaction writes obey the
 * field-level AI permissions and the cell profile stays minimal.
 *
 * The wrapper is deliberately narrow: reads, library access, and history stay
 * on the gated facade. `transaction.apply`, `transaction.preview`, and
 * `transaction.cancel` add the AI policy and a per-cell audit origin;
 * `transaction.undo/redo` are withheld because the cell profile exposes only
 * atomic chart transactions. The transaction handle stays lazy so a read-profile
 * cell never evaluates the `chart.write` getter.
 */
import type { ReduxApi } from "../api/index.ts";
import type { ApiResult } from "../api/contract.ts";
import { revisionConflicts, type RevisionPinField } from "../contracts/revisions.ts";
import type {
  ChartTransactionPreviewResult,
  ChartTransactionResult,
  TransactionIssue,
} from "../edit/transaction/contract.ts";
import { withTransactionOrigin } from "../edit/transaction/apply.ts";
import { aiTransactionIssues, type AiPolicyChart } from "../edit/aiEditingPolicy.ts";
import { ExtensionCapabilityError, type ExtensionCapability } from "../extensions/capabilities.ts";
import { CODE_CELL_HISTORY_ORIGIN, type CodeCellRevisions } from "./contract.ts";

/** The facade a cell sees: the public API plus its exact capability grant. */
export interface RestrictedCodeCellApi extends ReduxApi {
  /** The exact capabilities granted to this run; safe on every profile. */
  capabilities(): readonly ExtensionCapability[];
}

/** Host seams for one restricted cell facade. */
export interface RestrictedCodeCellApiOptions {
  /** The run id recorded as the history origin of a committed transaction. */
  readonly requestId?: string;
  /** The exact capabilities this run receives; exposed through `capabilities()`. */
  readonly capabilities?: readonly ExtensionCapability[];
  /** The revision snapshot captured when this cell started. */
  readonly baseRevisions?: CodeCellRevisions;
  /** Reads the mounted document's current revision snapshot for a write check. */
  readonly currentRevisions?: () => CodeCellRevisions;
  /** Rechecks the execution consent before every write. */
  readonly enabled?: () => boolean;
  /** Receives cleanup failures that must not fail the cell. */
  readonly reportFailure?: (error: unknown, action: string) => void;
}

/** One preview owned by this cell and the revision snapshot it was planned against. */
interface CellPreview {
  readonly request: unknown;
  readonly revisions: CodeCellRevisions | null;
}

/** Cleanup handles for the facades this module created. */
const releases = new WeakMap<ReduxApi, () => void>();

/** A cell may not reach a write handle of its own outside an atomic transaction. */
function withheld(action: string): never {
  throw new ExtensionCapabilityError("chart.write", action);
}

/** Stable issue for a preview created outside the current cell. */
function unknownPreview(): TransactionIssue {
  return Object.freeze({
    code: "ai.preview.unknown",
    message: "Code cells may only apply a preview created in the same cell",
  });
}

/** Stable issue for a write planned against a document revision that has moved on. */
function staleRevision(conflicts: readonly RevisionPinField[]): TransactionIssue {
  return Object.freeze({
    code: "stale_read",
    message: `Code cell base revision is stale: ${conflicts.join(", ")}`,
  });
}

/** Stable issue for a revision provider that cannot answer before a write. */
function unavailableRevision(message: string): TransactionIssue {
  return Object.freeze({
    code: "stale_read",
    message: `Code cell base revision is unavailable: ${message}`,
  });
}

/** Build one rejected apply result without touching the editor session. */
function rejectedApply(
  api: ReduxApi,
  issues: readonly TransactionIssue[],
): ApiResult<ChartTransactionResult> {
  const fingerprint = api.document.state().fingerprint;
  return {
    ok: true,
    value: Object.freeze({
      status: "rejected",
      beforeFingerprint: fingerprint,
      afterFingerprint: fingerprint,
      affectedObjectIds: Object.freeze([]),
      issues,
      history: null,
      conflict: null,
    }),
  };
}

/** Build one rejected preview result without retaining a plan. */
function rejectedPreview(
  issues: readonly TransactionIssue[],
): ApiResult<ChartTransactionPreviewResult> {
  return {
    ok: true,
    value: Object.freeze({
      status: "rejected",
      affectedObjectIds: Object.freeze([]),
      issues,
      previewId: null,
    }),
  };
}

/** Stable issue for a write attempted after the user revoked execution consent. */
function executionDisabled(message = "Code execution is disabled"): TransactionIssue {
  return Object.freeze({
    code: "code.execution.disabled",
    message,
  });
}

/**
 * Return the same facade with AI-aware transaction methods.
 *
 * The caller must pass an already capability-gated API; this wrapper adds only
 * the per-feature policy, the audit origin, and the cell-specific exclusions on
 * top. Pair every call with `releaseCodeCellApi` so previews still open when
 * the cell ends are cancelled.
 */
export function restrictCodeCellApi(
  api: ReduxApi,
  options: RestrictedCodeCellApiOptions = {},
): RestrictedCodeCellApi {
  const previews = new Map<string, CellPreview>();
  const capabilities = Object.freeze([...(options.capabilities ?? [])]);
  const reportFailure = options.reportFailure ?? (() => {});
  const baseRevisions = options.baseRevisions ?? null;
  const currentRevisions = options.currentRevisions ?? null;
  const enabled = options.enabled ?? null;
  const origin = Object.freeze({
    kind: CODE_CELL_HISTORY_ORIGIN,
    ...(options.requestId ? { requestId: options.requestId } : {}),
  });
  let policyCache: { key: string; chart: AiPolicyChart | null | undefined } | null = null;

  /** Identify the chart revision so repeated writes reuse one policy snapshot. */
  const policyKey = (): string | null => {
    let revisionKey: string | null = null;
    if (currentRevisions) {
      try {
        const current = currentRevisions();
        revisionKey = `revision:${current.chartFingerprint ?? ""}:${current.diskSnapshot ?? ""}:${current.generation}`;
      } catch (error) {
        reportFailure(error, "cell.revisions");
      }
    }
    try {
      const state = api.chart.state();
      if (state.ok) {
        const chartKey = `chart:${state.value.chartFingerprint ?? ""}:${state.value.generation}`;
        return revisionKey ? `${revisionKey}|${chartKey}` : chartKey;
      }
    } catch {
      // Fall back to the revision provider when the chart handle cannot report.
    }
    return revisionKey;
  };

  /**
   * Read the policy chart once per revision.
   *
   * A failed, thrown, or empty snapshot is `undefined`, which the policy treats
   * as an unavailable target and rejects event writes rather than as a chart
   * without events.
   */
  const policyChart = (): AiPolicyChart | null | undefined => {
    const key = policyKey();
    if (key !== null && policyCache?.key === key) {
      return policyCache.chart;
    }
    let chart: AiPolicyChart | null | undefined;
    try {
      const snapshot = api.chart.snapshot();
      if (snapshot.ok) {
        chart = snapshot.value ?? undefined;
      } else {
        reportFailure(snapshot.error, "cell.policySnapshot");
        chart = undefined;
      }
    } catch (error) {
      reportFailure(error, "cell.policySnapshot");
      chart = undefined;
    }
    if (key !== null) {
      policyCache = { key, chart };
    }
    return chart;
  };

  /** Recheck the user's execution consent; an unreadable consent fails closed. */
  const consentIssues = (): readonly TransactionIssue[] => {
    if (!enabled) {
      return [];
    }
    try {
      return enabled() ? [] : [executionDisabled()];
    } catch (error) {
      reportFailure(error, "cell.enabled");
      return [executionDisabled("Code execution consent is unavailable")];
    }
  };

  const issuesFor = (request: unknown): readonly TransactionIssue[] => {
    const consent = consentIssues();
    return consent.length ? consent : aiTransactionIssues(request, policyChart());
  };

  /**
   * Check the start snapshot immediately before a write.
   *
   * The cell may have read its base data at any point during the run; comparing
   * against the snapshot captured before the sandbox started makes every write
   * reject after a user edit, document switch, or external file change. The
   * check runs before preview planning and before apply, so neither path can
   * reach the session with stale data. An unreadable snapshot fails closed.
   */
  const revisionIssues = (expected: CodeCellRevisions | null): readonly TransactionIssue[] => {
    if (!expected || !currentRevisions) {
      return [];
    }
    let current: CodeCellRevisions;
    try {
      current = currentRevisions();
    } catch (error) {
      reportFailure(error, "cell.revisions");
      return [unavailableRevision(error instanceof Error ? error.message : String(error))];
    }
    const conflicts = revisionConflicts(expected, current);
    return conflicts.length ? [staleRevision(conflicts)] : [];
  };

  let transactionView: ReduxApi["transaction"] | null = null;
  let baseTransaction: ReduxApi["transaction"] | null = null;

  /** Build the transaction handle only when the cell asks for it. */
  const transaction = (): ReduxApi["transaction"] => {
    if (transactionView) {
      return transactionView;
    }
    baseTransaction = api.transaction;
    const base = baseTransaction;
    transactionView = Object.freeze({
      ...base,
      preview(request) {
        const stale = revisionIssues(baseRevisions);
        if (stale.length) {
          return rejectedPreview(stale);
        }
        const tagged = withTransactionOrigin(request, origin);
        const issues = issuesFor(tagged);
        if (issues.length) {
          return rejectedPreview(issues);
        }
        const result = base.preview(tagged);
        if (result.ok && result.value.previewId) {
          previews.set(result.value.previewId, { request: tagged, revisions: baseRevisions });
        }
        return result;
      },
      apply(requestOrPreviewId, previewId) {
        const id =
          typeof requestOrPreviewId === "string" ? requestOrPreviewId : (previewId ?? null);
        if (id) {
          const preview = previews.get(id);
          if (!preview) {
            return rejectedApply(api, [unknownPreview()]);
          }
          previews.delete(id);
          const stale = revisionIssues(preview.revisions);
          if (stale.length) {
            base.cancel(id);
            return rejectedApply(api, stale);
          }
          const issues = issuesFor(preview.request);
          if (issues.length) {
            base.cancel(id);
            return rejectedApply(api, issues);
          }
          return base.apply(id);
        }
        if (requestOrPreviewId === undefined) {
          return rejectedApply(api, [unknownPreview()]);
        }
        const stale = revisionIssues(baseRevisions);
        if (stale.length) {
          return rejectedApply(api, stale);
        }
        const tagged = withTransactionOrigin(requestOrPreviewId, origin);
        const issues = issuesFor(tagged);
        if (issues.length) {
          return rejectedApply(api, issues);
        }
        return base.apply(tagged, previewId);
      },
      cancel(previewId) {
        if (!previews.delete(previewId)) {
          return { ok: true, value: false };
        }
        return base.cancel(previewId);
      },
      get undo(): never {
        return withheld("transaction.undo");
      },
      get redo(): never {
        return withheld("transaction.redo");
      },
    }) as ReduxApi["transaction"];
    return transactionView;
  };

  /** Cancel every preview the cell still owns without reviving a read handle. */
  const release = (): void => {
    const base = baseTransaction;
    if (!base) {
      return;
    }
    const ids = [...previews.keys()];
    previews.clear();
    for (const id of ids) {
      try {
        base.cancel(id);
      } catch (error) {
        reportFailure(error, `cell.preview.cancel.${id}`);
      }
    }
  };

  // The gated facade is a proxy: enumerating or spreading it would evaluate
  // every capability getter. Intercept only the cell-specific handles.
  const restricted = new Proxy(api, {
    get(target, property, receiver) {
      if (property === "capabilities") {
        return () => capabilities;
      }
      if (property === "transaction") {
        return transaction();
      }
      return Reflect.get(target, property, receiver);
    },
  }) as RestrictedCodeCellApi;
  releases.set(restricted, release);
  return restricted;
}

/** Cancel the previews still held by one facade returned from `restrictCodeCellApi`. */
export function releaseCodeCellApi(api: ReduxApi): void {
  const release = releases.get(api);
  if (!release) {
    return;
  }
  releases.delete(api);
  release();
}
