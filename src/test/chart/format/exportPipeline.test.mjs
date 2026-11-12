/** Export conversion adapters keep target writers independent from the authoring model. */
import assert from "node:assert/strict";
import test from "node:test";
import { createChart } from "../../../core/global/chart/chart.ts";
import {
  createExportArtifact,
  inspectExport,
} from "../../../core/global/document/exportPipeline.ts";

const chart = createChart();
const adapter = {
  convert() {
    return {
      chart,
      warnings: [{ code: "future-model.sample-loss", message: "Sample data was reduced." }],
    };
  },
};

test("the conversion seam carries warnings into a PEZ artifact", async () => {
  const result = createExportArtifact(
    {
      model: { kind: "future-authoring-model" },
      assets: new Map(),
      chartName: "Adapter Test",
      name: "Adapter Test",
      format: "pez",
    },
    adapter,
  );

  assert.equal(result.kind, "binary");
  assert.deepEqual(result.warnings, [
    { code: "future-model.sample-loss", message: "Sample data was reduced." },
  ]);
  assert.equal(
    String.fromCharCode(...new Uint8Array(await result.blob.slice(0, 2).arrayBuffer())),
    "PK",
  );
});

test("inspection reports conversion warnings before a text writer runs", () => {
  assert.deepEqual(
    inspectExport(
      { model: { kind: "future-authoring-model" }, chartName: "Adapter Test", format: "official" },
      adapter,
    ),
    [{ code: "future-model.sample-loss", message: "Sample data was reduced." }],
  );
});
