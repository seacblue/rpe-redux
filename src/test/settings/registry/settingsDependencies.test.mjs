/**
 * Built-in settings dependency contract: a dependent row stays visible and is
 * disabled until its gate is satisfied.
 */
import assert from "node:assert/strict";
import test from "node:test";
import "../../../core/settings/features/index.ts";
import { settingsRegistry } from "../../../core/settings/settings.ts";
import { values } from "../../../core/state/values.ts";

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

test("clipboard overview ranges follow the overview bar toggle", () => {
  for (const key of [
    "timeline-clipboard-range-bars-enabled",
    "timeline-clipboard-range-color",
    "timeline-paste-range-color",
    "timeline-range-bar-opacity",
  ]) {
    assert.equal(
      settingsRegistry.definition(key)?.enabledWhen?.key,
      "timeline-density-bars-enabled",
      key,
    );
    assert.equal(settingsRegistry.definition(key)?.enabledWhen?.equals, true, key);
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
