/** Frame capture orchestration: unit conversion, caching, and cleanup. */
import assert from "node:assert/strict";
import test from "node:test";
import { normalizePreviewFrameRequest } from "../../../core/edit/preview/frame.ts";
import { PreviewFrameCapture } from "../../../frontend/screens/editor/workspace/preview/frame/frameCapture.ts";

function fakePreview() {
  return {
    noteSize: 175,
    hitEffectScale: 1,
    lineScale: 1.4,
    backgroundEnabled: true,
    backgroundAlpha: 0.35,
    backgroundBrightness: 1,
    backgroundBlur: 10.5,
    defaultLineColor: [0, 0, 0],
    defaultParticleColor: [0, 0, 0],
    highlight: false,
    showHitEffects: true,
    showGameUI: true,
    gameUiCornerCompression: 0,
  };
}

function fakeSkin() {
  return {
    textureRevision: 1,
    cloneForRecording() {
      return { dispose() {} };
    },
  };
}

function chart(bpm = 120) {
  return {
    BPMList: [{ bpm, startTime: [0, 0, 1] }],
    judgeLineList: [],
  };
}

function captureFixture() {
  const created = [];
  const disposed = [];
  const prepared = [];
  const encoded = [];
  let currentChart = chart();
  const capture = new PreviewFrameCapture({
    preview: fakePreview(),
    skin: fakeSkin(),
    images: { generation: 0 },
    chart: () => currentChart,
    tempo: () => ({
      seconds: (beat) => (Array.isArray(beat) ? beat[0] + beat[1] / beat[2] : beat) * 0.5,
      beat: (seconds) => seconds * 2,
    }),
    duration: () => 120,
    createRenderer: (options) => {
      created.push(options);
      const renderer = {
        async prepare(signal) {
          prepared.push(signal.aborted);
        },
        frameDataUrl(seconds, format, quality) {
          encoded.push({ seconds, format, quality });
          return "data:image/png;base64,AAAA";
        },
        dispose() {
          disposed.push(options.width);
        },
      };
      return renderer;
    },
  });
  return {
    capture,
    created,
    disposed,
    prepared,
    encoded,
    setChart: (next) => {
      currentChart = next;
    },
  };
}

test("a time request resolves the numeric beat and forwards the encoding", async () => {
  const fixture = captureFixture();
  try {
    const frame = await fixture.capture.capture(
      normalizePreviewFrameRequest({ seconds: 1, format: "webp", quality: 0.5 }),
    );
    assert.equal(frame.seconds, 1);
    assert.deepEqual(frame.beat, [2, 0, 1]);
    assert.equal(frame.byteLength, 3);
    assert.deepEqual(fixture.encoded, [{ seconds: 1, format: "webp", quality: 0.5 }]);
  } finally {
    fixture.capture.dispose();
  }
});

test("a beat request resolves the numeric seconds", async () => {
  const fixture = captureFixture();
  try {
    const frame = await fixture.capture.capture(normalizePreviewFrameRequest({ beat: [3, 0, 1] }));
    assert.equal(frame.seconds, 1.5);
    assert.deepEqual(frame.beat, [3, 0, 1]);
    assert.deepEqual(fixture.encoded, [{ seconds: 1.5, format: "png", quality: 0.92 }]);
  } finally {
    fixture.capture.dispose();
  }
});

test("the same chart, geometry, skin, and image generation reuse one renderer", async () => {
  const fixture = captureFixture();
  try {
    await fixture.capture.capture(normalizePreviewFrameRequest({ seconds: 1 }));
    await fixture.capture.capture(normalizePreviewFrameRequest({ seconds: 2 }));
    assert.equal(fixture.created.length, 1);
    assert.equal(fixture.prepared.length, 1);
    assert.equal(fixture.encoded.length, 2);
  } finally {
    fixture.capture.dispose();
  }
});

test("a chart revision change rebuilds and disposes the old renderer", async () => {
  const fixture = captureFixture();
  try {
    await fixture.capture.capture(normalizePreviewFrameRequest({ seconds: 1 }));
    fixture.setChart(chart(180));
    await fixture.capture.capture(normalizePreviewFrameRequest({ seconds: 1 }));
    assert.equal(fixture.created.length, 2);
    assert.deepEqual(fixture.disposed, [960]);
  } finally {
    fixture.capture.dispose();
  }
});
