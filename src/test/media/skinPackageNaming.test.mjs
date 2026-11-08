/**
 * The shipped built-in package follows the shared package-naming rule: its
 * folder id is the display-name slug, its judge-line texture sits at the
 * package root, and it ships without a per-package README or `judgeline/`
 * folder. These assertions keep the shipped tree and the runtime loader in
 * agreement about the built-in package layout.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { packageSlug } from "../../core/utils/packageName.ts";

const skinsRoot = fileURLToPath(new URL("../../assets/skins/", import.meta.url));
const packageDir = join(skinsRoot, "built_in_original");

/** The display name declared by one package's info.yml. */
function infoName(folder) {
  const text = readFileSync(join(folder, "info.yml"), "utf8");
  const line = text.split(/\r?\n/).find((entry) => entry.trimStart().startsWith("name:"));
  return line
    ?.slice(line.indexOf(":") + 1)
    .trim()
    .replace(/^['"]|['"]$/g, "");
}

test("the shipped package folder is the slug of its own display name", () => {
  assert.equal(basename(packageDir), "built_in_original");
  assert.equal(packageSlug(infoName(packageDir)), "built_in_original");
  const packages = readdirSync(skinsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(skinsRoot, entry.name, "info.yml")))
    .map((entry) => entry.name);
  assert.deepEqual(packages, ["built_in_original"]);
});

test("the pre-rename shipped package folder is gone", () => {
  assert.equal(existsSync(join(skinsRoot, "default")), false);
});

test("the shipped info.yml keeps no description", () => {
  const text = readFileSync(join(packageDir, "info.yml"), "utf8");
  assert.doesNotMatch(text, /^\s*description\s*:/m);
});

test("the judge-line texture lives at the package root, not under judgeline/", () => {
  const line = join(packageDir, "line.png");
  assert.ok(existsSync(line) && statSync(line).isFile(), "root line.png is missing");
  assert.equal(existsSync(join(packageDir, "judgeline")), false);
});

test("the shipped package carries no per-package README", () => {
  assert.equal(existsSync(join(packageDir, "README.md")), false);
  assert.equal(existsSync(join(packageDir, "readme.md")), false);
});

test("packageSlug derives one safe id from a display name", () => {
  assert.equal(packageSlug("Built-in - Original"), "built_in_original");
  assert.equal(
    packageSlug("  Multiple   spaces, dots.. and--dashes  "),
    "multiple_spaces_dots_and_dashes",
  );
  // NFKD folds an accented letter to ASCII before the separator run collapses.
  assert.equal(packageSlug("Café"), "cafe");
  // English is the source of truth for a language-keyed name.
  assert.equal(packageSlug({ en: "Built-in - Original", zh: "内置" }), "built_in_original");
});

test("packageSlug falls back to a stable hash when no ASCII characters remain", () => {
  const empty = packageSlug("");
  assert.match(empty, /^skin_[0-9a-f]{8}$/);
  const cjk = packageSlug("内置皮肤");
  assert.match(cjk, /^skin_[0-9a-f]{8}$/);
  assert.equal(packageSlug("内置皮肤"), cjk, "the fallback must be deterministic");
  assert.notEqual(packageSlug("内置皮肤"), packageSlug("другое"));
});

test("packageSlug caps the id and never leaves a trailing separator", () => {
  const long = packageSlug("a".repeat(80));
  assert.equal(long.length, 64);
  const capped = packageSlug(`${"a".repeat(63)} - tail`);
  assert.ok(capped.length <= 64);
  assert.ok(!capped.endsWith("_"));
  assert.match(packageSlug("---"), /^skin_[0-9a-f]{8}$/);
});
