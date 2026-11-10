/** Exercises the room client handshake, retries, and state fan-out with a fake socket. */
import assert from "node:assert/strict";
import test, { mock } from "node:test";
import { CollaborationClient } from "../../../core/collaboration/client.ts";
import { sha256Hex } from "../../../core/collaboration/digest.ts";

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

function socketHarness() {
  const sockets = [];
  const factory = () => {
    const socket = new FakeSocket();
    sockets.push(socket);
    return socket;
  };
  return { sockets, factory };
}

test("create waits for open, sends the snapshot, and accepts the welcome", () => {
  const harness = socketHarness();
  const snapshots = [];
  const client = new CollaborationClient({
    socketFactory: harness.factory,
    reconnect: false,
    onSnapshot: (snapshot) => snapshots.push(snapshot),
  });
  client.connect("http://127.0.0.1:47830");
  client.createRoom(
    { name: "Host", color: "#ffffff" },
    { META: {}, BPMList: [], judgeLineList: [] },
    "fp",
  );
  const socket = harness.sockets[0];
  assert.equal(socket.sent.length, 0);
  socket.emit("open");
  assert.equal(socket.sent[0].type, "create");
  socket.emit("message", {
    data: JSON.stringify({
      type: "welcome",
      roomId: "ROOM",
      invite: "INVITE",
      memberId: "host",
      hostId: "host",
      role: "host",
      revision: 0,
      fingerprint: "fp",
      members: [
        { id: "host", profile: { name: "Host", color: "#ffffff" }, role: "host", online: true },
      ],
      presence: [],
      resumeToken: "secret",
    }),
  });
  assert.equal(client.state.get().status, "connected");
  assert.equal(client.state.get().roomId, "ROOM");
  assert.equal(client.state.get().maxMembers, 4);
  assert.equal(client.state.get().members.length, 1);
  assert.equal(snapshots.length, 0);
  socket.emit("message", {
    data: JSON.stringify({ type: "room-settings", maxMembers: 8 }),
  });
  assert.equal(client.state.get().maxMembers, 8);
  client.dispose();
});

test("an unanswered socket becomes a connect timeout", () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const harness = socketHarness();
    const errors = [];
    const client = new CollaborationClient({
      socketFactory: harness.factory,
      reconnect: false,
      onError: (message, code) => errors.push({ message, code }),
    });
    client.connect("ws://127.0.0.1:47830");
    mock.timers.tick(10_000);
    assert.equal(client.state.get().status, "error");
    assert.equal(errors.length, 1);
    assert.equal(errors[0].code, "connect_timeout");
    assert.equal(harness.sockets[0].closed, true);
    client.dispose();
  } finally {
    mock.timers.reset();
  }
});

test("an unanswered create handshake becomes a handshake timeout", () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const harness = socketHarness();
    const errors = [];
    const client = new CollaborationClient({
      socketFactory: harness.factory,
      reconnect: false,
      onError: (message, code) => errors.push({ message, code }),
    });
    client.connect("ws://127.0.0.1:47830");
    client.createRoom(
      { name: "Host", color: "#ffffff" },
      { META: {}, BPMList: [], judgeLineList: [] },
      "fp",
    );
    const socket = harness.sockets[0];
    socket.emit("open");
    assert.equal(socket.sent[0].type, "create");
    mock.timers.tick(15_000);
    assert.equal(client.state.get().status, "error");
    assert.equal(errors.length, 1);
    assert.equal(errors[0].code, "handshake_timeout");
    client.dispose();
  } finally {
    mock.timers.reset();
  }
});

test("custom room passwords travel with the create message", () => {
  const harness = socketHarness();
  const client = new CollaborationClient({
    socketFactory: harness.factory,
    reconnect: false,
  });
  client.connect("ws://127.0.0.1:47830");
  client.createRoom(
    { name: "Host", color: "#ffffff" },
    { META: {}, BPMList: [], judgeLineList: [] },
    "fp",
    { password: "Secret42" },
  );
  const socket = harness.sockets[0];
  socket.emit("open");
  assert.equal(socket.sent[0].invite, "Secret42");
  client.dispose();
});

test("hosts connect locally while invitations keep the public URL", () => {
  const seen = [];
  const client = new CollaborationClient({
    socketFactory: (url) => {
      seen.push(url);
      return new FakeSocket();
    },
    reconnect: false,
  });
  client.connect("https://room.trycloudflare.com", {
    socketUrl: "ws://127.0.0.1:47830",
  });
  assert.deepEqual(seen, ["ws://127.0.0.1:47830"]);
  assert.equal(client.state.get().serverUrl, "wss://room.trycloudflare.com");
  client.dispose();
});

test("join sends a request and waits for host approval", () => {
  const harness = socketHarness();
  const client = new CollaborationClient({
    socketFactory: harness.factory,
    reconnect: false,
  });
  client.connect("ws://127.0.0.1:47830");
  client.join("ROOM", "INVITE", { name: "Guest", color: "#00ff00" });
  const socket = harness.sockets[0];
  socket.emit("open");
  assert.deepEqual(socket.sent[0], {
    type: "join",
    roomId: "ROOM",
    invite: "INVITE",
    profile: { name: "Guest", color: "#00ff00" },
  });
  socket.emit("message", { data: JSON.stringify({ type: "waiting", roomId: "ROOM" }) });
  assert.equal(client.state.get().status, "waiting");
  socket.emit("message", {
    data: JSON.stringify({
      type: "welcome",
      roomId: "ROOM",
      invite: "INVITE",
      memberId: "guest",
      hostId: "host",
      role: "editor",
      revision: 3,
      chart: { META: {}, BPMList: [], judgeLineList: [] },
      fingerprint: "fp",
      members: [],
      presence: [],
      resumeToken: "token",
    }),
  });
  assert.equal(client.state.get().status, "connected");
  assert.equal(client.state.get().role, "editor");
  client.dispose();
});

test("transactions are sent once connected and retried after a reconnect", () => {
  const harness = socketHarness();
  const client = new CollaborationClient({
    socketFactory: harness.factory,
    reconnect: false,
  });
  client.connect("ws://127.0.0.1:47830");
  const socket = harness.sockets[0];
  socket.emit("open");
  socket.emit("message", {
    data: JSON.stringify({
      type: "welcome",
      roomId: "ROOM",
      invite: "INVITE",
      memberId: "me",
      hostId: "host",
      role: "editor",
      revision: 1,
      fingerprint: "fp",
      members: [],
      presence: [],
      resumeToken: "token",
    }),
  });
  const transactionId = client.sendTransaction({
    label: "edit",
    changes: [{ op: "set", path: "/META/name", before: "a", after: "b" }],
    affectedObjectIds: ["line"],
    transactionId: "history-entry-1",
    undoOf: "original-1",
  });
  const sent = socket.sent.at(-1);
  assert.equal(sent.type, "transaction");
  assert.equal(sent.transactionId, "history-entry-1");
  assert.equal(sent.undoOf, "original-1");
  assert.equal(sent.baseRevision, undefined);
  socket.emit("message", {
    data: JSON.stringify({
      type: "committed",
      revision: 2,
      transactionId,
      actorId: "me",
      label: "edit",
      changes: [],
      fingerprint: "fp2",
    }),
  });
  assert.equal(client.state.get().revision, 2);
  client.dispose();
});

test("an old socket closing cannot tear down a replacement connection", () => {
  const harness = socketHarness();
  const client = new CollaborationClient({ socketFactory: harness.factory, reconnect: false });
  client.connect("ws://127.0.0.1:47830");
  const first = harness.sockets[0];
  first.emit("open");
  first.emit("message", {
    data: JSON.stringify({
      type: "welcome",
      roomId: "ROOM",
      invite: "INVITE",
      memberId: "me",
      hostId: "host",
      role: "editor",
      revision: 0,
      fingerprint: "fp",
      members: [],
      presence: [],
      resumeToken: "token",
    }),
  });
  client.connect("ws://127.0.0.1:47830");
  const second = harness.sockets[1];
  first.emit("close");
  assert.equal(client.state.get().status, "connecting");
  second.emit("open");
  assert.equal(client.state.get().status, "connecting");
  second.emit("message", {
    data: JSON.stringify({
      type: "welcome",
      roomId: "ROOM",
      invite: "INVITE",
      memberId: "me",
      hostId: "host",
      role: "editor",
      revision: 1,
      chart: { META: {}, BPMList: [], judgeLineList: [] },
      fingerprint: "fp",
      members: [],
      presence: [],
      resumeToken: "token",
    }),
  });
  assert.equal(client.state.get().status, "connected");
  client.dispose();
});

test("asset uploads are chunked and downloads verify their hash", async () => {
  const harness = socketHarness();
  const ready = [];
  const transfers = [];
  const client = new CollaborationClient({
    socketFactory: harness.factory,
    reconnect: false,
    onAssetReady: (asset, bytes) => ready.push({ asset, bytes }),
    onAssetProgress: (progress) => transfers.push(progress),
  });
  client.connect("ws://127.0.0.1:47830");
  const socket = harness.sockets[0];
  socket.emit("open");
  socket.emit("message", {
    data: JSON.stringify({
      type: "welcome",
      roomId: "ROOM",
      invite: "INVITE",
      memberId: "me",
      hostId: "host",
      role: "editor",
      revision: 0,
      fingerprint: "fp",
      members: [],
      presence: [],
      assets: [],
      resumeToken: "token",
    }),
  });
  const bytes = new TextEncoder().encode("asset bytes");
  const hash = await sha256Hex(bytes);
  const upload = client.uploadAsset("cover.png", bytes);
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (socket.sent.some((message) => message.type === "asset-commit")) {
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  const sent = socket.sent.filter((message) => message.type.startsWith("asset-"));
  assert.equal(sent[0].type, "asset-begin");
  assert.equal(sent[0].hash, hash);
  assert.equal(sent[0].name, "cover.png");
  assert.equal(sent[1].type, "asset-chunk");
  assert.equal(sent.at(-1).type, "asset-commit");
  socket.emit("message", {
    data: JSON.stringify({
      type: "asset-accepted",
      asset: { name: "cover.png", hash, size: bytes.length, mime: "image/png" },
    }),
  });
  assert.equal(await upload, hash);
  assert.deepEqual(
    transfers.filter((entry) => entry.direction === "upload").map((entry) => entry.state),
    ["begin", "progress", "done"],
  );

  socket.emit("message", {
    data: JSON.stringify({
      type: "asset-download-begin",
      requestId: "download",
      asset: { name: "cover.png", hash, size: bytes.length, mime: "image/png" },
      totalChunks: 1,
      chunkSize: 256 * 1024,
    }),
  });
  socket.emit("message", {
    data: JSON.stringify({
      type: "asset-download-chunk",
      requestId: "download",
      index: 0,
      data: Buffer.from(bytes).toString("base64"),
    }),
  });
  socket.emit("message", {
    data: JSON.stringify({ type: "asset-download-end", requestId: "download", hash }),
  });
  for (let attempt = 0; attempt < 100 && ready.length === 0; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal(ready.length, 1);
  assert.deepEqual([...ready[0].bytes], [...bytes]);
  assert.deepEqual(
    transfers.filter((entry) => entry.direction === "download").map((entry) => entry.state),
    ["begin", "progress", "done"],
  );
  assert.equal(transfers.at(-1).name, "cover.png");
  assert.equal(transfers.at(-1).received, bytes.length);
  client.dispose();
});

test("presence updates replace the earlier marker", () => {
  const harness = socketHarness();
  const client = new CollaborationClient({ socketFactory: harness.factory, reconnect: false });
  client.connect("ws://127.0.0.1:47830");
  const socket = harness.sockets[0];
  socket.emit("open");
  socket.emit("message", {
    data: JSON.stringify({
      type: "welcome",
      roomId: "ROOM",
      invite: "INVITE",
      memberId: "me",
      hostId: "host",
      role: "editor",
      revision: 0,
      fingerprint: "fp",
      members: [],
      presence: [],
      resumeToken: "token",
    }),
  });
  socket.emit("message", {
    data: JSON.stringify({
      type: "presence",
      presence: { memberId: "other", area: "edit", beat: 4, updatedAt: 10 },
    }),
  });
  socket.emit("message", {
    data: JSON.stringify({
      type: "presence",
      presence: { memberId: "other", area: "edit", beat: 8, updatedAt: 11 },
    }),
  });
  const presence = client.state.get().presence;
  assert.equal(presence.length, 1);
  assert.equal(presence[0].beat, 8);
  socket.emit("message", {
    data: JSON.stringify({
      type: "presence",
      presence: { memberId: "other", area: "edit", updatedAt: 0 },
    }),
  });
  assert.equal(client.state.get().presence.length, 0);
  client.dispose();
});

test("a queued batch reacquires its leases before the reconnect retry", async () => {
  const harness = socketHarness();
  const client = new CollaborationClient({
    socketFactory: harness.factory,
    reconnect: true,
  });
  client.connect("ws://127.0.0.1:47830");
  const first = harness.sockets[0];
  first.emit("open");
  first.emit("message", {
    data: JSON.stringify({
      type: "welcome",
      roomId: "ROOM",
      invite: "INVITE",
      memberId: "me",
      hostId: "host",
      role: "editor",
      revision: 1,
      fingerprint: "fp",
      members: [],
      presence: [],
      resumeToken: "token",
    }),
  });
  first.emit("close");
  client.sendTransaction(
    {
      label: "offline edit",
      changes: [{ op: "set", path: "/META/name", before: "a", after: "b" }],
      affectedObjectIds: [],
      transactionId: "offline-1",
      lockIds: ["chart"],
    },
    { locksHeld: false },
  );
  assert.equal(client.state.get().queued, 1);

  client.connect("ws://127.0.0.1:47830");
  const second = harness.sockets[1];
  second.emit("open");
  second.emit("message", {
    data: JSON.stringify({
      type: "welcome",
      roomId: "ROOM",
      invite: "INVITE",
      memberId: "me",
      hostId: "host",
      role: "editor",
      revision: 2,
      fingerprint: "fp2",
      members: [],
      presence: [],
      resumeToken: "token",
    }),
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  const lockRequest = second.sent.find((message) => message.type === "lock-request");
  assert.ok(lockRequest, "the queued batch must request its lease first");
  assert.deepEqual(lockRequest.ids, ["chart"]);
  second.emit("message", {
    data: JSON.stringify({ type: "lock-result", requestId: lockRequest.requestId, granted: true }),
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  const transaction = second.sent.find((message) => message.type === "transaction");
  assert.equal(transaction.transactionId, "offline-1");
  assert.deepEqual(transaction.lockIds, ["chart"]);
  client.dispose();
});

test("reconnect attempts grow when a socket closes before welcome", () => {
  const harness = socketHarness();
  const client = new CollaborationClient({
    socketFactory: harness.factory,
    reconnect: true,
  });
  client.connect("ws://127.0.0.1:47830");
  const first = harness.sockets[0];
  first.emit("open");
  first.emit("message", {
    data: JSON.stringify({
      type: "welcome",
      roomId: "ROOM",
      invite: "INVITE",
      memberId: "me",
      hostId: "host",
      role: "editor",
      revision: 1,
      fingerprint: "fp",
      members: [],
      presence: [],
      resumeToken: "token",
    }),
  });
  assert.equal(client.reconnectAttempts, 0);
  first.emit("close");
  assert.equal(client.reconnectAttempts, 1);
  client.connect("ws://127.0.0.1:47830");
  const second = harness.sockets[1];
  second.emit("open");
  second.emit("close");
  assert.equal(client.reconnectAttempts, 2);
  client.dispose();
});

test("a room from a different product version is rejected before acceptance", () => {
  const harness = socketHarness();
  const client = new CollaborationClient({
    appVersion: "1.0.10",
    socketFactory: harness.factory,
    reconnect: false,
  });
  client.connect("ws://127.0.0.1:47830");
  const socket = harness.sockets[0];
  socket.emit("open");
  socket.emit("message", {
    data: JSON.stringify({
      type: "welcome",
      roomId: "ROOM",
      invite: "INVITE",
      memberId: "me",
      hostId: "host",
      role: "editor",
      revision: 1,
      fingerprint: "fp",
      appVersion: "1.0.9",
      members: [],
      presence: [],
      resumeToken: "token",
    }),
  });
  assert.equal(client.state.get().status, "error");
  assert.equal(client.state.get().roomId, "");
  client.dispose();
});

test("a room from the same product version is accepted", () => {
  const harness = socketHarness();
  const client = new CollaborationClient({
    appVersion: "1.0.10",
    socketFactory: harness.factory,
    reconnect: false,
  });
  client.connect("ws://127.0.0.1:47830");
  const socket = harness.sockets[0];
  socket.emit("open");
  socket.emit("message", {
    data: JSON.stringify({
      type: "welcome",
      roomId: "ROOM",
      invite: "INVITE",
      memberId: "me",
      hostId: "host",
      role: "editor",
      revision: 1,
      fingerprint: "fp",
      appVersion: "1.0.10",
      members: [],
      presence: [],
      resumeToken: "token",
    }),
  });
  assert.equal(client.state.get().status, "connected");
  client.dispose();
});

test("resumeRoom sends the persisted token before a document is opened", () => {
  const harness = socketHarness();
  const client = new CollaborationClient({
    socketFactory: harness.factory,
    reconnect: false,
  });
  client.resumeRoom("ws://127.0.0.1:47830", "ROOM", "saved-token");
  const socket = harness.sockets[0];
  socket.emit("open");
  assert.deepEqual(socket.sent[0], {
    type: "resume",
    roomId: "ROOM",
    token: "saved-token",
  });
  client.dispose();
});

test("a large room snapshot is delivered without truncation", () => {
  const harness = socketHarness();
  const snapshots = [];
  const client = new CollaborationClient({
    socketFactory: harness.factory,
    reconnect: false,
    onSnapshot: (snapshot) => snapshots.push(snapshot),
  });
  client.connect("ws://127.0.0.1:47830");
  const socket = harness.sockets[0];
  socket.emit("open");
  const notes = Array.from({ length: 5000 }, (unused, index) => ({
    id: `note-${index}`,
    positionX: index / 100,
  }));
  socket.emit("message", {
    data: JSON.stringify({
      type: "welcome",
      roomId: "ROOM",
      invite: "INVITE",
      memberId: "me",
      hostId: "host",
      role: "editor",
      revision: 4,
      chart: {
        META: { name: "large" },
        BPMList: [],
        judgeLineList: [{ id: "line", notes, eventLayers: [] }],
      },
      fingerprint: "fp",
      members: [],
      presence: [],
      resumeToken: "token",
    }),
  });
  assert.equal(snapshots.length, 1);
  assert.equal(snapshots[0].chart.judgeLineList[0].notes.length, 5000);
  client.dispose();
});

test("an asset upload rejects when the room refuses the blob", async () => {
  const harness = socketHarness();
  const client = new CollaborationClient({
    socketFactory: harness.factory,
    reconnect: false,
  });
  client.connect("ws://127.0.0.1:47830");
  const socket = harness.sockets[0];
  socket.emit("open");
  socket.emit("message", {
    data: JSON.stringify({
      type: "welcome",
      roomId: "ROOM",
      invite: "INVITE",
      memberId: "me",
      hostId: "host",
      role: "editor",
      revision: 0,
      fingerprint: "fp",
      members: [],
      presence: [],
      resumeToken: "token",
    }),
  });
  const upload = client.uploadAsset("cover.png", new TextEncoder().encode("asset bytes"));
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (socket.sent.some((message) => message.type === "asset-commit")) {
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  const begin = socket.sent.find((message) => message.type === "asset-begin");
  socket.emit("message", {
    data: JSON.stringify({
      type: "asset-rejected",
      requestId: begin.requestId,
      message: "asset type is not allowed",
    }),
  });
  await assert.rejects(upload, /asset type is not allowed/);
  client.dispose();
});

test("host close deletes the room and a close notice resets a guest client", () => {
  const harness = socketHarness();
  const errors = [];
  const client = new CollaborationClient({
    socketFactory: harness.factory,
    reconnect: false,
    onError: (message, code) => errors.push({ code, message }),
  });
  client.connect("ws://127.0.0.1:47830");
  client.createRoom(
    { name: "Host", color: "#ffffff" },
    { META: {}, BPMList: [], judgeLineList: [] },
    "fp",
  );
  const socket = harness.sockets[0];
  socket.emit("open");
  socket.emit("message", {
    data: JSON.stringify({
      type: "welcome",
      roomId: "ROOM",
      invite: "INVITE",
      memberId: "host",
      hostId: "host",
      role: "host",
      revision: 0,
      fingerprint: "fp",
      members: [],
      presence: [],
      resumeToken: "secret",
    }),
  });
  client.closeRoom();
  assert.deepEqual(
    socket.sent.map((message) => message.type),
    ["create", "close-room"],
  );
  assert.equal(client.state.get().status, "idle");
  assert.equal(client.state.get().roomId, "");

  const guestHarness = socketHarness();
  const guest = new CollaborationClient({
    socketFactory: guestHarness.factory,
    reconnect: false,
    onError: (message, code) => errors.push({ code, message }),
  });
  guest.connect("ws://127.0.0.1:47830");
  guest.join("ROOM", "INVITE", { name: "Guest", color: "#00ff00" });
  const guestSocket = guestHarness.sockets[0];
  guestSocket.emit("open");
  guestSocket.emit("message", {
    data: JSON.stringify({
      type: "welcome",
      roomId: "ROOM",
      invite: "INVITE",
      memberId: "guest",
      hostId: "host",
      role: "editor",
      revision: 0,
      fingerprint: "fp",
      members: [],
      presence: [],
      resumeToken: "guest-secret",
    }),
  });
  guestSocket.emit("message", {
    data: JSON.stringify({
      type: "room-closed",
      reason: "host_closed",
      message: "The host closed the room",
    }),
  });
  assert.equal(guest.state.get().status, "idle");
  assert.equal(guest.state.get().roomId, "");
  assert.equal(errors.at(-1).code, "room_closed");
  client.dispose();
  guest.dispose();
});
