/** Chart resource resolution keeps unreferenced asset-library audio out of metadata. */
import assert from "node:assert/strict";
import test from "node:test";
import { resourceReferences } from "../../../core/global/document/resources.ts";

test("an unreferenced audio asset is not inferred as the chart song", () => {
  const references = resourceReferences(
    { META: { song: "", background: "" } },
    new Map([["imported.mp3", new Uint8Array([1, 2, 3])]]),
    "chart.json",
  );

  assert.equal(references.song, "");
});
