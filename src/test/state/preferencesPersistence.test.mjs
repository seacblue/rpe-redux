/** Preference writes preserve independent keys changed by another instance. */
import assert from "node:assert/strict";
import test from "node:test";
import { memoryMirror } from "../../core/platform/browser/preferenceMirror.ts";
import { PREFERENCE_SECTIONS, PreferenceStore } from "../../core/state/preferences.ts";

/** Build a shared durable client whose document can be inspected after writes. */
function backend(initial) {
  let document = structuredClone(initial);
  return {
    client: {
      preferences: async () => ({ values: structuredClone(document) }),
      savePreferences: async (values) => {
        document = structuredClone(values);
        return { values };
      },
    },
    read: () => structuredClone(document),
  };
}

/** Read the settings section as an object for one test instance. */
function settings(store) {
  return store.read(PREFERENCE_SECTIONS.settings, {});
}

/** Read the values section as an object for one test instance. */
function persistedValues(store) {
  return store.read(PREFERENCE_SECTIONS.values, {});
}

test("concurrent settings instances merge independent setting keys", async () => {
  const durable = backend({
    settings: {
      "note-size": "1",
      "timeline-note-size": "175",
    },
  });
  const preview = new PreferenceStore({ mirror: memoryMirror() });
  const timeline = new PreferenceStore({ mirror: memoryMirror() });
  await preview.attach(durable.client);
  await timeline.attach(durable.client);

  preview.write(PREFERENCE_SECTIONS.settings, {
    ...settings(preview),
    "note-size": "1.15",
  });
  timeline.write(PREFERENCE_SECTIONS.settings, {
    ...settings(timeline),
    "timeline-note-size": "240",
  });

  await preview.flush();
  await timeline.flush();

  assert.deepEqual(durable.read().settings, {
    "note-size": "1.15",
    "timeline-note-size": "240",
  });
});

test("concurrent first writes merge persisted value entries into an empty section", async () => {
  const durable = backend({});
  const first = new PreferenceStore({ mirror: memoryMirror() });
  const second = new PreferenceStore({ mirror: memoryMirror() });
  await first.attach(durable.client);
  await second.attach(durable.client);

  first.write(PREFERENCE_SECTIONS.values, {
    ...persistedValues(first),
    "extension.first.persisted": 1,
  });
  second.write(PREFERENCE_SECTIONS.values, {
    ...persistedValues(second),
    "extension.second.persisted": 2,
  });

  await first.flush();
  await second.flush();

  assert.deepEqual(durable.read().values, {
    "extension.first.persisted": 1,
    "extension.second.persisted": 2,
  });
});

test("a single settings instance round-trips both note size values", async () => {
  const durable = backend({
    settings: {
      "note-size": "1",
      "timeline-note-size": "175",
    },
  });
  const mirror = memoryMirror();
  const first = new PreferenceStore({ mirror });
  await first.attach(durable.client);
  first.write(PREFERENCE_SECTIONS.settings, {
    "note-size": "1.15",
    "timeline-note-size": "240",
  });
  await first.flush();

  const restarted = new PreferenceStore({ mirror });
  await restarted.attach(durable.client);

  assert.deepEqual(settings(restarted), {
    "note-size": "1.15",
    "timeline-note-size": "240",
  });
});
