/**
 * The history pane: one continuous list of undo, redo, and discarded entries
 * with the objects each one affected.
 *
 * It subscribes to the selection session's history and dispatches through
 * `jumpToHistory` for a local document or `selectiveUndo` for a room transaction,
 * so undo state is never copied into local cells. A divider separates every
 * adjacent pair of rows, including across stack boundaries. A row offers one
 * action on hover: revert the document to that point, including every later
 * edit. In a room, only entries authored by this member can be compensated, and
 * redo rows are not offered because a room has no shared redo branch. Relative
 * timestamps advance while the pane is active and visible.
 */
import { Fragment, useSyncExternalStore } from "react";
import { CODE_CELL_HISTORY_ORIGIN } from "../../../../../core/codecell/contract.ts";
import type {
  HistoryEntries,
  HistoryEntrySummary,
} from "../../../../../core/edit/session/history.ts";
import { selectiveUndo } from "../../../../../core/edit/session/selectiveUndo.ts";
import { getSelectionSession } from "../../../../../core/edit/selection/api.ts";
import { useTranslation } from "../../../../../i18n/react.ts";
import { IconButton } from "../../../../../design/components/button/IconButton.tsx";
import { Divider } from "../../../../../design/components/divider/Divider.tsx";
import { showToast } from "../../../../../design/patterns/ToastHost.tsx";
import { EmptyState } from "../../../../../design/components/empty-state/EmptyState.tsx";
import { useEditorRuntimeValue } from "../../workspace/runtime/composition/EditorRuntime.tsx";
import { relativeTime } from "../relativeTime.ts";
import { useHistoryClock } from "./useHistoryClock.ts";

const emptyEntries: HistoryEntries = Object.freeze({
  undo: Object.freeze([]),
  redo: Object.freeze([]),
  discarded: 0,
  discardedEntries: Object.freeze([]),
});

/** Subscribes to the selection session's history cell and change events. */
function subscribeHistory(listener: () => void): () => void {
  const session = getSelectionSession();
  if (!session) {
    return () => {};
  }
  const disposeHistory = session.history.subscribe(listener);
  const onChange = () => listener();
  session.addEventListener("change", onChange);
  return () => {
    disposeHistory();
    session.removeEventListener("change", onChange);
  };
}

/** Reads history entries, falling back to the frozen empty set. */
function historyEntries(): HistoryEntries {
  return getSelectionSession()?.historyEntries() ?? emptyEntries;
}

/** One history entry tagged with the stack it came from. */
interface HistoryRow {
  summary: HistoryEntrySummary;
  stack: "undo" | "redo" | "discarded";
}

/** Returns one stack newest first as view rows. */
function rowsFor(entries: HistoryEntries, stack: HistoryRow["stack"]): HistoryRow[] {
  const summaries =
    stack === "undo" ? entries.undo : stack === "redo" ? entries.redo : entries.discardedEntries;
  return [...summaries].reverse().map((summary) => ({ summary, stack }));
}

/** Returns every stack in display order: undo, redo, then discarded. */
function allRows(entries: HistoryEntries): HistoryRow[] {
  return [
    ...rowsFor(entries, "undo"),
    ...rowsFor(entries, "redo"),
    ...rowsFor(entries, "discarded"),
  ];
}

/** One history row with its revert action. */
function HistoryRowView({
  row,
  now,
  actorId,
  collaborative,
  onRevert,
}: {
  row: HistoryRow;
  now: number;
  actorId: string;
  collaborative: boolean;
  onRevert(id: number): void;
}) {
  const { t } = useTranslation();
  const { summary } = row;
  const canRevert =
    !summary.discarded &&
    (collaborative
      ? row.stack === "undo" &&
        summary.origin?.kind !== "collaborative-undo" &&
        !summary.origin?.compensated &&
        Boolean(summary.origin?.requestId) &&
        summary.origin?.clientId === actorId
      : row.stack !== "discarded");
  return (
    <div className="redux-history-row-container">
      <div className="redux-history-row">
        <span className="redux-history-row-main">
          <strong>{summary.label}</strong>
          <small>
            {t("workspace.history.affected", { count: summary.affectedCount })}
            {", "}
            {relativeTime(summary.at, now)}
          </small>
        </span>
        {summary.origin?.kind === CODE_CELL_HISTORY_ORIGIN && (
          <small className="redux-history-origin">{t("workspace.history.codeCell")}</small>
        )}
        {summary.discarded && (
          <small className="redux-history-discarded">{t("workspace.history.discarded")}</small>
        )}
      </div>
      {canRevert && (
        <IconButton
          className="redux-history-revert"
          icon="undo"
          label={t("workspace.history.revert")}
          onClick={() => onRevert(summary.id)}
        />
      )}
    </div>
  );
}

/** Renders every history row in one list with a divider between neighbours. */
export function HistoryPanel() {
  const { t } = useTranslation();
  const entries = useSyncExternalStore(subscribeHistory, historyEntries, () => emptyEntries);
  const session = getSelectionSession();
  const collaborative = session?.collaborationActive === true;
  const actorId = session?.collaborationActorId ?? "";
  const active = useEditorRuntimeValue((current) => current.ui.activeInspector, "") === "history";
  const hasRows = entries.undo.length + entries.redo.length + entries.discardedEntries.length > 0;
  const now = useHistoryClock(active, hasRows);
  const revert = (id: number) => {
    if (!session) {
      return;
    }
    if (!collaborative) {
      session.jumpToHistory(id);
      return;
    }
    const result = selectiveUndo(session, id, t("workspace.history.collaborativeUndo"));
    if (result.status === "conflict") {
      showToast(t("workspace.history.undoConflict", { paths: result.paths.join(", ") }), "error");
    } else if (result.status !== "committed") {
      showToast(t("workspace.history.undoUnavailable"), "warning");
    }
  };
  return (
    <section className="redux-history-panel">
      <div className="redux-history-body">
        {!hasRows ? (
          <EmptyState
            icon="recover"
            title={t("workspace.history.emptyTitle")}
            description={t("workspace.history.empty")}
          />
        ) : (
          <div className="redux-history-sections">
            {allRows(entries).map((row, index) => (
              <Fragment key={`${row.stack}:${row.summary.id}`}>
                {index > 0 && <Divider axis="x" />}
                <HistoryRowView
                  row={row}
                  now={now}
                  actorId={actorId}
                  collaborative={collaborative}
                  onRevert={revert}
                />
              </Fragment>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
