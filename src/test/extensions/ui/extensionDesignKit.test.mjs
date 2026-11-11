/**
 * Verifies the Extension design kit: live theme tokens, owner-scoped sidebar
 * navigation, JSON storage helpers, and the matching method-registry entries.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { buildExtensionThemeTokens, connectExtensionThemeTokens } from "../../../core/api/theme.ts";
import { redux } from "../../../core/api/index.ts";
import { sidebar as sidebarApi, connectSidebarNavigationHost } from "../../../core/api/sidebar.ts";
import { values as valuesApi } from "../../../core/api/values.ts";
import { connectExtensionApi } from "../../../core/extensions/extensionApi.ts";
import { ExtensionRuntime } from "../../../core/extensions/extensionRuntime.ts";
import {
  assertRegistryComplete,
  ExtensionMethodRegistrationError,
  lookupMethod,
} from "../../../core/extensions/methodRegistry.ts";
import { gateExtensionApi } from "../../../core/extensions/capabilityGate.ts";
import { PreferenceStore } from "../../../core/state/preferences.ts";
import { getSidebarEntry, registerSidebarItem } from "../../../core/shell/registries/sidebar.ts";

connectExtensionApi(redux);

/** A fake facade with every handle the capability gate reads while assembling. */
function fakeApi() {
  return {
    version: "test",
    chart: { placeNote() {} },
    transaction: {},
    selection: {},
    document: {},
    library: {},
    playback: {},
    settings: {},
    toolbar: {},
    sidebar: sidebarApi,
    contextMenu: {},
    values: valuesApi,
    shortcuts: {},
    diagnostics: {},
    hitTest: {},
    preview: {},
    layout: {},
    workspace: {},
    help: {},
    extensions: {},
  };
}

/** Build one immutable snapshot from deterministic token values. */
function themeSnapshot() {
  const read = (variable) =>
    ({
      "--foreground": "#f0f0f0",
      "--surface": "#101010",
      "--surface-raised": "#181818",
      "--panel-border": "#303030",
      "--accent": "#4c9aff",
      "--danger": "#ff6b81",
      "--warning": "#ffcc66",
      "--playing-indicator": "#5ee08a",
      "--foreground-muted": "#9ca3af",
      "--radius-panel": "8px",
      "--space-2": "8px",
      "--type-body": "14px",
      "--shadow-panel": "0 20px 64px #000",
      "--design-dur-tint": "140ms",
      "--design-ease-enter": "cubic-bezier(0.16, 1, 0.3, 1)",
      "font-family": "Saira, sans-serif",
      "--font-mono": "Consolas, monospace",
    })[variable] ?? "";
  return buildExtensionThemeTokens({ id: "dark", name: "Dark", appearance: "dark" }, read);
}

/** Assert every leaf is JSON scalar data rather than a host object. */
function assertJsonScalars(value, path = "tokens") {
  if (value === null) {
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertJsonScalars(entry, `${path}[${index}]`));
    return;
  }
  if (typeof value === "object") {
    for (const [key, entry] of Object.entries(value)) {
      assertJsonScalars(entry, `${path}.${key}`);
    }
    return;
  }
  assert.ok(
    typeof value === "string" || typeof value === "number" || typeof value === "boolean",
    `${path} is not JSON scalar data: ${typeof value}`,
  );
}

/** A mutable theme host with explicit listener control. */
function createThemeHost() {
  const listeners = new Set();
  const snapshot = themeSnapshot();
  const disconnect = connectExtensionThemeTokens({
    tokens: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  });
  return {
    disconnect,
    listeners,
    notify() {
      for (const listener of [...listeners]) {
        listener();
      }
    },
  };
}

/** Load one package and capture the host context the sandbox factory receives. */
async function enableContext(capabilities, id) {
  const runtime = new ExtensionRuntime({
    preferenceStore: new PreferenceStore(),
    hostVersion: "1.0.0",
  });
  let context = null;
  runtime.setSandboxFactory((input) => {
    context = input.context;
    return { start: async () => {}, dispose: () => {} };
  });
  const loaded = runtime.loadManifest(
    {
      kind: "extension",
      id,
      name: id,
      version: "1.0.0",
      engines: { "rpe-redux": 1 },
      entry: "index.js",
      capabilities,
    },
    async () => ({ source: "export default { activate() {} };" }),
  );
  assert.equal(loaded.ok, true, JSON.stringify(loaded));
  const enabled = await runtime.enableAsync(id, true);
  assert.equal(enabled.ok, true, JSON.stringify(enabled));
  assert.ok(context, "sandbox factory did not receive a host context");
  return { runtime, context };
}

test("theme.tokens publishes the official token shape as JSON scalars", () => {
  const tokens = themeSnapshot();
  assert.deepEqual(tokens.theme, {
    id: "dark",
    name: "Dark",
    appearance: "dark",
  });
  assert.equal(tokens.colors.foreground, "#f0f0f0");
  assert.equal(tokens.colors.success, "#5ee08a");
  assert.equal(tokens.radii.panel, "8px");
  assert.equal(tokens.spacing["2"], "8px");
  assert.equal(tokens.fonts.family, "Saira, sans-serif");
  assert.equal(tokens.fonts.sizes.body, "14px");
  assert.equal(tokens.shadows.panel, "0 20px 64px #000");
  assert.equal(tokens.motion.durations.tint, "140ms");
  assert.equal(tokens.motion.easings.enter, "cubic-bezier(0.16, 1, 0.3, 1)");
  assertJsonScalars(tokens);
});

test("theme.subscribe follows host changes and stops after package disposal", async () => {
  const id = `test.design.theme.${Date.now()}`;
  const host = createThemeHost();
  const { runtime, context } = await enableContext(["styles"], id);
  try {
    assert.equal(context.api.theme.tokens().theme.id, "dark");
    let calls = 0;
    const returned = context.api.theme.subscribe(() => {
      calls += 1;
    });
    assert.equal(returned, undefined, "the package must not receive a cancellation hook");
    assert.equal(host.listeners.size, 1);
    host.notify();
    assert.equal(calls, 1);

    assert.equal(runtime.disable(id).ok, true);
    assert.equal(host.listeners.size, 0);
    host.notify();
    assert.equal(calls, 1, "a disposed activation must not keep receiving theme changes");
  } finally {
    if (runtime.list().some((entry) => entry.manifest.id === id)) {
      runtime.uninstall(id);
    }
    host.disconnect();
  }
});

test("sidebar.open and close stay inside the calling package's registrations", () => {
  const calls = [];
  const disconnect = connectSidebarNavigationHost({
    open(id) {
      calls.push(["open", id]);
      return true;
    },
    close(id) {
      calls.push(["close", id]);
      return true;
    },
  });
  const first = gateExtensionApi(fakeApi(), new Set(["ui.sidebar"]), "owner-a");
  const second = gateExtensionApi(fakeApi(), new Set(["ui.sidebar"]), "owner-b");
  const dispose = first.sidebar.register({
    id: "shared",
    order: 10,
    panelId: "panel",
    icon: { name: "help", label: "Shared" },
    onActivate() {},
  });
  const hostEntry = registerSidebarItem(
    {
      id: "extension:owner-a:host",
      order: 20,
      panelId: "host-panel",
      icon: { name: "help", label: "Host" },
      onActivate() {},
    },
    "owner-a",
  );
  try {
    assert.equal(first.sidebar.open("shared"), true);
    assert.equal(first.sidebar.close("shared"), true);
    assert.deepEqual(calls, [
      ["open", "extension.owner-a.shared"],
      ["close", "extension.owner-a.shared"],
    ]);

    // A bare local id may name a host UI route registered as extension:<owner>:<id>.
    assert.equal(first.sidebar.open("host"), true);
    assert.deepEqual(calls.at(-1), ["open", "extension:owner-a:host"]);

    assert.throws(
      () => second.sidebar.open("extension.owner-a.shared"),
      (error) => error.code === "capabilityDenied",
    );
    assert.throws(
      () => second.sidebar.close("extension.owner-a.shared"),
      (error) => error.code === "capabilityDenied",
    );
    assert.throws(
      () => second.sidebar.open("host"),
      (error) => error.code === "capabilityDenied",
    );
    assert.equal(calls.length, 3, "a refused owner must not reach the shell");
  } finally {
    dispose();
    hostEntry();
    disconnect();
  }
  assert.equal(getSidebarEntry("extension.owner-a.shared"), undefined);
  assert.equal(getSidebarEntry("extension:owner-a:host"), undefined);
});

test("storage JSON helpers round-trip and reject bad or oversized values", async () => {
  const id = `test.design.storage.${Date.now()}`;
  const { runtime, context } = await enableContext(["storage"], id);
  try {
    context.storage.setJSON("state", { count: 1, ok: true, nested: ["a"] });
    assert.deepEqual(context.storage.getJSON("state"), {
      count: 1,
      ok: true,
      nested: ["a"],
    });
    assert.equal(context.storage.get("state"), '{"count":1,"ok":true,"nested":["a"]}');
    assert.equal(context.storage.getJSON("missing"), null);

    context.storage.set("broken", "{not json");
    assert.equal(context.storage.getJSON("broken"), null);

    assert.throws(
      () => context.storage.setJSON("function", () => {}),
      (error) => error.code === "storageValueNotJson",
    );
    assert.throws(
      () => context.storage.setJSON("oversized", "x".repeat(256_001)),
      (error) => error.code === "storageValueTooLarge",
    );
    assert.equal(context.storage.getJSON("oversized"), null);
  } finally {
    if (runtime.list().some((entry) => entry.manifest.id === id)) {
      runtime.uninstall(id);
    }
  }
});

test("the method registry contains the design kit and still rejects unknown paths", () => {
  assert.equal(lookupMethod("theme", "tokens")?.capability, "styles");
  assert.equal(lookupMethod("theme", "subscribe")?.capability, "styles");
  assert.equal(lookupMethod("sidebar", "open")?.capability, "ui.sidebar");
  assert.equal(lookupMethod("sidebar", "close")?.capability, "ui.sidebar");
  assert.equal(lookupMethod("", "storage.getJSON")?.capability, "storage");
  assert.equal(lookupMethod("", "storage.setJSON")?.capability, "storage");

  assert.throws(
    () => assertRegistryComplete({ theme: { tokens() {}, subscribe() {}, probe() {} } }),
    (error) => {
      assert.ok(error instanceof ExtensionMethodRegistrationError);
      assert.equal(error.code, "methodNotRegistered");
      assert.equal(error.path, "theme.probe");
      return true;
    },
  );
});
