/** The room-exit seam publishes one provider operation and clears it on disposal. */
import assert from "node:assert/strict";
import test from "node:test";
import {
  bindCollaborationRoomExit,
  collaborationRoomExit,
} from "../../../frontend/screens/editor/workspace/collaboration/roomExit.ts";

test("the room exit is a no-op until the provider binds it", () => {
  assert.doesNotThrow(() => collaborationRoomExit.exit());
  const calls = [];
  const dispose = bindCollaborationRoomExit({
    exitForLibrary: () => calls.push("exit"),
  });
  collaborationRoomExit.exit();
  assert.deepEqual(calls, ["exit"]);
  dispose();
  collaborationRoomExit.exit();
  assert.deepEqual(calls, ["exit"]);
});
