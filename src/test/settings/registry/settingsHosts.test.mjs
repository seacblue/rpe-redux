/** Host-scoped settings rows and pages follow the Tauri host boundary. */
import assert from "node:assert/strict";
import test from "node:test";
import { settingsRegistry } from "../../../core/settings/settings.ts";
import {
  searchSettings,
  settingsFields,
  settingsNavigations,
} from "../../../frontend/screens/settings/settingsCatalog.ts";

/** Run one assertion pass with the Tauri host marker present or absent. */
function withHost(desktop, run) {
  const hadMarker = Object.hasOwn(globalThis, "__TAURI_INTERNALS__");
  const previous = globalThis.__TAURI_INTERNALS__;
  if (desktop) {
    globalThis.__TAURI_INTERNALS__ = {};
  } else {
    delete globalThis.__TAURI_INTERNALS__;
  }
  try {
    return run();
  } finally {
    if (hadMarker) {
      globalThis.__TAURI_INTERNALS__ = previous;
    } else {
      delete globalThis.__TAURI_INTERNALS__;
    }
  }
}

test("built-in window rows are visible only on the desktop host", () => {
  withHost(false, () => {
    const fields = settingsFields("general.interface");
    assert.equal(
      fields.some((field) => field.key === "window-resolution"),
      false,
    );
    assert.equal(
      fields.some((field) => field.key === "window-display-mode"),
      false,
    );
    assert.equal(
      searchSettings("resolution").some((field) => field.key === "window-resolution"),
      false,
    );
    assert.equal(
      searchSettings("fullscreen").some((field) => field.key === "window-display-mode"),
      false,
    );
  });
  withHost(true, () => {
    assert.equal(
      settingsFields("general.interface").some((field) => field.key === "window-resolution"),
      true,
    );
    assert.equal(
      searchSettings("resolution").some((field) => field.key === "window-resolution"),
      true,
    );
  });
});

test("desktop-only settings pages disappear on the web host", () => {
  const desktopOnly = ["files", "extensions", "general.codeCell"];
  withHost(false, () => {
    const keys = settingsNavigations().map((entry) => entry.key);
    for (const key of desktopOnly) {
      assert.equal(keys.includes(key), false, `${key} should be hidden on web`);
    }
    assert.equal(keys.includes("general"), true);
    assert.equal(keys.includes("help"), true);
  });
  withHost(true, () => {
    const keys = settingsNavigations().map((entry) => entry.key);
    for (const key of desktopOnly) {
      assert.equal(keys.includes(key), true, `${key} should be visible on desktop`);
    }
  });
});

test("a host-scoped contribution follows the same host boundary", () => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const key = `test.hosts.${suffix}`;
  const navigation = `test.hosts.page.${suffix}`;
  const disposeNavigation = settingsRegistry.registerNavigation({
    key: navigation,
    label: "settings.category.help.label",
    hosts: ["desktop"],
  });
  const disposeSetting = settingsRegistry.registerSetting({
    key,
    navigation: "general.interface",
    group: "",
    label: "settings.field.window-resolution.label",
    control: "select",
    default: "auto",
    options: [{ value: "auto", label: "settings.option.window-resolution.auto" }],
    hosts: ["desktop"],
  });
  try {
    withHost(false, () => {
      assert.equal(
        settingsFields("general.interface").some((field) => field.key === key),
        false,
      );
      assert.equal(
        settingsNavigations().some((entry) => entry.key === navigation),
        false,
      );
    });
    withHost(true, () => {
      assert.equal(
        settingsFields("general.interface").some((field) => field.key === key),
        true,
      );
      assert.equal(
        settingsNavigations().some((entry) => entry.key === navigation),
        true,
      );
    });
  } finally {
    disposeSetting();
    disposeNavigation();
  }
});
