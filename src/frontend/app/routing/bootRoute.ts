/**
 * Resolves the first destination from the page address and the desktop link.
 *
 * On the web the address is the whole story. On the desktop host a chart
 * `rperedux://` link received at launch replaces the page address, while a room
 * link is held for the collaboration runtime and leaves the normal boot path in
 * place.
 */
import { isDesktop } from "../../../core/platform/environment.ts";
import { resolveBootLink } from "../../../core/shell/deepLink.ts";
import type { AppRoute } from "../../../core/shell/route.ts";
import { readDesktopDeepLink, setPendingDesktopInvite } from "../../platform/desktopDeepLink.ts";
import { initializeLocationRoute } from "./routeLocation.ts";

/** Resolve the first route, giving an explicit chart link precedence. */
export async function initializeBootRoute(): Promise<AppRoute> {
  const locationRoute = initializeLocationRoute();
  if (!isDesktop()) {
    return locationRoute;
  }
  const link = await readDesktopDeepLink();
  const resolved = resolveBootLink(locationRoute, link);
  if (resolved.invite) {
    setPendingDesktopInvite(resolved.invite);
  }
  return resolved.route;
}
