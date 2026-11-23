/**
 * Recording unit coverage: timeline sampling, audio scheduling, PCM framing, and
 * the snapshot captured when an export starts.
 *
 * The desktop encoder itself is covered by the packaged application smoke run;
 * these checks keep the pure calculations independent of WebView and FFmpeg.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  captureRecordingAudio,
  mixRecordingAudio,
  recordingSampleCount,
} from "../../../frontend/screens/editor/workspace/recording/recordingAudio.ts";
import { recordingPcmChunks } from "../../../frontend/screens/editor/workspace/recording/recordingPcm.ts";
import { captureRecording } from "../../../frontend/screens/editor/workspace/recording/recordingJob.ts";
import {
  formatRecordingTime,
  parseRecordingTime,
} from "../../../frontend/screens/editor/workspace/recording/recordingTime.ts";
import { RecordingTimeline } from "../../../frontend/screens/editor/workspace/recording/recordingTimeline.ts";
import { selectRecordingVideoConfig } from "../../../frontend/screens/editor/workspace/recording/recordingVideoEncoder.ts";

test("samples the selected song interval against the chart offset", () => {
  const timeline = new RecordingTimeline({ start: 1, end: 2, fps: 30, chartOffsetMs: 250 });
  assert.equal(timeline.frameCount, 30);
  assert.deepEqual(timeline.frame(0), {
    index: 0,
    songSeconds: 1,
    chartSeconds: 0.75,
    timestampUs: 0,
  });
  assert.equal(timeline.frame(29).songSeconds, 1 + 29 / 30);
  assert.equal(timeline.frame(29).timestampUs, 966667);
  assert.throws(() => timeline.frame(30), RangeError);
});

test("scales song time per output frame while keeping the frame rate", () => {
  const fast = new RecordingTimeline({
    start: 1,
    end: 3,
    fps: 30,
    chartOffsetMs: 250,
    speed: 2,
  });
  assert.equal(fast.frameCount, 30);
  assert.equal(fast.frameCount / fast.options.fps, 1);
  assert.equal(fast.frame(1).songSeconds, 1 + 2 / 30);
  assert.ok(Math.abs(fast.frame(1).chartSeconds - (1 + 2 / 30 - 0.25)) < 1e-12);
  assert.equal(fast.frame(1).timestampUs, 33333);

  const slow = new RecordingTimeline({
    start: 0,
    end: 2,
    fps: 30,
    chartOffsetMs: 0,
    speed: 0.5,
  });
  assert.equal(slow.frameCount, 120);
  assert.equal(slow.frameCount / slow.options.fps, 4);
  assert.equal(slow.frame(1).songSeconds, 0.5 / 30);
  assert.equal(slow.frame(119).timestampUs, 3966667);
});

test("audio covers the source span shortened by the playback speed", () => {
  const normal = new RecordingTimeline({ start: 0, end: 12, fps: 30, chartOffsetMs: 0 });
  assert.equal(normal.frameCount, 360);
  assert.equal(recordingSampleCount(normal), 576000);

  const fast = new RecordingTimeline({
    start: 0,
    end: 12,
    fps: 30,
    chartOffsetMs: 0,
    speed: 2,
  });
  assert.equal(fast.frameCount, 180);
  assert.equal(recordingSampleCount(fast), recordingSampleCount(normal));

  const slow = new RecordingTimeline({
    start: 0,
    end: 12,
    fps: 30,
    chartOffsetMs: 0,
    speed: 0.5,
  });
  assert.equal(slow.frameCount, 720);
  assert.equal(recordingSampleCount(slow), recordingSampleCount(normal));
});

test("uses a half-open interval and avoids accumulated timestamp rounding", () => {
  const timeline = new RecordingTimeline({ start: 0, end: 60.01, fps: 60, chartOffsetMs: -100 });
  assert.equal(timeline.frameCount, 3601);
  assert.equal(timeline.frame(3600).timestampUs, 60_000_000);
  assert.equal(timeline.frame(0).chartSeconds, 0.1);
  const fractional = new RecordingTimeline({ start: 0, end: 0.001, fps: 60, chartOffsetMs: 0 });
  assert.equal(fractional.frameCount, 1);
});

test("rejects invalid recording intervals, frame rates, and speeds", () => {
  for (const options of [
    { start: -1, end: 1, fps: 60, chartOffsetMs: 0 },
    { start: 1, end: 1, fps: 60, chartOffsetMs: 0 },
    { start: 0, end: 1, fps: 29.97, chartOffsetMs: 0 },
    { start: 0, end: 1, fps: 60, chartOffsetMs: NaN },
    { start: 0, end: 1, fps: 60, chartOffsetMs: 0, speed: 0.49 },
    { start: 0, end: 1, fps: 60, chartOffsetMs: 0, speed: 4.01 },
    { start: 0, end: 1, fps: 60, chartOffsetMs: 0, speed: 0 },
    { start: 0, end: 1, fps: 60, chartOffsetMs: 0, speed: Number.NaN },
    { start: 0, end: 1, fps: 60, chartOffsetMs: 0, speed: Number.POSITIVE_INFINITY },
  ]) {
    assert.throws(() => new RecordingTimeline(options), RangeError);
  }
});

test("tolerates floating-point roundoff without losing a real trailing frame", () => {
  const exact = new RecordingTimeline({ start: 0, end: 0.14, fps: 100, chartOffsetMs: 0 });
  const after = new RecordingTimeline({ start: 0, end: 0.1400000001, fps: 100, chartOffsetMs: 0 });
  assert.equal(exact.frameCount, 14);
  assert.equal(after.frameCount, 15);
});

test("formats and parses recording range song times", () => {
  assert.equal(formatRecordingTime(0), "0:00.000");
  assert.equal(formatRecordingTime(83.456), "1:23.456");
  assert.equal(formatRecordingTime(3723.5), "1:02:03.500");
  assert.equal(parseRecordingTime("83.456"), 83.456);
  assert.equal(parseRecordingTime("1:23.456"), 83.456);
  assert.equal(parseRecordingTime("1:02:03.500"), 3723.5);
  assert.equal(parseRecordingTime("0:00"), 0);
  for (const value of ["", "abc", "-1", "1:-2", "1:2:3:4", "1.5:02"]) {
    assert.equal(parseRecordingTime(value), null, value);
  }
});

test("missing WebCodecs leaves the PNG fallback in charge", async () => {
  assert.equal(
    await selectRecordingVideoConfig({
      width: 1920,
      height: 1080,
      fps: 60,
      bitrateMbps: 12,
    }),
    null,
  );
});

test("renderer requests variable bitrate control from WebCodecs", async () => {
  const previous = globalThis.VideoEncoder;
  const configs = [];
  globalThis.VideoEncoder = {
    isConfigSupported: async (config) => {
      configs.push(config);
      return { supported: true, config };
    },
  };
  try {
    const config = await selectRecordingVideoConfig({
      width: 1920,
      height: 1080,
      fps: 60,
      bitrateMbps: 12,
    });
    assert.equal(config?.bitrateMode, "variable");
    assert.equal(configs[0]?.bitrate, 12_000_000);
    assert.equal(configs[0]?.bitrateMode, "variable");
  } finally {
    globalThis.VideoEncoder = previous;
  }
});

test("keeps hit sound tails continuous across a ten-second chunk boundary", async () => {
  const contexts = [];
  const previous = globalThis.OfflineAudioContext;
  globalThis.OfflineAudioContext = class {
    constructor(channels, length, sampleRate) {
      this.length = length;
      this.starts = [];
      this.destination = {};
      assert.equal(channels, 2);
      assert.equal(sampleRate, 48000);
      contexts.push(this);
    }
    createBufferSource() {
      const owner = this;
      return {
        buffer: null,
        connect(gain) {
          return gain;
        },
        start(when, offset) {
          owner.starts.push({ buffer: this.buffer, when, offset });
        },
      };
    }
    createGain() {
      return { gain: { value: 0 }, connect() {} };
    }
    async startRendering() {
      return { length: this.length };
    }
  };
  try {
    const music = { duration: 20 };
    const sound = { duration: 1 };
    const hits = {
      offsets: {},
      generation: 1,
      soundPolicy: { enabled: true, limit: 5 },
      soundVolumes: { tap: 0.5, drag: 0.5, flick: 0.5, custom: 0.5 },
      transport: { volume: 1 },
      loadSound: async () => sound,
    };
    const chart = {
      META: { offset: 0 },
      judgeLineList: [{ notes: [{ type: 1, startTime: [9, 8, 10] }] }],
    };
    const tempo = { seconds: ([whole, numerator, denominator]) => whole + numerator / denominator };
    const timeline = new RecordingTimeline({ start: 0, end: 12, fps: 30, chartOffsetMs: 0 });
    const chunks = [];
    const signal = new AbortController().signal;
    const snapshot = await captureRecordingAudio(
      timeline,
      chart,
      tempo,
      music,
      hits,
      signal,
      0.2,
      0.25,
    );
    assert.equal(snapshot.musicVolume, 0.2);
    assert.equal(snapshot.triggers[0].volume, 0.125);
    hits.soundVolumes.tap = 0;
    for await (const chunk of mixRecordingAudio(timeline, snapshot, signal)) {
      chunks.push(chunk);
    }
    assert.deepEqual(
      chunks.map((chunk) => chunk.length),
      [480000, 96000],
    );
    assert.equal(recordingSampleCount(timeline), 576000);
    assert.deepEqual(contexts[0].starts[0], { buffer: music, when: 0, offset: 0 });
    assert.deepEqual(contexts[1].starts[0], { buffer: music, when: 0, offset: 10 });
    assert.equal(contexts[0].starts[1].when, 9.8);
    assert.equal(contexts[1].starts[1].when, 0);
    assert.ok(Math.abs(contexts[1].starts[1].offset - 0.2) < 1e-9);
  } finally {
    globalThis.OfflineAudioContext = previous;
  }
});

test("interleaves stereo PCM samples across bounded chunks", () => {
  const channels = [Float32Array.from([0.25, -0.5, 1]), Float32Array.from([-1, 0.5, 0])];
  const chunks = [
    ...recordingPcmChunks(
      { length: 3, numberOfChannels: 2, getChannelData: (i) => channels[i] },
      2,
    ),
  ];
  assert.deepEqual(
    chunks.map((chunk) => chunk.length),
    [16, 8],
  );
  const values = chunks.flatMap((chunk) => {
    const view = new DataView(chunk.buffer, chunk.byteOffset, chunk.byteLength);
    return Array.from({ length: chunk.length / 4 }, (_, i) => view.getFloat32(i * 4, true));
  });
  assert.deepEqual(values, [0.25, -1, -0.5, 0.5, 1, 0]);
});

test("duplicates mono PCM and rejects invalid channel data", () => {
  const mono = Float32Array.from([0.5]);
  const [chunk] = recordingPcmChunks({
    length: 1,
    numberOfChannels: 1,
    getChannelData: () => mono,
  });
  assert.equal(new DataView(chunk.buffer).getFloat32(4, true), 0.5);
  assert.throws(
    () => [...recordingPcmChunks({ length: 2, numberOfChannels: 1, getChannelData: () => mono })],
    RangeError,
  );
});

test("captures chart, appearance, and sound settings at the request", async () => {
  const chart = JSON.parse(
    readFileSync(new URL("../../fixtures/smoke.json", import.meta.url), "utf8"),
  );
  const oldName = chart.META.name;
  const music = { duration: 5 };
  const sounds = {
    offsets: {},
    generation: 1,
    soundPolicy: { enabled: false, limit: 1 },
    soundVolumes: { tap: 1, drag: 1, flick: 1, custom: 1 },
    transport: { volume: 1 },
    loadSound: async () => null,
  };
  const skin = { dispose() {} };
  const runtime = {
    session: { chart },
    audio: { buffer: music },
    preview: {
      noteSize: 1,
      hitEffectScale: 1.25,
      lineScale: 1,
      backgroundAlpha: 1,
      backgroundBrightness: 1,
      backgroundBlur: 0,
      defaultLineColor: [255, 255, 255],
      defaultParticleColor: [255, 255, 255],
    },
    providers: {
      preview: {
        skin: { cloneForRecording: () => skin },
        images: { generation: 1, records: new Map(), backgroundName: "" },
        hitSounds: sounds,
      },
    },
  };
  const snapshot = captureRecording(
    runtime,
    {
      width: 1280,
      height: 720,
      fps: 30,
      speed: 1,
      videoBitrate: 12,
      musicVolume: 0.4,
      effectsVolume: 0.5,
      start: 0,
      end: 1,
    },
    new AbortController().signal,
  );
  chart.META.name = "Changed";
  runtime.preview.defaultLineColor[0] = 0;
  runtime.preview.hitEffectScale = 2;
  sounds.transport.volume = 0;
  const [images, audio] = await snapshot.pending;
  assert.equal((await snapshot.chart).META.name, oldName);
  assert.equal(snapshot.reference.defaultLineColor[0], 255);
  assert.equal(snapshot.reference.hitEffectScale, 1.25);
  assert.equal(audio.musicVolume, 0.4);
  images.dispose();
});
