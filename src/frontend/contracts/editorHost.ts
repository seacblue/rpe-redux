/**
 * Narrow host contract between the persistent chrome and the editor screen.
 *
 * Chrome renders the transport card, title bar, status bar, and rail whether or
 * not the editor is mounted. The editor therefore publishes only the values and
 * commands those surfaces read through this contract; chrome never imports the
 * editor workspace, its providers, or its controllers. The real `EditorRuntime`
 * satisfies `EditorHostRuntime` structurally, so the provider tree hands the
 * same object to both layers.
 */
import type { AudioTransport } from "../../core/media/audio.ts";
import type { EditorSession } from "../../core/edit/session/session.ts";
import type {
  TimelineArea,
  TimelineEventRect,
  TimelineNoteEntry,
  TimelinePoint,
} from "../../core/edit/timeline/types.ts";
import type { TimelineMarker } from "../../core/global/chart/timelineMarkers.ts";
import type { ContextMenuTarget } from "../../core/shell/registries/toolbar.ts";
import type { ValueCell } from "../../core/state/values.ts";
import type { LateBound } from "../../core/utils/lateBound.ts";
import type { ContextMenuSnapshot } from "../overlays/contextMenu/ContextMenuPopup.tsx";

export type { TimelineMarker };

/** The transport readouts the progress card prints. */
export interface EditorHostProgressSnapshot {
  time: number;
  duration: number;
  chartTime: string;
  beat: string;
  bpm: string;
}

/** Progress readouts together with the seek binding the editor installs. */
export interface EditorHostProgressState {
  readonly snapshot: ValueCell<EditorHostProgressSnapshot>;
  readonly seekHandler: LateBound<(seconds: number) => void>;
}

/** One marker with its transport position derived from the chart tempo. */
export type EditorHostTimelineMarkerPosition = TimelineMarker & {
  /** Audio time the marker seeks to, including the chart offset and clamping. */
  audioSeconds: number;
  /** Position along the scrubber, in the closed range `[0, 1]`. */
  ratio: number;
};

/** One bookmark tab on the left edge of the timeline. */
export interface EditorHostTimelineMarkerBookmark {
  id?: string;
  name: string;
  color?: string;
  beat: number;
  /** Vertical position inside the timeline field, in CSS pixels. */
  top: number;
  audioSeconds: number;
}

/** The timeline field geometry and the marker tabs drawn against its left edge. */
export interface EditorHostTimelineMarkerRail {
  left: number;
  top: number;
  height: number;
  markers: EditorHostTimelineMarkerBookmark[];
  onSeek(audioSeconds: number): void;
}

/** The marker geometry the transport view draws over the scrubber. */
export interface EditorHostTimelineMarkersSnapshot {
  markers: EditorHostTimelineMarkerPosition[];
  width: number;
  /** Audio length the scrubber spans, in seconds. */
  duration: number;
  /** `META.offset` in seconds: chart time plus this value is audio time. */
  offsetSeconds: number;
  /** Seeks to an audio time; the view has already applied the chart offset. */
  onSeek(audioSeconds: number): void;
}

/** The marker snapshot cell the editor controller fills. */
export interface EditorHostTimelineMarkersState {
  readonly snapshot: ValueCell<EditorHostTimelineMarkersSnapshot | null>;
  readonly rail: ValueCell<EditorHostTimelineMarkerRail | null>;
}

/** Tempo projection used by the transport and marker surfaces. */
export interface EditorHostTimelineTempo {
  beat(seconds: number, factor?: number): number;
  seconds(beat: number, factor?: number): number;
}

/** Timeline geometry the progress menu reads. */
export interface EditorHostTimeline {
  readonly viewport: {
    readonly tempo: EditorHostTimelineTempo;
  };
}

/** Timeline interaction the transport marker controller drives. */
export interface EditorHostTimelineInteraction {
  readonly notesCanvas: HTMLCanvasElement;
  readonly eventsCanvas: HTMLCanvasElement;
  readonly viewport: {
    readonly origin: number;
    readonly scale: number;
    readonly tempo: EditorHostTimelineTempo;
    point(event: PointerEvent, canvas?: HTMLCanvasElement): TimelinePoint;
    beatAt(vertical: number): number;
    timeAt(vertical: number): number;
    snappedBeat(vertical: number): number;
    verticalForLine(beat: number, lineIndex: number, height?: number, area?: TimelineArea): number;
    lineIndexAt(horizontal: number, width: number, area?: TimelineArea): number;
  };
  hit(position: TimelinePoint): TimelineNoteEntry | undefined;
  readonly gestures: {
    readonly layer: number;
    readonly eventInteraction: {
      hit(point: TimelinePoint): TimelineEventRect | undefined;
    };
  };
}

/** A timeline context-menu snapshot the marker controller publishes. */
export interface EditorHostTimelineMenuSnapshot extends ContextMenuSnapshot {
  surface: TimelineArea;
  /** The object under the pointer when the menu opened, if any. */
  target?: ContextMenuTarget;
}

/** Editor UI cells the chrome reads. */
export interface EditorHostUiState {
  readonly activeInspector: ValueCell<string>;
  readonly progress: EditorHostProgressState;
  readonly timelineMarkers: EditorHostTimelineMarkersState;
}

/** The editor services and cells the persistent chrome is allowed to read. */
export interface EditorHostRuntime {
  readonly session: EditorSession;
  getSession(): EditorSession;
  readonly audio: AudioTransport;
  readonly timeline: EditorHostTimeline;
  readonly ui: EditorHostUiState;
}
