/** A failed first library save must clean up the project it created. */
import assert from "node:assert/strict";
import test from "node:test";
import { saveLibraryDocument } from "../../../core/global/library/save.ts";

/** Minimal library double for the create-then-fail path. */
function library({ fail }) {
  const removed = [];
  return {
    removed,
    createRaw: async () => ({ project: { id: "partial", revision: 1 } }),
    duplicate: async () => ({ project: { id: "copy", revision: 1 } }),
    stageAsset: async (projectId, name, bytes) => ({
      asset: { name, hash: "a".repeat(64), size: bytes.byteLength },
    }),
    commit: async () => {
      if (fail) {
        throw new Error("disk full");
      }
      return { project: { id: "partial", name: "copy", revision: 2 } };
    },
    remove: async (id) => {
      removed.push(id);
      return { deleted: true };
    },
  };
}

test("a failed first save removes the partial library project", async () => {
  const fake = library({ fail: true });
  await assert.rejects(
    () =>
      saveLibraryDocument({
        library: fake,
        chart: {},
        chartJson: "{}",
        name: "room copy",
        assets: new Map(),
      }),
    /disk full/,
  );
  assert.deepEqual(fake.removed, ["partial"]);
});

test("a completed save keeps the created project", async () => {
  const fake = library({ fail: false });
  const saved = await saveLibraryDocument({
    library: fake,
    chart: {},
    chartJson: "{}",
    name: "room copy",
    assets: new Map(),
  });
  assert.equal(saved.projectId, "partial");
  assert.equal(saved.created, true);
  assert.deepEqual(fake.removed, []);
});
