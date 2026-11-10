/** Automatic snapshot controls and their interval dependency. */
import assert from "node:assert/strict";
import test from "node:test";
import "../../../core/settings/features/index.ts";
import { settingsRegistry } from "../../../core/settings/settings.ts";

test("automatic snapshot controls register the toggle and the interval dependency", () => {
  const auto = settingsRegistry.definition("library-backup-auto");
  const interval = settingsRegistry.definition("library-backup-interval-seconds");
  assert.ok(auto, "automatic snapshot toggle is missing");
  assert.ok(interval, "snapshot interval is missing");
  assert.equal(auto.control, "toggle");
  assert.equal(auto.default, true);
  assert.equal(interval.control, "number");
  assert.equal(interval.default, 120);
  assert.equal(interval.min, 30);
  assert.equal(interval.max, 3600);
  assert.equal(interval.integer, true);
  assert.deepEqual(interval.enabledWhen, {
    key: "library-backup-auto",
    equals: true,
  });
});
