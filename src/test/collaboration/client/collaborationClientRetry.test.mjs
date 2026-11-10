/** Checks that a transient close during initial room setup retries the intent. */
import assert from "node:assert/strict";
import test, { mock } from "node:test";
import { CollaborationClient } from "../../../core/collaboration/client.ts";

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

test("a reconnect resume reports the exact chart this client already applied", () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const sockets = [];
    const client = new CollaborationClient({
      socketFactory: () => {
        const socket = new FakeSocket();
        sockets.push(socket);
        return socket;
      },
    });
    client.connect("ws://127.0.0.1:47830");
    client.createRoom(
      { name: "Host", color: "#ffffff" },
      { META: {}, BPMList: [], judgeLineList: [] },
      "fp",
    );
    const first = sockets[0];
    first.emit("open");
    first.emit("message", {
      data: JSON.stringify({
        type: "welcome",
        roomId: "ROOM",
        invite: "INVITE",
        memberId: "host",
        hostId: "host",
        role: "host",
        revision: 4,
        fingerprint: "fp-4",
        members: [],
        presence: [],
        resumeToken: "secret",
      }),
    });
    first.emit("close");
    mock.timers.tick(1000);
    const second = sockets[1];
    second.emit("open");
    assert.deepEqual(second.sent[0], {
      type: "resume",
      roomId: "ROOM",
      token: "secret",
      binaryChunks: true,
      hasChart: true,
      revision: 4,
      fingerprint: "fp-4",
    });
    client.dispose();
  } finally {
    mock.timers.reset();
  }
});

test("an initial create retries a transient close before failing", () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const sockets = [];
    const client = new CollaborationClient({
      socketFactory: () => {
        const socket = new FakeSocket();
        sockets.push(socket);
        return socket;
      },
    });
    client.connect("ws://127.0.0.1:47830");
    client.createRoom(
      { name: "Host", color: "#ffffff" },
      { META: {}, BPMList: [], judgeLineList: [] },
      "fp",
    );
    const first = sockets[0];
    first.emit("open");
    assert.equal(first.sent[0].type, "create");

    first.emit("close");
    assert.equal(client.state.get().status, "connecting");
    mock.timers.tick(800);
    assert.equal(sockets.length, 2);
    const second = sockets[1];
    second.emit("open");
    assert.equal(second.sent[0].type, "create");
    second.emit("message", {
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
    assert.equal(client.state.get().status, "connected");
    assert.equal(client.state.get().roomId, "ROOM");
    client.dispose();
  } finally {
    mock.timers.reset();
  }
});
