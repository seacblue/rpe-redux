/* eslint-disable max-lines -- WebSocket framing, room transport, and asset persistence share one process. */
/**
 * Standalone collaboration room server.
 *
 * It implements the WebSocket transport around the pure room state in
 * `src/core/collaboration/room.ts`. The frontend connects with the native
 * WebSocket client; the server stays authoritative for ordering, permissions,
 * deduplication, and accepted chart revisions. The server also mirrors the
 * embedded Go listener's handshake validation, per-address upgrade and message
 * budgets, bounded per-socket send queue, and read/write timeouts.
 *
 * Run with `npm run dev:collab` (uses Node's type-stripping support for the shared
 * TypeScript modules). Use `--host 0.0.0.0` to accept LAN connections. Origin,
 * rate, timeout, and queue limits can be overridden with REDUX_COLLAB_*
 * environment variables:
 *
 * - REDUX_COLLAB_ALLOWED_ORIGINS: comma-separated extra browser origins
 * - REDUX_COLLAB_UPGRADE_LIMIT / _WINDOW_MS: per-client upgrade budget
 * - REDUX_COLLAB_SHARED_UPGRADE_LIMIT: aggregate proxy/peer upgrade budget
 * - REDUX_COLLAB_MESSAGE_LIMIT / _WINDOW_MS: per-client message budget
 * - REDUX_COLLAB_SHARED_MESSAGE_LIMIT: aggregate proxy/peer message budget
 * - REDUX_COLLAB_READ_TIMEOUT_MS / _WRITE_TIMEOUT_MS: socket watchdogs
 * - REDUX_COLLAB_SEND_QUEUE_FRAMES / _BYTES: per-socket backpressure limit
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { isIP } from "node:net";
import { join } from "node:path";
import { gzipSync, gunzipSync } from "node:zlib";
import {
  ASSET_CHUNK_BYTES,
  ASSET_HASH,
  MAX_ASSET_BYTES,
  isAllowedAssetMime,
  matchesAssetMagic,
  sanitizeAssetName,
} from "../src/core/collaboration/assets.ts";
import { CollaborationRooms } from "../src/core/collaboration/room.ts";

/** Read one `--name value` argument, falling back when it is absent. */
function argValue(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

const host = argValue("host", "127.0.0.1");
const port = Number(argValue("port", "47830"));
const tlsCert = argValue("cert", "");
const tlsKey = argValue("key", "");
const dataDir = argValue("data", "");

const loopbackHost = host === "127.0.0.1" || host === "localhost" || host === "::1";
if (!tlsCert && !loopbackHost) {
  console.warn(
    "WARNING: collaboration rooms are exposed with plaintext ws://. Use --cert/--key or a TLS reverse proxy.",
  );
}

const rooms = new CollaborationRooms();
const statePath = dataDir ? join(dataDir, "rooms.json") : "";
const assetDir = dataDir ? join(dataDir, "assets") : "";
let persistTimer = null;

/** Write the whole room state atomically to the data directory. */
function persistNow() {
  if (!dataDir) {
    return;
  }
  const temporary = `${statePath}.tmp`;
  writeFileSync(temporary, JSON.stringify(rooms.exportState()), { mode: 0o600 });
  renameSync(temporary, statePath);
}

/** Coalesce room-state writes over a short window. */
function schedulePersist() {
  if (!dataDir || persistTimer) {
    return;
  }
  persistTimer = setTimeout(() => {
    persistTimer = null;
    try {
      persistNow();
    } catch (error) {
      console.error("collaboration persistence failed:", error);
    }
  }, 200);
}

/** Store one accepted asset blob under its content hash. */
function persistBlob(hash, bytes) {
  if (!dataDir) {
    return;
  }
  const path = join(assetDir, hash);
  if (!existsSync(path)) {
    writeFileSync(path, bytes, { mode: 0o600 });
  }
}

/** Load persisted rooms and their asset blobs at startup. */
function restoreState() {
  if (!dataDir) {
    return;
  }
  mkdirSync(assetDir, { recursive: true });
  if (!existsSync(statePath)) {
    return;
  }
  try {
    const state = JSON.parse(readFileSync(statePath, "utf8"));
    const blobs = new Map();
    for (const hash of state.assetHashes ?? []) {
      if (typeof hash !== "string" || !ASSET_HASH.test(hash)) {
        continue;
      }
      const path = join(assetDir, hash);
      if (existsSync(path)) {
        blobs.set(hash, new Uint8Array(readFileSync(path)));
      }
    }
    rooms.importState(state, blobs);
  } catch (error) {
    console.error("collaboration state could not be restored:", error);
  }
}

restoreState();

const sockets = new Map(); // socket -> connection record
const socketStates = new Map(); // socket -> outbound queue, timers, join failures
const memberSockets = new Map(); // memberId -> socket
const pendingSockets = new Map(); // requestId -> socket
const uploads = new Map(); // requestId -> upload record
/** Read a bounded positive integer environment override. */
function envInteger(name, fallback, minimum, maximum) {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") {
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    console.warn(`Ignoring invalid ${name}=${raw}; using ${fallback}.`);
    return fallback;
  }
  return value;
}

const MAX_MESSAGE = 64 * 1024 * 1024;
const MAX_UPLOADS_PER_SOCKET = 2;
const MAX_TOTAL_UPLOAD_BYTES = 512 * 1024 * 1024;
const MAX_OUTBOUND_FRAMES = envInteger("REDUX_COLLAB_SEND_QUEUE_FRAMES", 64, 1, 100_000);
const MAX_OUTBOUND_BYTES = envInteger(
  "REDUX_COLLAB_SEND_QUEUE_BYTES",
  8 * 1024 * 1024,
  1024,
  1024 * 1024 * 1024,
);
const WRITE_TIMEOUT_MS = envInteger("REDUX_COLLAB_WRITE_TIMEOUT_MS", 15_000, 1_000, 3_600_000);
const READ_TIMEOUT_MS = envInteger("REDUX_COLLAB_READ_TIMEOUT_MS", 75_000, 1_000, 3_600_000);
const MAX_JOIN_ATTEMPTS = 10;
const MAX_SOCKETS = envInteger("REDUX_COLLAB_MAX_SOCKETS", 256, 1, 100_000);

// Token budgets. A forwarded client address gets the tight per-client budget,
// while the direct transport peer always keeps an aggregate budget so a forged
// forwarding header cannot bypass the limiter. A loopback peer is a reverse
// proxy or the LAN bridge, so it receives a larger aggregate budget until that
// bridge forwards a trusted source identity.
const UPGRADE_WINDOW_MS = envInteger("REDUX_COLLAB_UPGRADE_WINDOW_MS", 10_000, 100, 3_600_000);
const UPGRADE_LIMIT = envInteger("REDUX_COLLAB_UPGRADE_LIMIT", 30, 1, 1_000_000);
const SHARED_UPGRADE_LIMIT = envInteger("REDUX_COLLAB_SHARED_UPGRADE_LIMIT", 300, 1, 1_000_000);
const MESSAGE_WINDOW_MS = envInteger("REDUX_COLLAB_MESSAGE_WINDOW_MS", 10_000, 100, 3_600_000);
// A 256 MiB asset arrives as 1024 chunk messages, so the default budget leaves
// room for a maximum upload while still bounding presence and edit spam.
const MESSAGE_LIMIT = envInteger("REDUX_COLLAB_MESSAGE_LIMIT", 4096, 1, 1_000_000);
const SHARED_MESSAGE_LIMIT = envInteger("REDUX_COLLAB_SHARED_MESSAGE_LIMIT", 20_000, 1, 1_000_000);
const upgradeBuckets = new Map();
const messageBuckets = new Map();

// Origins that may open a room socket. Missing Origin is accepted for the
// desktop client, CLI probes, and tests; browsers always send one.
const LOCAL_ORIGIN_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "tauri.localhost"]);

/** Serialize one protocol value. */
function json(value) {
  return JSON.stringify(value);
}

/** Read a string field, or "" when absent or mistyped, matching the Go listener. */
function stringField(message, key) {
  const value = message[key];
  return typeof value === "string" ? value : "";
}

/** Read an integral JSON number, or null when absent, fractional, or mistyped. */
function integerField(message, key) {
  const value = message[key];
  return typeof value === "number" && Number.isSafeInteger(value) ? value : null;
}

/** Keep the string members of a JSON array, matching the Go listener. */
function stringList(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
}

/** Decode only the profile fields the Go listener accepts: name and colour. */
function profileFrom(value) {
  const profile = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return { name: stringField(profile, "name"), color: stringField(profile, "color") };
}

/** Decode the optional presence record, rejecting mistyped known fields. */
function presenceFrom(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  if (value.area !== undefined && value.area !== null && typeof value.area !== "string") {
    return null;
  }
  const presence = {
    ...value,
    area: typeof value.area === "string" ? value.area : "",
    updatedAt: 0,
  };
  for (const key of ["section", "lineId"]) {
    const field = value[key];
    if (field === undefined || field === null) {
      delete presence[key];
      continue;
    }
    if (typeof field !== "string") {
      return null;
    }
    presence[key] = field;
  }
  for (const key of ["beat", "positionX", "playheadBeat"]) {
    const field = value[key];
    if (field === undefined || field === null) {
      delete presence[key];
      continue;
    }
    if (typeof field !== "number" || !Number.isFinite(field)) {
      return null;
    }
    presence[key] = field;
  }
  return presence;
}

/** Require a plaintext change list with object entries and string op/path fields. */
function plainChanges(value) {
  if (!Array.isArray(value)) {
    return null;
  }
  for (const change of value) {
    if (
      !change ||
      typeof change !== "object" ||
      Array.isArray(change) ||
      typeof change.op !== "string" ||
      typeof change.path !== "string"
    ) {
      return null;
    }
  }
  return value;
}

/** Decode standard padded base64, rejecting characters the Go decoder refuses. */
function decodeBase64(value) {
  if (
    typeof value !== "string" ||
    value.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(value)
  ) {
    return null;
  }
  const bytes = Buffer.from(value, "base64");
  return bytes.toString("base64") === value ? bytes : null;
}

/** Normalize one explicit origin to `scheme://host[:port]`, or "" when invalid. */
function normalizeOrigin(origin) {
  if (typeof origin !== "string" || origin.trim() === "") {
    return "";
  }
  let parsed;
  try {
    parsed = new URL(origin.trim());
  } catch {
    return "";
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    return "";
  }
  if (parsed.pathname !== "/" && parsed.pathname !== "") {
    return "";
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:" && parsed.protocol !== "tauri:") {
    return "";
  }
  if ((parsed.protocol === "http:" || parsed.protocol === "https:") && !parsed.host) {
    return "";
  }
  return `${parsed.protocol}//${parsed.host}`.toLowerCase();
}

// Extra browser origins supplied by the deployment. The built-in desktop and
// loopback origins stay allowed so an override only widens the list.
const configuredOrigins = new Set();
for (const entry of (process.env.REDUX_COLLAB_ALLOWED_ORIGINS ?? "").split(",")) {
  const value = entry.trim();
  if (!value) {
    continue;
  }
  const normalized = normalizeOrigin(value);
  if (normalized) {
    configuredOrigins.add(normalized);
  } else {
    console.warn(`Ignoring invalid REDUX_COLLAB_ALLOWED_ORIGINS entry: ${value}`);
  }
}

/**
 * Accept the desktop webview and local development origins, any explicitly
 * configured origin, and requests with no Origin header. A browser tab on an
 * unrelated site is rejected.
 */
function originAllowed(origin) {
  if (origin === undefined || origin === "") {
    return true;
  }
  if (typeof origin !== "string") {
    return false;
  }
  if (configuredOrigins.has(normalizeOrigin(origin))) {
    return true;
  }
  let parsed;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }
  const host = parsed.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  switch (parsed.protocol) {
    case "tauri:":
      return host === "" || host === "localhost" || host === "tauri.localhost";
    case "http:":
    case "https:":
      return LOCAL_ORIGIN_HOSTS.has(host);
    default:
      return false;
  }
}

/** Collapse an IPv4-mapped IPv6 peer address to the IPv4 form used by Go. */
function remoteHost(remoteAddress) {
  if (typeof remoteAddress !== "string" || remoteAddress.length === 0) {
    return "unknown";
  }
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(remoteAddress);
  return (mapped ? mapped[1] : remoteAddress).replace(/^\[|\]$/g, "").toLowerCase();
}

/** Whether a peer host is the local proxy/bridge address. */
function isLoopbackHost(host) {
  return host === "localhost" || host === "::1" || host === "127.0.0.1";
}

/** Read a syntactically valid client address supplied by a loopback proxy. */
function forwardedClient(headers = {}) {
  const candidates = [headers["cf-connecting-ip"], headers["x-real-ip"]];
  if (typeof headers["x-forwarded-for"] === "string") {
    candidates.push(headers["x-forwarded-for"].split(",")[0]);
  }
  for (const candidate of candidates) {
    if (typeof candidate !== "string") {
      continue;
    }
    const host = remoteHost(candidate.trim());
    if (host !== "unknown" && isIP(host)) {
      return host;
    }
  }
  return "";
}

/** Compose the stable rate-limit identity for one connection. */
function rateIdentity(peer, forwarded) {
  return forwarded ? `client:${forwarded}` : `peer:${peer}`;
}

/**
 * Consume one token from a continuous-refill bucket. A bucket starts full and
 * regains `limit / windowMs` tokens per millisecond up to its capacity.
 */
function takeRateToken(buckets, key, limit, windowMs, now) {
  let bucket = buckets.get(key);
  if (!bucket) {
    bucket = { tokens: limit, updated: now };
    buckets.set(key, bucket);
  } else {
    bucket.tokens = Math.min(limit, bucket.tokens + (now - bucket.updated) * (limit / windowMs));
    bucket.updated = now;
  }
  if (bucket.tokens < 1) {
    return false;
  }
  bucket.tokens -= 1;
  return true;
}

/** Consume one token from each bucket in a rate group without short-circuiting. */
function allowRate(buckets, entries, windowMs) {
  const now = Date.now();
  let allowed = true;
  for (const entry of entries) {
    if (!takeRateToken(buckets, entry.key, entry.limit, windowMs, now)) {
      allowed = false;
    }
  }
  if (buckets.size > 2048) {
    for (const [key, bucket] of buckets) {
      if (now - bucket.updated >= windowMs) {
        buckets.delete(key);
      }
    }
  }
  return allowed;
}

/**
 * Apply the upgrade budgets: a tight forwarded-client budget behind a loopback
 * proxy and an aggregate peer budget that a forwarding header cannot escape.
 */
function allowUpgrade(remoteAddress, headers = {}) {
  const peer = remoteHost(remoteAddress);
  const entries = [
    {
      key: `peer:${peer}`,
      limit: isLoopbackHost(peer) ? SHARED_UPGRADE_LIMIT : UPGRADE_LIMIT,
    },
  ];
  if (isLoopbackHost(peer)) {
    const forwarded = forwardedClient(headers);
    if (forwarded) {
      entries.push({ key: `client:${forwarded}`, limit: UPGRADE_LIMIT });
    }
  }
  return allowRate(upgradeBuckets, entries, UPGRADE_WINDOW_MS);
}

/**
 * Apply the per-connection message budget after the upgrade. A forwarded
 * client gets its own bucket while the proxy peer keeps a shared aggregate.
 */
function allowMessage(socket) {
  const state = socketStates.get(socket);
  if (!state) {
    return true;
  }
  const entries = [];
  if (state.forwarded) {
    entries.push({ key: `peer:${state.peer}`, limit: SHARED_MESSAGE_LIMIT });
    entries.push({ key: `client:${state.forwarded}`, limit: MESSAGE_LIMIT });
  } else {
    entries.push({ key: `peer:${state.peer}`, limit: MESSAGE_LIMIT });
  }
  return allowRate(messageBuckets, entries, MESSAGE_WINDOW_MS);
}

/** Serialize one message and write it as a text frame when the socket is open. */
function sendJSON(socket, value) {
  if (!socket.destroyed) {
    sendFrame(socket, Buffer.from(json(value), "utf8"));
  }
}

/** Send one message to every connected room member except the named socket. */
function broadcast(room, value, exceptSocket = null) {
  const payload = json(value);
  for (const member of room.members.values()) {
    const socket = memberSockets.get(member.id);
    if (socket && socket !== exceptSocket && !socket.destroyed) {
      sendFrame(socket, Buffer.from(payload, "utf8"));
    }
  }
}

/** Current members of one room as protocol records. */
function memberList(room) {
  return rooms.members(room);
}

/** Current presence records of one room. */
function presenceList(room) {
  return rooms.presence(room);
}

/** Maximum decompressed room chart accepted by the standalone server. */
const MAX_CHART_JSON = 512 * 1024 * 1024;

/** One cached gzip chart payload per room revision. */
const chartWireCache = new WeakMap();

/** Encode the current room chart for a welcome or snapshot message. */
function chartWire(room) {
  if (room.encrypted) {
    return { chart: room.chart };
  }
  const cached = chartWireCache.get(room);
  if (cached && cached.revision === room.revision) {
    return cached.payload;
  }
  const payload = {
    chart: gzipSync(Buffer.from(JSON.stringify(room.chart), "utf8"), {
      level: 6,
    }).toString("base64"),
    chartEncoding: "gzip",
  };
  chartWireCache.set(room, { revision: room.revision, payload });
  return payload;
}

/** Decode one incoming create chart, including the gzip wire form. */
function decodeChart(message) {
  if (stringField(message, "chartEncoding") !== "gzip") {
    return message.chart;
  }
  const compressed = Buffer.from(String(message.chart ?? ""), "base64");
  const data = gunzipSync(compressed, { maxOutputLength: MAX_CHART_JSON });
  return JSON.parse(data.toString("utf8"));
}

/** Size above which one plaintext change batch is gzipped for the wire. */
const CHANGES_GZIP_THRESHOLD = 16 * 1024;

/** Expand one base64 gzip change batch sent by a client. */
function decodeChangesWire(value) {
  if (typeof value !== "string") {
    throw new Error("Compressed changes are not text");
  }
  const compressed = Buffer.from(value, "base64");
  const data = gunzipSync(compressed, { maxOutputLength: MAX_CHART_JSON });
  const changes = JSON.parse(data.toString("utf8"));
  if (!Array.isArray(changes)) {
    throw new Error("Compressed changes are not a change array");
  }
  return changes;
}

/** Compress one plaintext change batch when it crosses the wire threshold. */
function encodeChangesWire(value) {
  const canonical = JSON.stringify(value);
  if (Buffer.byteLength(canonical, "utf8") <= CHANGES_GZIP_THRESHOLD) {
    return { changes: value };
  }
  return {
    changes: gzipSync(Buffer.from(canonical, "utf8"), { level: 1 }).toString("base64"),
    changesEncoding: "gzip",
  };
}

/** Maximum JSON header standing in front of one binary asset chunk. */
const MAX_BINARY_HEADER = 16 << 10;

/** Build one binary asset frame: 4-byte header length + JSON header + bytes. */
function binaryFrame(header, payload) {
  const encoded = Buffer.from(json(header), "utf8");
  if (encoded.length === 0 || encoded.length > MAX_BINARY_HEADER) {
    throw new Error("Binary asset header is invalid");
  }
  const prefix = Buffer.allocUnsafe(4);
  prefix.writeUInt32BE(encoded.length, 0);
  return Buffer.concat([prefix, encoded, payload]);
}

/** Split one binary asset frame into its header and chunk bytes. */
function parseBinaryFrame(payload) {
  if (payload.length < 4) {
    throw new Error("Binary asset frame is too short");
  }
  const length = payload.readUInt32BE(0);
  if (length === 0 || length > MAX_BINARY_HEADER || 4 + length > payload.length) {
    throw new Error("Binary asset header is invalid");
  }
  let header;
  try {
    header = JSON.parse(payload.subarray(4, 4 + length).toString("utf8"));
  } catch {
    throw new Error("Binary asset header is not JSON");
  }
  if (header === null || typeof header !== "object" || Array.isArray(header)) {
    throw new Error("Binary asset header is not JSON");
  }
  return { header, body: payload.subarray(4 + length) };
}

/** The welcome payload a member receives after creating, joining, or resuming. */
function welcomeFor(room, member, includeChart, binaryChunks = false, includeTransactions = true) {
  return {
    type: "welcome",
    roomId: room.id,
    invite: room.invite,
    memberId: member.id,
    hostId: room.hostId,
    role: member.role,
    revision: room.revision,
    appVersion: room.appVersion,
    ...(includeChart ? chartWire(room) : {}),
    fingerprint: room.fingerprint,
    maxMembers: room.maxMembers,
    members: memberList(room),
    presence: presenceList(room),
    assets: rooms.assetManifest(room),
    locks: rooms.roomLocks(room),
    ...(room.encrypted
      ? {
          encrypted: true,
          ...(includeTransactions ? { transactions: rooms.encryptedTransactions(room) } : {}),
        }
      : {}),
    ...(binaryChunks ? { binaryChunks: true } : {}),
    assetAdopt: true,
    resumeToken: member.token,
  };
}

/** Bind a socket to a member, replacing any earlier socket for that member. */
function attach(socket, room, member) {
  const previous = memberSockets.get(member.id);
  if (previous && previous !== socket) {
    previous.destroy();
  }
  memberSockets.set(member.id, socket);
  sockets.set(socket, { roomId: room.id, memberId: member.id });
}

/** Forget a closed socket and mark its member disconnected. */
function detach(socket) {
  const connection = sockets.get(socket);
  sockets.delete(socket);
  for (const [requestId, upload] of uploads) {
    if (upload.socket === socket) {
      uploads.delete(requestId);
    }
  }
  if (!connection) {
    return null;
  }
  if (memberSockets.get(connection.memberId) !== socket) {
    return connection;
  }
  memberSockets.delete(connection.memberId);
  const room = rooms.roomForMember(connection.memberId);
  if (room) {
    rooms.disconnect(connection.memberId);
    broadcast(room, { type: "members", members: memberList(room) });
    broadcast(room, { type: "locks", locks: rooms.roomLocks(room) });
    broadcast(room, {
      type: "presence",
      presence: { memberId: connection.memberId, area: "edit", updatedAt: 0 },
    });
  }
  return connection;
}

/** Append one ordered upload chunk after its text or binary wire decode. */
function applyAssetChunk(socket, requestId, index, chunk) {
  const upload = uploads.get(requestId);
  if (!upload || upload.socket !== socket || index !== upload.nextIndex) {
    sendJSON(socket, {
      type: "asset-rejected",
      requestId,
      hash: upload?.hash,
      name: upload?.name,
      message: "Asset chunk is out of order",
    });
    return;
  }
  if (!chunk || chunk.length === 0 || chunk.length > ASSET_CHUNK_BYTES) {
    uploads.delete(requestId);
    sendJSON(socket, {
      type: "asset-rejected",
      requestId,
      hash: upload.hash,
      name: upload.name,
      message: "Asset chunk has an invalid size",
    });
    return;
  }
  if (upload.received + chunk.length > upload.size) {
    uploads.delete(requestId);
    sendJSON(socket, {
      type: "asset-rejected",
      requestId,
      hash: upload.hash,
      name: upload.name,
      message: "Asset upload exceeds its declared size",
    });
    return;
  }
  upload.chunks.push(chunk);
  upload.received += chunk.length;
  upload.nextIndex += 1;
}

/** Dispatch one binary frame; only asset upload chunks use this transport. */
function handleBinaryMessage(socket, payload) {
  let parsed;
  try {
    parsed = parseBinaryFrame(payload);
  } catch (error) {
    sendJSON(socket, {
      type: "error",
      code: "invalid_binary",
      message: error instanceof Error ? error.message : String(error),
    });
    return;
  }
  const { header, body } = parsed;
  if (header.type !== "asset-chunk") {
    sendJSON(socket, {
      type: "error",
      code: "invalid_binary",
      message: "Binary frames carry asset chunks only",
    });
    return;
  }
  const requestId = stringField(header, "requestId");
  const index = integerField(header, "index");
  if (index === null) {
    sendJSON(socket, {
      type: "asset-rejected",
      requestId,
      message: "Asset chunk is out of order",
    });
    return;
  }
  applyAssetChunk(socket, requestId, index, body);
}

/** Dispatch one decoded client message; unknown types are ignored. */
function handleMessage(socket, message) {
  if (!message || typeof message !== "object" || Array.isArray(message)) {
    return;
  }
  if (message.type === "create") {
    const capabilityState = socketStates.get(socket);
    if (capabilityState) {
      capabilityState.binaryChunks = message.binaryChunks === true;
    }
    if (sockets.get(socket)) {
      sendJSON(socket, {
        type: "error",
        code: "already_in_room",
        message: "Leave the current room before creating another",
      });
      return;
    }
    const profile = profileFrom(message.profile);
    if (profile.name.trim().length === 0) {
      sendJSON(socket, {
        type: "error",
        code: "invalid_profile",
        message: "A display name is required",
      });
      return;
    }
    let chart;
    try {
      chart = decodeChart(message);
    } catch (error) {
      sendJSON(socket, {
        type: "error",
        code: "invalid_chart",
        message: error instanceof Error ? error.message : String(error),
      });
      return;
    }
    const created = rooms.create(
      profile,
      chart,
      stringField(message, "fingerprint"),
      message.encrypted === true,
      message.autoApproveEditor === true,
      stringField(message, "invite"),
      socketStates.get(socket)?.clientKey ?? "",
      stringField(message, "appVersion"),
    );
    if (!created.ok) {
      sendJSON(socket, { type: "error", code: created.code, message: created.message });
      return;
    }
    if (message.chartEncoding === "gzip" && !created.value.room.encrypted) {
      chartWireCache.set(created.value.room, {
        revision: 0,
        payload: { chart: String(message.chart ?? ""), chartEncoding: "gzip" },
      });
    }
    attach(socket, created.value.room, created.value.member);
    sendJSON(
      socket,
      welcomeFor(
        created.value.room,
        created.value.member,
        false,
        socketStates.get(socket)?.binaryChunks === true,
      ),
    );
    schedulePersist();
    return;
  }

  if (message.type === "join") {
    const state = socketStates.get(socket);
    if (state) {
      state.binaryChunks = message.binaryChunks === true;
    }
    if (state && state.joinFailures >= MAX_JOIN_ATTEMPTS) {
      sendJSON(socket, {
        type: "error",
        code: "too_many_joins",
        message: "Too many failed join attempts; reconnect to try again.",
      });
      endSocket(socket);
      return;
    }
    if (typeof message.invite !== "string" || !message.invite) {
      if (state) {
        state.joinFailures += 1;
      }
      sendJSON(socket, {
        type: "error",
        code: "invalid_join",
        message: "Room password is required",
      });
      return;
    }
    const profile = profileFrom(message.profile);
    if (profile.name.trim().length === 0) {
      if (state) {
        state.joinFailures += 1;
      }
      sendJSON(socket, {
        type: "error",
        code: "invalid_profile",
        message: "A display name is required",
      });
      return;
    }
    const joined = rooms.requestJoin(
      stringField(message, "roomId"),
      message.invite,
      profile,
      stringField(message, "appVersion"),
    );
    if (!joined.ok) {
      if (state) {
        state.joinFailures += 1;
      }
      sendJSON(socket, { type: "rejected", reason: joined.code, message: joined.message });
      return;
    }
    if (state) {
      state.joinFailures = 0;
    }
    const { room, request, member } = joined.value;
    if (member) {
      attach(socket, room, member);
      sendJSON(socket, welcomeFor(room, member, true, state?.binaryChunks === true));
      broadcast(room, { type: "members", members: memberList(room) }, socket);
      schedulePersist();
      return;
    }
    pendingSockets.set(request.requestId, socket);
    sendJSON(socket, { type: "waiting", roomId: room.id });
    const hostSocket = memberSockets.get(room.hostId);
    if (hostSocket) {
      sendJSON(hostSocket, {
        type: "pending",
        requestId: request.requestId,
        profile: request.profile,
      });
    }
    return;
  }

  if (message.type === "resume") {
    const state = socketStates.get(socket);
    if (state) {
      state.binaryChunks = message.binaryChunks === true;
    }
    const resumed = rooms.resume(
      stringField(message, "roomId"),
      stringField(message, "token"),
      stringField(message, "appVersion"),
    );
    if (!resumed.ok) {
      sendJSON(socket, { type: "rejected", reason: resumed.code, message: resumed.message });
      return;
    }
    const room = resumed.value.room;
    const current =
      message.hasChart === true &&
      message.revision === room.revision &&
      message.fingerprint === room.fingerprint;
    attach(socket, room, resumed.value.member);
    sendJSON(
      socket,
      welcomeFor(room, resumed.value.member, !current, state?.binaryChunks === true, !current),
    );
    if (resumed.value.member.role === "host") {
      for (const request of resumed.value.room.pending.values()) {
        sendJSON(socket, {
          type: "pending",
          requestId: request.requestId,
          profile: request.profile,
        });
      }
    }
    broadcast(resumed.value.room, { type: "members", members: memberList(resumed.value.room) });
    return;
  }

  if (message.type === "inspect-room") {
    const inspected = rooms.inspect(
      stringField(message, "roomId"),
      stringField(message, "invite"),
      stringField(message, "appVersion"),
    );
    if (!inspected.ok) {
      sendJSON(socket, { type: "rejected", reason: inspected.code, message: inspected.message });
      return;
    }
    sendJSON(socket, {
      type: "room-info",
      roomId: inspected.value.id,
      maxMembers: inspected.value.maxMembers,
      members: memberList(inspected.value),
    });
    return;
  }

  const connection = sockets.get(socket);
  if (!connection) {
    sendJSON(socket, { type: "error", code: "not_joined", message: "Join a room first" });
    return;
  }
  const room = rooms.roomForMember(connection.memberId);
  const member = room?.members.get(connection.memberId);
  if (!room || !member) {
    sendJSON(socket, { type: "error", code: "no_room", message: "Room is closed" });
    return;
  }

  if (message.type === "asset-begin") {
    const requestId = stringField(message, "requestId");
    const name = sanitizeAssetName(stringField(message, "name"));
    const hash = stringField(message, "hash");
    const mime = stringField(message, "mime");
    const plaintextHash = stringField(message, "plaintextHash");
    const size = integerField(message, "size");
    if (
      !name ||
      !ASSET_HASH.test(hash) ||
      !isAllowedAssetMime(mime) ||
      (plaintextHash !== "" && !ASSET_HASH.test(plaintextHash)) ||
      size === null ||
      size <= 0 ||
      size > MAX_ASSET_BYTES
    ) {
      sendJSON(socket, {
        type: "asset-rejected",
        requestId,
        hash: hash || undefined,
        name: stringField(message, "name") || undefined,
        message: "Asset declaration is invalid",
      });
      return;
    }
    if (member.role === "viewer") {
      sendJSON(socket, {
        type: "asset-rejected",
        requestId,
        hash,
        name,
        message: "This member has read-only access",
      });
      return;
    }
    if (message.adopt === true) {
      const bytes = rooms.blob(hash);
      if (
        bytes &&
        bytes.byteLength === size &&
        (room.encrypted || matchesAssetMagic(mime, bytes))
      ) {
        const adopted = rooms.acceptAsset(
          connection.memberId,
          name,
          hash,
          size,
          mime,
          bytes,
          plaintextHash || undefined,
        );
        if (!adopted.ok) {
          sendJSON(socket, {
            type: "asset-rejected",
            requestId,
            hash,
            name,
            message: adopted.message,
          });
          return;
        }
        sendJSON(socket, { type: "asset-begin-result", requestId, adopted: true });
        broadcast(room, { type: "asset-accepted", asset: adopted.value });
        broadcast(room, { type: "asset-manifest", assets: rooms.assetManifest(room) });
        schedulePersist();
        return;
      }
    }
    const activeUploads = [...uploads.values()].filter((upload) => upload.socket === socket);
    const totalReserved = [...uploads.values()].reduce((sum, upload) => sum + upload.size, 0);
    if (
      activeUploads.length >= MAX_UPLOADS_PER_SOCKET ||
      totalReserved + size > MAX_TOTAL_UPLOAD_BYTES
    ) {
      sendJSON(socket, {
        type: "asset-rejected",
        requestId,
        hash,
        name,
        message: "Too many concurrent asset uploads",
      });
      return;
    }
    uploads.set(requestId, {
      socket,
      binaryChunks: socketStates.get(socket)?.binaryChunks === true,
      memberId: connection.memberId,
      name,
      hash,
      size,
      mime,
      plaintextHash: plaintextHash || undefined,
      chunks: [],
      received: 0,
      nextIndex: 0,
    });
    if (message.adopt === true) {
      sendJSON(socket, { type: "asset-begin-result", requestId, adopted: false });
    }
    return;
  }

  if (message.type === "asset-chunk") {
    const requestId = stringField(message, "requestId");
    const index = integerField(message, "index");
    if (typeof message.data !== "string") {
      sendJSON(socket, {
        type: "asset-rejected",
        requestId,
        hash: uploads.get(requestId)?.hash,
        name: uploads.get(requestId)?.name,
        message: "Asset chunk is out of order",
      });
      return;
    }
    const chunk = decodeBase64(message.data);
    if (!chunk) {
      sendJSON(socket, {
        type: "asset-rejected",
        requestId,
        message: "Asset chunk is out of order",
      });
      return;
    }
    applyAssetChunk(socket, requestId, index, chunk);
    return;
  }

  if (message.type === "asset-commit") {
    const requestId = stringField(message, "requestId");
    const upload = uploads.get(requestId);
    if (!upload || upload.socket !== socket) {
      sendJSON(socket, {
        type: "asset-rejected",
        requestId,
        message: "Asset upload is not active",
      });
      return;
    }
    uploads.delete(requestId);
    const bytes = Buffer.concat(upload.chunks);
    const hash = createHash("sha256").update(bytes).digest("hex");
    if (bytes.length !== upload.size || hash !== upload.hash) {
      sendJSON(socket, {
        type: "asset-rejected",
        requestId,
        hash: upload.hash,
        name: upload.name,
        message: "Asset integrity check failed",
      });
      return;
    }
    if (!room.encrypted && !matchesAssetMagic(upload.mime, bytes)) {
      sendJSON(socket, {
        type: "asset-rejected",
        requestId,
        hash,
        name: upload.name,
        message: "Asset content does not match its declared type",
      });
      return;
    }
    const accepted = rooms.acceptAsset(
      connection.memberId,
      upload.name,
      hash,
      bytes.length,
      upload.mime,
      bytes,
      upload.plaintextHash,
    );
    if (!accepted.ok) {
      sendJSON(socket, {
        type: "asset-rejected",
        requestId,
        hash,
        name: upload.name,
        message: accepted.message,
      });
      return;
    }
    persistBlob(hash, bytes);
    schedulePersist();
    broadcast(room, { type: "asset-accepted", asset: accepted.value });
    broadcast(room, { type: "asset-manifest", assets: rooms.assetManifest(room) });
    return;
  }

  if (message.type === "asset-request") {
    const requestId = stringField(message, "requestId");
    const hash = stringField(message, "hash");
    const name = stringField(message, "name");
    const requested = rooms.assetForMember(connection.memberId, hash, name || undefined);
    if (!requested.ok) {
      sendJSON(socket, {
        type: "asset-rejected",
        requestId,
        hash,
        message: requested.message,
      });
      return;
    }
    const { asset, bytes } = requested.value;
    const totalChunks = Math.max(1, Math.ceil(bytes.byteLength / ASSET_CHUNK_BYTES));
    sendJSON(socket, {
      type: "asset-download-begin",
      requestId,
      asset,
      totalChunks,
      chunkSize: ASSET_CHUNK_BYTES,
    });
    let index = 0;
    const sendNext = () => {
      if (index >= totalChunks) {
        sendJSON(socket, {
          type: "asset-download-end",
          requestId,
          hash: asset.hash,
        });
        return;
      }
      const start = index * ASSET_CHUNK_BYTES;
      const data = bytes.subarray(start, Math.min(bytes.byteLength, start + ASSET_CHUNK_BYTES));
      if (socketStates.get(socket)?.binaryChunks === true) {
        sendBinary(socket, binaryFrame({ type: "asset-download-chunk", requestId, index }, data));
      } else {
        sendJSON(socket, {
          type: "asset-download-chunk",
          requestId,
          index,
          data: Buffer.from(data).toString("base64"),
        });
      }
      index += 1;
      setImmediate(sendNext);
    };
    sendNext();
    return;
  }

  if (message.type === "approve") {
    const requestId = stringField(message, "requestId");
    const approved = rooms.approve(
      connection.memberId,
      requestId,
      message.allow === true,
      stringField(message, "role"),
    );
    sendJSON(socket, { type: "pending-cleared", requestId });
    if (!approved.ok) {
      sendJSON(socket, { type: "error", code: approved.code, message: approved.message });
      return;
    }
    const pendingSocket = pendingSockets.get(requestId);
    pendingSockets.delete(requestId);
    if (!message.allow || !approved.value.member) {
      if (pendingSocket) {
        sendJSON(pendingSocket, {
          type: "rejected",
          reason: "declined",
          message: "The host declined this request",
        });
        endSocket(pendingSocket);
      }
      return;
    }
    const joinedMember = approved.value.member;
    if (!pendingSocket) {
      rooms.removeMember(connection.memberId, joinedMember.id);
      return;
    }
    attach(pendingSocket, room, joinedMember);
    sendJSON(
      pendingSocket,
      welcomeFor(room, joinedMember, true, socketStates.get(pendingSocket)?.binaryChunks === true),
    );
    broadcast(room, { type: "members", members: memberList(room) }, pendingSocket);
    return;
  }

  if (message.type === "max-members") {
    const maxMembers = integerField(message, "maxMembers");
    if (maxMembers === null) {
      sendJSON(socket, {
        type: "error",
        code: "bad_max_members",
        message: "Maximum members must be between 2 and 32",
      });
      return;
    }
    const changed = rooms.setMaxMembers(connection.memberId, maxMembers);
    if (!changed.ok) {
      sendJSON(socket, { type: "error", code: changed.code, message: changed.message });
      return;
    }
    broadcast(room, { type: "room-settings", maxMembers: changed.value.room.maxMembers });
    schedulePersist();
    return;
  }

  if (message.type === "set-role") {
    const changed = rooms.setRole(
      connection.memberId,
      stringField(message, "memberId"),
      stringField(message, "role"),
    );
    if (!changed.ok) {
      sendJSON(socket, { type: "error", code: changed.code, message: changed.message });
      return;
    }
    broadcast(room, { type: "members", members: memberList(room) });
    broadcast(room, { type: "locks", locks: rooms.roomLocks(room) });
    const target = memberSockets.get(changed.value.member.id);
    if (target) {
      sendJSON(target, { type: "permission", role: changed.value.member.role });
    }
    return;
  }

  if (message.type === "remove-member") {
    const removed = rooms.removeMember(connection.memberId, stringField(message, "memberId"));
    if (!removed.ok) {
      sendJSON(socket, { type: "error", code: removed.code, message: removed.message });
      return;
    }
    const target = memberSockets.get(removed.value.member.id);
    if (target) {
      sendJSON(target, {
        type: "rejected",
        reason: "removed",
        message: "The host asked you to leave the room",
      });
      endSocket(target);
    }
    broadcast(room, { type: "members", members: memberList(room) });
    broadcast(room, { type: "locks", locks: rooms.roomLocks(room) });
    broadcast(room, {
      type: "presence",
      presence: { memberId: removed.value.member.id, area: "edit", updatedAt: 0 },
    });
    return;
  }

  if (message.type === "close-room") {
    const closed = rooms.closeRoom(connection.memberId);
    if (!closed.ok) {
      sendJSON(socket, { type: "error", code: closed.code, message: closed.message });
      return;
    }
    broadcast(room, {
      type: "room-closed",
      reason: "host_closed",
      message: "The host closed the room",
    });
    for (const memberId of closed.value.memberIds) {
      const target = memberSockets.get(memberId);
      if (target) {
        endSocket(target);
      }
    }
    rooms.collectAssets();
    try {
      persistNow();
    } catch (error) {
      console.error("collaboration persistence failed:", error);
      schedulePersist();
    }
    return;
  }

  if (message.type === "leave") {
    if (connection.memberId === room.hostId) {
      sendJSON(socket, {
        type: "error",
        code: "host_must_close",
        message: "The host must close the room instead of leaving",
      });
      return;
    }
    rooms.leave(connection.memberId);
    sockets.delete(socket);
    memberSockets.delete(connection.memberId);
    broadcast(room, { type: "members", members: memberList(room) });
    broadcast(room, { type: "locks", locks: rooms.roomLocks(room) });
    broadcast(room, {
      type: "presence",
      presence: { memberId: connection.memberId, area: "edit", updatedAt: 0 },
    });
    broadcast(room, { type: "member-left", memberId: connection.memberId });
    endSocket(socket);
    return;
  }

  if (message.type === "lock-request") {
    const ids = stringList(message.ids);
    const ttl = integerField(message, "ttlMs");
    const acquired = rooms.acquireLocks(
      connection.memberId,
      ids,
      ttl === null || ttl === 0 ? undefined : ttl,
    );
    const conflicts = ids
      .map((id) => room.locks.get(id))
      .filter((lock) => lock && lock.ownerId !== connection.memberId);
    sendJSON(socket, {
      type: "lock-result",
      requestId: stringField(message, "requestId"),
      granted: acquired.ok,
      ...(acquired.ok ? {} : { conflicts }),
    });
    if (acquired.ok) {
      broadcast(room, { type: "locks", locks: rooms.roomLocks(room) });
    }
    return;
  }

  if (message.type === "lock-release") {
    if (rooms.releaseLocks(connection.memberId, stringList(message.ids))) {
      broadcast(room, { type: "locks", locks: rooms.roomLocks(room) });
    }
    return;
  }

  if (message.type === "presence") {
    const presence = presenceFrom(message.presence);
    if (!presence) {
      return;
    }
    const updated = rooms.updatePresence(connection.memberId, presence);
    if (updated) {
      broadcast(
        room,
        { type: "presence", presence: updated.members.get(connection.memberId)?.presence },
        socket,
      );
    }
    return;
  }

  if (message.type === "snapshot-request") {
    sendJSON(socket, {
      type: "snapshot",
      revision: room.revision,
      ...chartWire(room),
      fingerprint: room.fingerprint,
      ...(room.encrypted
        ? { encrypted: true, transactions: rooms.encryptedTransactions(room) }
        : {}),
    });
    return;
  }

  if (message.type === "transaction") {
    const transactionId = stringField(message, "transactionId");
    const changesEncoding = stringField(message, "changesEncoding") === "gzip" ? "gzip" : undefined;
    let changes;
    if (room.encrypted) {
      changes = message.changes;
    } else if (changesEncoding === "gzip") {
      try {
        changes = decodeChangesWire(message.changes);
      } catch (error) {
        sendJSON(socket, {
          type: "error",
          code: "invalid_change",
          message: error instanceof Error ? error.message : String(error),
          transactionId,
        });
        return;
      }
    } else {
      changes = plainChanges(message.changes);
    }
    const committed = rooms.commit(
      connection.memberId,
      transactionId,
      stringField(message, "label") || "Remote edit",
      changes,
      typeof message.undoOf === "string" ? message.undoOf : undefined,
      stringList(message.lockIds),
      room.encrypted ? changesEncoding : undefined,
    );
    if (!committed.ok) {
      if (committed.code === "conflict") {
        sendJSON(socket, {
          type: "conflict",
          revision: room.revision,
          transactionId,
          paths: committed.message.replace("Conflicting paths: ", "").split(", "),
          message: committed.message,
        });
      } else {
        sendJSON(socket, {
          type: "error",
          code: committed.code,
          message: committed.message,
          transactionId,
        });
      }
      return;
    }
    const { replayed, ...stored } = committed.value;
    const payload = room.encrypted ? stored : { ...stored, ...encodeChangesWire(stored.changes) };
    if (replayed) {
      // A retry gets the original result only on the requesting socket; other
      // members have already applied that revision exactly once.
      sendJSON(socket, { type: "committed", ...payload });
      return;
    }
    broadcast(room, { type: "committed", ...payload });
    schedulePersist();
    return;
  }

  if (message.type === "ping") {
    sendJSON(socket, { type: "pong" });
  }
}

/** Decode complete WebSocket frames and return any trailing partial bytes. */
function parseFrames(buffer) {
  const frames = [];
  let offset = 0;
  while (offset + 2 <= buffer.length) {
    const first = buffer[offset];
    const second = buffer[offset + 1];
    const fin = (first & 0x80) !== 0;
    const opcode = first & 0x0f;
    const masked = (second & 0x80) !== 0;
    if ((first & 0x70) !== 0 || !masked) {
      return { frames, rest: Buffer.alloc(0), overflow: false, invalid: true };
    }
    let length = second & 0x7f;
    let header = 2;
    if (length === 126) {
      if (offset + 4 > buffer.length) {
        break;
      }
      length = buffer.readUInt16BE(offset + 2);
      header = 4;
    } else if (length === 127) {
      if (offset + 10 > buffer.length) {
        break;
      }
      const big = buffer.readBigUInt64BE(offset + 2);
      if (big > BigInt(MAX_MESSAGE)) {
        return { frames, rest: Buffer.alloc(0), overflow: true };
      }
      length = Number(big);
      header = 10;
    }
    if (opcode >= 0x8 && (!fin || length > 125)) {
      return { frames, rest: Buffer.alloc(0), overflow: false, invalid: true };
    }
    const maskOffset = offset + header;
    const payloadOffset = maskOffset + (masked ? 4 : 0);
    const end = payloadOffset + length;
    if (end > buffer.length) {
      break;
    }
    let payload = buffer.subarray(payloadOffset, end);
    if (masked) {
      const mask = buffer.subarray(maskOffset, maskOffset + 4);
      const unmasked = Buffer.allocUnsafe(length);
      for (let index = 0; index < length; index++) {
        unmasked[index] = payload[index] ^ mask[index % 4];
      }
      payload = unmasked;
    }
    frames.push({ fin, opcode, payload });
    offset = end;
  }
  return { frames, rest: buffer.subarray(offset), overflow: false };
}

/** Build the frame header for an unmasked server frame. */
function frameHeader(length, opcode = 0x1) {
  const first = 0x80 | opcode;
  if (length < 126) {
    return Buffer.from([first, length]);
  }
  if (length < 65536) {
    const header = Buffer.allocUnsafe(4);
    header[0] = first;
    header[1] = 126;
    header.writeUInt16BE(length, 2);
    return header;
  }
  const header = Buffer.allocUnsafe(10);
  header[0] = first;
  header[1] = 127;
  header.writeBigUInt64BE(BigInt(length), 2);
  return header;
}

/** Queue one frame on a socket and drain it without waiting for the peer. */
function enqueueFrame(socket, frame) {
  const state = socketStates.get(socket);
  if (!state || state.closed || socket.destroyed) {
    return;
  }
  if (
    state.queue.length >= MAX_OUTBOUND_FRAMES ||
    state.queuedBytes + frame.length > MAX_OUTBOUND_BYTES
  ) {
    // The peer is not draining its socket. Disconnect it instead of letting
    // one slow member grow an unbounded buffer or block room broadcasts.
    state.closed = true;
    socket.destroy();
    return;
  }
  state.queue.push(frame);
  state.queuedBytes += frame.length;
  flushQueue(state);
}

/** Write queued frames until the socket applies backpressure. */
function flushQueue(state) {
  if (state.closed || state.flushing || state.waitingDrain) {
    return;
  }
  state.flushing = true;
  while (state.queue.length > 0) {
    if (state.socket.destroyed) {
      state.closed = true;
      break;
    }
    const frame = state.queue.shift();
    state.queuedBytes -= frame.length;
    if (!state.socket.write(frame)) {
      state.flushing = false;
      state.waitingDrain = true;
      armWriteTimeout(state);
      state.socket.once("drain", () => {
        const current = socketStates.get(state.socket);
        if (!current || current.closed) {
          return;
        }
        current.waitingDrain = false;
        clearWriteTimeout(current);
        flushQueue(current);
      });
      return;
    }
  }
  state.flushing = false;
  if (!state.closed && state.closeAfterFlush && state.queue.length === 0) {
    state.closed = true;
    state.socket.end();
  }
}

/** Bound one socket write so a half-open peer cannot pin a queue forever. */
function armWriteTimeout(state) {
  clearWriteTimeout(state);
  state.writeTimer = setTimeout(() => {
    state.writeTimer = null;
    if (state.closed) {
      return;
    }
    state.closed = true;
    state.socket.destroy();
  }, WRITE_TIMEOUT_MS);
  state.writeTimer.unref?.();
}

/** Clear the pending write watchdog. */
function clearWriteTimeout(state) {
  if (state.writeTimer) {
    clearTimeout(state.writeTimer);
    state.writeTimer = null;
  }
}

/** Refresh the idle-read timer; heartbeat pings keep an active client alive. */
function armReadTimeout(socket) {
  const state = socketStates.get(socket);
  if (!state || state.closed) {
    return;
  }
  if (state.readTimer) {
    clearTimeout(state.readTimer);
  }
  state.readTimer = setTimeout(() => {
    state.readTimer = null;
    if (state.closed) {
      return;
    }
    sendControl(socket, 0x8, Buffer.from([0x03, 0xe8]));
    endSocket(socket);
  }, READ_TIMEOUT_MS);
  state.readTimer.unref?.();
}

/** Flush queued messages and then close the write side of a socket. */
function endSocket(socket) {
  const state = socketStates.get(socket);
  if (!state) {
    if (!socket.destroyed) {
      socket.end();
    }
    return;
  }
  state.closeAfterFlush = true;
  flushQueue(state);
  if (!state.closed && !state.flushing && !state.waitingDrain && state.queue.length === 0) {
    state.closed = true;
    socket.end();
  }
}

/** Release queue buffers and timers when a socket is gone. */
function releaseSocketState(socket) {
  const state = socketStates.get(socket);
  if (!state) {
    return;
  }
  state.closed = true;
  if (state.readTimer) {
    clearTimeout(state.readTimer);
    state.readTimer = null;
  }
  clearWriteTimeout(state);
  state.queue.length = 0;
  state.queuedBytes = 0;
  socketStates.delete(socket);
}

/** Write one text frame with its header through the per-socket queue. */
function sendFrame(socket, payload) {
  if (socket.destroyed) {
    return;
  }
  enqueueFrame(socket, Buffer.concat([frameHeader(payload.length), payload]));
}

/** Write one binary asset frame through the per-socket queue. */
function sendBinary(socket, payload) {
  if (socket.destroyed) {
    return;
  }
  enqueueFrame(socket, Buffer.concat([frameHeader(payload.length, 0x2), payload]));
}

/** Write one control frame such as ping, pong, or close. */
function sendControl(socket, opcode, payload = Buffer.alloc(0)) {
  if (socket.destroyed) {
    return;
  }
  const body = payload.subarray(0, 125);
  enqueueFrame(socket, Buffer.concat([Buffer.from([0x80 | opcode, body.length]), body]));
}

/** Answer health probes and reject every other HTTP path. */
const requestHandler = (request, response) => {
  if (request.url === "/health") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(json({ ok: true, service: "rpe-redux-collaboration", rooms: rooms.roomCount() }));
    return;
  }
  response.writeHead(404, { "content-type": "application/json" });
  response.end(json({ error: "not_found" }));
};

if (Boolean(tlsCert) !== Boolean(tlsKey)) {
  throw new Error("--cert and --key must be provided together");
}
const server =
  tlsCert && tlsKey
    ? createHttpsServer({ cert: readFileSync(tlsCert), key: readFileSync(tlsKey) }, requestHandler)
    : createServer(requestHandler);

/** Reject an upgrade before it becomes a WebSocket with a plain HTTP status. */
function rejectUpgrade(socket, status, statusText, message) {
  const body = `${message}\n`;
  socket.end(
    `HTTP/1.1 ${status} ${statusText}\r\n` +
      "Connection: close\r\n" +
      "Content-Type: text/plain; charset=utf-8\r\n" +
      `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n` +
      body,
  );
}

server.on("upgrade", (request, socket) => {
  const peer = remoteHost(request.socket.remoteAddress);
  const forwarded = isLoopbackHost(peer) ? forwardedClient(request.headers) : "";
  if (!originAllowed(request.headers.origin)) {
    rejectUpgrade(socket, 403, "Forbidden", "origin not allowed");
    return;
  }
  if (sockets.size >= MAX_SOCKETS) {
    rejectUpgrade(socket, 503, "Service Unavailable", "room server is at its connection limit");
    return;
  }
  if (!allowUpgrade(request.socket.remoteAddress, request.headers)) {
    rejectUpgrade(socket, 429, "Too Many Requests", "too many connection attempts");
    return;
  }
  const path = request.url?.split("?")[0] ?? "";
  if (path !== "/" && !path.startsWith("/rooms")) {
    rejectUpgrade(socket, 404, "Not Found", "not found");
    return;
  }
  const key = request.headers["sec-websocket-key"];
  if (
    request.headers.upgrade?.toLowerCase() !== "websocket" ||
    request.headers["sec-websocket-version"] !== "13" ||
    typeof key !== "string" ||
    key.length === 0
  ) {
    rejectUpgrade(socket, 426, "Upgrade Required", "websocket upgrade required");
    return;
  }
  const accept = createHash("sha1")
    .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
    .digest("base64");
  socket.write(
    "HTTP/1.1 101 Switching Protocols\r\n" +
      "Upgrade: websocket\r\n" +
      "Connection: Upgrade\r\n" +
      `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
  );
  socket.setNoDelay(true);
  socketStates.set(socket, {
    socket,
    peer,
    forwarded,
    clientKey: rateIdentity(peer, forwarded),
    queue: [],
    queuedBytes: 0,
    flushing: false,
    waitingDrain: false,
    writeTimer: null,
    readTimer: null,
    joinFailures: 0,
    binaryChunks: false,
    closeAfterFlush: false,
    closed: false,
  });
  sockets.set(socket, null);
  armReadTimeout(socket);
  let buffer = Buffer.alloc(0);
  let fragments = [];
  let fragmentBytes = 0;
  let fragmentOpcode = 0;
  socket.on("data", (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    const parsed = parseFrames(buffer);
    buffer = parsed.rest;
    if (parsed.overflow) {
      sendControl(socket, 0x8, Buffer.from([0x03, 0xf1]));
      endSocket(socket);
      return;
    }
    if (parsed.invalid) {
      sendControl(socket, 0x8, Buffer.from([0x03, 0xea]));
      endSocket(socket);
      return;
    }
    let completedMessage = false;
    for (const frame of parsed.frames) {
      if (frame.opcode === 0x8) {
        sendControl(socket, 0x8, frame.payload);
        endSocket(socket);
        return;
      }
      if (frame.opcode === 0x9) {
        sendControl(socket, 0xa, frame.payload);
        continue;
      }
      if (frame.opcode === 0xa) {
        continue;
      }
      if (frame.opcode === 0x1 || frame.opcode === 0x2 || frame.opcode === 0x0) {
        if (
          ((frame.opcode === 0x1 || frame.opcode === 0x2) && fragments.length > 0) ||
          (frame.opcode === 0x0 && fragments.length === 0)
        ) {
          sendControl(socket, 0x8, Buffer.from([0x03, 0xea]));
          endSocket(socket);
          return;
        }
        if (frame.opcode === 0x1 || frame.opcode === 0x2) {
          fragmentOpcode = frame.opcode;
        }
        fragmentBytes += frame.payload.length;
        if (fragmentBytes > MAX_MESSAGE) {
          sendControl(socket, 0x8, Buffer.from([0x03, 0xf1]));
          endSocket(socket);
          return;
        }
        fragments.push(frame.payload);
        if (!frame.fin) {
          continue;
        }
        const payload = Buffer.concat(fragments);
        const opcode = fragmentOpcode;
        fragments = [];
        fragmentBytes = 0;
        fragmentOpcode = 0;
        completedMessage = true;
        if (!allowMessage(socket)) {
          sendJSON(socket, {
            type: "error",
            code: "rate_limited",
            message: "Too many messages; reconnect to try again.",
          });
          endSocket(socket);
          return;
        }
        if (opcode === 0x2) {
          handleBinaryMessage(socket, payload);
          continue;
        }
        let message;
        try {
          message = JSON.parse(payload.toString("utf8"));
        } catch {
          sendJSON(socket, { type: "error", code: "invalid_json", message: "Message is not JSON" });
          continue;
        }
        if (message === null || typeof message !== "object" || Array.isArray(message)) {
          sendJSON(socket, { type: "error", code: "invalid_json", message: "Message is not JSON" });
          continue;
        }
        try {
          handleMessage(socket, message);
        } catch (error) {
          sendJSON(socket, {
            type: "error",
            code: "server_error",
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }
    if (completedMessage) {
      armReadTimeout(socket);
    }
  });
  const forgetPending = () => {
    for (const [requestId, pendingSocket] of pendingSockets) {
      if (pendingSocket === socket) {
        pendingSockets.delete(requestId);
        const discarded = rooms.discardPending(requestId);
        const hostSocket = discarded ? memberSockets.get(discarded.hostId) : null;
        if (hostSocket) {
          sendJSON(hostSocket, { type: "pending-cleared", requestId });
        }
      }
    }
  };
  socket.on("close", () => {
    releaseSocketState(socket);
    forgetPending();
    detach(socket);
  });
  socket.on("error", () => {
    releaseSocketState(socket);
    forgetPending();
    detach(socket);
  });
});

const pruneTimer = setInterval(() => {
  rooms.sweepLocks();
  rooms.prune();
  rooms.collectAssets();
}, 60_000);
pruneTimer.unref();

server.listen(port, host, () => {
  const address = server.address();
  const actualPort = typeof address === "object" && address ? address.port : port;
  process.stdout.write(
    `${json({
      event: "listening",
      host,
      port: actualPort,
      secure: Boolean(tlsCert && tlsKey),
      service: "rpe-redux-collaboration",
    })}\n`,
  );
});

/** Persist final state, close every socket, and stop the server. */
function shutdown() {
  try {
    persistNow();
  } catch (error) {
    console.error("collaboration persistence failed:", error);
  }
  for (const socket of sockets.keys()) {
    if (socket.destroyed) {
      continue;
    }
    sendControl(socket, 0x8);
    endSocket(socket);
  }
  server.close(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
