/** The library exit confirmation composes document and room state into one plan. */
import assert from "node:assert/strict";
import test from "node:test";
import { EMPTY_COLLABORATION_STATE } from "../../../core/collaboration/ui.ts";
import { planLeaveEditor } from "../../../frontend/screens/editor/workspace/runtime/commands/leaveEditor.ts";

/** Builds the editor snapshot the planner reads. */
function snapshot(overrides = {}) {
  return {
    hasDocument: true,
    dirty: false,
    roomDocument: false,
    collaboration: EMPTY_COLLABORATION_STATE,
    collaborationPreparing: false,
    ...overrides,
  };
}

/** Returns footer actions in display order. */
function actions(plan) {
  return plan.choices.map((choice) => choice.action);
}

test("a clean document still asks before returning to the library", () => {
  const plan = planLeaveEditor(snapshot());
  assert.equal(plan.titleKey, "editor.app.dialog.returnHomeTitle");
  assert.equal(plan.descriptionKey, "editor.app.dialog.returnHomeBody");
  assert.equal(plan.room, "none");
  assert.deepEqual(actions(plan), ["cancel", "exit"]);
});

test("a dirty document offers save, discard, and cancel", () => {
  const plan = planLeaveEditor(snapshot({ dirty: true }));
  assert.equal(plan.titleKey, "editor.app.dialog.unsavedChangesTitle");
  assert.deepEqual(actions(plan), ["cancel", "discard", "save"]);
  assert.equal(plan.choices[1].variant, "danger");
  assert.equal(plan.choices[2].variant, "solid");
});

test("a host warns that returning closes the room", () => {
  const plan = planLeaveEditor(
    snapshot({
      collaboration: {
        ...EMPTY_COLLABORATION_STATE,
        status: "connected",
        roomId: "room-1",
        role: "host",
      },
    }),
  );
  assert.equal(plan.room, "host");
  assert.equal(plan.titleKey, "editor.app.dialog.returnCloseRoomTitle");
  assert.deepEqual(actions(plan), ["cancel", "exit"]);
  assert.equal(plan.choices[1].labelKey, "editor.app.dialog.returnCloseRoom");
});

test("a dirty host can save before closing the room", () => {
  const plan = planLeaveEditor(
    snapshot({
      dirty: true,
      collaboration: {
        ...EMPTY_COLLABORATION_STATE,
        status: "connected",
        roomId: "room-1",
        role: "host",
      },
    }),
  );
  assert.equal(plan.room, "host");
  assert.equal(plan.titleKey, "editor.app.dialog.returnCloseRoomDirtyTitle");
  assert.deepEqual(actions(plan), ["cancel", "discard", "save"]);
  assert.equal(plan.choices[1].labelKey, "editor.app.dialog.discardCloseRoomAndReturn");
  assert.equal(plan.choices[2].labelKey, "editor.app.dialog.saveCloseRoomAndReturn");
});

test("a guest leaves the room instead of closing it", () => {
  const plan = planLeaveEditor(
    snapshot({
      collaboration: {
        ...EMPTY_COLLABORATION_STATE,
        status: "connected",
        roomId: "room-1",
        role: "editor",
      },
    }),
  );
  assert.equal(plan.room, "guest");
  assert.equal(plan.titleKey, "editor.app.dialog.returnLeaveRoomTitle");
  assert.deepEqual(actions(plan), ["cancel", "exit"]);
  assert.equal(plan.choices[1].labelKey, "editor.app.dialog.returnLeaveRoom");
});

test("a temporary room chart never offers a save that the room would refuse", () => {
  const plan = planLeaveEditor(
    snapshot({
      dirty: true,
      roomDocument: true,
      collaboration: {
        ...EMPTY_COLLABORATION_STATE,
        status: "connected",
        roomId: "room-1",
        role: "viewer",
      },
    }),
  );
  assert.equal(plan.temporaryDocument, true);
  assert.equal(plan.titleKey, "editor.app.dialog.returnRoomDocumentTitle");
  assert.deepEqual(actions(plan), ["cancel", "exit"]);
  assert.equal(plan.choices[1].labelKey, "editor.app.dialog.returnRoomDocumentConfirm");
});

test("an unfinished connection is reported as pending", () => {
  const plan = planLeaveEditor(
    snapshot({
      dirty: true,
      collaboration: { ...EMPTY_COLLABORATION_STATE, status: "connecting" },
      collaborationPreparing: true,
    }),
  );
  assert.equal(plan.room, "pending");
  assert.equal(plan.titleKey, "editor.app.dialog.returnCancelConnectDirtyTitle");
  assert.deepEqual(actions(plan), ["cancel", "discard", "save"]);
  assert.equal(plan.choices[1].labelKey, "editor.app.dialog.discardAndReturn");
  assert.equal(plan.choices[2].labelKey, "editor.app.dialog.saveAndReturn");
});

test("an idle or failed room does not decorate the document prompt", () => {
  for (const status of ["idle", "error"]) {
    const plan = planLeaveEditor(
      snapshot({ collaboration: { ...EMPTY_COLLABORATION_STATE, status } }),
    );
    assert.equal(plan.room, "none");
    assert.equal(plan.titleKey, "editor.app.dialog.returnHomeTitle");
  }
});
