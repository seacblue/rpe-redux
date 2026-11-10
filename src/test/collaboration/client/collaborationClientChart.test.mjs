/** Exercises the client's gzip chart wire path with a fake room socket. */
import assert from "node:assert/strict";
import test from "node:test";
import { CollaborationClient } from "../../../core/collaboration/client.ts";
import { encodeChartWire, gzipBytes } from "../../../core/collaboration/chartWire.ts";
import { encodeBinaryAssetFrame } from "../../../core/collaboration/transfer.ts";

/** Minimal socket surface the client consumes. */
class FakeSocket {
  sent = [];
  closed = false;
  listeners = new Map();

  send(data) {
    this.sent.push(JSON.parse(data));
  }

  close() {
    this.closed = true;
  }

  addEventListener(type, listener) {
    const entries = this.listeners.get(type) ?? [];
    entries.push(listener);
    this.listeners.set(type, entries);
  }

  removeEventListener(type, listener) {
    this.listeners.set(
      type,
      (this.listeners.get(type) ?? []).filter((entry) => entry !== listener),
    );
  }

  emit(type, event = {}) {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event);
    }
  }
}

/** Wait until an asynchronous message dispatch settles. */
async function until(check, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (check()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

function chart() {
  return {
    META: { name: "gzip" },
    BPMList: [{ beat: [0, 0, 1], bpm: 180 }],
    judgeLineList: [],
  };
}

test("a gzip chart is sent, welcomed, and snapshotted through the same wire form", async () => {
  const sockets = [];
  const snapshots = [];
  const client = new CollaborationClient({
    socketFactory: () => {
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket;
    },
    reconnect: false,
    onSnapshot: (snapshot) => snapshots.push(snapshot),
  });
  const value = chart();
  const encoded = await encodeChartWire(value);
  client.connect("ws://127.0.0.1:47830");
  client.createRoom({ name: "Host", color: "#ffffff" }, encoded.chart, "fp", {
    chartEncoding: encoded.chartEncoding,
  });
  const socket = sockets[0];
  socket.emit("open");
  assert.equal(socket.sent[0].chartEncoding, "gzip");
  assert.equal(typeof socket.sent[0].chart, "string");
  socket.emit("message", {
    data: JSON.stringify({
      type: "welcome",
      roomId: "ROOM",
      invite: "INVITE",
      memberId: "host",
      hostId: "host",
      role: "host",
      revision: 1,
      chart: encoded.chart,
      chartEncoding: "gzip",
      fingerprint: "fp",
      members: [],
      presence: [],
      resumeToken: "token",
    }),
  });
  await until(() => snapshots.length === 1);
  assert.equal(client.state.get().status, "connected");
  assert.deepEqual(snapshots[0].chart, value);
  socket.emit("message", {
    data: JSON.stringify({
      type: "snapshot",
      revision: 2,
      chart: encoded.chart,
      chartEncoding: "gzip",
      fingerprint: "fp-2",
    }),
  });
  await until(() => snapshots.length === 2);
  assert.deepEqual(snapshots[1].chart, value);
  assert.equal(snapshots[1].revision, 2);
  client.dispose();
});

test("a chunked welcome and snapshot assemble before the editor sees them", async () => {
  const sockets = [];
  const snapshots = [];
  const client = new CollaborationClient({
    socketFactory: () => {
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket;
    },
    reconnect: false,
    onSnapshot: (snapshot) => snapshots.push(snapshot),
  });
  const value = chart();
  const bytes = await gzipBytes(new TextEncoder().encode(JSON.stringify(value)));
  const chunkSize = 7;
  const count = Math.ceil(bytes.length / chunkSize);
  const transfer = (index) => {
    const offset = index * chunkSize;
    const end = Math.min(bytes.length, offset + chunkSize);
    return encodeBinaryAssetFrame(
      {
        type: "chart-chunk",
        transferId: "transfer-1",
        index,
        offset,
        count,
        size: bytes.length,
      },
      bytes.subarray(offset, end),
    );
  };
  client.connect("ws://127.0.0.1:47830");
  client.createRoom({ name: "Host", color: "#ffffff" }, "{}", "fp");
  const socket = sockets[0];
  socket.emit("open");
  socket.emit("message", {
    data: JSON.stringify({
      type: "welcome",
      roomId: "ROOM",
      invite: "INVITE",
      memberId: "host",
      hostId: "host",
      role: "host",
      revision: 1,
      chartChunks: true,
      chartTransfer: "transfer-1",
      chartSize: bytes.length,
      chartChunkCount: count,
      fingerprint: "fp",
      members: [],
      presence: [],
      resumeToken: "token",
    }),
  });
  for (let index = 0; index < count; index += 1) {
    socket.emit("message", { data: transfer(index) });
  }
  await until(() => snapshots.length === 1);
  assert.deepEqual(snapshots[0].chart, value);
  assert.equal(snapshots[0].revision, 1);

  socket.emit("message", {
    data: JSON.stringify({
      type: "snapshot",
      revision: 2,
      chartChunks: true,
      chartTransfer: "transfer-1",
      chartSize: bytes.length,
      chartChunkCount: count,
      fingerprint: "fp-2",
    }),
  });
  for (let index = 0; index < count; index += 1) {
    socket.emit("message", { data: transfer(index) });
  }
  await until(() => snapshots.length === 2);
  assert.deepEqual(snapshots[1].chart, value);
  assert.equal(snapshots[1].revision, 2);
  client.dispose();
});

test("a malformed gzip welcome ends the room instead of applying bad data", async () => {
  const sockets = [];
  const errors = [];
  const client = new CollaborationClient({
    socketFactory: () => {
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket;
    },
    reconnect: false,
    onError: (message, code) => errors.push({ message, code }),
  });
  client.connect("ws://127.0.0.1:47830");
  client.createRoom({ name: "Host", color: "#ffffff" }, "{}", "fp");
  const socket = sockets[0];
  socket.emit("open");
  socket.emit("message", {
    data: JSON.stringify({
      type: "welcome",
      roomId: "ROOM",
      invite: "INVITE",
      memberId: "host",
      hostId: "host",
      role: "host",
      revision: 1,
      chart: "not base64!",
      chartEncoding: "gzip",
      fingerprint: "fp",
      members: [],
      presence: [],
      resumeToken: "token",
    }),
  });
  await until(() => errors.length > 0);
  assert.equal(client.state.get().status, "error");
  assert.equal(errors[0].code, "invalid_chart");
  client.dispose();
});
