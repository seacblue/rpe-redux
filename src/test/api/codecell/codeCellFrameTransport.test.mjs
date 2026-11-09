/** Code Cell frame route: bridge forwarding, raw image response, and JSON mode. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../../..", import.meta.url));
const binary =
  process.env.REDUX_SERVER_BIN ??
  join(
    root,
    "src-tauri",
    "resources",
    process.platform === "win32" ? "redux-service.exe" : "redux-service",
  );

const pngBase64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const pngBytes = Buffer.from(pngBase64, "base64");

function startServer() {
  const scratch = join(root, ".scratch");
  mkdirSync(scratch, { recursive: true });
  const directory = mkdtempSync(join(scratch, "codecell-frame-"));
  const child = spawn(
    binary,
    ["--port", "0", "--db", join(directory, "redux.db"), "--collab-port", "0", "--ai-port", "0"],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  return new Promise((resolve, reject) => {
    let buffer = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      buffer += chunk;
      if (!buffer.includes("\n")) {
        return;
      }
      try {
        resolve({ child, ready: JSON.parse(buffer.split("\n")[0]) });
      } catch (error) {
        reject(error);
      }
    });
    child.once("error", reject);
    child.once("exit", (code) => reject(new Error(`sidecar exited early: ${code}`)));
  });
}

function frameValue(overrides = {}) {
  return {
    seconds: 2,
    beat: [2, 0, 1],
    beatValue: 2,
    width: 320,
    height: 180,
    format: "png",
    mimeType: "image/png",
    quality: 0.92,
    dataUrl: `data:image/png;base64,${pngBase64}`,
    byteLength: pngBytes.length,
    chartFingerprint: "chart-1",
    ...overrides,
  };
}

function openBridge(aiPort, token) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${aiPort}/api/cell/bridge?token=${token}`);
    socket.addEventListener("open", () => resolve(socket), { once: true });
    socket.addEventListener("error", () => reject(new Error("bridge rejected")), { once: true });
  });
}

function nextFrameRequest(socket) {
  return new Promise((resolve) => {
    const listener = (event) => {
      if (typeof event.data !== "string") {
        return;
      }
      const message = JSON.parse(event.data);
      if (message.type !== "request" || message.request?.method !== "cell.frame") {
        return;
      }
      socket.removeEventListener("message", listener);
      resolve(message);
    };
    socket.addEventListener("message", listener);
  });
}

test(
  "Code Cell frame route returns the rendered image and metadata",
  { skip: !existsSync(binary), timeout: 20_000 },
  async () => {
    const { child, ready } = await startServer();
    const base = `http://127.0.0.1:${ready.aiPort}`;
    let socket = null;
    try {
      const endpoint = await fetch(`${base}/api/cell/endpoint`);
      const endpointBody = await endpoint.json();
      const endpointFile = JSON.parse(readFileSync(endpointBody.path, "utf8"));
      socket = await openBridge(ready.aiPort, endpointFile.token);

      const pendingRequest = nextFrameRequest(socket);
      const responsePromise = fetch(`${base}/api/cell/frame`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ beat: [2, 0, 1], width: 320, height: 180 }),
      });
      const request = await pendingRequest;
      assert.deepEqual(request.request.params, { beat: [2, 0, 1], width: 320, height: 180 });
      socket.send(
        JSON.stringify({
          type: "response",
          id: request.id,
          response: { ok: true, value: frameValue(), revisions: null },
        }),
      );
      const response = await responsePromise;
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("content-type"), "image/png");
      assert.equal(response.headers.get("x-redux-frame-seconds"), "2");
      assert.equal(response.headers.get("x-redux-frame-beat"), "2");
      assert.equal(response.headers.get("x-redux-chart-fingerprint"), "chart-1");
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), pngBytes);

      const jsonRequest = nextFrameRequest(socket);
      const jsonPromise = fetch(`${base}/api/cell/frame`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ seconds: 2 }),
      });
      const secondRequest = await jsonRequest;
      socket.send(
        JSON.stringify({
          type: "response",
          id: secondRequest.id,
          response: { ok: true, value: frameValue(), revisions: null },
        }),
      );
      const jsonResponse = await jsonPromise;
      assert.equal(jsonResponse.status, 200);
      const body = await jsonResponse.json();
      assert.equal(body.ok, true);
      assert.equal(body.value.dataUrl, `data:image/png;base64,${pngBase64}`);
    } finally {
      socket?.close();
      child.kill();
    }
  },
);

test(
  "Code Cell frame route maps renderer errors to HTTP status",
  { skip: !existsSync(binary), timeout: 20_000 },
  async () => {
    const { child, ready } = await startServer();
    const base = `http://127.0.0.1:${ready.aiPort}`;
    let socket = null;
    try {
      const endpoint = await fetch(`${base}/api/cell/endpoint`);
      const endpointBody = await endpoint.json();
      const endpointFile = JSON.parse(readFileSync(endpointBody.path, "utf8"));
      socket = await openBridge(ready.aiPort, endpointFile.token);

      const pendingRequest = nextFrameRequest(socket);
      const responsePromise = fetch(`${base}/api/cell/frame`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ seconds: 1 }),
      });
      const request = await pendingRequest;
      socket.send(
        JSON.stringify({
          type: "response",
          id: request.id,
          response: {
            ok: false,
            error: { code: "disabled", message: "Code execution is unavailable" },
            revisions: null,
          },
        }),
      );
      const response = await responsePromise;
      assert.equal(response.status, 403);
      const body = await response.json();
      assert.equal(body.ok, false);
      assert.equal(body.error.code, "disabled");
    } finally {
      socket?.close();
      child.kill();
    }
  },
);
