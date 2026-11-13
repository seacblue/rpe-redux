/**
 * Renders the timeline canvas stack and overview strips, and binds wheel, pointer,
 * and context-menu input to the runtime bindings.
 *
 * DOM structure and listener attachment live here; painting and gesture behavior
 * belong to the timeline engine.
 */
import { useLayoutEffect, useRef, type Ref } from "react";
import { t } from "../../../../../../i18n/index.ts";
import { mergeRefs } from "../../../../../platform/mergeRefs.ts";
import { onboardingAnchorRef } from "../../../../../onboarding/anchors.ts";
import { useSetting } from "../../../../settings/useSetting.ts";
import { useEditorRuntimeValue } from "../../runtime/composition/EditorRuntime.tsx";
import { useTimelineRuntime } from "../../runtime/providers/TimelineProvider.tsx";
import { useTimelineDomSurface } from "./TimelineDomSurface.tsx";
import type { TimelinePointerCanvasBindings, TimelineStripBindings } from "./timelineBindings.ts";

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
      <OverviewStrip
        name="history-strip"
        bindings={activeOverview?.history}
        surfaceRef={surface.attach.history}
        hidden={!activeOverview || !densityBarsEnabled}
      />
    </>
  );
}
