/**
 * The curve preview pane session: its surface mode and the stage camera it borrows.
 *
 * The pane authors a path over the chart underlay, so both surfaces share one
 * camera and the pane has to own that camera while it is open. Entering captures
 * the saved view and leaving returns it, which keeps the standalone free camera's
 * frame intact. The triggers live on the pane lifecycle rather than in a surface
 * effect: a pane is also left by opening another pane, and the saved view has to
 * be back before that next surface captures its own.
 */
import {
  borrowFreeCamera,
  freeCameraState,
  releaseFreeCamera,
  type FreeCameraState,
} from "../workspace/stage/freeCamera/freeCamera.ts";
import { curvePreviewMode } from "./mode.ts";
import { cancelCurveSession, flushCurveDraft } from "./store.ts";

/** The saved view the open pane borrowed; null while the pane is closed. */
let borrowedView: FreeCameraState | null = null;
/** Keeps the camera active while the pane is open; set with the borrow. */
let keepActive: (() => void) | null = null;

/**
 * Opens the curve preview surface and borrows the stage camera.
 *
 * Repeated opens for the same pane are no-ops so the saved view is captured once.
 */
export function openCurvePane(): void {
  if (borrowedView) {
    return;
  }
  borrowedView = borrowFreeCamera();
  curvePreviewMode.set(true);
  // The path and the underlay must keep one transform, so a mode switch outside
  // this pane must not release the camera the pane is drawing through.
  keepActive = freeCameraState.subscribe(() => {
    const current = freeCameraState.get();
    if (!current.active) {
      freeCameraState.set({ ...current, active: true });
    }
  });
}

/**
 * Closes the curve preview surface and returns the camera view it borrowed.
 *
 * An active stroke, drag, or pan ends here: the overlay is hidden as soon as the
 * mode is off, so leaving a gesture alive would resume it on reopen.
 */
export function closeCurvePane(): void {
  keepActive?.();
  keepActive = null;
  cancelCurveSession();
  flushCurveDraft();
  curvePreviewMode.set(false);
  const view = borrowedView;
  borrowedView = null;
  if (view) {
    releaseFreeCamera(view);
  }
}
