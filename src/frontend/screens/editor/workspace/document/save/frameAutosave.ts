/**
 * Bridges a rendered frame timestamp to the session autosave clock. Recovery
 * policy and scheduling stay in core/edit and the save service; the frame
 * runner supplies only the tick.
 */
import type { Chart } from "../../../../../../core/global/chart/chart.ts";
import type { EditorSession } from "../../../../../../core/edit/session/session.ts";
import type { AutoSaveClock } from "../../../../../../core/edit/session/autosave.ts";

/** Live document state and the tick source for recovery autosave. */
export interface FrameAutosaveOptions {
  clock: Pick<AutoSaveClock, "tick">;
  session(): EditorSession;
  lastDraftDocument(): Chart | undefined;
  enabled(): boolean;
  seconds(): number;
}
/**
 * Keep recovery policy separate from painting; the frame runner only supplies its
 * tick.
 *
 * The clock's save callback decides which destinations it writes, so the tick
 * condition only has to say that the chart moved since the last draft.
 */
export function createFrameAutosave(options: FrameAutosaveOptions) {
  return {
    /** Feeds one frame timestamp to the autosave clock. */
    tick(timestamp: number): void {
      const session = options.session();
      options.clock.tick(
        timestamp,
        options.enabled(),
        options.seconds(),
        session.history.dirty && session.chart !== options.lastDraftDocument(),
      );
    },
  };
}
