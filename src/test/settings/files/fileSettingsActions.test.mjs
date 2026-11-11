/**
 * Contract: the native application-data folder action exists only on the
 * desktop host; the web host keeps its own storage page instead.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { registerFileSettingsActions } from "../../../frontend/screens/settings/files/fileSettingsActions.ts";

const original = globalThis.__TAURI_INTERNALS__;
const hadOriginal = Object.hasOwn(globalThis, "__TAURI_INTERNALS__");

function restoreHost() {
  if (hadOriginal) {
    globalThis.__TAURI_INTERNALS__ = original;
  } else {
    delete globalThis.__TAURI_INTERNALS__;
  }
}

test("the web host does not register the native data-folder action", () => {
  delete globalThis.__TAURI_INTERNALS__;
  try {
    assert.deepEqual(registerFileSettingsActions(), []);
  } finally {
    restoreHost();
  }
});

test("the desktop host still registers the native data-folder action", () => {
  globalThis.__TAURI_INTERNALS__ = {};
  try {
    const disposers = registerFileSettingsActions();
    assert.equal(disposers.length, 1);
    for (const dispose of disposers) {
      dispose();
    }
  } finally {
    restoreHost();
  }
});
