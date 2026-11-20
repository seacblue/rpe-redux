/** The right-click menu registry, its facade, and its capability gate stay stable. */
import assert from "node:assert/strict";
import test from "node:test";
import { contextMenu } from "../../../core/api/contextMenu.ts";
import { toolbar as toolbarApi } from "../../../core/api/toolbar.ts";
import { markerTargetFromMarker } from "../../../core/edit/timeline/contextMenuTarget.ts";
import { gateExtensionApi } from "../../../core/extensions/capabilityGate.ts";
import { Contributions } from "../../../core/state/contributions.ts";
import { progressMenuSurfaces } from "../../../frontend/chrome/transport/chartProgressState.ts";

/** A facade-shaped object with only the handles the gate reads at build time. */
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
    toolbar: toolbarApi,
    sidebar: {},
    contextMenu,
    values: { byId: {} },
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

test("the registry orders rows and keeps every declared surface", () => {
  const disposeLater = contextMenu.register({
    id: "test.context.later",
    order: 20,
    contexts: ["notes"],
    label: "Later",
    run() {},
  });
  const disposeFirst = contextMenu.register({
    id: "test.context.first",
    order: 10,
    contexts: ["events", "progress"],
    label: "First",
    run() {},
  });
  try {
    assert.deepEqual(
      contextMenu.get().map((entry) => entry.id),
      ["test.context.first", "test.context.later"],
    );
    const notes = contextMenu
      .get()
      .filter((entry) => entry.contexts.includes("notes"))
      .map((entry) => entry.id);
    assert.deepEqual(notes, ["test.context.later"]);
    const progress = contextMenu
      .get()
      .filter((entry) => entry.contexts.includes("progress"))
      .map((entry) => entry.id);
    assert.deepEqual(progress, ["test.context.first"]);
  } finally {
    disposeLater();
    disposeFirst();
  }
});

test("a progress-only row stays off the timeline surfaces", () => {
  const dispose = contextMenu.register({
    id: "test.context.progress-only",
    order: 1,
    contexts: ["progress"],
    label: "Manage markers",
    icon: "clock",
    run() {},
  });
  try {
    const progress = contextMenu
      .get()
      .filter((entry) => entry.contexts.includes("progress"))
      .map((entry) => entry.id);
    assert.deepEqual(progress, ["test.context.progress-only"]);
    const timeline = contextMenu
      .get()
      .filter((entry) => entry.contexts.some((context) => context !== "progress"))
      .map((entry) => entry.id);
    assert.equal(timeline.includes("test.context.progress-only"), false);
  } finally {
    dispose();
  }
});

test("a marker-targeted progress menu draws marker rows beside progress rows", () => {
  const dispose = contextMenu.register({
    id: "test.context.marker-only",
    order: 1,
    contexts: ["marker"],
    label: "Marker action",
    run() {},
  });
  try {
    const markerSurfaces = progressMenuSurfaces(
      markerTargetFromMarker({ id: "marker-drop", beat: 4, name: "Drop" }),
    );
    assert.deepEqual(markerSurfaces, ["marker", "progress"]);
    const markerRows = contextMenu
      .get()
      .filter((entry) => entry.contexts.some((context) => markerSurfaces.includes(context)))
      .map((entry) => entry.id);
    assert.deepEqual(markerRows, ["test.context.marker-only"]);

    // Without a marker target the card stays progress-only, so a marker row has
    // no host there.
    const progressSurfaces = progressMenuSurfaces(undefined);
    assert.deepEqual(progressSurfaces, ["progress"]);
    assert.equal(
      contextMenu
        .get()
        .some((entry) => entry.contexts.some((context) => progressSurfaces.includes(context))),
      false,
    );
  } finally {
    dispose();
  }
});

test("register rejects a duplicate id", () => {
  const dispose = contextMenu.register({
    id: "test.context.duplicate",
    order: 1,
    contexts: ["notes"],
    label: "Once",
    run() {},
  });
  try {
    assert.throws(
      () =>
        contextMenu.register({
          id: "test.context.duplicate",
          order: 2,
          contexts: ["events"],
          label: "Twice",
          run() {},
        }),
      /already registered/,
    );
  } finally {
    dispose();
  }
});

test("update replaces the payload and keeps the original owner", () => {
  const registry = new Contributions();
  registry.register({ id: "test.update", order: 1, label: "before" }, "owner-a");
  let notifications = 0;
  const unsubscribe = registry.subscribe(() => {
    notifications += 1;
  });
  try {
    assert.equal(registry.update({ id: "test.update", order: 1, label: "after" }), true);
    assert.equal(registry.node("test.update")?.label, "after");
    assert.equal(notifications, 1);
    // An unknown id is a miss, not a new registration.
    assert.equal(registry.update({ id: "test.missing", order: 1, label: "none" }), false);
    assert.equal(notifications, 1);
    assert.equal(registry.node("test.missing"), undefined);
  } finally {
    unsubscribe();
  }
  registry.unregisterOwner("owner-a");
  assert.equal(registry.node("test.update"), undefined);
});

test("unregister removes one row and notifies subscribers once", () => {
  const dispose = contextMenu.register({
    id: "test.context.unregister",
    order: 1,
    contexts: ["notes"],
    label: "Remove",
    run() {},
  });
  let notifications = 0;
  const unsubscribe = contextMenu.subscribe(() => {
    notifications += 1;
  });
  try {
    assert.equal(contextMenu.unregister("test.context.unregister"), true);
    assert.equal(notifications, 1);
    assert.equal(contextMenu.entry("test.context.unregister"), undefined);
    assert.equal(contextMenu.unregister("test.context.unregister"), false);
    assert.equal(notifications, 1);
  } finally {
    unsubscribe();
    dispose();
  }
});

test("registerAll removes the whole batch with one disposer", () => {
  const dispose = contextMenu.registerAll([
    {
      id: "test.context.batch-a",
      order: 1,
      contexts: ["notes"],
      label: "A",
      run() {},
    },
    {
      id: "test.context.batch-b",
      order: 2,
      contexts: ["events"],
      label: "B",
      run() {},
    },
  ]);
  try {
    assert.equal(contextMenu.entry("test.context.batch-a") !== undefined, true);
    assert.equal(contextMenu.entry("test.context.batch-b") !== undefined, true);
  } finally {
    dispose();
  }
  assert.equal(contextMenu.entry("test.context.batch-a"), undefined);
  assert.equal(contextMenu.entry("test.context.batch-b"), undefined);
});

test("the facade is frozen and exposes the CRUD surface", () => {
  assert.equal(Object.isFrozen(contextMenu), true);
  for (const name of [
    "register",
    "registerAll",
    "update",
    "unregister",
    "get",
    "entry",
    "subscribe",
  ]) {
    assert.equal(typeof contextMenu[name], "function", name);
  }
});

test("the gated handle namespaces ids, strips shortcutId, and updates owned rows", () => {
  const gated = gateExtensionApi(fakeApi(), new Set(["ui.contextMenu"]), "test-owner");
  const dispose = gated.contextMenu.register({
    id: "trim",
    order: 10,
    contexts: ["notes"],
    label: "Trim",
    shortcut: "Ctrl+T",
    shortcutId: "editor.play",
    run() {},
  });
  try {
    const id = "extension.test-owner.trim";
    assert.deepEqual(
      gated.contextMenu.get().map((entry) => entry.id),
      [id],
    );
    assert.equal(gated.contextMenu.entry(id)?.shortcut, "Ctrl+T");
    assert.equal(gated.contextMenu.entry(id)?.shortcutId, undefined);
    assert.equal(gated.contextMenu.entry("trim")?.label, "Trim");
    assert.equal(contextMenu.entry(id) !== undefined, true);

    assert.equal(
      gated.contextMenu.update({
        id,
        order: 20,
        contexts: ["events"],
        label: "Trim events",
        run() {},
      }),
      true,
    );
    assert.equal(gated.contextMenu.entry(id)?.label, "Trim events");
    assert.deepEqual(gated.contextMenu.entry(id)?.contexts, ["events"]);

    // The local id a package registered also resolves to its owned row.
    assert.equal(
      gated.contextMenu.update({
        id: "trim",
        order: 30,
        contexts: ["notes"],
        label: "Trim local",
        run() {},
      }),
      true,
    );
    assert.equal(gated.contextMenu.entry(id)?.label, "Trim local");
    assert.equal(gated.contextMenu.unregister("trim"), true);
    assert.equal(gated.contextMenu.entry(id), undefined);
  } finally {
    dispose();
  }
  assert.equal(contextMenu.entry("extension.test-owner.trim"), undefined);
});

test("the gated registerAll keeps every row owner-scoped", () => {
  const gated = gateExtensionApi(fakeApi(), new Set(["ui.contextMenu"]), "batch-owner");
  const dispose = gated.contextMenu.registerAll([
    {
      id: "one",
      order: 1,
      contexts: ["notes"],
      label: "One",
      shortcutId: "edit.copy",
      run() {},
    },
    {
      id: "two",
      order: 2,
      contexts: ["events"],
      label: "Two",
      run() {},
    },
  ]);
  try {
    assert.deepEqual(
      gated.contextMenu.get().map((entry) => entry.id),
      ["extension.batch-owner.one", "extension.batch-owner.two"],
    );
    assert.equal(gated.contextMenu.entry("one")?.shortcutId, undefined);
    assert.equal(gated.contextMenu.entry("two")?.label, "Two");
  } finally {
    dispose();
  }
  assert.equal(contextMenu.entry("extension.batch-owner.one"), undefined);
  assert.equal(contextMenu.entry("extension.batch-owner.two"), undefined);
});

test("one owner cannot read, update, or remove another owner's row", () => {
  const first = gateExtensionApi(fakeApi(), new Set(["ui.contextMenu"]), "owner-a");
  const second = gateExtensionApi(fakeApi(), new Set(["ui.contextMenu"]), "owner-b");
  const disposeFirst = first.contextMenu.register({
    id: "row",
    order: 1,
    contexts: ["notes"],
    label: "First",
    run() {},
  });
  const disposeSecond = second.contextMenu.register({
    id: "row",
    order: 1,
    contexts: ["notes"],
    label: "Second",
    run() {},
  });
  try {
    assert.deepEqual(
      first.contextMenu.get().map((entry) => entry.id),
      ["extension.owner-a.row"],
    );
    assert.equal(first.contextMenu.entry("extension.owner-b.row"), undefined);
    assert.throws(
      () =>
        first.contextMenu.update({
          id: "extension.owner-b.row",
          order: 2,
          contexts: ["events"],
          label: "Taken over",
          run() {},
        }),
      /ui\.contextMenu/,
    );
    assert.throws(() => first.contextMenu.unregister("extension.owner-b.row"), /ui\.contextMenu/);
  } finally {
    disposeFirst();
    disposeSecond();
  }
});

test("the context menu handle is denied without ui.contextMenu", () => {
  const denied = gateExtensionApi(fakeApi(), new Set(), "owner-a");
  assert.throws(
    () => denied.contextMenu,
    (error) => error.capability === "ui.contextMenu",
  );
});
