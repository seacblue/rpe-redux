/** Navigation scheduling keeps repeated home-page key presses within one frame. */
import assert from "node:assert/strict";
import test from "node:test";
import { createLibraryNavigationScheduler } from "../../../frontend/screens/welcome/library/libraryNavigation.ts";

function entry(key) {
  return { key };
}

test("coalesces repeated navigation before the next frame", () => {
  const entries = [entry("project:a"), entry("project:b"), entry("project:c")];
  const selected = { key: "project:a" };
  const submitted = [];
  let frame = null;
  const scheduler = createLibraryNavigationScheduler(
    () => ({
      entries,
      selectedKey: selected.key,
      select: (key) => submitted.push(key),
    }),
    (callback) => {
      frame = callback;
      return 1;
    },
    () => {},
  );

  scheduler.move(1);
  scheduler.move(1);
  assert.deepEqual(submitted, []);
  frame();
  assert.deepEqual(submitted, ["project:c"]);
  scheduler.dispose();
});

test("keeps advancing when React's selected snapshot is delayed", () => {
  const entries = [entry("project:a"), entry("project:b"), entry("project:c")];
  const submitted = [];
  let frame = null;
  const scheduler = createLibraryNavigationScheduler(
    () => ({
      entries,
      selectedKey: "project:a",
      select: (key) => submitted.push(key),
    }),
    (callback) => {
      frame = callback;
      return 1;
    },
    () => {},
  );

  scheduler.move(1);
  frame();
  scheduler.move(1);
  frame();
  assert.deepEqual(submitted, ["project:b", "project:c"]);
  scheduler.dispose();
});

test("sync resets the cursor after an external selection", () => {
  const entries = [entry("project:a"), entry("project:b"), entry("project:c")];
  const submitted = [];
  let frame = null;
  const scheduler = createLibraryNavigationScheduler(
    () => ({ entries, selectedKey: "project:a", select: (key) => submitted.push(key) }),
    (callback) => {
      frame = callback;
      return 1;
    },
    () => {},
  );

  scheduler.move(1);
  frame();
  scheduler.sync("project:c");
  scheduler.move(-1);
  frame();
  assert.deepEqual(submitted, ["project:b", "project:b"]);
  scheduler.dispose();
});
