/**
 * Library project scopes: the transport binds one id and the capability gate
 * refuses asset writes aimed at any other project.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { library } from "../../../core/api/library.ts";
import { editorProjectId } from "../../../core/edit/state/publishedValues.ts";
import { gateExtensionApi } from "../../../core/extensions/capabilityGate.ts";
import { LocalLibrary } from "../../../core/global/library/client.ts";

/** A facade-shaped API whose library records every project-bound asset call. */
function fakeApi(calls) {
  const scope = (id) => ({
    id,
    get: async () => ({ ok: true, value: { project: { id, name: "Current" } } }),
    update: async () => ({ ok: true, value: { project: { id, name: "Current" } } }),
    remove: async () => ({ ok: true, value: { deleted: true } }),
    duplicate: async () => ({ ok: true, value: { project: { id, name: "Copy" } } }),
    assets: async () => ({ ok: true, value: { assets: [] } }),
    asset: async () => ({ ok: true, value: new Uint8Array([1]) }),
    addAsset: async (name) => {
      calls.push({ op: "addAsset", id, name });
      return {
        ok: true,
        value: { asset: { name, hash: "hash", size: 1 }, project: { id, name: "Current" } },
      };
    },
    removeAsset: async (name) => {
      calls.push({ op: "removeAsset", id, name });
      return { ok: true, value: { removed: true, project: { id, name: "Current" } } };
    },
    revisions: async () => ({ ok: true, value: { revisions: [] } }),
    createRevision: async () => ({ ok: true, value: { revision: { id: 1 } } }),
    revision: async (revisionId) => ({
      ok: true,
      value: { revision: { id: revisionId, projectId: id, label: "r", createdAt: "", size: 0 } },
    }),
    removeRevision: async () => ({ ok: true, value: { deleted: true } }),
  });
  return {
    version: "test",
    chart: {},
    transaction: {},
    selection: {},
    document: {},
    playback: {},
    settings: {},
    toolbar: {},
    sidebar: {},
    contextMenu: {},
    values: {},
    shortcuts: {},
    diagnostics: {},
    hitTest: {},
    preview: {},
    layout: {},
    workspace: {},
    help: {},
    extensions: {},
    library: {
      availability: () => ({ status: "available" }),
      scope,
    },
  };
}

test("the public current handle follows the open document's project", () => {
  const previous = editorProjectId.get();
  try {
    editorProjectId.set("project-a");
    assert.equal(library.current.id, "project-a");
    assert.equal(library.scope("project-b").id, "project-b");
  } finally {
    editorProjectId.set(previous);
  }
});

test("LocalLibrary.scope keeps every call on its captured project", async () => {
  const library = new LocalLibrary("http://127.0.0.1:47821");
  const calls = [];
  library.get = async (id) => {
    calls.push({ op: "get", id });
    return { project: { id } };
  };
  library.addAsset = async (id, name) => {
    calls.push({ op: "addAsset", id, name });
    return { asset: { name, hash: "hash", size: 1 }, project: { id } };
  };

  const project = library.scope("project-a");
  assert.equal(project.id, "project-a");
  await project.get();
  await project.addAsset("cover.png", new Uint8Array([1, 2]));

  assert.deepEqual(calls, [
    { op: "get", id: "project-a" },
    { op: "addAsset", id: "project-a", name: "cover.png" },
  ]);
  assert.throws(() => library.scope(" "), RangeError);
});

test("a gated library rejects asset writes to another project", () => {
  const calls = [];
  const gated = gateExtensionApi(
    fakeApi(calls),
    new Set(["library.read", "assets.write"]),
    "cell.test",
    {
      currentProjectId: () => "project-a",
    },
  );

  assert.throws(
    () => gated.library.scope("project-b"),
    (error) => error?.code === "capabilityDenied" && error?.capability === "library.read",
  );
  assert.equal("addAsset" in gated.library, false);
  assert.deepEqual(calls, []);
});

test("the current project stays writable through its scoped handle", async () => {
  const calls = [];
  let projectId = "project-a";
  const gated = gateExtensionApi(
    fakeApi(calls),
    new Set(["library.read", "assets.write"]),
    "cell.test",
    {
      currentProjectId: () => projectId,
    },
  );

  const current = gated.library.current;
  assert.equal(current.id, "project-a");
  const added = await current.addAsset("cover.png", new Uint8Array([1, 2]));
  assert.equal(added.ok, true);
  assert.equal(added.value.asset.name, "cover.png");

  const removed = await current.removeAsset("old.png");
  assert.equal(removed.ok, true);
  assert.deepEqual(calls, [
    { op: "addAsset", id: "project-a", name: "cover.png" },
    { op: "removeAsset", id: "project-a", name: "old.png" },
  ]);

  projectId = "project-b";
  assert.throws(
    () => current.addAsset("stale.png", new Uint8Array([3])),
    (error) => error?.code === "capabilityDenied" && error?.capability === "assets.write",
  );
  assert.deepEqual(calls, [
    { op: "addAsset", id: "project-a", name: "cover.png" },
    { op: "removeAsset", id: "project-a", name: "old.png" },
  ]);
});
