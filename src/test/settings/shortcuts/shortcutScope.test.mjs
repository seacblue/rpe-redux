/** Verifies the pure shortcut scope matrix, focus rules, and precedence. */
import assert from "node:assert/strict";
import test from "node:test";
import { shortcutScopeAvailable, shortcutScopePriority } from "../../../core/shortcuts/scope.ts";
import { historyShortcuts } from "../../../core/edit/session/history.ts";
import { playbackShortcuts } from "../../../core/edit/playback/transport.ts";
import {
  claimsLocalShortcut,
  isShortcutBlockingSurface,
  isWindowBlur,
} from "../../../frontend/platform/shortcuts/focus.ts";

const base = {
  atHome: false,
  documentOpen: true,
  modal: "none",
  capturing: false,
  developerMode: true,
  textEntry: false,
  surface: null,
};

test("app commands work on the start page and in text entry", () => {
  assert.equal(shortcutScopeAvailable("app", { ...base, atHome: true, documentOpen: false }), true);
  assert.equal(shortcutScopeAvailable("app", { ...base, textEntry: true, surface: "text" }), true);
  assert.equal(shortcutScopeAvailable("app", { ...base, modal: "normal" }), false);
  assert.equal(shortcutScopeAvailable("app", { ...base, modal: "urgent" }), false);
});

test("instrument commands survive ordinary dialogs but not urgent ones", () => {
  assert.equal(shortcutScopeAvailable("instrument", base), true);
  assert.equal(shortcutScopeAvailable("instrument", { ...base, modal: "normal" }), true);
  assert.equal(shortcutScopeAvailable("instrument", { ...base, modal: "urgent" }), false);
});

test("workspace and editor commands need their own surface", () => {
  assert.equal(shortcutScopeAvailable("workspace", base), true);
  assert.equal(shortcutScopeAvailable("workspace", { ...base, atHome: true }), false);
  assert.equal(shortcutScopeAvailable("workspace", { ...base, textEntry: true }), false);
  assert.equal(shortcutScopeAvailable("workspace", { ...base, surface: "menu" }), false);

  assert.equal(shortcutScopeAvailable("editor", base), true);
  assert.equal(shortcutScopeAvailable("editor", { ...base, atHome: true }), false);
  assert.equal(shortcutScopeAvailable("editor", { ...base, textEntry: true }), false);
  assert.equal(shortcutScopeAvailable("editor", { ...base, surface: "menu" }), false);
  assert.equal(shortcutScopeAvailable("editor", { ...base, modal: "normal" }), false);
});

test("capture owns the keyboard and urgent dialogs own the screen", () => {
  assert.equal(shortcutScopeAvailable("emergency", { ...base, capturing: true }), true);
  assert.equal(shortcutScopeAvailable("app", { ...base, capturing: true }), false);
  assert.equal(shortcutScopeAvailable("modal", { ...base, modal: "urgent" }), true);
  assert.equal(shortcutScopeAvailable("modal", base), false);
});

test("more specific scopes win a shared binding", () => {
  assert.ok(shortcutScopePriority("editor") > shortcutScopePriority("workspace"));
  assert.ok(shortcutScopePriority("workspace") > shortcutScopePriority("app"));
  assert.ok(shortcutScopePriority("app") > shortcutScopePriority("instrument"));
});

test("transport and document history keep their workspace and editor scopes", () => {
  const playPause = playbackShortcuts.find((shortcut) => shortcut.id === "playback.pause");
  const step = playbackShortcuts.find((shortcut) => shortcut.id === "playback.step.next");
  assert.equal(playPause?.scope, "workspace");
  // Stepping still belongs to the timeline, where the arrow keys mean something.
  assert.equal(step?.scope, "editor");
  assert.deepEqual(
    historyShortcuts.map((shortcut) => shortcut.scope),
    ["workspace", "workspace"],
  );
});

test("inline listboxes do not hide workspace shortcuts", () => {
  const target = (kind) => {
    if (kind === "dialog") {
      return { closest: (selector) => (selector.includes("dialog") ? {} : null) };
    }
    if (kind === "picker-listbox") {
      return {
        closest: (selector) => (selector.includes('[role="listbox"]') ? {} : null),
      };
    }
    // An inline list matches the plain listbox selector, but not the selector
    // that excludes surfaces marked with data-inline-shortcut-surface.
    return {
      closest: (selector) =>
        selector.includes(":not([data-inline-shortcut-surface])")
          ? null
          : selector.includes('[role="listbox"]')
            ? {}
            : null,
    };
  };
  assert.equal(isShortcutBlockingSurface(target("dialog")), true);
  assert.equal(isShortcutBlockingSurface(target("picker-listbox")), true);
  // Global timing points are inline; a focused row must not swallow Space.
  assert.equal(isShortcutBlockingSurface(target("inline-listbox")), false);
  assert.equal(isShortcutBlockingSurface(target("button")), false);
  assert.equal(isShortcutBlockingSurface(null), false);
});

test("a local surface claims only the bare keys it declares", () => {
  const target = (declared) => ({
    closest: (selector) =>
      selector === "[data-local-shortcut]" && declared !== null
        ? { getAttribute: () => declared }
        : null,
  });
  assert.equal(claimsLocalShortcut(target("SPACE"), { key: " " }), true);
  assert.equal(claimsLocalShortcut(target("ENTER SPACE"), { key: " " }), true);
  assert.equal(claimsLocalShortcut(target("ENTER"), { key: " " }), false);
  assert.equal(claimsLocalShortcut(target("SPACE"), { key: "Enter" }), false);
  // Modified chords stay global, so Ctrl+Space still reaches preview-only.
  assert.equal(claimsLocalShortcut(target("SPACE"), { key: " ", ctrlKey: true }), false);
  assert.equal(claimsLocalShortcut(target("SPACE"), { key: " ", shiftKey: true }), false);
  assert.equal(claimsLocalShortcut(null, { key: " " }), false);
});

test("a control losing focus is not the window losing focus", () => {
  const windowTarget = {};
  assert.equal(isWindowBlur(windowTarget, windowTarget), true);
  assert.equal(isWindowBlur({}, windowTarget), false);
  assert.equal(isWindowBlur(null, windowTarget), false);
});
