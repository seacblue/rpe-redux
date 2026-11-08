/**
 * Phira zip intake used by the settings import button and the workbench drop
 * target: one optional top-level folder is stripped and `info.yml` is required.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { zipSync } from "fflate";
import { unpackPhira } from "../../frontend/screens/settings/skin/phiraPackage.ts";

test("unpackPhira strips one top-level folder", () => {
  const archive = zipSync({
    "My Skin/info.yml": new TextEncoder().encode('name: "My Skin"\n'),
    "My Skin/click.png": new Uint8Array([1, 2, 3]),
  });
  const files = unpackPhira(archive);
  assert.deepEqual([...files.keys()].sort(), ["click.png", "info.yml"]);
  assert.deepEqual(files.get("click.png"), new Uint8Array([1, 2, 3]));
});

test("unpackPhira rejects an archive without info.yml", () => {
  const archive = zipSync({ "click.png": new Uint8Array([1]) });
  assert.throws(() => unpackPhira(archive), /does not contain info\.yml/);
});
