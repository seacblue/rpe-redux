/**
 * Guards the advanced-editing permission matrix against a stranded reset slot.
 *
 * With code cells disabled the matrix is one display column. Filling the row's
 * control column would push the reserved reset slot to that column's leading
 * edge, leaving it far from the checkbox it belongs to.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const stylesheet = new URL(
  "../../../frontend/screens/settings/editing/editingAccess.less",
  import.meta.url,
);

test("a single permission column hugs the row's trailing edge", async () => {
  const source = await readFile(stylesheet, "utf8");
  const singleColumn = source.match(/\.editing-access\[data-columns="1"\]\s*\{([\s\S]*?)\n\}/)?.[1];

  assert.ok(singleColumn, "the one-column matrix needs its own rule");
  assert.match(singleColumn, /flex:\s*0\s+0\s+auto;/u);
  assert.match(singleColumn, /width:\s*auto;/u);
  assert.doesNotMatch(source, /\.editing-access\[data-columns="2"\]\s*\{[^}]*width:\s*auto/u);
});
