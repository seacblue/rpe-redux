/** The arrangement model keeps every registered command reachable. */
import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_SLOTS,
  dividerId,
  findPlacement,
  hasSurfaceLayout,
  hidePlacement,
  insertDivider,
  movePlacement,
  readArrangement,
  removePlacement,
  resolveSurfaceLayout,
  revealPlacement,
  tidyPlacements,
  withSurfaceLayout,
} from "../../../core/shell/layoutArrangement.ts";

const authored = (id) => (id.startsWith("b") ? 2 : 1);

test("a fresh profile keeps the authored layout", () => {
  const slots = resolveSurfaceLayout({}, "toolbar", ["a1", "b1", "a2"], authored);
  assert.deepEqual(slots, [
    { slot: 1, items: [{ id: "a1" }, { id: "a2" }] },
    { slot: 2, items: [{ id: "b1" }] },
  ]);
  assert.equal(hasSurfaceLayout({}, "toolbar"), false);
});

test("the authored strips are the two toolbar rows and one rail column", () => {
  assert.deepEqual(DEFAULT_SLOTS.toolbar, [1, 2]);
  assert.deepEqual(DEFAULT_SLOTS.sidebar, [1]);
});

test("a stored arrangement decides order and strip", () => {
  const arrangement = withSurfaceLayout({}, "toolbar", [
    { slot: 2, items: [{ id: "a1" }] },
    { slot: 1, items: [{ id: "b1" }] },
  ]);
  const slots = resolveSurfaceLayout(arrangement, "toolbar", ["a1", "b1"], authored);
  assert.deepEqual(slots, [
    { slot: 1, items: [{ id: "b1" }] },
    { slot: 2, items: [{ id: "a1" }] },
  ]);
  assert.equal(hasSurfaceLayout(arrangement, "toolbar"), true);
});

test("a command that arrives after the save keeps its authored strip", () => {
  const arrangement = withSurfaceLayout({}, "toolbar", [{ slot: 1, items: [{ id: "a1" }] }]);
  const slots = resolveSurfaceLayout(arrangement, "toolbar", ["a1", "b1"], authored);
  assert.deepEqual(slots, [
    { slot: 1, items: [{ id: "a1" }] },
    { slot: 2, items: [{ id: "b1" }] },
  ]);
});

test("a placement whose command is gone is dropped", () => {
  const arrangement = withSurfaceLayout({}, "toolbar", [
    { slot: 1, items: [{ id: "a1" }, { id: "uninstalled" }] },
  ]);
  const slots = resolveSurfaceLayout(arrangement, "toolbar", ["a1"], authored);
  // A stale id has nothing to draw and would otherwise sit in the arrangement
  // forever, so it leaves the model. A rule the user added is kept instead.
  assert.equal(findPlacement(slots, "uninstalled"), null);
  assert.deepEqual(slots[0].items, [{ id: "a1" }]);
});

test("a rule the user added survives, a feature's own rule does not", () => {
  const arrangement = withSurfaceLayout({}, "toolbar", [
    {
      slot: 1,
      items: [
        { id: "a1" },
        { id: dividerId(), divider: true },
        { id: "toolbar.rule.line", divider: true },
        { id: "a2" },
      ],
    },
  ]);
  const slots = resolveSurfaceLayout(arrangement, "toolbar", ["a1", "a2"], authored);
  const ids = slots[0].items.map((item) => item.id);
  assert.equal(ids.includes("toolbar.rule.line"), false);
  assert.equal(ids.filter((id) => id.startsWith("layout.divider.")).length, 1);
});

test("a move inside one strip reorders without losing an item", () => {
  const slots = [{ slot: 1, items: [{ id: "a" }, { id: "b" }, { id: "c" }] }];
  const moved = movePlacement(slots, "c", 1, 0);
  assert.deepEqual(
    moved[0].items.map((item) => item.id),
    ["c", "a", "b"],
  );
  assert.equal(moved.flatMap((slot) => slot.items).length, 3);
});

test("a move across strips changes rows without duplicating the item", () => {
  const slots = [
    { slot: 1, items: [{ id: "a" }, { id: "b" }] },
    { slot: 2, items: [{ id: "c" }] },
  ];
  const moved = movePlacement(slots, "a", 2, 1);
  assert.deepEqual(moved, [
    { slot: 1, items: [{ id: "b" }] },
    { slot: 2, items: [{ id: "c" }, { id: "a" }] },
  ]);
});

test("a rule only survives between two items", () => {
  const tidied = tidyPlacements([
    { id: "d1", divider: true },
    { id: "a" },
    { id: "d2", divider: true },
    { id: "d3", divider: true },
    { id: "b" },
    { id: "d4", divider: true },
  ]);
  assert.deepEqual(tidied, [{ id: "a" }, { id: "d2", divider: true }, { id: "b" }]);
});

test("adding and removing a rule leaves the items alone", () => {
  const slots = [{ slot: 1, items: [{ id: "a" }, { id: "b" }] }];
  const withRule = insertDivider(slots, 1, 1, "rule-1");
  assert.deepEqual(withRule[0].items, [{ id: "a" }, { id: "rule-1", divider: true }, { id: "b" }]);
  const removed = removePlacement(withRule, "rule-1");
  assert.deepEqual(
    removed[0].items.map((item) => item.id),
    ["a", "b"],
  );
});

test("removing the only item of a strip drops the strip", () => {
  const slots = [
    { slot: 1, items: [{ id: "a" }] },
    { slot: 2, items: [{ id: "b" }] },
  ];
  const removed = removePlacement(slots, "b");
  assert.deepEqual(removed, [{ slot: 1, items: [{ id: "a" }] }]);
});

test("a malformed document is discarded instead of trusted", () => {
  assert.deepEqual(readArrangement(null), {});
  assert.deepEqual(readArrangement("nope"), {});
  assert.deepEqual(readArrangement({ toolbar: { slots: "nope" } }), {});
  // A repeated strip would duplicate every item in it.
  assert.deepEqual(
    readArrangement({
      toolbar: {
        slots: [
          { slot: 1, items: [{ id: "a" }] },
          { slot: 1, items: [{ id: "b" }] },
        ],
      },
    }),
    { toolbar: { slots: [{ slot: 1, items: [{ id: "a" }] }], hidden: [] } },
  );
  // A repeated item in one strip draws once.
  assert.deepEqual(
    readArrangement({ sidebar: { slots: [{ slot: 1, items: [{ id: "a" }, { id: "a" }] }] } }),
    { sidebar: { slots: [{ slot: 1, items: [{ id: "a" }] }], hidden: [] } },
  );
});

test("a removed command stays off the surface until it is added back", () => {
  const arrangement = withSurfaceLayout({}, "toolbar", [{ slot: 1, items: [{ id: "a1" }] }]);
  const hidden = hidePlacement(arrangement, "toolbar", "b1");
  const slots = resolveSurfaceLayout(hidden, "toolbar", ["a1", "b1"], authored);
  assert.deepEqual(slots, [{ slot: 1, items: [{ id: "a1" }] }]);
  // Adding it back clears the record, so the command is offered again.
  const revealed = revealPlacement(hidden, "toolbar", "b1");
  const after = resolveSurfaceLayout(revealed, "toolbar", ["a1", "b1"], authored);
  assert.deepEqual(after, [
    { slot: 1, items: [{ id: "a1" }] },
    { slot: 2, items: [{ id: "b1" }] },
  ]);
});

test("a rule id is unique per insertion", () => {
  const first = dividerId();
  const second = dividerId();
  assert.notEqual(first, second);
  assert.match(first, /^layout\.divider\./u);
});

test("writing a surface back keeps the other surface untouched", () => {
  const arrangement = withSurfaceLayout({}, "sidebar", [{ slot: 1, items: [{ id: "rail" }] }]);
  const next = withSurfaceLayout(arrangement, "toolbar", [{ slot: 1, items: [{ id: "a" }] }]);
  assert.deepEqual(next.sidebar?.slots, [{ slot: 1, items: [{ id: "rail" }] }]);
  assert.deepEqual(next.toolbar?.slots, [{ slot: 1, items: [{ id: "a" }] }]);
});
