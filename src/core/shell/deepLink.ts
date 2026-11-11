/**
 * The custom-scheme links the desktop host accepts.
 *
 * `rperedux://chart/<id>` addresses one library project and
 * `rperedux://join?...` is a room invitation. The parser keeps the link grammar
 * out of the Tauri adapter so the browser build and the tests read the same
 * rules; the host only stores the first scheme argument until the frontend asks.
 */
import { parseRoomInviteLink } from "../collaboration/invite.ts";
import type { AppRoute } from "./route.ts";

/** A link the desktop host can turn into a route or a room invitation. */
export type AppDeepLink =
  | { readonly kind: "chart"; readonly route: Extract<AppRoute, { kind: "chart" }> }
  | { readonly kind: "join"; readonly link: string };

/**
 * Parse one `rperedux://` link.
 *
 * Returns null for another scheme, an unknown host, a missing chart id, or a
 * room link without its endpoint and password. The caller consumes the link
 * even on null so a stale argument cannot replay on the next launch.
 */
export function parseAppDeepLink(value: string): AppDeepLink | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== "rperedux:") {
    return null;
  }
  const host = url.hostname.toLowerCase();
  if (host === "join") {
    return parseRoomInviteLink(trimmed) ? { kind: "join", link: trimmed } : null;
  }
  if (host !== "chart") {
    return null;
  }
  const segments = url.pathname.split("/").filter(Boolean);
  if (segments.length !== 1) {
    return null;
  }
  let projectId: string;
  try {
    projectId = decodeURIComponent(segments[0]);
  } catch {
    return null;
  }
  if (!projectId) {
    return null;
  }
  const settings = url.searchParams.has("settings")
    ? (url.searchParams.get("settings") ?? "")
    : null;
  return { kind: "chart", route: { kind: "chart", projectId, settings } };
}

/** The boot route and the room invitation carried by one launch link. */
export interface BootLinkResolution {
  readonly route: AppRoute;
  readonly invite: string | null;
}

/**
 * Resolve a launch link against the page address.
 *
 * A chart link replaces the page route. A room link leaves the page route in
 * place and travels separately so session restore still works behind it. An
 * unknown link leaves the page route unchanged.
 */
export function resolveBootLink(locationRoute: AppRoute, link: string | null): BootLinkResolution {
  if (!link) {
    return { route: locationRoute, invite: null };
  }
  const parsed = parseAppDeepLink(link);
  if (parsed?.kind === "join") {
    return { route: locationRoute, invite: parsed.link };
  }
  return {
    route: parsed?.kind === "chart" ? parsed.route : locationRoute,
    invite: null,
  };
}
