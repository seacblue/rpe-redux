/** Verifies the shared left/right sweep colours are registered as appearance settings. */
import assert from "node:assert/strict";
import test from "node:test";
import { settingsRegistry } from "../../../core/settings/settings.ts";
import "../../../core/settings/features/appearance.ts";

test("timeline sweep colours use shared operation defaults", () => {
  const add = settingsRegistry.definition("timeline-sweep-add-color");
  const remove = settingsRegistry.definition("timeline-sweep-remove-color");
  assert.equal(add?.navigation, "appearance.notes");
  assert.equal(remove?.navigation, "appearance.notes");
  assert.equal(add?.control, "color");
  assert.equal(remove?.control, "color");
  assert.equal(add?.default, "#33FF33");
  assert.equal(remove?.default, "#FFFFFF");
});
