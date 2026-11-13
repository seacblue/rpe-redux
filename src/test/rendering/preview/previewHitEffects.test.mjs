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
import { previewNoteWidth } from "../../../frontend/screens/editor/workspace/preview/scene/constants.ts";
import { drawHitEffects } from "../../../frontend/screens/editor/workspace/preview/drawing/previewHitEffects.ts";

test("the standard 175 setting matches the Recorder note width", () => {
  assert.ok(Math.abs(previewNoteWidth(175) - 175.21875) < 1e-9);
  assert.ok(previewNoteWidth(175) >= 131 * 1.2);
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
    noteSize: 175,
    hitEffectScale: 1,
    effectsSince: 0,
    defaultParticleColor: [255, 255, 255],
    hitStateCache: new Map(),
  };
  drawHitEffects(surface, frame);
  const first = pictures.at(-1);
  const effectWidth = previewNoteWidth(175) * 1.4;
  assert.equal(first[1] + first[3] / 2, 300);
  assert.equal(first[3], effectWidth);
  surface.hitEffectScale = 2;
  drawHitEffects(surface, frame);
  assert.equal(pictures.at(-1)[3], effectWidth * 2);
  assert.equal(pictures.at(-1)[1] + pictures.at(-1)[3] / 2, 300);
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
    noteSize: 175,
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
      noteSize: 175,
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
