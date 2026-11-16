/** Verifies chart-local batch history and durable batch-edit drafts. */
import assert from "node:assert/strict";
import test from "node:test";
import {
  defaultBatchParameters,
  MultiEditParameters,
} from "../../../core/edit/multiEdit/parameters.ts";

/** Provides the small storage seam used by the parameter model. */
function storage(initial = null) {
  let value = initial;
  return {
    getItem: () => value,
    setItem: (_key, next) => {
      value = next;
    },
    read: () => value,
  };
}

test("batch history promotes an exact repeat to the newest position", () => {
  const parameters = new MultiEditParameters(storage());
  const first = { ...defaultBatchParameters("notes"), lower: "1" };
  const second = { ...defaultBatchParameters("notes"), lower: "2" };

  assert.equal(parameters.remember("notes", first), 0);
  assert.equal(parameters.remember("notes", second), 1);
  assert.equal(parameters.remember("notes", first), 1);
  assert.deepEqual(parameters.history.notes, [second, first]);
});

test("event application mode participates in the exact history match", () => {
  const parameters = new MultiEditParameters(storage());
  const perLine = { ...defaultBatchParameters("events"), eventApplicationMode: "per-line" };
  const global = { ...perLine, eventApplicationMode: "global" };

  parameters.remember("events", perLine);
  parameters.remember("events", global);

  assert.deepEqual(parameters.history.events, [perLine, global]);
});

test("history is not restored from storage and can be cleared per chart", () => {
  const saved = storage();
  const parameters = new MultiEditParameters(saved);
  const draft = { ...defaultBatchParameters("notes"), lower: "3" };
  parameters.update("notes", draft);
  parameters.remember("notes", draft);

  assert.doesNotMatch(String(saved.read()), /history/u);
  const reopened = new MultiEditParameters(saved);
  assert.deepEqual(reopened.history, { notes: [], events: [] });
  assert.equal(reopened.read("notes").lower, "3");

  reopened.remember("events", defaultBatchParameters("events"));
  reopened.clearHistory();
  assert.deepEqual(reopened.history, { notes: [], events: [] });
});
