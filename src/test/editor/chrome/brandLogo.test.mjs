/** The title-bar brand must use the same document-closing navigation as File. */
import assert from "node:assert/strict";
import test from "node:test";
import { activateBrandLogo } from "../../../frontend/chrome/topbar/brandLogoNavigation.ts";

test("the editor brand closes the document through the shared library exit", () => {
  const calls = [];
  activateBrandLogo(false, {
    openLibrary: () => calls.push("open-library"),
    closeLibrary: () => calls.push("close-library"),
  });
  assert.deepEqual(calls, ["close-library"]);
});

test("the home brand is inert", () => {
  const calls = [];
  activateBrandLogo(true, {
    openLibrary: () => calls.push("open-library"),
    closeLibrary: () => calls.push("close-library"),
  });
  assert.deepEqual(calls, []);
});
