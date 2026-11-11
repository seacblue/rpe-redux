/**
 * Verifies the curve ghost cache key covers the draft, easing, division, and the
 * chart note list, and that a playback-like redraw loop builds the ghost once.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { createNote } from "../../../core/global/chart/chart.ts";
import { fromNumber } from "../../../core/global/chart/timing/beat.ts";
import {
  curvePlanCacheStats,
  planCurveNotes,
  resetCurvePlanCache,
} from "../../../core/global/chart/editing/curveNotes.ts";
import { createValue } from "../../../core/state/values.ts";
import { createCurveEditor } from "../../../frontend/screens/editor/inspector/curveNotes/curveEditor.ts";

const planOptions = {
  startTime: fromNumber(0),
  endTime: fromNumber(4),
  startX: -400,
  endX: 400,
  type: 4,
  division: 100,
  density: 10,
  easingType: 1,
};

/** Builds one anchor note at an exact beat and X. */
function anchorNote(beat, positionX) {
  return {
    ...createNote(4, beat, positionX),
    startTime: fromNumber(beat),
    endTime: fromNumber(beat),
  };
}

/** Creates a curve editor whose note list can be swapped between calls. */
function editorWithMutableNotes(getNotes) {
  const fields = createValue({ initial: null });
  const pickMode = createValue({ initial: null });
  const quick = createValue({ initial: null });
  const editor = createCurveEditor({
    state: { fields, pickMode, quick },
    getDivision: () => 100,
    getNotes,
    setPickMode: pickMode.set,
    activatePane: () => {},
    showSingleNoteTimeline: () => {},
    closePane: () => {},
    invalidate: () => {},
    notify: () => {},
    reportError: () => {},
    commit: () => {},
  });
  editor.openPanel();
  fields.get()?.onInput({
    startTime: [0, 0, 1],
    endTime: [4, 0, 1],
    startX: -400,
    endX: 400,
    density: 10,
    type: 4,
    easingType: 1,
  });
  return { editor, fields };
}

test("identical plan inputs reuse one generation but chart changes rebuild", () => {
  resetCurvePlanCache();
  const notes = [];
  const first = planCurveNotes({ ...planOptions, existing: notes });
  const repeated = planCurveNotes({ ...planOptions, existing: notes });
  assert.equal(repeated, first, "equal inputs return the cached plan");
  assert.deepEqual(curvePlanCacheStats(), { hits: 1, misses: 1, entries: 1 });

  const densityChanged = planCurveNotes({ ...planOptions, density: 20, existing: notes });
  assert.notEqual(densityChanged, first, "density changes the plan");
  const easingChanged = planCurveNotes({
    ...planOptions,
    density: 20,
    easingType: 5,
    existing: notes,
  });
  assert.notEqual(easingChanged, densityChanged, "easing changes the plan");
  const divisionChanged = planCurveNotes({
    ...planOptions,
    density: 20,
    easingType: 5,
    division: 50,
    existing: notes,
  });
  assert.notEqual(divisionChanged, easingChanged, "division changes the plan");

  notes.push(anchorNote(0, -400));
  const chartChanged = planCurveNotes({
    ...planOptions,
    density: 20,
    easingType: 5,
    division: 50,
    existing: notes,
  });
  assert.notEqual(chartChanged, divisionChanged, "a chart note edit changes the plan");
  assert.deepEqual(curvePlanCacheStats(), { hits: 1, misses: 5, entries: 1 });
});

test("a playback redraw loop builds the curve ghost once", () => {
  resetCurvePlanCache();
  const notes = Array.from({ length: 2000 }, (unused, index) =>
    anchorNote(index / 16, index % 2 === 0 ? -400 : 400),
  );
  const { editor } = editorWithMutableNotes(() => notes);
  const first = editor.ghost();
  const afterFirst = curvePlanCacheStats();
  assert.equal(afterFirst.misses, 1);

  for (let frame = 0; frame < 300; frame += 1) {
    assert.equal(editor.ghost(), first, "the same ghost array is reused while playing");
  }
  assert.deepEqual(curvePlanCacheStats(), afterFirst, "no plan regeneration during playback");
});

test("draft, easing, and chart edits each invalidate the curve ghost", () => {
  resetCurvePlanCache();
  let notes = [anchorNote(0, -400)];
  const { editor, fields } = editorWithMutableNotes(() => notes);
  const initial = editor.ghost();
  assert.equal(curvePlanCacheStats().misses, 1);

  fields.get()?.onInput({
    startTime: [0, 0, 1],
    endTime: [4, 0, 1],
    startX: -400,
    endX: 400,
    density: 20,
    type: 4,
    easingType: 1,
  });
  const densityChanged = editor.ghost();
  assert.notEqual(densityChanged, initial, "a draft change rebuilds the ghost");
  assert.equal(curvePlanCacheStats().misses, 2);

  fields.get()?.onInput({
    startTime: [0, 0, 1],
    endTime: [4, 0, 1],
    startX: -400,
    endX: 400,
    density: 20,
    type: 4,
    easingType: 5,
  });
  const easingChanged = editor.ghost();
  assert.notEqual(easingChanged, densityChanged, "an easing change rebuilds the ghost");
  assert.equal(curvePlanCacheStats().misses, 3);

  notes = [...notes, anchorNote(4, 400)];
  const chartChanged = editor.ghost();
  assert.notEqual(chartChanged, easingChanged, "a chart edit rebuilds the ghost");
  assert.equal(curvePlanCacheStats().misses, 4);
});
