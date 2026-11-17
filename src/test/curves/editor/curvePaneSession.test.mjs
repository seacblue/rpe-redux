/**
 * Verifies the curve preview pane borrows the stage camera for its visit and
 * returns the standalone free camera's saved view when the pane closes.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  freeCameraState,
  setFreeCameraView,
  toggleFreeCamera,
} from "../../../frontend/screens/editor/workspace/stage/freeCamera/freeCamera.ts";
import {
  closeCurvePane,
  openCurvePane,
} from "../../../frontend/screens/editor/curveEvents/paneSession.ts";
import { curvePreviewMode } from "../../../frontend/screens/editor/curveEvents/mode.ts";

/** The saved view a test starts from; every case ends back on it. */
const SAVED = { active: false, zoom: 1.5, panX: 30, panY: -12 };

test("the curve pane returns the saved view when it closes", () => {
  globalThis.window = new EventTarget();
  closeCurvePane();
  freeCameraState.set(SAVED);

  openCurvePane();
  assert.equal(curvePreviewMode.get(), true);
  assert.equal(freeCameraState.get().active, true, "the surface draws through the camera");

  // Authoring pans and zooms the same cell the standalone mode uses.
  setFreeCameraView(2.5, 300, -200);
  closeCurvePane();

  assert.equal(curvePreviewMode.get(), false);
  assert.deepEqual(freeCameraState.get(), SAVED);
});

test("a saved view the standalone mode left active stays active after the pane", () => {
  globalThis.window = new EventTarget();
  closeCurvePane();
  const saved = { active: true, zoom: 2, panX: 10, panY: 20 };
  freeCameraState.set(saved);

  openCurvePane();
  setFreeCameraView(4, -50, 60);
  closeCurvePane();

  assert.equal(freeCameraState.get().active, true);
  assert.deepEqual(freeCameraState.get(), saved);
});

test("the open pane keeps the camera active for the path and the underlay", () => {
  globalThis.window = new EventTarget();
  closeCurvePane();
  freeCameraState.set({ active: false, zoom: 1, panX: 0, panY: 0 });

  openCurvePane();
  toggleFreeCamera();
  assert.equal(freeCameraState.get().active, true, "a stray toggle cannot split the transform");

  closeCurvePane();
  assert.deepEqual(freeCameraState.get(), { active: false, zoom: 1, panX: 0, panY: 0 });
});

test("reopening the pane keeps the view captured by its first open", () => {
  globalThis.window = new EventTarget();
  closeCurvePane();
  freeCameraState.set(SAVED);

  openCurvePane();
  setFreeCameraView(3, 12, 12);
  openCurvePane();
  setFreeCameraView(3, 40, 40);
  closeCurvePane();
  assert.deepEqual(freeCameraState.get(), SAVED);

  // A second visit borrows the saved view again instead of the last visit's.
  openCurvePane();
  assert.deepEqual(freeCameraState.get(), { ...SAVED, active: true });
  closeCurvePane();
  assert.deepEqual(freeCameraState.get(), SAVED);
});

test("closing a pane that never opened leaves the camera alone", () => {
  globalThis.window = new EventTarget();
  freeCameraState.set(SAVED);
  closeCurvePane();
  closeCurvePane();
  assert.equal(curvePreviewMode.get(), false);
  assert.deepEqual(freeCameraState.get(), SAVED);
});
