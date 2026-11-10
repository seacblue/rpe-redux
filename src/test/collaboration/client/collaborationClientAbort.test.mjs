/** Checks that cancelling a room setup stops transport and clears its state. */
import assert from "node:assert/strict";
import test from "node:test";
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

function joinedClient(role) {
  const sockets = [];
  const client = new CollaborationClient({
    socketFactory: () => {
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket;
    },
    reconnect: false,
  });
  client.connect("ws://127.0.0.1:47830");
  const socket = sockets[0];
  socket.emit("open");
  socket.emit("message", {
    data: JSON.stringify({
      type: "welcome",
      roomId: "ROOM",
      invite: "INVITE",
      memberId: "me",
      hostId: role === "host" ? "me" : "host",
      role,
      revision: 1,
      fingerprint: "fp",
      members: [],
      presence: [],
      assets: [],
      resumeToken: "token",
    }),
  });
  return { client, socket };
}

test("abort sends a leave, closes the socket, and clears guest state", () => {
  const { client, socket } = joinedClient("editor");
  client.abort();
  assert.equal(client.state.get().status, "idle");
  assert.equal(client.state.get().roomId, "");
  assert.equal(socket.closed, true);
  assert.equal(socket.sent.at(-1).type, "leave");
  client.dispose();
});

test("abort asks a created host room to close before clearing state", () => {
  const { client, socket } = joinedClient("host");
  client.abort();
  assert.equal(client.state.get().status, "idle");
  assert.equal(socket.closed, true);
  assert.equal(socket.sent.at(-1).type, "close-room");
  client.dispose();
});
