/** Verifies the session gate used by room roles and remote history entries. */
import assert from "node:assert/strict";
import test from "node:test";
import { createChart, createEvent, createLine } from "../../../core/global/chart/chart.ts";
import { EditorSession } from "../../../core/edit/session/session.ts";
import { selectiveUndo } from "../../../core/edit/session/selectiveUndo.ts";
import { collaborationAccess } from "../../../core/collaboration/access.ts";

function renamed(chart, name) {
  return { ...chart, META: { ...chart.META, name } };
}

test("an idle client is not treated as a read-only viewer", () => {
  assert.deepEqual(collaborationAccess("", "viewer"), { active: false, readOnly: false });
  assert.deepEqual(collaborationAccess("ROOM", "viewer"), { active: true, readOnly: true });
  assert.deepEqual(collaborationAccess("ROOM", "editor"), { active: true, readOnly: false });
});

test("a viewer cannot commit, while an authoritative remote commit still applies", () => {
  const session = new EditorSession(createChart());
  session.setCollaborationAccess(true, true);
  assert.equal(session.editable, false);
  assert.equal(session.commitChart("local", renamed(session.chart, "local")), false);
  assert.equal(session.commitRemoteChart("remote", renamed(session.chart, "remote")), true);
  assert.equal(session.chart.META.name, "remote");
});

test("read-only sessions reject history travel as well as new commits", () => {
  const session = new EditorSession(createChart());
  assert.equal(session.commitChart("local", renamed(session.chart, "local")), true);
  session.setCollaborationAccess(true, true);
  assert.equal(session.editable, false);
  assert.equal(session.travel("undo"), false);
  assert.equal(session.chart.META.name, "local");

  const locked = new EditorSession(createChart(), true);
  assert.equal(locked.editable, false);
  assert.equal(locked.commitChart("local", renamed(locked.chart, "local")), false);
  assert.notEqual(locked.chart.META.name, "local");
});

test("a remote event insertion remaps the selected event by id", () => {
  const base = createChart();
  const line = base.judgeLineList[0];
  const selected = line.eventLayers[0].moveXEvents[0];
  const inserted = createEvent(5, 5);
  const next = {
    ...base,
    judgeLineList: [
      {
        ...line,
        eventLayers: line.eventLayers.map((layer, index) =>
          index === 0 ? { ...layer, moveXEvents: [inserted, selected] } : layer,
        ),
      },
    ],
  };
  const session = new EditorSession(base);
  session.focus = "events";
  session.eventLayer = 0;
  session.eventSelection.add("moveXEvents:0");

  assert.equal(session.commitRemoteChart("remote", next), true);
  assert.deepEqual([...session.eventSelection], ["moveXEvents:1"]);
  assert.equal(session.chart.judgeLineList[0].eventLayers[0].moveXEvents[1], selected);
});

test("remote event deletion drops the deleted event without shifting selection", () => {
  const base = createChart();
  const line = base.judgeLineList[0];
  const deleted = line.eventLayers[0].moveXEvents[0];
  const remaining = createEvent(5, 5);
  const next = {
    ...base,
    judgeLineList: [
      {
        ...line,
        eventLayers: line.eventLayers.map((layer, index) =>
          index === 0 ? { ...layer, moveXEvents: [remaining] } : layer,
        ),
      },
    ],
  };
  const session = new EditorSession(base);
  session.focus = "events";
  session.eventLayer = 0;
  session.eventSelection.add("moveXEvents:0");

  assert.equal(session.commitRemoteChart("remote", next), true);
  assert.deepEqual([...session.eventSelection], []);
  assert.notEqual(session.chart.judgeLineList[0].eventLayers[0].moveXEvents[0], deleted);
});

test("remote event reorder remaps a cloned event by stable id", () => {
  const base = createChart();
  const line = base.judgeLineList[0];
  const first = line.eventLayers[0].moveXEvents[0];
  const second = createEvent(5, 5);
  const next = {
    ...base,
    judgeLineList: [
      {
        ...line,
        eventLayers: line.eventLayers.map((layer, index) =>
          index === 0
            ? {
                ...layer,
                moveXEvents: [structuredClone(second), structuredClone(first)],
              }
            : layer,
        ),
      },
    ],
  };
  const session = new EditorSession({
    ...base,
    judgeLineList: [
      {
        ...line,
        eventLayers: line.eventLayers.map((layer, index) =>
          index === 0 ? { ...layer, moveXEvents: [first, second] } : layer,
        ),
      },
    ],
  });
  session.focus = "events";
  session.eventLayer = 0;
  session.eventSelection.add("moveXEvents:0");

  assert.equal(session.commitRemoteChart("remote", next), true);
  assert.deepEqual([...session.eventSelection], ["moveXEvents:1"]);
  assert.equal(session.chart.judgeLineList[0].eventLayers[0].moveXEvents[1].id, first.id);
});

test("remote line reorder remaps multi-line event selections by line id", () => {
  const base = createChart();
  base.judgeLineList.push(createLine("Line 2"));
  const first = base.judgeLineList[0];
  const second = base.judgeLineList[1];
  const next = { ...base, judgeLineList: [structuredClone(second), structuredClone(first)] };
  const session = new EditorSession(base);
  session.lineIndex = 1;
  session.focus = "events";
  session.eventLayer = 0;
  session.eventSelection.add("moveXEvents:0");
  session.multiLineEnabled = true;
  session.multiLineMode = "events";
  session.multiLineIndices = [1];
  session.multiEventSelection = new Map([[1, new Set(["moveXEvents:0"])]]);

  assert.equal(session.commitRemoteChart("remote", next), true);
  assert.equal(session.lineIndex, 0);
  assert.deepEqual([...session.multiLineIndices], [0]);
  assert.deepEqual([...session.multiEventSelection], [[0, new Set(["moveXEvents:0"])]]);
  assert.equal(session.chart.judgeLineList[0].id, second.id);
  assert.equal(
    session.chart.judgeLineList[0].eventLayers[0].moveXEvents[0].id,
    second.eventLayers[0].moveXEvents[0].id,
  );
});

test("linear undo stops at an authoritative remote entry", () => {
  const session = new EditorSession(createChart());
  session.setCollaborationAccess(true, false);
  assert.equal(session.commitRemoteChart("remote", renamed(session.chart, "remote")), true);
  assert.equal(session.travel("undo"), false);
  assert.equal(session.chart.META.name, "remote");
});

test("collaborative undo references the author's original transaction", () => {
  const session = new EditorSession(createChart());
  session.setCollaborationAccess(true, false);
  session.setCollaborationActor("actor-a");
  assert.equal(session.commitChart("local", renamed(session.chart, "local")), true);
  const entry = session.history.undoStack.at(-1);
  assert.equal(entry.origin.clientId, "actor-a");
  assert.match(entry.origin.requestId, /[0-9a-z-]/i);
  const result = selectiveUndo(session, entry.id, "undo local");
  assert.equal(result.status, "committed");
  const compensation = session.history.undoStack.at(-1);
  assert.equal(compensation.origin.kind, "collaborative-undo");
  assert.equal(compensation.origin.clientId, "actor-a");
  assert.equal(compensation.origin.undoOf, entry.origin.requestId);
  assert.notEqual(compensation.origin.requestId, entry.origin.requestId);

  session.setCollaborationActor("actor-b");
  assert.equal(selectiveUndo(session, entry.id, "not mine").status, "unavailable");
});

test("leaving the room permits local history again", () => {
  const session = new EditorSession(createChart());
  session.setCollaborationAccess(true, false);
  session.commitRemoteChart("remote", renamed(session.chart, "remote"));
  session.setCollaborationAccess(false, false);
  assert.equal(session.travel("undo"), true);
  assert.equal(session.chart.META.name, createChart().META.name);
});

test("room undo compensates the newest own entry beneath a remote commit", () => {
  const session = new EditorSession(createChart());
  session.setCollaborationAccess(true, false);
  session.setCollaborationActor("actor-a");
  assert.equal(session.commitChart("mine", renamed(session.chart, "mine")), true);
  const mine = session.history.undoStack.at(-1);
  const remote = {
    ...session.chart,
    META: { ...session.chart.META, level: "remote-level" },
  };
  assert.equal(session.commitRemoteChart("remote", remote), true);

  assert.equal(session.travel("undo"), true);
  assert.equal(session.chart.META.name, createChart().META.name);
  assert.equal(session.chart.META.level, "remote-level");
  const compensation = session.history.undoStack.at(-1);
  assert.equal(compensation.origin.kind, "collaborative-undo");
  assert.equal(compensation.origin.undoOf, mine.origin.requestId);
  assert.equal(session.travel("redo"), false);
});
