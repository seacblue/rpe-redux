/**
 * The timeline marker layer over the progress card.
 *
 * Markers are positioned from the published state and forwarded to seek when
 * clicked. The manager dialog for renaming, retiming, recolouring, and removing
 * them lives beside the strip.
 */
import type { CSSProperties } from "react";
import type { JudgeLineEvent } from "../../../core/global/chart/chart.ts";
import {
  markerAudioRatio,
  markerAudioSeconds,
  normalizeMarkerColor,
  readTimelineMarkers,
} from "../../../core/global/chart/timelineMarkers.ts";
import { Button } from "../../../design/components/button/Button.tsx";
import { t } from "../../../i18n/index.ts";
import type { EditorSession } from "../../../core/edit/session/session.ts";
import {
  eventRefsFromSelection,
  eventSelectionForContextMenu,
  eventTargetFromRefs,
  noteSelectionForContextMenu,
  noteTargetFromRefs,
  type EventSelectionKeyRef,
  type NoteSelectionRef,
} from "../../../core/edit/timeline/contextMenuTarget.ts";
import type { ContextMenuTarget } from "../../../core/shell/registries/toolbar.ts";
import type {
  EditorHostTimelineInteraction,
  EditorHostTimelineMenuSnapshot,
} from "../../contracts/editorHost.ts";
import type { ContextMenuAction } from "../../overlays/contextMenu/ContextMenuPopup.tsx";
import { MarkerManagerDialog } from "./MarkerManagerDialog.tsx";
import type { TimelineMarkersState } from "./timelineMarkersState.ts";
import type { TimelineMarker, TimelineMarkersViewProps } from "./timelineMarkersContract.ts";

/** Renders one button per marker at its position along the scrubber. */
export function TimelineMarkersView({
  markers,
  width,
  duration,
  offsetSeconds,
  onSeek,
}: TimelineMarkersViewProps) {
  return (
    <>
      {markers.map((marker) => {
        const name = String(marker.name).trim();
        const audioSeconds = markerAudioSeconds(Number(marker.time), offsetSeconds, duration);
        const ratio = markerAudioRatio(Number(marker.time), offsetSeconds, duration);
        if (!Number.isFinite(ratio) || ratio < 0 || ratio > 1) {
          return null;
        }
        const color = normalizeMarkerColor(marker.color);
        const style: CSSProperties & { "--marker-color"?: string } = {
          left: `${ratio * width}px`,
        };
        if (color) {
          style["--marker-color"] = color;
        }
        return (
          <Button
            key={marker.id ?? `${name}:${marker.time}`}
            variant="plain"
            className="timeline-marker"
            data-marker-id={marker.id}
            data-marker-time={String(marker.time)}
            data-marker-name={name}
            data-tip-title={`${marker.name}, ${Number(marker.time).toFixed(3)} s`}
            aria-label={`${marker.name}, ${Number(marker.time).toFixed(3)} s`}
            style={style}
            onClick={() => onSeek(audioSeconds)}
          >
            <span className="timeline-marker-bar" aria-hidden="true" />
            <span className="timeline-marker-label">{name}</span>
          </Button>
        );
      })}
      <MarkerManagerDialog />
    </>
  );
}

/** Hosts, session accessors, and callbacks the markers controller depends on. */
interface TimelineMarkersOptions {
  root: HTMLElement;
  scrubber: HTMLInputElement;
  notesCanvas: HTMLCanvasElement;
  getSession(): EditorSession;
  timeline: EditorHostTimelineInteraction;
  duration(): number;
  offsetSeconds(): number;
  seek(audioSeconds: number): void;
  splitTrajectory(event: JudgeLineEvent | null, lineIndex: number, layer: number): void;
  state: TimelineMarkersState;
  setTimelineMenu(snapshot: EditorHostTimelineMenuSnapshot | null): void;
}

/** Notes selected in the current session, including multi-line panels. */
function selectedNoteRefs(session: EditorSession): NoteSelectionRef[] {
  if (session.multiLineActive && session.multiLineMode === "notes") {
    return [...session.multiLineSelection].flatMap(([lineIndex, indices]) =>
      [...indices].map((index) => ({ lineIndex, index })),
    );
  }
  return [...session.selection].map((index) => ({ lineIndex: session.lineIndex, index }));
}

/** Events selected in the current session, including multi-line panels. */
function selectedEventKeys(session: EditorSession): EventSelectionKeyRef[] {
  if (session.multiLineActive && session.multiLineMode === "events") {
    return [...session.multiEventSelection].flatMap(([lineIndex, keys]) =>
      [...keys].map((key) => ({ lineIndex, key })),
    );
  }
  return [...session.eventSelection].map((key) => ({ lineIndex: session.lineIndex, key }));
}

/** Apply one right-press note selection to the live session. */
function applyNoteSelection(
  session: EditorSession,
  update: ReturnType<typeof noteSelectionForContextMenu>,
  clearEvents: boolean,
): void {
  session.lineIndex = update.lineIndex;
  session.normalizeMultiLine();
  session.selection = update.selection;
  if (session.multiLineActive) {
    session.multiLineSelection.clear();
    for (const [lineIndex, indices] of update.multiLineSelection) {
      session.multiLineSelection.set(lineIndex, indices);
    }
  }
  session.selectionRevision += 1;
  session.focus = "notes";
  if (clearEvents) {
    session.eventSelection.clear();
  }
  session.notify();
}

/** Apply one right-press event selection to the live session. */
function applyEventSelection(
  session: EditorSession,
  update: ReturnType<typeof eventSelectionForContextMenu>,
  layer: number,
  clearNotes: boolean,
): void {
  session.eventSelection = update.selection;
  if (session.multiLineActive) {
    session.multiEventSelection.clear();
    for (const [lineIndex, keys] of update.multiLineSelection) {
      session.multiEventSelection.set(lineIndex, keys);
    }
  }
  session.eventLayer = layer;
  session.focus = "events";
  if (clearNotes) {
    session.selection.clear();
  }
  session.notify();
}

/** Owns the progress marker view and publishes marker geometry to it. */
export class TimelineMarkers {
  private options: TimelineMarkersOptions;
  private markersSource: unknown;
  private markerCache: TimelineMarker[] = [];
  private publishedMarkers: TimelineMarker[] | null = null;
  private publishedWidth = -1;
  private publishedDuration = -1;
  private publishedOffsetSeconds = Number.NaN;

  /** Binds the controller to its hosts and session accessors. */
  constructor(options: TimelineMarkersOptions) {
    this.options = options;
  }

  /** Publishes marker geometry when the markers, host width, duration, or offset changed. */
  render(): void {
    const { root, scrubber, duration, seek, offsetSeconds } = this.options;
    const markers = this.markers();
    const totalDuration = Math.max(0.001, duration());
    const rawOffset = offsetSeconds();
    const offset = Number.isFinite(rawOffset) ? rawOffset : 0;
    const width = root.clientWidth || scrubber.clientWidth || 1;
    // Selection and event clicks leave the markers unchanged, so an identical
    // snapshot is not republished. A changed offset moves every marker, so it
    // is part of the identity too.
    if (
      markers === this.publishedMarkers &&
      width === this.publishedWidth &&
      totalDuration === this.publishedDuration &&
      offset === this.publishedOffsetSeconds
    ) {
      return;
    }
    this.publishedMarkers = markers;
    this.publishedWidth = width;
    this.publishedDuration = totalDuration;
    this.publishedOffsetSeconds = offset;
    this.options.state.snapshot.set({
      markers,
      width,
      duration: totalDuration,
      offsetSeconds: offset,
      onSeek: (audioSeconds) => seek(audioSeconds),
    });
  }

  /** Opens the timeline menu for the events or notes canvas. */
  openContextMenu(event: MouseEvent, canvas: HTMLCanvasElement | null = null): void {
    const { timeline, getSession } = this.options;
    const point = canvas ? timeline.viewport.point(event as PointerEvent, canvas) : null;
    const session = getSession();
    const surface = canvas === timeline.eventsCanvas ? "events" : "notes";
    const modifiers = { ctrl: event.ctrlKey, shift: event.shiftKey };
    const beat = point ? timeline.viewport.beatAt(point.y) : 0;
    const chartSeconds = point ? timeline.viewport.timeAt(point.y) : 0;
    let target: ContextMenuTarget | undefined;

    if (surface === "notes" && point) {
      const hit = timeline.hit(point);
      if (hit) {
        const update = noteSelectionForContextMenu(
          {
            lineIndex: session.lineIndex,
            selection: session.selection,
            multiLineActive: session.multiLineActive,
            multiLineSelection: session.multiLineSelection,
          },
          { lineIndex: hit.lineIndex, index: hit.index },
          modifiers,
        );
        if (update.changed) {
          applyNoteSelection(session, update, !modifiers.ctrl && !modifiers.shift);
        }
        target = noteTargetFromRefs(
          session.chart,
          selectedNoteRefs(session),
          hit.lineIndex,
          beat,
          chartSeconds,
        );
      }
    } else if (surface === "events" && point) {
      const rectangle = timeline.gestures.eventInteraction.hit(point);
      if (rectangle) {
        const lineIndex =
          rectangle.lineIndex ??
          timeline.viewport.lineIndexAt(point.x, timeline.eventsCanvas.clientWidth, "events");
        const update = eventSelectionForContextMenu(
          {
            lineIndex: session.lineIndex,
            selection: session.eventSelection,
            multiLineActive: session.multiLineActive,
            multiLineSelection: session.multiEventSelection,
          },
          { lineIndex, key: `${rectangle.type}:${rectangle.index}` },
          modifiers,
        );
        if (update.changed) {
          applyEventSelection(
            session,
            update,
            timeline.gestures.layer,
            !modifiers.ctrl && !modifiers.shift,
          );
        }
        target = eventTargetFromRefs(
          eventRefsFromSelection(selectedEventKeys(session), timeline.gestures.layer),
          beat,
          chartSeconds,
        );
      }
    }

    const selections = selectedEventKeys(session);
    const selection = selections.length === 1 ? selections[0] : null;
    const [type, index] = selection?.key.split(":") ?? [];
    const selected =
      type === "moveXEvents" && selection
        ? (session.chart.judgeLineList?.[selection.lineIndex]?.eventLayers?.[
            timeline.gestures.layer
          ]?.moveXEvents?.[Number(index)] ?? null)
        : null;
    const actions: ContextMenuAction[] = [];
    if (surface === "events" && selection && selected?.trajectory) {
      actions.push({
        id: "trajectory-context-split",
        label: t("workspace.dialogs.splitTrajectory"),
        run: () =>
          this.options.splitTrajectory(selected, selection.lineIndex, timeline.gestures.layer),
      });
    }
    this.options.setTimelineMenu({
      owner: this.options.notesCanvas.isConnected ? this.options.notesCanvas : null,
      x: event.clientX,
      y: event.clientY,
      surface,
      target,
      actions,
    });
  }

  /** Takes the timeline menu down. */
  closeContextMenu(): void {
    this.options.setTimelineMenu(null);
  }

  /** Closes the menu and withdraws the published markers. */
  dispose(): void {
    this.closeContextMenu();
    this.options.state.snapshot.set(null);
  }

  /** Returns the session's canonical markers, cached until the raw array changes. */
  private markers(): TimelineMarker[] {
    const chart = this.options.getSession().chart;
    const markers = chart.markers;
    if (markers === this.markersSource) {
      return this.markerCache;
    }
    this.markersSource = markers;
    this.markerCache = readTimelineMarkers(chart);
    return this.markerCache;
  }
}
