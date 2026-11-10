/** Checks room ordering, roles, retries, conflicts, and presence without sockets. */
import assert from "node:assert/strict";
import test from "node:test";
import {
  CollaborationRooms,
  MAX_ROOMS,
  MAX_ROOMS_PER_OWNER,
  MAX_TX_LOG_BYTES,
} from "../../../core/collaboration/room.ts";
import { diffCharts } from "../../../core/collaboration/changes.ts";

function chart() {
  return {
    META: { name: "room" },
    BPMList: [{ beat: [0, 0, 1], bpm: 120 }],
    judgeLineList: [
      {
        id: "line",
        notes: [{ id: "note", positionX: 1 }],
        eventLayers: [],
      },
    ],
  };
}

function setup() {
  const rooms = new CollaborationRooms();
  const created = rooms.create({ name: "Host", color: "#ffffff" }, chart(), "fingerprint");
  assert.equal(created.ok, true);
  const { room, member: host } = created.value;
  return { rooms, room, host };
}

function joinEditor(rooms, room) {
  const joined = rooms.requestJoin(room.id, room.invite, { name: "Editor", color: "#00ff00" });
  assert.equal(joined.ok, true);
  const approved = rooms.approve(room.hostId, joined.value.request.requestId, true, "editor");
  assert.equal(approved.ok, true);
  return approved.value.member;
}

test("a chart without optional line collections can open a room", () => {
  const rooms = new CollaborationRooms();
  const sparse = {
    META: { name: "sparse" },
    BPMList: [{ bpm: 120, startTime: [0, 0, 1] }],
    judgeLineList: [
      { Name: "line without notes" },
      { notes: null, eventLayers: null },
      { notes: [], eventLayers: [] },
    ],
  };
  const created = rooms.create({ name: "Host", color: "#ffffff" }, sparse, "");
  assert.equal(created.ok, true);
  assert.deepEqual(created.value.room.chart, sparse);
  const changed = rooms.commit(created.value.member.id, "sparse-1", "rename", [
    { op: "set", path: "/META/name", before: "sparse", after: "renamed" },
  ]);
  assert.equal(changed.ok, true);
});

test("a join and resume require the room's exact product version", () => {
  const rooms = new CollaborationRooms();
  const created = rooms.create(
    { name: "Host", color: "#ffffff" },
    chart(),
    "",
    false,
    true,
    "",
    "",
    "1.0.7",
  );
  assert.equal(created.ok, true);
  const { room, member: host } = created.value;
  const newerJoin = rooms.requestJoin(
    room.id,
    room.invite,
    { name: "Newer guest", color: "#00ff00" },
    "1.0.8",
  );
  assert.equal(newerJoin.ok, false);
  assert.equal(newerJoin.code, "version_mismatch_client_newer");
  const olderJoin = rooms.requestJoin(
    room.id,
    room.invite,
    { name: "Older guest", color: "#0000ff" },
    "1.0.6",
  );
  assert.equal(olderJoin.ok, false);
  assert.equal(olderJoin.code, "version_mismatch_client_older");
  const unparsableJoin = rooms.requestJoin(
    room.id,
    room.invite,
    { name: "Unknown guest", color: "#ff0000" },
    "preview",
  );
  assert.equal(unparsableJoin.ok, false);
  assert.equal(unparsableJoin.code, "version_mismatch_unknown");
  const matchedJoin = rooms.requestJoin(
    room.id,
    room.invite,
    { name: "Guest", color: "#00ff00" },
    "1.0.7",
  );
  assert.equal(matchedJoin.ok, true);
  assert.equal(matchedJoin.value.member.role, "editor");
  const newerResume = rooms.resume(room.id, host.token, "1.0.8");
  assert.equal(newerResume.ok, false);
  assert.equal(newerResume.code, "version_mismatch_client_newer");
  const olderResume = rooms.resume(room.id, host.token, "1.0.6");
  assert.equal(olderResume.ok, false);
  assert.equal(olderResume.code, "version_mismatch_client_older");
  const matchedResume = rooms.resume(room.id, host.token, "1.0.7");
  assert.equal(matchedResume.ok, true);
});

test("room creation still rejects payloads without a chart envelope", () => {
  const rooms = new CollaborationRooms();
  const profile = { name: "Host", color: "#ffffff" };
  const invalid = [
    null,
    [],
    {},
    { META: [], BPMList: [] },
    { META: {}, BPMList: {} },
    { META: {}, BPMList: [], judgeLineList: {} },
    { META: {}, BPMList: [], judgeLineList: [null] },
    { META: {}, BPMList: [], judgeLineList: [{ notes: {} }] },
    { META: {}, BPMList: [], judgeLineList: [{ eventLayers: 1 }] },
  ];
  for (const chart of invalid) {
    const created = rooms.create(profile, chart, "");
    assert.equal(created.ok, false);
    assert.equal(created.code, "invalid_chart");
  }
});

test("host approval creates an editor and viewer permissions are enforced", () => {
  const { rooms, room, host } = setup();
  const editor = joinEditor(rooms, room);
  assert.equal(editor.role, "editor");
  const joined = rooms.requestJoin(room.id, room.invite, { name: "Viewer", color: "#0000ff" });
  const viewer = rooms.approve(room.hostId, joined.value.request.requestId, true, "viewer").value
    .member;
  assert.equal(viewer.role, "viewer");
  const change = diffCharts(chart(), {
    ...chart(),
    META: { name: "next" },
  });
  const denied = rooms.commit(viewer.id, "viewer-1", "viewer edit", change);
  assert.equal(denied.ok, false);
  assert.equal(denied.code, "read_only");
  const allowed = rooms.commit(editor.id, "editor-1", "editor edit", change);
  assert.equal(allowed.ok, true);
  assert.equal(allowed.value.revision, 1);
  assert.equal(room.chart.META.name, "next");
  assert.equal(host.role, "host");
});

test("hosts can choose a case-sensitive room password", () => {
  const rooms = new CollaborationRooms();
  const short = rooms.create(
    { name: "Host", color: "#ffffff" },
    chart(),
    "fingerprint",
    false,
    false,
    "short7",
  );
  assert.equal(short.ok, false);
  assert.equal(short.code, "bad_invite");
  const created = rooms.create(
    { name: "Host", color: "#ffffff" },
    chart(),
    "fingerprint",
    false,
    false,
    "Secret42",
  );
  const { room } = created.value;
  assert.equal(room.invite, "Secret42");
  assert.equal(
    rooms.requestJoin(room.id, "secret42", { name: "Guest", color: "#00ff00" }).ok,
    false,
  );
  assert.equal(
    rooms.requestJoin(room.id, "Secret42", { name: "Guest", color: "#00ff00" }).ok,
    true,
  );
});

test("hosts can lower the live member limit", () => {
  const rooms = new CollaborationRooms();
  const created = rooms.create(
    { name: "Host", color: "#ffffff" },
    chart(),
    "fingerprint",
    false,
    true,
  );
  const { room } = created.value;
  const host = created.value.member;
  assert.equal(rooms.setMaxMembers(host.id, 2).ok, true);
  assert.equal(rooms.setMaxMembers(host.id, 33).ok, false);
  const first = rooms.requestJoin(room.id, room.invite, { name: "One", color: "#00ff00" });
  assert.equal(first.ok, true);
  const second = rooms.requestJoin(room.id, room.invite, { name: "Two", color: "#ff0000" });
  assert.equal(second.ok, false);
  assert.equal(second.code, "room_full");
  assert.equal(rooms.setMaxMembers(first.value.member.id, 3).ok, false);
});

test("lowering the limit keeps existing members and blocks further joins", () => {
  const rooms = new CollaborationRooms();
  const created = rooms.create(
    { name: "Host", color: "#ffffff" },
    chart(),
    "fingerprint",
    false,
    true,
  );
  const { room } = created.value;
  const host = created.value.member;
  const first = rooms.requestJoin(room.id, room.invite, { name: "One", color: "#00ff00" });
  const second = rooms.requestJoin(room.id, room.invite, { name: "Two", color: "#ff0000" });
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(room.members.size, 3);

  assert.equal(rooms.setMaxMembers(host.id, 2).ok, true);
  assert.equal(room.maxMembers, 2);
  assert.equal(room.members.size, 3);
  assert.equal(room.members.get(first.value.member.id).online, true);
  assert.equal(room.members.get(second.value.member.id).online, true);

  const third = rooms.requestJoin(room.id, room.invite, { name: "Three", color: "#0000ff" });
  assert.equal(third.ok, false);
  assert.equal(third.code, "room_full");
});

test("approval rechecks the live member limit before admitting a request", () => {
  const { rooms, room, host } = setup();
  assert.equal(rooms.setMaxMembers(host.id, 2).ok, true);
  const first = rooms.requestJoin(room.id, room.invite, { name: "One", color: "#00ff00" });
  const second = rooms.requestJoin(room.id, room.invite, { name: "Two", color: "#ff0000" });
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  const firstMember = rooms.approve(host.id, first.value.request.requestId, true, "editor");
  assert.equal(firstMember.ok, true);
  const denied = rooms.approve(host.id, second.value.request.requestId, true, "editor");
  assert.equal(denied.ok, false);
  assert.equal(denied.code, "room_full");
  assert.equal(room.pending.has(second.value.request.requestId), true);
  rooms.leave(firstMember.value.member.id);
  const retried = rooms.approve(host.id, second.value.request.requestId, true, "editor");
  assert.equal(retried.ok, true);
  assert.equal(retried.value.member.role, "editor");
});

test("a room joins by password when the endpoint supplies no room code", () => {
  const rooms = new CollaborationRooms();
  const created = rooms.create(
    { name: "Host", color: "#ffffff" },
    chart(),
    "fingerprint",
    false,
    true,
  );
  const { room } = created.value;
  const joined = rooms.requestJoin("", room.invite, { name: "Friend", color: "#00ff00" });
  assert.equal(joined.ok, true);
  assert.equal(joined.value.room.id, room.id);
  assert.equal(joined.value.member.role, "editor");
});

test("auto-approve rooms create editors without a pending request", () => {
  const rooms = new CollaborationRooms();
  const created = rooms.create(
    { name: "Host", color: "#ffffff" },
    chart(),
    "fingerprint",
    false,
    true,
  );
  const { room } = created.value;
  const joined = rooms.requestJoin(room.id, room.invite, {
    name: "Friend",
    color: "#00ff00",
  });
  assert.equal(joined.ok, true);
  assert.equal(joined.value.member.role, "editor");
  assert.equal(joined.value.request, undefined);
  assert.equal(room.pending.size, 0);
  const change = diffCharts(chart(), { ...chart(), META: { name: "friend" } });
  assert.equal(rooms.commit(joined.value.member.id, "friend-edit", "edit", change).ok, true);
});

test("replayed transaction ids are deduplicated per actor and content", () => {
  const { rooms, room } = setup();
  const editor = joinEditor(rooms, room);
  const other = joinEditor(rooms, room);
  const changes = diffCharts(chart(), { ...chart(), META: { name: "once" } });
  const first = rooms.commit(editor.id, "same", "edit", changes);
  const second = rooms.commit(editor.id, "same", "edit", changes);
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(second.value.replayed, true);
  assert.equal(second.value.revision, first.value.revision);
  assert.equal(room.revision, 1);
  const reused = rooms.commit(
    editor.id,
    "same",
    "edit",
    diffCharts(chart(), { ...chart(), META: { name: "again" } }),
  );
  assert.equal(reused.ok, false);
  assert.equal(reused.code, "transaction_reused");
  const otherCommit = rooms.commit(
    other.id,
    "same",
    "edit",
    diffCharts({ ...chart(), META: { name: "once" } }, { ...chart(), META: { name: "twice" } }),
  );
  assert.equal(otherCommit.ok, true);
  assert.equal(otherCommit.value.replayed, undefined);
  assert.equal(otherCommit.value.revision, 2);
});

test("only the author can compensate a transaction, and only once", () => {
  const { rooms, room } = setup();
  const editor = joinEditor(rooms, room);
  const other = joinEditor(rooms, room);
  const original = diffCharts(chart(), { ...chart(), META: { name: "A" } });
  assert.equal(rooms.commit(editor.id, "tx-a", "A", original).ok, true);
  const reverse = diffCharts({ ...chart(), META: { name: "A" } }, chart());
  const denied = rooms.commit(other.id, "tx-other", "undo A", reverse, "tx-a");
  assert.equal(denied.ok, false);
  assert.equal(denied.code, "undo_forbidden");
  const undone = rooms.commit(editor.id, "tx-undo", "undo A", reverse, "tx-a");
  assert.equal(undone.ok, true);
  assert.equal(undone.value.undoOf, "tx-a");
  assert.equal(room.chart.META.name, "room");
  const duplicate = rooms.commit(editor.id, "tx-undo-2", "undo A again", reverse, "tx-a");
  assert.equal(duplicate.ok, false);
  assert.equal(duplicate.code, "already_undone");
});

test("a stale field rejects the whole batch", () => {
  const { rooms, room } = setup();
  const editor = joinEditor(rooms, room);
  const original = chart();
  const first = diffCharts(original, {
    ...original,
    META: { name: "first" },
  });
  const second = diffCharts(original, {
    ...original,
    META: { name: "second" },
  });
  assert.equal(rooms.commit(editor.id, "a", "first", first).ok, true);
  const conflicted = rooms.commit(editor.id, "b", "second", second);
  assert.equal(conflicted.ok, false);
  assert.equal(conflicted.code, "conflict");
  assert.equal(room.chart.META.name, "first");
  assert.equal(room.revision, 1);
});

test("host can change roles, remove members, and resume a session", () => {
  const { rooms, room } = setup();
  const editor = joinEditor(rooms, room);
  const changed = rooms.setRole(room.hostId, editor.id, "viewer");
  assert.equal(changed.ok, true);
  assert.equal(editor.role, "viewer");
  const resumed = rooms.resume(room.id, editor.token);
  assert.equal(resumed.ok, true);
  assert.equal(resumed.value.member.id, editor.id);
  const removed = rooms.removeMember(room.hostId, editor.id);
  assert.equal(removed.ok, true);
  assert.equal(rooms.commit(editor.id, "removed", "edit", diffCharts(chart(), chart())).ok, false);
});

test("locks are all-or-nothing across chart, line, and object scopes", () => {
  const { rooms, room } = setup();
  const editor = joinEditor(rooms, room);
  const other = joinEditor(rooms, room);
  const acquired = rooms.acquireLocks(editor.id, ["line:line", "obj:note"]);
  assert.equal(acquired.ok, true);
  assert.equal(rooms.roomLocks(room).length, 2);
  const denied = rooms.acquireLocks(other.id, ["obj:note"]);
  assert.equal(denied.ok, false);
  assert.equal(denied.code, "locked");
  const base = chart();
  const next = structuredClone(base);
  next.judgeLineList[0].notes[0].positionX = 9;
  const blocked = rooms.commit(other.id, "locked-edit", "blocked", diffCharts(base, next));
  assert.equal(blocked.ok, false);
  assert.equal(blocked.code, "locked");
  rooms.releaseLocks(editor.id, ["line:line", "obj:note"]);
  const allowed = rooms.commit(other.id, "unlocked-edit", "allowed", diffCharts(base, next));
  assert.equal(allowed.ok, true);
});

test("assets are content-addressed, role checked, and scoped to members", () => {
  const { rooms, room, host } = setup();
  const editor = joinEditor(rooms, room);
  const hash = "a".repeat(64);
  const bytes = new Uint8Array([1, 2, 3]);
  const accepted = rooms.acceptAsset(
    editor.id,
    "cover.png",
    hash,
    bytes.length,
    "image/png",
    bytes,
  );
  assert.equal(accepted.ok, true);
  assert.deepEqual(rooms.assetManifest(room), [
    { name: "cover.png", hash, size: 3, mime: "image/png" },
  ]);
  assert.equal(rooms.assetForMember(editor.id, hash).ok, true);
  assert.equal(
    rooms.acceptAsset(editor.id, "../secret.png", hash, 3, "image/png", bytes).ok,
    false,
  );
  const viewerJoin = rooms.requestJoin(room.id, room.invite, { name: "Viewer", color: "#0000ff" });
  const viewer = rooms.approve(room.hostId, viewerJoin.value.request.requestId, true, "viewer")
    .value.member;
  assert.equal(
    rooms.acceptAsset(viewer.id, "other.png", "b".repeat(64), 3, "image/png", bytes).ok,
    false,
  );
  assert.equal(rooms.assetForMember(viewer.id, hash).ok, true);

  const replacement = "d".repeat(64);
  const replaced = rooms.acceptAsset(
    editor.id,
    "cover.png",
    replacement,
    4,
    "image/png",
    new Uint8Array(4),
  );
  assert.equal(replaced.ok, true);
  assert.equal(rooms.assetManifest(room)[0].hash, replacement);
  assert.equal(
    rooms.acceptAsset(editor.id, "extra.png", replacement, 4, "image/png", new Uint8Array(4)).ok,
    true,
  );
  assert.equal(
    rooms.acceptAsset(host.id, "cover.png", replacement, 4, "image/png", new Uint8Array(4)).ok,
    true,
  );
  assert.equal(rooms.assetManifest(room).length, 2);
  assert.equal(rooms.assetForMember(editor.id, hash).ok, false);
  assert.equal(rooms.assetForMember(editor.id, replacement, "cover.png").ok, true);
});

test("rooms and content-addressed blobs survive an export and import", () => {
  const { rooms, room, host } = setup();
  const hash = "c".repeat(64);
  const bytes = new Uint8Array([7, 8, 9]);
  assert.equal(rooms.acceptAsset(host.id, "cover.png", hash, 3, "image/png", bytes).ok, true);
  const original = chart();
  const changed = { ...original, META: { name: "persisted-edit" } };
  assert.equal(
    rooms.commit(host.id, "host-edit", "persisted edit", diffCharts(original, changed)).ok,
    true,
  );
  const state = rooms.exportState();
  const restored = new CollaborationRooms();
  restored.importState(state, new Map([[hash, bytes]]));
  const resumed = restored.resume(room.id, host.token);
  assert.equal(resumed.ok, true);
  assert.equal(restored.assetManifest(resumed.value.room)[0].hash, hash);
  assert.deepEqual([...restored.assetForMember(host.id, hash).value.bytes], [...bytes]);
  const undo = restored.commit(
    host.id,
    "host-undo",
    "undo persisted edit",
    diffCharts(changed, original),
    "host-edit",
  );
  assert.equal(undo.ok, true);
  assert.equal(undo.value.undoOf, "host-edit");
});

test("presence is ephemeral and scoped to the member", () => {
  const { rooms, room } = setup();
  const editor = joinEditor(rooms, room);
  rooms.updatePresence(editor.id, {
    memberId: editor.id,
    area: "edit",
    lineId: "line",
    beat: 4,
    positionX: 2,
    selectedEventIds: ["event-1"],
    updatedAt: 10,
  });
  assert.deepEqual(rooms.presence(room)[0].selectedEventIds, ["event-1"]);
  rooms.leave(editor.id);
  assert.equal(rooms.presence(room).length, 0);
  assert.equal(editor.online, false);
});

test("room creation is bounded globally and per owner", () => {
  const rooms = new CollaborationRooms();
  for (let index = 0; index < MAX_ROOMS_PER_OWNER; index += 1) {
    const created = rooms.create(
      { name: "Host", color: "#ffffff" },
      chart(),
      "fingerprint",
      false,
      false,
      "",
      "client:a",
    );
    assert.equal(created.ok, true);
  }
  const ownerLimited = rooms.create(
    { name: "Host", color: "#ffffff" },
    chart(),
    "fingerprint",
    false,
    false,
    "",
    "client:a",
  );
  assert.equal(ownerLimited.ok, false);
  assert.equal(ownerLimited.code, "owner_rooms_full");
  while (rooms.roomCount() < MAX_ROOMS) {
    const created = rooms.create(
      { name: "Host", color: "#ffffff" },
      chart(),
      "fingerprint",
      false,
      false,
      "",
      `client:${rooms.roomCount()}`,
    );
    assert.equal(created.ok, true);
  }
  const globalLimited = rooms.create(
    { name: "Host", color: "#ffffff" },
    chart(),
    "fingerprint",
    false,
    false,
    "",
    "client:overflow",
  );
  assert.equal(globalLimited.ok, false);
  assert.equal(globalLimited.code, "rooms_full");
});

test("plaintext logs evict the oldest transaction by byte budget", () => {
  const { rooms, room, host } = setup();
  const first = diffCharts(chart(), { ...chart(), META: { name: "one" } });
  assert.equal(rooms.commit(host.id, "first", "first", first).ok, true);
  room.transactionBytes = MAX_TX_LOG_BYTES - 10;
  const second = diffCharts(
    { ...chart(), META: { name: "one" } },
    { ...chart(), META: { name: "two" } },
  );
  assert.equal(rooms.commit(host.id, "second", "second", second).ok, true);
  assert.equal(room.transactions.size, 1);
  assert.ok(room.transactionBytes <= MAX_TX_LOG_BYTES);
  assert.equal(room.transactions.has(`${host.id}\u0000second`), true);
});

test("encrypted logs reject commits after the byte budget is full", () => {
  const rooms = new CollaborationRooms();
  const initial = { v: 1, alg: "AES-GCM", iv: "0123456789abcdef", data: "initial" };
  const created = rooms.create({ name: "Host", color: "#ffffff" }, initial, "", true);
  assert.equal(created.ok, true);
  const { room, member: host } = created.value;
  assert.equal(rooms.acquireLocks(host.id, ["chart"]).ok, true);
  room.transactionBytes = MAX_TX_LOG_BYTES;
  const next = { v: 1, alg: "AES-GCM", iv: "fedcba9876543210", data: "next" };
  const committed = rooms.commit(host.id, "tx", "edit", next, undefined, ["chart"]);
  assert.equal(committed.ok, false);
  assert.equal(committed.code, "log_full");
  assert.equal(room.revision, 0);
  assert.equal(room.transactions.size, 0);
});

test("only the host can close a room and the room is deleted", () => {
  const { rooms, room, host } = setup();
  const editor = joinEditor(rooms, room);
  const denied = rooms.closeRoom(editor.id);
  assert.equal(denied.ok, false);
  assert.equal(denied.code, "forbidden");
  const closed = rooms.closeRoom(host.id);
  assert.equal(closed.ok, true);
  assert.equal(closed.value.memberIds.length, 2);
  assert.equal(rooms.roomCount(), 0);
  assert.equal(rooms.resume(room.id, host.token).code, "no_room");
});
