/**
 * Owns the selection overlay canvas and the window-level pointer listeners that keep a
 * rectangle drag alive outside the timeline.
 *
 * It paints from the timeline's public selection state and leaves selection rules to
 * the timeline and core. Marquee geometry comes from `selectionOverlayDrawing` so the
 * Canvas2D and WebGL sinks share one projection.
 */
import type { ResourceScope } from "../../../../../../core/utils/resourceScope.ts";
import { readCanvasPalette, rgbChannels, selectionColor } from "../../../canvas/palette.ts";
import { RenderGraph, type RenderPacket } from "../../../canvas/renderGraph.ts";
import { TimelineOverlayRenderDevice } from "../../../canvas/timelineOverlayRenderDevice.ts";
import { type Timeline } from "../surface/timeline.ts";
import { marqueeRectangleCommands, selectionSweepCommands } from "./selectionOverlayDrawing.ts";
import { TimelineOverlayBatch } from "../../../canvas/timelineOverlayBatch.ts";
import { finishCapturedSelectionGesture } from "./selectionGestureCompletion.ts";

/** Event target shape needed for the line-switcher exclusion check. */
interface ClosestTarget {
  closest?: (selector: string) => unknown;
}

/** Marquee rectangle drawn above the timeline using only its public state. */
export class SelectionOverlay {
  timeline: Timeline;
  canvas: HTMLCanvasElement;
  private readonly graph = new RenderGraph();
  private readonly device: TimelineOverlayRenderDevice;

  /** Attach marquee listeners and mark the timeline as overlay-driven. */
  constructor(
    stage: HTMLElement,
    canvas: HTMLCanvasElement,
    gpuCanvas: HTMLCanvasElement,
    timeline: Timeline,
    scope: ResourceScope,
  ) {
    this.timeline = timeline;
    this.canvas = canvas;
    this.device = new TimelineOverlayRenderDevice(canvas, new TimelineOverlayBatch(gpuCanvas));
    scope.add(() => this.graph.dispose([this.device]));
    scope.listen(
      window,
      "pointermove",
      (event: PointerEvent) => {
        timeline.updateRectangle(event);
        timeline.updateSweep(event);
      },
      true,
    );
    const finishWindowDrag = (event: PointerEvent) => {
      if (finishCapturedSelectionGesture(timeline, event)) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    };
    scope.listen(window, "pointerup", finishWindowDrag, true);
    scope.listen(window, "pointercancel", finishWindowDrag, true);
    scope.listen(
      window,
      "pointerdown",
      (event: PointerEvent) => {
        const active = timeline.rectangleSelection() || timeline.sweepSelection();
        if (!active) {
          return;
        }
        const target = event.target;
        if (target instanceof Node && stage.contains(target)) {
          return;
        }
        if (timeline.gestures.cancelSelectionGesture()) {
          timeline.changed();
        }
      },
      true,
    );
    scope.listen(
      stage,
      "pointerdown",
      (event) => {
        const target = event.target as ClosestTarget | null;
        if (target?.closest?.(".line-switcher")) {
          return;
        }
        if (finishCapturedSelectionGesture(timeline, event)) {
          event.preventDefault();
          event.stopImmediatePropagation();
        }
      },
      true,
    );
  }

  /** Paint or clear the marquee above the timeline canvases. */
  draw(): void {
    const previewMarquee = this.timeline.gestures.previewMarquee;
    const selection = this.timeline.rectangleSelection();
    const sweep = this.timeline.sweepSelection();
    const palette = this.timeline.cache.palette() ?? readCanvasPalette();
    const noteColor = selectionColor("timeline-note-marquee-color", palette.selectionNotesStroke);
    const eventColor = selectionColor(
      "timeline-event-marquee-color",
      palette.selectionEventsStroke,
    );
    const sweepAddColor = selectionColor("timeline-sweep-add-color", "#33FF33");
    const sweepRemoveColor = selectionColor("timeline-sweep-remove-color", "#FFFFFF");
    const noteRgb = rgbChannels(noteColor) ?? [0, 103, 184];
    const eventRgb = rgbChannels(eventColor) ?? [180, 83, 9];
    const marqueePalette = {
      ...palette,
      selectionNotesFill: `rgba(${noteRgb.join(", ")}, 0.18)`,
      selectionNotesStroke: noteColor,
      selectionEventsFill: `rgba(${eventRgb.join(", ")}, 0.24)`,
      selectionEventsStroke: eventColor,
    };
    let commands;
    if (previewMarquee) {
      commands = marqueeRectangleCommands(
        { left: 0, top: 0 },
        { left: 0, top: 0 },
        previewMarquee.start,
        previewMarquee.current,
        "notes",
        marqueePalette,
        true,
      );
    } else if (!selection && sweep) {
      const origin = sweep.canvas.getBoundingClientRect();
      const overlay = this.canvas.getBoundingClientRect();
      const points = sweep.drag.sweepPoints ?? [sweep.drag.start, sweep.drag.current];
      const strokeColor = sweep.drag.remove ? sweepRemoveColor : sweepAddColor;
      commands = selectionSweepCommands(
        { left: origin.left, top: origin.top },
        { left: overlay.left, top: overlay.top },
        points,
        sweep.area,
        marqueePalette,
        strokeColor,
      );
    } else if (selection) {
      const origin = selection.canvas.getBoundingClientRect();
      const overlay = this.canvas.getBoundingClientRect();
      const start = this.timeline.rectangleStart(selection.drag);
      commands = marqueeRectangleCommands(
        { left: origin.left, top: origin.top },
        { left: overlay.left, top: overlay.top },
        start,
        selection.drag.current,
        selection.area,
        marqueePalette,
      );
    } else {
      commands = [];
    }
    const packet: RenderPacket = {
      surface: "timeline-selection-overlay",
      key: `${this.timeline.renderRevision}:${this.timeline.selectionOverlayRevision}:${
        this.canvas.clientWidth
      }x${this.canvas.clientHeight}:${JSON.stringify(commands)}`,
      width: this.canvas.clientWidth,
      height: this.canvas.clientHeight,
      commands,
    };
    this.graph.submit(packet, this.device);
  }
}
