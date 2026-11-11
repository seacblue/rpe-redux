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

/** Generate a human-typeable room password with an unambiguous alphabet. */
export function createRoomPassword(length = 8): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => alphabet[byte % alphabet.length]).join("");
}

/** Normalize a room server entry into a ws:// or wss:// URL. */
export function normalizeRoomServerUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `ws://${trimmed}`;
  try {
    const url = new URL(candidate);
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
