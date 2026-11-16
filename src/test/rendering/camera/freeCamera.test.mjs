/** Checks camera state retention and curve-preview coordinate mapping. */
import assert from "node:assert/strict";
import test from "node:test";
import {
  activateFreeCamera,
  centerFreeCamera,
  freeCameraState,
  isFreeCameraDragButton,
  resetFreeCamera,
  restoreFreeCamera,
  setFreeCameraView,
  toggleFreeCamera,
  wheelZoomDelta,
  zoomFreeCameraAt,
} from "../../../frontend/screens/editor/workspace/stage/freeCamera/freeCamera.ts";
import {
  overlayToScreen,
  overlayToWorld,
  previewOverlayView,
} from "../../../frontend/screens/editor/curveEvents/drawOverlay.ts";
import {
  DEFAULT_PREVIEW_CAMERA,
  previewCameraBounds,
  previewCameraFrame,
} from "../../../frontend/screens/editor/workspace/preview/scene/previewCamera.ts";
import { previewViewport } from "../../../frontend/screens/editor/workspace/preview/scene/viewport.ts";
import { drawGameUi } from "../../../frontend/screens/editor/workspace/preview/render/gameUi.ts";
import { gameUiLayout } from "../../../frontend/screens/editor/workspace/preview/drawing/gameUi.ts";

test("free-camera surfaces accept left and right drag buttons", () => {
  assert.equal(isFreeCameraDragButton(0), true);
  assert.equal(isFreeCameraDragButton(2), true);
  assert.equal(isFreeCameraDragButton(1), false);
});

test("closing the camera retains its view; centering preserves its zoom", () => {
  globalThis.window = new EventTarget();
  toggleFreeCamera();
  setFreeCameraView(2, 120, -40);
  toggleFreeCamera();
  assert.deepEqual(freeCameraState.get(), { active: false, zoom: 2, panX: 120, panY: -40 });
  toggleFreeCamera();
  centerFreeCamera();
  assert.deepEqual(freeCameraState.get(), { active: true, zoom: 2, panX: 0, panY: 0 });
  resetFreeCamera();
  assert.deepEqual(freeCameraState.get(), { active: true, zoom: 1, panX: 0, panY: 0 });
  toggleFreeCamera();
});

/** Assert the camera still holds one pose, allowing for the zoom's float math. */
function assertPose(pose) {
  const current = freeCameraState.get();
  assert.ok(Math.abs(current.zoom - pose.zoom) < 1e-9, "zoom must not drift");
  assert.equal(current.panX, pose.panX);
  assert.equal(current.panY, pose.panY);
}

test("leaving a camera surface keeps the last pose for the next entry", () => {
  globalThis.window = new EventTarget();
  freeCameraState.set({ active: false, zoom: 1, panX: 0, panY: 0 });
  const lease = activateFreeCamera();
  assert.equal(freeCameraState.get().active, true);
  // Wheel and drag move the same pose the curve surface edits.
  zoomFreeCameraAt(120, -60, -240);
  setFreeCameraView(freeCameraState.get().zoom, 42, -18);
  const pose = freeCameraState.get();
  assert.ok(pose.zoom > 1);
  assert.equal(pose.panX, 42);
  assert.equal(pose.panY, -18);

  restoreFreeCamera(lease);
  assert.equal(freeCameraState.get().active, false);
  assertPose(pose);

  // Re-entering through the mode switch resumes the retained pose, repeatedly.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    toggleFreeCamera();
    assert.equal(freeCameraState.get().active, true);
    assertPose(pose);
    toggleFreeCamera();
    assert.equal(freeCameraState.get().active, false);
    assertPose(pose);
  }

  // The explicit reset button is still allowed to discard the pose.
  toggleFreeCamera();
  resetFreeCamera();
  assert.deepEqual(freeCameraState.get(), { active: true, zoom: 1, panX: 0, panY: 0 });
  toggleFreeCamera();
});

test("releasing a lease over an already active camera keeps pose and activation", () => {
  globalThis.window = new EventTarget();
  freeCameraState.set({ active: true, zoom: 2, panX: 10, panY: 20 });
  const lease = activateFreeCamera();
  zoomFreeCameraAt(-30, 45, 120);
  const pose = freeCameraState.get();
  restoreFreeCamera(lease);
  assert.equal(freeCameraState.get().active, true);
  assertPose(pose);
  toggleFreeCamera();
  assert.equal(freeCameraState.get().active, false);
  assertPose(pose);
});

test("manual camera zoom accepts values outside the former range", () => {
  globalThis.window = new EventTarget();
  freeCameraState.set({ active: true, zoom: 1, panX: 0, panY: 0 });

  setFreeCameraView(0.1, 10, 20);
  assert.deepEqual(freeCameraState.get(), { active: true, zoom: 0.1, panX: 10, panY: 20 });

  setFreeCameraView(8, -10, -20);
  assert.deepEqual(freeCameraState.get(), { active: true, zoom: 8, panX: -10, panY: -20 });

  setFreeCameraView(0, 30, 40);
  assert.deepEqual(freeCameraState.get(), { active: true, zoom: 8, panX: 30, panY: 40 });
});

test("wheel deltas normalize line and page units to screen pixels", () => {
  assert.equal(wheelZoomDelta(120), 120, "pixel deltas pass through");
  assert.equal(wheelZoomDelta(120, 0), 120);
  assert.equal(wheelZoomDelta(-3, 1), -300, "line deltas use the timeline factor");
  assert.equal(wheelZoomDelta(1, 2), 100, "page deltas use the timeline factor");
  assert.equal(wheelZoomDelta(0, 1), 0);
  assert.equal(wheelZoomDelta(Number.NaN, 0), 0);
});

test("curve preview projects through the renderer's aspect ratio and divisor", () => {
  const view = previewOverlayView({ clientWidth: 1200, clientHeight: 900 }, 16 / 9, 2);
  const chartPoint = { x: 675, y: 450 };
  const screenPoint = overlayToScreen(view, chartPoint);
  assert.deepEqual(screenPoint, { x: 900, y: 281.25 });
  assert.deepEqual(overlayToWorld(view, screenPoint), chartPoint);
});

test("free camera moves chart content inside a fixed viewport", () => {
  const viewport = previewViewport(1200, 900, 4 / 3);
  const fitted = previewCameraFrame(viewport, DEFAULT_PREVIEW_CAMERA);
  assert.equal(fitted.centerX, 600);
  assert.equal(fitted.centerY, 450);
  assert.equal(fitted.scaleX, viewport.scaleX);
  assert.equal(fitted.scaleY, viewport.scaleY);

  const camera = previewCameraFrame(viewport, {
    active: true,
    zoom: 2,
    panX: 120,
    panY: -40,
  });
  assert.equal(camera.centerX, 720);
  assert.equal(camera.centerY, 410);
  assert.equal(camera.scale, viewport.scale * 2);
  assert.equal(camera.scaleX, viewport.scaleX * 2);
  assert.equal(camera.scaleY, viewport.scaleY * 2);

  // Closing the camera keeps the last visible zoom and pan.
  const closed = previewCameraFrame(viewport, {
    active: false,
    zoom: 2,
    panX: 120,
    panY: -40,
  });
  assert.equal(closed.centerX, 720);
  assert.equal(closed.centerY, 410);
  assert.equal(closed.scaleX, viewport.scaleX * 2);
});

test("free camera scales and moves the chart frame with its background", () => {
  const viewport = previewViewport(1200, 900, 4 / 3);
  const camera = { active: true, zoom: 2, panX: 120, panY: -40 };
  assert.deepEqual(previewCameraBounds(viewport, DEFAULT_PREVIEW_CAMERA), {
    left: 0,
    top: 0,
    width: 1200,
    height: 900,
  });
  assert.deepEqual(previewCameraBounds(viewport, camera), {
    left: -480,
    top: -490,
    width: 2400,
    height: 1800,
  });
  // The curve preview divides the fitted frame; the camera still moves around
  // the viewport centre and scales the outline.
  assert.deepEqual(previewCameraBounds(viewport, camera, 2), {
    left: 120,
    top: -40,
    width: 1200,
    height: 900,
  });
});

test("free camera carries game UI with the projected chart frame", () => {
  const viewport = previewViewport(1200, 900, 4 / 3);
  const fitted = previewCameraFrame(viewport, DEFAULT_PREVIEW_CAMERA);
  const moved = previewCameraFrame(viewport, {
    active: true,
    zoom: 2,
    panX: 120,
    panY: -40,
  });
  const translationsFor = (view) => {
    const translations = [];
    const context = {
      save() {},
      restore() {},
      translate(x, y) {
        translations.push({ x, y });
      },
      rotate() {},
      scale() {},
      fillRect() {},
      fillText() {},
      measureText() {
        return { width: 10 };
      },
      drawImage() {},
      set font(value) {},
      set fillStyle(value) {},
      set globalAlpha(value) {},
    };
    drawGameUi(
      context,
      { META: { name: "chart", level: "1" }, judgeLineList: [] },
      [],
      [],
      0,
      -1,
      viewport,
      view,
      null,
      600,
    );
    return translations;
  };
  const fittedTranslations = translationsFor(fitted);
  const movedTranslations = translationsFor(moved);
  const pause = gameUiLayout(
    viewport.width / viewport.scale,
    viewport.height / viewport.scale,
  ).find((item) => item.key === "pause");

  assert.ok(pause);
  assert.deepEqual(movedTranslations[0], {
    x: moved.centerX + pause.x * moved.scale,
    y: moved.centerY - pause.y * moved.scale,
  });
  assert.notDeepEqual(movedTranslations[0], fittedTranslations[0]);
});
