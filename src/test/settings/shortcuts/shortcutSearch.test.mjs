/** The shortcut page exposes its key caps to the settings search. */
import assert from "node:assert/strict";
import test from "node:test";
import {
  shortcutMatchesSearch,
  shortcutPageSearchTerms,
  shortcutSearchTerms,
} from "../../../frontend/screens/settings/shortcuts/shortcutSearch.ts";

const category = {
  id: "editor.selection",
  title: "shortcuts.category.editor",
  order: 20,
};
const titles = {
  text: (key) => (key === category.title ? "编辑器" : "打开多线编辑"),
  english: (key) => (key === category.title ? "Editor" : "Open multi-line editing"),
};
const view = {
  id: "workspace.multiLine.toggle",
  category: category.id,
  title: "shortcuts.editor.toggleMultiLine",
  defaults: [{ key: "J" }],
  scope: "editor",
  bindings: [{ key: "J" }],
  overridden: false,
  conflicts: [],
};

test("a shortcut row matches its current binding and its title", () => {
  assert.equal(shortcutMatchesSearch(view, category, "J", titles), true);
  assert.equal(shortcutMatchesSearch(view, category, "多线", titles), true);
  assert.equal(shortcutMatchesSearch(view, category, "Open multi", titles), true);
  assert.equal(shortcutMatchesSearch(view, category, "K", titles), false);
});

test("a rebound shortcut still matches the default Reset restores", () => {
  const rebound = {
    ...view,
    bindings: [{ key: "U" }],
    overridden: true,
  };
  assert.equal(shortcutMatchesSearch(rebound, category, "U", titles), true);
  assert.equal(shortcutMatchesSearch(rebound, category, "J", titles), true);
  assert.deepEqual(shortcutSearchTerms(rebound, titles).includes("J"), true);
});

test("page terms cover categories and every visible row", () => {
  const terms = shortcutPageSearchTerms([category], [view], titles);
  assert.deepEqual(terms.includes("Editor"), true);
  assert.deepEqual(terms.includes("Open multi-line editing"), true);
  assert.deepEqual(terms.includes("J"), true);
});
