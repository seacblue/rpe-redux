/** Handshake, origin, rate-limit, and backpressure parity for the standalone room server. */
import assert from "node:assert/strict";
import test from "node:test";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { connect as connectTcp } from "node:net";

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

async function startServer() {
  const child = spawn(process.execPath, ["scripts/collaborationServer.mjs", "--port", "0"], {
    cwd: process.cwd(),
    stdio: ["ignore", "pipe", "pipe"],
  });
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
  const port = Number(/"port":(\d+)/.exec(ready)?.[1]);
  assert.ok(Number.isInteger(port) && port > 0, "server did not report a port");
  return { child, port, url: `ws://127.0.0.1:${port}/rooms` };
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

/** Encode one masked client text frame. */
function clientFrame(value) {
  const payload = Buffer.from(JSON.stringify(value), "utf8");
  let header;
  if (payload.length < 126) {
    header = Buffer.from([0x81, 0x80 | payload.length]);
  } else if (payload.length < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 0x80 | 126;
    header.writeUInt16BE(payload.length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 0x80 | 127;
    header.writeBigUInt64BE(BigInt(payload.length), 2);
  }
  const mask = randomBytes(4);
  const body = Buffer.alloc(payload.length);
  for (let index = 0; index < payload.length; index++) {
    body[index] = payload[index] ^ mask[index % 4];
  }
  return Buffer.concat([header, mask, body]);
}

/** Minimal raw WebSocket client used to pause a peer and observe a dropped slow consumer. */
class RawRoomClient {
  constructor(port) {
    this.socket = connectTcp({ host: "127.0.0.1", port });
    this.buffer = Buffer.alloc(0);
    this.frames = [];
    this.waiters = [];
    this.headerDone = false;
    this.headerStatus = 0;
    this.headerResolve = null;
    this.headerReject = null;
    this.socket.on("data", (chunk) => this.receive(chunk));
    this.socket.on("error", (error) => this.fail(error));
    this.socket.on("close", () => this.fail(new Error("socket closed")));
  }

  async open() {
    await once(this.socket, "connect");
    const key = randomBytes(16).toString("base64");
    this.socket.write(
      "GET /rooms HTTP/1.1\r\n" +
        "Host: 127.0.0.1\r\n" +
        "Upgrade: websocket\r\n" +
        "Connection: Upgrade\r\n" +
        `Sec-WebSocket-Key: ${key}\r\n` +
        "Sec-WebSocket-Version: 13\r\n\r\n",
    );
    await new Promise((resolve, reject) => {
      this.headerResolve = resolve;
      this.headerReject = reject;
    });
    assert.equal(this.headerStatus, 101, "raw client did not upgrade");
  }

  send(value) {
    this.socket.write(clientFrame(value));
  }

  next() {
    if (this.frames.length > 0) {
      return Promise.resolve(this.frames.shift());
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("timed out waiting for raw message")), 5000);
      this.waiters.push({ resolve, reject, timer });
    });
  }

  receive(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    if (!this.headerDone) {
      const end = this.buffer.indexOf("\r\n\r\n");
      if (end < 0) {
        return;
      }
      const header = this.buffer.subarray(0, end).toString("utf8");
      this.headerStatus = Number(header.split(" ")[1]);
      this.buffer = this.buffer.subarray(end + 4);
      this.headerDone = true;
      const resolve = this.headerResolve;
      this.headerResolve = null;
      this.headerReject = null;
      resolve?.();
    }
    this.parseFrames();
  }

  parseFrames() {
    for (;;) {
      if (this.buffer.length < 2) {
        return;
      }
      const opcode = this.buffer[0] & 0x0f;
      let length = this.buffer[1] & 0x7f;
      let offset = 2;
      if (length === 126) {
        if (this.buffer.length < 4) {
          return;
        }
        length = this.buffer.readUInt16BE(2);
        offset = 4;
      } else if (length === 127) {
        if (this.buffer.length < 10) {
          return;
        }
        length = Number(this.buffer.readBigUInt64BE(2));
        offset = 10;
      }
      if (this.buffer.length < offset + length) {
        return;
      }
      const payload = this.buffer.subarray(offset, offset + length);
      this.buffer = this.buffer.subarray(offset + length);
      if (opcode !== 0x1) {
        continue;
      }
      const message = JSON.parse(payload.toString("utf8"));
      const waiter = this.waiters.shift();
      if (waiter) {
        clearTimeout(waiter.timer);
        waiter.resolve(message);
      } else {
        this.frames.push(message);
      }
    }
  }

  fail(error) {
    if (this.headerReject) {
      const reject = this.headerReject;
      this.headerResolve = null;
      this.headerReject = null;
      reject(error);
    }
    for (const waiter of this.waiters.splice(0)) {
      clearTimeout(waiter.timer);
      waiter.reject(error);
    }
  }

  close() {
    this.socket.destroy();
  }
}

test("joins, resumes, and previews require the same product version", async () => {
  const running = await startServer();
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
        appVersion: "1.0.9",
      }),
    );
    const joinRejected = await guest.next();
    assert.equal(joinRejected.type, "rejected");
    assert.equal(joinRejected.reason, "version_mismatch_client_newer");

    guest.socket.send(
      JSON.stringify({
        type: "inspect-room",
        roomId: welcome.roomId,
        invite: welcome.invite,
        appVersion: "1.0.9",
      }),
    );
    const previewRejected = await guest.next();
    assert.equal(previewRejected.type, "rejected");
    assert.equal(previewRejected.reason, "version_mismatch_client_newer");

    const resume = await open(running.url);
    resume.socket.send(
      JSON.stringify({
        type: "resume",
        roomId: welcome.roomId,
        token: welcome.resumeToken,
        appVersion: "1.0.6",
      }),
    );
    const resumeRejected = await resume.next();
    assert.equal(resumeRejected.type, "rejected");
    assert.equal(resumeRejected.reason, "version_mismatch_client_older");
    resume.socket.close();

    guest.socket.send(
      JSON.stringify({
        type: "join",
        roomId: welcome.roomId,
        invite: welcome.invite,
        profile: { name: "Guest", color: "#00ff00" },
        appVersion: "1.0.7",
      }),
    );
    assert.equal((await guest.next()).type, "welcome");
    guest.socket.close();
    host.socket.close();
  } finally {
    await stopServer(running);
  }
});

test("upgrade origin policy accepts desktop and loopback origins and rejects web pages", async () => {
  const running = await startServer();
  try {
    const accepted = [
      undefined,
      "tauri://localhost",
      "http://tauri.localhost",
      "http://127.0.0.1:4173",
      "https://localhost",
      "http://[::1]:5173",
    ];
    for (const origin of accepted) {
      assert.equal(await upgradeStatus(running.port, origin), 101, `origin ${origin}`);
    }
    const rejected = ["https://example.com", "http://192.168.1.20:4173", "file://", "null"];
    for (const origin of rejected) {
      assert.equal(await upgradeStatus(running.port, origin), 403, `origin ${origin}`);
    }
  } finally {
    await stopServer(running);
  }
});

test("upgrade attempts above the per-client window are rejected", async () => {
  const running = await startServer();
  try {
    const headers = { "X-Forwarded-For": "198.51.100.7" };
    for (let attempt = 0; attempt < 30; attempt++) {
      assert.equal(
        await upgradeStatus(running.port, undefined, headers),
        101,
        `attempt ${attempt}`,
      );
    }
    assert.equal(await upgradeStatus(running.port, undefined, headers), 429);
    assert.equal(
      await upgradeStatus(running.port, undefined, { "X-Forwarded-For": "198.51.100.8" }),
      101,
      "a different forwarded client keeps its own window",
    );
  } finally {
    await stopServer(running);
  }
});

test("a socket is closed after ten failed join attempts", async () => {
  const running = await startServer();
  try {
    const host = await open(running.url);
    host.socket.send(
      JSON.stringify({
        type: "create",
        profile: { name: "Host", color: "#ffffff" },
        chart: chart(),
        fingerprint: "joins",
      }),
    );
    const welcome = await host.next();
    assert.equal(welcome.type, "welcome");

    const guest = await open(running.url);
    for (let attempt = 0; attempt < 10; attempt++) {
      guest.socket.send(
        JSON.stringify({
          type: "join",
          roomId: welcome.roomId,
          invite: "wrong-password",
          profile: { name: "Guest", color: "#00ff00" },
        }),
      );
      const rejected = await guest.next();
      assert.equal(rejected.type, "rejected");
      assert.equal(rejected.reason, "bad_invite");
    }
    guest.socket.send(
      JSON.stringify({
        type: "join",
        roomId: welcome.roomId,
        invite: welcome.invite,
        profile: { name: "Guest", color: "#00ff00" },
      }),
    );
    const blocked = await guest.next();
    assert.equal(blocked.type, "error");
    assert.equal(blocked.code, "too_many_joins");
    guest.socket.close();
    host.socket.close();
  } finally {
    await stopServer(running);
  }
});

test("a paused client cannot stall broadcasts and is dropped when its queue fills", async () => {
  const running = await startServer();
  try {
    const host = await open(running.url);
    host.socket.send(
      JSON.stringify({
        type: "create",
        profile: { name: "Host", color: "#ffffff" },
        chart: chart(),
        fingerprint: "slow",
        autoApproveEditor: true,
      }),
    );
    const hostWelcome = await host.next();
    assert.equal(hostWelcome.type, "welcome");

    const fast = await open(running.url);
    fast.socket.send(
      JSON.stringify({
        type: "join",
        roomId: hostWelcome.roomId,
        invite: hostWelcome.invite,
        profile: { name: "Fast", color: "#00ff00" },
      }),
    );
    const fastWelcome = await fast.next();
    assert.equal(fastWelcome.type, "welcome");

    const slow = new RawRoomClient(running.port);
    await slow.open();
    slow.send({
      type: "join",
      roomId: hostWelcome.roomId,
      invite: hostWelcome.invite,
      profile: { name: "Slow", color: "#0000ff" },
    });
    assert.equal((await slow.next()).type, "welcome");
    slow.socket.pause();

    const marker = "x".repeat(3 * 1024 * 1024);
    let dropped = false;
    for (let index = 0; index < 12 && !dropped; index++) {
      host.socket.send(
        JSON.stringify({
          type: "presence",
          presence: { memberId: "ignored", area: "edit", updatedAt: index + 1, marker },
        }),
      );
      for (let attempt = 0; attempt < 20; attempt++) {
        const message = await fast.next();
        if (
          message.type === "members" &&
          message.members.some(
            (member) => member.profile.name === "Slow" && member.online === false,
          )
        ) {
          dropped = true;
          break;
        }
        if (message.type === "presence") {
          break;
        }
      }
    }
    assert.equal(dropped, true, "slow client was not disconnected");

    host.socket.send(
      JSON.stringify({
        type: "transaction",
        transactionId: "slow-test",
        baseRevision: 0,
        label: "after slow drop",
        changes: [{ op: "set", path: "/META/name", before: "base", after: "after-slow" }],
        affectedObjectIds: [],
      }),
    );
    const committed = await nextType(fast, "committed");
    assert.equal(committed.revision, 1);
    assert.equal(committed.label, "after slow drop");
    slow.close();
    fast.socket.close();
    host.socket.close();
  } finally {
    await stopServer(running);
  }
});
