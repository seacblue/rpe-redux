/**
 * The chart issues pane: a master switch, a type filter in the header, and one
 * row per published issue with a locate action revealed on hover or keyboard
 * focus.
 *
 * The filter button opens the same kind list the welcome library uses: one
 * checkbox per issue kind with its count, so a reader can narrow the pane to the
 * category they are working on. The master switch is the same setting value the
 * Chart issues page writes; turning it off stops the scan and clears the list.
 *
 * Detection runs in a worker; this view only formats the published snapshot and
 * delegates the jump to the editor runtime.
 */
import { Fragment, useCallback, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { Button } from "../../../../../design/components/button/Button.tsx";
import { IconButton } from "../../../../../design/components/button/IconButton.tsx";
import { Divider } from "../../../../../design/components/divider/Divider.tsx";
import { ListRow } from "../../../../../design/components/list/ListRow.tsx";
import { EmptyState } from "../../../../../design/components/empty-state/EmptyState.tsx";
import { Input } from "../../../../../design/components/input/Input.tsx";
import { useAnchoredPopover } from "../../../../../design/patterns/useAnchoredPopover.ts";
import { useAppRootHost } from "../../../../../design/patterns/portalHost.tsx";
import {
  CHART_ISSUE_KIND_DEFINITIONS,
  EMPTY_CHART_ISSUE_SNAPSHOT,
  chartIssueKindDefinition,
  type ChartIssue,
  type ChartIssueKind,
} from "../../../../../core/edit/validation/eventIssueMonitor.ts";
import { eventKey } from "../../../../../core/edit/events/eventTracks.ts";
import { beatValue } from "../../../../../core/global/chart/timing/beat.ts";
import { values } from "../../../../../core/state/values.ts";
import { useTranslation } from "../../../../../i18n/react.ts";
import type { MessageKey } from "../../../../../i18n/index.ts";
import { useSetting } from "../../../settings/useSetting.ts";
import { openSettings } from "../../../settings/settingsWindowController.ts";
import {
  useEditorRuntime,
  useEditorRuntimeValue,
} from "../../workspace/runtime/composition/EditorRuntime.tsx";
import { getEditorRegionSnapshot } from "../../workspace/runtime/commands/viewControls.ts";
import { issueJumpTimelineMode, issueTitleLine } from "./issuePresentation.ts";

/** Localized labels for event tracks the timeline already names elsewhere. */
const TRACK_LABEL_KEYS: Readonly<Record<string, MessageKey>> = {
  rotateEvents: "editorPanels.timeline.track.rotation",
  alphaEvents: "editorPanels.timeline.track.opacity",
  speedEvents: "editorPanels.timeline.track.speed",
  scaleXEvents: "editor.display.editorDisplay.trackScaleX",
  scaleYEvents: "editor.display.editorDisplay.trackScaleY",
  colorEvents: "editor.display.editorDisplay.trackColor",
  paintEvents: "editor.display.editorDisplay.trackShader",
  textEvents: "editor.display.editorDisplay.trackText",
  inclineEvents: "editorPanels.issues.trackIncline",
  gifEvents: "editorPanels.issues.trackGif",
};

/** Resolve one event track's display label. */
function trackLabel(track: string, translate: (key: MessageKey) => string): string {
  if (track === "moveXEvents") {
    return "X";
  }
  if (track === "moveYEvents") {
    return "Y";
  }
  const key = TRACK_LABEL_KEYS[track];
  return key ? translate(key) : track;
}

/**
 * Format one chart second as `m:ss.mmm`.
 *
 * A dense passage is often shorter than a second, so the millisecond part is
 * always shown rather than rounded away. Chart times are non-negative here: the
 * scan puts every beat back into the tempo map before reporting it.
 */
function formatChartTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return "0:00.000";
  }
  const total = Math.floor(seconds);
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  const millis = Math.round((seconds - total) * 1000);
  // Rounding 0.9995 s up must carry into the seconds, not print 0:00.1000.
  const carried = millis === 1000 ? 1 : 0;
  const shownSeconds = rest + carried;
  const shownMillis = carried ? 0 : millis;
  return `${minutes}:${String(shownSeconds).padStart(2, "0")}.${String(shownMillis).padStart(3, "0")}`;
}

/**
 * Which issue kinds are switched on, read as the settings page writes them.
 *
 * The filter lists only enabled kinds: a kind the author turned off is not a
 * hidden row waiting to be re-shown, it is a check that does not run at all.
 */
function useKindSwitches(): ReadonlyMap<ChartIssueKind, boolean> {
  const keys = useMemo(
    () => CHART_ISSUE_KIND_DEFINITIONS.map((definition) => definition.settingKey),
    [],
  );
  const subscribe = useCallback(
    (listener: () => void) => {
      const stops = keys
        .filter((key) => values.byId.has(key))
        .map((key) => values.byId.subscribe(key, listener));
      return () => {
        for (const stop of stops) {
          stop();
        }
      };
    },
    [keys],
  );
  const snapshot = useCallback(
    () =>
      keys.map((key) => (values.byId.has(key) ? values.byId.get(key) !== false : true)).join(","),
    [keys],
  );
  const state = useSyncExternalStore(subscribe, snapshot, snapshot);
  return useMemo(() => {
    const flags = state.split(",");
    const result = new Map<ChartIssueKind, boolean>();
    CHART_ISSUE_KIND_DEFINITIONS.forEach((definition, index) => {
      result.set(definition.kind, flags[index] !== "false");
    });
    return result;
  }, [state]);
}

/**
 * Mount the issue list only while its pane owns the inspector.
 *
 * The monitor keeps scanning while another pane is open, but a hidden list has
 * no reason to re-render for every publication.
 */
export function IssuesPanel() {
  const active = useEditorRuntimeValue((current) => current.ui.activeInspector, "");
  return active === "issues" ? <IssuesContent /> : null;
}

/** The chart issue list with its kind filter and hover-only locate actions. */
function IssuesContent() {
  const { t } = useTranslation();
  const runtime = useEditorRuntime();
  const snapshot = useEditorRuntimeValue(
    (current) => current.providers.inspector.eventIssues.state,
    EMPTY_CHART_ISSUE_SNAPSHOT,
  );
  const issues = snapshot.issues;
  const enabled = useSetting("chart-issues-enabled", true);
  const kindSwitches = useKindSwitches();
  /** Only enabled kinds exist: a disabled check has no row and no filter entry. */
  const enabledKinds = useMemo(
    () =>
      CHART_ISSUE_KIND_DEFINITIONS.filter(
        (definition) => kindSwitches.get(definition.kind) !== false,
      ),
    [kindSwitches],
  );
  /** An empty set means every enabled kind is shown. */
  const [hiddenKinds, setHiddenKinds] = useState<ReadonlySet<ChartIssueKind>>(() => new Set());
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLElement>(null);
  const host = useAppRootHost();
  const popover = useAnchoredPopover({
    open,
    anchor,
    panel,
    onClose: () => setOpen(false),
    align: "end",
    gap: 6,
    maxHeight: 480,
  });
  const counts = useMemo(() => {
    const totals = new Map<ChartIssueKind, number>();
    for (const issue of issues) {
      totals.set(issue.kind, (totals.get(issue.kind) ?? 0) + 1);
    }
    return totals;
  }, [issues]);
  const visible = useMemo(
    () =>
      issues.filter(
        (issue) => kindSwitches.get(issue.kind) !== false && !hiddenKinds.has(issue.kind),
      ),
    [hiddenKinds, issues, kindSwitches],
  );
  // Errors and warnings are different claims: one says the chart is broken, the
  // other says a target renderer may struggle. The summary reports them apart.
  const summary = useMemo(() => {
    let fatal = 0;
    let errors = 0;
    let warnings = 0;
    for (const issue of visible) {
      if (issue.severity === "fatal") {
        fatal += 1;
      } else if (issue.severity === "error") {
        errors += 1;
      } else {
        warnings += 1;
      }
    }
    return { fatal, errors, warnings };
  }, [visible]);
  // A hidden kind that is later switched off is not an active filter any more:
  // it left the list entirely, so the button must not claim a filter is on.
  const filterActive = enabledKinds.some((definition) => hiddenKinds.has(definition.kind));
  /** Toggle one kind in the filter without closing the popover. */
  const toggleKind = (kind: ChartIssueKind) => {
    setHiddenKinds((previous) => {
      const next = new Set(previous);
      if (next.has(kind)) {
        next.delete(kind);
      } else {
        next.add(kind);
      }
      return next;
    });
  };

  /**
   * Jump to one issue: force the matching single-line timeline, select its
   * affected object(s), seek to the issue, and repaint the timeline.
   */
  const locate = (issue: ChartIssue) => {
    if (!runtime) {
      return;
    }
    if (issue.target === "resource") {
      if (issue.resourceName) {
        runtime.providers.inspector.assetLibrary.selectAsset(issue.resourceName);
      }
      runtime.providers.inspector.activatePane("assets");
      return;
    }
    const session = runtime.getSession();
    const before = session.selectionState();
    // A density issue names a line and a time, not one object: there is nothing
    // to select, so the jump shows the line's note lane and seeks to the passage.
    const wholeLine = issue.target === "line";
    const noteTarget = wholeLine || issue.target === "hold" || issue.target === "note";
    session.focus = noteTarget ? "notes" : "events";
    session.marqueeSelection = null;
    session.lineIndex = issue.lineIndex;
    session.selection.clear();
    session.eventSelection.clear();
    if (wholeLine) {
      // Leave both selection sets empty; the seek below is the whole jump.
    } else if (noteTarget) {
      session.selection = new Set([issue.firstEventIndex]);
    } else {
      session.eventLayer = issue.layer;
      session.eventSelection = new Set(
        issue.kind !== "overlap"
          ? [eventKey(issue.track, issue.firstEventIndex)]
          : [
              eventKey(issue.track, issue.firstEventIndex),
              eventKey(issue.track, issue.secondEventIndex),
            ],
      );
    }
    session.multiEventSelection.clear();
    session.multiLineSelection.clear();
    session.multiLineEnabled = false;
    session.multiLineIndices = [];
    session.multiLineTokens = [];
    session.normalizeMultiLine();
    session.selectionRevision += 1;
    session.recordSelection(undefined, before, true);
    const timelineMode = issueJumpTimelineMode(
      noteTarget ? "notes" : "events",
      getEditorRegionSnapshot(),
    );
    if (timelineMode) {
      runtime.providers.inspector.showSingleTimeline(timelineMode);
    }
    runtime.providers.playback.seekBeat(beatValue(issue.startTime), true);
    runtime.timeline.changed();
    // Selecting the pair routes the inspector to the event or multi-edit pane.
    // Return to the issue list so the next row is still one click away.
    runtime.providers.inspector.activatePane("issues");
  };

  // A chart with no issues at all is the only case that drops the toolbar: once
  // something exists, the count and the filter stay put so a filter that hides
  // every row can always be undone from this pane.
  if (!enabled) {
    return (
      <EmptyState
        icon="shield"
        title={t("editorPanels.issues.disabledTitle")}
        description={t("editorPanels.issues.disabled")}
        actions={
          <Button variant="outlined" onClick={() => openSettings("editor.issues")}>
            {t("editorPanels.issues.openSettings")}
          </Button>
        }
      />
    );
  }
  if (!issues.length) {
    return (
      <EmptyState
        icon="check"
        title={t("editorPanels.issues.emptyTitle")}
        description={
          snapshot.status === "scanning"
            ? t("editorPanels.issues.scanning")
            : snapshot.status === "failed"
              ? t("editorPanels.issues.scanFailed")
              : t("editorPanels.issues.empty")
        }
      />
    );
  }

  const filterPanel = (
    <section
      ref={panel}
      className={`inspector-filter-popover${open ? " is-open" : ""}`}
      role="dialog"
      aria-label={t("editorPanels.issues.filter.label")}
      aria-hidden={!open}
      inert={!open}
      data-placement={popover.side}
      style={popover.style}
    >
      <div className="inspector-filter-list">
        {enabledKinds.map((definition) => {
          const kind = definition.kind;
          const rowId = `event-issue-filter-${kind}`;
          const label = t(definition.label);
          return (
            <label className="inspector-filter-row" htmlFor={rowId} key={kind}>
              <span className="inspector-filter-label">
                {label}
                <span className="inspector-filter-count">{counts.get(kind) ?? 0}</span>
              </span>
              <Input
                id={rowId}
                type="checkbox"
                checked={!hiddenKinds.has(kind)}
                aria-label={label}
                onChange={() => toggleKind(kind)}
              />
            </label>
          );
        })}
      </div>
    </section>
  );

  return (
    <section
      className="event-issues-panel"
      data-event-issues
      data-empty={visible.length ? undefined : "true"}
    >
      <div className="event-issue-filter-bar">
        <span className="event-issue-filter-summary">
          {summary.fatal > 0 && (
            <span className="event-issue-summary-fatal">
              {t("editorPanels.issues.summaryFatal", { count: summary.fatal })}
            </span>
          )}
          {summary.fatal > 0 && (summary.errors > 0 || summary.warnings > 0) && ", "}
          {summary.errors > 0 && (
            <span className="event-issue-summary-error">
              {t("editorPanels.issues.summaryErrors", { count: summary.errors })}
            </span>
          )}
          {summary.errors > 0 && summary.warnings > 0 && ", "}
          {summary.warnings > 0 && (
            <span className="event-issue-summary-warning">
              {t("editorPanels.issues.summaryWarnings", { count: summary.warnings })}
            </span>
          )}
        </span>
        <div className="event-issue-filter">
          {enabledKinds.length > 0 && (
            <>
              <IconButton
                ref={anchor}
                icon="filter"
                size="md"
                label={t("editorPanels.issues.filter.label")}
                active={open || filterActive}
                aria-haspopup="dialog"
                aria-expanded={open}
                onClick={() => setOpen((value) => !value)}
              />
              {host ? createPortal(filterPanel, host) : filterPanel}
            </>
          )}
        </div>
      </div>
      {visible.length ? (
        <div className="event-issues-list">
          {visible.map((issue, index) => {
            const definition = chartIssueKindDefinition(issue.kind);
            // "#3 Line name" names the judge line the jump lands on; the index is
            // what the line list shows, so it stays visible even without a name.
            const line = issue.lineName
              ? t("editorPanels.issues.lineNamed", {
                  index: issue.lineIndex,
                  name: issue.lineName,
                })
              : t("editorPanels.issues.line", { index: issue.lineIndex });
            // A clock range answers "where do I listen", which beats do not.
            const time = `${formatChartTime(issue.startSeconds)} – ${formatChartTime(issue.endSeconds)}`;
            // What the row is about, in one word: a density peak, a Hold, or the
            // named event track. The lane is only added when it is not obvious.
            const detail =
              issue.target === "resource"
                ? t("editorPanels.issues.missingResourceDetail", {
                    name: issue.resourceName ?? "",
                  })
                : issue.kind === "density"
                  ? t("editorPanels.issues.densityPeak", { count: issue.peak ?? 0 })
                  : issue.target === "hold"
                    ? t("editorPanels.issues.holdTrack")
                    : trackLabel(issue.track, t);
            const layer =
              issue.layer >= 0 && !issue.extended
                ? t("editorPanels.issues.layer", { value: issue.layer })
                : issue.extended
                  ? t("editorPanels.issues.extendedLayer")
                  : "";
            const titleLine = issueTitleLine(issue, line);
            const title =
              issue.target === "resource"
                ? t("editorPanels.issues.missingResourceTitle", {
                    kind: t(definition.label),
                  })
                : titleLine === null
                  ? t(definition.label)
                  : t("editorPanels.issues.title", {
                      kind: t(definition.label),
                      line: titleLine,
                    });
            return (
              <Fragment key={issue.id}>
                {index > 0 && <Divider axis="x" />}
                <ListRow
                  as="div"
                  className="event-issue-row"
                  data-issue-id={issue.id}
                  data-severity={issue.severity}
                >
                  <div className="event-issue-main">
                    <strong className="event-issue-title">{title}</strong>
                    <span className="event-issue-meta">
                      {detail}
                      {issue.target === "resource" ? "" : `${layer ? `, ${layer}` : ""}, ${time}`}
                    </span>
                  </div>
                  <IconButton
                    className="event-issue-locate"
                    icon="paperPlane"
                    size="md"
                    variant="plain"
                    label={t("editorPanels.issues.locate")}
                    data-tip-title={t("editorPanels.issues.locate")}
                    onClick={() => locate(issue)}
                  />
                </ListRow>
              </Fragment>
            );
          })}
        </div>
      ) : (
        // The chart has issues; the filter is hiding them. Saying so keeps the
        // toolbar reachable instead of showing an empty pane.
        <EmptyState
          icon="filter"
          title={t("editorPanels.issues.filter.emptyTitle")}
          description={t("editorPanels.issues.filter.empty")}
        />
      )}
    </section>
  );
}
