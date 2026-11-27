/** System clipboard JSON is validated, portable between sessions, and synced without startup toasts. */
import assert from "node:assert/strict";
import test from "node:test";
import { createChart, createEvent, createNote } from "../../../core/global/chart/chart.ts";
import {
  attachClipboardSnapshot,
  clipboardSnapshot,
  parseClipboardSnapshot,
  serializeClipboardSnapshot,
} from "../../../core/edit/clipboard/clipboardFormat.ts";
import { createSelectionClipboard } from "../../../core/edit/clipboard/selectionClipboard.ts";
import { copyObjects, projectClipboard } from "../../../core/edit/clipboard/operations.ts";
import { EditorSession } from "../../../core/edit/session/session.ts";

/** Creates a session with one selected note and event. */
function selectedSession(positionX = 0.25) {
  const chart = createChart();
  chart.judgeLineList[0].notes = [createNote(1, 4, positionX)];
  chart.judgeLineList[0].numOfNotes = 1;
  chart.judgeLineList[0].eventLayers[0].moveXEvents = [createEvent(1, 2, 4, 5)];
  const session = new EditorSession(chart);
  session.selection = new Set([0]);
  session.eventSelection = new Set(["moveXEvents:0"]);
  return session;
}

test("selection JSON round trips through the RPE-compatible note shape", () => {
  const source = selectedSession();
  copyObjects(source);
  const text = serializeClipboardSnapshot(clipboardSnapshot(source));
  const payload = JSON.parse(text);
  const parsed = parseClipboardSnapshot(text);

  assert.ok(parsed);
  assert.deepEqual(Object.keys(payload), ["events", "notes"]);
  assert.equal(payload.events.length, 1);
  assert.equal(payload.events[0].type, 1);
  assert.equal(payload.events[0].line, 0);
  assert.equal(payload.events[0].layer, 0);
  assert.deepEqual(payload.events[0].bezierPoints, [0, 0, 0, 0]);
  assert.equal(payload.notes.length, 1);
  assert.equal(payload.notes[0].line, 0);
  assert.deepEqual(payload.notes[0].color, [255, 255, 255]);
  assert.equal(payload.notes[0].judgeArea, 1);
  assert.equal("id" in payload.notes[0], false);
  const target = new EditorSession(createChart());
  attachClipboardSnapshot(target, parsed);
  assert.equal(target.clipboard.length, 1);
  assert.equal(target.eventClipboard.length, 1);
  assert.equal(parseClipboardSnapshot(JSON.stringify(createChart())), null);
});

test("event-only selections use RPE events and preserve layer metadata", () => {
  const source = selectedSession();
  source.selection.clear();
  copyObjects(source);
  const payload = JSON.parse(serializeClipboardSnapshot(clipboardSnapshot(source)));

  assert.deepEqual(Object.keys(payload), ["events"]);
  assert.equal(payload.events.length, 1);
  assert.equal(payload.events[0].type, 1);
  assert.equal(payload.events[0].line, 0);
  assert.equal(payload.events[0].layer, 0);

  const parsed = parseClipboardSnapshot(JSON.stringify(payload));
  assert.ok(parsed);
  assert.equal(parsed.notes.length, 0);
  assert.equal(parsed.events.length, 1);
  assert.equal(parsed.events[0].type, "moveXEvents");
  assert.deepEqual(parsed.eventLayers, [0]);
  assert.equal(parsed.preserveLayers, true);
});

test("RPE multi-layer events remain addressable by line and layer", () => {
  const parsed = parseClipboardSnapshot(
    JSON.stringify({
      events: [
        {
          bezier: 0,
          bezierPoints: [0, 0, 0, 0],
          easingLeft: 0,
          easingRight: 1,
          easingType: 1,
          end: 0,
          endTime: [8, 0, 1],
          layer: 0,
          line: 1,
          linkgroup: 0,
          start: 0,
          startTime: [4, 0, 1],
          type: 1,
        },
        {
          bezier: 0,
          bezierPoints: [0, 0, 0, 0],
          easingLeft: 0,
          easingRight: 1,
          easingType: 1,
          end: 0,
          endTime: [4, 3, 4],
          layer: 1,
          line: 2,
          linkgroup: 0,
          start: 0,
          startTime: [3, 3, 4],
          type: 2,
        },
      ],
    }),
  );

  assert.ok(parsed);
  assert.deepEqual(parsed.eventLines, [1, 2]);
  assert.deepEqual(parsed.eventLayers, [0, 1]);
  assert.deepEqual(
    parsed.events.map((entry) => entry.type),
    ["moveXEvents", "moveYEvents"],
  );

  const target = new EditorSession(createChart());
  attachClipboardSnapshot(target, parsed);
  const projected = projectClipboard(target, 0, { targetLineIndex: 0 });
  assert.deepEqual(projected.eventLines, [0, 0]);
  assert.deepEqual(projected.eventLayers, [0, 0]);
});

test("external clipboard changes replace the session and toast only after startup", async () => {
  const source = selectedSession();
  copyObjects(source);
  let text = serializeClipboardSnapshot(clipboardSnapshot(source));
  let target = new EditorSession(createChart());
  const messages = [];
  const fakeClipboard = {
    readText: async () => text,
    writeText: async (next) => {
      text = next;
    },
  };
  const selection = createSelectionClipboard({
    session: () => target,
    targetLine: () => 0,
    targetBeat: () => 0,
    clipboardMode: () => ({}),
    setClipboardMode: () => {},
    systemClipboard: fakeClipboard,
    notify: (message) => messages.push(message),
    copiedMessage: () => "copied",
    clipboardReadFailed: (message) => `read:${message}`,
    clipboardWriteFailed: (message) => `write:${message}`,
    clipboardReceived: () => "received",
    invalidate: () => {},
  });

  await selection.refreshFromSystem(false);
  assert.deepEqual(messages, []);
  assert.equal(target.clipboard.length, 1);

  target = new EditorSession(createChart());
  await selection.refreshFromSystem(true);
  assert.deepEqual(messages, []);
  assert.equal(target.clipboard.length, 1);

  const other = selectedSession(0.75);
  copyObjects(other);
  text = serializeClipboardSnapshot(clipboardSnapshot(other));
  await selection.refreshFromSystem(true);
  assert.deepEqual(messages, ["received"]);
  assert.equal(target.clipboard[0].positionX, 0.75);
});
