import assert from "node:assert/strict";
import test from "node:test";
import { EDITOR_SHORTCUTS } from "../../../core/edit/shortcuts/shortcutCatalog.ts";
import { matches } from "../../../core/shortcuts/keyMatching.ts";
import { parseShortcut } from "../../../core/shortcuts/keys.ts";
import { DEFAULT_SAMPLING_SETTINGS } from "../../../core/edit/sampling/sampling.ts";
import {
  sampleSamplingPointer,
  samplingSettingsForPointer,
} from "../../../frontend/screens/editor/workspace/stage/sampling/samplingGuides.ts";
import {
  advanceShortcutCapture,
  createShortcutCaptureState,
} from "../../../frontend/screens/settings/shortcuts/shortcutCapture.ts";

const projection = {
  stageWidth: 1000,
  stageHeight: 800,
  canvasLeft: 0,
  canvasTop: 0,
  centerX: 500,
  centerY: 400,
  scaleX: 1,
  scaleY: 1,
  viewportLeft: 100,
  viewportTop: 100,
  viewportWidth: 800,
  viewportHeight: 600,
  lineX: 500,
  lineY: 400,
  lineRotation: 0,
};

test("holding the sampling guide shortcut disables pointer snapping", () => {
  const settings = samplingSettingsForPointer(DEFAULT_SAMPLING_SETTINGS, true);
  const sample = sampleSamplingPointer(550, 350, { left: 0, top: 0 }, projection, "x", settings);
  assert.equal(settings.guidesEnabled, false);
  assert.equal(sample.snapped, false);
  assert.equal(sample.value.point?.x, 50);
});

test("sampling shortcuts are rebindable and support bare modifier keys", () => {
  const hideGuides = EDITOR_SHORTCUTS.find((shortcut) => shortcut.id === "sampling.hideGuides");
  const cancel = EDITOR_SHORTCUTS.find((shortcut) => shortcut.id === "sampling.cancel");
  const apply = EDITOR_SHORTCUTS.find((shortcut) => shortcut.id === "sampling.apply");
  assert.deepEqual(hideGuides?.defaults, [{ key: "SHIFT" }]);
  assert.deepEqual(cancel?.defaults, [{ key: "ESCAPE" }]);
  assert.deepEqual(apply?.defaults, [{ key: "F" }]);
  assert.equal(apply?.passive, true);
  assert.deepEqual(parseShortcut("SHIFT"), { ok: true, shortcut: { key: "SHIFT", modifiers: [] } });
  assert.equal(
    matches({ key: "Shift", code: "ShiftLeft", shiftKey: true }, { key: "SHIFT" }),
    true,
  );
  assert.equal(matches({ key: "Shift", code: "ShiftLeft" }, { key: "SHIFT" }), true);

  const state = advanceShortcutCapture(createShortcutCaptureState(), {
    type: "keydown",
    event: { key: "Shift", code: "ShiftLeft", shiftKey: true },
  }).state;
  const released = advanceShortcutCapture(state, {
    type: "keyup",
    event: { key: "Shift", code: "ShiftLeft" },
  });
  assert.deepEqual(released.commit, { key: "SHIFT", modifiers: [] });
});
