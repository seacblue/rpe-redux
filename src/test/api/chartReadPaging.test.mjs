/** Verifies chart reads detach only the requested page and preserve read semantics. */
import assert from "node:assert/strict";
import test from "node:test";
import { createChart, createEvent, createLine, createNote } from "../../core/global/chart/chart.ts";
import { createChartApi } from "../../core/edit/chart/api.ts";

function fixture() {
  const chart = createChart();
  chart.judgeLineList = [];
  for (let lineIndex = 0; lineIndex < 4; lineIndex += 1) {
    const line = createLine(`Line ${lineIndex}`);
    line.notes = [createNote(1, lineIndex, lineIndex), createNote(1, lineIndex + 1, lineIndex + 1)];
    line.eventLayers[0].moveXEvents = [createEvent(0, 10, lineIndex, lineIndex + 1)];
    chart.judgeLineList.push(line);
  }
  return chart;
}

test("chart line reads detach only the requested page", () => {
  const chart = fixture();
  const api = createChartApi({ chart: () => chart });
  const page = api.read("lines", { limit: 2 });

  assert.equal(page.status, "ok");
  assert.equal(page.items.length, 2);
  assert.equal(page.items[0].Name, "Line 0");
  assert.notEqual(page.items[0], chart.judgeLineList[0]);
  assert.ok(Object.isFrozen(page.items[0]));
  assert.ok(page.nextCursor);
});

test("note and event pages keep stable ownership metadata", () => {
  const chart = fixture();
  const api = createChartApi({ chart: () => chart });
  const notes = api.read("notes", { limit: 2 });
  const events = api.read("events", { limit: 2 });

  assert.equal(notes.status, "ok");
  assert.equal(events.status, "ok");
  assert.equal(notes.items[0].lineId, chart.judgeLineList[0].id);
  assert.equal(notes.items[0].index, 0);
  assert.notEqual(notes.items[0].note, chart.judgeLineList[0].notes[0]);
  assert.equal(events.items[0].lineId, chart.judgeLineList[0].id);
  assert.equal(events.items[0].eventType, "moveXEvents");
  assert.notEqual(events.items[0].event, chart.judgeLineList[0].eventLayers[0].moveXEvents[0]);
});

test("full snapshots remain detached without building a JSON string", () => {
  const chart = fixture();
  const api = createChartApi({ chart: () => chart });
  const snapshot = api.snapshot();

  assert.ok(snapshot);
  assert.notEqual(snapshot, chart);
  assert.ok(Object.isFrozen(snapshot));
  assert.equal(snapshot.judgeLineList.length, chart.judgeLineList.length);
});
