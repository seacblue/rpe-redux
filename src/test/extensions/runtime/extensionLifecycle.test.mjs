/** Verifies Extension value ownership, persistent settings, and activation generations. */
import assert from "node:assert/strict";
import test from "node:test";
import { shortcuts as shortcutsApi } from "../../../core/api/shortcuts.ts";
import { values as valuesApi } from "../../../core/api/values.ts";
import {
  EXTENSION_EVENT_NAMES,
  ExtensionEventNameError,
} from "../../../core/extensions/contract.ts";
import { connectExtensionApi } from "../../../core/extensions/extensionApi.ts";
import { ExtensionRuntime } from "../../../core/extensions/extensionRuntime.ts";
import { extensionRegistry } from "../../../core/extensions/runtime.ts";
import { settingsRegistry } from "../../../core/settings/settings.ts";
import { shortcutRegistry } from "../../../core/shortcuts/registry.ts";
import {
  PREFERENCE_SECTIONS,
  PreferenceStore,
  preferences,
} from "../../../core/state/preferences.ts";
import { values as valueRegistry } from "../../../core/state/values.ts";

/** A facade-shaped object with the handles the gate reads at build time. */
function fakeApi() {
  return {
    version: "test",
    chart: {},
    transaction: {},
    selection: {},
    document: {},
    library: {},
    playback: {},
    settings: {},
    toolbar: {},
    sidebar: {},
    contextMenu: {},
    values: valuesApi,
    shortcuts: shortcutsApi,
    diagnostics: {},
    hitTest: {},
    preview: {},
    layout: {},
    workspace: {},
    help: {},
    extensions: {},
  };
}

connectExtensionApi(fakeApi());

/** Unique suffix so process-wide registries never collide across tests. */
function suffix() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

/** Build one code package manifest with the requested capabilities. */
function manifest(id, capabilities) {
  return {
    kind: "extension",
    id,
    name: id,
    version: "1.0.0",
    engines: { "rpe-redux": 1 },
    entry: "index.js",
    capabilities,
  };
}

/** Poll a microtask-sized condition without depending on wall-clock timing. */
async function waitFor(predicate, label) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  assert.fail(`Timed out waiting for ${label}`);
}

/** Read the persisted settings section. */
function settingsSection() {
  return preferences.read(PREFERENCE_SECTIONS.settings, {});
}

test("owner value disposal removes definitions and subscriptions", () => {
  const owner = `test.values.${suffix()}`;
  const id = `${owner}.counter`;
  const first = valueRegistry.define({ id, initial: 0 }, owner);
  let updates = 0;
  first.subscribe(() => {
    updates += 1;
  });
  first.set(1);
  assert.equal(updates, 1);

  assert.equal(valueRegistry.removeOwner(owner), 1);
  assert.equal(valueRegistry.has(id), false);
  first.set(2);
  assert.equal(updates, 1, "a disposed subscription still received a write");

  const second = valueRegistry.define({ id, initial: 5 }, owner);
  assert.notEqual(second, first);
  assert.equal(second.get(), 5);
  const third = valueRegistry.define({ id, initial: 9 }, owner);
  assert.equal(third, second, "the same owner re-declared a value instead of reusing it");
  valueRegistry.removeOwner(owner);
});

test("owner disposal keeps stored values while purge removes them", () => {
  const owner = `test.persisted.${suffix()}`;
  const id = `${owner}.counter`;
  try {
    const handle = valueRegistry.define({ id, initial: 0, persist: true }, owner);
    handle.set(7);
    assert.equal(preferences.read(PREFERENCE_SECTIONS.values, {})[id], 7);

    assert.equal(valueRegistry.removeOwner(owner), 1);
    assert.equal(preferences.read(PREFERENCE_SECTIONS.values, {})[id], 7);

    const readopted = valueRegistry.define({ id, initial: 0, persist: true }, owner);
    assert.equal(readopted.get(), 7);

    assert.equal(valueRegistry.purgeOwner(owner), 1);
    assert.equal(preferences.read(PREFERENCE_SECTIONS.values, {})[id], undefined);
  } finally {
    valueRegistry.purgeOwner(owner);
  }
});

test("uninstall clears only the owner's storage, while unload preserves it", () => {
  const id = `test.storage.${suffix()}`;
  const store = new PreferenceStore();
  const own = `extension:${id}:key`;
  const legacy = `mod:${id}:old`;
  const other = `extension:${id}.other:key`;
  store.write(PREFERENCE_SECTIONS.values, { [own]: "value", [legacy]: "old", [other]: "keep" });
  const runtime = new ExtensionRuntime({ preferenceStore: store, hostVersion: "1.0.0" });
  const loader = async () => ({ source: "export default { activate() {} };" });
  assert.equal(runtime.loadManifest(manifest(id, ["storage"]), loader).ok, true);
  assert.equal(runtime.unload(id).ok, true);
  assert.equal(store.read(PREFERENCE_SECTIONS.values, {})[own], "value");
  assert.equal(runtime.loadManifest(manifest(id, ["storage"]), loader).ok, true);
  assert.equal(runtime.uninstall(id).ok, true);
  const values = store.read(PREFERENCE_SECTIONS.values, {});
  assert.equal(values[own], undefined);
  assert.equal(values[legacy], undefined);
  assert.equal(values[other], "keep");
});

test("disable and language reload keep settings; uninstall purges them", async () => {
  const id = `test.lifecycle.${suffix()}`;
  const settingKey = `extension.${id}.flag`;
  const valueId = `extension.${id}.counter`;
  const store = new PreferenceStore();
  let starts = 0;
  const runtime = new ExtensionRuntime({
    preferenceStore: store,
    hostVersion: "1.0.0",
    sandboxFactory: (input) => {
      starts += 1;
      const sandbox = {
        disposed: false,
        start: async () => {
          const api = input.context.api;
          api.values.define({ id: "counter", initial: 0 });
          api.settings.registerSetting({
            key: "flag",
            navigation: id,
            group: "test",
            label: "Flag",
            control: "toggle",
            default: false,
          });
          api.values.byId.set(settingKey, true);
        },
        dispose: () => {
          sandbox.disposed = true;
        },
      };
      return sandbox;
    },
  });
  const loader = async () => ({ source: "export default { activate() {} };" });
  runtime.loadManifest(manifest(id, ["values", "settings"]), loader);
  try {
    const first = await runtime.enableAsync(id, true);
    assert.equal(first.ok, true, JSON.stringify(first));
    assert.equal(settingsSection()[settingKey], true);
    assert.equal(valueRegistry.has(valueId), true);

    assert.equal(runtime.disable(id).ok, true);
    assert.equal(settingsSection()[settingKey], true, "disable deleted the stored setting");
    assert.equal(valueRegistry.has(valueId), false, "disable left the owner value behind");

    const second = await runtime.enableAsync(id, true);
    assert.equal(second.ok, true, JSON.stringify(second));
    assert.equal(settingsSection()[settingKey], true);

    await runtime.reloadEnabled();
    const snapshot = runtime.list().find((entry) => entry.manifest.id === id);
    assert.equal(snapshot?.status, "enabled");
    assert.equal(settingsSection()[settingKey], true, "language reload deleted the stored setting");
    assert.equal(valueRegistry.has(valueId), true);
    assert.equal(starts, 3);

    const unloaded = runtime.unload(id);
    assert.equal(unloaded.ok, true, JSON.stringify(unloaded));
    assert.equal(settingsSection()[settingKey], true, "unload deleted the stored setting");
    assert.equal(valueRegistry.has(valueId), false);
    assert.equal(runtime.list().length, 0);

    const reloaded = runtime.loadManifest(manifest(id, ["values", "settings"]), loader);
    assert.equal(reloaded.ok, true, JSON.stringify(reloaded));
    const third = await runtime.enableAsync(id, true);
    assert.equal(third.ok, true, JSON.stringify(third));
    assert.equal(settingsSection()[settingKey], true);
    assert.equal(starts, 4);

    const uninstalled = runtime.uninstall(id);
    assert.equal(uninstalled.ok, true, JSON.stringify(uninstalled));
    assert.equal(settingsSection()[settingKey], undefined, "uninstall kept the stored setting");
    assert.equal(valueRegistry.has(valueId), false);
    assert.equal(runtime.list().length, 0);
  } finally {
    if (runtime.list().some((entry) => entry.manifest.id === id)) {
      runtime.uninstall(id);
    } else {
      settingsRegistry.purgeOwner(id);
      valueRegistry.purgeOwner(id);
    }
  }
});

test("disable during a delayed activation disposes its sandbox and listeners", async () => {
  const id = `test.cancel.${suffix()}`;
  const event = "document:created";
  let releaseStart = null;
  let created = 0;
  let disposed = false;
  const runtime = new ExtensionRuntime({
    preferenceStore: new PreferenceStore(),
    hostVersion: "1.0.0",
    sandboxFactory: (input) => {
      created += 1;
      const sandbox = {
        start: async () => {
          input.context.events.on(event, () => {});
          await new Promise((resolve) => {
            releaseStart = resolve;
          });
        },
        dispose: () => {
          disposed = true;
        },
      };
      return sandbox;
    },
  });
  runtime.loadManifest(manifest(id, ["events"]), async () => ({
    source: "export default { activate() {} };",
  }));
  try {
    const pending = runtime.enableAsync(id, true);
    await waitFor(() => created === 1 && releaseStart !== null, "the sandbox to start");
    assert.equal(extensionRegistry.hasEvent(event), true);

    const disabled = runtime.disable(id);
    assert.equal(disabled.ok, true, JSON.stringify(disabled));
    assert.equal(disposed, true, "disable did not dispose the in-flight sandbox");
    assert.equal(extensionRegistry.hasEvent(event), false, "activation listeners survived disable");

    releaseStart();
    const result = await pending;
    assert.equal(result.ok, false);
    assert.match(result.reason, /cancelled/u);
    const snapshot = runtime.list().find((entry) => entry.manifest.id === id);
    assert.equal(snapshot?.status, "disabled");
    assert.equal(created, 1);
  } finally {
    releaseStart?.();
    runtime.unload(id);
  }
});

test("concurrent enableAsync calls share one activation and one sandbox", async () => {
  const id = `test.race.${suffix()}`;
  let releaseStart = null;
  let created = 0;
  const runtime = new ExtensionRuntime({
    preferenceStore: new PreferenceStore(),
    hostVersion: "1.0.0",
    sandboxFactory: () => {
      created += 1;
      return {
        start: async () => {
          await new Promise((resolve) => {
            releaseStart = resolve;
          });
        },
        dispose: () => {},
      };
    },
  });
  runtime.loadManifest(manifest(id, []), async () => ({
    source: "export default { activate() {} };",
  }));
  try {
    const first = runtime.enableAsync(id, true);
    const second = runtime.enableAsync(id, true);
    await waitFor(() => created === 1 && releaseStart !== null, "the shared sandbox to start");
    assert.equal(created, 1, "two overlapping enables created two sandboxes");
    releaseStart();
    const [left, right] = await Promise.all([first, second]);
    assert.equal(left.ok, true, JSON.stringify(left));
    assert.equal(right.ok, true, JSON.stringify(right));
    assert.equal(created, 1);
    const snapshot = runtime.list().find((entry) => entry.manifest.id === id);
    assert.equal(snapshot?.status, "enabled");
    assert.equal(runtime.disable(id).ok, true);
  } finally {
    releaseStart?.();
    runtime.unload(id);
  }
});

test("a category registration can be disposed and registered again", async () => {
  const id = `test.category.${suffix()}`;
  const categoryId = `extension.${id}.probe`;
  const runtime = new ExtensionRuntime({
    preferenceStore: new PreferenceStore(),
    hostVersion: "1.0.0",
    sandboxFactory: (input) => {
      const sandbox = {
        registration: null,
        start: async () => {
          sandbox.registration = input.context.api.shortcuts.registerCategory({
            id: "probe",
            title: "Probe",
            order: 900,
          });
        },
        dispose: () => {
          sandbox.registration?.dispose();
          sandbox.registration = null;
        },
      };
      return sandbox;
    },
  });
  runtime.loadManifest(manifest(id, ["shortcuts"]), async () => ({
    source: "export default { activate() {} };",
  }));
  try {
    const first = await runtime.enableAsync(id, true);
    assert.equal(first.ok, true, JSON.stringify(first));
    assert.equal(shortcutRegistry.hasCategory(categoryId), true);
    assert.equal(runtime.disable(id).ok, true);
    assert.equal(shortcutRegistry.hasCategory(categoryId), false);

    const second = await runtime.enableAsync(id, true);
    assert.equal(second.ok, true, JSON.stringify(second));
    assert.equal(shortcutRegistry.hasCategory(categoryId), true);
    assert.equal(runtime.disable(id).ok, true);
  } finally {
    runtime.unload(id);
  }
});

test("event subscriptions accept only the host allowlist", async () => {
  const id = `test.events.${suffix()}`;
  const observed = {};
  const runtime = new ExtensionRuntime({
    preferenceStore: new PreferenceStore(),
    hostVersion: "1.0.0",
    sandboxFactory: (input) => ({
      start: async () => {
        observed.frozen = Object.isFrozen(EXTENSION_EVENT_NAMES);
        observed.names = [...EXTENSION_EVENT_NAMES];
        observed.subscribed = EXTENSION_EVENT_NAMES.map((name) => {
          input.context.events.on(name, () => {});
          return extensionRegistry.hasEvent(name);
        });
        try {
          input.context.events.on("test.event.custom", () => {});
        } catch (error) {
          observed.error = error;
        }
        observed.unknownRegistered = extensionRegistry.hasEvent("test.event.custom");
      },
      dispose: () => {},
    }),
  });
  runtime.loadManifest(manifest(id, ["events"]), async () => ({
    source: "export default { activate() {} };",
  }));
  try {
    const result = await runtime.enableAsync(id, true);
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(observed.frozen, true, "the event allowlist is mutable");
    assert.deepEqual(observed.names, [
      "extension:callback-error",
      "document:opened",
      "document:created",
      "document:restored",
      "document:saved",
      "document:closed",
      "chart:changed",
      "selection:after-paste",
    ]);
    assert.deepEqual(
      observed.subscribed,
      observed.names.map(() => true),
    );
    assert.ok(observed.error, "an unknown event name was accepted");
    assert.ok(observed.error instanceof ExtensionEventNameError);
    assert.equal(observed.error.code, "eventNotAllowed");
    assert.match(observed.error.message, /test\.event\.custom/u);
    assert.doesNotMatch(observed.error.message, /document:opened/u);
    assert.equal(observed.unknownRegistered, false, "a rejected subscription reached the registry");

    assert.equal(runtime.disable(id).ok, true);
    for (const name of EXTENSION_EVENT_NAMES) {
      assert.equal(
        extensionRegistry.hasEvent(name),
        false,
        `subscription survived disable: ${name}`,
      );
    }
  } finally {
    runtime.unload(id);
  }
});

test("event subscriptions keep the 128 cap and clamp priority", async () => {
  const id = `test.events.cap.${suffix()}`;
  const calls = [];
  const observed = {};
  const runtime = new ExtensionRuntime({
    preferenceStore: new PreferenceStore(),
    hostVersion: "1.0.0",
    sandboxFactory: (input) => ({
      start: async () => {
        const on = input.context.events.on;
        on("document:opened", () => calls.push("atLimit"), 1000);
        on("document:opened", () => calls.push("aboveLimit"), 5000);
        on("document:opened", () => calls.push("belowLimit"), -5000);
        on("document:opened", () => calls.push("atNegativeLimit"), -1000);
        for (let index = 4; index < 128; index += 1) {
          on("document:opened", () => {});
        }
        try {
          on("document:opened", () => {});
        } catch (error) {
          observed.limitError = error;
        }
        extensionRegistry.emitEvent("document:opened", { name: "demo", path: null, chart: null });
      },
      dispose: () => {},
    }),
  });
  runtime.loadManifest(manifest(id, ["events"]), async () => ({
    source: "export default { activate() {} };",
  }));
  try {
    const result = await runtime.enableAsync(id, true);
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.deepEqual(calls, ["atLimit", "aboveLimit", "belowLimit", "atNegativeLimit"]);
    assert.ok(observed.limitError, "the 129th subscription was accepted");
    assert.match(observed.limitError.message, /subscription limit reached: 128/u);

    assert.equal(runtime.disable(id).ok, true);
    assert.equal(extensionRegistry.hasEvent("document:opened"), false);
  } finally {
    runtime.unload(id);
  }
});
