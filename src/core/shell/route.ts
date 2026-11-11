/**
 * The editor's addressable destinations.
 *
 * A route names the window's visible destination - the chart library, an open
 * library project, the anonymous editor, and the settings page above either -
 * without touching the DOM. The browser adapter in `frontend/app/routing/`
 * parses `location`, writes history, and applies the route to the live editor;
 * this module only owns the grammar so every host and test reads it the same.
 */

/** Where the window is pointed, optionally with the settings page open. */
export type AppRoute =
  | { readonly kind: "home"; readonly settings: string | null }
  | { readonly kind: "editor"; readonly settings: string | null }
  | { readonly kind: "chart"; readonly projectId: string; readonly settings: string | null };

/** The query key that opens the settings page above the current destination. */
export const SETTINGS_ROUTE_PARAM = "settings";

/** Ensure a served base is either `/` or a slash-terminated subpath. */
export function normalizeRouteBase(base: string): string {
  const trimmed = base.trim().replace(/\/+/g, "/");
  if (!trimmed || trimmed === "/") {
    return "/";
  }
  const withLeading = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  return withLeading.endsWith("/") ? withLeading : `${withLeading}/`;
}

/**
 * Remove the served base from a pathname and return an app-relative path.
 *
 * A static deployment may live below a repository subpath, so
 * `/RPE-Redux/chart/abc` has to read as `/chart/abc`. A path outside the base
 * belongs to another site and is not a route.
 */
export function routePathFromLocation(pathname: string, base: string): string | null {
  const normalized = normalizeRouteBase(base);
  const path = pathname.startsWith("/") ? pathname : `/${pathname}`;
  if (normalized === "/") {
    return path;
  }
  const root = normalized.slice(0, -1);
  if (path === root) {
    return "/";
  }
  if (path.startsWith(normalized)) {
    return `/${path.slice(normalized.length)}`;
  }
  return null;
}

/** Read the settings value from a query string; `null` means the page is closed. */
function readSettings(search: string): string | null {
  const params = new URLSearchParams(search);
  return params.has(SETTINGS_ROUTE_PARAM) ? (params.get(SETTINGS_ROUTE_PARAM) ?? "") : null;
}

/** Decode one path segment, or return `null` when it is malformed or empty. */
function decodeSegment(value: string): string | null {
  if (!value) {
    return null;
  }
  try {
    return decodeURIComponent(value) || null;
  } catch {
    return null;
  }
}

/**
 * Parse a location into a route.
 *
 * `null` means the path is not one of the app's destinations; the adapter
 * canonicalizes it to the home route instead of rendering an unknown surface.
 */
export function parseRoute(pathname: string, search: string, base: string): AppRoute | null {
  const path = routePathFromLocation(pathname, base);
  if (path === null) {
    return null;
  }
  const normalizedPath = path.length > 1 ? path.replace(/\/+$/, "") : path;
  const segments = normalizedPath.split("/").filter(Boolean);
  const settings = readSettings(search);
  if (segments.length === 0) {
    return { kind: "home", settings };
  }
  if (segments.length === 1 && segments[0] === "editor") {
    return { kind: "editor", settings };
  }
  if (segments.length === 2 && segments[0] === "chart") {
    const projectId = decodeSegment(segments[1]);
    return projectId ? { kind: "chart", projectId, settings } : null;
  }
  return null;
}

/** Parse the hash fragment used by the static web and desktop shells. */
export function parseHashRoute(hash: string): AppRoute | null {
  if (!hash.startsWith("#")) {
    return null;
  }
  const raw = hash.slice(1) || "/";
  if (!raw.startsWith("/")) {
    return null;
  }
  const queryIndex = raw.indexOf("?");
  const pathname = queryIndex < 0 ? raw : raw.slice(0, queryIndex);
  const search = queryIndex < 0 ? "" : raw.slice(queryIndex);
  return parseRoute(pathname, search, "/");
}

/** The app-relative path for one route, before the served base is applied. */
export function routePath(route: AppRoute): string {
  switch (route.kind) {
    case "home":
      return "/";
    case "editor":
      return "/editor";
    case "chart":
      return `/chart/${encodeURIComponent(route.projectId)}`;
  }
}

/**
 * Build the URL for a route.
 *
 * The deployment base stays outside the hash for static assets. The route
 * itself is always a hash destination, so a static host never needs an SPA
 * fallback. `carry` keeps unrelated top-level query keys; the route owns only
 * `settings` and writes it inside the hash.
 */
export function routeUrl(route: AppRoute, base: string, carry?: URLSearchParams): string {
  const outerParams = new URLSearchParams(carry);
  outerParams.delete(SETTINGS_ROUTE_PARAM);
  const routeParams = new URLSearchParams();
  if (route.settings !== null) {
    routeParams.set(SETTINGS_ROUTE_PARAM, route.settings);
  }
  const outerQuery = outerParams.toString();
  const routeQuery = routeParams.toString();
  return `${normalizeRouteBase(base)}${outerQuery ? `?${outerQuery}` : ""}#${routePath(route)}${
    routeQuery ? `?${routeQuery}` : ""
  }`;
}

/** Stable identity for comparing two routes without reading their object shape. */
export function routeKey(route: AppRoute): string {
  return JSON.stringify([
    route.kind,
    route.kind === "chart" ? route.projectId : "",
    route.settings,
  ]);
}

/** Whether two routes point at the same destination and settings page. */
export function sameRoute(left: AppRoute, right: AppRoute): boolean {
  return routeKey(left) === routeKey(right);
}

/** Whether two routes name the same destination, ignoring the settings page. */
export function sameRouteDestination(left: AppRoute, right: AppRoute): boolean {
  if (left.kind !== right.kind) {
    return false;
  }
  if (left.kind === "chart" && right.kind === "chart") {
    return left.projectId === right.projectId;
  }
  return true;
}

/** The history operation one route change needs. */
export type RouteHistoryMode = "push" | "replace";

/**
 * Choose whether a route change opens a new history entry or rewrites the
 * current one.
 *
 * Opening a chart, returning to an open document, opening settings, and the
 * first boot write push. Closing a document, changing or closing a settings
 * page, and a failed explicit boot destination replace. An anonymous editor
 * route that acquires a library project is the same destination, so it keeps
 * one entry.
 */
export function routeHistoryMode(
  previous: AppRoute | null,
  next: AppRoute,
  options: { first: boolean; hasDocument: boolean; failedBootDestination?: boolean },
): RouteHistoryMode {
  if (options.first) {
    return options.failedBootDestination ? "replace" : "push";
  }
  const destinationChanged = previous === null || !sameRouteDestination(previous, next);
  if (previous?.kind === "editor" && next.kind === "chart") {
    return "replace";
  }
  if (destinationChanged) {
    return options.hasDocument ? "push" : "replace";
  }
  const settingsOpened = previous !== null && previous.settings === null && next.settings !== null;
  return settingsOpened ? "push" : "replace";
}

/** Replace only the settings part of a route. */
export function withSettings(route: AppRoute, settings: string | null): AppRoute {
  switch (route.kind) {
    case "home":
      return { kind: "home", settings };
    case "editor":
      return { kind: "editor", settings };
    case "chart":
      return { kind: "chart", projectId: route.projectId, settings };
  }
}
