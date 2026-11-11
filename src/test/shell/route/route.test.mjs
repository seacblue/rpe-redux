/** Verifies the route grammar shared by the web and desktop hosts. */
import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeRouteBase,
  parseHashRoute,
  parseRoute,
  routeHistoryMode,
  routeKey,
  routePath,
  routeUrl,
  sameRoute,
  sameRouteDestination,
  withSettings,
} from "../../../core/shell/route.ts";

test("hash routes parse independently of the deployment base", () => {
  assert.deepEqual(parseHashRoute("#/"), { kind: "home", settings: null });
  assert.deepEqual(parseHashRoute("#/editor"), { kind: "editor", settings: null });
  assert.deepEqual(parseHashRoute("#/chart/a%20b?settings=general"), {
    kind: "chart",
    projectId: "a b",
    settings: "general",
  });
  assert.equal(parseHashRoute("/chart/abc"), null);
});

test("bases normalize to a leading and trailing slash", () => {
  assert.equal(normalizeRouteBase(""), "/");
  assert.equal(normalizeRouteBase("/"), "/");
  assert.equal(normalizeRouteBase("RPE-Redux"), "/RPE-Redux/");
  assert.equal(normalizeRouteBase("/RPE-Redux"), "/RPE-Redux/");
  assert.equal(normalizeRouteBase("/RPE-Redux/"), "/RPE-Redux/");
  assert.equal(normalizeRouteBase("/RPE-Redux//"), "/RPE-Redux/");
});

test("home, editor, and chart paths parse into routes", () => {
  assert.deepEqual(parseRoute("/", "", "/"), { kind: "home", settings: null });
  assert.deepEqual(parseRoute("/editor", "", "/"), { kind: "editor", settings: null });
  assert.deepEqual(parseRoute("/chart/abc", "", "/"), {
    kind: "chart",
    projectId: "abc",
    settings: null,
  });
  assert.deepEqual(parseRoute("/chart/abc/", "", "/"), {
    kind: "chart",
    projectId: "abc",
    settings: null,
  });
  assert.deepEqual(parseRoute("/RPE-Redux/chart/a%20b", "", "/RPE-Redux/"), {
    kind: "chart",
    projectId: "a b",
    settings: null,
  });
});

test("unknown and malformed paths do not become routes", () => {
  assert.equal(parseRoute("/missing", "", "/"), null);
  assert.equal(parseRoute("/chart", "", "/"), null);
  assert.equal(parseRoute("/chart/abc/extra", "", "/"), null);
  assert.equal(parseRoute("/chart/%E0%A4%A", "", "/"), null);
  assert.equal(parseRoute("/chart/", "", "/"), null);
});

test("the settings query opens the same destination", () => {
  assert.deepEqual(parseRoute("/chart/abc", "?settings=general", "/"), {
    kind: "chart",
    projectId: "abc",
    settings: "general",
  });
  assert.deepEqual(parseRoute("/", "?settings=appearance.skin", "/"), {
    kind: "home",
    settings: "appearance.skin",
  });
  assert.deepEqual(parseRoute("/", "?settings", "/"), { kind: "home", settings: "" });
  assert.deepEqual(parseRoute("/", "?other=1", "/"), { kind: "home", settings: null });
});

test("route URLs keep the base, encode ids, and rewrite only settings", () => {
  assert.equal(routeUrl({ kind: "home", settings: null }, "/"), "/#/");
  assert.equal(
    routeUrl({ kind: "chart", projectId: "a/b", settings: null }, "/RPE-Redux/"),
    "/RPE-Redux/#/chart/a%2Fb",
  );
  assert.equal(
    routeUrl({ kind: "chart", projectId: "abc", settings: "appearance.skin" }, "/"),
    "/#/chart/abc?settings=appearance.skin",
  );
  const carry = new URLSearchParams("window=debug&settings=old");
  assert.equal(
    routeUrl({ kind: "chart", projectId: "abc", settings: null }, "/", carry),
    "/?window=debug#/chart/abc",
  );
  assert.equal(
    routeUrl({ kind: "home", settings: "" }, "/", new URLSearchParams("window=debug")),
    "/?window=debug#/?settings=",
  );
});

test("route identity compares destination and settings, not object identity", () => {
  const left = { kind: "chart", projectId: "abc", settings: null };
  const right = { kind: "chart", projectId: "abc", settings: null };
  assert.equal(routeKey(left), routeKey(right));
  assert.equal(sameRoute(left, right), true);
  assert.equal(sameRoute(left, withSettings(left, "general")), false);
  assert.deepEqual(withSettings(left, "general"), {
    kind: "chart",
    projectId: "abc",
    settings: "general",
  });
  assert.equal(routePath(left), "/chart/abc");
});

test("destination identity ignores the settings page", () => {
  const chart = { kind: "chart", projectId: "abc", settings: null };
  assert.equal(sameRouteDestination(chart, withSettings(chart, "general")), true);
  assert.equal(
    sameRouteDestination(chart, { kind: "chart", projectId: "other", settings: null }),
    false,
  );
  assert.equal(sameRouteDestination(chart, { kind: "home", settings: null }), false);
});

test("history mode pushes new destinations and replaces closing or settings changes", () => {
  const home = { kind: "home", settings: null };
  const chart = { kind: "chart", projectId: "abc", settings: null };
  const editor = { kind: "editor", settings: null };

  assert.equal(routeHistoryMode(null, home, { first: true, hasDocument: false }), "push");
  assert.equal(
    routeHistoryMode(null, home, {
      first: true,
      hasDocument: false,
      failedBootDestination: true,
    }),
    "replace",
  );
  assert.equal(routeHistoryMode(null, chart, { first: true, hasDocument: true }), "push");
  assert.equal(routeHistoryMode(home, chart, { first: false, hasDocument: true }), "push");
  assert.equal(routeHistoryMode(chart, home, { first: false, hasDocument: true }), "push");
  assert.equal(routeHistoryMode(chart, home, { first: false, hasDocument: false }), "replace");
  assert.equal(routeHistoryMode(editor, chart, { first: false, hasDocument: true }), "replace");
  assert.equal(
    routeHistoryMode(home, withSettings(home, "general"), { first: false, hasDocument: false }),
    "push",
  );
  assert.equal(
    routeHistoryMode(withSettings(home, "general"), home, { first: false, hasDocument: false }),
    "replace",
  );
  assert.equal(
    routeHistoryMode(withSettings(chart, "general"), withSettings(chart, "audio"), {
      first: false,
      hasDocument: true,
    }),
    "replace",
  );
});
