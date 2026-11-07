/** Verify the default automatic update-download policy. */
import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_UPDATE_DOWNLOAD_POLICY } from "../../../core/settings/updateKeys.ts";

test("the default update download policy is Wi-Fi only", () => {
  assert.equal(DEFAULT_UPDATE_DOWNLOAD_POLICY, "wifi");
});
