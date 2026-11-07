/**
 * Clipboard layer semantics: ordinary copies land on the active layer, deep
 * copies keep every source layer, and multi-line blocks keep their relative
 * line and time offsets.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  createChart,
  createEvent,
  createLine,
  createNote,
} from "../../../core/global/chart/chart.ts";
import { beatValue } from "../../../core/global/chart/timing/beat.ts";
import { EditorSession } from "../../../core/edit/session/session.ts";
import {
  copyObjects,
  copyObjectsAllLayers,
  pasteObjects,
} from "../../../core/edit/clipboard/operations.ts";
import { ClipboardHistory } from "../../../core/edit/clipboard/clipboardHistory.ts";
import { EDITOR_SHORTCUTS } from "../../../core/edit/shortcuts/shortcutCatalog.ts";
import {
  matchEditorShortcut,
  registerEditorShortcuts,
} from "../../../core/edit/shortcuts/shortcutCatalog.ts";

/** A chart with enough lines to test relative offsets. */
function chartWithLines(count = 4) {
  const chart = createChart();
  for (let index = 1; index < count; index += 1) {
    chart.judgeLineList.push(createLine(`Line ${index + 1}`));
  }
  return chart;
}

function moveXEvents(session, lineIndex, layer) {
  return session.chart.judgeLineList[lineIndex].eventLayers[layer].moveXEvents ?? [];
}

test("an ordinary copy pastes onto the active layer", () => {
  const chart = chartWithLines(2);
  chart.judgeLineList[0].eventLayers = [
    { moveXEvents: [createEvent(0, 0, 0, 1)] },
    { moveXEvents: [createEvent(10, 10, 2, 3)] },
  ];
  const session = new EditorSession(chart);
  session.eventLayer = 1;
  session.eventSelection = new Set(["moveXEvents:0"]);

  assert.equal(copyObjects(session), 1);
  assert.equal(session.eventClipboardPreserveLayers, false);

  session.eventLayer = 0;
  assert.equal(pasteObjects(session, 10, { targetLineIndex: 0 }), true);
  assert.equal(moveXEvents(session, 0, 0).length, 2);
  assert.equal(moveXEvents(session, 0, 1).length, 1);
  assert.equal(beatValue(moveXEvents(session, 0, 0).at(-1).startTime), 10);
});

test("multi-line event blocks keep their relative line and time offsets", () => {
  const chart = chartWithLines(4);
  chart.judgeLineList[0].eventLayers[0].moveXEvents = [createEvent(0, 0, 4, 4.5)];
  chart.judgeLineList[2].eventLayers[0].moveXEvents = [createEvent(0, 0, 6, 6.5)];
  const session = new EditorSession(chart);
  session.eventLayer = 0;
  session.multiLineEnabled = true;
  session.multiLineMode = "events";
  session.multiLineIndices = [0, 2];
  session.multiEventSelection = new Map([
    [0, new Set(["moveXEvents:0"])],
    [2, new Set(["moveXEvents:0"])],
  ]);

  assert.equal(copyObjects(session), 2);
  assert.deepEqual(session.eventClipboardLines, [0, 2]);

  assert.equal(pasteObjects(session, 10, { targetLineIndex: 1 }), true);
  assert.equal(beatValue(moveXEvents(session, 1, 0).at(-1).startTime), 10);
  assert.equal(beatValue(moveXEvents(session, 3, 0).at(-1).startTime), 12);
});

test("Ctrl+Shift+C copies every base layer of the selected types", () => {
  const chart = chartWithLines(2);
  chart.judgeLineList[0].eventLayers = [0, 1, 2, 3].map((layer) => ({
    moveXEvents: [createEvent(layer * 10, layer * 10, 4, 4.5)],
  }));
  const session = new EditorSession(chart);
  session.eventLayer = 0;
  session.eventSelection = new Set(["moveXEvents:0"]);

  assert.equal(copyObjectsAllLayers(session), 4);
  assert.equal(session.eventClipboardPreserveLayers, true);
  assert.deepEqual(session.eventClipboardLayers, [0, 1, 2, 3]);

  // Layers are relative: pasting on layer 1 maps source 0-3 to 1-4, and the
  // overflow past layer 3 is silently dropped.
  session.eventLayer = 1;
  assert.equal(pasteObjects(session, 20, { targetLineIndex: 1 }), true);
  for (let layer = 1; layer <= 3; layer += 1) {
    const pasted = moveXEvents(session, 1, layer).at(-1);
    assert.equal(beatValue(pasted.startTime), 20);
    assert.equal(pasted.start, (layer - 1) * 10);
  }
  assert.equal(session.chart.judgeLineList[1].eventLayers?.[4]?.moveXEvents?.length ?? 0, 0);
  // The selection model addresses one layer; only the active layer is selected.
  assert.equal(session.multiEventSelection.get(1)?.size, 1);
});

test("a layer-preserving clipboard snapshot survives history attach", () => {
  const chart = chartWithLines(2);
  chart.judgeLineList[0].eventLayers = [0, 1].map((layer) => ({
    moveXEvents: [createEvent(layer, layer, 4, 5)],
  }));
  const session = new EditorSession(chart);
  session.eventLayer = 0;
  session.eventSelection = new Set(["moveXEvents:0"]);
  copyObjectsAllLayers(session);

  const history = new ClipboardHistory();
  history.remember(session);

  const restored = new EditorSession(chartWithLines(2));
  restored.eventLayer = 1;
  history.attach(restored);
  assert.equal(restored.eventClipboardPreserveLayers, true);
  assert.deepEqual(restored.eventClipboardLayers, [0, 1]);

  assert.equal(pasteObjects(restored, 20, { targetLineIndex: 0 }), true);
  assert.equal(moveXEvents(restored, 0, 0).length, 1);
  assert.equal(moveXEvents(restored, 0, 1).length, 1);
  assert.equal(moveXEvents(restored, 0, 2).length, 1);
});

test("a dropped lowest layer does not shift the paste anchor", () => {
  const chart = chartWithLines(2);
  chart.judgeLineList[0].eventLayers = [
    { moveXEvents: [createEvent(0, 0, 6, 6.5)] },
    { moveXEvents: [createEvent(1, 1, 4, 6.5)] },
    { moveXEvents: [createEvent(2, 2, 4.5, 6.5)] },
  ];
  const session = new EditorSession(chart);
  session.eventLayer = 1;
  session.eventSelection = new Set(["moveXEvents:0"]);
  assert.equal(copyObjectsAllLayers(session), 3);

  // Source 0 maps to 3; source 1 and 2 overflow and are dropped. The surviving
  // entry is anchored at its own time (6), not the dropped block start (4).
  session.eventLayer = 3;
  assert.equal(pasteObjects(session, 20, { targetLineIndex: 1 }), true);
  assert.equal(beatValue(moveXEvents(session, 1, 3).at(-1).startTime), 20);
  assert.equal(session.chart.judgeLineList[1].eventLayers?.[4]?.moveXEvents?.length ?? 0, 0);
});

test("mirror paste negates note X and X/Y/Rotate event values without changing the clipboard", () => {
  const chart = chartWithLines(1);
  const line = chart.judgeLineList[0];
  line.notes = [createNote(1, 0, 12)];
  line.numOfNotes = 1;
  line.eventLayers[0] = {
    moveXEvents: [createEvent(10, 20)],
    moveYEvents: [createEvent(30, 40)],
    rotateEvents: [createEvent(50, 60)],
    alphaEvents: [createEvent(70, 80)],
    speedEvents: [createEvent(90, 100)],
  };
  const session = new EditorSession(chart);
  session.selection = new Set([0]);
  session.eventSelection = new Set([
    "moveXEvents:0",
    "moveYEvents:0",
    "rotateEvents:0",
    "alphaEvents:0",
    "speedEvents:0",
  ]);

  assert.equal(copyObjects(session), 6);
  const originalClipboard = structuredClone(session.clipboard);
  const originalEventClipboard = structuredClone(session.eventClipboard);

  assert.equal(pasteObjects(session, 0, { mirror: true, targetLineIndex: 0 }), true);
  assert.deepEqual(session.clipboard, originalClipboard);
  assert.deepEqual(session.eventClipboard, originalEventClipboard);
  assert.equal(session.chart.judgeLineList[0].notes.at(-1).positionX, -12);
  assert.equal(session.chart.judgeLineList[0].eventLayers[0].moveXEvents.at(-1).start, -10);
  assert.equal(session.chart.judgeLineList[0].eventLayers[0].moveXEvents.at(-1).end, -20);
  assert.equal(session.chart.judgeLineList[0].eventLayers[0].moveYEvents.at(-1).start, -30);
  assert.equal(session.chart.judgeLineList[0].eventLayers[0].moveYEvents.at(-1).end, -40);
  assert.equal(session.chart.judgeLineList[0].eventLayers[0].rotateEvents.at(-1).start, -50);
  assert.equal(session.chart.judgeLineList[0].eventLayers[0].rotateEvents.at(-1).end, -60);
  assert.equal(session.chart.judgeLineList[0].eventLayers[0].alphaEvents.at(-1).start, 70);
  assert.equal(session.chart.judgeLineList[0].eventLayers[0].speedEvents.at(-1).start, 90);
});

test("layer shortcuts resolve in the event area and leave notes to the note-skin action", () => {
  const dispose = registerEditorShortcuts();
  try {
    const shortcutContext = {
      atHome: false,
      documentOpen: true,
      modal: "none",
      capturing: false,
      developerMode: false,
      textEntry: false,
      surface: null,
    };
    const eventContext = { area: "events", hasSelection: false };
    for (const [key, id] of [
      ["Q", "event.layer.0"],
      ["W", "event.layer.1"],
      ["E", "event.layer.2"],
      ["R", "event.layer.3"],
      ["T", "event.layer.4"],
    ]) {
      assert.equal(matchEditorShortcut({ key, ctrlKey: true }, eventContext, shortcutContext), id);
    }
    assert.equal(
      matchEditorShortcut(
        { key: "T", ctrlKey: true },
        { area: "notes", hasSelection: false },
        shortcutContext,
      ),
      undefined,
    );
  } finally {
    dispose();
  }
});

test("the layer and deep-copy shortcuts are registered with their defaults", () => {
  const layer = EDITOR_SHORTCUTS.filter((shortcut) => shortcut.id.startsWith("event.layer."));
  assert.deepEqual(
    layer.map((shortcut) => [shortcut.id, shortcut.defaults[0]?.key]),
    [
      ["event.layer.0", "Q"],
      ["event.layer.1", "W"],
      ["event.layer.2", "E"],
      ["event.layer.3", "R"],
      ["event.layer.4", "T"],
    ],
  );
  assert.ok(layer.every((shortcut) => shortcut.defaults[0]?.modifiers?.includes("CTRL")));
  const deepCopy = EDITOR_SHORTCUTS.find((shortcut) => shortcut.id === "edit.copy.allLayers");
  assert.deepEqual(deepCopy?.defaults[0], { key: "C", modifiers: ["CTRL", "SHIFT"] });
  const mirrorPaste = EDITOR_SHORTCUTS.find((shortcut) => shortcut.id === "edit.paste.mirror");
  assert.deepEqual(mirrorPaste?.defaults[0], { key: "B", modifiers: ["CTRL"] });
  const deleteShortcut = EDITOR_SHORTCUTS.find((shortcut) => shortcut.id === "edit.delete");
  assert.deepEqual(deleteShortcut?.defaults, [{ key: "D" }, { key: "DELETE" }]);
});
