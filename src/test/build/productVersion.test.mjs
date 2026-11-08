/** Verifies that desktop build inputs share one version and reject drift. */
import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { readProductVersion } from "../../../scripts/productVersion.mjs";

const root = resolve(import.meta.dirname, "../../..");

test("desktop build version is shared by package, Tauri, and Cargo", () => {
  assert.doesNotThrow(() => readProductVersion(root));
});

test("desktop build rejects a version drift before producing mixed artifacts", () => {
  const temporaryRoot = mkdtempSync(join(tmpdir(), "redux-version-test-"));
  try {
    cpSync(join(root, "package.json"), join(temporaryRoot, "package.json"));
    mkdirSync(join(temporaryRoot, "src-tauri"));
    cpSync(join(root, "src-tauri", "Cargo.toml"), join(temporaryRoot, "src-tauri", "Cargo.toml"));
    cpSync(
      join(root, "src-tauri", "tauri.conf.json"),
      join(temporaryRoot, "src-tauri", "tauri.conf.json"),
    );
    const tauriPath = join(temporaryRoot, "src-tauri", "tauri.conf.json");
    const tauri = JSON.parse(readFileSync(tauriPath, "utf8"));
    tauri.version = "0.0.0-test";
    writeFileSync(tauriPath, JSON.stringify(tauri));
    assert.throws(() => readProductVersion(temporaryRoot), /Product version mismatch/);
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});
