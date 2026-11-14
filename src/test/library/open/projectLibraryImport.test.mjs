/** Welcome imports keep external charts on the conversion path. */
import assert from "node:assert/strict";
import test from "node:test";
import { ProjectHome } from "../../../frontend/screens/welcome/projectLibrary.ts";

function createHome(overrides = {}) {
  return new ProjectHome({
    openProject: async () => true,
    importFile: async () => "native-project",
    exportProject: async () => undefined,
    reportError: () => {},
    ...overrides,
  });
}

test("classified external charts are converted and never sent to native import", async () => {
  let nativeImports = 0;
  const home = createHome({
    importFile: async () => {
      nativeImports += 1;
      return "native-project";
    },
    classifyPaths: async () => [
      { path: "C:/chart.pec", kind: "chart", format: "pec", entry: "C:/chart.pec", valid: true },
    ],
    importExternalPath: async () => "converted-project",
  });
  try {
    assert.deepEqual(await home.importPaths(["C:/chart.pec"]), ["converted-project"]);
    assert.equal(nativeImports, 0);
  } finally {
    home.dispose();
  }
});

test("conversion failure does not fall through to the native RPE importer", async () => {
  let nativeImports = 0;
  const home = createHome({
    importFile: async () => {
      nativeImports += 1;
      return "native-project";
    },
    importRpePath: async () => null,
    importExternalPath: async () => null,
  });
  try {
    assert.deepEqual(await home.importPaths(["C:/chart.pec"]), []);
    assert.equal(nativeImports, 0);
  } finally {
    home.dispose();
  }
});
