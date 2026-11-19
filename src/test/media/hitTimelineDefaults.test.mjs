/** The built-in hit sound follows a note's type; an authored custom sound overrides it. */
import assert from "node:assert/strict";
import test from "node:test";
import { createChart, createNote } from "../../core/global/chart/chart.ts";
import { EditorSession } from "../../core/edit/session/session.ts";
import { TempoMap } from "../../core/global/chart/timing/tempo.ts";
import {
  defaultHitSound,
  hitTimeline,
  isBuiltInHitSound,
  noteHitSound,
} from "../../core/media/hitTimeline.ts";

/** A one-line 120 BPM chart with the supplied notes. */
function chartWith(notes) {
  const chart = createChart();
  chart.BPMList = [{ bpm: 120, startTime: [0, 0, 1] }];
  chart.META.offset = 0;
  chart.judgeLineList[0].notes = notes;
  return chart;
}

/** The trigger sounds a chart produces, in time order. */
function sounds(chart) {
  return hitTimeline(chart, new TempoMap(chart.BPMList)).map((entry) => entry.sound);
}

test("each note type names its built-in hit sound", () => {
  assert.equal(defaultHitSound(1), "tap");
  assert.equal(defaultHitSound(2), "tap");
  assert.equal(defaultHitSound(3), "flick");
  assert.equal(defaultHitSound(4), "drag");
});

test("a note without a custom sound plays its type's built-in sound", () => {
  assert.deepEqual(
    sounds(
      chartWith([
        createNote(1, 2, 0),
        createNote(2, 4, 0),
        createNote(3, 6, 0),
        createNote(4, 8, 0),
      ]),
    ),
    ["tap", "tap", "flick", "drag"],
  );
});

test("changing a note's type changes its trigger sound immediately", () => {
  const chart = chartWith([createNote(1, 2, 0)]);
  const session = new EditorSession(chart);
  session.selection = new Set([0]);

  session.transformSelection("type", (note) => ({ ...note, type: 4 }));
  assert.deepEqual(sounds(session.chart), ["drag"]);
});

test("an authored custom sound overrides the type default", () => {
  assert.deepEqual(sounds(chartWith([{ ...createNote(1, 2, 0), hitsound: "hit.ogg" }])), [
    "hit.ogg",
  ]);
  assert.deepEqual(sounds(chartWith([{ ...createNote(4, 2, 0), hitSound: "hit.ogg" }])), [
    "hit.ogg",
  ]);
});

test("a Hold hit-sound keyword sounds as the tap channel", () => {
  assert.deepEqual(sounds(chartWith([{ ...createNote(2, 2, 0), hitsound: "hold" }])), ["tap"]);
});

test("an empty custom value falls back to the type default", () => {
  assert.deepEqual(sounds(chartWith([{ ...createNote(3, 2, 0), hitSound: "" }])), ["flick"]);
});

test("the custom sound reader prefers the RPE field and ignores empty values", () => {
  assert.equal(noteHitSound({ hitsound: "rpe.ogg", hitSound: "redux.ogg" }), "rpe.ogg");
  assert.equal(noteHitSound({ hitSound: "redux.ogg" }), "redux.ogg");
  assert.equal(noteHitSound({ hitSound: "" }), undefined);
  assert.equal(noteHitSound({}), undefined);
});

test("built-in hit-sound names cover the note kinds", () => {
  for (const name of ["tap", "drag", "flick", "hold"]) {
    assert.equal(isBuiltInHitSound(name), true);
  }
  for (const name of ["hit.ogg", "Tap", ""]) {
    assert.equal(isBuiltInHitSound(name), false);
  }
});
