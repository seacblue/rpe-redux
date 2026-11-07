/**
 * Parses the sidecar's bridge handshake file and builds the authenticated
 * WebSocket URL. The token is a per-process credential; callers must not log
 * the resulting URL or persist the token.
 */

/** The JSON record written beside the SQLite database by the Go sidecar. */
export interface CodeCellEndpointFile {
  readonly version: number;
  readonly token: string;
  readonly bridge: string;
}

/** Returns the bridge token from an endpoint-file body, or null when invalid. */
export function parseCodeCellEndpointFile(text: string): string | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object") {
    return null;
  }
  const token = (value as { token?: unknown }).token;
  return typeof token === "string" && token.trim() ? token : null;
}

/** Builds the authenticated loopback WebSocket URL for one server origin. */
export function codeCellBridgeUrl(origin: string, token: string): string {
  const url = new URL(origin);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = "/api/cell/bridge";
  url.search = new URLSearchParams({ token }).toString();
  return url.toString();
}
