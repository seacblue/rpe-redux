/**
 * A library import must survive a chart resource the host cannot read.
 *
 * RPE charts name UI bindings in `attachUI` and may keep stale references, so a
 * missing optional file must not turn the whole import into a failure.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { importChartToLibrary } from "../../../core/global/library/import.ts";

/** A library double that records staged asset names. */
function recordingLibrary(uploaded) {
  return {
    async createRaw() {
      return { project: { id: "project-1", revision: 1 } };
    },
    async stageAsset(_projectId, name, bytes) {
      uploaded.push(name);
      return { asset: { name, hash: "a".repeat(64), size: bytes.byteLength } };
    },
    async commit(id) {
      return { project: { id, revision: 2 } };
    },
  };
}

test("an unreadable chart resource does not abort the library import", async () => {
  const assets = new Map();
  assets.names = () => new Set(["combo", "song.ogg"]);
  assets.read = async (name) => {
    if (name === "song.ogg") {
      return new Uint8Array([1, 2, 3]);
    }
    throw new Error("The system cannot find the file specified. (os error 2)");
  };
  const uploaded = [];

  const result = await importChartToLibrary({
    library: recordingLibrary(uploaded),
    chart: { META: { song: "song.ogg" } },
    chartJson: '{"META":{"song":"song.ogg"}}',
    name: "Missing optional resource",
    assets,
  });

  assert.equal(result.projectId, "project-1");
  assert.deepEqual(uploaded, ["song.ogg"]);
});
