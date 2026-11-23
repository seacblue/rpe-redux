/**
 * Builds the timeline event command that either selects an existing event or arms
 * placement of a new one at the current beat.
 *
 * It updates the session layer and event focus plus the status notification;
 * event placement and storage remain in core event commands.
 */
import { t } from "../../../../../../i18n/index.ts";
import { eventKey } from "../../../../../../core/edit/events/eventTracks.ts";
import { rememberEventSelection } from "../../../../../../core/edit/selection/eventSelectionAnchor.ts";
import type { EditorSession } from "../../../../../../core/edit/session/session.ts";
import type { TimelineGestures } from "../interaction/timelineGestures.ts";
import type { TimelineCache } from "../drawing/timelineCache.ts";
import { eventTypesForLine, EXTENDED_EVENT_LAYER } from "../drawing/tracks.ts";

export interface TimelineEventActionOptions {
  getSession(): EditorSession;
  timeline: {
    gestures: Pick<
      TimelineGestures,
      "eventPlacementType" | "extended" | "layer" | "eventInteraction"
    >;
    cache: Pick<TimelineCache, "invalidateEvents">;
  };
  currentBeat(): number;
  activateEventsPane(): void;
  notify(message: string, severity?: string): void;
}

/** Selects an existing timeline event or prepares placement of a new one. */
export function createTimelineEventAction({
  getSession,
  timeline,
  currentBeat,
  activateEventsPane,
  notify,
}: TimelineEventActionOptions) {
  return (type: string, index: number | null, beat = currentBeat()): void => {
    const session = getSession();
    if (!session.line) {
      notify(t("editor.dialogs.lineDialog.needLine"), "warning");
      return;
    }
    timeline.gestures.eventPlacementType = type;
    // Scale and activation columns on a noise line belong to its base field,
    // even though some of them share storage with the special layer.
    if (!eventTypesForLine(session.line, false).includes(type)) {
      timeline.gestures.layer = EXTENDED_EVENT_LAYER;
    } else if (timeline.gestures.extended) {
      timeline.gestures.layer = 0;
    }
    timeline.cache.invalidateEvents();
    session.focus = "events";
    session.selection.clear();
    activateEventsPane();
    if (index !== null) {
      const key = eventKey(type, index);
      session.eventSelection = new Set([key]);
      rememberEventSelection(session, session.lineIndex, key);
      session.notify();
      return;
    }
    timeline.gestures.eventInteraction.place(type, beat);
    notify(
      timeline.gestures.eventInteraction.pending
        ? t("editor.app.status.eventPlacementPending")
        : t("editor.app.status.eventPlaced"),
      timeline.gestures.eventInteraction.pending ? "info" : "success",
    );
  };
}
