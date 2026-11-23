/** Preference refresh adopts changes made by another frontend instance. */
import assert from "node:assert/strict";
import test from "node:test";
import { memoryMirror } from "../../core/platform/browser/preferenceMirror.ts";
import { PREFERENCE_SECTIONS, PreferenceStore } from "../../core/state/preferences.ts";

test("refresh adopts a remote clipboard section", async () => {
  const remote = { values: { [PREFERENCE_SECTIONS.clipboard]: { version: 1, marker: "one" } } };
  const store = new PreferenceStore({ mirror: memoryMirror() });
  await store.attach({
    preferences: async () => remote,
    savePreferences: async (values) => ({ values }),
  });
  remote.values[PREFERENCE_SECTIONS.clipboard] = { version: 1, marker: "two" };

  const changed = await store.refresh([PREFERENCE_SECTIONS.clipboard]);

  assert.deepEqual(changed, [PREFERENCE_SECTIONS.clipboard]);
  assert.equal(store.read(PREFERENCE_SECTIONS.clipboard).marker, "two");
});

test("refresh leaves a locally dirty clipboard untouched", async () => {
  const remote = { values: { [PREFERENCE_SECTIONS.clipboard]: { version: 1, marker: "remote" } } };
  const store = new PreferenceStore({ mirror: memoryMirror() });
  await store.attach({
    preferences: async () => remote,
    savePreferences: async (values) => ({ values }),
  });
  store.write(PREFERENCE_SECTIONS.clipboard, { version: 1, marker: "local" });
  remote.values[PREFERENCE_SECTIONS.clipboard] = { version: 1, marker: "other" };

  await store.refresh([PREFERENCE_SECTIONS.clipboard]);

  assert.equal(store.read(PREFERENCE_SECTIONS.clipboard).marker, "local");
});
