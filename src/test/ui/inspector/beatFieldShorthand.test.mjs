/** A three-number shorthand typed into one beat box expands to the stored triple. */
import assert from "node:assert/strict";
import test from "node:test";
import {
  draftBeat,
  partsFromText,
  partsOf,
  preserveBeatParts,
} from "../../../core/global/chart/timing/beatParts.ts";

test("colon, comma, and space shorthand all split into three parts", () => {
  assert.deepEqual(partsFromText("3:1/2"), ["3", "1", "2"]);
  assert.deepEqual(partsFromText("3,1,2"), ["3", "1", "2"]);
  assert.deepEqual(partsFromText("3 1 2"), ["3", "1", "2"]);
});

test("mixed separators and surrounding whitespace are accepted", () => {
  assert.deepEqual(partsFromText(" -3 : 1.5 / 2 "), ["-3", "1.5", "2"]);
  assert.deepEqual(partsFromText("3\t1,2"), ["3", "1", "2"]);
  assert.deepEqual(partsFromText("3::1//2"), ["3", "1", "2"]);
});

test("fewer or more than three numbers is not a shorthand", () => {
  assert.equal(partsFromText("3"), null);
  assert.equal(partsFromText("3.5"), null);
  assert.equal(partsFromText("-3"), null);
  assert.equal(partsFromText("3:1"), null);
  assert.equal(partsFromText("3:1/2/4"), null);
  assert.equal(partsFromText("3,1,2,4"), null);
});

test("tokens that are not numbers are not a shorthand", () => {
  assert.equal(partsFromText("3:x/2"), null);
  assert.equal(partsFromText("3:1/2a"), null);
});

test("a decimal shorthand reduces to the exact stored triple", () => {
  assert.deepEqual(partsOf(draftBeat(partsFromText("3:1.5/2"))), ["3", "3", "4"]);
  assert.deepEqual(partsOf(draftBeat(partsFromText("3:1/2.5"))), ["3", "2", "5"]);
  assert.deepEqual(partsOf(draftBeat(partsFromText("3.5:1/2"))), ["3", "1", "2"]);
});

test("an integer shorthand carries the chart's own reduction", () => {
  assert.deepEqual(partsOf(draftBeat(partsFromText("3:5/4"))), ["4", "1", "4"]);
});

test("an integer triple can stay unreduced while the field is left", () => {
  assert.deepEqual(partsOf(preserveBeatParts(["3", "5", "4"])), ["3", "5", "4"]);
});

test("a zero denominator still expands but is not a beat", () => {
  assert.deepEqual(partsFromText("3:1/0"), ["3", "1", "0"]);
  assert.equal(draftBeat(partsFromText("3:1/0")), null);
});

test("a negative beat clamps to the chart start", () => {
  assert.deepEqual(partsOf(draftBeat(["-7", "1", "2"])), ["0", "0", "1"]);
  assert.deepEqual(partsOf(draftBeat(["-0.5", "0", "1"])), ["0", "0", "1"]);
  assert.deepEqual(partsOf(draftBeat(partsFromText("-1:1/2"))), ["0", "0", "1"]);
  assert.deepEqual(partsOf(draftBeat(partsFromText("-0.25:1/2"))), ["0", "0", "1"]);
});

test("a beat at or above zero is untouched", () => {
  assert.deepEqual(partsOf(draftBeat(["0", "1", "4"])), ["0", "1", "4"]);
  assert.deepEqual(partsOf(draftBeat(["0", "0", "1"])), ["0", "0", "1"]);
});
