/** Code Cell loopback routes and endpoint discovery. */
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

function startServer() {
  const scratch = join(root, ".scratch");
  mkdirSync(scratch, { recursive: true });
  const directory = mkdtempSync(join(scratch, "codecell-transport-"));
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
        resolve({ child, ready: JSON.parse(buffer.split("\n")[0]), directory });
      } catch (error) {
        reject(error);
      }
    });
    child.once("error", reject);
    child.once("exit", (code) => reject(new Error(`sidecar exited early: ${code}`)));
  });
}

test(
  "Code Cell transport exposes the endpoint and bridge routes",
  { skip: !existsSync(binary), timeout: 20_000 },
  async () => {
    const { child, ready } = await startServer();
    try {
      const endpoint = await fetch(`http://127.0.0.1:${ready.aiPort}/api/cell/endpoint`);
      assert.equal(endpoint.status, 200);
      const endpointBody = await endpoint.json();
      assert.equal(endpointBody.bridge, "/api/cell/bridge");
      const endpointFile = JSON.parse(readFileSync(endpointBody.path, "utf8"));
      assert.equal(typeof endpointFile.token, "string");

      const guide = await fetch(`http://127.0.0.1:${ready.aiPort}/api/cell/guide`);
      assert.equal(guide.status, 503);

      await assert.rejects(
        new Promise((resolve, reject) => {
          const socket = new WebSocket(
            `ws://127.0.0.1:${ready.aiPort}/api/cell/bridge?token=wrong`,
          );
          socket.addEventListener("open", () => resolve(socket), { once: true });
          socket.addEventListener("error", () => reject(new Error("bridge rejected")), {
            once: true,
          });
        }),
        /bridge rejected/,
      );
    } finally {
      child.kill();
    }
  },
);
