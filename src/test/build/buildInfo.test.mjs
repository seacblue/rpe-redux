/** Verify the compact build metadata shown by the browser status bar. */
import assert from "node:assert/strict";
import test from "node:test";
import { formatBuildTime } from "../../core/platform/buildInfo.ts";

test("formats build timestamps as local digits without milliseconds", () => {
  const date = new Date("2026-11-24T03:04:05.678Z");
  const expected = [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
    String(date.getHours()).padStart(2, "0"),
    String(date.getMinutes()).padStart(2, "0"),
    String(date.getSeconds()).padStart(2, "0"),
  ].join("");
  assert.equal(formatBuildTime("2026-11-24T03:04:05.678Z"), expected);
});

test("keeps an invalid build timestamp visible for diagnostics", () => {
  assert.equal(formatBuildTime("unknown-build"), "unknown-build");
});
