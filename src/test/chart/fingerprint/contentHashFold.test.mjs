/**
 * Guards the cached array-fingerprint seed.
 *
 * The canonical chart identity must stay bit-identical to the Rust streaming
 * index while the copy-on-write path stops re-walking whole note and event
 * arrays: a seeded digest, a digest after a point update, a multi-item delete,
 * an append, and a randomized edit sequence all have to equal the cold walk of
 * the same content. The pinned literals come from the native index test vector
 * and must not drift.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  inheritLineContentFingerprint,
  inheritValueContentFingerprint,
  lineContentFingerprint,
  lineContentFingerprintParts,
  markValueContentFingerprintDirty,
  primeLineContentFingerprint,
  removeValueContentFingerprint,
} from "../../../core/global/chart/chartContentHash.ts";
import {
  createChart,
  createEvent,
  createLine,
  createNote,
} from "../../../core/global/chart/chart.ts";
import { EditorSession } from "../../../core/edit/session/session.ts";
import { applyChartTransaction } from "../../../core/edit/transaction/preview.ts";
import {
  chartFingerprint,
  installChartRevisionSeed,
} from "../../../core/edit/document/chartRevision.ts";

/** Sizes around the 256-child block boundaries the seed checkpoints use. */
const BLOCK_STRADDLING_SIZES = [255, 256, 257, 512, 513, 1024, 1025];

/** One note with content that varies with `index`; ids are not needed here. */
function note(index, positionX = index) {
  const beat = Math.floor(index / 8);
  return {
    type: 1,
    positionX,
    startTime: [beat, 0, 8],
    endTime: [beat, 0, 8],
    alpha: 255,
    above: 1,
    size: 1,
  };
}

/** A deterministic note array with `length` distinct notes. */
function notesOf(length) {
  return Array.from({ length }, (unused, index) => note(index));
}

/** Cold digest of arbitrary content: fresh objects keep every seed out of it. */
function coldDigest(value) {
  return lineContentFingerprint(structuredClone(value));
}

/** Copy-on-write shell: clone, inherit the source seed, mark dirty, mutate. */
function copyOnWrite(source, mutate) {
  const clone = [...source];
  inheritValueContentFingerprint(source, clone);
  markValueContentFingerprintDirty(clone);
  mutate(clone);
  return clone;
}

/** Copy-on-write line shell: a transaction clones the line before it edits. */
function copyOnWriteLine(source) {
  const clone = { ...source };
  inheritLineContentFingerprint(source, clone);
  return clone;
}

/** Replace one note in place on a copy-on-write shell. */
function patchNote(notes, index, positionX) {
  notes[index] = { ...notes[index], positionX };
}

test("canonical line digest keeps the pinned native-index literals", () => {
  const line = {
    id: "line",
    notes: [{ id: "note", startTime: [0, 0, 1] }],
    eventLayers: [
      {
        alphaEvents: [{ id: "event", startTime: [1, 0, 1], endTime: [2, 0, 1], end: 0 }],
      },
    ],
  };
  const parts = lineContentFingerprintParts(line);
  assert.equal(parts.digest, "e07305ab");
  assert.equal(parts.childDigests.eventLayers, 632912271);
  assert.equal(parts.childDigests.notes, 4181772340);
  assert.equal(lineContentFingerprint(line), "e07305ab");
});

test("seeded arrays hash to the cold digest for every block-straddling size", () => {
  for (const length of BLOCK_STRADDLING_SIZES) {
    const source = notesOf(length);
    const cold = lineContentFingerprint(source);
    const clean = copyOnWrite(source, () => undefined);
    assert.equal(lineContentFingerprint(clean), cold, `size ${length}`);
    assert.equal(lineContentFingerprint(clean), cold, `no-op rehash size ${length}`);
  }
});

test("point and multi-point updates equal a fresh cold walk", () => {
  for (const length of BLOCK_STRADDLING_SIZES) {
    const source = notesOf(length);
    const coldSource = lineContentFingerprint(source);
    const edited = copyOnWrite(source, (notes) => {
      patchNote(notes, 0, -1);
      patchNote(notes, Math.floor(length / 2), 1);
      patchNote(notes, length - 1, 2);
    });
    assert.notEqual(lineContentFingerprint(edited), coldSource, `size ${length}`);
    assert.equal(lineContentFingerprint(edited), coldDigest(edited), `size ${length}`);
  }
});

test("delete rebase matches the apply kernel's before-splice call order", () => {
  const cases = [
    { length: 257, indexes: [0] },
    { length: 257, indexes: [3, 130, 255] },
    { length: 1025, indexes: [1, 512, 1024] },
    { length: 1025, indexes: [0, 1, 2, 255, 256, 257, 700] },
  ];
  for (const { length, indexes } of cases) {
    const source = notesOf(length);
    lineContentFingerprint(source);
    const edited = [...source];
    inheritValueContentFingerprint(source, edited);
    markValueContentFingerprintDirty(edited);
    removeValueContentFingerprint(edited, edited, indexes);
    for (const index of [...indexes].sort((left, right) => right - left)) {
      edited.splice(index, 1);
    }
    assert.equal(lineContentFingerprint(edited), coldDigest(edited), `size ${length}`);
  }
});

test("multi-item deletes combined with point patches equal a fresh cold walk", () => {
  const length = 1025;
  const source = notesOf(length);
  lineContentFingerprint(source);
  const edited = [...source];
  inheritValueContentFingerprint(source, edited);
  markValueContentFingerprintDirty(edited);
  patchNote(edited, 4, -4);
  patchNote(edited, 513, -5);
  patchNote(edited, 1024, -6);
  removeValueContentFingerprint(edited, edited, [0, 256, 257, 900]);
  for (const index of [900, 257, 256, 0]) {
    edited.splice(index, 1);
  }
  assert.equal(lineContentFingerprint(edited), coldDigest(edited));
});

test("appended notes before a point update equal a fresh cold walk", () => {
  for (const length of [255, 256, 257, 1024, 1025]) {
    const source = notesOf(length);
    lineContentFingerprint(source);
    const edited = copyOnWrite(source, (notes) => {
      for (let index = 0; index < 7; index += 1) {
        notes.push(note(length + index, 50 + index));
      }
      patchNote(notes, 10, -10);
    });
    assert.equal(lineContentFingerprint(edited), coldDigest(edited), `size ${length}`);
  }
});

test("randomized edit sequences keep the seeded digest equal to the cold walk", () => {
  const source = notesOf(1025);
  lineContentFingerprint(source);
  let committed = source;
  let counter = 0;
  for (let step = 0; step < 40; step += 1) {
    const next = [...committed];
    inheritValueContentFingerprint(committed, next);
    markValueContentFingerprintDirty(next);
    const kind = step % 4;
    if (kind === 0) {
      for (let patch = 0; patch < 3; patch += 1) {
        patchNote(next, (step * 37 + patch * 257) % next.length, counter++);
      }
    } else if (kind === 1) {
      const indexes = [
        ...new Set(
          Array.from(
            { length: 1 + (step % 3) },
            (_, index) => (step * 53 + index * 211) % next.length,
          ),
        ),
      ];
      removeValueContentFingerprint(next, next, indexes);
      for (const index of [...indexes].sort((left, right) => right - left)) {
        next.splice(index, 1);
      }
    } else if (kind === 2) {
      for (let append = 0; append < 1 + (step % 2); append += 1) {
        next.push(note(next.length, counter++));
      }
    } else {
      next.push(note(next.length, counter++));
      patchNote(next, (step * 17) % next.length, counter++);
      removeValueContentFingerprint(next, next, [0]);
      next.splice(0, 1);
    }
    const digest = lineContentFingerprint(next);
    assert.equal(digest, coldDigest(next), `step ${step} kind ${kind}`);
    committed = next;
  }
});

test("value digests prime a copy-on-write line to the cold digest", () => {
  const line = {
    Name: "Round Trip",
    notes: notesOf(300),
    eventLayers: [{ alphaEvents: Array.from({ length: 260 }, (_, index) => note(index)) }],
    extended: { scaleXEvents: [] },
  };
  const parts = lineContentFingerprintParts(line, { includeValueDigests: true });
  const primed = structuredClone(line);
  primeLineContentFingerprint(primed, parts.digest, parts.childDigests, parts.valueDigests);
  assert.equal(lineContentFingerprint(primed), parts.digest);
  assert.equal(lineContentFingerprint(primed), coldDigest(primed));

  const first = copyOnWriteLine(primed);
  const notes = [...first.notes];
  inheritValueContentFingerprint(first.notes, notes);
  markValueContentFingerprintDirty(notes);
  patchNote(notes, 17, -77);
  first.notes = notes;
  assert.equal(lineContentFingerprint(first), coldDigest(first));

  const second = copyOnWriteLine(first);
  const events = [...second.eventLayers[0].alphaEvents];
  inheritValueContentFingerprint(second.eventLayers[0].alphaEvents, events);
  markValueContentFingerprintDirty(events);
  events[259] = { ...events[259], start: 7 };
  second.eventLayers = [{ ...second.eventLayers[0], alphaEvents: events }];
  assert.notEqual(lineContentFingerprint(second), lineContentFingerprint(first));
  assert.equal(lineContentFingerprint(second), coldDigest(second));
});

test("primed child digests with unhashed primitive entries stay exact", () => {
  const line = {
    notes: [note(0), 7, note(2), "label"],
    eventLayers: [],
  };
  const parts = lineContentFingerprintParts(line, { includeValueDigests: true });
  const primed = structuredClone(line);
  primeLineContentFingerprint(primed, parts.digest, parts.childDigests, parts.valueDigests);
  const edited = copyOnWriteLine(primed);
  const notes = [...edited.notes];
  inheritValueContentFingerprint(edited.notes, notes);
  markValueContentFingerprintDirty(notes);
  notes[0] = { ...notes[0], positionX: -9 };
  edited.notes = notes;
  assert.notEqual(lineContentFingerprint(edited), parts.digest);
  assert.equal(lineContentFingerprint(edited), coldDigest(edited));
});

test("seeded copy-on-write edits change the canonical chart digest", () => {
  const chart = createChart();
  const line = createLine("Seeded");
  line.notes = [createNote(1, 0, 0.1), createNote(2, 1, 0.2), createNote(4, 2, 0.3)];
  line.eventLayers = [{}];
  line.eventLayers[0].alphaEvents = [createEvent(255, 0, 0, 4), createEvent(0, 255, 4, 8)];
  chart.judgeLineList = [line];
  installChartRevisionSeed(chart, {
    lines: [lineContentFingerprintParts(line, { includeValueDigests: true })],
  });
  const session = new EditorSession(chart);
  const before = chartFingerprint(session.chart);

  const noteId = session.chart.judgeLineList[0].notes[1].id;
  const noteResult = applyChartTransaction(session, {
    notes: { update: [{ id: noteId, patch: { positionX: 42 } }] },
  });
  assert.notEqual(noteResult.status, "unchanged");
  const afterNote = chartFingerprint(session.chart);
  assert.notEqual(afterNote, before);

  const eventId = session.chart.judgeLineList[0].eventLayers[0].alphaEvents[0].id;
  const eventResult = applyChartTransaction(session, {
    events: { update: [{ id: eventId, patch: { start: 7 } }] },
  });
  assert.notEqual(eventResult.status, "unchanged");
  const afterEvent = chartFingerprint(session.chart);
  assert.notEqual(afterEvent, afterNote);
});
