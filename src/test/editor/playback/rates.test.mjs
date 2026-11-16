/** Verify the playback-rate choices keep the normal speed at the top. */
import assert from "node:assert/strict";
import test from "node:test";
import { PLAYBACK_RATES } from "../../../core/edit/playback/rates.ts";

test("playback rates are ordered from realtime to slowest", () => {
  assert.deepEqual(PLAYBACK_RATES, ["1", "0.75", "0.5", "0.25"]);
});
