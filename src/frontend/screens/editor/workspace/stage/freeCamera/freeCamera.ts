/**
 * Free-camera state and the view operations shared by the overlay, preview, and commands.
 *
 * The cell holds one saved view: pan, zoom, and whether the mode is on. The
 * standalone toolbar mode owns that view, so leaving the mode keeps the frame the
 * user set on the stage. A surface that only borrows the camera — the curve
 * editor and sampling — captures the view on entry with `borrowFreeCamera` and
 * returns it on exit with `releaseFreeCamera`, which restores the saved pose and
 * activation instead of leaving the borrower's frame behind.
 */
import { createValue } from "../../../../../../core/state/values.ts";
import { TOOLBAR_REFRESH_EVENT } from "../../../../../../core/shell/shellEventNames.ts";

/** Free-camera view state shared by the overlay, the preview, and stage commands. */
export interface FreeCameraState {
  active: boolean;
  zoom: number;
  panX: number;
  panY: number;
}

/** Compare two camera views by value; writing an unchanged view must not repaint. */
function sameFreeCameraView(left: FreeCameraState, right: FreeCameraState): boolean {
  return (
    left.active === right.active &&
    left.zoom === right.zoom &&
    left.panX === right.panX &&
    left.panY === right.panY
  );
}

const state = createValue<FreeCameraState>({
  initial: { active: false, zoom: 1, panX: 0, panY: 0 },
  equals: sameFreeCameraView,
});

export const freeCameraState = state;

/** Whether a pointer button is allowed to pan a free-camera surface. */
export function isFreeCameraDragButton(button: number): boolean {
  return button === 0 || button === 2;
}

/** Toggles free-camera mode and refreshes the toolbar. */
export function toggleFreeCamera(): void {
  const current = state.get();
  state.set({ ...current, active: !current.active });
  window.dispatchEvent(new Event(TOOLBAR_REFRESH_EVENT));
}

/** Leaves free-camera mode when it is active, keeping the stored view. */
export function closeFreeCamera(): void {
  const current = state.get();
  if (current.active) {
    state.set({ ...current, active: false });
    window.dispatchEvent(new Event(TOOLBAR_REFRESH_EVENT));
  }
}

/** Restores zoom and pan to the fitted view. */
export function resetFreeCamera(): void {
  state.set({ ...state.get(), zoom: 1, panX: 0, panY: 0 });
}

/** Recenter the view without changing its magnification. */
export function centerFreeCamera(): void {
  state.set({ ...state.get(), panX: 0, panY: 0 });
}

/** Stores a new view while rejecting non-finite or non-positive zoom values. */
export function setFreeCameraView(zoom: number, panX: number, panY: number): void {
  const current = state.get();
  const nextZoom = Number.isFinite(zoom) && zoom > 0 ? zoom : current.zoom;
  state.set({
    active: current.active,
    zoom: nextZoom,
    panX,
    panY,
  });
}

/**
 * Enter the camera for a surface that only borrows it.
 *
 * Returns the complete view the caller must hand back to `releaseFreeCamera`.
 * The saved view stays available only through that return value while the
 * borrower is open, so a borrower that can change pan or zoom has to release it.
 */
export function borrowFreeCamera(): FreeCameraState {
  const previous = state.get();
  if (!previous.active) {
    state.set({ ...previous, active: true });
    window.dispatchEvent(new Event(TOOLBAR_REFRESH_EVENT));
  }
  return previous;
}

/**
 * Return a view captured by `borrowFreeCamera`.
 *
 * The saved pose and activation are restored in one write: the renderer repaints
 * once, and the surface that borrowed the camera cannot leave its own frame
 * behind for the standalone mode or the next borrower.
 */
export function releaseFreeCamera(view: FreeCameraState): void {
  const activationChanged = state.get().active !== view.active;
  state.set({ ...view });
  if (activationChanged) {
    window.dispatchEvent(new Event(TOOLBAR_REFRESH_EVENT));
  }
}

/**
 * Normalize a wheel delta to screen pixels.
 *
 * Browsers report pixel, line, or page units through `WheelEvent.deltaMode`.
 * The timeline already scales non-pixel deltas by 100, so every camera surface
 * uses the same factor and the wheel stays consistent across the stage.
 */
export function wheelZoomDelta(deltaY: number, deltaMode = 0): number {
  if (!Number.isFinite(deltaY) || deltaY === 0) {
    return 0;
  }
  return deltaMode === 0 ? deltaY : deltaY * 100;
}

/**
 * Zoom around a pointer given in screen pixels from the viewport centre.
 *
 * The free-camera overlay and the curve surface share this rule so the anchor
 * feels the same in both modes.
 */
export function zoomFreeCameraAt(cursorX: number, cursorY: number, deltaY: number): void {
  const current = state.get();
  const next = current.zoom * Math.exp(-deltaY * 0.0015);
  if (!Number.isFinite(next) || next <= 0 || next === current.zoom) {
    return;
  }
  const ratio = next / current.zoom;
  setFreeCameraView(
    next,
    cursorX - (cursorX - current.panX) * ratio,
    cursorY - (cursorY - current.panY) * ratio,
  );
}
