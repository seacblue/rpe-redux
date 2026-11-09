/** Checks chart-frame request normalization and data URL sizing. */
import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizePreviewFrameRequest,
  previewFrameDataUrlBytes,
} from "../../../core/edit/preview/frame.ts";

test("a time request keeps the default 16:9 frame", () => {
  const spec = normalizePreviewFrameRequest({ seconds: 12.5 });
  assert.deepEqual(spec, {
    seconds: 12.5,
    beat: null,
    width: 960,
    height: 540,
    format: "png",
    quality: 0.92,
  });
});

test("a beat triple selects the frame and reduces the triple", () => {
  const spec = normalizePreviewFrameRequest({ beat: [16, 2, 4] });
  assert.equal(spec.seconds, null);
  assert.deepEqual(spec.beat, [16, 1, 2]);
});

test("a beat number becomes a reduced triple", () => {
  const spec = normalizePreviewFrameRequest({ beat: 12.5 });
  assert.deepEqual(spec.beat, [12, 1, 2]);
});

test("an explicit width derives a 16:9 height", () => {
  const spec = normalizePreviewFrameRequest({ seconds: 0, width: 1280 });
  assert.equal(spec.width, 1280);
  assert.equal(spec.height, 720);
});

test("an explicit height derives a 16:9 width", () => {
  const spec = normalizePreviewFrameRequest({ seconds: 0, height: 360 });
  assert.equal(spec.width, 640);
  assert.equal(spec.height, 360);
});

test("frame encoding options are validated", () => {
  const spec = normalizePreviewFrameRequest({
    seconds: 1,
    width: 640,
    height: 360,
    format: "webp",
    quality: 0.5,
  });
  assert.equal(spec.format, "webp");
  assert.equal(spec.quality, 0.5);
});

test("exactly one of seconds and beat is required", () => {
  assert.throws(() => normalizePreviewFrameRequest({}), /exactly one/);
  assert.throws(() => normalizePreviewFrameRequest({ seconds: 1, beat: 2 }), /exactly one/);
});

test("unsupported geometry and formats are rejected", () => {
  assert.throws(() => normalizePreviewFrameRequest({ seconds: 1, width: 15, height: 15 }), /width/);
  assert.throws(
    () => normalizePreviewFrameRequest({ seconds: 1, width: 1280, height: 720, format: "gif" }),
    /format/,
  );
  assert.throws(
    () => normalizePreviewFrameRequest({ seconds: 1, width: 1920, height: 1080 }),
    /area/,
  );
});

test("data URL byte length excludes the base64 overhead", () => {
  assert.equal(previewFrameDataUrlBytes("data:image/png;base64,AAAA"), 3);
  assert.equal(previewFrameDataUrlBytes("data:image/png;base64,AAA="), 2);
  assert.equal(previewFrameDataUrlBytes("data:image/png;base64,AA=="), 1);
});
