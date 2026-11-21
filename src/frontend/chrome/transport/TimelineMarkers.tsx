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
  addTimelineMarker,
  createTimelineMarkerId,
  markerAudioRatio,
  markerAudioSeconds,
  normalizeMarkerColor,
  readTimelineMarkers,
  writeTimelineMarkers,
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
  EditorHostTimelineMarkerRail,
  EditorHostTimelineMenuSnapshot,
} from "../../contracts/editorHost.ts";
import type { ContextMenuAction } from "../../overlays/contextMenu/ContextMenuPopup.tsx";
import { MarkerManagerDialog } from "./MarkerManagerDialog.tsx";
import type { TimelineMarkersState } from "./timelineMarkersState.ts";
import type { TimelineMarker, TimelineMarkersViewProps } from "./timelineMarkersContract.ts";

/** Chart seconds for one marker beat; invalid tempo data falls back to zero. */
function chartSecondsAtBeat(
  tempo: EditorHostTimelineInteraction["viewport"]["tempo"],
  beat: number,
): number {
  try {
    const seconds = tempo.seconds(beat, 1);
    return Number.isFinite(seconds) ? seconds : 0;
  } catch {
    return 0;
  }
}

/** Renders one button per marker at its position along the scrubber. */
export function TimelineMarkersView({ markers, width, onSeek }: TimelineMarkersViewProps) {
  return (
    <>
      {markers.map((marker) => {
        const name = String(marker.name).trim();
        const ratio = Number(marker.ratio);
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
        const label = t("chrome.transport.markerManager.markerLabel", {
          name,
          beat: Number(marker.beat).toFixed(3),
        });
        return (
          <Button
            key={marker.id ?? `${name}:${marker.beat}`}
            variant="plain"
            className="timeline-marker"
            data-marker-id={marker.id}
            data-marker-beat={String(marker.beat)}
            data-marker-name={name}
            data-tip-title={label}
            aria-label={label}
            style={style}
            onClick={() => onSeek(marker.audioSeconds)}
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
  private markersTempo: unknown;
  private markerCache: TimelineMarker[] = [];
  private publishedMarkers: readonly TimelineMarker[] | null = null;
  private publishedTempo: unknown;
  private publishedWidth = -1;
  private publishedDuration = -1;
  private publishedOffsetSeconds = Number.NaN;
  private publishedRailTempo: unknown;
  private publishedRailKey = "";
  private readonly seekTo: (audioSeconds: number) => void;

  /** Binds the controller to its hosts and session accessors. */
  constructor(options: TimelineMarkersOptions) {
    this.options = options;
    this.seekTo = (audioSeconds) => options.seek(audioSeconds);
  }

  /** Publishes transport positions and timeline bookmarks when their inputs changed. */
  render(): void {
    const { timeline } = this.options;
    const markers = this.markers();
    const tempo = timeline.viewport.tempo;
    const totalDuration = Math.max(0.001, this.options.duration());
    const rawOffset = this.options.offsetSeconds();
    const offset = Number.isFinite(rawOffset) ? rawOffset : 0;
    this.renderTransport(markers, tempo, totalDuration, offset);
    this.renderRail(markers, tempo, totalDuration, offset);
  }

  /** Publishes one marker button per beat along the scrubber. */
  private renderTransport(
    markers: readonly TimelineMarker[],
    tempo: EditorHostTimelineInteraction["viewport"]["tempo"],
    totalDuration: number,
    offset: number,
  ): void {
    const { root, scrubber, state } = this.options;
    const width = root.clientWidth || scrubber.clientWidth || 1;
    // Selection and event clicks leave the markers unchanged, so an identical
    // snapshot is not republished. A changed offset or tempo moves every marker,
    // so both are part of the identity too.
    if (
      markers === this.publishedMarkers &&
      tempo === this.publishedTempo &&
      width === this.publishedWidth &&
      totalDuration === this.publishedDuration &&
      offset === this.publishedOffsetSeconds
    ) {
      return;
    }
    this.publishedMarkers = markers;
    this.publishedTempo = tempo;
    this.publishedWidth = width;
    this.publishedDuration = totalDuration;
    this.publishedOffsetSeconds = offset;
    const positions = markers.map((marker) => {
      const chartSeconds = chartSecondsAtBeat(tempo, marker.beat);
      return {
        ...marker,
        audioSeconds: markerAudioSeconds(chartSeconds, offset, totalDuration),
        ratio: markerAudioRatio(chartSeconds, offset, totalDuration),
      };
    });
    state.snapshot.set({
      markers: positions,
      width,
      duration: totalDuration,
      offsetSeconds: offset,
      onSeek: this.seekTo,
    });
  }

  /** Publishes bookmark tabs at the markers' rows on the timeline's left edge. */
  private renderRail(
    markers: readonly TimelineMarker[],
    tempo: EditorHostTimelineInteraction["viewport"]["tempo"],
    totalDuration: number,
    offset: number,
  ): void {
    const { timeline, getSession, state } = this.options;
    const session = getSession();
    const notes = timeline.notesCanvas;
    const events = timeline.eventsCanvas;
    const notesVisible = notes.clientHeight > 0;
    const canvas = notesVisible ? notes : events;
    const area = notesVisible ? "notes" : "events";
    const height = canvas.clientHeight;
    const left = canvas.offsetLeft;
    const top = canvas.offsetTop;
    const lineIndex = session.lineIndex;
    const factor = session.line?.bpmfactor ?? 1;
    const signature = [
      markers
        .map((marker) => `${marker.id ?? ""}:${marker.beat}:${marker.name}:${marker.color ?? ""}`)
        .join("|"),
      left,
      top,
      height,
      lineIndex,
      factor,
      area,
      timeline.viewport.origin,
      timeline.viewport.scale,
      offset,
      totalDuration,
    ].join(";");
    // Viewport changes repaint the canvas without changing the chart, so the
    // rail follows its own geometry key and leaves the transport snapshot alone.
    if (tempo === this.publishedRailTempo && signature === this.publishedRailKey) {
      return;
    }
    this.publishedRailTempo = tempo;
    this.publishedRailKey = signature;
    const items: EditorHostTimelineMarkerRail["markers"] = [];
    if (height > 0) {
      for (const marker of markers) {
        let markerTop: number;
        try {
          markerTop = timeline.viewport.verticalForLine(marker.beat, lineIndex, height, area);
        } catch {
          continue;
        }
        if (!Number.isFinite(markerTop) || markerTop < -8 || markerTop > height + 8) {
          continue;
        }
        const chartSeconds = chartSecondsAtBeat(tempo, marker.beat);
        items.push({
          id: marker.id,
          name: marker.name,
          color: marker.color,
          beat: marker.beat,
          top: markerTop,
          audioSeconds: markerAudioSeconds(chartSeconds, offset, totalDuration),
        });
      }
    }
    state.rail.set(
      items.length > 0 ? { left, top, height, markers: items, onSeek: this.seekTo } : null,
    );
  }

  /** Opens the timeline menu for the events or notes canvas. */
  openContextMenu(event: MouseEvent, canvas: HTMLCanvasElement | null = null): void {
    const { timeline, getSession } = this.options;
    const point = canvas ? timeline.viewport.point(event as PointerEvent, canvas) : null;
    const session = getSession();
    const surface = canvas === timeline.eventsCanvas ? "events" : "notes";
    const modifiers = { ctrl: event.ctrlKey, shift: event.shiftKey };
    const beat = point ? timeline.viewport.beatAt(point.y) : 0;
    const markerBeat = point ? timeline.viewport.snappedBeat(point.y) : 0;
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
          eventRefsFromSelection(
            session.chart,
            selectedEventKeys(session),
            timeline.gestures.layer,
          ),
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
    const actions: ContextMenuAction[] = [
      {
        id: "timeline-add-marker",
        label: t("workspace.dialogs.addMarkerHere"),
        icon: "clock",
        enabled: () => session.editable && Boolean(point),
        run: () => this.addMarkerAt(markerBeat),
      },
    ];
    if (surface === "events" && selection && selected?.trajectory) {
      actions.push({
        id: "trajectory-context-split",
        label: t("workspace.dialogs.splitTrajectory"),
        enabled: () => session.editable,
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

  /** Adds a marker at one chart beat through the session's normal history. */
  private addMarkerAt(beat: number): void {
    const session = this.options.getSession();
    if (!session.editable) {
      return;
    }
    const current = readTimelineMarkers(session.chart, this.options.timeline.viewport.tempo);
    const position = Math.max(0, Number.isFinite(beat) ? Number(beat.toFixed(3)) : 0);
    const marker: TimelineMarker = {
      id: createTimelineMarkerId(),
      beat: position,
      name: t("chrome.transport.markerManager.defaultName", { index: current.length + 1 }),
    };
    const next = addTimelineMarker(current, marker);
    session.commitChart(
      t("workspace.dialogs.addMarker"),
      writeTimelineMarkers(session.chart, next),
      session.selectionState(),
      undefined,
      { normalized: true },
    );
  }

  /** Takes the timeline menu down. */
  closeContextMenu(): void {
    this.options.setTimelineMenu(null);
  }

  /** Closes the menu and withdraws the published markers and bookmarks. */
  dispose(): void {
    this.closeContextMenu();
    this.options.state.snapshot.set(null);
    this.options.state.rail.set(null);
  }

  /** Returns the session's canonical markers, cached until the raw array or tempo changes. */
  private markers(): TimelineMarker[] {
    const chart = this.options.getSession().chart;
    const markers = chart.markers;
    const tempo = this.options.timeline.viewport.tempo;
    if (markers === this.markersSource && tempo === this.markersTempo) {
      return this.markerCache;
    }
    this.markersSource = markers;
    this.markersTempo = tempo;
    this.markerCache = readTimelineMarkers(chart, tempo);
    return this.markerCache;
  }
}
