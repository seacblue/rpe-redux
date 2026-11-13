/**
 * Public transaction API binding. The apply kernel lives in `apply.ts`; this
 * module only connects the mounted session to the plugin facade and re-exports
 * the kernel for internal callers.
 */
import type {
  ChartTransactionPreviewResult,
  ChartTransactionResult,
  TransactionHistoryResult,
  TransactionHistoryState,
} from "./contract.ts";
import { createLateBound } from "../../utils/lateBound.ts";
import type { EditorSession } from "../session/session.ts";
import { chartFingerprint } from "../document/chartRevision.ts";
import {
  applyChartTransaction,
  cancelPreviewTransaction,
  previewChartTransaction,
} from "./preview.ts";

export {
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

interface TransactionApiHost {
  session(): EditorSession | null;
  revision?(): { readonly generation: number };
}

/** Connect the mounted editor to the public transaction facade. */
function createTransactionApi(host: TransactionApiHost) {
  /** Reads the undo/redo state exposed by the facade. */
  const historyOf = (session: EditorSession | null): TransactionHistoryState => ({
    canUndo: Boolean(session?.history.undoStack.length),
    canRedo: Boolean(session?.history.redoStack.length),
    undoLabel: session?.history.undoStack.at(-1)?.label,
    redoLabel: session?.history.redoStack.at(-1)?.label,
  });
  /** Travels one history step and reports fingerprints around the move. */
  const travel = (direction: "undo" | "redo"): TransactionHistoryResult => {
    const session = host.session();
    if (!session) {
      return {
        changed: false,
        beforeFingerprint: "",
        afterFingerprint: "",
        history: historyOf(null),
      };
    }
    const beforeFingerprint = chartFingerprint(session.chart);
    const changed = session.travel(direction);
    return {
      changed,
      beforeFingerprint,
      afterFingerprint: chartFingerprint(session.chart),
      history: historyOf(session),
    };
  };
  return {
    version: 1,
    apply(requestOrPreviewId?: unknown, previewId?: string): ChartTransactionResult {
      return applyChartTransaction(host.session(), requestOrPreviewId, previewId, {
        currentGeneration: host.revision?.().generation ?? 0,
      });
    },
    preview(request: unknown): ChartTransactionPreviewResult {
      return previewChartTransaction(host.session(), request, {
        currentGeneration: host.revision?.().generation ?? 0,
      });
    },
    cancel(previewId: string): boolean {
      return cancelPreviewTransaction(host.session(), previewId);
    },
    history(): TransactionHistoryState {
      return historyOf(host.session());
    },
    undo(): TransactionHistoryResult {
      return travel("undo");
    },
    redo(): TransactionHistoryResult {
      return travel("redo");
    },
  };
}

const transactionApiBinding = createLateBound<ReturnType<typeof createTransactionApi>>();

/** Bind the transaction facade to one mounted editor session. */
export function connectTransactionApi(host: TransactionApiHost): () => void {
  return transactionApiBinding.bind(createTransactionApi(host));
}

/** Read the currently mounted transaction facade, if any. */
export function getTransactionApi(): ReturnType<typeof createTransactionApi> | null {
  return transactionApiBinding.value();
}
