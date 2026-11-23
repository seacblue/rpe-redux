/** Owns the frozen facade for atomic multi-object chart edits and history. */
import { getTransactionApi } from "../edit/transaction/service.ts";
import { apiCall, availabilityFor, unavailableResult } from "./support.ts";
import type { ApiAvailability, ApiResult } from "./contract.ts";
import type {
  ChartPatch,
  ChartTransactionPreviewResult,
  ChartTransactionRequest,
  ChartTransactionResult,
  JudgeLinePatch,
  TransactionConflict,
  TransactionHistoryResult,
  TransactionHistoryState,
  TransactionLineInsert,
  TransactionLineTarget,
  TransactionJudgeLineUpdate,
  TransactionEventInsert,
  TransactionEventOperations,
  TransactionHistorySummary,
  TransactionIssue,
  TransactionLineOperations,
  TransactionLineGroupOperations,
  TransactionNoteInsert,
  TransactionNoteOperations,
  TransactionObjectUpdate,
  TransactionPreviewStatus,
  TransactionStatus,
  TransactionTimingOperations,
} from "../edit/transaction/contract.ts";

type TransactionRuntime = NonNullable<ReturnType<typeof getTransactionApi>>;

/** Run one transaction call against the connected editor. */
function withTransaction<T>(run: (api: TransactionRuntime) => T): ApiResult<T> {
  const api = getTransactionApi();
  return api
    ? apiCall(() => run(api))
    : unavailableResult<T>("No editor transaction runtime connected");
}

/** Atomic chart edits and history exposed to plugins. */
export const transaction = Object.freeze({
  /** Report whether a transaction runtime is connected. */
  availability(): ApiAvailability {
    return availabilityFor(getTransactionApi(), "No editor transaction runtime connected");
  },
  /** Apply a transaction request or a previously previewed request id. */
  apply(
    requestOrPreviewId?: ChartTransactionRequest | string,
    previewId?: string,
  ): ApiResult<ChartTransactionResult> {
    return withTransaction((api) => api.apply(requestOrPreviewId, previewId));
  },
  /** Validate and preview a transaction; returns a preview id when applicable. */
  preview(request: ChartTransactionRequest): ApiResult<ChartTransactionPreviewResult> {
    return withTransaction((api) => api.preview(request));
  },
  /** Discard a preview; true when the id was known. */
  cancel(previewId: string): ApiResult<boolean> {
    return withTransaction((api) => api.cancel(previewId));
  },
  /** Undo and redo availability with their labels. */
  history(): ApiResult<TransactionHistoryState> {
    return withTransaction((api) => api.history());
  },
  /** Undo one committed transaction. */
  undo(): ApiResult<TransactionHistoryResult> {
    return withTransaction((api) => api.undo());
  },
  /** Redo one undone transaction. */
  redo(): ApiResult<TransactionHistoryResult> {
    return withTransaction((api) => api.redo());
  },
});

export type TransactionHandle = typeof transaction;

export type {
  ChartPatch,
  ChartTransactionPreviewResult,
  ChartTransactionRequest,
  ChartTransactionResult,
  JudgeLinePatch,
  TransactionConflict,
  TransactionHistoryResult,
  TransactionHistoryState,
  TransactionLineInsert,
  TransactionLineTarget,
  TransactionJudgeLineUpdate,
  TransactionEventInsert,
  TransactionEventOperations,
  TransactionHistorySummary,
  TransactionIssue,
  TransactionLineOperations,
  TransactionLineGroupOperations,
  TransactionNoteInsert,
  TransactionNoteOperations,
  TransactionObjectUpdate,
  TransactionPreviewStatus,
  TransactionStatus,
  TransactionTimingOperations,
};

export { JUDGE_LINE_STRUCTURAL_FIELDS } from "../edit/transaction/contract.ts";
