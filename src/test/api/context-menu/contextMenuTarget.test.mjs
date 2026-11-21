/** Timeline context-menu targets and right-press selection rules stay pure. */
import assert from "node:assert/strict";
import test from "node:test";
import {
  eventRefsFromSelection,
  eventSelectionForContextMenu,
  eventTargetFromRefs,
  markerTargetFromMarker,
  noteSelectionForContextMenu,
  noteTargetFromRefs,
  runContextMenuTarget,
} from "../../../core/edit/timeline/contextMenuTarget.ts";
import {
  readTimelineMarkers,
  updateTimelineMarker,
} from "../../../core/global/chart/timelineMarkers.ts";

const chart = {
  judgeLineList: [
    {
      notes: [{ id: "note-a" }, { id: "note-b" }, {}],
      eventLayers: [
        {},
        {},
        {
          moveXEvents: [
            { id: "event-move-0" },
            { id: "event-move-1" },
            { id: "event-move-2" },
            { id: "event-move-3" },
          ],
        },
      ],
    },
    {
      notes: [{ id: "note-c" }],
      eventLayers: [{}, {}, { alphaEvents: [{ id: "event-alpha-0" }] }],
    },
  ],
};

test("a note target exposes selected ids, line, beat, and chart seconds", () => {
  const target = noteTargetFromRefs(
    chart,
    [
      { lineIndex: 0, index: 0 },
      { lineIndex: 0, index: 1 },
    ],
    0,
    1.5,
    2.25,
  );
  assert.deepEqual(target, {
    surface: "notes",
    noteIds: ["note-a", "note-b"],
    lineIndex: 0,
    beat: 1.5,
    chartSeconds: 2.25,
  });
  assert.equal(noteTargetFromRefs(chart, [], 0, 0, 0), undefined);
});

test("a missing id withholds the whole note target", () => {
  assert.equal(
    noteTargetFromRefs(
      chart,
      [
        { lineIndex: 0, index: 0 },
        { lineIndex: 0, index: 2 },
      ],
      0,
      0,
      0,
    ),
    undefined,
  );
});

test("a plain right press replaces the note selection", () => {
  const update = noteSelectionForContextMenu(
    {
      lineIndex: 0,
      selection: new Set([1]),
      multiLineActive: false,
      multiLineSelection: new Map(),
    },
    { lineIndex: 0, index: 2 },
    { ctrl: false, shift: false },
  );
  assert.equal(update.changed, true);
  assert.deepEqual([...update.selection], [2]);
});

test("a right press on an already selected note keeps the selection", () => {
  const update = noteSelectionForContextMenu(
    {
      lineIndex: 0,
      selection: new Set([1]),
      multiLineActive: false,
      multiLineSelection: new Map(),
    },
    { lineIndex: 0, index: 1 },
    { ctrl: false, shift: false },
  );
  assert.equal(update.changed, false);
  assert.deepEqual([...update.selection], [1]);
});

test("Ctrl and Shift append a note to the selection", () => {
  for (const modifiers of [
    { ctrl: true, shift: false },
    { ctrl: false, shift: true },
  ]) {
    const update = noteSelectionForContextMenu(
      {
        lineIndex: 0,
        selection: new Set([1]),
        multiLineActive: false,
        multiLineSelection: new Map(),
      },
      { lineIndex: 0, index: 2 },
      modifiers,
    );
    assert.deepEqual([...update.selection], [1, 2]);
  }
});

test("a plain right press in multi-line mode drops other panels", () => {
  const update = noteSelectionForContextMenu(
    {
      lineIndex: 0,
      selection: new Set([1]),
      multiLineActive: true,
      multiLineSelection: new Map([
        [0, new Set([1])],
        [1, new Set([2])],
      ]),
    },
    { lineIndex: 1, index: 3 },
    { ctrl: false, shift: false },
  );
  assert.equal(update.changed, true);
  assert.deepEqual([...update.selection], [3]);
  assert.deepEqual([...update.multiLineSelection.keys()], [1]);
  assert.deepEqual([...(update.multiLineSelection.get(1) ?? [])], [3]);
});

test("event keys become typed references and one target", () => {
  const refs = eventRefsFromSelection(
    chart,
    [
      { lineIndex: 0, key: "moveXEvents:3" },
      { lineIndex: 1, key: "alphaEvents:0" },
      { lineIndex: 0, key: "broken" },
    ],
    2,
  );
  assert.deepEqual(refs, [
    { id: "event-move-3", lineIndex: 0, eventType: "moveXEvents", layer: 2, index: 3 },
    { id: "event-alpha-0", lineIndex: 1, eventType: "alphaEvents", layer: 2, index: 0 },
  ]);
  assert.deepEqual(eventTargetFromRefs(refs, 4, 1.25), {
    surface: "events",
    refs,
    beat: 4,
    chartSeconds: 1.25,
  });
  assert.equal(eventTargetFromRefs([], 0, 0), undefined);
});

test("event selection replaces or appends like a left click", () => {
  const base = {
    lineIndex: 0,
    selection: new Set(["moveXEvents:1"]),
    multiLineActive: false,
    multiLineSelection: new Map(),
  };
  assert.deepEqual(
    [
      ...eventSelectionForContextMenu(
        base,
        { lineIndex: 0, key: "alphaEvents:2" },
        {
          ctrl: false,
          shift: false,
        },
      ).selection,
    ],
    ["alphaEvents:2"],
  );
  assert.deepEqual(
    [
      ...eventSelectionForContextMenu(
        base,
        { lineIndex: 0, key: "alphaEvents:2" },
        {
          ctrl: true,
          shift: false,
        },
      ).selection,
    ],
    ["moveXEvents:1", "alphaEvents:2"],
  );
  assert.equal(
    eventSelectionForContextMenu(
      base,
      { lineIndex: 0, key: "moveXEvents:1" },
      {
        ctrl: false,
        shift: false,
      },
    ).changed,
    false,
  );
});

test("marker targets keep the surface, the marker beat, and the persistent marker id", () => {
  assert.deepEqual(markerTargetFromMarker({ id: "marker-a", beat: 12.5, name: "Drop" }), {
    surface: "marker",
    markerId: "marker-a",
    beat: 12.5,
  });
  assert.deepEqual(markerTargetFromMarker({ beat: 12.5, name: "Drop" }), {
    surface: "marker",
    beat: 12.5,
  });
  assert.deepEqual(markerTargetFromMarker(undefined), { surface: "marker", beat: 0 });
});

test("renaming a marker keeps its id and the same context target", () => {
  const [marker] = readTimelineMarkers({
    markers: [
      { beat: 2, name: "Drop" },
      { beat: 2, name: "Drop" },
    ],
  });
  const before = markerTargetFromMarker(marker);
  const [renamed] = updateTimelineMarker([marker], marker.id, { name: "Renamed" });
  const after = markerTargetFromMarker(renamed);
  assert.equal(renamed.id, marker.id);
  assert.deepEqual(after, before);
});

test("an action receives the menu target", () => {
  const target = markerTargetFromMarker({ beat: 1, name: "A" });
  let received;
  runContextMenuTarget((value) => {
    received = value;
  }, target);
  assert.equal(received, target);
  assert.doesNotThrow(() => runContextMenuTarget(undefined, target));
});
