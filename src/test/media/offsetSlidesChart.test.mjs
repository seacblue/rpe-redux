/** An offset edit slides the chart; the audio clock never moves. */
import assert from "node:assert/strict";
import test from "node:test";
import { createChart, createNote } from "../../core/global/chart/chart.ts";
import { chartWithOffsetDraft } from "../../core/global/chart/editing/drafts.ts";
import { EditorSession } from "../../core/edit/session/session.ts";
import { TempoMap } from "../../core/global/chart/timing/tempo.ts";
import {
  alignedOffsetMs,
  offsetAlignBeatAt,
  offsetAlignLineAt,
} from "../../frontend/screens/editor/inspector/bpm/offsetAlignMath.ts";

/** A one-line 120 BPM chart with one note at chart second 1. */
function chartWith() {
  const chart = createChart();
  chart.BPMList = [{ bpm: 120, startTime: [0, 0, 1] }];
  chart.META.offset = 0;
  chart.judgeLineList[0].notes = [createNote(3, 2, 0)];
  return chart;
}

/** Commit an offset the way the timing panel does. */
function commitOffset(session, offsetMs) {
  session.commitChart(
    "offset",
    chartWithOffsetDraft(session.chart, String(offsetMs)),
    session.selectionState(),
    undefined,
    { normalized: true },
  );
}

test("the chart clock is the audio clock minus the offset", () => {
  const session = new EditorSession(chartWith());
  const audioSeconds = 4;
  const chartSeconds = () => audioSeconds - Number(session.chart.META.offset ?? 0) / 1000;

  assert.equal(chartSeconds(), 4);
  commitOffset(session, 1000);
  assert.equal(chartSeconds(), 3, "a positive offset moves the chart earlier");
  commitOffset(session, -1500);
  assert.equal(chartSeconds(), 5.5, "a negative offset moves the chart later");
  commitOffset(session, 0);
  assert.equal(chartSeconds(), 4, "returning to zero restores the original mapping");
});

test("a negative offset puts the chart origin before the audio start", () => {
  const session = new EditorSession(chartWith());
  commitOffset(session, -1500);
  const offset = Number(session.chart.META.offset ?? 0) / 1000;
  // Chart time zero sits at audio −1.5s, so the audio clock can start at its own
  // zero and still be 1.5s into the chart.
  assert.equal(0 - offset, 1.5);
});

test("aligning puts the picked chart time on the unchanged audio clock", () => {
  const audioSeconds = 12.345;
  for (const chartSeconds of [0, 1, 10.5, 12.345, 20]) {
    const offsetMs = alignedOffsetMs(audioSeconds, chartSeconds);
    assert.ok(offsetMs !== null);
    const remapped = chartSeconds + offsetMs / 1000;
    assert.ok(
      Math.abs(remapped - audioSeconds) < 0.001,
      `chart ${chartSeconds} + offset ${offsetMs}ms must land on audio ${audioSeconds}`,
    );
  }
});

test("aligning a note already under the playhead keeps the offset", () => {
  const session = new EditorSession(chartWith());
  commitOffset(session, 250);
  const audioSeconds = 5;
  const offset = Number(session.chart.META.offset ?? 0) / 1000;
  const chartSeconds = audioSeconds - offset;
  assert.equal(alignedOffsetMs(audioSeconds, chartSeconds), 250);
});

test("aligning refuses non-finite clocks instead of writing NaN", () => {
  assert.equal(alignedOffsetMs(Number.NaN, 1), null);
  assert.equal(alignedOffsetMs(1, Number.POSITIVE_INFINITY), null);
});

test("the tempo map is unaffected by offset, so beat times stay chart-based", () => {
  const session = new EditorSession(chartWith());
  const tempo = new TempoMap(session.chart.BPMList);
  const before = tempo.seconds(2, 1);
  commitOffset(session, -1500);
  const after = new TempoMap(session.chart.BPMList).seconds(2, 1);
  assert.equal(before, after, "offset never enters the tempo map");
});

test("the pick only accepts a press that lands on a grid line", () => {
  // Lines sit 40 px apart; the press must be within the radius of one of them.
  const lines = [100, 140, 180];
  assert.equal(offsetAlignLineAt(142, lines)?.vertical, 140, "2 px away is a hit");
  assert.equal(offsetAlignLineAt(120, lines), null, "20 px away is open canvas");
  assert.equal(offsetAlignLineAt(0, lines), null, "far from every line is a miss");
  assert.equal(offsetAlignLineAt(Number.NaN, lines), null);
});

test("the pressed line is resolved to its own beat, not the nearest beat under the pointer", () => {
  // Four lines per beat, 10 px each: y 0 is beat 0 and y grows towards the past.
  const height = 200;
  const verticalAtBeat = (beat) => height - beat * 40;
  const beat = offsetAlignBeatAt(161, 0, 5, 4, verticalAtBeat);
  // y 161 is 1 px off the line for beat 1 (y 160), so it must resolve to beat 1.
  assert.ok(beat !== null && Math.abs(beat - 1) < 1e-9, `expected beat 1, got ${beat}`);
});

test("a press in open canvas reports no line", () => {
  const height = 200;
  const verticalAtBeat = (beat) => height - beat * 40;
  // One line per beat, 40 px apart: y 150 is 10 px from beat 1 and 30 px from
  // beat 2, so it misses the 6 px radius and must not snap.
  assert.equal(offsetAlignBeatAt(150, 0, 5, 1, verticalAtBeat), null);
});
