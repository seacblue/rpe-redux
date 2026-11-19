/**
 * Merged multi-line note painting follows a paged document facade, whose chart
 * and line-array identities survive an in-place edit. A placed note must extend
 * the line's derived beat bounds, otherwise the merged field keeps skipping the
 * line and the new note never appears.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  createChart,
  createLine,
  createNote,
  serializeChart,
} from "../../../core/global/chart/chart.ts";
import { EditorSession } from "../../../core/edit/session/session.ts";
import { scanChartJson } from "../../../core/global/chart/streaming/chartJsonScanner.ts";
import {
  buildChartIndex,
  chartHeaderFromScan,
} from "../../../core/global/chart/streaming/chartLineSummary.ts";
import { ChartDocument } from "../../../core/global/chart/streaming/chartDocument.ts";
import { TempoMap } from "../../../core/global/chart/timing/tempo.ts";
import { TimelineCache } from "../../../frontend/screens/editor/workspace/timeline/drawing/timelineCache.ts";

/** A two-line chart whose lines both hold one note near beat zero. */
function pagedChart() {
  const chart = createChart();
  chart.judgeLineList = [createLine("A"), createLine("B")];
  chart.judgeLineList[0].notes = [createNote(1, 1, 0)];
  chart.judgeLineList[1].notes = [createNote(1, 1, 0)];
  return chart;
}

/** Build a paged document over one serialized chart. */
function documentFromText(text) {
  const scan = scanChartJson(text);
  const header = chartHeaderFromScan(scan);
  const tempo = new TempoMap(header.BPMList);
  const provider = {
    lineCount: scan.lineRanges.length,
    async readLine(lineIndex) {
      const range = scan.lineRanges[lineIndex];
      return range ? scan.text.slice(range.start, range.end) : undefined;
    },
  };
  return new ChartDocument({
    header,
    index: buildChartIndex(scan, tempo),
    provider,
  });
}

/** Open a two-line paged session with both lines materialized. */
async function mergedSession() {
  const document = documentFromText(serializeChart(pagedChart()));
  const session = EditorSession.fromDocument(document);
  await document.ensureLine(0);
  await document.ensureLine(1);
  session.setMultiLineSelection([0, 1]);
  return { document, session };
}

test("a placed note joins the merged window under an unchanged facade", async () => {
  const { session } = await mergedSession();
  const cache = new TimelineCache();
  const facade = session.chart;

  assert.deepEqual(
    cache.noteLinesInBeatRange(facade, 39.75, 40.25).indices,
    [],
    "no line reaches beat 40 yet",
  );

  assert.equal(session.insertNotesAt(1, [createNote(1, 40, 0)]), true);

  assert.equal(session.chart, facade, "the paged commit keeps the facade identity");
  assert.deepEqual(
    cache.noteLinesInBeatRange(facade, 39.75, 40.25).indices,
    [1],
    "the placed note must widen line 1's derived beat bounds",
  );
});

test("a note moved on another line updates its merged bounds", async () => {
  const { session } = await mergedSession();
  const cache = new TimelineCache();
  const facade = session.chart;
  cache.noteLinesInBeatRange(facade, 19.75, 20.25);

  const moved = createNote(1, 20, 0);
  assert.equal(
    session.commitChart("move note", {
      ...facade,
      judgeLineList: facade.judgeLineList.map((line, index) =>
        index === 0 ? { ...line, notes: [moved] } : line,
      ),
    }),
    true,
  );

  assert.deepEqual(cache.noteLinesInBeatRange(facade, 19.75, 20.25).indices, [0]);
  assert.deepEqual(
    cache.noteLinesInBeatRange(facade, 0.75, 1.25).indices,
    [1],
    "line 0 left the earlier window, line 1 still holds its original note",
  );
});

test("an unchanged facade reuses the merged query result", async () => {
  const { session } = await mergedSession();
  const cache = new TimelineCache();
  const facade = session.chart;

  const first = cache.noteLinesInBeatRange(facade, 0.75, 1.25);
  const second = cache.noteLinesInBeatRange(facade, 0.75, 1.25);

  assert.deepEqual(second.indices, first.indices);
  assert.equal(second.marks, first.marks, "the derived marks buffer is reused");
});

test("an unchanged content revision reuses bounds, a bump recomputes them", async () => {
  const { session } = await mergedSession();
  const cache = new TimelineCache();
  const facade = session.chart;
  const revision = session.contentRevision;

  cache.noteLinesInBeatRange(facade, 39.75, 40.25, revision);
  assert.equal(session.insertNotesAt(1, [createNote(1, 40, 0)]), true);

  assert.deepEqual(
    cache.noteLinesInBeatRange(facade, 39.75, 40.25, revision).indices,
    [],
    "the same revision keeps the bounds derived from the old note arrays",
  );
  assert.deepEqual(
    cache.noteLinesInBeatRange(facade, 39.75, 40.25, session.contentRevision).indices,
    [1],
    "a new revision re-reads the replaced note arrays",
  );
});
