/**
 * Worktree-local development ports.
 *
 * The browser and desktop development loops keep one fixed port set per
 * checkout in `.scratch/dev/ports.json`, so parallel checkouts never fight over
 * the backend address. The first run chooses four free ports below the Windows
 * ephemeral range; later runs reuse them. Deleting the file, or passing
 * `--new-ports`, selects a fresh set.
 */
import { randomInt } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { dirname, join } from "node:path";

/** First random port; below the Windows ephemeral range. */
const FIRST_PORT = 42000;
/** Last random port; below the Windows ephemeral range. */
const LAST_PORT = 48999;
/** Product defaults that a development loop must not take over. */
const RESERVED_PORTS = new Set([4173, 4174, 47821, 47822, 47830]);
/** The four ports one checkout owns. */
const PORT_KEYS = ["frontendPort", "backendPort", "aiPort", "collabPort"];

/** The port record shared by the development scripts. */
export const DEV_PORTS_VERSION = 1;

/** Absolute path of the worktree's development port record. */
export function devPortsPath(root) {
  return join(root, ".scratch", "dev", "ports.json");
}

/** True when `value` is a usable TCP port. */
function isPort(value) {
  return Number.isInteger(value) && value >= 1 && value <= 65535;
}

/** Normalize one persisted or caller-supplied record, or return null. */
function normalizePorts(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value;
  const ports = {};
  for (const key of PORT_KEYS) {
    if (!isPort(record[key])) {
      return null;
    }
    ports[key] = record[key];
  }
  if (new Set(PORT_KEYS.map((key) => ports[key])).size !== PORT_KEYS.length) {
    return null;
  }
  return { version: DEV_PORTS_VERSION, ...ports };
}

/** Read the port record; a missing or malformed file resolves to null. */
async function readPorts(path) {
  try {
    return normalizePorts(JSON.parse(await readFile(path, "utf8")));
  } catch {
    return null;
  }
}

/** Write the port record in a stable, reviewable shape. */
async function writePorts(path, ports) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(ports, null, 2)}\n`, "utf8");
}

/** Whether one loopback port can be bound right now. */
function portFree(port) {
  return new Promise((resolve) => {
    const server = createServer();
    server.unref();
    server.once("error", () => resolve(false));
    server.listen({ port, host: "127.0.0.1", exclusive: true }, () => {
      server.close(() => resolve(true));
    });
  });
}

/** The keys whose ports are already bound by another process. */
async function busyPorts(ports) {
  const checks = await Promise.all(
    PORT_KEYS.map(async (key) => ({ key, free: await portFree(ports[key]) })),
  );
  return checks.filter(({ free }) => !free).map(({ key }) => `${key}=${ports[key]}`);
}

/** Choose one free random port that is not reserved or already taken. */
async function nextFreePort(taken) {
  for (let attempt = 0; attempt < 256; attempt += 1) {
    const port = randomInt(FIRST_PORT, LAST_PORT + 1);
    if (RESERVED_PORTS.has(port) || taken.has(port)) {
      continue;
    }
    if (await portFree(port)) {
      return port;
    }
  }
  throw new Error(`Could not find a free development port between ${FIRST_PORT} and ${LAST_PORT}.`);
}

/**
 * Read the checkout's port record, creating or extending it when needed.
 *
 * @param {string} root Repository root.
 * @param {{ overrides?: Partial<Record<string, number>>, fresh?: boolean }} options
 *   `overrides` pins one or more named ports; `fresh` ignores the stored record.
 * @returns {Promise<{ version: number, frontendPort: number, backendPort: number, aiPort: number, collabPort: number }>}
 */
export async function loadOrCreateDevPorts(root, { overrides = {}, fresh = false } = {}) {
  const path = devPortsPath(root);
  const requested = {};
  for (const key of PORT_KEYS) {
    const value = overrides[key];
    if (value === undefined) {
      continue;
    }
    if (!isPort(value)) {
      throw new Error(`${key} must be an integer between 1 and 65535.`);
    }
    requested[key] = value;
  }

  const stored = fresh ? null : await readPorts(path);
  const merged = { ...(stored ?? {}), ...requested };
  const missing = PORT_KEYS.filter((key) => !isPort(merged[key]));
  if (missing.length) {
    const taken = new Set(PORT_KEYS.map((key) => merged[key]).filter(isPort));
    for (const key of missing) {
      const port = await nextFreePort(taken);
      merged[key] = port;
      taken.add(port);
    }
  }

  const ports = normalizePorts(merged);
  if (!ports) {
    throw new Error("Development ports must be four distinct values between 1 and 65535.");
  }
  if (stored && !fresh && Object.keys(requested).length === 0) {
    const busy = await busyPorts(ports);
    if (busy.length) {
      throw new Error(
        `Development ports are already in use (${busy.join(", ")}). Another development server is probably running in this worktree; stop it or run with --new-ports.`,
      );
    }
    return ports;
  }

  const busy = await busyPorts(ports);
  if (busy.length) {
    throw new Error(
      `Requested development ports are already in use (${busy.join(", ")}). Choose different ports or run with --new-ports.`,
    );
  }
  await writePorts(path, ports);
  return ports;
}
