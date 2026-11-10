/**
 * Durable host and guest room sessions.
 *
 * The collaboration section carries at most one resumable session. Reading
 * ignores malformed records, writing one role clears the other, and an explicit
 * exit clears both so a stale token cannot prompt on the next launch.
 */

/** Room and token needed to resume one membership after a restart. */
export interface StoredRoomSession {
  readonly roomId: string;
  readonly resumeToken: string;
  readonly serverUrl: string;
}

/** Which membership the stored token belongs to. */
export type StoredSessionRole = "host" | "guest";

const SESSION_KEYS: Record<StoredSessionRole, string> = {
  host: "hostSession",
  guest: "guestSession",
};

/** Validate one stored session record. */
export function parseStoredRoomSession(value: unknown): StoredRoomSession | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (
    typeof record.roomId !== "string" ||
    !record.roomId.trim() ||
    typeof record.resumeToken !== "string" ||
    !record.resumeToken.trim() ||
    typeof record.serverUrl !== "string" ||
    !record.serverUrl.trim()
  ) {
    return null;
  }
  return {
    roomId: record.roomId,
    resumeToken: record.resumeToken,
    serverUrl: record.serverUrl,
  };
}

/** Compare two stored sessions by every resumable field. */
export function sameRoomSession(
  left: StoredRoomSession | null,
  right: StoredRoomSession | null,
): boolean {
  return (
    left?.roomId === right?.roomId &&
    left?.resumeToken === right?.resumeToken &&
    left?.serverUrl === right?.serverUrl
  );
}

/** Read one role from the collaboration preference section. */
export function readRoomSession(
  section: unknown,
  role: StoredSessionRole,
): StoredRoomSession | null {
  if (!section || typeof section !== "object" || Array.isArray(section)) {
    return null;
  }
  return parseStoredRoomSession((section as Record<string, unknown>)[SESSION_KEYS[role]]);
}

/**
 * Return a copy of the section with one role stored and the other cleared.
 *
 * Passing null clears only that role; callers use `clearRoomSessions` for an
 * explicit exit.
 */
export function updateRoomSession(
  section: unknown,
  role: StoredSessionRole,
  session: StoredRoomSession | null,
): Record<string, unknown> {
  const next =
    section && typeof section === "object" && !Array.isArray(section)
      ? { ...(section as Record<string, unknown>) }
      : {};
  if (session) {
    delete next[SESSION_KEYS[role === "host" ? "guest" : "host"]];
    next[SESSION_KEYS[role]] = session;
  } else {
    delete next[SESSION_KEYS[role]];
  }
  return next;
}

/** Return a copy with both resumable roles removed. */
export function clearRoomSessions(section: unknown): Record<string, unknown> {
  const next =
    section && typeof section === "object" && !Array.isArray(section)
      ? { ...(section as Record<string, unknown>) }
      : {};
  for (const key of Object.values(SESSION_KEYS)) {
    delete next[key];
  }
  return next;
}
