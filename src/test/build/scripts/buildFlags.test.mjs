/** The build flag contract: one output mode, one optional profile, no guesses. */
import assert from "node:assert/strict";
import test from "node:test";
import { BUILD_HELP, parseBuildFlags } from "../../../../scripts/buildFlags.mjs";
import { SKIP_BUNDLED_TOOLS_FLAG } from "../../../../scripts/bundledTools.mjs";

test("no flag selects the release installer", () => {
  assert.deepEqual(parseBuildFlags([]), {
    help: false,
    mode: "release",
    fast: false,
    bundledTools: true,
  });
});

test("output modes and the fast profile parse independently", () => {
  assert.deepEqual(parseBuildFlags(["--debug"]), {
    help: false,
    mode: "debug",
    fast: false,
    bundledTools: true,
  });
  assert.deepEqual(parseBuildFlags(["--portable"]), {
    help: false,
    mode: "portable",
    fast: false,
    bundledTools: true,
  });
  assert.deepEqual(parseBuildFlags(["--fast"]), {
    help: false,
    mode: "release",
    fast: true,
    bundledTools: true,
  });
  assert.deepEqual(parseBuildFlags(["--portable", "--fast"]), {
    help: false,
    mode: "portable",
    fast: true,
    bundledTools: true,
  });
});

test("the bundled tool downloads can be skipped in every output mode", () => {
  for (const mode of ["release", "debug", "portable"]) {
    const flags =
      mode === "release" ? [SKIP_BUNDLED_TOOLS_FLAG] : [`--${mode}`, SKIP_BUNDLED_TOOLS_FLAG];
    const parsed = parseBuildFlags(flags);
    assert.equal(parsed.bundledTools, false, mode);
    assert.equal(parsed.mode, mode);
  }
  assert.deepEqual(parseBuildFlags(["--fast", SKIP_BUNDLED_TOOLS_FLAG]), {
    help: false,
    mode: "release",
    fast: true,
    bundledTools: false,
  });
});

test("help wins over build work and names every flag", () => {
  assert.deepEqual(parseBuildFlags(["--help"]), { help: true });
  assert.deepEqual(parseBuildFlags(["-h"]), { help: true });
  for (const flag of ["--debug", "--portable", "--fast", SKIP_BUNDLED_TOOLS_FLAG]) {
    assert.ok(BUILD_HELP.includes(flag), `${flag} is missing from the help text`);
  }
});

test("unknown and conflicting flags fail with an actionable message", () => {
  assert.throws(() => parseBuildFlags(["--release"]), /Unknown build flag: --release/);
  assert.throws(() => parseBuildFlags(["--debug", "--portable"]), /cannot be used together/);
  assert.throws(() => parseBuildFlags(["--debug", "--fast"]), /cannot be used together/);
});
