/**
 * Wheel navigation bindings: line stepping and time seeking are ordinary
 * rebindable shortcuts, so the live registry decides which wheel event does
 * what.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { registerEditorShortcuts } from "../../../core/edit/shortcuts/shortcutCatalog.ts";
import { bindTimelineNavigation } from "../../../frontend/screens/editor/workspace/timeline/interaction/timelineNavigation.ts";
import {
  matchTimelineWheel,
  TIMELINE_WHEEL_SHORTCUT_IDS,
} from "../../../core/edit/shortcuts/timelineWheel.ts";
import { recordShortcut } from "../../../core/shortcuts/keyMatching.ts";
import { shortcutRegistry } from "../../../core/shortcuts/registry.ts";
import {
  advanceShortcutCapture,
  createShortcutCaptureState,
} from "../../../frontend/screens/settings/shortcuts/shortcutCapture.ts";

test("default wheel bindings step lines with Ctrl and seek time otherwise", () => {
  const dispose = registerEditorShortcuts();
  try {
    assert.deepEqual(matchTimelineWheel({ deltaY: -100, ctrlKey: true }), {
      kind: "line",
      direction: -1,
    });
    assert.deepEqual(matchTimelineWheel({ deltaY: 100, ctrlKey: true }), {
      kind: "line",
      direction: 1,
    });
    assert.deepEqual(matchTimelineWheel({ deltaY: -100 }), {
      kind: "seek",
      direction: 1,
    });
    assert.deepEqual(matchTimelineWheel({ deltaY: 100 }), {
      kind: "seek",
      direction: -1,
    });
  } finally {
    dispose();
  }
});

test("default Alt wheel bindings zoom the timeline", () => {
  const dispose = registerEditorShortcuts();
  try {
    assert.deepEqual(matchTimelineWheel({ deltaY: -100, altKey: true }), {
      kind: "zoom",
      direction: 1,
    });
    assert.deepEqual(matchTimelineWheel({ deltaY: 100, altKey: true }), {
      kind: "zoom",
      direction: -1,
    });
  } finally {
    dispose();
  }
});

test("a rebound zoom shortcut keeps its configured direction", () => {
  const dispose = registerEditorShortcuts();
  const zoomOut = TIMELINE_WHEEL_SHORTCUT_IDS.zoomOut;
  const zoomIn = TIMELINE_WHEEL_SHORTCUT_IDS.zoomIn;
  try {
    assert.equal(shortcutRegistry.replaceAllBindings(zoomOut, ["ALT+WHEELUP"]).ok, true);
    assert.equal(shortcutRegistry.replaceAllBindings(zoomIn, []).ok, true);
    assert.deepEqual(matchTimelineWheel({ deltaY: -100, altKey: true }), {
      kind: "zoom",
      direction: -1,
    });
  } finally {
    shortcutRegistry.resetShortcut(zoomOut);
    shortcutRegistry.resetShortcut(zoomIn);
    dispose();
  }
});

test("a custom Alt wheel seek binding does not also zoom the timeline", () => {
  const dispose = registerEditorShortcuts();
  const zoomOut = TIMELINE_WHEEL_SHORTCUT_IDS.zoomOut;
  const timePrevious = TIMELINE_WHEEL_SHORTCUT_IDS.timePrevious;
  try {
    assert.equal(shortcutRegistry.replaceAllBindings(zoomOut, []).ok, true);
    assert.equal(shortcutRegistry.replaceAllBindings(timePrevious, ["ALT+WHEELDOWN"]).ok, true);
    const seeks = [];
    const zooms = [];
    const navigation = bindTimelineNavigation({
      timeline: {
        gestures: {},
        viewport: { division: 4, minimumScrollSeconds: () => 0 },
      },
      session: () => ({ chart: { META: {} } }),
      seekByBeats: (delta) => seeks.push(delta),
      wheelSettings: () => ({ scrollSpeed: 1, scrollAcceleration: false }),
      lineSwitcher: { step() {} },
      zoomVertical: () => {
        zooms.push(true);
        return true;
      },
    });
    navigation.wheel({
      deltaY: 100,
      deltaMode: 0,
      altKey: true,
      shiftKey: false,
      preventDefault() {},
      stopPropagation() {},
    });
    assert.equal(seeks.length, 1);
    assert.deepEqual(zooms, []);
  } finally {
    shortcutRegistry.resetShortcut(zoomOut);
    shortcutRegistry.resetShortcut(timePrevious);
    dispose();
  }
});

test("Shift changes the seek distance without stealing the wheel direction", () => {
  const dispose = registerEditorShortcuts();
  try {
    assert.deepEqual(matchTimelineWheel({ deltaY: 100, shiftKey: true }), {
      kind: "seek",
      direction: -1,
    });
    assert.deepEqual(matchTimelineWheel({ deltaY: -100, ctrlKey: true, shiftKey: true }), {
      kind: "line",
      direction: -1,
    });
  } finally {
    dispose();
  }
});

test("the shortcut recorder commits wheel directions and mouse buttons", () => {
  assert.deepEqual(recordShortcut({ deltaY: -1, ctrlKey: true }), {
    key: "WHEELUP",
    modifiers: ["CTRL"],
  });
  assert.deepEqual(recordShortcut({ deltaY: 1 }), { key: "WHEELDOWN", modifiers: [] });
  assert.deepEqual(recordShortcut({ button: 2 }), { key: "MOUSE2", modifiers: [] });

  const wheel = advanceShortcutCapture(createShortcutCaptureState(), {
    type: "wheel",
    event: { deltaY: 1, ctrlKey: true },
  });
  assert.deepEqual(wheel.commit, { key: "WHEELDOWN", modifiers: ["CTRL"] });

  const pointer = advanceShortcutCapture(createShortcutCaptureState(), {
    type: "pointerdown",
    event: { button: 3, shiftKey: true },
  });
  assert.equal(pointer.commit, null);
  assert.deepEqual(pointer.state.candidate, { key: "MOUSE3", modifiers: ["SHIFT"] });
  const releasedPointer = advanceShortcutCapture(pointer.state, {
    type: "pointerup",
    event: { button: 3 },
  });
  assert.deepEqual(releasedPointer.commit, { key: "MOUSE3", modifiers: ["SHIFT"] });
});

test("a mouse binding commits when the button is released while its modifier is held", () => {
  let state = advanceShortcutCapture(createShortcutCaptureState(), {
    type: "keydown",
    event: { key: "Control", code: "ControlLeft", ctrlKey: true },
  }).state;
  state = advanceShortcutCapture(state, {
    type: "pointerdown",
    event: { button: 0, ctrlKey: true },
  }).state;
  assert.deepEqual(state.candidate, { key: "MOUSE0", modifiers: ["CTRL"] });

  const pointerUp = advanceShortcutCapture(state, {
    type: "pointerup",
    event: { button: 0, ctrlKey: true },
  });
  assert.deepEqual(pointerUp.commit, { key: "MOUSE0", modifiers: ["CTRL"] });
  assert.deepEqual(pointerUp.state, createShortcutCaptureState());

  const modifierUp = advanceShortcutCapture(pointerUp.state, {
    type: "keyup",
    event: { key: "Control", code: "ControlLeft" },
  });
  assert.equal(modifierUp.commit, null);
  assert.deepEqual(modifierUp.state, createShortcutCaptureState());
});

test("a mouse binding keeps its modifiers when the modifier is released first", () => {
  let state = advanceShortcutCapture(createShortcutCaptureState(), {
    type: "keydown",
    event: { key: "Control", code: "ControlLeft", ctrlKey: true },
  }).state;
  state = advanceShortcutCapture(state, {
    type: "pointerdown",
    event: { button: 0, ctrlKey: true },
  }).state;
  assert.deepEqual(state.candidate, { key: "MOUSE0", modifiers: ["CTRL"] });

  const modifierUp = advanceShortcutCapture(state, {
    type: "keyup",
    event: { key: "Control", code: "ControlLeft" },
  });
  assert.equal(modifierUp.commit, null);
  assert.deepEqual(modifierUp.state.candidate, { key: "MOUSE0", modifiers: ["CTRL"] });

  const pointerUp = advanceShortcutCapture(modifierUp.state, {
    type: "pointerup",
    event: { button: 0 },
  });
  assert.deepEqual(pointerUp.commit, { key: "MOUSE0", modifiers: ["CTRL"] });
});
