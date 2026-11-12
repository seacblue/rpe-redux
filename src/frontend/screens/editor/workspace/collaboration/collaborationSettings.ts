/**
 * Shared collaboration form settings.
 *
 * The welcome-page join dialog and the editor Inspector both read and write
 * this durable shape so reopening either surface keeps the same draft.
 */

/** How a desktop host exposes its room. */
export type CollaborationHostMode = "tunnel" | "lan";

/** Join form source used by both collaboration surfaces. */
export type CollaborationJoinMethod = "link" | "custom";

/** Locally stored identity and collaboration endpoint settings. */
export interface CollaborationSettings {
  readonly serverUrl: string;
  readonly displayName: string;
  readonly color: string;
  readonly hostMode: CollaborationHostMode;
  /** User-chosen LAN bridge port; empty when unset. */
  readonly lanPort: string;
  /** Last password entered for a manual room join. */
  readonly joinPassword: string;
  readonly joinMethod: CollaborationJoinMethod;
  readonly joinLink: string;
}

/** Profile values used when a stored identity is absent or malformed. */
export interface CollaborationProfileFallback {
  readonly name: string;
  readonly color: string;
}

/** Read and validate the durable collaboration settings section. */
export function readCollaborationSettings(
  raw: unknown,
  defaults: CollaborationSettings,
  fallback: CollaborationProfileFallback,
): CollaborationSettings {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {
      ...defaults,
      displayName: fallback.name,
      color: fallback.color,
    };
  }
  const record = raw as Record<string, unknown>;
  return {
    serverUrl:
      typeof record.serverUrl === "string" && record.serverUrl.trim()
        ? record.serverUrl
        : defaults.serverUrl,
    displayName:
      typeof record.displayName === "string" && record.displayName.trim()
        ? record.displayName
        : fallback.name,
    color:
      typeof record.color === "string" && /^#[0-9a-f]{6}$/i.test(record.color)
        ? record.color
        : fallback.color,
    hostMode: record.hostMode === "lan" ? "lan" : "tunnel",
    lanPort:
      typeof record.lanPort === "string" && /^\d{4,5}$/.test(record.lanPort) ? record.lanPort : "",
    joinPassword: typeof record.joinPassword === "string" ? record.joinPassword.slice(0, 64) : "",
    joinMethod: record.joinMethod === "custom" ? "custom" : "link",
    joinLink: typeof record.joinLink === "string" ? record.joinLink : "",
  };
}

/** Merge one settings update without dropping room-session records. */
export function mergeCollaborationSettings(
  section: unknown,
  next: Record<string, unknown>,
): Record<string, unknown> {
  const stored =
    section && typeof section === "object" && !Array.isArray(section)
      ? (section as Record<string, unknown>)
      : {};
  return { ...stored, ...next };
}
