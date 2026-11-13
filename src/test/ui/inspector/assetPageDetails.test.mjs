/** The asset pane composes one column while there is no asset to preview. */
import assert from "node:assert/strict";
import test from "node:test";
import { assetPageHasDetails } from "../../../frontend/screens/global/sections/assets/model.ts";

test("a library with no assets has no details face", () => {
  assert.equal(assetPageHasDetails(0), false);
});

test("any asset gives the details face a selection to preview", () => {
  assert.equal(assetPageHasDetails(1), true);
  assert.equal(assetPageHasDetails(12), true);
});
