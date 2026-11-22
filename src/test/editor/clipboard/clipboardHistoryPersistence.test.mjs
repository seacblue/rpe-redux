/** App-private clipboard state survives chart changes, restarts, and upgrades. */
import assert from "node:assert/strict";
import test from "node:test";
import { createChart, createEvent, createNote } from "../../../core/global/chart/chart.ts";
import { copyObjects, pasteObjects } from "../../../core/edit/clipboard/operations.ts";
import { ClipboardHistory } from "../../../core/edit/clipboard/clipboardHistory.ts";
import {
  createExternalClipboardNoticeGate,
  EXTERNAL_CLIPBOARD_NOTICE_INTERVAL_MS,
} from "../../../core/edit/clipboard/clipboardHistoryPersistence.ts";
import { EditorSession } from "../../../core/edit/session/session.ts";

/** Creates a session whose only note is selected for copying. */
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

test("the current clipboard is restored into another chart after a restart", () => {
  const source = selectedSession();
  assert.equal(copyObjects(source), 2);
  const history = new ClipboardHistory();
  history.remember(source);

  const reopened = new ClipboardHistory();
  reopened.restore(history.persistenceState());
  const target = new EditorSession(createChart());
  reopened.attach(target);

  assert.equal(target.clipboard.length, 1);
  assert.equal(target.eventClipboard.length, 1);
  assert.equal(pasteObjects(target, 8, { targetLineIndex: 0 }), true);
  assert.equal(target.chart.judgeLineList[0].notes.length, 1);
  assert.equal(target.chart.judgeLineList[0].eventLayers[0].moveXEvents.at(-1).startTime[0], 8);
});

test("legacy entry-array preferences still provide a current clipboard", () => {
  const source = selectedSession();
  assert.equal(copyObjects(source), 2);
  const history = new ClipboardHistory();
  history.remember(source);

  const reopened = new ClipboardHistory();
  reopened.restore(history.entries);
  const target = new EditorSession(createChart());
  reopened.attach(target);

  assert.equal(target.clipboard.length, 1);
  assert.equal(target.eventClipboard.length, 1);
  assert.equal(reopened.activeId, history.entries[0].id);
});

test("clearing the current clipboard is persisted without deleting history", () => {
  const source = selectedSession();
  copyObjects(source);
  const history = new ClipboardHistory();
  history.remember(source);
  history.clearCurrent(source);

  const reopened = new ClipboardHistory();
  reopened.restore(history.persistenceState());

  assert.equal(reopened.entries.length, 1);
  assert.deepEqual(reopened.current.notes, []);
  assert.equal(reopened.activeId, null);
});

test("external clipboard notices are rate limited for ten seconds", () => {
  let now = 1_000;
  const allowNotice = createExternalClipboardNoticeGate(() => now);

  assert.equal(allowNotice(), true);
  assert.equal(allowNotice(), false);
  now += EXTERNAL_CLIPBOARD_NOTICE_INTERVAL_MS - 1;
  assert.equal(allowNotice(), false);
  now += 1;
  assert.equal(allowNotice(), true);
});
