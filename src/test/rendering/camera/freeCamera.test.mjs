/** Checks camera state retention and curve-preview coordinate mapping. */
import assert from "node:assert/strict";
import test from "node:test";
import {
  borrowFreeCamera,
  centerFreeCamera,
  freeCameraState,
  isFreeCameraDragButton,
  releaseFreeCamera,
  resetFreeCamera,
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
import { PreviewOverlayRenderDevice } from "../../../frontend/screens/editor/workspace/preview/scene/previewOverlayRenderDevice.ts";
import { drawComposite } from "../../../frontend/screens/editor/workspace/preview/scene/previewComposite.ts";
import { createPreviewDisplay } from "../../../frontend/screens/editor/workspace/preview/surface/previewDisplay.ts";

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

test("the standalone mode owns the saved view across a close and reopen", () => {
  globalThis.window = new EventTarget();
  freeCameraState.set({ active: false, zoom: 1, panX: 0, panY: 0 });
  toggleFreeCamera();
  // Wheel and drag move the saved view; a close keeps it on the stage.
  zoomFreeCameraAt(120, -60, -240);
  setFreeCameraView(freeCameraState.get().zoom, 42, -18);
  const saved = freeCameraState.get();
  assert.ok(saved.zoom > 1);
  assert.equal(saved.panX, 42);
  assert.equal(saved.panY, -18);

  toggleFreeCamera();
  assert.equal(freeCameraState.get().active, false);
  assertPose(saved);

  // Re-entering through the mode switch resumes the saved view, repeatedly.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    toggleFreeCamera();
    assert.equal(freeCameraState.get().active, true);
    assertPose(saved);
    toggleFreeCamera();
    assert.equal(freeCameraState.get().active, false);
    assertPose(saved);
  }

  // The explicit reset button is still allowed to discard the view.
  toggleFreeCamera();
  resetFreeCamera();
  assert.deepEqual(freeCameraState.get(), { active: true, zoom: 1, panX: 0, panY: 0 });
  toggleFreeCamera();
});

test("a borrower returns the saved view instead of leaving its own frame", () => {
  globalThis.window = new EventTarget();
  const saved = { active: false, zoom: 1.5, panX: 30, panY: -12 };
  freeCameraState.set(saved);

  const borrowed = borrowFreeCamera();
  assert.deepEqual(borrowed, saved);
  assert.equal(freeCameraState.get().active, true);
  zoomFreeCameraAt(80, -40, -320);
  setFreeCameraView(freeCameraState.get().zoom, 500, 300);
  assert.notDeepEqual(freeCameraState.get(), saved);

  releaseFreeCamera(borrowed);
  assert.deepEqual(freeCameraState.get(), saved);

  // The standalone mode resumes on the saved frame, not the borrowed one.
  toggleFreeCamera();
  assertPose(saved);
  toggleFreeCamera();
  assertPose(saved);
});

test("releasing over an already active camera keeps its activation and view", () => {
  globalThis.window = new EventTarget();
  const saved = { active: true, zoom: 2, panX: 10, panY: 20 };
  freeCameraState.set(saved);
  const borrowed = borrowFreeCamera();
  assert.deepEqual(borrowed, saved);
  zoomFreeCameraAt(-30, 45, 120);
  setFreeCameraView(freeCameraState.get().zoom, 900, 900);

  releaseFreeCamera(borrowed);
  assert.equal(freeCameraState.get().active, true);
  assertPose(saved);
});

test("a borrower that does not move the camera changes nothing", () => {
  globalThis.window = new EventTarget();
  freeCameraState.set({ active: true, zoom: 2, panX: 10, panY: 20 });
  let notifications = 0;
  const unsubscribe = freeCameraState.subscribe(() => {
    notifications += 1;
  });
  const borrowed = borrowFreeCamera();
  const afterBorrow = notifications;
  releaseFreeCamera(borrowed);
  unsubscribe();
  assert.equal(afterBorrow, 0, "borrowing an active camera must not notify");
  assert.equal(notifications, 0, "releasing an unchanged view must not notify");
  assert.deepEqual(freeCameraState.get(), { active: true, zoom: 2, panX: 10, panY: 20 });
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

test("free camera scales and moves the chart content bounds", () => {
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

test("free camera keeps game UI anchored to the preview viewport", () => {
  const viewport = previewViewport(1200, 900, 4 / 3);
  const screenView = {
    centerX: viewport.left + viewport.width / 2,
    centerY: viewport.top + viewport.height / 2,
    scale: viewport.scale,
  };
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
  const translations = translationsFor(screenView);
  const pause = gameUiLayout(
    viewport.width / viewport.scale,
    viewport.height / viewport.scale,
  ).find((item) => item.key === "pause");

  assert.ok(pause);
  assert.deepEqual(translations[0], {
    x: screenView.centerX + pause.x * screenView.scale,
    y: screenView.centerY - pause.y * screenView.scale,
  });
});

test("preview overlay passes the camera scale to game UI", () => {
  const fonts = [];
  const context = {
    canvas: {},
    save() {},
    restore() {},
    beginPath() {},
    rect() {},
    clip() {},
    translate() {},
    rotate() {},
    scale() {},
    fillRect() {},
    fillText(text) {
      if (text === "0000000") {
        fonts.push(this.font);
      }
    },
    measureText() {
      return { width: 10 };
    },
    drawImage() {},
    set font(value) {
      this._font = value;
    },
    get font() {
      return this._font;
    },
    set fillStyle(value) {},
    set globalAlpha(value) {},
    set textAlign(value) {},
    set textBaseline(value) {},
  };
  const device = new PreviewOverlayRenderDevice();
  device.drawGuideLayer = () => ({ durationMs: 0 });
  device.render({
    surface: {
      showGameUI: true,
      completionTimes: [],
      skin: null,
    },
    frame: {
      chart: { META: { name: "chart", level: "1" }, judgeLineList: [] },
      states: [],
      seconds: 0,
      selectedLine: -1,
      scale: 2,
      centerX: 600,
      centerY: 450,
      viewport: previewViewport(1200, 900, 4 / 3),
      shaderEffects: [],
    },
    target: context,
  });

  assert.deepEqual(fonts, ["98px Saira, 'Source Han Sans CN', sans-serif"]);
});

test("preview compositor sends game UI to the top overlay canvas", () => {
  const overlayCanvas = {};
  const originalRenderCanvas = PreviewOverlayRenderDevice.prototype.renderCanvas;
  const submitted = [];
  PreviewOverlayRenderDevice.prototype.renderCanvas = function (_surface, _frame, canvas) {
    submitted.push(canvas);
    return { durationMs: 0 };
  };
  try {
    drawComposite(
      {
        showGameUI: true,
        overlayCanvas,
        applyShaders: false,
        forceOpaque: true,
        opacity: 1,
        sharedNoteBatch: false,
        noteBatch: {},
        display: {
          kind: "workspace-underlay",
          setShaderOpacity() {},
          setPrimaryOpacity() {},
          setNoteBatchOpacity() {},
          setOverlayOpacity() {},
          setOverlayVisible() {},
        },
      },
      {
        context: { restore() {} },
        shaderEffects: [],
        viewport: previewViewport(1200, 900, 4 / 3),
      },
    );
  } finally {
    PreviewOverlayRenderDevice.prototype.renderCanvas = originalRenderCanvas;
  }
  assert.deepEqual(submitted, [overlayCanvas]);
});

test("free camera keeps the viewport clip while the white frame follows the camera", () => {
  const styleValues = new Map();
  const primary = {
    clientWidth: 800,
    clientHeight: 600,
    style: {},
    parentElement: {
      style: {
        setProperty(name, value) {
          styleValues.set(name, value);
        },
      },
    },
    getBoundingClientRect() {
      return { width: 800, height: 600 };
    },
  };
  const display = createPreviewDisplay(
    {
      primary: () => primary,
      shader: () => null,
      overlay: () => null,
    },
    "workspace-underlay",
  );
  const viewport = previewViewport(800, 600, 16 / 9);
  display.setViewportClip(
    viewport,
    1,
    previewCameraBounds(viewport, {
      active: true,
      zoom: 0.5,
      panX: 0,
      panY: 0,
    }),
  );

  assert.equal(primary.style.clipPath, "inset(75px 0px 75px 0px)");
  assert.equal(styleValues.get("--preview-frame-left"), "0px");
  assert.equal(styleValues.get("--preview-frame-top"), "75px");
  assert.equal(styleValues.get("--preview-frame-width"), "800px");
  assert.equal(styleValues.get("--preview-frame-height"), "450px");
  assert.equal(styleValues.get("--free-camera-frame-left"), "200px");
  assert.equal(styleValues.get("--free-camera-frame-top"), "112.5px");
  assert.equal(styleValues.get("--free-camera-frame-width"), "400px");
  assert.equal(styleValues.get("--free-camera-frame-height"), "225px");
});
