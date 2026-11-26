/**
 * Renders the timeline canvas stack and overview strips, and binds wheel, pointer,
 * and context-menu input to the runtime bindings.
 *
 * DOM structure and listener attachment live here; painting and gesture behavior
 * belong to the timeline engine.
 */
import {
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type Ref,
} from "react";
import {
  editorMultiLineActive,
  editorMultiLineMode,
} from "../../../../../../core/edit/state/publishedValues.ts";
import { t } from "../../../../../../i18n/index.ts";
import { mergeRefs } from "../../../../../platform/mergeRefs.ts";
import { onboardingAnchorRef } from "../../../../../onboarding/anchors.ts";
import { useSetting } from "../../../../settings/useSetting.ts";
import { useEditorRuntimeValue } from "../../runtime/composition/EditorRuntime.tsx";
import { useTimelineRuntime } from "../../runtime/providers/TimelineProvider.tsx";
import { useTimelineDomSurface } from "./TimelineDomSurface.tsx";
import type { TimelinePointerCanvasBindings, TimelineStripBindings } from "./timelineBindings.ts";
import { NoteTimelineRangeOverlay } from "../notes/NoteTimelineRangeOverlay.tsx";
import type { MultiLineScrollSnapshot } from "../multiLine/multiLineScrollBinding.ts";
import { TimelineMarkerRail } from "./TimelineMarkerRail.tsx";

/** One overview strip canvas with its pointer bindings. */
function OverviewStrip({
  name,
  bindings,
  surfaceRef,
  hidden,
}: {
  name: string;
  bindings: TimelineStripBindings | undefined;
  surfaceRef: Ref<HTMLCanvasElement>;
  hidden: boolean;
}) {
  return (
    <canvas
      ref={surfaceRef}
      className={`timeline-strip timeline-${name}`}
      hidden={hidden}
      aria-hidden="true"
      onPointerDown={(event) => bindings?.pointerDown(event.nativeEvent)}
      onPointerMove={(event) => bindings?.pointerMove(event.nativeEvent)}
      onPointerUp={(event) => bindings?.pointerUp(event.nativeEvent)}
      onPointerCancel={(event) => bindings?.pointerUp(event.nativeEvent)}
      onPointerLeave={() => bindings?.pointerLeave()}
    />
  );
}

/** One focusable editing canvas wired to the timeline bindings. */
function EditingCanvas({
  id,
  bindings,
  canvasRef,
  surfaceRef,
}: {
  id: string;
  bindings: TimelinePointerCanvasBindings | undefined;
  canvasRef: Ref<HTMLCanvasElement>;
  surfaceRef: Ref<HTMLCanvasElement>;
}) {
  return (
    <canvas
      id={id}
      className={`timeline-${id}`}
      // The canvas may still receive focus after pointer interaction, but it
      // must not become a stop in sequential Tab navigation.
      tabIndex={-1}
      role="region"
      aria-label={t(
        id === "notes" ? "editorPanels.timeline.notesCanvas" : "editorPanels.timeline.eventsCanvas",
      )}
      ref={mergeRefs(canvasRef, surfaceRef, onboardingAnchorRef(id))}
      onContextMenu={(event) => bindings?.contextMenu(event.nativeEvent)}
      onPointerMove={(event) => bindings?.pointerMove(event.nativeEvent)}
      onPointerLeave={() => bindings?.pointerLeave()}
      onPointerDown={(event) => bindings?.pointerDown(event.nativeEvent)}
      onPointerUp={(event) => bindings?.pointerUp(event.nativeEvent)}
      onPointerCancel={() => bindings?.pointerCancel()}
    />
  );
}

/** A rendering-only canvas layer: backdrop, playhead, or GPU batch. */
function BatchCanvas({
  className,
  surfaceRef,
}: {
  className: string;
  surfaceRef: Ref<HTMLCanvasElement>;
}) {
  return <canvas className={className} ref={surfaceRef} aria-hidden="true" />;
}

const FALLBACK_MULTI_LINE_SNAPSHOT = { visible: true, max: "0", value: "0" } as const;
const EMPTY_SUBSCRIBE = () => () => {};
const getEmptyMultiLineSnapshot = () => FALLBACK_MULTI_LINE_SNAPSHOT;

/** Render CSS borders at the calculated left and right edge of every visible panel. */
function TimelinePanelEdges({
  notesCanvas,
  eventsCanvas,
}: {
  notesCanvas: { readonly current: HTMLCanvasElement | null };
  eventsCanvas: { readonly current: HTMLCanvasElement | null };
}) {
  const runtime = useTimelineRuntime();
  const active = useSyncExternalStore(
    editorMultiLineActive.subscribe,
    editorMultiLineActive.get,
    editorMultiLineActive.get,
  );
  const mode = useSyncExternalStore(
    editorMultiLineMode.subscribe,
    editorMultiLineMode.get,
    editorMultiLineMode.get,
  );
  const scrollState = runtime?.multiLineScrollState;
  useSyncExternalStore<MultiLineScrollSnapshot>(
    scrollState?.snapshot.subscribe ?? EMPTY_SUBSCRIBE,
    scrollState?.snapshot.get ?? getEmptyMultiLineSnapshot,
    scrollState?.snapshot.get ?? getEmptyMultiLineSnapshot,
  );
  const [canvasWidths, setCanvasWidths] = useState({ notes: 0, events: 0 });

  useLayoutEffect(() => {
    const canvases = [notesCanvas.current, eventsCanvas.current].filter(
      (canvas): canvas is HTMLCanvasElement => canvas !== null,
    );
    if (canvases.length === 0) {
      return;
    }
    const update = () =>
      setCanvasWidths({
        notes: notesCanvas.current?.clientWidth ?? 0,
        events: eventsCanvas.current?.clientWidth ?? 0,
      });
    update();
    const observer = new ResizeObserver(update);
    canvases.forEach((canvas) => observer.observe(canvas));
    return () => observer.disconnect();
  }, [notesCanvas, eventsCanvas, mode]);

  const area =
    canvasWidths.events > 0 && canvasWidths.notes === 0
      ? "events"
      : canvasWidths.notes > 0 && canvasWidths.events === 0
        ? "notes"
        : mode;
  const width = canvasWidths[area];
  if (!active || !runtime || !width) {
    return null;
  }
  const timeline = runtime.timeline;
  const panelCount = timeline.viewport.panelCount(area);
  const panelWidth = timeline.viewport.panelWidth(width, area);
  const panelGap = timeline.viewport.panelGap(width, area);
  const panelStride = panelWidth + panelGap;
  const offset = timeline.viewport.multiLineViewportOffset(width, area);
  const [firstPanel, lastPanel] = timeline.viewport.visiblePanelRange(width, area);
  if (panelCount < 1 || panelWidth <= 0 || panelStride <= 0 || firstPanel > lastPanel) {
    return null;
  }

  const edges = [];
  for (let panel = firstPanel; panel <= lastPanel; panel += 1) {
    const left = panel * panelStride - offset;
    if (left >= width || left + panelWidth <= 0) {
      continue;
    }
    edges.push(
      <div
        className="timeline-panel-edge"
        key={panel}
        style={
          {
            "--timeline-panel-left": `${left}px`,
            "--timeline-panel-width": `${panelWidth}px`,
          } as CSSProperties
        }
      />,
    );
  }
  return (
    <div className="timeline-panel-edges" aria-hidden="true">
      {edges}
    </div>
  );
}

/** Attach a non-passive wheel listener so timeline input can prevent scrolling. */
function useCanvasWheel(
  canvas: { readonly current: HTMLCanvasElement | null },
  bindings: TimelinePointerCanvasBindings | undefined,
) {
  useLayoutEffect(() => {
    const element = canvas.current;
    if (!element || !bindings) {
      return;
    }
    // React delegates wheel through a passive listener; timeline input must prevent scrolling.
    const wheel = (event: WheelEvent) => bindings.wheel(event);
    element.addEventListener("wheel", wheel, { passive: false });
    return () => element.removeEventListener("wheel", wheel);
  }, [canvas, bindings]);
}

/** Translate DOM input for the two editing canvases and their overview strips. */
export function TimelineCanvases() {
  const notes = useRef<HTMLCanvasElement>(null);
  const events = useRef<HTMLCanvasElement>(null);
  const surface = useTimelineDomSurface();
  const runtime = useTimelineRuntime();
  const bindings = useEditorRuntimeValue((editor) => editor.ui.timelineBindings.canvas, null);
  const overview = useEditorRuntimeValue((editor) => editor.ui.timelineBindings.overview, null);
  const activeBindings = runtime ? bindings : undefined;
  const activeOverview = runtime ? overview : undefined;
  const densityBarsEnabled = useSetting("timeline-density-bars-enabled", true);
  useCanvasWheel(notes, activeBindings?.notes);
  useCanvasWheel(events, activeBindings?.events);
  return (
    <>
      <OverviewStrip
        name="note-density"
        bindings={activeOverview?.density}
        surfaceRef={surface.attach.noteDensity}
        hidden={!activeOverview || !densityBarsEnabled}
      />
      {/*
        The backdrop holds the beat grid and the lane separators. The playhead
        gets its own canvas above the static grid so seeking repaints only the
        red line; both sit below the note and event content layers.
      */}
      <BatchCanvas
        className="timeline-backdrop timeline-notes-backdrop"
        surfaceRef={surface.attach.notesBackdrop}
      />
      <BatchCanvas
        className="timeline-grid-batch timeline-notes-grid-batch"
        surfaceRef={surface.attach.notesGridBatch}
      />
      <BatchCanvas
        className="timeline-playhead timeline-notes-playhead"
        surfaceRef={surface.attach.notesPlayhead}
      />
      <BatchCanvas
        className="timeline-playhead-batch timeline-notes-playhead-batch"
        surfaceRef={surface.attach.notesPlayheadBatch}
      />
      <EditingCanvas
        id="notes"
        bindings={activeBindings?.notes}
        canvasRef={notes}
        surfaceRef={surface.attach.notes}
      />
      <BatchCanvas className="timeline-note-batch" surfaceRef={surface.attach.noteBatch} />
      <BatchCanvas
        className="timeline-note-solid-batch"
        surfaceRef={surface.attach.noteSolidBatch}
      />
      <BatchCanvas className="timeline-notes-cue" surfaceRef={surface.attach.notesCue} />
      <BatchCanvas
        className="timeline-backdrop timeline-events-backdrop"
        surfaceRef={surface.attach.eventsBackdrop}
      />
      <BatchCanvas
        className="timeline-grid-batch timeline-events-grid-batch"
        surfaceRef={surface.attach.eventsGridBatch}
      />
      <BatchCanvas
        className="timeline-playhead timeline-events-playhead"
        surfaceRef={surface.attach.eventsPlayhead}
      />
      <BatchCanvas
        className="timeline-playhead-batch timeline-events-playhead-batch"
        surfaceRef={surface.attach.eventsPlayheadBatch}
      />
      <EditingCanvas
        id="events"
        bindings={activeBindings?.events}
        canvasRef={events}
        surfaceRef={surface.attach.events}
      />
      <BatchCanvas className="timeline-event-batch" surfaceRef={surface.attach.eventBatch} />
      <BatchCanvas
        className="timeline-event-overlay-batch"
        surfaceRef={surface.attach.eventOverlayBatch}
      />
      <TimelinePanelEdges notesCanvas={notes} eventsCanvas={events} />
      <OverviewStrip
        name="history-strip"
        bindings={activeOverview?.history}
        surfaceRef={surface.attach.history}
        hidden={!activeOverview || !densityBarsEnabled}
      />
      <NoteTimelineRangeOverlay />
      <TimelineMarkerRail />
    </>
  );
}
