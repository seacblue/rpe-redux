/** Verifies the deterministic sequence and jitter primitives used by M2 recipes. */
import assert from "node:assert/strict";
import test from "node:test";
import { distribution, randomSource, sequence } from "../../../core/edit/multiEdit/distribution.ts";
import { parseJudgeLineList } from "../../../core/extensions/parameters.ts";

test("sequence keeps authored order and supports repeat cycles", () => {
  assert.deepEqual(sequence("0, 25, 50", []), [0, 25, 50]);
  const values = distribution(
    { lower: 1, upper: 1, cycle: "0, 25, 50", easingType: 1 },
    randomSource(7),
  );
  assert.deepEqual(
    [0, 25, 50, 0],
    [0, 1, 2, 3].map((index) => values(index, 0.5)),
  );
});

test("the same seed produces the same jitter sequence", () => {
  const first = distribution(
    { lower: 0, upper: 0, disturbance: "12", easingType: 1 },
    randomSource(42),
  );
  const second = distribution(
    { lower: 0, upper: 0, disturbance: "12", easingType: 1 },
    randomSource(42),
  );
  assert.deepEqual(
    [0, 1, 2, 3].map((index) => first(index, 0.5)),
    [0, 1, 2, 3].map((index) => second(index, 0.5)),
  );
});

test("judge-line lists accept folder names and preserve folder order", () => {
  assert.deepEqual(
    parseJudgeLineList("Lead, 1-2", [
      { name: "Lead", indices: [4, 2, 0] },
      { name: "Backing", indices: [1, 3] },
    ]),
    [4, 2, 0, 1],
  );
});
