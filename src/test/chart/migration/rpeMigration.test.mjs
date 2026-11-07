/**
 * RPE settings and hotkey parsing: only fields with a clear counterpart are
 * mapped, and the mapping must not invent commands for unknown RPE actions.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { applyRpeMigrationPlan } from "../../../core/migration/apply.ts";
import { createRpeMigrationPlan, parseRpeHotkeys } from "../../../core/migration/rpe.ts";
import { shortcutRegistry } from "../../../core/shortcuts/registry.ts";
import { defineValue, values } from "../../../core/state/values.ts";

const SETTINGS = JSON.stringify({
  FpsLimit: 120,
  NoteSize: 175,
  BarWidth: 2.5,
  BarAlpha: 0.6,
  RealTimeAlpha: 0.6000000000000001,
  Blur: true,
  HighLight: true,
  MusicVolume: 0.1073,
  SEVolume: 0.0588,
  SElimit: true,
  SElimitNumber: 5,
  ScrollSpeed: 8,
  ScrollAcc: true,
  LineScale: 1.2,
  DefaultColor: [237, 236, 176],
  otherAlpha: 255,
  showViewUI: true,
  AutoSave: true,
  AutoSaveGap: 120,
  AutoSaveLimit: 10,
  ratioWidth: 4,
  ratioHeight: 3,
  GridlineCount: 21,
  maxHistorySize: 999,
  Language: "zh.txt",
});

test("RPE settings map to the visible and runtime settings they share", () => {
  const plan = createRpeMigrationPlan(SETTINGS, "");
  const values = Object.fromEntries(plan.settings.map((setting) => [setting.key, setting.value]));
  assert.equal(values["render-fps"], "120");
  assert.equal(values["note-size"], "175");
  assert.equal(values["timeline-note-size"], "175");
  assert.equal(values["bar-width"], "2.5");
  assert.equal(values["bar-alpha"], "0.6");
  assert.equal(values["realtime-alpha"], "0.6");
  assert.equal(values["background-blur"], "10.5");
  assert.equal(values["highlight-notes"], true);
  assert.equal(values["volume"], "0.1073");
  assert.equal(values["hitsound-tap"], "0.0588");
  assert.equal(values["hitsound-drag"], "0.0588");
  assert.equal(values["hitsound-flick"], "0.0588");
  assert.equal(values["hitsound-custom"], "0.0588");
  assert.equal(values["hitsound-limit-enabled"], true);
  assert.equal(values["hitsound-limit"], "5");
  assert.equal(values["scroll-speed"], "8");
  assert.equal(values["scroll-acceleration"], true);
  assert.equal(values["default-line-thickness"], "1.2");
  assert.equal(values["default-line-color"], "#EDECB0");
  assert.equal(values["preview-non-current-opacity"], "255");
  assert.equal(values["preview-show-game-ui"], true);
  assert.equal(values["autosave-enabled"], true);
  assert.equal(values["autosave-seconds"], "120");
  assert.equal(values["autosave-limit"], "10");
  assert.equal(values["preview-ratio-width"], "4");
  assert.equal(values["preview-ratio-height"], "3");
  assert.equal(values["timeline-grid-count"], "21");
  assert.equal(values["history-limit"], "999");
  assert.equal(plan.language, "zh");
});

test("RPE migration applies red whole-beat lines, green subdivisions, and a grey playhead", () => {
  const plan = createRpeMigrationPlan("", "");
  const values = Object.fromEntries(plan.settings.map((setting) => [setting.key, setting.value]));
  assert.equal(values["timeline-grid-color-1"], "#FF0000");
  for (const denominator of ["2", "3", "4", "6", "8", "12", "16", "default"]) {
    assert.equal(values[`timeline-grid-color-${denominator}`], "#00FF00");
  }
  assert.equal(values["timeline-playhead-color"], "#808080");
});

test("UI.txt beat-line and playhead colours override the RPE defaults", () => {
  const plan = createRpeMigrationPlan(
    "",
    "",
    ["GridColor1 = #112233", "GridColorDefault = #445566", "PlayheadColor = #778899"].join("\r\n"),
  );
  const values = Object.fromEntries(plan.settings.map((setting) => [setting.key, setting.value]));
  assert.equal(values["timeline-grid-color-1"], "#112233");
  assert.equal(values["timeline-grid-color-default"], "#445566");
  assert.equal(values["timeline-playhead-color"], "#778899");
  assert.equal(values["timeline-grid-color-4"], "#00FF00");
});

test("RPE colour arrays and CSS rgba values preserve alpha", () => {
  const plan = createRpeMigrationPlan(
    JSON.stringify({ DefaultColor: [17, 34, 51, 0.5] }),
    "",
    "GridColor1 = rgba(68, 85, 102, 0.25)",
  );
  const values = Object.fromEntries(plan.settings.map((setting) => [setting.key, setting.value]));
  assert.equal(values["default-line-color"], "#11223380");
  assert.equal(values["timeline-grid-color-1"], "#44556640");
});

test("RPE hotkeys map only commands this editor owns", () => {
  const plan = createRpeMigrationPlan(
    "",
    [
      "AddTap A",
      "AddHold F",
      "AddEvent F",
      "Delete DELETE",
      "Copy LEFTCTRL&C",
      "KeepTimePaste LEFTCTRL&LEFTSHIFT&V",
      "Undo LEFTCTRL&Z",
      "Redo LEFTCTRL&Y",
      "ShowLineInfo TAB",
      "CurveBegin LEFTCTRL&F",
      "SwitchMulti J",
      "SwitchMultiMode K",
      "UnknownAction X",
      "AddFlick LEFTCTRL&",
    ].join("\r\n"),
  );
  const bindings = Object.fromEntries(
    plan.shortcuts.map((shortcut) => [shortcut.id, shortcut.bindings]),
  );
  assert.deepEqual(bindings["note.place.tap"], ["A"]);
  assert.deepEqual(bindings["note.place.hold"], ["F"]);
  assert.deepEqual(bindings["event.place"], ["F"]);
  assert.deepEqual(bindings["edit.delete"], ["DELETE"]);
  assert.deepEqual(bindings["edit.copy"], ["CTRL+C"]);
  assert.deepEqual(bindings["edit.paste.keepTime"], ["CTRL+SHIFT+V"]);
  assert.deepEqual(bindings["edit.undo"], ["CTRL+Z"]);
  assert.deepEqual(bindings["edit.redo"], ["CTRL+Y"]);
  assert.deepEqual(bindings["view.showLineInfo"], ["TAB"]);
  assert.deepEqual(bindings["event.trajectory.capture.begin"], ["CTRL+F"]);
  assert.deepEqual(bindings["workspace.multiLine.toggle"], ["J"]);
  assert.deepEqual(bindings["workspace.multiLine.switchMode"], ["K"]);
  assert.equal(bindings.unknown, undefined);
  assert.equal(bindings["note.place.flick"], undefined);
});

test("RPE hotkey parsing is a pure sidecar reader", () => {
  assert.deepEqual(parseRpeHotkeys("AddTap A\r\nPause SPACE"), [
    { id: "note.place.tap", bindings: ["A"] },
    { id: "playback.pause", bindings: ["SPACE"] },
  ]);
});

test("applying a plan writes only declared settings and shortcuts", () => {
  defineValue({ id: "rpe-migration-test-setting", initial: "0" });
  const dispose = shortcutRegistry.registerShortcut({
    id: "rpe.migration.test",
    category: "test",
    title: "test",
    scope: "app",
    defaults: [{ key: "A" }],
  });
  try {
    const result = applyRpeMigrationPlan({
      settings: [
        { key: "rpe-migration-test-setting", value: "42" },
        { key: "missing-setting", value: true },
      ],
      shortcuts: [
        { id: "rpe.migration.test", bindings: ["CTRL+K"] },
        { id: "missing.shortcut", bindings: ["A"] },
      ],
      language: null,
      warnings: ["source warning"],
    });
    assert.equal(values.byId.get("rpe-migration-test-setting"), "42");
    assert.deepEqual(shortcutRegistry.bindingsOf("rpe.migration.test"), [
      { key: "K", modifiers: ["CTRL"] },
    ]);
    assert.equal(result.settings, 1);
    assert.equal(result.shortcuts, 1);
    assert.equal(result.warnings.length, 3);
  } finally {
    dispose();
  }
});
