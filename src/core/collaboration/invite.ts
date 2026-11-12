/**
 * Clickable room invitations.
 *
 * The custom protocol carries the room endpoint, password, and room id. The id
 * disambiguates rooms that share a password on one endpoint; links written
 * before the id existed still resolve through the password alone. The host still
 * approves joins unless the room was created with auto-approval.
 */
/** A parsed room invitation: endpoint, room id when present, and password. */
export interface RoomInvite {
  readonly serverUrl: string;
  readonly invite: string;
  /** Exact room on the endpoint; absent in links produced by older builds. */
  readonly roomId?: string;
}

/** The two WebSocket schemes supported by room endpoints. */
export type RoomServerProtocol = "ws" | "wss";

/** Editable address parts used by the collaboration forms. */
export interface RoomServerUrlParts {
  readonly address: string;
  readonly port: string;
  readonly protocol: RoomServerProtocol;
  /** Preserve an optional reverse-proxy path from an older full URL. */
  readonly path: string;
}

/** Generate a human-typeable room password with an unambiguous alphabet. */
export function createRoomPassword(length = 8): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => alphabet[byte % alphabet.length]).join("");
}

/** Identify endpoints that normally are only reachable without public TLS. */
function isLocalOrPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host === "0.0.0.0" || host === "::1" || host.endsWith(".local")) {
    return true;
  }
  if (host.includes(":")) {
    return host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80:");
  }
  const octets = host.split(".").map(Number);
  if (
    octets.length !== 4 ||
    octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)
  ) {
    return false;
  }
  const [first, second] = octets;
  return (
    first === 10 ||
    first === 127 ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  );
}

/** Normalize a room server entry into a ws:// or wss:// URL. */
export function normalizeRoomServerUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  const hasProtocol = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed);
  const candidate = hasProtocol ? trimmed : `ws://${trimmed}`;
  try {
    const url = new URL(candidate);
    if (!hasProtocol && !isLocalOrPrivateHost(url.hostname)) {
      url.protocol = "wss:";
    }
    if (url.protocol === "http:") {
      url.protocol = "ws:";
    } else if (url.protocol === "https:") {
      url.protocol = "wss:";
    }
    if (url.protocol !== "ws:" && url.protocol !== "wss:") {
      return "";
    }
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return "";
  }
}

/** Parse a full room URL into the fields shown by the collaboration forms. */
export function parseRoomServerUrlParts(
  value: string,
  defaultProtocol: RoomServerProtocol = "ws",
): RoomServerUrlParts {
  const trimmed = value.trim();
  if (!trimmed) {
    return { address: "", port: "", protocol: defaultProtocol, path: "" };
  }
  const normalized = normalizeRoomServerUrl(trimmed);
  try {
    const url = new URL(normalized || trimmed);
    const protocol: RoomServerProtocol = url.protocol === "wss:" ? "wss" : "ws";
    const address = url.hostname.replace(/^\[|\]$/g, "");
    const path = `${url.pathname === "/" ? "" : url.pathname}${url.search}`;
    return { address, port: url.port, protocol, path };
  } catch {
    return {
      address: trimmed.replace(/^[a-z][a-z0-9+.-]*:\/\//i, ""),
      port: "",
      protocol: defaultProtocol,
      path: "",
    };
  }
}

/** Build a room URL from the address fields shown by the collaboration forms. */
export function buildRoomServerUrl(parts: RoomServerUrlParts): string {
  const address = parts.address.trim().replace(/^\[|\]$/g, "");
  if (!address) {
    return "";
  }
  const host = address.includes(":") ? `[${address}]` : address;
  const port = parts.port.trim();
  const path = parts.path.trim();
  return `${parts.protocol}://${host}${port ? `:${port}` : ""}${
    path ? (path.startsWith("/") ? path : `/${path}`) : ""
  }`;
}

/** Build the `rperedux://join` link that opens the invite in the app. */
export function buildRoomInviteLink(invite: RoomInvite): string {
  const params = new URLSearchParams({
    server: invite.serverUrl,
    invite: invite.invite,
  });
  const roomId = invite.roomId?.trim();
  if (roomId) {
    params.set("room", roomId);
  }
  return `rperedux://join?${params.toString()}`;
}

/** Build an HTTPS link that opens the same invitation in the static web app. */
export function buildWebRoomInviteLink(invite: RoomInvite, baseUrl: string): string {
  // `baseUrl` is the app root, not the current page: a chart address is local
  // to the sender and must not travel inside a room invitation.
  const url = new URL(baseUrl);
  url.search = "";
  url.hash = "";
  url.searchParams.set("join", "1");
  url.searchParams.set("server", invite.serverUrl);
  url.searchParams.set("invite", invite.invite);
  const roomId = invite.roomId?.trim();
  if (roomId) {
    url.searchParams.set("room", roomId);
  }
  return url.toString();
}

/** Parse a web-app invitation URL; null for any other page or missing fields. */
export function parseWebRoomInviteUrl(value: string): RoomInvite | null {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }
  if (parsed.searchParams.get("join") !== "1") {
    return null;
  }
  const serverUrl = parsed.searchParams.get("server")?.trim() ?? "";
  const invite = parsed.searchParams.get("invite")?.trim() ?? "";
  if (!serverUrl || !invite) {
    return null;
  }
  const roomId = parsed.searchParams.get("room")?.trim() ?? "";
  return { serverUrl, invite, ...(roomId ? { roomId } : {}) };
}

/** Parse a room invite link, returning null for any other URL or missing fields. */
export function parseRoomInviteLink(value: string): RoomInvite | null {
  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch {
    return null;
  }
  if (parsed.protocol !== "rperedux:" || parsed.hostname.toLowerCase() !== "join") {
    return null;
  }
  const serverUrl = parsed.searchParams.get("server")?.trim() ?? "";
  const invite = parsed.searchParams.get("invite")?.trim() ?? "";
  if (!serverUrl || !invite) {
    return null;
  }
  const roomId = parsed.searchParams.get("room")?.trim() ?? "";
  return { serverUrl, invite, ...(roomId ? { roomId } : {}) };
}
