/** Shift-drag previews in the toolbar judge-line picker. */
import assert from "node:assert/strict";
import test from "node:test";
import {
  createMarqueeDrag,
  listContentX,
  listContentY,
  marqueeBox,
  resolveMarqueeFirstLine,
} from "../../../frontend/screens/editor/toolbar/lineSelectionMarquee.ts";

/** Ascending array so set assertions stay readable. */
function ordered(values) {
  return [...values].sort((left, right) => left - right);
}

test("add mode previews every touched row and commits only on release", () => {
  let store = new Set([1]);
  const commits = [];
  const drag = createMarqueeDrag(store, 1, (preview) => {
    commits.push({ selection: ordered(preview.selection), focus: preview.focus });
    store = new Set(preview.selection);
  });

  assert.equal(drag.mode, "add");
  const preview = drag.update([1, 2, 3], true);
  assert.deepEqual(ordered(preview.selection), [1, 2, 3]);
  assert.equal(preview.focus, 3);
  assert.deepEqual(ordered(store), [1]);
  assert.equal(commits.length, 0);

  const released = drag.finish();
  assert.deepEqual(ordered(released.selection), [1, 2, 3]);
  assert.deepEqual(commits, [{ selection: [1, 2, 3], focus: 3 }]);
  assert.deepEqual(ordered(store), [1, 2, 3]);
});

test("remove mode previews removal of the touched rows", () => {
  const commits = [];
  const drag = createMarqueeDrag(new Set([1, 2, 3]), 2, (preview) => {
    commits.push(ordered(preview.selection));
  });

  assert.equal(drag.mode, "remove");
  const preview = drag.update([1, 2], true);
  assert.deepEqual(ordered(preview.selection), [3]);
  assert.equal(preview.focus, 3);
  assert.equal(commits.length, 0);
});

test("a single selected row starts an add drag instead of removing itself", () => {
  const drag = createMarqueeDrag(new Set([2]), 2, () => {});
  assert.equal(drag.mode, "add");
  const preview = drag.update([2, 3], true);
  assert.deepEqual(ordered(preview.selection), [2, 3]);
});

test("removing every touched row keeps the last pre-drag selection", () => {
  const drag = createMarqueeDrag(new Set([1, 2]), 1, () => {});
  assert.equal(drag.mode, "remove");
  const preview = drag.update([1, 2], true);
  assert.deepEqual(ordered(preview.selection), [2]);
});

test("preview updates recompute from the pressed state instead of accumulating", () => {
  const add = createMarqueeDrag(new Set([1]), 2, () => {});
  assert.deepEqual(ordered(add.update([2, 3], true).selection), [1, 2, 3]);
  assert.deepEqual(ordered(add.update([2], true).selection), [1, 2]);
  assert.deepEqual(ordered(add.update([], false).selection), [1, 2]);

  // The pressed row stays removed for the whole drag, even when the pointer
  // moves back across it.
  const remove = createMarqueeDrag(new Set([1, 2]), 1, () => {});
  assert.deepEqual(ordered(remove.update([1], true).selection), [2]);
  assert.deepEqual(ordered(remove.update([], false).selection), [2]);
});

test("cancel drops the preview and a later finish commits nothing", () => {
  let store = new Set([1]);
  const commits = [];
  const drag = createMarqueeDrag(store, 1, (preview) => {
    commits.push(ordered(preview.selection));
    store = new Set(preview.selection);
  });

  drag.update([1, 2, 3], true);
  drag.cancel();
  drag.finish();
  assert.deepEqual(commits, []);
  assert.deepEqual(ordered(store), [1]);
});

test("content coordinates start at the list's padding box, not its border box", () => {
  assert.equal(listContentX(100, 20, 1), 79);
  assert.equal(listContentX(100, 20, 0), 80);
  assert.equal(listContentY(100, 20, 1, 30), 109);
  assert.equal(listContentY(100, 20, 0, 0), 80);
});

test("the marquee follows the pointer on both axes without snapping", () => {
  assert.deepEqual(marqueeBox({ x: 50, y: 40 }, { x: 80, y: 90 }), {
    left: 50,
    top: 40,
    width: 30,
    height: 50,
  });
  assert.deepEqual(marqueeBox({ x: 80, y: 90 }, { x: 50, y: 40 }), {
    left: 50,
    top: 40,
    width: 30,
    height: 50,
  });
  assert.deepEqual(marqueeBox({ x: 50, y: 40 }, { x: 53.25, y: 40 }), {
    left: 50,
    top: 40,
    width: 3.25,
    height: 1,
  });
  assert.deepEqual(marqueeBox({ x: 50, y: 40 }, { x: 50, y: 40 }), {
    left: 50,
    top: 40,
    width: 1,
    height: 1,
  });
});

test("a marquee records its first line separately from its pressed anchor", () => {
  assert.equal(resolveMarqueeFirstLine(-1, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 6), 1);
  assert.equal(resolveMarqueeFirstLine(6, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 6), 1);
  assert.equal(resolveMarqueeFirstLine(4, [4, 5], 6), 4);
  assert.equal(resolveMarqueeFirstLine(-1, [], 6), 6);
});
