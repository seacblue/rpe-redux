/** Checks host/guest resume records stay exclusive and tolerate bad data. */
import assert from "node:assert/strict";
import test from "node:test";
import {
  clearRoomSessions,
  parseStoredRoomSession,
  readRoomSession,
  sameRoomSession,
  updateRoomSession,
} from "../../../frontend/screens/editor/workspace/collaboration/sessionStore.ts";

const host = {
  roomId: "ROOM-HOST",
  resumeToken: "HOST-TOKEN",
  serverUrl: "ws://127.0.0.1:47830",
};
const guest = {
  roomId: "ROOM-GUEST",
  resumeToken: "GUEST-TOKEN",
  serverUrl: "ws://127.0.0.1:47831",
};

test("malformed session records are ignored", () => {
  assert.equal(parseStoredRoomSession(null), null);
  assert.equal(parseStoredRoomSession({}), null);
  assert.equal(parseStoredRoomSession({ ...host, roomId: " " }), null);
  assert.equal(parseStoredRoomSession({ ...host, resumeToken: "" }), null);
  assert.equal(parseStoredRoomSession({ ...host, serverUrl: " " }), null);
  assert.deepEqual(parseStoredRoomSession(host), host);
});

test("reading selects the requested role", () => {
  const section = { hostSession: host, guestSession: guest };
  assert.deepEqual(readRoomSession(section, "host"), host);
  assert.deepEqual(readRoomSession(section, "guest"), guest);
  assert.equal(readRoomSession(null, "host"), null);
});

test("writing one role clears the other and never mutates the input", () => {
  const section = { hostSession: host, guestSession: guest, displayName: "Seiko" };
  const next = updateRoomSession(section, "guest", guest);
  assert.deepEqual(next, { guestSession: guest, displayName: "Seiko" });
  assert.deepEqual(section, { hostSession: host, guestSession: guest, displayName: "Seiko" });
  assert.deepEqual(updateRoomSession(next, "host", host), {
    hostSession: host,
    displayName: "Seiko",
  });
});

test("session comparison catches every resumable change", () => {
  assert.equal(sameRoomSession(host, { ...host }), true);
  assert.equal(sameRoomSession(host, guest), false);
  assert.equal(sameRoomSession(null, null), true);
  assert.equal(sameRoomSession(host, null), false);
});

test("clearing one role leaves the other, and an exit clears both", () => {
  const section = { hostSession: host, guestSession: guest };
  assert.deepEqual(updateRoomSession(section, "host", null), { guestSession: guest });
  assert.deepEqual(clearRoomSessions(section), {});
  assert.deepEqual(clearRoomSessions(null), {});
});
