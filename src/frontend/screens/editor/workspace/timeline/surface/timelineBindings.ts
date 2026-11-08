/**
 * Shared DOM binding snapshots for the timeline canvases and overview strips.
 * The two cells remain separate because editing and overview lifecycles dispose
 * independently; this file only owns their common publication mechanism.
 */
import { createValue } from "../../../../../../core/state/values.ts";
import type { ValueCell } from "../../../../../../core/state/values.ts";

export interface TimelineCanvasBindings {
  wheel(event: WheelEvent): boolean;
  contextMenu(event: MouseEvent): void;
}

export interface TimelinePointerCanvasBindings extends TimelineCanvasBindings {
  pointerMove(event: PointerEvent): void;
  pointerLeave(): void;
  pointerDown(event: PointerEvent): void;
  pointerUp(event: PointerEvent): void;
  pointerCancel(): void;
}

export interface TimelineCanvasBindingSnapshot {
  notes: TimelinePointerCanvasBindings;
  events: TimelinePointerCanvasBindings;
}

export interface TimelineStripBindings {
  pointerDown(event: PointerEvent): void;
  pointerMove(event: PointerEvent): void;
  pointerUp(event: PointerEvent): void;
  pointerLeave(): void;
}

export interface TimelineOverviewBindings {
  density: TimelineStripBindings;
  history: TimelineStripBindings;
}

export interface TimelineBindingsState {
  readonly canvas: ValueCell<TimelineCanvasBindingSnapshot | null>;
  readonly overview: ValueCell<TimelineOverviewBindings | null>;
}

/** Creates the canvas and overview binding cells. */
export function createTimelineBindingsState(): TimelineBindingsState {
  return Object.freeze({
    canvas: createValue<TimelineCanvasBindingSnapshot | null>({ initial: null }),
    overview: createValue<TimelineOverviewBindings | null>({ initial: null }),
  });
}
