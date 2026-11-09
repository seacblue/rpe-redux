/** Exercises room capability, lease, undo, and asset-transfer rules. */
import assert from "node:assert/strict";
import test from "node:test";
import {
  acquireLeases,
  activeLeases,
  foreignLeases,
  missingLeases,
  releaseLeases,
  releaseOwnerLeases,
  sweepExpiredLeases,
} from "../../../core/collaboration/leases.ts";
import { Outbox } from "../../../core/collaboration/outbox.ts";
import {
  canPerform,
  canPublishAsset,
  roomPermissions,
} from "../../../core/collaboration/permissions.ts";
import { AssetAssembler, assetChunkRanges } from "../../../core/collaboration/transfer.ts";
import { recordUndo, validateUndo } from "../../../core/collaboration/undoLedger.ts";

test("roles map to explicit capabilities", () => {
  assert.equal(canPerform("host", "manage-room"), true);
  assert.equal(canPerform("editor", "edit-chart"), true);
  assert.equal(canPerform("editor", "replace-asset"), true);
  assert.equal(canPerform("viewer", "edit-chart"), false);
  assert.equal(canPerform("viewer", "read"), true);
  assert.equal(canPublishAsset("editor", false), true);
  assert.equal(canPublishAsset("editor", true), true);
  assert.equal(canPublishAsset("host", true), true);
  assert.equal(roomPermissions("viewer").read, true);
  assert.equal(roomPermissions("viewer").editChart, false);
});

test("leases are all-or-nothing and chart scope blocks object scopes", () => {
  const locks = new Map();
  const chart = acquireLeases(locks, "host", ["chart"], { now: 1_000 });
  assert.equal(chart.ok, true);
  assert.equal(chart.leases[0].scope, "chart");

  const blockedByChart = acquireLeases(locks, "editor", ["line:a", "obj:note"], { now: 1_000 });
  assert.equal(blockedByChart.ok, false);
  assert.deepEqual(
    blockedByChart.conflicts.map((lock) => lock.id),
    ["chart"],
  );

  releaseLeases(locks, "host", ["chart"]);
  const editor = acquireLeases(locks, "editor", ["line:a", "obj:note"], {
    ttlMs: 15_000,
    now: 1_000,
  });
  assert.equal(editor.ok, true);
  assert.equal(editor.leases.length, 2);
  assert.equal(editor.leases[0].scope, "line");

  const chartAgainstObjects = acquireLeases(locks, "host", ["chart"], { now: 1_000 });
  assert.equal(chartAgainstObjects.ok, false);
  assert.deepEqual(chartAgainstObjects.conflicts.map((lock) => lock.id).sort(), [
    "line:a",
    "obj:note",
  ]);

  const sameOwner = acquireLeases(locks, "editor", ["obj:note"], {
    ttlMs: 2_000,
    now: 1_000,
  });
  assert.equal(sameOwner.ok, true);
  assert.equal(sameOwner.leases[0].expiresAt, 3_000);
});

test("expired leases are swept and missing owned leases are reported", () => {
  const locks = new Map();
  acquireLeases(locks, "editor", ["line:a"], { ttlMs: 1_000, now: 1_000 });
  assert.deepEqual(missingLeases(locks, "editor", ["line:a"], 1_500), []);
  assert.deepEqual(missingLeases(locks, "viewer", ["line:a"], 1_500), ["line:a"]);
  assert.equal(foreignLeases(locks, "viewer", ["line:a"], 1_500).length, 1);
  assert.equal(sweepExpiredLeases(locks, 2_000), 1);
  assert.equal(activeLeases(locks, 2_000).length, 0);
});

test("release helpers only remove the owner's leases", () => {
  const locks = new Map();
  acquireLeases(locks, "editor", ["obj:a", "obj:b"], { now: 1_000 });
  acquireLeases(locks, "host", ["obj:c"], { now: 1_000 });
  assert.equal(releaseLeases(locks, "editor", ["obj:a", "obj:c"]), 1);
  assert.equal(locks.has("obj:c"), true);
  assert.equal(releaseOwnerLeases(locks, "editor"), 1);
  assert.equal(locks.size, 1);
});

test("undo accepts only one compensation by the original author", () => {
  const ledger = new Map();
  recordUndo(ledger, "edit-1", "editor");
  assert.equal(validateUndo(ledger, "editor", "edit-1").ok, true);
  assert.equal(validateUndo(ledger, "viewer", "edit-1").code, "undo_forbidden");
  assert.equal(validateUndo(ledger, "editor", "missing").code, "unknown_transaction");
  recordUndo(ledger, "undo-1", "editor", "edit-1");
  assert.equal(validateUndo(ledger, "editor", "edit-1").code, "already_undone");
});

test("asset chunks cover the exact byte count and assemble out of order", () => {
  const ranges = assetChunkRanges(10, 4);
  assert.deepEqual(
    ranges.map((range) => [range.index, range.offset, range.length]),
    [
      [0, 0, 4],
      [1, 4, 4],
      [2, 8, 2],
    ],
  );
  const assembler = new AssetAssembler(10, 4);
  assert.equal(assembler.complete, false);
  assert.equal(assembler.write(2, Uint8Array.from([8, 9])).ok, true);
  assert.equal(assembler.write(0, Uint8Array.from([0, 1, 2, 3])).ok, true);
  assert.equal(assembler.write(1, Uint8Array.from([4, 5, 6])).ok, false);
  assert.equal(assembler.write(1, Uint8Array.from([4, 5, 6, 7])).ok, true);
  assert.equal(assembler.write(1, Uint8Array.from([4, 5, 6, 7])).duplicate, true);
  assert.equal(assembler.complete, true);
  assert.deepEqual([...assembler.result()], [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.equal(assembler.progress, 1);
});

test("outbox bounds entries and retries undo work before ordinary edits", () => {
  const outbox = new Outbox({ maxEntries: 3, maxBytes: 10, now: () => 100 });
  assert.equal(outbox.put("normal", "a", { bytes: 4 }).ok, true);
  assert.equal(outbox.put("undo", "b", { priority: "critical", bytes: 4 }).ok, true);
  assert.equal(outbox.put("full", "c", { bytes: 4 }).ok, false);
  assert.equal(outbox.put("normal", "duplicate", { bytes: 1 }).reason, "duplicate");
  assert.equal(outbox.size, 2);
  assert.equal(outbox.bytes, 8);
  outbox.markAttempt("normal");
  assert.equal(outbox.get("normal").attempts, 1);
  assert.deepEqual(
    outbox.values().map((entry) => entry.id),
    ["undo", "normal"],
  );
  assert.equal(outbox.delete("undo"), true);
  assert.equal(outbox.bytes, 4);
  outbox.clear();
  assert.equal(outbox.size, 0);
});
