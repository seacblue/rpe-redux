/** Resolves the exact timeline beat used by clipboard paste commands. */
import { toBeat, type Beat } from "../../../../../../core/global/chart/timing/beat.ts";
import type { TimelineGestures } from "./timelineGestures.ts";
import type { TimelineViewport } from "../viewport/timelineViewport.ts";

/** Timeline state needed to resolve a paste target beat. */
export interface ClipboardTargetSurface {
  gestures: Pick<TimelineGestures, "clipboardPointer">;
  viewport: Pick<TimelineViewport, "origin" | "snappedBeatTriple">;
}

/** Returns the snapped beat under the pointer, or the current origin without one. */
export function clipboardBeat(timeline: ClipboardTargetSurface): Beat {
  return timeline.gestures.clipboardPointer
    ? timeline.viewport.snappedBeatTriple(timeline.gestures.clipboardPointer.y)
    : toBeat(timeline.viewport.origin);
}
