/** Pins the per-process desktop port argument parser used by parallel runs. */
import assert from "node:assert/strict";
import test from "node:test";
import { desktopPortArgument } from "../../../scripts/desktopLaunchOptions.mjs";

test("desktop port flags accept equals and separated-value forms", () => {
  assert.equal(desktopPortArgument(["--backend-port", "48121"], "backend"), 48121);
  assert.equal(desktopPortArgument(["--ai-port=48122"], "ai"), 48122);
  assert.equal(desktopPortArgument(["--collab-port=48130"], "collab"), 48130);
  assert.equal(desktopPortArgument(["--other=value"], "backend"), undefined);
});

test("desktop port flags reject missing and unstable values", () => {
  assert.throws(() => desktopPortArgument(["--backend-port"], "backend"), /requires/);
  assert.throws(() => desktopPortArgument(["--backend-port=0"], "backend"), /between/);
  assert.throws(() => desktopPortArgument(["--backend-port=abc"], "backend"), /integer/);
});
