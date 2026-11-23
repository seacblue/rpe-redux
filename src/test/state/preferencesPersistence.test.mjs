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
