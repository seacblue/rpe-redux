/** Update presentation rules keep the title-bar badge aligned with download state. */
import assert from "node:assert/strict";
import test from "node:test";
import { shouldShowUpdateBadge } from "../../../frontend/screens/settings/updates/updatePresentation.ts";

const release = { version: "1.0.6" };

test("the update badge hides after the package has been downloaded", () => {
  assert.equal(
    shouldShowUpdateBadge({ available: true, latest: release, phase: "available" }),
    true,
  );
  assert.equal(
    shouldShowUpdateBadge({ available: true, latest: release, phase: "downloaded" }),
    false,
  );
  assert.equal(
    shouldShowUpdateBadge({ available: true, latest: release, phase: "scheduled" }),
    false,
  );
  assert.equal(
    shouldShowUpdateBadge({ available: true, latest: release, phase: "installed" }),
    false,
  );
});

test("the update badge stays hidden without an available release", () => {
  assert.equal(
    shouldShowUpdateBadge({ available: false, latest: release, phase: "available" }),
    false,
  );
  assert.equal(shouldShowUpdateBadge({ available: true, latest: null, phase: "available" }), false);
});
