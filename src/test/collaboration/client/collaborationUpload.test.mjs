/** Verifies that large asset uploads yield between WebSocket chunks. */
import assert from "node:assert/strict";
import test from "node:test";
import { CollaborationClient } from "../../../core/collaboration/client.ts";
import { ASSET_CHUNK_BYTES } from "../../../core/collaboration/assets.ts";
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

test("large asset uploads yield between chunks", async () => {
  const socket = new FakeSocket();
  const client = new CollaborationClient({
    socketFactory: () => socket,
    reconnect: false,
  });
  client.connect("ws://127.0.0.1:47830");
  socket.emit("open");
  socket.emit("message", {
    data: JSON.stringify({
      type: "welcome",
      roomId: "ROOM",
      invite: "INVITE",
      memberId: "me",
      hostId: "host",
      role: "host",
      revision: 0,
      fingerprint: "fp",
      members: [],
      presence: [],
      resumeToken: "token",
    }),
  });
  const originalSend = socket.send.bind(socket);
  const bytes = new Uint8Array(ASSET_CHUNK_BYTES * 3);
  let timerRan = false;
  let yieldedBetweenChunks = false;
  let chunks = 0;
  socket.send = (data) => {
    const message = JSON.parse(data);
    if (message.type === "asset-chunk") {
      chunks += 1;
      yieldedBetweenChunks ||= timerRan;
      if (chunks === 1) {
        setTimeout(() => {
          timerRan = true;
        }, 0);
      }
    }
    originalSend(data);
  };
  const upload = client.uploadAsset("music.mp3", bytes);
  for (
    let attempt = 0;
    attempt < 100 && !socket.sent.some((message) => message.type === "asset-commit");
    attempt += 1
  ) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.equal(chunks, 3);
  assert.equal(yieldedBetweenChunks, true);
  const begin = socket.sent.find((message) => message.type === "asset-begin");
  const hash = await sha256Hex(bytes);
  socket.emit("message", {
    data: JSON.stringify({
      type: "asset-accepted",
      asset: { name: "music.mp3", hash, size: bytes.length, mime: "audio/mpeg" },
    }),
  });
  assert.equal(begin.name, "music.mp3");
  assert.equal(await upload, hash);
  client.dispose();
});
