/** Checks required-asset planning and readiness for the room progress dialog. */
import assert from "node:assert/strict";
import test from "node:test";
import {
  assetProgressRatio,
  guestProgressReady,
  markAssetDone,
  markAssetError,
  markPresentAssetsDone,
  requiredRoomAssetRows,
  startRoomProgress,
  withAssetProgress,
} from "../../../core/collaboration/progress.ts";

const chart = {
  META: { song: "song.ogg", background: "cover.png", illustration: "artist credit" },
};
const manifest = [
  { name: "cover.png", hash: "b", size: 200, mime: "image/png" },
  { name: "song.ogg", hash: "a", size: 100, mime: "audio/ogg" },
];

test("required rows follow audio then background and ignore the illustration credit", () => {
  const rows = requiredRoomAssetRows(chart, manifest);
  assert.deepEqual(
    rows.map((row) => [row.name, row.kind, row.state, row.total]),
    [
      ["song.ogg", "audio", "pending", 100],
      ["cover.png", "background", "pending", 200],
    ],
  );
});

test("a chart name without a manifest entry does not create a stuck row", () => {
  assert.deepEqual(
    requiredRoomAssetRows(chart, [manifest[0]]).map((row) => row.name),
    ["cover.png"],
  );
});

test("transfer progress clamps bytes and releases a row on done", () => {
  const rows = requiredRoomAssetRows(chart, manifest);
  const downloading = withAssetProgress(rows, {
    name: "song.ogg",
    state: "progress",
    received: 250,
    total: 100,
  });
  assert.equal(downloading[0].state, "downloading");
  assert.equal(downloading[0].received, 100);
  assert.equal(assetProgressRatio(downloading[0]), 1);
  const done = withAssetProgress(downloading, {
    name: "song.ogg",
    state: "done",
    received: 100,
    total: 100,
  });
  assert.equal(done[0].state, "done");
  assert.equal(done[1].state, "pending");
});

test("present local bytes finish only the assets absent from the missing list", () => {
  const rows = requiredRoomAssetRows(chart, manifest);
  const next = markPresentAssetsDone(rows, ["cover.png"]);
  assert.deepEqual(
    next.map((row) => row.state),
    ["done", "downloading"],
  );
});

test("guest readiness waits for the chart and every required asset", () => {
  const base = startRoomProgress("guest");
  assert.equal(guestProgressReady(base), false);
  const rows = requiredRoomAssetRows(chart, manifest);
  const charted = { ...base, chartReady: true, assets: rows };
  assert.equal(guestProgressReady(charted), false);
  const oneDone = { ...charted, assets: markAssetDone(rows, "song.ogg") };
  assert.equal(guestProgressReady(oneDone), false);
  const bothDone = { ...charted, assets: markAssetDone(oneDone.assets, "cover.png") };
  assert.equal(guestProgressReady(bothDone), true);
  const failed = {
    ...oneDone,
    assets: markAssetError(oneDone.assets, "cover.png"),
    error: "transfer failed",
  };
  assert.equal(guestProgressReady(failed), false);
});
