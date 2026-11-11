/** Verifies the custom-scheme links the desktop host accepts. */
import assert from "node:assert/strict";
import test from "node:test";
import { parseAppDeepLink, resolveBootLink } from "../../../core/shell/deepLink.ts";

test("a chart link becomes a chart route with its settings query", () => {
  assert.deepEqual(parseAppDeepLink("rperedux://chart/abc"), {
    kind: "chart",
    route: { kind: "chart", projectId: "abc", settings: null },
  });
  assert.deepEqual(parseAppDeepLink("rperedux://chart/abc?settings=appearance.display"), {
    kind: "chart",
    route: { kind: "chart", projectId: "abc", settings: "appearance.display" },
  });
  assert.deepEqual(parseAppDeepLink("rperedux://chart/a%20b"), {
    kind: "chart",
    route: { kind: "chart", projectId: "a b", settings: null },
  });
});

test("the scheme and host are case-insensitive", () => {
  assert.deepEqual(parseAppDeepLink("RPERedux://CHART/abc"), {
    kind: "chart",
    route: { kind: "chart", projectId: "abc", settings: null },
  });
});

test("a join link is passed through only when it carries the invitation", () => {
  const link = "rperedux://join?server=wss%3A%2F%2Fexample.test&invite=INVITE5678";
  assert.deepEqual(parseAppDeepLink(link), { kind: "join", link });
  assert.equal(parseAppDeepLink("rperedux://join?room=x&invite=y"), null);
});

test("unknown schemes, hosts, and malformed chart paths are rejected", () => {
  assert.equal(parseAppDeepLink("https://example.test/chart/abc"), null);
  assert.equal(parseAppDeepLink("rperedux://library/abc"), null);
  assert.equal(parseAppDeepLink("rperedux://chart"), null);
  assert.equal(parseAppDeepLink("rperedux://chart/abc/extra"), null);
  assert.equal(parseAppDeepLink("rperedux://chart/%E0%A4%A"), null);
  assert.equal(parseAppDeepLink(""), null);
  assert.equal(parseAppDeepLink("not a url"), null);
});

test("the boot route takes a chart link and leaves the location for join links", () => {
  const home = { kind: "home", settings: null };
  const chart = { kind: "chart", projectId: "location", settings: null };
  const join = "rperedux://join?server=wss%3A%2F%2Fexample.test&invite=INVITE5678";

  assert.deepEqual(resolveBootLink(home, "rperedux://chart/abc"), {
    route: { kind: "chart", projectId: "abc", settings: null },
    invite: null,
  });
  assert.deepEqual(resolveBootLink(chart, join), { route: chart, invite: join });
  assert.deepEqual(resolveBootLink(chart, "rperedux://chart/abc"), {
    route: { kind: "chart", projectId: "abc", settings: null },
    invite: null,
  });
  assert.deepEqual(resolveBootLink(chart, "rperedux://unknown"), {
    route: chart,
    invite: null,
  });
  assert.deepEqual(resolveBootLink(home, null), { route: home, invite: null });
});
