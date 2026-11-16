/** Exercises the transaction location index, copy-on-write, scoring counts and batch parity. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { createChart, createLine } from "../../../core/global/chart/chart.ts";
import { EditorSession } from "../../../core/edit/session/session.ts";
import { applyRequest, transactionChart } from "../../../core/edit/transaction/apply.ts";
import {
  collectChartObjectIds,
  ensureChartLocations,
  findNote,
  locateLine,
} from "../../../core/edit/transaction/locations.ts";
import { applyChartTransaction } from "../../../core/edit/transaction/preview.ts";

let nextObjectId = 1;

function deterministicId() {
  return `00000000-0000-7000-8000-${(nextObjectId++).toString(16).padStart(12, "0")}`;
}

function assignDeterministicIds(chart) {
  nextObjectId = 1;
  const assign = (record) => {
    if (record && typeof record === "object") {
      record.id = deterministicId();
    }
  };
  for (const line of chart.judgeLineList ?? []) {
    assign(line);
    for (const note of line.notes ?? []) {
      assign(note);
    }
    for (const layer of [...(line.eventLayers ?? []), line.extended]) {
      if (!layer) {
        continue;
      }
      for (const value of Object.values(layer)) {
        if (Array.isArray(value)) {
          for (const event of value) {
            assign(event);
          }
        }
      }
    }
  }
  for (const key of ["effects", "shaderEvents"]) {
    for (const event of chart[key] ?? []) {
      assign(event);
    }
  }
  for (const event of chart.META.effects ?? []) {
    assign(event);
  }
}

function makeChart(lineCount, notesPerLine) {
  const chart = createChart();
  chart.META = { ...chart.META, name: "transaction bench", charter: "bench" };
  chart.BPMList = [{ bpm: 180, startTime: [0, 0, 1] }];
  const lines = [];
  for (let lineIndex = 0; lineIndex < lineCount; lineIndex++) {
    const line = createLine(`Line ${lineIndex}`);
    const notes = [];
    for (let noteIndex = 0; noteIndex < notesPerLine; noteIndex++) {
      notes.push({
        type: noteIndex % 5 === 0 ? 2 : 1,
        positionX: ((noteIndex * 37) % 1350) - 675,
        startTime: [Math.floor(noteIndex / 4), noteIndex % 4, 4],
        endTime: [Math.floor(noteIndex / 4) + (noteIndex % 5 === 0 ? 1 : 0), noteIndex % 4, 4],
        alpha: 255,
        above: 1,
        size: 1,
      });
    }
    line.notes = notes;
    line.numOfNotes = notes.reduce((sum, note) => sum + (note.type === 2 ? 0 : 1), 0);
    lines.push(line);
  }
  chart.judgeLineList = lines;
  assignDeterministicIds(chart);
  return chart;
}

function stateFor(chart) {
  return {
    chart: transactionChart(chart),
    issues: [],
    affected: [],
    usedIds: collectChartObjectIds(chart),
    relationTouched: new Set(),
    clonedLines: new Set(),
  };
}

function hash(value) {
  return createHash("sha256").update(value).digest("hex");
}

test("the location index follows inserts, updates, deletes and reorders", () => {
  const chart = makeChart(2, 3);
  ensureChartLocations(chart);
  const note = chart.judgeLineList[0].notes[1];
  assert.equal(findNote(chart, note.id)?.line.index, 0);

  let state = stateFor(chart);
  applyRequest(state, { notes: { update: [{ id: note.id, patch: { positionX: 123 } }] } });
  assert.equal(findNote(state.chart, note.id)?.note.positionX, 123);

  const insertedId = "00000000-0000-7000-9000-000000000001";
  state = stateFor(state.chart);
  ensureChartLocations(state.chart);
  applyRequest(state, {
    notes: {
      insert: [
        {
          lineIndex: 0,
          note: {
            id: insertedId,
            type: 1,
            startTime: [1, 0, 1],
            endTime: [1, 0, 1],
            positionX: 0,
          },
        },
      ],
    },
  });
  assert.equal(findNote(state.chart, insertedId)?.line.index, 0);

  ensureChartLocations(state.chart);
  state.chart.judgeLineList[0].notes.reverse();
  assert.equal(findNote(state.chart, insertedId)?.line.index, 0);

  state = stateFor(state.chart);
  ensureChartLocations(state.chart);
  applyRequest(state, { notes: { delete: [insertedId] } });
  assert.equal(findNote(state.chart, insertedId), null);

  ensureChartLocations(state.chart);
  state.chart.judgeLineList.reverse();
  const firstLine = state.chart.judgeLineList[0];
  assert.equal(locateLine(state.chart, firstLine.id)?.index, 0);
  assert.equal(findNote(state.chart, firstLine.notes[0].id)?.line.index, 0);
});

test("transaction apply keeps the source chart and its objects unchanged", () => {
  const chart = makeChart(2, 3);
  const before = JSON.stringify(chart);
  const line = chart.judgeLineList[0];
  const updatedNote = line.notes[0];
  const deletedNote = line.notes[2];
  const updatedEvent = line.eventLayers[0].moveXEvents[0];
  const deletedEvent = line.eventLayers[0].alphaEvents[0];
  const state = stateFor(chart);

  applyRequest(state, {
    lines: { update: [{ id: line.id, patch: { Name: "Renamed" } }] },
    notes: {
      update: [{ id: updatedNote.id, patch: { positionX: 42, type: 2 } }],
      insert: [
        {
          lineIndex: 0,
          note: {
            id: "00000000-0000-7000-9000-000000000002",
            type: 1,
            startTime: [2, 0, 1],
            endTime: [2, 0, 1],
            positionX: 1,
          },
        },
      ],
      delete: [deletedNote.id],
    },
    events: {
      update: [{ id: updatedEvent.id, patch: { start: 99 } }],
      insert: [
        {
          lineIndex: 0,
          eventType: "moveXEvents",
          layer: 0,
          event: {
            id: "00000000-0000-7000-9000-000000000003",
            startTime: [2, 0, 1],
            endTime: [3, 0, 1],
            start: 1,
            end: 2,
          },
        },
      ],
      delete: [deletedEvent.id],
    },
  });

  assert.equal(state.issues.length, 0);
  assert.equal(JSON.stringify(chart), before);
  assert.equal(chart.judgeLineList[0].Name, "Line 0");
  assert.equal(chart.judgeLineList[0].notes.length, 3);
  assert.equal(chart.judgeLineList[0].eventLayers[0].moveXEvents[0].start, 0);
  assert.equal(state.chart.judgeLineList[0].Name, "Renamed");
  assert.equal(state.chart.judgeLineList[0].notes.length, 3);
});

test("numOfNotes is refreshed once from the final notes of each touched line", () => {
  const chart = makeChart(2, 4);
  const line = chart.judgeLineList[0];
  const [first, second, third] = line.notes;
  const initialCount = line.numOfNotes;
  const state = stateFor(chart);

  applyRequest(state, {
    notes: {
      update: [
        { id: first.id, patch: { type: 2 } },
        { id: second.id, patch: { type: 1 } },
      ],
      insert: [
        {
          lineIndex: 0,
          note: {
            id: "00000000-0000-7000-9000-000000000004",
            type: 2,
            startTime: [4, 0, 1],
            endTime: [5, 0, 1],
            positionX: 2,
          },
        },
        {
          lineIndex: 0,
          note: {
            id: "00000000-0000-7000-9000-000000000005",
            type: 1,
            startTime: [5, 0, 1],
            endTime: [5, 0, 1],
            positionX: 3,
          },
        },
      ],
      delete: [third.id],
    },
  });

  const touched = state.chart.judgeLineList[0];
  const expected = touched.notes.reduce((sum, note) => sum + (note.type === 2 ? 0 : 1), 0);
  assert.equal(touched.numOfNotes, expected);
  assert.equal(line.numOfNotes, initialCount);
  assert.equal(state.chart.judgeLineList[1].numOfNotes, 3);
});

test("1000 note updates stay byte-identical to the previous kernel", () => {
  const chart = makeChart(20, 100);
  const lines = chart.judgeLineList;
  const allNotes = lines.flatMap((line) => line.notes);
  const updates = [];
  for (let index = 0; index < 1000; index++) {
    updates.push({
      id: allNotes[(index * 7) % allNotes.length].id,
      patch: {
        positionX: index - 500,
        ...(index % 3 === 0 ? { startTime: [index % 17, index % 4, 4] } : {}),
        ...(index % 11 === 0 ? { type: 2 } : {}),
      },
    });
  }
  const updateIds = new Set(updates.map((update) => update.id));
  const deleteIds = allNotes
    .filter((note) => !updateIds.has(note.id))
    .slice(0, 10)
    .map((note) => note.id);
  const insertNotes = [];
  for (let index = 0; index < 20; index++) {
    insertNotes.push({
      lineIndex: index % lines.length,
      note: {
        id: `00000000-0000-7000-9000-${(index + 1).toString(16).padStart(12, "0")}`,
        type: 1,
        startTime: [index, 0, 4],
        endTime: [index, 0, 4],
        positionX: index,
        above: 1,
      },
    });
  }
  const event = lines[0].eventLayers[0].moveXEvents[0];
  const before = JSON.stringify(chart);
  const state = stateFor(chart);

  applyRequest(state, {
    label: "byte scenario",
    metadata: { name: "byte scenario" },
    lines: { update: [{ id: lines[1].id, patch: { Name: "Renamed" } }] },
    notes: { update: updates, insert: insertNotes, delete: deleteIds },
    events: { update: [{ id: event.id, patch: { start: 12, end: 34 } }] },
  });

  assert.equal(state.issues.length, 0);
  assert.equal(state.affected.length, 1051);
  assert.equal(JSON.stringify(chart), before);
  assert.equal(
    hash(JSON.stringify(state.chart)),
    "45efa4fdc724b141390190e1a64fa456f8ec7b7099df9a3bbcc47f04cfa9ceda",
  );
});

test("commit, undo and redo keep note lookups current", () => {
  const session = new EditorSession(makeChart(1, 3));
  const noteId = session.chart.judgeLineList[0].notes[0].id;
  const original = session.chart.judgeLineList[0].notes[0].positionX;

  const result = applyChartTransaction(session, {
    notes: { update: [{ id: noteId, patch: { positionX: 777 } }] },
  });
  assert.equal(result.status, "committed");
  assert.equal(findNote(session.chart, noteId)?.note.positionX, 777);

  assert.equal(session.travel("undo"), true);
  assert.equal(findNote(session.chart, noteId)?.note.positionX, original);

  assert.equal(session.travel("redo"), true);
  assert.equal(findNote(session.chart, noteId)?.note.positionX, 777);
});
