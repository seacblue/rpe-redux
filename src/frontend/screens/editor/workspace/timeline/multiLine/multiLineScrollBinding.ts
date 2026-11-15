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
  area: MultiLineScrollArea;
  visible: boolean;
  max: string;
  value: string;
  step: string;
  firstPanel: string;
  lastPanel: string;
  panelCount: string;
}

interface MultiLineScrollActions {
  setValue(rawValue: string): void;
  setFromPointer(event: PointerEvent, control: HTMLInputElement): void;
  moveByPanel(direction: -1 | 1): void;
  moveToStart(): void;
  moveToEnd(): void;
}

export interface MultiLineScrollState {
  readonly snapshot: ValueCell<MultiLineScrollSnapshot>;
  readonly actions: LateBound<MultiLineScrollActions>;
}

/** Creates the scrollbar snapshot cell and its late-bound actions. */
export function createMultiLineScrollState(): MultiLineScrollState {
  return Object.freeze({
    snapshot: createValue<MultiLineScrollSnapshot>({
      initial: {
        area: "notes",
        visible: false,
        max: "0",
        value: "0",
        step: "0",
        firstPanel: "0",
        lastPanel: "0",
        panelCount: "0",
      },
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
      const maximum = Number(state.snapshot.get().max) || 0;
      const next = clamp(Number(rawValue) || 0, 0, maximum);
      timeline.viewport.multiLineScroll[getArea()] = next;
      state.snapshot.update({ value: String(next) });
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
    moveByPanel(direction) {
      const snapshot = state.snapshot.get();
      const current = Number(snapshot.value) || 0;
      const step = Number(snapshot.step) || 0;
      const maximum = Number(snapshot.max) || 0;
      this.setValue(String(Math.min(maximum, Math.max(0, current + direction * step))));
    },
    moveToStart() {
      this.setValue("0");
    },
    moveToEnd() {
      this.setValue(state.snapshot.get().max);
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

/** Move the active multi-line viewport by one panel stride. */
export function moveMultiLineScrollByPanel(state: MultiLineScrollState, direction: -1 | 1): void {
  state.actions.value()?.moveByPanel(direction);
}

/** Return the active multi-line viewport to its leftmost position. */
export function resetMultiLineScroll(state: MultiLineScrollState): void {
  state.actions.value()?.moveToStart();
}

/** Move the active multi-line viewport to its rightmost position. */
export function endMultiLineScroll(state: MultiLineScrollState): void {
  state.actions.value()?.moveToEnd();
}
