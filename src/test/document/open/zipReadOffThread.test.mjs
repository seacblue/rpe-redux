/**
 * Contract: the off-thread ZIP reader sends only structured-cloneable limits to
 * its worker, while progress callbacks stay on the calling thread.
 */
import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import { readZipOffThread } from "../../../frontend/screens/editor/workspace/document/open/zipReadOffThread.ts";

/** Minimal worker double that records the one posted request. */
class FakeWorker {
  static instance;

  onmessage = null;
  onerror = null;
  posted = null;
  terminated = false;

  constructor() {
    FakeWorker.instance = this;
  }

  postMessage(message) {
    this.posted = message;
  }

  terminate() {
    this.terminated = true;
  }
}

const originalWorker = globalThis.Worker;

afterEach(() => {
  if (originalWorker === undefined) {
    delete globalThis.Worker;
  } else {
    globalThis.Worker = originalWorker;
  }
  FakeWorker.instance = undefined;
});

test("ZIP limits cross the worker boundary without the progress callback", async () => {
  globalThis.Worker = FakeWorker;
  const progress = [];
  const pending = readZipOffThread(
    new Uint8Array([1, 2, 3]),
    {
      maxEntries: 4,
      maxTotalBytes: 2048,
      onProgress: (completed, total) => progress.push([completed, total]),
    },
    undefined,
  );

  const worker = FakeWorker.instance;
  assert.ok(worker);
  assert.equal(typeof worker.posted.limits.onProgress, "undefined");
  assert.equal(worker.posted.limits.maxEntries, 4);
  assert.equal(worker.posted.limits.maxTotalBytes, 2048);
  assert.doesNotThrow(() => structuredClone(worker.posted));

  worker.onmessage({
    data: { id: worker.posted.id, kind: "progress", completed: 1, total: 4 },
  });
  worker.onmessage({
    data: {
      id: worker.posted.id,
      kind: "result",
      entries: [{ name: "chart.json", bytes: new Uint8Array([7]).buffer }],
    },
  });

  const files = await pending;
  assert.deepEqual(progress, [[1, 4]]);
  assert.deepEqual([...files.get("chart.json")], [7]);
  assert.equal(worker.terminated, true);
});

test("lazy ZIP assets inflate only when read", async () => {
  globalThis.Worker = FakeWorker;
  const pending = readZipOffThread(new Uint8Array([1, 2, 3]), {}, undefined);
  const firstWorker = FakeWorker.instance;
  firstWorker.onmessage({
    data: {
      id: firstWorker.posted.id,
      kind: "result",
      names: ["chart.json", "song.ogg"],
      entries: [{ name: "chart.json", bytes: new Uint8Array([7]).buffer }],
    },
  });
  const assets = await pending;
  assert.deepEqual([...assets.names()], ["chart.json", "song.ogg"]);
  assert.equal(assets.get("song.ogg"), undefined);

  const songPending = assets.read("song.ogg");
  const secondWorker = FakeWorker.instance;
  assert.deepEqual(secondWorker.posted.limits.only, ["song.ogg"]);
  secondWorker.onmessage({
    data: {
      id: secondWorker.posted.id,
      kind: "result",
      entries: [{ name: "song.ogg", bytes: new Uint8Array([9, 8]).buffer }],
    },
  });
  assert.deepEqual([...((await songPending) ?? [])], [9, 8]);
  assert.deepEqual([...(assets.get("song.ogg") ?? [])], [9, 8]);
});
