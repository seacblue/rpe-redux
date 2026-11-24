/** Verify that browser hosts never enter the release update flow. */
import assert from "node:assert/strict";
import test from "node:test";
import {
  checkForUpdates,
  getUpdateState,
  initializeUpdates,
} from "../../../frontend/screens/settings/updates/updateStore.ts";
import { isReleaseDesktopBuild } from "../../../frontend/screens/settings/updates/updateAvailability.ts";

test("browser hosts disable update checks and initialization", async () => {
  assert.equal(await isReleaseDesktopBuild(), false);
  await initializeUpdates();
  await checkForUpdates();
  assert.equal(getUpdateState().phase, "idle");
  assert.equal(getUpdateState().available, false);
});
