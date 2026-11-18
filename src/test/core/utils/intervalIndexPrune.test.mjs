/**
 * Differential contracts for the expanded interval query with prefix pruning.
 *
 * The pruned path may only change how many rows a scan visits, never which
 * entries it returns or in which order. Every case compares the pruned index,
 * the unpruned index, and a brute-force scan over the source items.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { IntervalIndex } from "../../../core/utils/intervalIndex.ts";

/** Deterministic pseudo-random source so a failure is reproducible. */
function source(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

/** Brute-force result in the directory's `(start, source index)` order. */
function bruteForce(items, queryStart, queryEnd, radius, secondaryRange) {
  const safeRadius = Math.max(0, radius);
  return items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => {
      const expansion = safeRadius * item.factor;
      if (item.end + expansion < queryStart || item.start - expansion > queryEnd) {
        return false;
      }
      return (
        !secondaryRange ||
        (item.secondaryEnd >= secondaryRange.start && item.secondaryStart <= secondaryRange.end)
      );
    })
    .sort((left, right) => left.item.start - right.item.start || left.index - right.index)
    .map(({ item }) => item);
}

/** Build one index over the same items with the requested pruning mode. */
function build(items, pruned, secondary) {
  return new IntervalIndex(
    items,
    (item) => item.start,
    (item) => item.end,
    (item) => item.factor,
    secondary ? (item) => item.secondaryStart : undefined,
    secondary ? (item) => item.secondaryEnd : undefined,
    pruned,
  );
}

/** Generate intervals with varied spans, factors, and secondary ranges. */
function generatedItems(count, random) {
  const items = [];
  for (let index = 0; index < count; index += 1) {
    const start = Math.round((random() - 0.5) * 2000) / 2;
    const span = Math.round(random() * 40) / 2;
    const factor = [0, 0.5, 1, 1, 1, 3][Math.floor(random() * 6)];
    const secondaryStart = start - Math.round(random() * 30);
    const secondaryEnd = start + Math.round(random() * 30);
    items.push({
      id: index,
      start,
      end: start + span,
      factor,
      secondaryStart,
      secondaryEnd,
    });
  }
  return items;
}

test("pruned expanded queries match the unpruned and brute-force results", () => {
  const random = source(0x5eed);
  for (let round = 0; round < 40; round += 1) {
    const count = [0, 1, 5, 255, 256, 257, 700][round % 7];
    const items = generatedItems(count, random);
    const pruned = build(items, true, false);
    const unpruned = build(items, false, false);
    for (let query = 0; query < 30; query += 1) {
      const start = Math.round((random() - 0.5) * 2400) / 2;
      const span = [0, 1, 10, 100, 2000][Math.floor(random() * 5)];
      const end = start + span;
      const radius = [0, 0.25, 1, 8, 200][Math.floor(random() * 5)];
      const expected = bruteForce(items, start, end, radius);
      assert.deepEqual(pruned.queryItemsExpandedInto(start, end, radius, []), expected);
      assert.deepEqual(unpruned.queryItemsExpandedInto(start, end, radius, []), expected);
      // A negative radius clamps to zero, so the query must match the point case.
      assert.deepEqual(
        pruned.queryItemsExpandedInto(start, end, -1, []),
        bruteForce(items, start, end, 0),
      );
    }
  }
});

test("pruned expanded secondary queries match brute force", () => {
  const random = source(0xc0ffee);
  for (let round = 0; round < 30; round += 1) {
    const items = generatedItems([0, 3, 256, 513][round % 4], random);
    const pruned = build(items, true, true);
    const unpruned = build(items, false, true);
    for (let query = 0; query < 20; query += 1) {
      const start = Math.round((random() - 0.5) * 2400) / 2;
      const end = start + Math.round(random() * 400);
      const radius = [0, 1, 4, 60][Math.floor(random() * 4)];
      const secondaryStart = Math.round((random() - 0.5) * 2400) / 2;
      const secondaryEnd = secondaryStart + Math.round(random() * 80);
      const expected = bruteForce(items, start, end, radius, {
        start: secondaryStart,
        end: secondaryEnd,
      });
      assert.deepEqual(
        pruned.queryItemsExpandedAndSecondaryInto(
          start,
          end,
          radius,
          secondaryStart,
          secondaryEnd,
          [],
        ),
        expected,
      );
      assert.deepEqual(
        unpruned.queryItemsExpandedAndSecondaryInto(
          start,
          end,
          radius,
          secondaryStart,
          secondaryEnd,
          [],
        ),
        expected,
      );
    }
  }
});

test("incremental replacements keep the pruned result identical to a fresh index", () => {
  const random = source(0x123456);
  let items = generatedItems(300, random);
  const pruned = build(items, true, false);
  const runQueries = (index, sourceItems) => {
    for (let query = 0; query < 12; query += 1) {
      const start = Math.round((random() - 0.5) * 2000) / 2;
      const end = start + Math.round(random() * 300);
      const radius = [0, 1, 20, 500][query % 4];
      assert.deepEqual(
        index.queryItemsExpandedInto(start, end, radius, []),
        bruteForce(sourceItems, start, end, radius),
      );
    }
  };
  runQueries(pruned, items);

  // Insert in the middle: exercises block insertion and split/rebuild paths.
  const inserted = generatedItems(3, random).map((item, offset) => ({
    ...item,
    id: 1000 + offset,
    start: item.start / 8,
    end: item.start / 8 + 2,
  }));
  items = [...items.slice(0, 120), ...inserted, ...items.slice(120)];
  pruned.replaceItems(items);
  runQueries(pruned, items);

  // Remove a stable subset: exercises index shifting and block merging.
  items = items.filter((_, index) => index % 7 !== 3);
  pruned.replaceItems(items);
  assert.deepEqual(
    pruned.queryItemsExpandedInto(-2000, 2000, 0, []),
    bruteForce(items, -2000, 2000, 0),
  );

  // Replace every item: exercises the full rebuild path.
  items = generatedItems(320, random);
  assert.equal(pruned.replaceItems(items), "rebuilt");
  runQueries(pruned, items);
});

test("equal starts keep source order under prefix pruning", () => {
  const items = Array.from({ length: 40 }, (_, index) => ({
    id: index,
    start: 10,
    end: 20,
    factor: index % 3,
  }));
  const pruned = build(items, true, false);
  assert.deepEqual(
    pruned.queryItemsExpandedInto(10, 10, 0, []).map((item) => item.id),
    items.map((item) => item.id),
  );
  assert.deepEqual(
    pruned.queryItemsExpandedInto(0, 0, 1, []).map((item) => item.id),
    [],
  );
});
