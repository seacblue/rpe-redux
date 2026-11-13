/** Differential contracts for event-label ordering and dense selection. */
import assert from "node:assert/strict";
import test from "node:test";
import {
  createEventLabelScratch,
  labelGroupsFromEntries,
} from "../../../frontend/screens/editor/workspace/timeline/events/eventLabelLayout.ts";

/** Reference label selection retained for randomized correctness comparisons. */
function referenceLabelGroups(groups, height, isSelected, boundsFor) {
  const visible = Array.from(new Set(groups)).filter((group) => group !== undefined);
  const budget = Math.max(1, Math.floor(Math.max(0, height - 23) / 28));
  const selected = visible.filter(isSelected);
  const ordered = [...visible].sort((left, right) => {
    const selectedOrder = (isSelected(left) ? 0 : 1) - (isSelected(right) ? 0 : 1);
    if (selectedOrder !== 0) {
      return selectedOrder;
    }
    const leftBounds = boundsFor(left);
    const rightBounds = boundsFor(right);
    return (leftBounds.top + leftBounds.bottom) / 2 - (rightBounds.top + rightBounds.bottom) / 2;
  });
  const kept = [];
  for (const group of ordered) {
    const bounds = boundsFor(group);
    const center = (bounds.top + bounds.bottom) / 2;
    const crowded = kept.some((candidate) => {
      const candidateBounds = boundsFor(candidate);
      return Math.abs((candidateBounds.top + candidateBounds.bottom) / 2 - center) < 28;
    });
    if ((!crowded || selected.includes(group)) && kept.length < budget) {
      kept.push(group);
    }
  }
  return visible.filter((group) => kept.includes(group));
}

test("event-label fast paths match the reference across ordered and unordered groups", () => {
  let seed = 0x12345678;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0x100000000;
  };
  for (let iteration = 0; iteration < 120; iteration++) {
    const count = 1 + Math.floor(random() * 96);
    const groups = Array.from({ length: count }, (_, index) => ({
      entries: [{ index }],
      min: index,
      max: index + 1,
      center: Math.floor(random() * 240),
    }));
    const order = Array.from({ length: count * 2 }, (_, index) => ({
      index: index % count,
    }));
    if (iteration % 3 === 1) {
      order.reverse();
    } else if (iteration % 3 === 2) {
      order.sort((left, right) => (left.index % 7) - (right.index % 7));
    }
    const ranges = new Map(groups.map((group, index) => [index, group]));
    const selected = new Set(groups.filter(() => random() < 0.2));
    const isSelected = (group) => selected.has(group);
    const boundsFor = (group) => ({ top: group.center, bottom: group.center + 8 });
    for (const height of [0, 24, 80, 180, 720]) {
      const expected = referenceLabelGroups(
        order.map((entry) => ranges.get(entry.index)),
        height,
        isSelected,
        boundsFor,
      );
      const actual = labelGroupsFromEntries(order, ranges, height, isSelected, boundsFor);
      assert.deepEqual(actual, expected, `iteration=${iteration}, height=${height}`);
    }
  }
});

test("event-label scratch reuses layout storage without changing the result", () => {
  const groups = Array.from({ length: 32 }, (_, index) => ({
    entries: [],
    min: index,
    max: index + 1,
    center: index * 24,
  }));
  const ranges = new Map(groups.map((group, index) => [index, group]));
  const entries = groups.map((_, index) => ({ index }));
  const selected = new Set([groups[2], groups[17]]);
  const isSelected = (group) => selected.has(group);
  const boundsFor = (group) => ({ top: group.center, bottom: group.center + 8 });
  const scratch = createEventLabelScratch();
  const first = labelGroupsFromEntries(entries, ranges, 180, isSelected, boundsFor, scratch);
  const second = labelGroupsFromEntries(entries, ranges, 180, isSelected, boundsFor, scratch);

  assert.deepEqual(second, first);
  assert.strictEqual(second, first);
});
