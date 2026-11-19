/**
 * A covering judge line must not hide a Hold whose tail has crossed to the far
 * side of the line. Speed flips the painted direction, so "behind the line"
 * has to be judged on the painted geometry rather than on the tail alone.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { createChart, createEvent, createNote } from "../../../core/global/chart/chart.ts";
import { SceneRuntime } from "../../../core/global/chart/runtime/scene.ts";
import { TempoMap } from "../../../core/global/chart/timing/tempo.ts";

/** Compile one cover line holding a Hold from beat 2 to beat 4. */
function sceneWith(noteSpeed, speedEvents) {
  const chart = createChart();
  const line = chart.judgeLineList[0];
  line.isCover = 1;
  line.notes = [createNote(2, 2, 0, 4)];
  line.notes[0].speed = noteSpeed;
  line.eventLayers[0].speedEvents = speedEvents;
  const tempo = new TempoMap(chart.BPMList);
  const scene = new SceneRuntime();
  scene.compile(chart, tempo);
  return {
    scene,
    tempo,
    runtime: scene.lines[0],
    entry: scene.lines[0].notes[0],
    speed: noteSpeed,
  };
}

/** Visibility of the Hold, plus its painted head and tail distances, at `beat`. */
function sampleAt({ scene, tempo, runtime, entry, speed }, beat) {
  const seconds = tempo.seconds(beat);
  const state = scene.sample(seconds)[0];
  const holds = [];
  runtime.visibleNotes(seconds, state, 1000, [], holds);
  return {
    visible: holds.length === 1,
    head: (entry.floor - state.floor) * speed,
    tail: (entry.tail - state.floor) * speed,
  };
}

test("a Hold survives the line flipping to a negative speed at its judgement", () => {
  const case1 = sceneWith(1, [createEvent(10, 10, 0, 2), createEvent(-10, -10, 2, 9)]);

  const before = sampleAt(case1, 1.5);
  assert.equal(before.visible, true, "the Hold is visible while approaching");
  assert.ok(before.head > 0, "its head is still in front of the line");

  // At its judgement the line starts running backwards, so the tail drops
  // behind the line and climbs back toward it until the Hold ends.
  const after = sampleAt(case1, 2.2);
  assert.equal(after.visible, true, "the Hold stays visible after the flip");
  assert.ok(after.tail < 0, "the tail sits behind the line");
  assert.ok(after.head > 0, "the head is still in front of the line");

  const climbing = sampleAt(case1, 3.5);
  assert.equal(climbing.visible, true, "the tail keeps climbing into view");
  assert.ok(climbing.tail > after.tail, "the tail approaches the line");

  assert.equal(sampleAt(case1, 4.5).visible, false, "an expired Hold is dropped");
});

test("a covering line still hides a Hold that is entirely behind it", () => {
  const case1 = sceneWith(1, [createEvent(-10, -10, 0, 9)]);

  const behind = sampleAt(case1, 1);
  assert.equal(behind.visible, false, "both anchors are behind the line");
  assert.ok(behind.head < 0 && behind.tail < 0, "the whole Hold is behind");

  const arrived = sampleAt(case1, 2.5);
  assert.equal(arrived.visible, true, "the head crossing the line reveals it");
});

test("a negative note speed mirrors the Hold against the same rule", () => {
  const case1 = sceneWith(-1, [createEvent(10, 10, 0, 9)]);

  // A mirrored Hold approaches from behind the line, so the cover hides it
  // until its head crosses to the front side.
  assert.equal(sampleAt(case1, 1.5).visible, false, "the whole Hold is behind");

  const arriving = sampleAt(case1, 2.5);
  assert.equal(arriving.visible, true, "the crossed head uncovers it");
  assert.ok(arriving.head > 0 && arriving.tail < 0, "the anchors straddle the line");

  assert.equal(sampleAt(case1, 6).visible, false, "the mirrored Hold expires");
});

test("positive speeds keep the previous cover behaviour", () => {
  const case1 = sceneWith(1, [createEvent(10, 10, 0, 9)]);
  assert.equal(sampleAt(case1, 1.5).visible, true, "an approaching Hold is visible");
  assert.equal(sampleAt(case1, 3).visible, true, "an active Hold is visible");
  assert.equal(sampleAt(case1, 5).visible, false, "an expired Hold is dropped");
});
