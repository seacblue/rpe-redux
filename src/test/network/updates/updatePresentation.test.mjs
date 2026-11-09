/** Update presentation rules keep the badge and changelog footer aligned with the flow. */
import assert from "node:assert/strict";
import test from "node:test";
import {
  changelogUpdateAction,
  shouldShowUpdateBadge,
} from "../../../frontend/screens/settings/updates/updatePresentation.ts";

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

test("an active update locks the changelog footer and renames its primary action", () => {
  for (const phase of ["preparing", "verifying", "downloading", "installing"]) {
    assert.deepEqual(changelogUpdateAction(phase), {
      locked: true,
      labelKey: "chrome.changelog.updating",
    });
  }
  for (const phase of ["idle", "checking", "available", "downloaded", "scheduled", "error"]) {
    assert.deepEqual(changelogUpdateAction(phase), {
      locked: false,
      labelKey: "chrome.changelog.updateNow",
    });
  }
});
