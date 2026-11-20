/** Owns the timeline-markers snapshot the runtime creates and the markers controller fills. */
import { createValue, type ValueCell } from "../../../core/state/values.ts";
import type { EditorHostTimelineMarkerRail } from "../../contracts/editorHost.ts";
import type { TimelineMarkersViewProps } from "./timelineMarkersContract.ts";

export type TimelineMarkersSnapshot = TimelineMarkersViewProps;

/** The markers snapshot, the timeline rail, and the callbacks their views invoke. */
export interface TimelineMarkersState {
  readonly snapshot: ValueCell<TimelineMarkersSnapshot | null>;
  readonly rail: ValueCell<EditorHostTimelineMarkerRail | null>;
}

/** Creates the empty markers cells the runtime publishes into. */
export function createTimelineMarkersState(): TimelineMarkersState {
  return Object.freeze({
    snapshot: createValue<TimelineMarkersSnapshot | null>({ initial: null }),
    rail: createValue<EditorHostTimelineMarkerRail | null>({ initial: null }),
  });
}
