/** The hooked-event colour follows the theme until the settings row is changed. */
import assert from "node:assert/strict";
import test from "node:test";
import {
  colorSettingOverride,
  EVENT_HOOKED_COLOR_KEY,
} from "../../../frontend/screens/editor/canvas/palette.ts";
import { settingsRegistry } from "../../../core/settings/settings.ts";
import { values } from "../../../core/state/values.ts";
import "../../../core/settings/features/editingSettings.ts";

/** Restore one setting to its schema default when the test is done. */
function resetSetting(key) {
  const fallback = settingsRegistry.definition(key)?.default;
  if (fallback !== undefined) {
    values.byId.set(key, fallback);
  }
}

test("an untouched hooked-colour row leaves the theme in charge", () => {
  try {
    resetSetting(EVENT_HOOKED_COLOR_KEY);
    assert.equal(colorSettingOverride(EVENT_HOOKED_COLOR_KEY), "");
  } finally {
    resetSetting(EVENT_HOOKED_COLOR_KEY);
  }
});

test("a changed hooked-colour row overrides the theme", () => {
  try {
    values.byId.set(EVENT_HOOKED_COLOR_KEY, "#ff8800");
    assert.equal(colorSettingOverride(EVENT_HOOKED_COLOR_KEY), "#ff8800");
  } finally {
    resetSetting(EVENT_HOOKED_COLOR_KEY);
  }
});

test("the hooked-colour row is a colour setting on the event page", () => {
  const definition = settingsRegistry.definition(EVENT_HOOKED_COLOR_KEY);
  assert.equal(definition?.control, "color");
  assert.equal(definition?.navigation, "editor.events");
  assert.equal(definition?.default, "#62D8F2");
});
