/**
 * The shipped built-in packages declare stable folder ids separately from
 * their display names, and each package has the files the runtime expects.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { packageSlug, packageSlugWithHash } from "../../core/utils/packageName.ts";

const skinsRoot = fileURLToPath(new URL("../../assets/skins/", import.meta.url));
const packageDirs = ["builtin_reducer_cells", "builtin_phiskin"].map((name) =>
  join(skinsRoot, name),
);

/** The display name declared by one package's info.yml. */
function infoName(folder) {
  const text = readFileSync(join(folder, "info.yml"), "utf8");
  const line = text.split(/\r?\n/).find((entry) => entry.trimStart().startsWith("name:"));
  return line
    ?.slice(line.indexOf(":") + 1)
    .trim()
    .replace(/^['"]|['"]$/g, "");
}

test("the shipped packages have explicit ids and display names", () => {
  assert.equal(infoName(packageDirs[0]), "Reducer Cells");
  assert.equal(infoName(packageDirs[1]), "Phiskin ~ 圆角简约");
  assert.match(
    readFileSync(join(packageDirs[0], "info.yml"), "utf8"),
    /^id:\s*builtin_reducer_cells\s*$/m,
  );
  assert.match(
    readFileSync(join(packageDirs[1], "info.yml"), "utf8"),
    /^id:\s*builtin_phiskin\s*$/m,
  );
  const packages = readdirSync(skinsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(skinsRoot, entry.name, "info.yml")))
    .map((entry) => entry.name);
  assert.deepEqual(packages, ["builtin_phiskin", "builtin_reducer_cells"].sort());
});

test("the replaced built-in package folders are gone", () => {
  assert.equal(existsSync(join(skinsRoot, "built_in_original")), false);
  assert.equal(existsSync(join(skinsRoot, "default")), false);
});

test("the Reducer Cells judge-line texture stays at the package root", () => {
  const line = join(packageDirs[0], "line.png");
  assert.ok(existsSync(line) && statSync(line).isFile(), "root line.png is missing");
  assert.equal(existsSync(join(packageDirs[0], "judgeline")), false);
});

test("the shipped packages carry no per-package README", () => {
  for (const packageDir of packageDirs) {
    assert.equal(existsSync(join(packageDir, "README.md")), false);
    assert.equal(existsSync(join(packageDir, "readme.md")), false);
  }
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

test("packageSlugWithHash keeps an ASCII stem and an eight-digit name hash", () => {
  assert.match(packageSlugWithHash("Built-in - Original"), /^built_in_original_[0-9a-f]{8}$/);
  assert.match(packageSlugWithHash("圆角简约"), /^skin_[0-9a-f]{8}$/);
  assert.equal(packageSlugWithHash("  Café  "), packageSlugWithHash("Café"));
});

test("packageSlug caps the id and never leaves a trailing separator", () => {
  const long = packageSlug("a".repeat(80));
  assert.equal(long.length, 64);
  const capped = packageSlug(`${"a".repeat(63)} - tail`);
  assert.ok(capped.length <= 64);
  assert.ok(!capped.endsWith("_"));
  assert.match(packageSlug("---"), /^skin_[0-9a-f]{8}$/);
});
