/** Checks preview size calibration and hit effects at event boundaries. */
import assert from "node:assert/strict";
import test from "node:test";
import { EventTrack } from "../../../core/global/chart/timing/events.ts";
import {
  createChart,
  createEvent,
  createLine,
  createNote,
} from "../../../core/global/chart/chart.ts";
import { SceneRuntime } from "../../../core/global/chart/runtime/scene.ts";
import { TempoMap } from "../../../core/global/chart/timing/tempo.ts";
import {
  DEFAULT_LINE_HEIGHT,
  DEFAULT_LINE_WIDTH,
  PHIRA_HIT_FX_WIDTH_RATIO,
  previewNoteWidth,
} from "../../../frontend/screens/editor/workspace/preview/scene/constants.ts";
import {
  HOLD_HIT_INTERVAL,
  recentHits,
} from "../../../frontend/screens/editor/workspace/preview/drawing/hitEffects.ts";
import { drawHitEffects } from "../../../frontend/screens/editor/workspace/preview/drawing/previewHitEffects.ts";

test("note scale 1 matches Phira's authored note width", () => {
  assert.ok(Math.abs(previewNoteWidth(1) - 177.862716) < 1e-6);
  assert.ok(previewNoteWidth(0.8) < previewNoteWidth(1));
  assert.ok(previewNoteWidth(1.2) > previewNoteWidth(1));
});

test("hit-effect sprite width matches Phira's full particle quad", () => {
  assert.ok(Math.abs(PHIRA_HIT_FX_WIDTH_RATIO - 1 / (5 * 0.13175016)) < 1e-12);
});

test("preview line defaults match Phira's RPE logical geometry", () => {
  assert.equal(DEFAULT_LINE_WIDTH, 4000);
  assert.equal(DEFAULT_LINE_HEIGHT, 6.75);
});

test("bpmfactor scales Hold pulse frequency without moving its time", () => {
  const entry = { start: 1, end: 3, note: { type: 2 } };
  const runtime = (holdHitRate) => ({
    hitTimes: [entry],
    holdIndex: { query: () => [{ item: entry, index: 0 }] },
    holdHitRate,
  });
  const base = recentHits(runtime(1), 1.5, 0);
  const fast = recentHits(runtime(2), 1.5, 0);
  const slow = recentHits(runtime(0.5), 1.5, 0);
  assert.equal(base.length, 4);
  assert.equal(fast.length, 7);
  assert.equal(slow.length, 2);
  assert.ok(Math.abs(fast[1].time - fast[0].time - HOLD_HIT_INTERVAL / 2) < 1e-9);
  assert.ok(Math.abs(slow[1].time - slow[0].time - HOLD_HIT_INTERVAL * 2) < 1e-9);
  for (const hit of [...base, ...fast, ...slow]) {
    assert.ok(hit.time >= entry.start && hit.time <= entry.end);
  }
});

test("hit effects use the post-event position and the configured effect scale", () => {
  const tempo = { seconds: (beat) => beat };
  const track = new EventTrack(
    [
      { startTime: 0, endTime: 2, start: 10, end: 10 },
      { startTime: 2, endTime: 2, start: 10, end: 200 },
    ],
    tempo,
  );
  assert.equal(track.value(1.999), 10);
  assert.equal(track.value(2), 200);
  const hit = { start: 2, end: 2, note: { type: 1 } };
  const line = {
    hitTimes: [hit],
    holdIndex: { query: () => [] },
    noteState: () => ({ x: 0, y: 0 }),
  };
  const scene = {
    lines: [line],
    sampler: (time) => () => ({ x: track.value(time), y: 0, rotation: 0 }),
  };
  const pictures = [];
  const context = { drawImage: (...args) => pictures.push(args), fillRect() {} };
  const frame = {
    context,
    scene,
    order: [0],
    seconds: 2.1,
    width: 200,
    height: 200,
    scale: 1,
    scaleX: 1,
    scaleY: 1,
  };
  const surface = {
    skin: { particleFrameCount: 30, tinted: () => ({}) },
    noteSize: 1,
    hitEffectScale: 1,
    effectsSince: 0,
    defaultParticleColor: [255, 255, 255],
    hitStateCache: new Map(),
  };
  drawHitEffects(surface, frame);
  const first = pictures.at(-1);
  const effectWidth = previewNoteWidth(1) * PHIRA_HIT_FX_WIDTH_RATIO;
  assert.equal(first[1] + first[3] / 2, 300);
  assert.equal(first[3], effectWidth);
  surface.hitEffectScale = 2;
  drawHitEffects(surface, frame);
  assert.equal(pictures.at(-1)[3], effectWidth * 2);
  assert.equal(pictures.at(-1)[1] + pictures.at(-1)[3] / 2, 300);
});

test("skin hit-fx metadata controls the frame, tint, scale, particles, and rotation", () => {
  const hit = { start: 2, end: 2, note: { type: 1, above: 0 } };
  const line = {
    hitTimes: [hit],
    holdIndex: { query: () => [] },
    noteState: () => ({ x: 0, y: 0 }),
  };
  const tinted = [];
  const transforms = [];
  const bursts = [];
  const surface = {
    skin: {
      particleFrameCount: 4,
      hitFxDuration: 0.4,
      hitFxScale: 2,
      hitFxRotate: true,
      hitFxTinted: false,
      hideParticles: true,
      tinted: (name, color) => {
        tinted.push({ name, color });
        return {};
      },
    },
    noteSize: 1,
    hitEffectScale: 1,
    effectsSince: 0,
    defaultParticleColor: [255, 0, 0],
  };
  drawHitEffects(surface, {
    context: {
      drawImage: () => {},
      fillRect: (...args) => bursts.push(args),
      save: () => transforms.push("save"),
      restore: () => transforms.push("restore"),
      translate: () => transforms.push("translate"),
      rotate: (angle) => transforms.push(angle),
    },
    scene: {
      lines: [line],
      sampler: () => () => ({ x: 0, y: 0, rotation: 90 }),
    },
    order: [0],
    seconds: 2.1,
    width: 200,
    height: 200,
    scale: 1,
    scaleX: 1,
    scaleY: 1,
  });

  assert.equal(tinted[0].name, "img-2");
  assert.deepEqual(tinted[0].color, [255, 255, 255]);
  assert.deepEqual(transforms, ["save", "translate", (3 * Math.PI) / 2, "restore"]);
  assert.equal(bursts.length, 0);
});

test("procedural particles can be hidden while the skin animation remains", () => {
  const hit = { start: 2, end: 2, note: { type: 1 } };
  const line = {
    hitTimes: [hit],
    holdIndex: { query: () => [] },
    noteState: () => ({ x: 0, y: 0 }),
  };
  const pictures = [];
  const bursts = [];
  const active = drawHitEffects(
    {
      skin: { particleFrameCount: 4, hitFxDuration: 0.4, tinted: () => ({}) },
      noteSize: 1,
      hitEffectScale: 1,
      effectsSince: 0,
      showHitParticles: false,
      defaultParticleColor: [255, 255, 255],
    },
    {
      context: {
        drawImage: (...args) => pictures.push(args),
        fillRect: (...args) => bursts.push(args),
      },
      scene: {
        lines: [line],
        sampler: () => () => ({ x: 0, y: 0, rotation: Math.PI / 2 }),
      },
      order: [0],
      seconds: 2.1,
      effectTime: 10.1,
      width: 200,
      height: 200,
      scale: 1,
      scaleX: 1,
      scaleY: 1,
    },
  );

  assert.equal(active, true);
  assert.equal(pictures.length, 1);
  assert.equal(bursts.length, 0);
});

test("hit effects keep animating when chart time is paused", () => {
  const hit = { start: 2, end: 2, note: { type: 1 } };
  const line = {
    hitTimes: [hit],
    holdIndex: { query: () => [] },
    noteState: () => ({ x: 0, y: 0 }),
  };
  const frames = [];
  const surface = {
    skin: { particleFrameCount: 4, hitFxDuration: 0.4, tinted: (name) => name },
    noteSize: 1,
    hitEffectScale: 1,
    effectsSince: 0,
    showHitParticles: false,
    defaultParticleColor: [255, 255, 255],
    hitStateCache: new Map(),
  };
  const base = {
    context: { drawImage: (...args) => frames.push(args), fillRect() {} },
    scene: {
      lines: [line],
      sampler: () => () => ({ x: 0, y: 0, rotation: 0 }),
    },
    order: [0],
    seconds: 2.1,
    width: 200,
    height: 200,
    scale: 1,
    scaleX: 1,
    scaleY: 1,
  };

  assert.equal(drawHitEffects(surface, { ...base, effectTime: 10.01 }), true);
  assert.equal(frames.at(-1)[0], "img-1");
  assert.equal(drawHitEffects(surface, { ...base, effectTime: 10.21 }), true);
  assert.equal(frames.at(-1)[0], "img-4");
  assert.equal(drawHitEffects(surface, { ...base, effectTime: 10.31 }), false);
  assert.equal(drawHitEffects(surface, { ...base, effectTime: 10.32 }), false);
});

test("seeking does not interrupt an effect that is already playing", () => {
  const hit = { start: 2, end: 2, note: { type: 1 } };
  const line = {
    hitTimes: [hit],
    holdIndex: { query: () => [] },
    noteState: () => ({ x: 0, y: 0 }),
  };
  const frames = [];
  const surface = {
    skin: { particleFrameCount: 4, hitFxDuration: 0.4, tinted: (name) => name },
    noteSize: 1,
    hitEffectScale: 1,
    effectsSince: 0,
    hitEffectEpoch: 0,
    showHitParticles: false,
    defaultParticleColor: [255, 255, 255],
    hitStateCache: new Map(),
  };
  const base = {
    context: { drawImage: (...args) => frames.push(args), fillRect() {} },
    scene: {
      lines: [line],
      sampler: () => () => ({ x: 0, y: 0, rotation: 0 }),
    },
    order: [0],
    width: 200,
    height: 200,
    scale: 1,
    scaleX: 1,
    scaleY: 1,
  };

  assert.equal(drawHitEffects(surface, { ...base, seconds: 2.1, effectTime: 20 }), true);
  surface.effectsSince = 20;
  surface.hitEffectEpoch = 1;
  assert.equal(drawHitEffects(surface, { ...base, seconds: 20, effectTime: 20.1 }), true);
  surface.effectsSince = 0;
  surface.hitEffectEpoch = 2;
  assert.equal(drawHitEffects(surface, { ...base, seconds: 1, effectTime: 20.2 }), true);
  assert.equal(frames.length, 3);
});

test("minimal hit-effect surfaces do not retain sampled positions across frames", () => {
  const hit = { start: 1, end: 1, note: { type: 1 } };
  const line = {
    hitTimes: [hit],
    holdIndex: { query: () => [] },
    noteState: () => ({ x: 0, y: 0 }),
  };
  let x = 10;
  const pictures = [];
  const surface = {
    skin: { particleFrameCount: 30, tinted: () => ({}) },
    noteSize: 1,
    hitEffectScale: 1,
    effectsSince: 0,
    defaultParticleColor: [255, 255, 255],
  };
  const frame = {
    context: { drawImage: (...args) => pictures.push(args), fillRect() {} },
    scene: {
      lines: [line],
      sampler: () => () => ({ x, y: 0, rotation: 0 }),
    },
    order: [0],
    seconds: 1.1,
    width: 200,
    height: 200,
    scale: 1,
    scaleX: 1,
    scaleY: 1,
  };
  drawHitEffects(surface, frame);
  const firstCenter = pictures.at(-1)[1] + pictures.at(-1)[3] / 2;
  x = 80;
  drawHitEffects(surface, frame);
  const secondCenter = pictures.at(-1)[1] + pictures.at(-1)[3] / 2;
  assert.equal(firstCenter, 110);
  assert.equal(secondCenter, 180);
});

test("timeline-visible previews do not draw hit effects", () => {
  const hit = { start: 1, end: 1, note: { type: 1 } };
  const line = {
    hitTimes: [hit],
    holdIndex: { query: () => [] },
    noteState: () => ({ x: 0, y: 0 }),
  };
  const pictures = [];
  const bursts = [];
  drawHitEffects(
    {
      skin: { particleFrameCount: 30, tinted: () => ({}) },
      noteSize: 1,
      hitEffectScale: 1,
      effectsSince: 0,
      defaultParticleColor: [255, 255, 255],
      authoringRegionVisible: true,
    },
    {
      context: {
        drawImage: (...args) => pictures.push(args),
        fillRect: (...args) => bursts.push(args),
      },
      scene: {
        lines: [line],
        sampler: () => () => ({ x: 0, y: 0, rotation: 0 }),
      },
      order: [0],
      seconds: 1.1,
      width: 200,
      height: 200,
      scale: 1,
      scaleX: 1,
      scaleY: 1,
    },
  );

  assert.equal(pictures.length, 0);
  assert.equal(bursts.length, 0);
});

test("hit particle travel scales with the projected chart frame", () => {
  const hit = { start: 2, end: 2, note: { type: 1 } };
  const line = {
    hitTimes: [hit],
    holdIndex: { query: () => [] },
    noteState: () => ({ x: 0, y: 0 }),
  };
  const scene = {
    lines: [line],
    sampler: () => () => ({ x: 0, y: 0, rotation: 0 }),
  };
  const surface = {
    skin: null,
    noteSize: 1,
    hitEffectScale: 1,
    effectsSince: 0,
    defaultParticleColor: [255, 255, 255],
    hitStateCache: new Map(),
  };
  const run = (scale) => {
    const bursts = [];
    drawHitEffects(surface, {
      context: { drawImage() {}, fillRect: (...args) => bursts.push(args) },
      scene,
      order: [0],
      seconds: 2.1,
      width: 800,
      height: 600,
      scale,
      scaleX: scale,
      scaleY: scale,
      centerX: 400,
      centerY: 300,
      effectTime: 10,
    });
    return bursts;
  };
  const base = run(800 / 1350);
  const half = run(400 / 1350);
  const center = (rect) => rect[0] + rect[2] / 2;
  const offsetSum = (bursts) => bursts.reduce((sum, rect) => sum + Math.abs(center(rect) - 400), 0);

  assert.ok(Math.abs(offsetSum(half) / offsetSum(base) - 0.5) < 1e-9);
  assert.ok(Math.abs(base[0][2] / half[0][2] - 2) < 1e-9);
});

test("a hit samples both the line and its parent after simultaneous teleports", () => {
  const chart = createChart();
  const parent = chart.judgeLineList[0];
  const child = createLine("Child");
  parent.eventLayers[0].moveXEvents = [createEvent(0, 0, 0, 14), createEvent(0, 200, 14, 14)];
  child.eventLayers[0].moveXEvents = [createEvent(0, 0, 0, 14), createEvent(0, 50, 14, 14)];
  child.father = 0;
  child.notes = [createNote(1, 14, 0)];
  chart.judgeLineList.push(child);
  const tempo = new TempoMap(chart.BPMList);
  const scene = new SceneRuntime();
  scene.compile(chart, tempo);
  const hitTime = tempo.seconds(14);
  const pictures = [];
  drawHitEffects(
    {
      skin: { particleFrameCount: 30, tinted: () => ({}) },
      noteSize: 1,
      hitEffectScale: 1,
      effectsSince: 0,
      defaultParticleColor: [255, 255, 255],
    },
    {
      context: { drawImage: (...args) => pictures.push(args), fillRect() {} },
      scene,
      order: scene.order,
      seconds: hitTime + 0.1,
      width: 200,
      height: 200,
      scale: 1,
      scaleX: 1,
      scaleY: 1,
    },
  );
  assert.equal(pictures.length, 1);
  assert.equal(pictures[0][1] + pictures[0][3] / 2, 350);
});
