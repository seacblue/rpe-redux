/**
 * Contracts for the chunked interval directory: query results, caller-owned
 * buffers, and the incremental mutation path that keeps timeline edits from
 * rebuilding the whole directory.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { IntervalIndex } from "../../../core/utils/intervalIndex.ts";

test("queries fill a caller-owned buffer with the same entries", () => {
  const index = new IntervalIndex(
    [
      { start: 0, end: 1 },
      { start: 4, end: 5 },
      { start: 8, end: 9 },
    ],
    (entry) => entry.start,
    (entry) => entry.end,
  );
  const buffer = [];
  const first = index.queryInto(0, 5, buffer);
  assert.deepEqual(
    first.map((entry) => entry.index),
    [0, 1],
  );
  const second = index.queryInto(8, 9, first);
  assert.deepEqual(
    second.map((entry) => entry.index),
    [2],
  );
});

test("incremental insertion keeps source-order ties without rebuilding", () => {
  const first = { start: 2, end: 3, name: "first" };
  const second = { start: 2, end: 4, name: "second" };
  const index = new IntervalIndex(
    [first, second],
    (entry) => entry.start,
    (entry) => entry.end,
  );
  index.rebuildCount = 1;
  const inserted = { start: 2, end: 5, name: "inserted" };
  assert.equal(index.replaceItems([first, inserted, second]), "incremental");
  assert.equal(index.rebuildCount, 1);
  assert.deepEqual(
    index.query(2, 2).map((entry) => entry.item.name),
    ["first", "inserted", "second"],
  );
});

test("incremental deletion shifts source indexes without changing query order", () => {
  const first = { start: 0, end: 1 };
  const removed = { start: 2, end: 3 };
  const last = { start: 4, end: 5 };
  const index = new IntervalIndex(
    [first, removed, last],
    (entry) => entry.start,
    (entry) => entry.end,
  );
  index.rebuildCount = 1;
  assert.equal(index.replaceItems([first, last]), "incremental");
  assert.equal(index.rebuildCount, 1);
  assert.deepEqual(
    index.query(0, 5).map((entry) => entry.index),
    [0, 1],
  );
});
