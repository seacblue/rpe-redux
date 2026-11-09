/**
 * The AI activity pane.
 *
 * The pane is a read-only inspector for the desktop bridge's request log: every
 * request an AI client sent, when it arrived, how long it took, and the exact
 * request and response bodies. Running cells from the UI is deliberately gone;
 * the AI client remains the only caller, and `core/edit/codecell/activity.ts` owns
 * the log contract.
 */
import { useState, useSyncExternalStore } from "react";
import {
  codeCellActivity,
  type CodeCellActivityEntry,
  type CodeCellActivityStatus,
} from "../../../../../core/edit/codecell/activity.ts";
import { isRecord } from "../../../../../core/utils/guards.ts";
import { IconButton } from "../../../../../design/components/button/IconButton.tsx";
import { Button } from "../../../../../design/components/button/Button.tsx";
import { Icon } from "../../../../../design/components/icon/Icon.tsx";
import { Disclosure } from "../../../../../design/components/disclosure/Disclosure.tsx";
import { EmptyState } from "../../../../../design/components/empty-state/EmptyState.tsx";
import { useTranslation } from "../../../../../i18n/react.ts";
import type { MessageKey } from "../../../../../i18n/index.ts";
import { useSetting } from "../../../settings/useSetting.ts";
import { openSettings } from "../../../settings/settingsWindowController.ts";

const MAX_DETAIL_CHARS = 40_000;

const statusKeys: Readonly<Record<CodeCellActivityStatus, MessageKey>> = Object.freeze({
  pending: "editorPanels.aiActivity.status.pending",
  ok: "editorPanels.aiActivity.status.ok",
  error: "editorPanels.aiActivity.status.error",
});

/** Subscribes the pane to the shared log. */
function subscribeActivity(listener: () => void): () => void {
  return codeCellActivity.subscribe(listener);
}

/** Reads the current log snapshot. */
function activitySnapshot(): readonly CodeCellActivityEntry[] {
  return codeCellActivity.get();
}

/** Formats one timestamp as a local time-of-day. */
function clockTime(at: number): string {
  return new Date(at).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

/** Formats one timestamp as a full local date and time for the tooltip. */
function fullTime(at: number): string {
  return new Date(at).toLocaleString();
}

/** Serializes a detail value as capped JSON text. */
function prettyValue(value: unknown): string {
  try {
    const text = JSON.stringify(value, null, 2) ?? String(value);
    return text.length > MAX_DETAIL_CHARS ? `${text.slice(0, MAX_DETAIL_CHARS)}\n…` : text;
  } catch {
    return String(value);
  }
}

/** Reads the raw cell source out of a request frame, when it carries one. */
function sourceOf(request: unknown): string | null {
  if (!isRecord(request) || !isRecord(request.params)) {
    return null;
  }
  return typeof request.params.source === "string" ? request.params.source : null;
}

/** Renders one expandable request/response pair. */
function ActivityEntryView({ entry }: { entry: CodeCellActivityEntry }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const source = sourceOf(entry.request);
  return (
    <li className="redux-ai-activity-item">
      <Disclosure
        className="redux-ai-activity-entry"
        data-ai-activity-entry
        data-method={entry.method}
        data-status={entry.status}
        onOpenChange={setOpen}
        summaryClassName="redux-ai-activity-summary"
        summary={
          <>
            <Icon
              name="chevronRight"
              size={14}
              className="redux-ai-activity-chevron"
              aria-hidden="true"
            />
            <span
              className="redux-ai-activity-status"
              data-status={entry.status}
              aria-hidden="true"
            />
            <span className="redux-ai-activity-method">{entry.method}</span>
            <span className="redux-ai-activity-meta">
              <time dateTime={new Date(entry.at).toISOString()} data-tip-title={fullTime(entry.at)}>
                {clockTime(entry.at)}
              </time>
              <span aria-hidden="true">, </span>
              {entry.status === "pending"
                ? t("editorPanels.aiActivity.pending")
                : t("editorPanels.aiActivity.duration", {
                    ms: Math.round(entry.durationMs ?? 0),
                  })}
            </span>
            <span className="redux-visually-hidden">{t(statusKeys[entry.status])}</span>
          </>
        }
      >
        {open && (
          <div className="redux-ai-activity-detail" data-ai-activity-detail>
            <section className="redux-ai-activity-section">
              <div className="redux-ai-activity-section-heading">
                <strong>{t("editorPanels.aiActivity.request")}</strong>
                <small>{t("editorPanels.aiActivity.transport")}</small>
              </div>
              {source !== null && (
                <>
                  <small className="redux-ai-activity-label">
                    {t("editorPanels.aiActivity.source")}
                  </small>
                  <pre className="redux-ai-activity-code redux-ai-activity-source">{source}</pre>
                </>
              )}
              <pre className="redux-ai-activity-code">{prettyValue(entry.request)}</pre>
            </section>
            <section className="redux-ai-activity-section">
              <div className="redux-ai-activity-section-heading">
                <strong>{t("editorPanels.aiActivity.response")}</strong>
              </div>
              <pre className="redux-ai-activity-code">
                {entry.response === undefined
                  ? t("editorPanels.aiActivity.pending")
                  : prettyValue(entry.response)}
              </pre>
            </section>
          </div>
        )}
      </Disclosure>
    </li>
  );
}

/** Renders the bridge's request log with a clear action and empty states. */
export function AiActivityPanel() {
  const { t } = useTranslation();
  const enabled = useSetting("code-execution-enabled", false);
  const entries = useSyncExternalStore(subscribeActivity, activitySnapshot, activitySnapshot);
  return (
    <section className="redux-ai-activity-panel">
      {entries.length > 0 && (
        <div className="inspector-pane-meta">
          <IconButton
            className="redux-ai-activity-clear"
            icon="trash"
            variant="ghost"
            label={t("editorPanels.aiActivity.clear")}
            data-action="clear"
            onClick={() => codeCellActivity.clear()}
          />
        </div>
      )}
      <div className="redux-ai-activity-body">
        {!enabled && (
          <div className="redux-ai-activity-disabled">
            <p>{t("editorPanels.aiActivity.disabledHint")}</p>
            <Button variant="outlined" onClick={() => openSettings("general.codeCell")}>
              {t("editorPanels.aiActivity.openSettings")}
            </Button>
          </div>
        )}
        {entries.length === 0 ? (
          enabled ? (
            <EmptyState
              variant="full"
              icon="bot"
              title={t("editorPanels.aiActivity.emptyTitle")}
              description={t("editorPanels.aiActivity.empty")}
            />
          ) : null
        ) : (
          <ol className="redux-ai-activity-list">
            {entries.map((entry) => (
              <ActivityEntryView key={entry.id} entry={entry} />
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}
