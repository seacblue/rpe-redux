/** Pins the worktree-local development port record used by the browser and desktop loops. */
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { devPortsPath, loadOrCreateDevPorts } from "../../../scripts/devPorts.mjs";

/** Reserve four distinct loopback ports, then release them for the record. */
async function freePorts() {
  const servers = await Promise.all(
    Array.from({ length: 4 }, () => {
      const server = createServer();
      return new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen({ port: 0, host: "127.0.0.1" }, () => resolve(server));
      });
    }),
  );
  const ports = servers.map((server) => server.address().port);
  await Promise.all(
    servers.map((server) => new Promise((resolve) => server.close(() => resolve(undefined)))),
  );
  return ports;
}

test("development ports persist per checkout and accept pinned values", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "redux-dev-ports-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const [frontendPort, backendPort, aiPort, collabPort] = await freePorts();
  const overrides = { frontendPort, backendPort, aiPort, collabPort };

  const first = await loadOrCreateDevPorts(root, { overrides });
  assert.deepEqual(first, { version: 1, ...overrides });
  assert.deepEqual(JSON.parse(await readFile(devPortsPath(root), "utf8")), first);

  const second = await loadOrCreateDevPorts(root);
  assert.deepEqual(second, first);
});

test("development ports reject duplicates and occupied pins", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "redux-dev-ports-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const [port, backendPort, aiPort, collabPort] = await freePorts();

  await assert.rejects(
    loadOrCreateDevPorts(root, {
      overrides: {
        frontendPort: port,
        backendPort: port,
        aiPort,
        collabPort,
      },
    }),
    /distinct/u,
  );

  const server = createServer();
  await new Promise((resolve) => server.listen({ port, host: "127.0.0.1" }, resolve));
  context.after(() => new Promise((resolve) => server.close(() => resolve(undefined))));
  await assert.rejects(
    loadOrCreateDevPorts(root, {
      overrides: { frontendPort: port, backendPort, aiPort, collabPort },
    }),
    /already in use/u,
  );
});
