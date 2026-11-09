/** End-to-end room protocol over the standalone WebSocket server. */
import assert from "node:assert/strict";
import test from "node:test";
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { connect as connectTcp } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createRoomKey,
  decryptJson,
  encryptJson,
  importRoomKey,
} from "../../../core/collaboration/e2e.ts";

function chart(name = "base") {
  return {
    META: { name },
    BPMList: [{ beat: [0, 0, 1], bpm: 120 }],
    judgeLineList: [{ id: "line", notes: [{ id: "note", positionX: 1 }], eventLayers: [] }],
  };
}

function connect(url) {
  const socket = new WebSocket(url);
  const queue = [];
  const waiters = [];
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    const waiter = waiters.shift();
    if (waiter) {
      waiter(message);
    } else {
      queue.push(message);
    }
  });
  const next = () =>
    queue.length
      ? Promise.resolve(queue.shift())
      : new Promise((resolve, reject) => {
          const timer = setTimeout(
            () => reject(new Error("timed out waiting for room message")),
            10000,
          );
          waiters.push((message) => {
            clearTimeout(timer);
            resolve(message);
          });
        });
  return { socket, next };
}

async function open(url) {
  const connection = connect(url);
  if (connection.socket.readyState !== WebSocket.OPEN) {
    await once(connection.socket, "open");
  }
  return connection;
}

async function nextType(connection, type) {
  for (let attempt = 0; attempt < 12; attempt++) {
    const message = await connection.next();
    if (message.type === type) {
      return message;
    }
  }
  throw new Error(`did not receive ${type}`);
}

async function startServer(port, dataDir = "", env = {}) {
  const child = spawn(
    process.execPath,
    [
      "scripts/collaborationServer.mjs",
      "--port",
      String(port),
      ...(dataDir ? ["--data", dataDir] : []),
    ],
    { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, ...env } },
  );
  let ready = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    ready += chunk;
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  const deadline = Date.now() + 15000;
  while (!ready.includes('"listening"') && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.match(ready, /"listening"/, `server did not start: ${stderr}`);
  const actualPort = Number(/"port":(\d+)/.exec(ready)?.[1] ?? port);
  return { child, port: actualPort, url: `ws://127.0.0.1:${actualPort}/rooms` };
}

async function stopServer(running) {
  running.child.kill();
  await new Promise((resolve) => setTimeout(resolve, 100));
}

/** Return the HTTP status of one raw WebSocket upgrade attempt. */
function upgradeStatus(port, origin, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const socket = connectTcp({ host: "127.0.0.1", port });
    let response = "";
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error("upgrade response timed out"));
    }, 5000);
    const finish = (status) => {
      clearTimeout(timer);
      socket.destroy();
      resolve(status);
    };
    socket.setEncoding("utf8");
    socket.on("connect", () => {
      const key = randomBytes(16).toString("base64");
      socket.write(
        "GET /rooms HTTP/1.1\r\n" +
          `Host: 127.0.0.1:${port}\r\n` +
          "Upgrade: websocket\r\n" +
          "Connection: Upgrade\r\n" +
          `Sec-WebSocket-Key: ${key}\r\n` +
          "Sec-WebSocket-Version: 13\r\n" +
          (origin === undefined ? "" : `Origin: ${origin}\r\n`) +
          Object.entries(extraHeaders)
            .map(([name, value]) => `${name}: ${value}\r\n`)
            .join("") +
          "\r\n",
      );
    });
    socket.on("data", (chunk) => {
      response += chunk;
      if (response.includes("\r\n\r\n")) {
        finish(Number(response.split(" ")[1]));
      }
    });
    socket.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

/** Resolve with the WebSocket close event. */
function closed(socket) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("socket was not closed")), 5000);
    socket.addEventListener(
      "close",
      (event) => {
        clearTimeout(timer);
        resolve(event);
      },
      { once: true },
    );
  });
}

test("a host and an approved editor exchange a transaction and a conflict", async () => {
  const child = spawn(process.execPath, ["scripts/collaborationServer.mjs", "--port", "0"], {
    cwd: process.cwd(),
    stdio: ["ignore", "pipe", "pipe"],
  });
  try {
    let ready = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      ready += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    const deadline = Date.now() + 15000;
    while (!ready.includes('"listening"') && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    assert.match(ready, /"listening"/, `server did not start: ${stderr}`);
    const actualPort = Number(/"port":(\d+)/.exec(ready)?.[1]);
    assert.ok(Number.isInteger(actualPort) && actualPort > 0, "server did not report a port");
    const url = `ws://127.0.0.1:${actualPort}/rooms`;
    const host = await open(url);
    host.socket.send(
      JSON.stringify({
        type: "create",
        profile: { name: "Host", color: "#ffffff" },
        chart: chart(),
        fingerprint: "base",
      }),
    );
    const hostWelcome = await host.next();
    assert.equal(hostWelcome.type, "welcome");
    assert.equal(hostWelcome.role, "host");
    assert.equal(hostWelcome.chart, undefined);

    const guest = await open(url);
    guest.socket.send(
      JSON.stringify({
        type: "join",
        roomId: hostWelcome.roomId,
        invite: hostWelcome.invite,
        profile: { name: "Guest", color: "#00ff00" },
      }),
    );
    assert.equal((await guest.next()).type, "waiting");
    const pending = await host.next();
    assert.equal(pending.type, "pending");
    host.socket.send(
      JSON.stringify({
        type: "approve",
        requestId: pending.requestId,
        allow: true,
        role: "editor",
      }),
    );
    const guestWelcome = await guest.next();
    assert.equal(guestWelcome.type, "welcome");
    assert.deepEqual(guestWelcome.chart, chart());
    assert.equal(guestWelcome.role, "editor");
    assert.equal((await host.next()).type, "pending-cleared");
    assert.equal((await host.next()).type, "members");

    guest.socket.send(
      JSON.stringify({
        type: "transaction",
        transactionId: "edit-1",
        baseRevision: 0,
        label: "rename",
        changes: [{ op: "set", path: "/META/name", before: "base", after: "guest" }],
        affectedObjectIds: [],
      }),
    );
    const committed = await guest.next();
    assert.equal(committed.type, "committed");
    assert.equal(committed.revision, 1);
    assert.equal((await host.next()).type, "committed");

    host.socket.send(
      JSON.stringify({
        type: "transaction",
        transactionId: "edit-2",
        baseRevision: 0,
        label: "stale rename",
        changes: [{ op: "set", path: "/META/name", before: "base", after: "host" }],
        affectedObjectIds: [],
      }),
    );
    const conflict = await host.next();
    assert.equal(conflict.type, "conflict");
    assert.deepEqual(conflict.paths, ["/META/name"]);

    guest.socket.send(
      JSON.stringify({
        type: "presence",
        presence: { memberId: "ignored", area: "edit", beat: 4, updatedAt: 1 },
      }),
    );
    const presence = await host.next();
    assert.equal(presence.type, "presence");
    assert.equal(presence.presence.beat, 4);

    guest.socket.send(
      JSON.stringify({
        type: "transaction",
        transactionId: "undo-1",
        baseRevision: 1,
        label: "undo rename",
        changes: [{ op: "set", path: "/META/name", before: "guest", after: "base" }],
        affectedObjectIds: [],
        undoOf: "edit-1",
      }),
    );
    const undone = await guest.next();
    assert.equal(undone.type, "committed");
    assert.equal(undone.undoOf, "edit-1");
    assert.equal((await host.next()).type, "committed");

    guest.socket.send(
      JSON.stringify({
        type: "transaction",
        transactionId: "undo-2",
        baseRevision: 2,
        label: "undo rename again",
        changes: [{ op: "set", path: "/META/name", before: "base", after: "guest" }],
        affectedObjectIds: [],
        undoOf: "edit-1",
      }),
    );
    const duplicate = await guest.next();
    assert.equal(duplicate.type, "error");
    assert.equal(duplicate.code, "already_undone");

    const bytes = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.from("content-addressed-payload"),
    ]);
    const hash = createHash("sha256").update(bytes).digest("hex");
    host.socket.send(
      JSON.stringify({
        type: "asset-begin",
        requestId: "asset-1",
        name: "cover.png",
        hash,
        size: bytes.length,
        mime: "image/png",
      }),
    );
    host.socket.send(
      JSON.stringify({
        type: "asset-chunk",
        requestId: "asset-1",
        index: 0,
        data: bytes.toString("base64"),
      }),
    );
    host.socket.send(JSON.stringify({ type: "asset-commit", requestId: "asset-1" }));
    const accepted = await guest.next();
    assert.equal(accepted.type, "asset-accepted");
    assert.equal(accepted.asset.hash, hash);
    assert.equal((await host.next()).type, "asset-accepted");
    assert.equal((await guest.next()).type, "asset-manifest");
    assert.equal((await host.next()).type, "asset-manifest");

    guest.socket.send(JSON.stringify({ type: "asset-request", requestId: "download-1", hash }));
    const begin = await guest.next();
    assert.equal(begin.type, "asset-download-begin");
    assert.equal(begin.asset.hash, hash);
    let received = Buffer.alloc(0);
    for (;;) {
      const next = await guest.next();
      if (next.type === "asset-download-end") {
        break;
      }
      assert.equal(next.type, "asset-download-chunk");
      received = Buffer.concat([received, Buffer.from(next.data, "base64")]);
    }
    assert.equal(createHash("sha256").update(received).digest("hex"), hash);

    guest.socket.close();
    host.socket.close();
  } finally {
    child.kill();
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
});

test("room state and verified assets survive a server restart", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "redux-collab-"));
  let running = await startServer(0, dataDir);
  try {
    const host = await open(running.url);
    host.socket.send(
      JSON.stringify({
        type: "create",
        profile: { name: "Host", color: "#ffffff" },
        chart: chart("persisted"),
        fingerprint: "persisted",
      }),
    );
    const welcome = await host.next();
    assert.equal(welcome.type, "welcome");
    const bytes = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.from("persisted-asset"),
    ]);
    const hash = createHash("sha256").update(bytes).digest("hex");
    host.socket.send(
      JSON.stringify({
        type: "asset-begin",
        requestId: "persisted-asset",
        name: "cover.png",
        hash,
        size: bytes.length,
        mime: "image/png",
      }),
    );
    host.socket.send(
      JSON.stringify({
        type: "asset-chunk",
        requestId: "persisted-asset",
        index: 0,
        data: bytes.toString("base64"),
      }),
    );
    host.socket.send(JSON.stringify({ type: "asset-commit", requestId: "persisted-asset" }));
    assert.equal((await host.next()).type, "asset-accepted");
    await new Promise((resolve) => setTimeout(resolve, 300));
    host.socket.close();
    running.child.kill();
    await once(running.child, "exit");

    running = await startServer(0, dataDir);
    const resumed = await open(running.url);
    resumed.socket.send(
      JSON.stringify({
        type: "resume",
        roomId: welcome.roomId,
        token: welcome.resumeToken,
      }),
    );
    const restored = await resumed.next();
    assert.equal(restored.type, "welcome");
    assert.equal(restored.assets.length, 1);
    assert.equal(restored.assets[0].hash, hash);
    assert.equal(restored.chart.META.name, "persisted");
    resumed.socket.close();
  } finally {
    running.child.kill();
    await new Promise((resolve) => setTimeout(resolve, 100));
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test("standalone server relays encrypted transactions and requires leases", async () => {
  const running = await startServer(0);
  const encoded = createRoomKey();
  const key = await importRoomKey(encoded);
  const payload = await encryptJson(key, chart("base"));
  try {
    const host = await open(running.url);
    host.socket.send(
      JSON.stringify({
        type: "create",
        profile: { name: "Host", color: "#ffffff" },
        chart: payload,
        fingerprint: "",
        encrypted: true,
      }),
    );
    const welcome = await nextType(host, "welcome");
    assert.equal(welcome.encrypted, true);
    assert.equal(welcome.chart, undefined);
    assert.deepEqual(welcome.transactions, []);

    const guest = await open(running.url);
    guest.socket.send(
      JSON.stringify({
        type: "join",
        roomId: welcome.roomId,
        invite: welcome.invite,
        profile: { name: "Guest", color: "#00ff00" },
      }),
    );
    assert.equal((await nextType(guest, "waiting")).type, "waiting");
    const pending = await nextType(host, "pending");
    host.socket.send(
      JSON.stringify({
        type: "approve",
        requestId: pending.requestId,
        allow: true,
        role: "editor",
      }),
    );
    await nextType(host, "pending-cleared");
    const guestWelcome = await nextType(guest, "welcome");
    assert.equal(guestWelcome.encrypted, true);
    assert.deepEqual(await decryptJson(key, guestWelcome.chart), chart("base"));

    host.socket.send(
      JSON.stringify({ type: "lock-request", requestId: "lock", ids: ["chart"], ttlMs: 15000 }),
    );
    assert.equal((await nextType(host, "lock-result")).granted, true);
    const encryptedChanges = await encryptJson(key, [
      { op: "set", path: "/META/name", before: "base", after: "next" },
    ]);
    host.socket.send(
      JSON.stringify({
        type: "transaction",
        transactionId: "tx",
        baseRevision: 0,
        label: "rename",
        changes: encryptedChanges,
        affectedObjectIds: [],
        lockIds: ["chart"],
      }),
    );
    const committed = await nextType(guest, "committed");
    assert.equal(committed.changes.v, 1);
    const decoded = await decryptJson(key, committed.changes);
    assert.equal(decoded[0].after, "next");
  } finally {
    running.child.kill();
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
});

test("a retry is acknowledged once and the host can close the room", async () => {
  const running = await startServer(0);
  try {
    const host = await open(running.url);
    host.socket.send(
      JSON.stringify({
        type: "create",
        profile: { name: "Host", color: "#ffffff" },
        chart: chart(),
        fingerprint: "close",
        autoApproveEditor: true,
      }),
    );
    const welcome = await host.next();
    assert.equal(welcome.type, "welcome");
    const guest = await open(running.url);
    guest.socket.send(
      JSON.stringify({
        type: "join",
        roomId: welcome.roomId,
        invite: welcome.invite,
        profile: { name: "Guest", color: "#00ff00" },
      }),
    );
    assert.equal((await guest.next()).type, "welcome");
    assert.equal((await host.next()).type, "members");

    const transaction = {
      type: "transaction",
      transactionId: "retry-once",
      label: "rename",
      changes: [{ op: "set", path: "/META/name", before: "base", after: "once" }],
      affectedObjectIds: [],
    };
    guest.socket.send(JSON.stringify(transaction));
    assert.equal((await guest.next()).type, "committed");
    assert.equal((await host.next()).type, "committed");
    guest.socket.send(JSON.stringify(transaction));
    assert.equal((await guest.next()).type, "committed");

    host.socket.send(JSON.stringify({ type: "close-room" }));
    assert.equal((await host.next()).type, "room-closed");
    assert.equal((await guest.next()).type, "room-closed");
    const health = await fetch(`http://127.0.0.1:${new URL(running.url).port}/health`);
    assert.equal((await health.json()).rooms, 0);
  } finally {
    running.child.kill();
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
});

test("the host can only close the room, not leave it", async () => {
  const running = await startServer(0);
  try {
    const host = await open(running.url);
    host.socket.send(
      JSON.stringify({
        type: "create",
        profile: { name: "Host", color: "#ffffff" },
        chart: chart(),
        fingerprint: "host-leave",
      }),
    );
    assert.equal((await host.next()).type, "welcome");

    host.socket.send(JSON.stringify({ type: "leave" }));
    const rejected = await host.next();
    assert.equal(rejected.type, "error");
    assert.equal(rejected.code, "host_must_close");

    host.socket.send(JSON.stringify({ type: "close-room" }));
    assert.equal((await host.next()).type, "room-closed");
  } finally {
    await stopServer(running);
  }
});

test("handshakes need no protocol revision and require the same product version", async () => {
  const running = await startServer(0);
  try {
    const host = await open(running.url);
    host.socket.send(
      JSON.stringify({
        type: "create",
        profile: { name: "Host", color: "#ffffff" },
        chart: chart(),
        fingerprint: "version",
        appVersion: "1.0.7",
        autoApproveEditor: true,
      }),
    );
    const welcome = await host.next();
    assert.equal(welcome.type, "welcome");
    assert.equal(welcome.protocolVersion, undefined);
    assert.equal(welcome.appVersion, "1.0.7");

    const guest = await open(running.url);
    guest.socket.send(
      JSON.stringify({
        type: "join",
        roomId: welcome.roomId,
        invite: welcome.invite,
        profile: { name: "Guest", color: "#00ff00" },
        appVersion: "1.0.8",
      }),
    );
    const rejected = await guest.next();
    assert.equal(rejected.type, "rejected");
    assert.equal(rejected.reason, "version_mismatch");

    const inspector = await open(running.url);
    inspector.socket.send(
      JSON.stringify({
        type: "inspect-room",
        roomId: welcome.roomId,
        invite: welcome.invite,
        appVersion: "1.0.8",
      }),
    );
    const preview = await inspector.next();
    assert.equal(preview.type, "rejected");
    assert.equal(preview.reason, "version_mismatch");

    host.socket.close();
    guest.socket.close();
    inspector.socket.close();
  } finally {
    await stopServer(running);
  }
});

test("upgrade origin policy rejects foreign pages and accepts configured origins", async () => {
  const running = await startServer(0);
  try {
    assert.equal(await upgradeStatus(running.port, undefined), 101);
    assert.equal(await upgradeStatus(running.port, "tauri://localhost"), 101);
    assert.equal(await upgradeStatus(running.port, "http://127.0.0.1:4173"), 101);
    assert.equal(await upgradeStatus(running.port, "https://example.com"), 403);
    assert.equal(await upgradeStatus(running.port, "http://192.168.1.20:4173"), 403);
    assert.equal(await upgradeStatus(running.port, "null"), 403);
  } finally {
    await stopServer(running);
  }

  const configured = await startServer(0, "", {
    REDUX_COLLAB_ALLOWED_ORIGINS: "https://rooms.example.com",
  });
  try {
    assert.equal(await upgradeStatus(configured.port, "https://rooms.example.com"), 101);
    assert.equal(await upgradeStatus(configured.port, "https://other.example.com"), 403);
  } finally {
    await stopServer(configured);
  }
});

test("a client above the message-rate budget is disconnected", async () => {
  const running = await startServer(0, "", {
    REDUX_COLLAB_MESSAGE_LIMIT: "3",
    REDUX_COLLAB_MESSAGE_WINDOW_MS: "60000",
  });
  try {
    const client = await open(running.url);
    const close = closed(client.socket);
    client.socket.send(
      JSON.stringify({
        type: "create",
        profile: { name: "Host", color: "#ffffff" },
        chart: chart(),
        fingerprint: "messages",
      }),
    );
    assert.equal((await client.next()).type, "welcome");
    client.socket.send(JSON.stringify({ type: "ping" }));
    assert.equal((await client.next()).type, "pong");
    client.socket.send(JSON.stringify({ type: "ping" }));
    assert.equal((await client.next()).type, "pong");
    client.socket.send(JSON.stringify({ type: "ping" }));
    const limited = await client.next();
    assert.equal(limited.type, "error");
    assert.equal(limited.code, "rate_limited");
    await close;
  } finally {
    await stopServer(running);
  }
});
