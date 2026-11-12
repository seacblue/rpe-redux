/** Verifies the S-level capability contract: owner filtering, payload projection, and telemetry. */
import assert from "node:assert/strict";
import test from "node:test";
import { contextMenu } from "../../../core/api/contextMenu.ts";
import { toolbar as toolbarApi } from "../../../core/api/toolbar.ts";
import { values as valuesApi } from "../../../core/api/values.ts";
import {
  extensionCapabilityUsage,
  logExtensionCapabilityDenial,
  resetExtensionCapabilityUsage,
} from "../../../core/extensions/extensionApi.ts";
import {
  gateExtensionApi,
  projectContextMenuTarget,
  projectExtensionEventPayload,
} from "../../../core/extensions/capabilityGate.ts";
import { lookupMethod } from "../../../core/extensions/methodRegistry.ts";
import {
  grantScriptDefaultShortcuts,
  materializeManifest,
  validateManifest,
} from "../../../core/extensions/extensionRuntimeSupport.ts";
import { values as valueRegistry } from "../../../core/state/values.ts";

/** A facade-shaped object with only the handles the gate reads at build time. */
function fakeApi(overrides = {}) {
  return {
    version: "test",
    chart: { state: () => ({ ok: true, value: {} }) },
    transaction: {},
    selection: {},
    document: {},
    library: {},
    playback: {},
    settings: {},
    toolbar: {},
    sidebar: {},
    contextMenu,
    values: valuesApi,
    shortcuts: {},
    diagnostics: {},
    hitTest: {},
    preview: {},
    layout: {},
    workspace: {},
    help: {},
    extensions: {},
    ...overrides,
  };
}

/** Capture console warnings without leaving the global patched. */
function captureWarnings(fn) {
  const warnings = [];
  const original = console.warn;
  console.warn = (...args) => {
    warnings.push(args);
  };
  try {
    fn();
  } finally {
    console.warn = original;
  }
  return warnings;
}

test("the async Extension hit-test bridge uses hitTest.read without editor state writes", async () => {
  assert.equal(lookupMethod("hitTest", "queryAt")?.capability, "hitTest.read");
  const state = {
    selection: ["note-1"],
    focus: "timeline",
    playbackHead: 2,
    scroll: { top: 10 },
    viewport: { scale: 1 },
    history: { undo: 0, redo: 0 },
  };
  const snapshot = structuredClone(state);
  const temporal = {
    chartFingerprint: "chart-a",
    generation: 3,
    totalHits: 1,
    truncated: false,
    ordering: "lineIndex,notes,judgeLine,eventTrack,eventIndex",
    hits: [],
  };
  const api = gateExtensionApi(
    fakeApi({
      hitTest: {
        availability: () => ({ status: "available" }),
        pick: () => ({ ok: true, value: [] }),
        queryAt: () => ({ ok: true, value: temporal }),
        geometry: () => ({ ok: false, error: { code: "unavailable", message: "none" } }),
      },
    }),
    new Set(["hitTest.read"]),
    "hit-test-bridge",
  );

  const result = await Promise.resolve().then(() =>
    api.hitTest.queryAt({ surface: "preview", time: { seconds: 1 }, include: ["note"] }),
  );
  assert.deepEqual(result, { ok: true, value: temporal });
  assert.deepEqual(state, snapshot);
  assert.throws(
    () => api.hitTest.pick({}),
    (error) => error?.code === "capabilityDenied" && error.capability === "preview.read",
  );

  const denied = gateExtensionApi(fakeApi(), new Set(), "hit-test-denied");
  assert.throws(
    () => denied.hitTest,
    (error) => error?.code === "capabilityDenied" && error.capability === "hitTest.read",
  );
});

test("values enumeration stays inside the owner boundary", () => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const first = gateExtensionApi(fakeApi(), new Set(["values"]), `owner-a-${suffix}`);
  const second = gateExtensionApi(fakeApi(), new Set(["values"]), `owner-b-${suffix}`);
  const ownFirst = first.values.define({ id: "counter", initial: 0 });
  const ownSecond = second.values.define({ id: "counter", initial: 0 });
  const host = valuesApi.define({ id: `host.${suffix}`, initial: 0 });
  try {
    ownFirst.set(1);
    ownSecond.set(2);
    host.set(3);
    assert.deepEqual(first.values.byId.snapshot(), { [ownFirst.id]: 1 });
    assert.deepEqual(second.values.byId.snapshot(), { [ownSecond.id]: 2 });

    let firstUpdates = 0;
    let secondUpdates = 0;
    const stopFirst = first.values.byId.subscribeAll(() => {
      firstUpdates += 1;
    });
    const stopSecond = second.values.byId.subscribeAll(() => {
      secondUpdates += 1;
    });
    try {
      ownSecond.set(4);
      assert.equal(firstUpdates, 0, "another package's value notified this owner");
      assert.equal(secondUpdates, 1);
      host.set(5);
      assert.equal(firstUpdates, 0, "a host value notified this owner");
      assert.equal(secondUpdates, 1, "a host value notified this owner");
      ownFirst.set(6);
      assert.equal(firstUpdates, 1);
      assert.equal(secondUpdates, 1);
    } finally {
      stopFirst();
      stopSecond();
    }
  } finally {
    valueRegistry.undefine(ownFirst.id);
    valueRegistry.undefine(ownSecond.id);
    valueRegistry.undefine(host.id);
  }
});

test("toolbar shortcut helpers only read owned entries unless shortcuts.read is granted", () => {
  const hostBindings = [{ ctrl: true, key: "s" }];
  const toolbar = {
    get: () => [],
    entry: () => undefined,
    register: () => () => {},
    unregister: () => true,
    bindings: () => hostBindings,
    shortcutText: () => "Ctrl+S",
  };
  const own = gateExtensionApi(fakeApi({ toolbar }), new Set(["ui.toolbar"]), "toolbar-owner");
  assert.deepEqual(own.toolbar.bindings({ id: "extension.toolbar-owner.action" }), hostBindings);
  assert.equal(own.toolbar.shortcutText({ id: "extension.toolbar-owner.action" }), "Ctrl+S");
  assert.deepEqual(own.toolbar.bindings({ id: "document.save" }), []);
  assert.equal(own.toolbar.shortcutText({ id: "document.save" }), "");
  assert.deepEqual(own.toolbar.bindings({ id: "extension.other.action" }), []);
  assert.deepEqual(
    own.toolbar.bindings({
      id: "extension.toolbar-owner.action",
      shortcutId: "document.save",
    }),
    [],
    "an owned id must not borrow a host binding without shortcuts.read",
  );

  const reader = gateExtensionApi(
    fakeApi({ toolbar }),
    new Set(["ui.toolbar", "shortcuts.read"]),
    "toolbar-reader",
  );
  assert.deepEqual(reader.toolbar.bindings({ id: "document.save" }), hostBindings);
  assert.equal(reader.toolbar.shortcutText({ id: "document.save" }), "Ctrl+S");
  assert.deepEqual(
    reader.toolbar.bindings({ id: "extension.other.action" }),
    [],
    "another package's binding is never readable",
  );
  assert.ok(
    (extensionCapabilityUsage("toolbar-reader")["toolbar-reader"]?.observed["shortcuts.read"] ??
      0) >= 1,
  );
});

test("context-menu and toolbar runners receive a capability-projected target", () => {
  const notesTarget = {
    surface: "notes",
    noteIds: ["note-a"],
    lineIndex: 2,
    beat: 3,
    chartSeconds: 4,
  };
  const eventsTarget = {
    surface: "events",
    refs: [{ lineIndex: 2, eventType: "moveX", layer: 0, index: 1 }],
    beat: 5,
    chartSeconds: 6,
  };
  assert.deepEqual(projectContextMenuTarget(notesTarget, new Set()), { surface: "notes" });
  assert.deepEqual(projectContextMenuTarget(notesTarget, new Set(["selection.read"])), {
    surface: "notes",
    noteIds: ["note-a"],
  });
  assert.deepEqual(projectContextMenuTarget(notesTarget, new Set(["chart.read"])), {
    surface: "notes",
    lineIndex: 2,
    beat: 3,
    chartSeconds: 4,
  });
  assert.deepEqual(
    projectContextMenuTarget(notesTarget, new Set(["chart.read", "selection.read"])),
    notesTarget,
  );
  assert.deepEqual(projectContextMenuTarget(eventsTarget, new Set()), { surface: "events" });
  assert.deepEqual(projectContextMenuTarget(eventsTarget, new Set(["selection.read"])), {
    surface: "events",
    refs: eventsTarget.refs,
  });
  assert.deepEqual(
    projectContextMenuTarget({ surface: "marker", markerId: "m", beat: 7 }, new Set()),
    {
      surface: "marker",
      markerId: "m",
    },
  );

  const menuTargets = [];
  const menu = gateExtensionApi(fakeApi(), new Set(["ui.contextMenu"]), "menu-owner");
  const disposeMenu = menu.contextMenu.register({
    id: "row",
    order: 1,
    contexts: ["notes"],
    label: "Row",
    run: (target) => menuTargets.push(target),
  });
  const toolbarTargets = [];
  const bar = gateExtensionApi(fakeApi(), new Set(["ui.toolbar", "chart.read"]), "bar-owner");
  const disposeBar = bar.toolbar.register({
    kind: "action",
    id: "action",
    order: 1,
    group: "test",
    label: "Action",
    tooltip: "Action",
    icon: "info",
    contexts: ["notes"],
    run: (target) => toolbarTargets.push(target),
  });
  try {
    contextMenu.entry("extension.menu-owner.row").run(notesTarget);
    toolbarApi.entry("extension.bar-owner.action").run(notesTarget);
    assert.deepEqual(menuTargets, [{ surface: "notes" }]);
    assert.deepEqual(toolbarTargets, [
      { surface: "notes", lineIndex: 2, beat: 3, chartSeconds: 4 },
    ]);
  } finally {
    disposeMenu();
    disposeBar();
  }
});

test("event payloads carry chart and selection data only with the matching grant", () => {
  const chart = { judgeLineList: [] };
  const documentPayload = { name: "demo", path: "demo.json", chart };
  assert.deepEqual(
    projectExtensionEventPayload("document:opened", documentPayload, new Set(["events"])),
    { name: "demo", path: "demo.json", chart: null },
  );
  assert.equal(
    projectExtensionEventPayload(
      "document:opened",
      documentPayload,
      new Set(["events", "chart.read"]),
    ).chart,
    chart,
  );

  const pastePayload = {
    request: { beat: 1, lineIndex: 2 },
    result: {
      changed: true,
      count: 2,
      beforeFingerprint: "before",
      afterFingerprint: "after",
      selection: { lineIndex: 2, notes: [], events: [] },
    },
  };
  assert.deepEqual(
    projectExtensionEventPayload("selection:after-paste", pastePayload, new Set(["events"])),
    { result: { changed: true, count: 2 } },
  );
  assert.deepEqual(
    projectExtensionEventPayload(
      "selection:after-paste",
      pastePayload,
      new Set(["events", "selection.read"]),
    ),
    {
      request: pastePayload.request,
      result: {
        changed: true,
        count: 2,
        selection: pastePayload.result.selection,
      },
    },
  );
  assert.deepEqual(
    projectExtensionEventPayload(
      "selection:after-paste",
      pastePayload,
      new Set(["events", "chart.read"]),
    ),
    {
      request: pastePayload.request,
      result: { changed: true, count: 2, beforeFingerprint: "before", afterFingerprint: "after" },
    },
  );
  assert.deepEqual(
    projectExtensionEventPayload(
      "custom:event",
      { chart, selection: { notes: [] }, label: "ok" },
      new Set(["events"]),
    ),
    { chart: null, label: "ok" },
  );
});

test("script default shortcuts require the shortcuts capability", () => {
  const shortcut = { ctrl: true, key: "F5" };
  const warnings = captureWarnings(() => {
    assert.equal(
      grantScriptDefaultShortcuts("owner", "run", [shortcut], new Set(["scripts"])),
      undefined,
    );
  });
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0][1].extension, "owner");
  assert.equal(warnings[0][1].capability, "shortcuts");
  assert.deepEqual(
    grantScriptDefaultShortcuts("owner", "run", [shortcut], new Set(["scripts", "shortcuts"])),
    [shortcut],
  );
});

test("data-only packages gain the implicit scripts grant with a deprecation warning", () => {
  const manifest = {
    kind: "data-only",
    id: "test.implicit-scripts",
    name: "Implicit scripts",
    version: "1.0.0",
    engines: { "rpe-redux": 1 },
    scripts: [{ id: "run", steps: [{ op: "notice", message: "hello" }] }],
  };
  let materialized;
  const warnings = captureWarnings(() => {
    materialized = materializeManifest(manifest, undefined);
  });
  assert.deepEqual(materialized.capabilities, ["scripts"]);
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0][1].capability, "scripts");
  assert.equal(validateManifest(materialized, 1), null);

  const code = materializeManifest(
    {
      ...manifest,
      id: "test.implicit-code",
      kind: "script",
      entry: "index.js",
      scripts: undefined,
    },
    undefined,
  );
  assert.equal(code.capabilities, undefined);
});

test("host.patch stays loadable but is reported as a deprecated no-op grant", () => {
  const manifest = {
    kind: "extension",
    id: "test.host-patch-deprecated",
    name: "Host patch",
    version: "1.0.0",
    engines: { "rpe-redux": 1 },
    entry: "index.js",
    capabilities: ["host.patch"],
  };
  let materialized;
  const warnings = captureWarnings(() => {
    materialized = materializeManifest(manifest, undefined);
  });
  assert.deepEqual(materialized.capabilities, []);
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0][0], "[redux.extensions] host.patch is deprecated and grants no handle");
  assert.equal(warnings[0][1].capability, "host.patch");
});

test("manifest kind must match the package shape and unknown kinds are rejected", () => {
  const base = {
    id: "test.kind",
    name: "Kind",
    version: "1.0.0",
    engines: { "rpe-redux": 1 },
  };
  const dataOnly = {
    ...base,
    kind: "data-only",
    scripts: [{ id: "run", steps: [{ op: "notice", message: "hello" }] }],
  };
  assert.equal(validateManifest(dataOnly, 1), null);
  assert.equal(validateManifest({ ...dataOnly, entry: "index.js" }, 1)?.code, "kindMismatch");
  assert.equal(validateManifest({ ...base, kind: "script" }, 1)?.code, "kindMismatch");
  assert.equal(validateManifest({ ...base, kind: "script", entry: "index.js" }, 1), null);
  assert.equal(validateManifest({ ...base, kind: "bogus" }, 1)?.code, "invalidKind");
  assert.equal(validateManifest({ ...base, kind: "extension" }, 1), null);
});

test("the capability ledger counts uses and refusals per owner", () => {
  resetExtensionCapabilityUsage();
  try {
    const allowed = gateExtensionApi(fakeApi(), new Set(["chart.read"]), "usage-allowed");
    void allowed.chart.state();
    const allowedUsage = extensionCapabilityUsage("usage-allowed")["usage-allowed"];
    assert.deepEqual(allowedUsage.declared, ["chart.read"]);
    assert.ok((allowedUsage.observed["chart.read"] ?? 0) >= 1);

    const denied = gateExtensionApi(fakeApi(), new Set(), "usage-denied");
    assert.throws(
      () => denied.chart,
      (error) => error?.code === "capabilityDenied",
    );
    const deniedUsage = extensionCapabilityUsage("usage-denied")["usage-denied"];
    assert.equal(deniedUsage.denied["chart.read"], 1);
    assert.equal(deniedUsage.observed["chart.read"], undefined);
  } finally {
    resetExtensionCapabilityUsage();
  }
});

test("a refused api.call writes one structured host log", () => {
  resetExtensionCapabilityUsage();
  const warnings = captureWarnings(() => {
    logExtensionCapabilityDenial("log-owner", "chart.read", "chart.state");
    logExtensionCapabilityDenial("log-owner", "chart.read", "chart.state");
  });
  try {
    assert.equal(warnings.length, 1);
    assert.equal(warnings[0][0], "[redux.extensions] capability denied");
    assert.deepEqual(warnings[0][1], {
      extension: "log-owner",
      capability: "chart.read",
      action: "chart.state",
      code: "capabilityDenied",
    });
  } finally {
    resetExtensionCapabilityUsage();
  }
});
