/**
 * The F4 developer findings panel.
 *
 * It renders the bounded detector store with kind filters, a text filter, and a
 * JSON copy. Capture stays a setting; this surface only presents what the
 * detector collected while the developer section was open.
 */
import { useMemo, useState, useSyncExternalStore } from "react";
import { Button } from "../../../design/components/button/Button.tsx";
import { Icon } from "../../../design/components/icon/Icon.tsx";
import { Input } from "../../../design/components/input/Input.tsx";
import {
  clearDevFindings,
  getDevFindings,
  subscribeDevFindings,
  type DevFinding,
  type DevFindingKind,
} from "../../../core/dev/detector.ts";
import { devDetectorEnabled } from "../../../core/state/devDetector.ts";
import type { MessageKey } from "../../../i18n/messages/index.ts";
import { useTranslation } from "../../../i18n/react.ts";
import {
  closeDevDetectorPanel,
  isDevDetectorVisible,
  subscribeDevDetectorVisibility,
} from "./devDetector.ts";

type FindingFilter = "all" | DevFindingKind;

const FILTERS: readonly FindingFilter[] = ["all", "deprecated", "out-of-range", "invalid", "error"];

/** One stable id for a finding kind label. */
function kindKey(kind: DevFindingKind): MessageKey {
  switch (kind) {
    case "deprecated":
      return "chrome.devDetector.kind.deprecated";
    case "out-of-range":
      return "chrome.devDetector.kind.outOfRange";
    case "invalid":
      return "chrome.devDetector.kind.invalid";
    case "error":
      return "chrome.devDetector.kind.error";
  }
}

/** Count every finding once; the row count itself is not multiplied. */
function countByKind(findings: readonly DevFinding[]): Record<DevFindingKind, number> {
  const counts: Record<DevFindingKind, number> = {
    deprecated: 0,
    "out-of-range": 0,
    invalid: 0,
    error: 0,
  };
  for (const finding of findings) {
    counts[finding.kind] += 1;
  }
  return counts;
}

/** Format one finding as the copied JSON document. */
function copyPayload(findings: readonly DevFinding[]): string {
  return JSON.stringify(
    findings.map((finding) => ({
      kind: finding.kind,
      source: finding.source,
      message: finding.message,
      detail: finding.detail,
      count: finding.count,
      firstAt: new Date(finding.firstAt).toISOString(),
      lastAt: new Date(finding.lastAt).toISOString(),
      stack: finding.stack,
    })),
    null,
    2,
  );
}

/** Renders one deduplicated row with its optional stack. */
function FindingRow({ finding }: { finding: DevFinding }) {
  const { t } = useTranslation();
  return (
    <article className="redux-dev-detector-row" data-kind={finding.kind}>
      <div className="redux-dev-detector-row-head">
        <span className="redux-dev-detector-kind">{t(kindKey(finding.kind))}</span>
        <code className="redux-dev-detector-source">{finding.source}</code>
        <span className="redux-dev-detector-count">
          {t("chrome.devDetector.count", { count: finding.count })}
        </span>
      </div>
      <p className="redux-dev-detector-message">{finding.message}</p>
      {finding.detail && <p className="redux-dev-detector-detail">{finding.detail}</p>}
      <small className="redux-dev-detector-time">
        {t("chrome.devDetector.lastSeen", {
          time: new Date(finding.lastAt).toLocaleTimeString(),
        })}
      </small>
      {finding.stack && finding.stack.length > 0 && (
        <details className="redux-dev-detector-stack">
          <summary>{t("chrome.devDetector.stack")}</summary>
          <pre>{finding.stack.join("\n")}</pre>
        </details>
      )}
    </article>
  );
}

/** The detector is a developer surface; it renders nothing while it is closed. */
export function DevDetector() {
  const { t } = useTranslation();
  const visible = useSyncExternalStore(
    subscribeDevDetectorVisibility,
    isDevDetectorVisible,
    isDevDetectorVisible,
  );
  const findings = useSyncExternalStore(subscribeDevFindings, getDevFindings, getDevFindings);
  const enabled = useSyncExternalStore(
    devDetectorEnabled.subscribe,
    devDetectorEnabled.get,
    devDetectorEnabled.get,
  );
  const [filter, setFilter] = useState<FindingFilter>("all");
  const [query, setQuery] = useState("");
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");

  const counts = useMemo(() => countByKind(findings), [findings]);
  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return [...findings]
      .reverse()
      .filter((finding) => filter === "all" || finding.kind === filter)
      .filter(
        (finding) =>
          !needle ||
          finding.source.toLowerCase().includes(needle) ||
          finding.message.toLowerCase().includes(needle) ||
          finding.detail?.toLowerCase().includes(needle),
      );
  }, [filter, findings, query]);

  if (!visible) {
    return null;
  }

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(copyPayload(findings));
      setCopyState("copied");
      window.setTimeout(() => setCopyState("idle"), 1_500);
    } catch {
      setCopyState("failed");
    }
  };

  return (
    <aside
      className="redux-dev-detector"
      aria-label={t("chrome.devDetector.title")}
      data-enabled={enabled ? "true" : "false"}
    >
      <header className="redux-dev-detector-head">
        <div className="redux-dev-detector-title">
          <Icon name="monitor" size={16} />
          <strong>{t("chrome.devDetector.title")}</strong>
          <span className="redux-dev-detector-status">
            {enabled ? t("chrome.devDetector.capturing") : t("chrome.devDetector.paused")}
          </span>
        </div>
        <div className="redux-dev-detector-actions">
          <Button
            variant="ghost"
            size="sm"
            iconText
            onClick={() => void copy()}
            disabled={findings.length === 0}
          >
            <Icon name="copy" size={14} />
            {copyState === "copied" ? t("chrome.devDetector.copied") : t("chrome.devDetector.copy")}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            iconText
            onClick={clearDevFindings}
            disabled={findings.length === 0}
          >
            <Icon name="trash" size={14} />
            {t("chrome.devDetector.clear")}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={closeDevDetectorPanel}
            title={t("chrome.devDetector.close")}
          >
            <Icon name="x" size={14} />
          </Button>
        </div>
      </header>

      {!enabled && (
        <p className="redux-dev-detector-hint">{t("chrome.devDetector.disabledHint")}</p>
      )}

      <div
        className="redux-dev-detector-filters"
        role="group"
        aria-label={t("chrome.devDetector.filter")}
      >
        {FILTERS.map((candidate) => {
          const count = candidate === "all" ? findings.length : counts[candidate];
          return (
            <Button
              key={candidate}
              variant={filter === candidate ? "solid" : "ghost"}
              size="sm"
              aria-pressed={filter === candidate}
              onClick={() => setFilter(candidate)}
            >
              {candidate === "all" ? t("chrome.devDetector.all") : t(kindKey(candidate))} {count}
            </Button>
          );
        })}
      </div>

      <Input
        className="redux-dev-detector-search"
        type="search"
        value={query}
        placeholder={t("chrome.devDetector.search")}
        aria-label={t("chrome.devDetector.search")}
        onChange={(event) => setQuery(event.currentTarget.value)}
      />

      <div className="redux-dev-detector-list">
        {shown.length === 0 ? (
          <p className="redux-dev-detector-empty">{t("chrome.devDetector.empty")}</p>
        ) : (
          shown.map((finding) => <FindingRow key={finding.id} finding={finding} />)
        )}
      </div>

      <footer className="redux-dev-detector-foot">
        {t("chrome.devDetector.total", { count: findings.length })}
        {copyState === "failed" && ` · ${t("chrome.devDetector.copyFailed")}`}
      </footer>
    </aside>
  );
}
