/** The developer environment parser keeps host labels stable across agents. */
import assert from "node:assert/strict";
import test from "node:test";
import {
  chromiumVersion,
  describeSystem,
  webViewVersion,
} from "../../frontend/platform/developerEnvironment.ts";

/** A WebView2 agent as the desktop host reports it. */
const webView2 =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0";

test("WebView2 and Chromium versions come from their own user-agent tokens", () => {
  assert.equal(webViewVersion(webView2), "130.0.0.0");
  assert.equal(chromiumVersion(webView2), "130.0.0.0");
  assert.equal(webViewVersion("Mozilla/5.0 Chrome/130.0.0.0"), null);
});

test("Windows names both 10 and 11 and keeps the architecture", () => {
  assert.equal(describeSystem(webView2), "Windows 10/11 · x64");
  assert.equal(describeSystem("Mozilla/5.0 (Windows NT 10.0; ARM64)"), "Windows 10/11 · ARM64");
  assert.equal(describeSystem("Mozilla/5.0 (Windows NT 10.0; WOW64)"), "Windows 10/11 · x86");
});

test("macOS and Linux keep their version and architecture", () => {
  assert.equal(
    describeSystem("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)"),
    "macOS 10.15.7 · x64",
  );
  assert.equal(describeSystem("Mozilla/5.0 (X11; Linux x86_64)"), "Linux · x64");
});

test("an unknown agent is explicit instead of guessed", () => {
  assert.equal(describeSystem("SomethingElse"), "Unknown");
});
