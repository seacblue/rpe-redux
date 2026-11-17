/** Saving and quitting must not inherit the quiet mode of an in-flight backup. */
import assert from "node:assert/strict";
import test from "node:test";
import { createSaveFlight } from "../../../frontend/screens/editor/workspace/document/save/saveFlight.ts";

/** Resolves when a fake save reaches the point where it can stall. */
function deferred() {
  let release;
  const promise = new Promise((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

test("an explicit save waits out an in-flight quiet backup and clears dirty state", async () => {
  const saveGate = deferred();
  const calls = [];
  const flight = createSaveFlight();
  let dirty = true;

  const backup = flight.run({ key: "quiet" }, async () => {
    calls.push("backup");
    await saveGate.promise;
    return "saved";
  });
  await new Promise((resolve) => setImmediate(resolve));
  const explicitSave = flight.run({ key: "save" }, async () => {
    calls.push("explicit");
    dirty = false;
    return "saved";
  });
  saveGate.release();

  const [backupResult, explicitResult] = await Promise.all([backup, explicitSave]);
  assert.equal(backupResult, "saved");
  assert.equal(explicitResult, "saved");
  assert.deepEqual(calls, ["backup", "explicit"]);
  assert.equal(dirty, false);
});

test("different save intents queue instead of sharing a result", async () => {
  const saveGate = deferred();
  const calls = [];
  const flight = createSaveFlight();

  const save = flight.run({ key: "save" }, async () => {
    calls.push("save");
    await saveGate.promise;
    return "saved";
  });
  await new Promise((resolve) => setImmediate(resolve));
  const saveAs = flight.run({ key: "save-as" }, async () => {
    calls.push("save-as");
    return "saved-as";
  });
  saveGate.release();

  const [saveResult, saveAsResult] = await Promise.all([save, saveAs]);
  assert.equal(saveResult, "saved");
  assert.equal(saveAsResult, "saved-as");
  assert.deepEqual(calls, ["save", "save-as"]);
});
