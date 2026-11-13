/**
 * Owns the selection overlay canvas and the window-level pointer listeners that keep a
 * rectangle drag alive outside the timeline.
 *
 * It paints from the timeline's public selection state and leaves selection rules to
 * the timeline and core. Marquee geometry comes from `selectionOverlayDrawing` so the
 * Canvas2D and WebGL sinks share one projection.
 */
import type { ResourceScope } from "../../../../../../core/utils/resourceScope.ts";
import { prepareCanvas } from "../../../canvas/canvas2d.ts";
import { readCanvasPalette, rgbChannels, selectionColor } from "../../../canvas/palette.ts";
import { type Timeline } from "../surface/timeline.ts";
import { drawPreviewMarquee } from "../../preview/interaction/previewSelection.ts";
import {
  drawMarqueeRectangle,
  drawSelectionSweep,
  queueMarqueeRectangle,
  queueSelectionSweep,
} from "./selectionOverlayDrawing.ts";
import { TimelineOverlayBatch } from "../../../canvas/timelineOverlayBatch.ts";

/** Event target shape needed for the line-switcher exclusion check. */
interface ClosestTarget {
  closest?: (selector: string) => unknown;
}

/** Marquee rectangle drawn above the timeline using only its public state. */
export class SelectionOverlay {
  timeline: Timeline;
  canvas: HTMLCanvasElement;
  private readonly gpuBatch: TimelineOverlayBatch;
  private hasPaintedSelection = false;

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
    this.gpuBatch = new TimelineOverlayBatch(gpuCanvas);
    scope.add(() => this.gpuBatch.dispose());
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
      if (!timeline.rectangleSelection() && !timeline.sweepSelection()) {
        return;
      }
      if (timeline.finishRectangle(event)) {
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
        if (timeline.finishRectangle(event)) {
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
    if (!previewMarquee && !selection && !sweep) {
      if (this.hasPaintedSelection) {
        this.gpuBatch.begin(this.canvas.clientWidth, this.canvas.clientHeight);
        prepareCanvas(this.canvas);
        this.gpuBatch.finish();
        this.hasPaintedSelection = false;
      }
      return;
    }

    const gpuActive = this.gpuBatch.begin(this.canvas.clientWidth, this.canvas.clientHeight);
    // Keep the Canvas2D fallback surface transparent while the GPU sibling is active.
    if (gpuActive) {
      prepareCanvas(this.canvas);
    }
    const context = gpuActive ? null : prepareCanvas(this.canvas).context;
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
    if (previewMarquee) {
      if (gpuActive) {
        queueMarqueeRectangle(
          this.gpuBatch,
          { left: 0, top: 0 },
          { left: 0, top: 0 },
          previewMarquee.start,
          previewMarquee.current,
          "notes",
          marqueePalette,
          true,
        );
        this.gpuBatch.finish();
      } else {
        drawPreviewMarquee(context!, previewMarquee.start, previewMarquee.current);
      }
      this.hasPaintedSelection = true;
      return;
    }
    if (!selection) {
      if (sweep) {
        const origin = sweep.canvas.getBoundingClientRect();
        const overlay = this.canvas.getBoundingClientRect();
        const points = sweep.drag.sweepPoints ?? [sweep.drag.start, sweep.drag.current];
        const strokeColor = sweep.drag.remove ? sweepRemoveColor : sweepAddColor;
        const originPoint = { left: origin.left, top: origin.top };
        const overlayPoint = { left: overlay.left, top: overlay.top };
        if (gpuActive) {
          queueSelectionSweep(
            this.gpuBatch,
            originPoint,
            overlayPoint,
            points,
            sweep.area,
            marqueePalette,
            strokeColor,
          );
          this.gpuBatch.finish();
        } else {
          drawSelectionSweep(
            context!,
            originPoint,
            overlayPoint,
            points,
            sweep.area,
            marqueePalette,
            strokeColor,
          );
        }
        this.hasPaintedSelection = true;
      } else {
        if (gpuActive) {
          this.gpuBatch.finish();
        }
        this.hasPaintedSelection = false;
      }
      return;
    }
    const origin = selection.canvas.getBoundingClientRect();
    const overlay = this.canvas.getBoundingClientRect();
    const start = this.timeline.rectangleStart(selection.drag);
    const { current } = selection.drag;
    const originPoint = { left: origin.left, top: origin.top };
    const overlayPoint = { left: overlay.left, top: overlay.top };
    if (gpuActive) {
      queueMarqueeRectangle(
        this.gpuBatch,
        originPoint,
        overlayPoint,
        start,
        current,
        selection.area,
        marqueePalette,
      );
      this.gpuBatch.finish();
    } else {
      drawMarqueeRectangle(
        context!,
        originPoint,
        overlayPoint,
        start,
        current,
        selection.area,
        marqueePalette,
      );
    }
    this.hasPaintedSelection = true;
  }
}
