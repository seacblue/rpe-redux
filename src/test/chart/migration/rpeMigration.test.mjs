/**
 * RPE settings and hotkey parsing: only fields with a clear counterpart are
 * mapped, and the mapping must not invent commands for unknown RPE actions.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { applyRpeMigrationPlan } from "../../../core/migration/apply.ts";
import {
  createRpeMigrationPlan,
  filterRpeMigrationPlan,
  parseRpeHotkeys,
} from "../../../core/migration/rpe.ts";
import { buildSettingRows } from "../../../frontend/screens/welcome/rpeImportReview.ts";
import { setLanguage } from "../../../i18n/index.ts";
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

test("RPE interaction and display toggles map to their editor rows", () => {
  const plan = createRpeMigrationPlan(
    JSON.stringify({
      CutRho: 2,
      clickLine: true,
      showHotkey: true,
      UndoJump: true,
      ShowLineInfo: false,
      highlightNear: true,
      density: true,
      unionLine: true,
      CrushNice: true,
      SEOffset: [0.02, -0.01],
      scrollValueIncrement: [5, 5, 0.5, 5, 0.1, 0.1, 0.1],
    }),
    "",
  );
  const values = Object.fromEntries(plan.settings.map((setting) => [setting.key, setting.value]));
  assert.equal(values["event-cut-density"], "2");
  assert.equal(values["pick-preview-lines"], true);
  assert.equal(values["key-press-label-enabled"], true);
  assert.equal(values["timeline-undo-jump"], true);
  assert.equal(values["line-numbers"], false);
  assert.equal(values["hover-guides-enabled"], true);
  assert.equal(values["timeline-density-bars-enabled"], true);
  assert.equal(values["merge-line-numbers"], true);
  assert.equal(values["xy-binding"], true);
  // RPE stores the two hit-sound delay channels in seconds.
  assert.equal(values["hitsound-offset-tap"], "20");
  assert.equal(values["hitsound-offset-flick"], "20");
  assert.equal(values["hitsound-offset-drag"], "-10");
  assert.equal(values["event-wheel-increments"], "[5,5,0.5,5,0.1,0.1,0.1]");
  assert.deepEqual(plan.unmapped, []);
});

test("settings without a destination are detected and reported", () => {
  const plan = createRpeMigrationPlan(
    JSON.stringify({
      AttachTime: false,
      density: false,
      AutoStick: true,
      fastEdit: false,
      windowConfig: { hideSide: false, leftOffset: 15 },
    }),
    "",
  );
  assert.deepEqual(
    plan.unmapped.map((field) => [field.key, field.value]),
    [
      ["AttachTime", false],
      ["AutoStick", true],
      ["fastEdit", false],
      ["windowConfig", '{"hideSide":false,"leftOffset":15}'],
    ],
  );
  // Chat/account fields and the RPE tips toggle stay out of the review.
  const ignored = createRpeMigrationPlan(
    JSON.stringify({
      userName: "chart author",
      enableChat: true,
      TipsOn: true,
      density: true,
    }),
    "",
  );
  assert.deepEqual(ignored.unmapped, []);
});

test("RPE background brightness and X/Y binding map to their editor rows", () => {
  const plan = createRpeMigrationPlan(JSON.stringify({ Alpha: 50, xybind: true }), "");
  const values = Object.fromEntries(plan.settings.map((setting) => [setting.key, setting.value]));
  // RPE stores 0-255 brightness where 255 is untouched; 50/255 rounds to 0.2.
  assert.equal(values["background-brightness"], "0.2");
  assert.equal(values["xy-binding"], true);
  assert.deepEqual(plan.unmapped, []);
});

test("source colour aliases are imported instead of reported as unmapped", () => {
  const plan = createRpeMigrationPlan(
    JSON.stringify({ GridColor1: "#112233", PlayheadColor: "#445566", AttachTime: false }),
    "",
  );
  assert.deepEqual(
    plan.unmapped.map((field) => field.key),
    ["AttachTime"],
  );
  const values = Object.fromEntries(plan.settings.map((setting) => [setting.key, setting.value]));
  assert.equal(values["timeline-grid-color-1"], "#112233");
  assert.equal(values["timeline-playhead-color"], "#445566");
});

test("an installation without colour fields keeps the editor palette", () => {
  const plan = createRpeMigrationPlan("", "");
  assert.deepEqual(
    plan.settings.map((setting) => setting.key),
    [],
  );
});

test("UI.txt colours write only the entries the source carries", () => {
  const plan = createRpeMigrationPlan(
    "",
    "",
    ["GridColor1 = #112233", "GridColorDefault = #445566", "PlayheadColor = #778899"].join("\r\n"),
  );
  const values = Object.fromEntries(plan.settings.map((setting) => [setting.key, setting.value]));
  assert.equal(values["timeline-grid-color-1"], "#112233");
  assert.equal(values["timeline-grid-color-default"], "#445566");
  assert.equal(values["timeline-playhead-color"], "#778899");
  assert.equal(values["timeline-grid-color-4"], undefined);
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
      "PasteMirror LEFTCTRL&B",
      "KeepTimePasteMirror LEFTCTRL&LEFTSHIFT&B",
      "ClearClip LEFTALT&Z",
      "JumpClip LEFTALT&A",
      "PageLeft LEFTARROW",
      "PageRight RIGHTARROW",
      "PageUp UPARROW",
      "PageDown DOWNARROW",
      "StartView I",
      "EndView O",
      "JumpView P",
      "ReplayView LEFTBRACKET",
      "StartView_HOLD T",
      "JumpView_HOLD U",
      "Switch LEFTALT&1",
      "SwitchLine LEFTCTRL",
      "TimeAttach LEFTCTRL&H",
      "SwitchUI LEFTALT&N",
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
  assert.deepEqual(bindings["edit.paste.mirror"], ["CTRL+B"]);
  assert.deepEqual(bindings["edit.paste.keepTimeMirror"], ["CTRL+SHIFT+B"]);
  assert.deepEqual(bindings["edit.clipboard.clear"], ["ALT+Z"]);
  assert.deepEqual(bindings["edit.clipboard.jumpStart"], ["ALT+A"]);
  assert.deepEqual(bindings["selection.nudge.left"], ["LEFTARROW"]);
  assert.deepEqual(bindings["selection.nudge.right"], ["RIGHTARROW"]);
  assert.deepEqual(bindings["selection.nudge.up"], ["UPARROW"]);
  assert.deepEqual(bindings["selection.nudge.down"], ["DOWNARROW"]);
  assert.deepEqual(bindings["playback.start"], ["I"]);
  assert.deepEqual(bindings["playback.stop"], ["O"]);
  assert.deepEqual(bindings["playback.stopStay"], ["P"]);
  assert.deepEqual(bindings["playback.replay"], ["LEFTBRACKET"]);
  assert.deepEqual(bindings["view.previewAudition"], ["T"]);
  assert.deepEqual(bindings["view.previewAuditionStay"], ["U"]);
  assert.deepEqual(bindings["navigation.line.next"], ["ALT+1"]);
  assert.deepEqual(bindings["navigation.line.jump"], ["CTRL"]);
  assert.deepEqual(bindings["timeline.toggleSnapX"], ["CTRL+H"]);
  assert.deepEqual(bindings["view.toggleNotesEvents"], ["ALT+N"]);
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

test("the review lists only rows the import can apply", () => {
  const plan = createRpeMigrationPlan(
    JSON.stringify({ density: true, AttachTime: false, fastEdit: false }),
    "",
  );
  const rows = buildSettingRows(plan);
  assert.deepEqual(
    rows.map((row) => row.kind),
    ["setting"],
  );
  assert.equal(rows[0].label, "Show timeline overview bars");
  // Unmapped fields are still detected for diagnostics, but the review does
  // not render them.
  assert.deepEqual(
    plan.unmapped.map((field) => field.key),
    ["AttachTime", "fastEdit"],
  );
  const filtered = filterRpeMigrationPlan(plan, {
    settingKeys: ["timeline-density-bars-enabled"],
    applyShortcuts: false,
    applyLanguage: false,
  });
  assert.deepEqual(filtered.unmapped, plan.unmapped);
});

test("the review labels hit-sound offsets and names every wheel channel", () => {
  setLanguage("zh");
  try {
    const plan = createRpeMigrationPlan(
      JSON.stringify({
        SEOffset: [0.015, -0.01],
        scrollValueIncrement: [5, 5, 0.5, 5, 0.1, 0.1, 0.1],
      }),
      "",
    );
    const rows = buildSettingRows(plan);
    const offset = rows.find((row) => row.id === "hitsound-offset-tap");
    assert.equal(offset.label, "Tap / Hold 音效偏移 (ms)");
    const wheel = rows.find((row) => row.id === "event-wheel-increments");
    assert.equal(wheel.label, "滚轮微调事件数值");
    assert.deepEqual(wheel.value.split("\n"), [
      "X 坐标 5",
      "Y 坐标 5",
      "旋转角度 0.5",
      "不透明度 5",
      "速度 0.1",
      "故事板横向伸缩 0.1",
      "故事板纵向伸缩 0.1",
    ]);
  } finally {
    setLanguage("en");
  }
});

test("RPE division_color.txt maps supported beat lines and reports the rest", () => {
  const division = `# comment line
4: 255, 0, 0, 1.0 // red
8: 128, 128, 255, 0.5
16: 0, 255, 0
24: 10, 20, 30, 1
not a colour line
`;
  const plan = createRpeMigrationPlan("", "", "", division);
  const values = Object.fromEntries(plan.settings.map((setting) => [setting.key, setting.value]));
  assert.equal(values["timeline-grid-color-4"], "#FF0000");
  assert.equal(values["timeline-grid-color-8"], "#8080FF80");
  assert.equal(values["timeline-grid-color-16"], "#00FF00");
  assert.equal(values["timeline-grid-color-24"], undefined);
  assert.deepEqual(plan.unmapped, [{ key: "division-color-24", value: "#0A141E" }]);

  const rows = buildSettingRows(plan);
  assert.equal(
    rows.some((row) => row.id.startsWith("unmapped:")),
    false,
  );
});

test("the review keeps only checked settings, shortcuts, and language", () => {
  const plan = createRpeMigrationPlan(
    JSON.stringify({ FpsLimit: 120, NoteSize: 175, Language: "zh.txt" }),
    "AddTap A\r\nPause SPACE",
  );
  const filtered = filterRpeMigrationPlan(plan, {
    settingKeys: ["render-fps"],
    applyShortcuts: false,
    applyLanguage: true,
  });
  assert.deepEqual(
    filtered.settings.map((setting) => setting.key),
    ["render-fps"],
  );
  assert.deepEqual(filtered.shortcuts, []);
  assert.deepEqual(filtered.hotkeys.entries, []);
  assert.equal(filtered.language, "zh");

  const all = filterRpeMigrationPlan(plan, {
    settingKeys: plan.settings.map((setting) => setting.key),
    applyShortcuts: true,
    applyLanguage: false,
  });
  assert.equal(all.settings.length, plan.settings.length);
  assert.equal(all.shortcuts.length, plan.shortcuts.length);
  assert.equal(all.language, null);
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
