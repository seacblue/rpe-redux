/**
 * The chart issues pane: one row per detected chart issue, with a quiet locate
 * action revealed on hover or keyboard focus.
 *
 * Detection lives in the core monitor and is already incremental. This view only
 * formats the published snapshot and delegates the jump to the editor runtime.
 */
import { Fragment } from "react";
import { IconButton } from "../../../../../design/components/button/IconButton.tsx";
import { Divider } from "../../../../../design/components/divider/Divider.tsx";
import { ListRow } from "../../../../../design/components/list/ListRow.tsx";
import { EmptyState } from "../../../../../design/components/empty-state/EmptyState.tsx";
import type { ChartIssue } from "../../../../../core/edit/validation/eventIssueMonitor.ts";
import { EMPTY_CHART_ISSUE_SNAPSHOT } from "../../../../../core/edit/validation/eventIssueMonitor.ts";
import { eventKey } from "../../../../../core/edit/events/eventTracks.ts";
import { beatValue, formatBeat } from "../../../../../core/global/chart/timing/beat.ts";
import { useTranslation } from "../../../../../i18n/react.ts";
import type { MessageKey } from "../../../../../i18n/index.ts";
import {
  useEditorRuntime,
  useEditorRuntimeValue,
} from "../../workspace/runtime/composition/EditorRuntime.tsx";

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
 * Mount the issue list only while its pane owns the inspector.
 *
 * The monitor keeps scanning while another pane is open, but a hidden list has
 * no reason to re-render for every issue publication.
 */
export function IssuesPanel() {
  const active = useEditorRuntimeValue((current) => current.ui.activeInspector, "");
  return active === "issues" ? <IssuesContent /> : null;
}

/** The chart issue list with hover-only locate actions. */
function IssuesContent() {
  const { t } = useTranslation();
  const runtime = useEditorRuntime();
  const snapshot = useEditorRuntimeValue(
    (current) => current.providers.inspector.eventIssues.state,
    EMPTY_CHART_ISSUE_SNAPSHOT,
  );
  const issues = snapshot.issues;

  /**
   * Jump to one issue: force the matching single-line timeline, select its
   * affected object(s), seek to the issue, and repaint the timeline.
   */
  const locate = (issue: ChartIssue) => {
    if (!runtime) {
      return;
    }
    const session = runtime.getSession();
    const before = session.selectionState();
    session.focus = issue.target === "hold" ? "notes" : "events";
    session.marqueeSelection = null;
    session.lineIndex = issue.lineIndex;
    session.selection.clear();
    session.eventSelection.clear();
    if (issue.target === "hold") {
      session.selection = new Set([issue.firstEventIndex]);
    } else {
      session.eventLayer = issue.layer;
      session.eventSelection = new Set(
        issue.kind === "invalid-range"
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
    session.normalizeMultiLine();
    session.selectionRevision += 1;
    session.recordSelection(undefined, before, true);
    runtime.providers.inspector.showSingleTimeline(issue.target === "hold" ? "notes" : "events");
    runtime.providers.playback.seekBeat(beatValue(issue.startTime), true);
    runtime.timeline.changed();
    // Selecting the pair routes the inspector to the event or multi-edit pane.
    // Return to the issue list so the next row is still one click away.
    runtime.providers.inspector.activatePane("issues");
  };

  if (!issues.length) {
    return (
      <EmptyState
        icon="check"
        title={t("editorPanels.issues.emptyTitle")}
        description={t("editorPanels.issues.empty")}
      />
    );
  }

  return (
    <section className="event-issues-panel" data-event-issues>
      <div className="event-issues-list">
        {issues.map((issue, index) => {
          const line = issue.lineName || t("editorPanels.issues.line", { index: issue.lineIndex });
          const layer =
            issue.target === "hold"
              ? t("editorPanels.issues.notesLayer")
              : issue.extended
                ? t("editorPanels.issues.extendedLayer")
                : t("editorPanels.issues.layer", { value: issue.layer });
          const beat = t("editorPanels.issues.beat", {
            value: `${formatBeat(issue.startTime)} – ${formatBeat(issue.endTime)}`,
          });
          return (
            <Fragment key={issue.id}>
              {index > 0 && <Divider axis="x" />}
              <ListRow as="div" className="event-issue-row" data-issue-id={issue.id}>
                <div className="event-issue-main">
                  <strong className="event-issue-title">
                    {issue.target === "hold"
                      ? t("editorPanels.issues.holdTrack")
                      : trackLabel(issue.track, t)}
                    {", "}
                    {line}
                  </strong>
                  <span className="event-issue-meta">
                    {layer}
                    {", "}
                    {beat}
                  </span>
                </div>
                <IconButton
                  className="event-issue-locate"
                  icon="jump"
                  size={16}
                  variant="plain"
                  label={t("editorPanels.issues.locate")}
                  data-tip-title={t("editorPanels.issues.locate")}
                  data-tip-desc={t("editorPanels.issues.locateHint")}
                  onClick={() => locate(issue)}
                />
              </ListRow>
            </Fragment>
          );
        })}
      </div>
    </section>
  );
}
