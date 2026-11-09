/** Collaboration exit checks include preparation, connection and active rooms. */
import { test } from "node:test";
import { strict as assert } from "node:assert";
import {
  EMPTY_COLLABORATION_STATE,
  roomExitClosesRoom,
  roomNeedsExitConfirmation,
} from "../../../core/collaboration/ui.ts";

test("exiting asks about preparing and active collaboration sessions", () => {
  assert.equal(roomNeedsExitConfirmation(EMPTY_COLLABORATION_STATE, false), false);
  assert.equal(roomNeedsExitConfirmation(EMPTY_COLLABORATION_STATE, true), true);
  for (const status of ["connecting", "waiting", "connected", "reconnecting", "offline"]) {
    assert.equal(roomNeedsExitConfirmation({ ...EMPTY_COLLABORATION_STATE, status }, false), true);
  }
  assert.equal(
    roomNeedsExitConfirmation({ ...EMPTY_COLLABORATION_STATE, status: "error" }, false),
    false,
  );
  assert.equal(
    roomNeedsExitConfirmation(
      { ...EMPTY_COLLABORATION_STATE, status: "error", roomId: "room" },
      false,
    ),
    true,
  );
});

test("only an established host closes the room when the session ends", () => {
  assert.equal(roomExitClosesRoom(EMPTY_COLLABORATION_STATE), false);
  assert.equal(
    roomExitClosesRoom({ ...EMPTY_COLLABORATION_STATE, status: "connected", role: "host" }),
    false,
  );
  assert.equal(
    roomExitClosesRoom({
      ...EMPTY_COLLABORATION_STATE,
      status: "connected",
      role: "host",
      roomId: "room",
    }),
    true,
  );
  assert.equal(
    roomExitClosesRoom({
      ...EMPTY_COLLABORATION_STATE,
      status: "connected",
      role: "editor",
      roomId: "room",
    }),
    false,
  );
});
