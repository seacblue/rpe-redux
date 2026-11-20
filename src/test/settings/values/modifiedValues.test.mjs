/**
 * User-modification provenance for persisted values.
 *
 * The flag is independent of value equality: a commit equal to the default is
 * still a modification, and only the reset path clears it. Programmatic writes
 * and imports never touch it.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  PREFERENCE_SECTIONS,
  readPreference,
  writePreference,
} from "../../../core/state/preferences.ts";
import { values } from "../../../core/state/values.ts";

/** Unique suffix so process-wide registries and preferences never collide. */
function suffix() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

/** A fresh key in a temporary namespace. */
function uniqueKey(name) {
  return `test.modified.${name}.${suffix()}`;
}

const meta = () => readPreference(PREFERENCE_SECTIONS.valueMeta, {});
const storedSettings = () => readPreference(PREFERENCE_SECTIONS.settings, {});

/** Restore the preference sections a test changed. */
function restore({ meta: previousMeta, settings: previousSettings }) {
  writePreference(PREFERENCE_SECTIONS.valueMeta, previousMeta);
  writePreference(PREFERENCE_SECTIONS.settings, previousSettings);
}

test("a user commit equal to the default is still a modification", () => {
  const before = { meta: meta(), settings: storedSettings() };
  const id = uniqueKey("same-as-default");
  try {
    values.define({ id, initial: "4", persist: PREFERENCE_SECTIONS.settings });
    assert.equal(values.byId.isModified(id), false);

    values.byId.setUser(id, "4");

    assert.equal(values.byId.get(id), "4");
    assert.equal(values.byId.isModified(id), true);
    assert.equal(Object.hasOwn(storedSettings(), id), false);
    assert.equal(meta().modified[id], true);
  } finally {
    values.undefine(id, { purge: true });
    restore(before);
  }
});

test("reset restores the initial value and clears the mark", () => {
  const before = { meta: meta(), settings: storedSettings() };
  const id = uniqueKey("reset");
  try {
    values.define({ id, initial: "a", persist: PREFERENCE_SECTIONS.settings });
    values.byId.setUser(id, "b");
    assert.equal(values.byId.isModified(id), true);
    assert.equal(storedSettings()[id], "b");

    values.byId.reset(id);

    assert.equal(values.byId.get(id), "a");
    assert.equal(values.byId.isModified(id), false);
    assert.equal(Object.hasOwn(storedSettings(), id), false);
    assert.equal(meta().modified[id], undefined);

    // Reset still clears the flag when the value already equals the default.
    values.byId.setUser(id, "a");
    assert.equal(values.byId.isModified(id), true);
    values.byId.reset(id);
    assert.equal(values.byId.isModified(id), false);
  } finally {
    values.undefine(id, { purge: true });
    restore(before);
  }
});

test("programmatic writes neither mark nor clear a value", () => {
  const before = { meta: meta(), settings: storedSettings() };
  const id = uniqueKey("programmatic");
  try {
    values.define({ id, initial: "a", persist: PREFERENCE_SECTIONS.settings });

    values.byId.set(id, "b");
    assert.equal(values.byId.isModified(id), false);

    values.byId.setUser(id, "a");
    assert.equal(values.byId.isModified(id), true);

    values.byId.set(id, "c");
    assert.equal(values.byId.isModified(id), true);
  } finally {
    values.undefine(id, { purge: true });
    restore(before);
  }
});

test("modification subscribers hear the mark and the reset", () => {
  const before = { meta: meta(), settings: storedSettings() };
  const id = uniqueKey("subscribe");
  try {
    values.define({ id, initial: "a", persist: PREFERENCE_SECTIONS.settings });
    let changes = 0;
    const stop = values.byId.subscribeModified(id, () => {
      changes += 1;
    });

    values.byId.setUser(id, "a");
    assert.equal(changes, 1);
    values.byId.setUser(id, "b");
    assert.equal(changes, 1);
    values.byId.reset(id);
    assert.equal(changes, 2);

    stop();
    values.byId.setUser(id, "b");
    assert.equal(changes, 2);
  } finally {
    values.undefine(id, { purge: true });
    restore(before);
  }
});

test("untracked persisted values do not create provenance", () => {
  const before = { meta: meta(), settings: storedSettings() };
  const id = uniqueKey("untracked");
  try {
    values.define({ id, initial: "a", persist: true });
    values.byId.setUser(id, "a");

    assert.equal(values.byId.isModified(id), false);
    assert.equal(meta().modified?.[id], undefined);
  } finally {
    values.undefine(id, { purge: true });
    restore(before);
  }
});

test("the one-time backfill marks values that already had a stored entry", () => {
  const before = { meta: meta(), settings: storedSettings() };
  const id = uniqueKey("backfill");
  try {
    writePreference(PREFERENCE_SECTIONS.settings, {
      ...storedSettings(),
      [id]: "custom",
    });
    writePreference(PREFERENCE_SECTIONS.valueMeta, { version: 0, modified: {} });
    values.define({ id, initial: "default", persist: PREFERENCE_SECTIONS.settings });

    assert.equal(values.byId.get(id), "custom");
    assert.equal(values.byId.isModified(id), false);

    assert.equal(values.reconcileModifiedMetadata(), 1);
    assert.equal(values.byId.isModified(id), true);
    assert.equal(meta().version, 1);
    assert.equal(meta().modified[id], true);

    assert.equal(values.reconcileModifiedMetadata(), 0);
  } finally {
    values.undefine(id, { purge: true });
    restore(before);
  }
});

test("purging a value removes its provenance", () => {
  const before = { meta: meta(), settings: storedSettings() };
  const id = uniqueKey("purge");
  try {
    values.define({ id, initial: "a", persist: PREFERENCE_SECTIONS.settings });
    values.byId.setUser(id, "b");
    assert.equal(meta().modified[id], true);

    values.undefine(id, { purge: true });

    assert.equal(meta().modified[id], undefined);
    assert.equal(values.byId.has(id), false);
  } finally {
    restore(before);
  }
});
