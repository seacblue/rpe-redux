/** Home library detail rules: no fabricated card, explicit selection, guarded actions. */
import assert from "node:assert/strict";
import test from "node:test";
import {
  canOperateOnLibraryEntry,
  libraryDetailState,
  nextLibrarySelection,
  resolveLibrarySelection,
} from "../../../frontend/screens/welcome/library/libraryDetailState.ts";

/** Minimal library entry for selector tests; the selectors only read `key`. */
function entry(key) {
  return {
    key,
    title: key,
    composer: "",
    charter: "",
    level: "",
    cover: "",
    audio: null,
    source: { kind: "project", project: { id: key } },
  };
}

test("an empty library keeps the permanent detail prompt", () => {
  assert.equal(libraryDetailState([], null), "prompt");
  assert.equal(libraryDetailState([], entry("project:a")), "prompt");
});

test("a selection outside the current list falls back to the prompt", () => {
  assert.equal(libraryDetailState([entry("project:a")], entry("project:b")), "prompt");
});

test("a populated library without a selection shows the select prompt", () => {
  assert.equal(libraryDetailState([entry("project:a")], null), "prompt");
});

test("a real selection shows the chart detail card", () => {
  assert.equal(libraryDetailState([entry("project:a")], entry("project:a")), "detail");
});

test("selection never falls back to the first chart", () => {
  const entries = [entry("project:a"), entry("project:b")];
  assert.equal(resolveLibrarySelection(entries, null), null);
  assert.equal(resolveLibrarySelection(entries, "project:missing"), null);
  assert.equal(resolveLibrarySelection(entries, "project:b")?.key, "project:b");
});

test("only a real entry can run export, delete, or open", () => {
  assert.equal(canOperateOnLibraryEntry(null), false);
  assert.equal(canOperateOnLibraryEntry(entry("project:a")), true);
});

test("clicking the selected chart again returns to the welcome panel", () => {
  assert.equal(nextLibrarySelection("project:a", "project:a", true), null);
  assert.equal(nextLibrarySelection("project:a", "project:b", true), "project:b");
  assert.equal(nextLibrarySelection(null, "project:a", true), "project:a");
});

test("context-menu selection never toggles the current chart", () => {
  assert.equal(nextLibrarySelection("project:a", "project:a", false), "project:a");
  assert.equal(nextLibrarySelection(null, "project:a", false), "project:a");
});
