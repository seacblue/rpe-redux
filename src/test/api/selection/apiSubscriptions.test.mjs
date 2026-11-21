/** Subscription handles return disposers directly instead of result envelopes. */
import assert from "node:assert/strict";
import test from "node:test";
import { selection } from "../../../core/api/selection.ts";
import {
  createChart,
  createEvent,
  createLine,
  createNote,
} from "../../../core/global/chart/chart.ts";
import { connectSelectionApi } from "../../../core/edit/selection/api.ts";
import { EditorSession } from "../../../core/edit/session/session.ts";

test("selection.subscribe returns a disposer before and after the editor mounts", () => {
  const unmounted = selection.subscribe(() => {});
  assert.equal(typeof unmounted, "function");
  unmounted();

  const chart = createChart();
  const session = new EditorSession(chart);
  const disconnect = connectSelectionApi({ session: () => session });
  let calls = 0;
  try {
    const stop = selection.subscribe(() => {
      calls += 1;
    });
    assert.equal(typeof stop, "function");
    assert.equal("ok" in stop, false);
    session.notify();
    assert.equal(calls, 1);
    stop();
    session.notify();
    assert.equal(calls, 1, "an unsubscribed listener must stop receiving snapshots");
  } finally {
    disconnect();
  }
});

test("selection snapshots carry stable note ids", () => {
  const chart = createChart();
  const line = createLine("Line 0");
  line.notes = [createNote(1, 0, 0), createNote(1, 1, 1)];
  chart.judgeLineList = [line];
  const session = new EditorSession(chart);
  const disconnect = connectSelectionApi({ session: () => session });
  try {
    const result = selection.notes.select({
      lineIndex: 0,
      indices: [1],
      mode: "replace",
    });
    assert.equal(result.ok, true);
    assert.equal(result.value.notes.length, 1);
    assert.deepEqual(result.value.notes[0], {
      id: line.notes[1].id,
      lineIndex: 0,
      index: 1,
    });
  } finally {
    disconnect();
  }
});

test("selection snapshots carry stable event ids", () => {
  const chart = createChart();
  const line = createLine("Line 0");
  const event = createEvent(0, 1, 0, 1);
  line.eventLayers[0].moveXEvents = [event];
  chart.judgeLineList = [line];
  const session = new EditorSession(chart);
  const disconnect = connectSelectionApi({ session: () => session });
  try {
    const result = selection.events.select({
      lineIndex: 0,
      eventType: "moveXEvents",
      layer: 0,
      indices: [0],
      mode: "replace",
    });
    assert.equal(result.ok, true);
    assert.equal(result.value.events.length, 1);
    assert.deepEqual(result.value.events[0], {
      id: event.id,
      lineIndex: 0,
      eventType: "moveXEvents",
      layer: 0,
      index: 0,
    });
  } finally {
    disconnect();
  }
});
