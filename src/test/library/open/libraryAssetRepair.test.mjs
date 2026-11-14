/** External imports must never be repaired by reopening their source as RPE JSON. */
import assert from "node:assert/strict";
import test from "node:test";
import { shouldRepairLibraryAssetsFromNativeRpe } from "../../../frontend/screens/welcome/libraryAssetRepair.ts";

test("repairs only native RPE chart sources", () => {
  assert.equal(
    shouldRepairLibraryAssetsFromNativeRpe({ kind: "chart", format: "rpe", valid: true }),
    true,
  );
  assert.equal(
    shouldRepairLibraryAssetsFromNativeRpe({ kind: "chart", format: "pec", valid: true }),
    false,
  );
  assert.equal(
    shouldRepairLibraryAssetsFromNativeRpe({
      kind: "chart",
      format: "pec",
      peInstallation: true,
      valid: true,
    }),
    false,
  );
  assert.equal(
    shouldRepairLibraryAssetsFromNativeRpe({ kind: "chart", format: "official", valid: true }),
    false,
  );
});
