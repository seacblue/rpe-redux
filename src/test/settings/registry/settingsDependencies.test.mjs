/**
 * Built-in settings dependency contract: a dependent row stays visible and is
 * disabled until its gate is satisfied.
 */
import assert from "node:assert/strict";
import test from "node:test";
import "../../../core/settings/features/index.ts";
import { settingsRegistry } from "../../../core/settings/settings.ts";
import { values } from "../../../core/state/values.ts";
import { readEditorDisplaySettings } from "../../../frontend/screens/settings/editorDisplaySettings.ts";

test("built-in settings do not hide dependent rows", () => {
  for (const definition of settingsRegistry.definitions()) {
    assert.equal(
      definition.visibleWhen,
      undefined,
      `${definition.key} hides instead of disabling its dependency`,
    );
  }
});

test("every dependency names a registered setting value", () => {
  for (const definition of settingsRegistry.definitions()) {
    for (const condition of [definition.enabledWhen, definition.disabledWhen]) {
      if (!condition) {
        continue;
      }
      assert.ok(
        values.byId.has(condition.key),
        `${definition.key} depends on missing value ${condition.key}`,
      );
    }
  }
});

test("waveform controls follow the waveform toggle", () => {
  for (const key of ["audio-analysis-alpha", "audio-analysis-width", "audio-analysis-curve"]) {
    assert.equal(settingsRegistry.definition(key)?.enabledWhen?.key, "audio-analysis-enabled", key);
  }
});

test("waveform contrast defaults to one and stays within the configured range", () => {
  const alpha = settingsRegistry.definition("audio-analysis-alpha");
  const curve = settingsRegistry.definition("audio-analysis-curve");
  assert.equal(alpha?.default, 0.5);
  assert.equal(curve?.default, 1);
  assert.equal(curve?.min, 0.2);
  assert.equal(curve?.max, 2);
});

test("autosave timing rows follow autosave-enabled", () => {
  for (const key of ["autosave-seconds", "autosave-limit"]) {
    assert.equal(settingsRegistry.definition(key)?.enabledWhen?.key, "autosave-enabled", key);
  }
});

test("preview and timeline sub-options follow their parent toggles", () => {
  assert.equal(
    settingsRegistry.definition("preview-game-ui-corner-compression")?.enabledWhen?.key,
    "preview-show-game-ui",
  );
  assert.equal(
    settingsRegistry.definition("timeline-overview-strip-width")?.enabledWhen?.key,
    "timeline-density-bars-enabled",
  );
  assert.equal(
    settingsRegistry.definition("timeline-hover-preview-enabled")?.enabledWhen?.key,
    "timeline-density-bars-enabled",
  );
});

test("note and event marquee colours share the default", () => {
  assert.equal(settingsRegistry.definition("timeline-note-marquee-color")?.default, "#00C800");
  assert.equal(settingsRegistry.definition("timeline-event-marquee-color")?.default, "#00C800");
});

test("clipboard ghosts follow the overview bar toggle", () => {
  assert.equal(settingsRegistry.definition("timeline-clipboard-range-bars-enabled")?.default, true);
  assert.equal(
    settingsRegistry.definition("timeline-clipboard-range-bars-enabled")?.enabledWhen?.key,
    "timeline-density-bars-enabled",
  );
  assert.equal(
    settingsRegistry.definition("timeline-clipboard-range-bars-enabled")?.enabledWhen?.equals,
    true,
  );
});

test("clipboard ghost opacity is a percentage range gated by the ghost toggle", () => {
  const opacity = settingsRegistry.definition("timeline-clipboard-ghost-opacity");
  assert.equal(opacity?.control, "range");
  assert.equal(opacity?.default, 0.2);
  assert.equal(opacity?.min, 0);
  assert.equal(opacity?.max, 1);
  assert.equal(opacity?.step, 0.01);
  assert.equal(opacity?.percentage, true);
  assert.equal(opacity?.enabledWhen?.key, "timeline-clipboard-range-bars-enabled");
  assert.equal(opacity?.enabledWhen?.equals, true);
});

test("nearby note merging gates its distance input", () => {
  const enabled = settingsRegistry.definition("note-nearby-merge-enabled");
  const distance = settingsRegistry.definition("note-overlap-threshold");
  assert.equal(enabled?.control, "toggle");
  assert.equal(enabled?.default, true);
  assert.equal(distance?.control, "number");
  assert.equal(distance?.default, 50);
  assert.equal(distance?.enabledWhen?.key, "note-nearby-merge-enabled");
  assert.equal(distance?.enabledWhen?.equals, true);
});

test("disabling nearby note merging removes its distance from the runtime", () => {
  const previous = values.byId.get("note-nearby-merge-enabled");
  try {
    values.byId.set("note-nearby-merge-enabled", false);
    assert.equal(readEditorDisplaySettings().timeline.overlapThreshold, 0);
    values.byId.set("note-nearby-merge-enabled", true);
    assert.equal(readEditorDisplaySettings().timeline.overlapThreshold, 50);
  } finally {
    values.byId.set("note-nearby-merge-enabled", previous);
  }
});

test("merged multi-line note labels follow the merge-notes setting", () => {
  const merge = settingsRegistry.definition("multi-line-merge-notes");
  const labels = settingsRegistry.definition("multi-line-note-line-numbers");
  assert.equal(merge?.control, "toggle");
  assert.equal(merge?.default, true);
  assert.equal(labels?.control, "toggle");
  assert.equal(labels?.enabledWhen?.key, "multi-line-merge-notes");
  assert.equal(labels?.enabledWhen?.equals, true);
});

test("the AI service port follows the code-cell toggle", () => {
  assert.equal(settingsRegistry.definition("ai-port")?.enabledWhen?.key, "code-execution-enabled");
  assert.equal(settingsRegistry.definition("ai-port")?.enabledWhen?.equals, true);
});

test("the update download policy follows the automatic update toggle", () => {
  const autoCheck = settingsRegistry.definition("update-auto-check");
  const downloadPolicy = settingsRegistry.definition("update-download-policy");
  assert.equal(autoCheck?.default, true);
  assert.equal(downloadPolicy?.enabledWhen?.key, "update-auto-check");
  assert.equal(downloadPolicy?.enabledWhen?.equals, true);
});
