/**
 * Binds the React multi-line scrollbar to timeline viewport scrolling: publishes the
 * visible, maximum, and current value snapshot and maps pointer drags to offsets.
 *
 * Only this control seam is owned here; panel layout stays in the viewport.
 */
import type { TimelineScrollReceiver } from "../drawing/timelineReceiver.ts";
import { createLateBound, type LateBound } from "../../../../../../core/utils/lateBound.ts";
import { clamp } from "../../../../../../core/utils/numbers.ts";
import { createValue, type ValueCell } from "../../../../../../core/state/values.ts";
export interface MultiLineScrollSnapshot {
  visible: boolean;
  max: string;
  value: string;
}

interface MultiLineScrollActions {
  setValue(rawValue: string): void;
  setFromPointer(event: PointerEvent, control: HTMLInputElement): void;
}

export interface MultiLineScrollState {
  readonly snapshot: ValueCell<MultiLineScrollSnapshot>;
  readonly actions: LateBound<MultiLineScrollActions>;
}

/** Creates the scrollbar snapshot cell and its late-bound actions. */
export function createMultiLineScrollState(): MultiLineScrollState {
  return Object.freeze({
    snapshot: createValue<MultiLineScrollSnapshot>({
      initial: { visible: false, max: "0", value: "0" },
    }),
    actions: createLateBound<MultiLineScrollActions>(),
  });
}

export type MultiLineScrollArea = "notes" | "events";

/** Connect the React range control to timeline scrolling without DOM listeners. */
export function bindMultiLineScroll(
  state: MultiLineScrollState,
  timeline: TimelineScrollReceiver,
  getArea: () => MultiLineScrollArea,
  invalidate: () => void,
): () => void {
  const current: MultiLineScrollActions = {
    setValue(rawValue) {
      if (typeof timeline.viewport.multiLineScroll === "number") {
        timeline.viewport.multiLineScroll = {
          notes: timeline.viewport.multiLineScroll,
          events: timeline.viewport.multiLineScroll,
        };
      }
      timeline.viewport.multiLineScroll[getArea()] = Number(rawValue) || 0;
      state.snapshot.update({ value: rawValue });
      invalidate();
    },
    setFromPointer(event, control) {
      const rectangle = control.getBoundingClientRect();
      if (!rectangle.width) {
        return;
      }
      const ratio = clamp((event.clientX - rectangle.left) / rectangle.width, 0, 1);
      const maximum = Number(state.snapshot.get().max) || 0;
      this.setValue(String(Math.round(maximum * ratio)));
    },
  };
  return state.actions.bind(current);
}

/** Set the active area's scroll offset through the bound actions. */
export function setMultiLineScrollValue(state: MultiLineScrollState, rawValue: string): void {
  state.actions.value()?.setValue(rawValue);
}

/** Map a pointer position on the range control to a scroll offset. */
export function setMultiLineScrollFromPointer(
  state: MultiLineScrollState,
  event: PointerEvent,
  control: HTMLInputElement,
): void {
  state.actions.value()?.setFromPointer(event, control);
}
