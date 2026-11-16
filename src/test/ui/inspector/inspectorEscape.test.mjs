/** Covers active Inspector Escape handling and the root no-op behavior. */
import assert from "node:assert/strict";
import test from "node:test";
import {
  consumeEscape,
  registerEscapeHandler,
} from "../../../frontend/platform/shortcuts/escapeHandlers.ts";

test("the active Inspector can consume Escape before the root no-op", () => {
  let closed = false;
  const dispose = registerEscapeHandler(() => {
    closed = true;
    return true;
  });

  assert.equal(consumeEscape(), true);
  assert.equal(closed, true);

  dispose();
  assert.equal(consumeEscape(), false);
});

test("a surface that cannot close lets the root Escape no-op continue", () => {
  const dispose = registerEscapeHandler(() => false);

  assert.equal(consumeEscape(), false);

  dispose();
});
