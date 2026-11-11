/**
 * Browser address adapter for the route grammar.
 *
 * Vite bakes the deployment base into the bundle for static assets, while the
 * visible destination stays after `#`. Hash routes therefore work on root and
 * project Pages sites without a server-side fallback. Top-level query keys not
 * owned by routing are preserved.
 */
import {
  normalizeRouteBase,
  parseHashRoute,
  routeUrl,
  type AppRoute,
} from "../../../core/shell/route.ts";

/** The served base Vite built this bundle for, always slash-terminated. */
export const ROUTE_BASE = normalizeRouteBase(import.meta.env.BASE_URL);

/** Parse the current hash address, or null when the fragment is not a route. */
export function readLocationRoute(): AppRoute | null {
  if (!window.location.hash) {
    return { kind: "home", settings: null };
  }
  return parseHashRoute(window.location.hash);
}

/** The current address as a route; unknown paths read as home. */
export function currentLocationRoute(): AppRoute {
  return readLocationRoute() ?? { kind: "home", settings: null };
}

/** Build the URL for a route, carrying unrelated query keys. */
export function urlForRoute(route: AppRoute): string {
  return routeUrl(route, ROUTE_BASE, new URLSearchParams(window.location.search));
}

/** Write one hash route into browser history. */
export function writeLocationRoute(route: AppRoute, mode: "push" | "replace"): void {
  const url = urlForRoute(route);
  if (mode === "push") {
    window.history.pushState(null, "", url);
  } else {
    window.history.replaceState(null, "", url);
  }
}

/**
 * Normalize the first location and return its route.
 *
 * A missing or malformed hash is rewritten before React mounts so the first
 * frame and the address agree. The pathname remains the deployment root.
 */
export function initializeLocationRoute(): AppRoute {
  const parsed = readLocationRoute();
  const route = parsed ?? { kind: "home", settings: null };
  const canonical = urlForRoute(route);
  const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (parsed === null || current !== canonical) {
    window.history.replaceState(null, "", canonical);
  }
  return route;
}
