/** The vertical timeline line colours are registered as shared user settings. */
import assert from "node:assert/strict";
import test from "node:test";
import { settingsRegistry } from "../../../core/settings/settings.ts";
import {
  TIMELINE_VERTICAL_GRID_COLORS,
  timelineVerticalGridColorKey,
} from "../../../core/settings/timelineGridColors.ts";
import "../../../core/settings/features/index.ts";

test("vertical timeline line colours expose the RPE defaults", () => {
  for (const [role, defaultColor] of TIMELINE_VERTICAL_GRID_COLORS) {
    const definition = settingsRegistry.definition(timelineVerticalGridColorKey(role));
    assert.equal(definition?.navigation, "editor.beat-lines");
    assert.equal(definition?.control, "color");
    assert.equal(definition?.default, defaultColor);
  }
});
