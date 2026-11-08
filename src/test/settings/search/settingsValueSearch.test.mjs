/** Settings search matches control values, including reset and option values. */
import assert from "node:assert/strict";
import test from "node:test";
import { values } from "../../../core/state/values.ts";
import { settingsRegistry } from "../../../core/settings/settings.ts";
import {
  searchSettings,
  settingsPageSearchText,
} from "../../../frontend/screens/settings/settingsCatalog.ts";
import { registerSettingsPage } from "../../../frontend/screens/settings/settingsContributions.ts";

/** Unique suffix so process-wide registries never collide. */
function suffix() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

test("a number setting is searchable by its committed and reset values", () => {
  const key = `test.search.number.${suffix()}`;
  const definition = {
    key,
    navigation: "appearance.notes",
    group: "",
    label: "settings.field.note-size.label",
    control: "number",
    default: 175,
    min: 0,
    max: 400,
    step: 1,
  };
  const dispose = settingsRegistry.registerSetting(definition);
  try {
    assert.ok(searchSettings("175").some((field) => field.key === key));
    values.byId.set(key, 321);
    assert.ok(searchSettings("321").some((field) => field.key === key));
    assert.ok(searchSettings("175").some((field) => field.key === key));
  } finally {
    values.byId.set(key, definition.default);
    dispose();
  }
});

test("a range setting is searchable by the percentage readout it shows", () => {
  const key = `test.search.range.${suffix()}`;
  const definition = {
    key,
    navigation: "appearance.notes",
    group: "",
    label: "settings.field.note-opacity.label",
    control: "range",
    default: 0.2,
    min: 0,
    max: 1,
    step: 0.01,
    percentage: true,
  };
  const dispose = settingsRegistry.registerSetting(definition);
  try {
    assert.ok(searchSettings("20%").some((field) => field.key === key));
  } finally {
    dispose();
  }
});

test("a settings page contributes its dynamic values to search", () => {
  const dispose = registerSettingsPage("test.search.page", {
    searchText: () => ["J", "Open multi-line editing"],
    component: () => null,
  });
  try {
    assert.deepEqual(settingsPageSearchText("test.search.page"), ["J", "Open multi-line editing"]);
  } finally {
    dispose();
  }
});

test("a select setting is searchable by every available option", () => {
  const key = `test.search.select.${suffix()}`;
  const chosen = `preferred-${suffix()}`;
  const definition = {
    key,
    navigation: "appearance.notes",
    group: "",
    label: "settings.field.render-fps.label",
    control: "select",
    default: "30",
    options: [
      { value: "30", label: "settings.option.render-fps.30" },
      { value: "60", label: "settings.option.render-fps.60" },
      { value: chosen, label: "settings.option.render-fps.144" },
    ],
  };
  const dispose = settingsRegistry.registerSetting(definition);
  try {
    assert.ok(searchSettings(chosen).some((field) => field.key === key));
    assert.ok(searchSettings("60 fps").some((field) => field.key === key));
  } finally {
    dispose();
  }
});
