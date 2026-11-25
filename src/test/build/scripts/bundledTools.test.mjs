/**
 * The skipped-tool contract: the build drops both optional downloads, still stages
 * the Go sidecar, and leaves a self-describing resource folder so the bundle
 * globs resolve without the binaries.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { SKIP_BUNDLED_TOOLS_FLAG, SKIPPED_TOOL_NOTE } from "../../../../scripts/bundledTools.mjs";
import { desktopPrerequisiteScripts } from "../../../../scripts/desktopPrerequisites.mjs";

const ROOT = resolve(import.meta.dirname, "../../../..");

test("the skip flag names the intent instead of a tool", () => {
  assert.equal(SKIP_BUNDLED_TOOLS_FLAG, "--without-bundled-tools");
});

test("a skipped build stages the Go sidecar and neither download", () => {
  const scripts = desktopPrerequisiteScripts(ROOT, { bundledTools: false });
  assert.equal(scripts.length, 1);
  assert.ok(scripts[0].endsWith(join("src", "backend", "build.ts")));

  const complete = desktopPrerequisiteScripts(ROOT);
  assert.equal(complete.length, 3);
  assert.ok(complete.some((script) => script.endsWith("prepareFfmpeg.mjs")));
  assert.ok(complete.some((script) => script.endsWith("prepareCloudflared.mjs")));
  assert.ok(complete.some((script) => script.endsWith(join("src", "backend", "build.ts"))));
});

test("the note file is shared by the build guard and both staging scripts", () => {
  assert.equal(SKIPPED_TOOL_NOTE, "NOT-BUNDLED.txt");
  const sources = [
    join(ROOT, "src-tauri", "build.rs"),
    join(ROOT, "scripts", "prepareFfmpeg.mjs"),
    join(ROOT, "scripts", "prepareCloudflared.mjs"),
  ].map((path) => readFileSync(path, "utf8"));
  // The Rust guard spells the file name; a rename here must reach it too.
  assert.ok(sources[0].includes(`"${SKIPPED_TOOL_NOTE}"`), "build.rs does not use the note name");
  for (const source of sources.slice(1)) {
    assert.ok(source.includes("SKIPPED_TOOL_NOTE"), "a staging script does not clear the note");
  }
});
