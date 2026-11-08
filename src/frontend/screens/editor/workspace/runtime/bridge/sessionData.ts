/**
 * Prepares one session publication: synchronizes media, timing, placement, and
 * runtime settings before any UI reads the session. State stays with the
 * features; this module owns the order of the pre-publish work.
 */
import type { TempoEntry, TempoMap } from "../../../../../../core/global/chart/timing/tempo.ts";

import type { Timeline } from "../../timeline/surface/timeline.ts";

import { EditorSession } from "../../../../../../core/edit/session/session.ts";
import {
  editorMultiLineActive,
  editorMultiLineMerge,
  editorMultiLineMode,
} from "../../../../../../core/edit/state/publishedValues.ts";
import type { NotesInspectorState } from "../../../inspector/notes/model.ts";
import { applySessionRuntimeSettings } from "../../../../../../core/edit/bindings/runtimeSettings.ts";

/** Live editor handles the pre-publish synchronization reads. */
export interface SessionDataOptions {
  notes: NotesInspectorState;
  session(): EditorSession;
  timeline: Pick<Timeline, "cancelPlacement"> & {
    resetModeState(): void;
    gestures: Pick<Timeline["gestures"], "drag" | "layer">;
    viewport: Pick<Timeline["viewport"], "division" | "origin" | "setOrigin">;
  };
  tempo: { get(): TempoMap; setEntries(entries: readonly TempoEntry[]): void };
  hitSounds: Parameters<typeof applySessionRuntimeSettings>[1];
  currentBeat(): number;
  updateLineInfo(): void;
  syncMedia(): void;
}
/** The session and tempo map one publication renders. */
export interface SessionPresentationData {
  session: EditorSession;
  tempo: TempoMap;
}

/** Synchronize placement, timing and session settings before publishing UI. */
export function createSessionData(options: SessionDataOptions) {
  let placementContext: string | undefined;
  let timelineModeContext: string | undefined;
  let originSession: EditorSession | null = null;
  let originFactor: number | null = null;
  let tempoEntries = options.session().chart.BPMList;
  return {
    /** Synchronizes placement, timing, and settings, then returns the values to publish. */
    prepare(): SessionPresentationData {
      options.syncMedia();
      const session = options.session();
      const timeline = options.timeline;
      const nextTimelineModeContext = `${session.multiLineActive}:${session.multiLineMode}`;
      if (timelineModeContext !== nextTimelineModeContext) {
        timeline.resetModeState();
        timelineModeContext = nextTimelineModeContext;
        if (typeof window !== "undefined") {
          window.dispatchEvent(new Event("resize"));
        }
      }
      if (!timeline.gestures.drag) {
        options.notes.livePosition.set(null);
      }
      editorMultiLineActive.set(session.multiLineActive);
      editorMultiLineMode.set(session.multiLineMode);
      editorMultiLineMerge.set(session.multiLineMerge);
      const context = `${session.lineIndex}:${timeline.gestures.layer}`;
      if (placementContext !== context) {
        timeline.cancelPlacement();
        placementContext = context;
      }
      if (tempoEntries !== session.chart.BPMList) {
        tempoEntries = session.chart.BPMList;
        options.tempo.setEntries(tempoEntries);
      }
      const currentTempo = options.tempo.get();
      session.division = timeline.viewport.division;
      options.updateLineInfo();
      applySessionRuntimeSettings(session, options.hitSounds);
      // A publication is not a seek. Only a newly installed document follows
      // the playhead here; playback and explicit seeks own later origin updates,
      // so panel-driven publishes never pull a scrolled timeline back.
      const factor = session.line?.bpmfactor ?? 1;
      if (originSession !== session || originFactor === null) {
        originSession = session;
        timeline.viewport.setOrigin(options.currentBeat(), "session");
      } else if (factor !== originFactor) {
        // A line switch changes the factor that maps the origin's beat to
        // seconds. Re-express the same instant in the new factor so selecting
        // another line does not shift the visible time.
        timeline.viewport.setOrigin(
          currentTempo.beat(currentTempo.seconds(timeline.viewport.origin, originFactor), factor),
          "session",
        );
      }
      originFactor = factor;

      return { session, tempo: currentTempo };
    },
  };
}
