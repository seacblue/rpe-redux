/** Multi-line event switches filter columns and couple X/Y permissions under binding. */
import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import { createChart } from "../../../core/global/chart/chart.ts";
import { values } from "../../../core/state/values.ts";
import { displayValues } from "../../../frontend/screens/settings/editorDisplaySettings.ts";
import {
  eventColumnForTrack,
  eventColumnsForLine,
  visibleEventTypesForLine,
} from "../../../frontend/screens/editor/workspace/timeline/events/eventColumns.ts";

/** A session-shaped read model for the column resolver. */
function session(mode, multiLineActive = true) {
  return {
    chart: createChart(),
    multiLineActive,
    multiLineMode: mode,
  };
}

/** Set every ordinary track switch in one call. */
function setVisibility({ x = true, y = true, rotate = true, alpha = true, speed = true }) {
  displayValues.multiLineEventShowX.set(x);
  displayValues.multiLineEventShowY.set(y);
  displayValues.multiLineEventShowRotate.set(rotate);
  displayValues.multiLineEventShowAlpha.set(alpha);
  displayValues.multiLineEventShowSpeed.set(speed);
}

afterEach(() => {
  setVisibility({});
  values.byId.set("xy-binding", false);
});

test("multi-line event editing paints all five ordinary tracks by default", () => {
  assert.deepEqual(eventColumnsForLine(session("events"), 0, false), [
    "moveXEvents",
    "moveYEvents",
    "rotateEvents",
    "alphaEvents",
    "speedEvents",
  ]);
});

test("a hidden ordinary track loses its column and its selectable key", () => {
  setVisibility({ alpha: false });

  assert.deepEqual(eventColumnsForLine(session("events"), 0, false), [
    "moveXEvents",
    "moveYEvents",
    "rotateEvents",
    "speedEvents",
  ]);
  assert.deepEqual(visibleEventTypesForLine(session("events"), 0, false), [
    "moveXEvents",
    "moveYEvents",
    "rotateEvents",
    "speedEvents",
  ]);
});

test("the switches do not affect single-line or note-mode event fields", () => {
  setVisibility({ x: false, y: false, rotate: false, alpha: false, speed: false });

  assert.equal(eventColumnsForLine(session("events", false), 0, false).length, 5);
  assert.equal(eventColumnsForLine(session("notes"), 0, false).length, 5);
});

test("XY binding keeps the two axis columns side by side", () => {
  values.byId.set("xy-binding", true);

  assert.deepEqual(eventColumnsForLine(session("events"), 0, false), [
    "moveXEvents",
    "moveYEvents",
    "rotateEvents",
    "alphaEvents",
    "speedEvents",
  ]);
});

test("XY binding takes the OR of the two persisted axis switches", () => {
  values.byId.set("xy-binding", true);
  setVisibility({ x: false, y: true });

  assert.deepEqual(eventColumnsForLine(session("events"), 0, false), [
    "moveXEvents",
    "moveYEvents",
    "rotateEvents",
    "alphaEvents",
    "speedEvents",
  ]);
  assert.deepEqual(visibleEventTypesForLine(session("events"), 0, false), [
    "moveXEvents",
    "moveYEvents",
    "rotateEvents",
    "alphaEvents",
    "speedEvents",
  ]);
});

test("disabling XY removes both axis columns and both axis keys", () => {
  values.byId.set("xy-binding", true);
  setVisibility({ x: false, y: false });

  assert.deepEqual(eventColumnsForLine(session("events"), 0, false), [
    "rotateEvents",
    "alphaEvents",
    "speedEvents",
  ]);
  assert.deepEqual(visibleEventTypesForLine(session("events"), 0, false), [
    "rotateEvents",
    "alphaEvents",
    "speedEvents",
  ]);
});

test("eventColumnForTrack maps visible real tracks to their display column", () => {
  assert.equal(eventColumnForTrack(["moveXEvents", "moveYEvents"], "moveYEvents"), 1);
  assert.equal(eventColumnForTrack(["rotateEvents"], "moveYEvents"), -1);
});
