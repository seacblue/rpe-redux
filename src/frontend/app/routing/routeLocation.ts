/**
 * Browser address adapter for the route grammar.
 *
 * Vite bakes the deployment base into the bundle, so the same code reads
 * `/chart/abc` on a root deployment and `/RPE-Redux/chart/abc` on a project
 * Pages site. History writes preserve unrelated query keys.
 */
import {
  normalizeRouteBase,
  parseRoute,
  routeUrl,
  type AppRoute,
} from "../../../core/shell/route.ts";

/** The served base Vite built this bundle for, always slash-terminated. */
export const ROUTE_BASE = normalizeRouteBase(import.meta.env.BASE_URL);

/** Parse the current address, or null when the path is not a route. */
export function readLocationRoute(): AppRoute | null {
  return parseRoute(window.location.pathname, window.location.search, ROUTE_BASE);
}

/** The current address as a route; unknown paths read as home. */
export function currentLocationRoute(): AppRoute {
  return readLocationRoute() ?? { kind: "home", settings: null };
}

/** Build the URL for a route, carrying unrelated query keys. */
export function urlForRoute(route: AppRoute): string {
  return routeUrl(route, ROUTE_BASE, new URLSearchParams(window.location.search));
}

/** Write one route into history. */
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
 * A trailing slash, an old bare `editor` path, or an unknown path is rewritten
 * before React mounts so the first frame and the address agree.
 */
export function initializeLocationRoute(): AppRoute {
  const parsed = readLocationRoute();
  const route = parsed ?? { kind: "home", settings: null };
  const canonical = urlForRoute(route);
  const current = `${window.location.pathname}${window.location.search}`;
  if (parsed === null || current !== canonical) {
    window.history.replaceState(null, "", canonical);
  }
  return route;
}
