/** A joined room is temporary: its recovery family is discarded, never saved. */
import assert from "node:assert/strict";
import test from "node:test";
import { createChart } from "../../../core/global/chart/chart.ts";
import { TauriDocumentStore } from "../../../core/platform/desktop/documentStore.ts";

/** Capture the Tauri commands a recovery write issues. */
function captureTauri() {
  const calls = [];
  globalThis.window = {
    __TAURI_INTERNALS__: {
      invoke: async (command, args) => {
        calls.push({ command, args });
        return command === "begin_recovery" ? "recovery-session" : null;
      },
    },
  };
  return calls;
}

test("discarding a room document deletes its detached recovery family", async () => {
  const calls = captureTauri();
  const store = new TauriDocumentStore(async (chart) => JSON.stringify(chart));
  const untitled = store.recoveryId;
  store.detachRecoveryTarget();
  const detached = store.recoveryId;
  assert.notEqual(detached, untitled);

  await store.discardDetachedRecovery();

  const deleted = calls.find((call) => call.command === "delete_recovery");
  assert.ok(deleted, "discard must delete the detached recovery draft");
  assert.equal(deleted.args.id, detached);
  assert.equal(store.recoveryId, untitled);
});

test("a displaced chart is written through the native recovery command stream", async () => {
  const calls = captureTauri();
  const store = new TauriDocumentStore(async (chart) => JSON.stringify(chart));
  store.recoveryId = "prejoin-recovery";
  const chart = createChart();
  const assets = new Map([["song.ogg", new Uint8Array([1, 2, 3])]]);

  await store.recover(chart, assets, { lineIndex: 2 });

  const begin = calls.find((call) => call.command === "begin_recovery");
  assert.ok(begin, "recover must start a native recovery session");
  assert.equal(begin.args.request.id, "prejoin-recovery");
  assert.equal(begin.args.request.path, null);
  assert.deepEqual(begin.args.request.viewState, { lineIndex: 2 });
  assert.equal(begin.args.request.limit, 10);
  assert.ok(calls.some((call) => call.command === "write_recovery_chart"));
  assert.equal(calls.filter((call) => call.command === "write_recovery_asset").length, 1);
  assert.ok(calls.some((call) => call.command === "finish_recovery"));
});

test("a recovery write keeps the pre-join target captured before serialization finishes", async () => {
  const calls = captureTauri();
  let releaseSerialization = () => {};
  const serialized = new Promise((resolve) => {
    releaseSerialization = resolve;
  });
  const store = new TauriDocumentStore(async (chart) => {
    await serialized;
    return JSON.stringify(chart);
  });
  store.current = {
    id: "local-document",
    path: "C:\\charts\\original.json",
    chart_name: "original.json",
    entries: [],
  };
  store.recoveryId = "prejoin-recovery";

  const pending = store.recover(createChart(), new Map());
  store.detachRecoveryTarget();
  await store.close();
  releaseSerialization();
  await pending;

  const begin = calls.find((call) => call.command === "begin_recovery");
  assert.ok(begin, "recover must start a native recovery session");
  assert.equal(begin.args.request.id, "local-document");
  assert.equal(begin.args.request.path, "C:\\charts\\original.json");
});

test("the room document gets a new recovery family after the pre-join draft", async () => {
  const calls = captureTauri();
  const store = new TauriDocumentStore(async (chart) => JSON.stringify(chart));
  store.current = {
    id: "local-document",
    path: "C:\\charts\\original.json",
    chart_name: "original.json",
    entries: [],
  };
  store.recoveryId = "prejoin-recovery";
  await store.recover(createChart(), new Map());

  store.detachRecoveryTarget();
  const roomRecoveryId = store.recoveryId;
  assert.notEqual(roomRecoveryId, "prejoin-recovery");
  await store.recover(createChart(), new Map());

  const [prejoin, room] = calls
    .filter((call) => call.command === "begin_recovery")
    .map((call) => call.args.request);
  assert.equal(prejoin.path, "C:\\charts\\original.json");
  assert.equal(room.path, null);
  assert.equal(room.id, roomRecoveryId);
});
