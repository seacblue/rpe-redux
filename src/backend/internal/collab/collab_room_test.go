// Behavioral tests for the embedded collaboration room: roles, transaction
// ordering, undo audit, leases, assets, and restart persistence.

package collab

import (
	"reflect"
	"strings"
	"testing"
)

func collabSetup(t *testing.T) (*Rooms, *collabRoom, *collabMember) {
	t.Helper()
	rooms := NewRooms()
	room, host, failure := rooms.create(
		collabProfile{Name: "Host", Color: "#ffffff"},
		collabTestChart(),
		"fingerprint",
	)
	if failure != nil {
		t.Fatalf("create: %v", failure)
	}
	return rooms, room, host
}

func collabJoinEditor(t *testing.T, rooms *Rooms, room *collabRoom) *collabMember {
	t.Helper()
	_, request, failure := rooms.requestJoin(room.ID, room.Invite, collabProfile{Name: "Editor", Color: "#00ff00"})
	if failure != nil {
		t.Fatalf("requestJoin: %v", failure)
	}
	_, _, member, failure := rooms.approve(room.HostID, request.RequestID, true, "editor")
	if failure != nil {
		t.Fatalf("approve: %v", failure)
	}
	if member == nil {
		t.Fatal("approve returned no member")
	}
	return member
}

func TestCollabRolesAndReadOnlyEnforcement(t *testing.T) {
	rooms, room, host := collabSetup(t)
	editor := collabJoinEditor(t, rooms, room)
	if editor.Role != "editor" {
		t.Fatalf("editor role = %s", editor.Role)
	}
	_, request, _ := rooms.requestJoin(room.ID, room.Invite, collabProfile{Name: "Viewer", Color: "#0000ff"})
	_, _, viewer, _ := rooms.approve(room.HostID, request.RequestID, true, "viewer")
	change := []collabChange{{Op: "set", Path: "/META/name", Before: "room", After: "next"}}
	if _, failure := rooms.commit(viewer.ID, "viewer-1", "viewer edit", change, ""); failure == nil || failure.Code != "read_only" {
		t.Fatalf("viewer commit = %v", failure)
	}
	committed, failure := rooms.commit(editor.ID, "editor-1", "editor edit", change, "")
	if failure != nil {
		t.Fatalf("editor commit: %v", failure)
	}
	if committed.Revision != 1 {
		t.Fatalf("revision = %d", committed.Revision)
	}
	if room.Chart.(map[string]any)["META"].(map[string]any)["name"] != "next" {
		t.Fatal("chart did not change")
	}
	if host.Role != "host" {
		t.Fatalf("host role = %s", host.Role)
	}
}

func TestCollabJoinWithoutRoomCode(t *testing.T) {
	rooms, room, _ := collabSetup(t)
	_, request, failure := rooms.requestJoin("", room.Invite, collabProfile{Name: "Editor", Color: "#00ff00"})
	if failure != nil {
		t.Fatalf("requestJoin without code: %v", failure)
	}
	if request == nil {
		t.Fatal("requestJoin without code created no request")
	}
}

func TestCollabChartWithoutOptionalLineCollectionsCanOpenRoom(t *testing.T) {
	chart := map[string]any{
		"META":    map[string]any{"name": "sparse"},
		"BPMList": []any{},
		"judgeLineList": []any{
			map[string]any{"Name": "line without notes"},
			map[string]any{"notes": nil, "eventLayers": nil},
			map[string]any{"notes": []any{}, "eventLayers": []any{}},
		},
	}
	rooms := NewRooms()
	room, host, failure := rooms.create(
		collabProfile{Name: "Host", Color: "#ffffff"},
		chart,
		"",
	)
	if failure != nil {
		t.Fatalf("create: %v", failure)
	}
	lines, ok := room.Chart.(map[string]any)["judgeLineList"].([]any)
	if !ok || len(lines) != 3 {
		t.Fatalf("lines = %v", lines)
	}
	if _, failure := rooms.commit(host.ID, "sparse-1", "rename", []collabChange{
		{Op: "set", Path: "/META/name", Before: "sparse", After: "renamed"},
	}, ""); failure != nil {
		t.Fatalf("commit: %v", failure)
	}
}

func TestCollabRoomRejectsPayloadsWithoutChartEnvelope(t *testing.T) {
	cases := map[string]any{
		"null":             nil,
		"array":            []any{},
		"missing meta":     map[string]any{"BPMList": []any{}},
		"non-array bpm":    map[string]any{"META": map[string]any{}, "BPMList": map[string]any{}},
		"non-array lines":  map[string]any{"META": map[string]any{}, "BPMList": []any{}, "judgeLineList": map[string]any{}},
		"non-object line":  map[string]any{"META": map[string]any{}, "BPMList": []any{}, "judgeLineList": []any{nil}},
		"non-array notes":  map[string]any{"META": map[string]any{}, "BPMList": []any{}, "judgeLineList": []any{map[string]any{"notes": map[string]any{}}}},
		"non-array layers": map[string]any{"META": map[string]any{}, "BPMList": []any{}, "judgeLineList": []any{map[string]any{"eventLayers": 1.0}}},
	}
	for label, chart := range cases {
		rooms := NewRooms()
		if _, _, failure := rooms.create(
			collabProfile{Name: "Host", Color: "#ffffff"},
			chart,
			"",
		); failure == nil || failure.Code != "invalid_chart" {
			t.Fatalf("%s: %v", label, failure)
		}
	}
}

func TestCollabCustomRoomPassword(t *testing.T) {
	rooms := NewRooms()
	room, _, failure := rooms.create(
		collabProfile{Name: "Host", Color: "#ffffff"},
		collabTestChart(),
		"",
		collabCreateOptions{Invite: "Secret42"},
	)
	if failure != nil {
		t.Fatalf("create: %v", failure)
	}
	if room.Invite != "Secret42" {
		t.Fatalf("invite = %q", room.Invite)
	}
	if _, _, _, failure := rooms.requestJoinWithAuto(
		room.ID,
		"secret42",
		collabProfile{Name: "Guest", Color: "#00ff00"},
	); failure == nil {
		t.Fatal("case-changed password should fail")
	}
	if _, request, failure := rooms.requestJoin(
		room.ID,
		"Secret42",
		collabProfile{Name: "Guest", Color: "#00ff00"},
	); failure != nil || request == nil {
		t.Fatalf("join: %v %+v", failure, request)
	}
}

func TestCollabHostCanLowerMemberLimit(t *testing.T) {
	rooms := NewRooms()
	room, host, failure := rooms.create(
		collabProfile{Name: "Host", Color: "#ffffff"},
		collabTestChart(),
		"",
		collabCreateOptions{AutoApproveEditor: true},
	)
	if failure != nil {
		t.Fatalf("create: %v", failure)
	}
	if _, failure := rooms.setMaxMembers(host.ID, 2); failure != nil {
		t.Fatalf("set limit: %v", failure)
	}
	if _, _, member, failure := rooms.requestJoinWithAuto(
		room.ID,
		room.Invite,
		collabProfile{Name: "One", Color: "#00ff00"},
	); failure != nil || member == nil {
		t.Fatalf("first join: %v", failure)
	}
	if _, _, _, failure := rooms.requestJoinWithAuto(
		room.ID,
		room.Invite,
		collabProfile{Name: "Two", Color: "#ff0000"},
	); failure == nil || failure.Code != "room_full" {
		t.Fatalf("second join failure = %+v", failure)
	}
}

func TestCollabApproveRechecksMemberLimit(t *testing.T) {
	rooms, room, host := collabSetup(t)
	if _, failure := rooms.setMaxMembers(host.ID, 2); failure != nil {
		t.Fatalf("set limit: %v", failure)
	}
	_, first, failure := rooms.requestJoin(room.ID, room.Invite, collabProfile{Name: "One", Color: "#00ff00"})
	if failure != nil {
		t.Fatalf("first request: %v", failure)
	}
	_, second, failure := rooms.requestJoin(room.ID, room.Invite, collabProfile{Name: "Two", Color: "#ff0000"})
	if failure != nil {
		t.Fatalf("second request: %v", failure)
	}
	_, _, firstMember, failure := rooms.approve(room.HostID, first.RequestID, true, "editor")
	if failure != nil || firstMember == nil {
		t.Fatalf("first approve: %v", failure)
	}
	if _, _, _, failure := rooms.approve(room.HostID, second.RequestID, true, "editor"); failure == nil || failure.Code != "room_full" || failure.Message != "Room is full" {
		t.Fatalf("over-capacity approve = %v", failure)
	}
	if room.Pending[second.RequestID] == nil {
		t.Fatal("capacity rejection should preserve the pending request")
	}
	rooms.leave(firstMember.ID)
	if _, _, member, failure := rooms.approve(room.HostID, second.RequestID, true, "editor"); failure != nil || member == nil {
		t.Fatalf("retry approve: %v", failure)
	}
}

func TestCollabMemberLimitMayDropBelowOnlineMembersWithoutRemovingThem(t *testing.T) {
	rooms := NewRooms()
	room, host, failure := rooms.create(
		collabProfile{Name: "Host", Color: "#ffffff"},
		collabTestChart(),
		"",
		collabCreateOptions{AutoApproveEditor: true},
	)
	if failure != nil {
		t.Fatalf("create: %v", failure)
	}
	_, _, first, failure := rooms.requestJoinWithAuto(
		room.ID,
		room.Invite,
		collabProfile{Name: "One", Color: "#00ff00"},
	)
	if failure != nil || first == nil {
		t.Fatalf("first join: %v", failure)
	}
	_, _, second, failure := rooms.requestJoinWithAuto(
		room.ID,
		room.Invite,
		collabProfile{Name: "Two", Color: "#ff0000"},
	)
	if failure != nil || second == nil {
		t.Fatalf("second join: %v", failure)
	}
	if _, failure := rooms.setMaxMembers(host.ID, 2); failure != nil {
		t.Fatalf("lower limit: %v", failure)
	}
	if room.MaxMembers != 2 {
		t.Fatalf("lowered maxMembers = %d", room.MaxMembers)
	}
	if !first.Online || !second.Online || len(room.Members) != 3 {
		t.Fatalf("lowering the limit removed or disconnected an existing member")
	}
	if _, _, extra, failure := rooms.requestJoinWithAuto(
		room.ID,
		room.Invite,
		collabProfile{Name: "Three", Color: "#0000ff"},
	); failure == nil || failure.Code != "room_full" || extra != nil {
		t.Fatalf("join over the lowered limit = %v", failure)
	}
}

func TestCollabResumeRechecksMemberLimit(t *testing.T) {
	rooms := NewRooms()
	room, host, failure := rooms.create(
		collabProfile{Name: "Host", Color: "#ffffff"},
		collabTestChart(),
		"",
		collabCreateOptions{AutoApproveEditor: true},
	)
	if failure != nil {
		t.Fatalf("create: %v", failure)
	}
	if _, failure := rooms.setMaxMembers(host.ID, 2); failure != nil {
		t.Fatalf("set limit: %v", failure)
	}
	_, _, first, failure := rooms.requestJoinWithAuto(
		room.ID,
		room.Invite,
		collabProfile{Name: "One", Color: "#00ff00"},
	)
	if failure != nil || first == nil {
		t.Fatalf("first join: %v", failure)
	}
	rooms.leave(first.ID)
	_, _, second, failure := rooms.requestJoinWithAuto(
		room.ID,
		room.Invite,
		collabProfile{Name: "Two", Color: "#ff0000"},
	)
	if failure != nil || second == nil {
		t.Fatalf("second join: %v", failure)
	}
	if _, _, failure := rooms.resume(room.ID, first.Token); failure == nil || failure.Code != "room_full" {
		t.Fatalf("offline resume into full room = %v", failure)
	}
	if first.Online {
		t.Fatal("rejected resume marked the member online")
	}
	if _, _, failure := rooms.resume(room.ID, second.Token); failure != nil {
		t.Fatalf("online member reconnect: %v", failure)
	}
	rooms.leave(second.ID)
	if _, member, failure := rooms.resume(room.ID, first.Token); failure != nil || member.ID != first.ID {
		t.Fatalf("resume after slot opened: %v", failure)
	}
}

func TestCollabAutoApproveCreatesEditors(t *testing.T) {
	rooms := NewRooms()
	room, _, failure := rooms.create(
		collabProfile{Name: "Host", Color: "#ffffff"},
		collabTestChart(),
		"",
		collabCreateOptions{AutoApproveEditor: true},
	)
	if failure != nil {
		t.Fatalf("create: %v", failure)
	}
	_, request, member, failure := rooms.requestJoinWithAuto(
		room.ID,
		room.Invite,
		collabProfile{Name: "Friend", Color: "#00ff00"},
	)
	if failure != nil {
		t.Fatalf("join: %v", failure)
	}
	if request != nil || member == nil || member.Role != "editor" {
		t.Fatalf("request = %+v, member = %+v", request, member)
	}
	if len(room.Pending) != 0 || room.Members[member.ID] == nil {
		t.Fatal("auto-approved member was not added directly")
	}
}

func TestCollabTransactionReplayIsDeduplicated(t *testing.T) {
	rooms, room, _ := collabSetup(t)
	editor := collabJoinEditor(t, rooms, room)
	change := []collabChange{{Op: "set", Path: "/META/name", Before: "room", After: "once"}}
	first, failure := rooms.commit(editor.ID, "same", "edit", change, "")
	if failure != nil {
		t.Fatalf("first commit: %v", failure)
	}
	second, failure := rooms.commit(editor.ID, "same", "edit", change, "")
	if failure != nil {
		t.Fatalf("replay commit: %v", failure)
	}
	if second.Revision != first.Revision || room.Revision != 1 {
		t.Fatalf("replay revision = %d, first = %d, room = %d", second.Revision, first.Revision, room.Revision)
	}
	if room.Fingerprint != collabFingerprint(room.Chart) {
		t.Fatal("fingerprint did not advance")
	}
}

func TestCollabUndoIsAuthorScopedAndSingleUse(t *testing.T) {
	rooms, room, _ := collabSetup(t)
	editor := collabJoinEditor(t, rooms, room)
	other := collabJoinEditor(t, rooms, room)
	original := []collabChange{{Op: "set", Path: "/META/name", Before: "room", After: "A"}}
	if _, failure := rooms.commit(editor.ID, "tx-a", "A", original, ""); failure != nil {
		t.Fatalf("original commit: %v", failure)
	}
	reverse := []collabChange{{Op: "set", Path: "/META/name", Before: "A", After: "room"}}
	if _, failure := rooms.commit(other.ID, "tx-other", "undo A", reverse, "tx-a"); failure == nil || failure.Code != "undo_forbidden" {
		t.Fatalf("other undo = %v", failure)
	}
	if _, failure := rooms.commit(editor.ID, "tx-undo", "undo A", reverse, "tx-a"); failure != nil {
		t.Fatalf("author undo: %v", failure)
	}
	if _, failure := rooms.commit(editor.ID, "tx-undo-again", "undo A", reverse, "tx-a"); failure == nil || failure.Code != "already_undone" {
		t.Fatalf("repeat undo = %v", failure)
	}
	if room.Chart.(map[string]any)["META"].(map[string]any)["name"] != "room" {
		t.Fatal("undo did not restore the value")
	}
}

func TestCollabStaleFieldRejectsTheWholeBatch(t *testing.T) {
	rooms, room, _ := collabSetup(t)
	editor := collabJoinEditor(t, rooms, room)
	if _, failure := rooms.commit(editor.ID, "first", "first", []collabChange{
		{Op: "set", Path: "/META/name", Before: "room", After: "one"},
	}, ""); failure != nil {
		t.Fatalf("first commit: %v", failure)
	}
	_, failure := rooms.commit(editor.ID, "stale", "stale", []collabChange{
		{Op: "set", Path: "/META/name", Before: "room", After: "two"},
		{Op: "set", Path: "/BPMList/0/bpm", Before: 120.0, After: 180.0},
	}, "")
	if failure == nil || failure.Code != "conflict" || !reflect.DeepEqual(failure.Paths, []string{"/META/name"}) {
		t.Fatalf("stale commit = %v", failure)
	}
	if room.Revision != 1 {
		t.Fatalf("revision = %d", room.Revision)
	}
}

func TestCollabRolesRemovalAndResume(t *testing.T) {
	rooms, room, _ := collabSetup(t)
	editor := collabJoinEditor(t, rooms, room)
	if _, _, failure := rooms.setRole(room.HostID, editor.ID, "viewer"); failure != nil {
		t.Fatalf("set role: %v", failure)
	}
	if editor.Role != "viewer" {
		t.Fatalf("role = %s", editor.Role)
	}
	if _, _, failure := rooms.resume(room.ID, editor.Token); failure != nil {
		t.Fatalf("resume: %v", failure)
	}
	if _, _, failure := rooms.removeMember(room.HostID, editor.ID); failure != nil {
		t.Fatalf("remove: %v", failure)
	}
	if _, _, failure := rooms.resume(room.ID, editor.Token); failure == nil || failure.Code != "bad_resume" {
		t.Fatalf("resume removed member = %v", failure)
	}
}

func TestCollabLocksAreAllOrNothingAcrossScopes(t *testing.T) {
	rooms, room, _ := collabSetup(t)
	editor := collabJoinEditor(t, rooms, room)
	other := collabJoinEditor(t, rooms, room)
	locks, failure := rooms.acquireLocks(editor.ID, []string{"line:line", "obj:note"}, 15000)
	if failure != nil || len(locks) != 2 {
		t.Fatalf("acquire = %v, %v", locks, failure)
	}
	if _, failure := rooms.acquireLocks(other.ID, []string{"obj:note"}, 15000); failure == nil || failure.Code != "locked" {
		t.Fatalf("conflicting acquire = %v", failure)
	}
	change := []collabChange{{Op: "set", Path: "/judgeLineList/$line/notes/$note/positionX", Before: 1.0, After: 9.0}}
	if _, failure := rooms.commit(other.ID, "locked-edit", "blocked", change, ""); failure == nil || failure.Code != "locked" {
		t.Fatalf("locked commit = %v", failure)
	}
	if !rooms.releaseLocks(editor.ID, []string{"line:line", "obj:note"}) {
		t.Fatal("release did not change state")
	}
	if _, failure := rooms.commit(other.ID, "unlocked-edit", "allowed", change, ""); failure != nil {
		t.Fatalf("unlocked commit: %v", failure)
	}
}

func TestCollabChartLeaseBlocksNarrowEdits(t *testing.T) {
	rooms, room, _ := collabSetup(t)
	editor := collabJoinEditor(t, rooms, room)
	other := collabJoinEditor(t, rooms, room)
	if _, failure := rooms.acquireLocks(editor.ID, []string{"chart"}, 15000); failure != nil {
		t.Fatalf("chart lock: %v", failure)
	}
	if _, failure := rooms.acquireLocks(other.ID, []string{"line:line"}, 15000); failure == nil || failure.Code != "locked" {
		t.Fatalf("narrow acquire under chart = %v", failure)
	}
	if _, failure := rooms.commit(other.ID, "chart-blocked", "blocked", []collabChange{
		{Op: "set", Path: "/META/name", Before: "room", After: "next"},
	}, ""); failure == nil || failure.Code != "locked" {
		t.Fatalf("narrow commit under chart = %v", failure)
	}
}

func TestCollabAssetsAreContentAddressedAndScoped(t *testing.T) {
	rooms, room, _ := collabSetup(t)
	editor := collabJoinEditor(t, rooms, room)
	_, viewerJoin, _ := rooms.requestJoin(room.ID, room.Invite, collabProfile{Name: "Viewer", Color: "#0000ff"})
	_, _, viewer, _ := rooms.approve(room.HostID, viewerJoin.RequestID, true, "viewer")
	bytes := []byte("\x89PNG\r\n\x1a\npayload")
	hash := sha256Hex(bytes)
	asset, failure := rooms.acceptAsset(editor.ID, "image.png", hash, int64(len(bytes)), "image/png", bytes)
	if failure != nil {
		t.Fatalf("accept asset: %v", failure)
	}
	if asset.Name != "image.png" || asset.Hash != hash {
		t.Fatalf("asset = %+v", asset)
	}
	if manifest := rooms.assetManifest(room); len(manifest) != 1 {
		t.Fatalf("manifest = %v", manifest)
	}
	if _, bytesOut, failure := rooms.assetForMember(editor.ID, hash, "image.png"); failure != nil || !reflect.DeepEqual(bytesOut, bytes) {
		t.Fatalf("read asset = %v", failure)
	}
	if _, failure := rooms.acceptAsset(viewer.ID, "other.png", hash, int64(len(bytes)), "image/png", bytes); failure == nil || failure.Code != "read_only" {
		t.Fatalf("viewer asset = %v", failure)
	}
	if _, failure := rooms.acceptAsset(editor.ID, "../escape.png", hash, int64(len(bytes)), "image/png", bytes); failure == nil || failure.Code != "invalid_name" {
		t.Fatalf("unsafe name = %v", failure)
	}
}

func TestCollabAssetReplacementIsAnEditorAction(t *testing.T) {
	rooms, room, host := collabSetup(t)
	editor := collabJoinEditor(t, rooms, room)
	original := []byte("\x89PNG\r\n\x1a\noriginal")
	originalHash := sha256Hex(original)
	if _, failure := rooms.acceptAsset(editor.ID, "cover.png", originalHash, int64(len(original)), "image/png", original); failure != nil {
		t.Fatalf("editor new asset: %v", failure)
	}
	replacement := []byte("\x89PNG\r\n\x1a\nreplacement")
	replacementHash := sha256Hex(replacement)
	if _, failure := rooms.acceptAsset(editor.ID, "cover.png", replacementHash, int64(len(replacement)), "image/png", replacement); failure != nil {
		t.Fatalf("editor replacement: %v", failure)
	}
	if room.Assets["cover.png"].Hash != replacementHash {
		t.Fatal("editor replacement did not update the manifest")
	}
	extra := []byte("\x89PNG\r\n\x1a\nextra")
	extraHash := sha256Hex(extra)
	if _, failure := rooms.acceptAsset(editor.ID, "extra.png", extraHash, int64(len(extra)), "image/png", extra); failure != nil {
		t.Fatalf("editor new name: %v", failure)
	}
	if _, failure := rooms.acceptAsset(host.ID, "cover.png", originalHash, int64(len(original)), "image/png", original); failure != nil {
		t.Fatalf("host replacement: %v", failure)
	}
	if room.Assets["cover.png"].Hash != originalHash {
		t.Fatal("host replacement did not update the manifest")
	}
}

func TestCollabRoomsAndBlobsSurviveExportAndImport(t *testing.T) {
	rooms, room, host := collabSetup(t)
	editor := collabJoinEditor(t, rooms, room)
	if _, failure := rooms.commit(editor.ID, "tx", "edit", []collabChange{
		{Op: "set", Path: "/META/name", Before: "room", After: "saved"},
	}, ""); failure != nil {
		t.Fatalf("commit: %v", failure)
	}
	bytes := []byte("\x89PNG\r\n\x1a\npersisted")
	hash := sha256Hex(bytes)
	if _, failure := rooms.acceptAsset(editor.ID, "cover.png", hash, int64(len(bytes)), "image/png", bytes); failure != nil {
		t.Fatalf("asset: %v", failure)
	}
	state := rooms.exportState()
	restored := NewRooms()
	restored.importState(state, map[string][]byte{hash: bytes})
	if restored.roomCount() != 1 {
		t.Fatalf("restored rooms = %d", restored.roomCount())
	}
	restoredRoom, restoredHost, failure := restored.resume(room.ID, host.Token)
	if failure != nil {
		t.Fatalf("resume host: %v", failure)
	}
	if restoredRoom.Revision != 1 || restoredHost.Role != "host" {
		t.Fatalf("restored room = %+v", restoredRoom)
	}
	if restoredRoom.Chart.(map[string]any)["META"].(map[string]any)["name"] != "saved" {
		t.Fatal("restored chart lost the edit")
	}
	if restoredRoom.Assets["cover.png"].Hash != hash {
		t.Fatal("restored asset missing")
	}
}

func TestCollabEncryptedRoomsKeepOpaqueLogsAndRequireLeases(t *testing.T) {
	rooms := NewRooms()
	payload := map[string]any{
		"v":    1.0,
		"alg":  "AES-GCM",
		"iv":   "0123456789abcdef",
		"data": "opaque-ciphertext",
	}
	room, host, failure := rooms.create(
		collabProfile{Name: "Host", Color: "#ffffff"},
		payload,
		"",
		collabCreateOptions{Encrypted: true},
	)
	if failure != nil {
		t.Fatalf("create encrypted: %v", failure)
	}
	if !room.Encrypted {
		t.Fatal("room is not encrypted")
	}
	_, request, _ := rooms.requestJoin(room.ID, room.Invite, collabProfile{Name: "Editor", Color: "#00ff00"})
	_, _, editor, _ := rooms.approve(room.HostID, request.RequestID, true, "editor")
	commitPayload := map[string]any{
		"v":    1.0,
		"alg":  "AES-GCM",
		"iv":   "fedcba9876543210",
		"data": "encrypted-changes",
	}
	if _, failure := rooms.commit(editor.ID, "no-lease", "edit", commitPayload, ""); failure == nil || failure.Code != "missing_lock" {
		t.Fatalf("missing lease = %v", failure)
	}
	if _, failure := rooms.acquireLocks(editor.ID, []string{"chart"}, 15000); failure != nil {
		t.Fatalf("acquire: %v", failure)
	}
	committed, failure := rooms.commit(editor.ID, "tx", "edit", commitPayload, "", []string{"chart"})
	if failure != nil {
		t.Fatalf("encrypted commit: %v", failure)
	}
	if committed.Revision != 1 || len(rooms.transactionLog(room)) != 1 {
		t.Fatalf("committed = %+v, log = %+v", committed, rooms.transactionLog(room))
	}
	state := rooms.exportState()
	if len(state.Rooms) != 1 || !state.Rooms[0].Encrypted || len(state.Rooms[0].Log) != 1 {
		t.Fatalf("exported state = %+v", state.Rooms)
	}
	restored := NewRooms()
	restored.importState(state, map[string][]byte{})
	restoredRoom, _, failure := restored.resume(room.ID, host.Token)
	if failure != nil {
		t.Fatalf("resume: %v", failure)
	}
	if len(restored.transactionLog(restoredRoom)) != 1 {
		t.Fatal("encrypted log was not restored")
	}
}

func TestCollabPresenceIsEphemeralAndMemberScoped(t *testing.T) {
	rooms, room, _ := collabSetup(t)
	editor := collabJoinEditor(t, rooms, room)
	beat := 12.5
	cursorRatio := 0.75
	updated, ok := rooms.updatePresence(editor.ID, collabPresence{
		Area:         "edit",
		LineID:       "line",
		Beat:         &beat,
		CursorRatio:  &cursorRatio,
		Timeline:     true,
		TimelineArea: "notes",
	})
	if !ok || updated.MemberID != editor.ID || updated.Beat == nil || *updated.Beat != 12.5 {
		t.Fatalf("presence = %+v, %v", updated, ok)
	}
	if presence := rooms.presence(room); len(presence) != 1 ||
		presence[0].LineID != "line" ||
		!presence[0].Timeline ||
		presence[0].TimelineArea != "notes" ||
		presence[0].CursorRatio == nil ||
		*presence[0].CursorRatio != 0.75 {
		t.Fatalf("presence list = %+v", presence)
	}
	rooms.leave(editor.ID)
	if presence := rooms.presence(room); len(presence) != 0 {
		t.Fatalf("presence after leave = %+v", presence)
	}
}

func TestCollabCustomInviteMinimumLeavesLegacyRoomsJoinable(t *testing.T) {
	rooms := NewRooms()
	if _, _, failure := rooms.create(
		collabProfile{Name: "Host", Color: "#ffffff"},
		collabTestChart(),
		"",
		collabCreateOptions{Invite: "short7"},
	); failure == nil || failure.Code != "bad_invite" {
		t.Fatalf("short invite = %v", failure)
	}
	room, _, failure := rooms.create(
		collabProfile{Name: "Host", Color: "#ffffff"},
		collabTestChart(),
		"",
		collabCreateOptions{Invite: "Secret42"},
	)
	if failure != nil {
		t.Fatalf("eight-character invite: %v", failure)
	}
	legacy := &collabRoom{
		ID:                collabRandomToken(8),
		Invite:            "old1",
		Chart:             collabClone(collabTestChart()),
		Fingerprint:       "legacy",
		MaxMembers:        collabDefaultMembers,
		CreatedAt:         1,
		Members:           make(map[string]*collabMember),
		Pending:           make(map[string]*collabPending),
		Transactions:      make(map[string]*collabCommitted),
		TransactionHashes: make(map[string]string),
		UndoLedger:        make(map[string]collabUndo),
		Assets:            make(map[string]collabAsset),
		Locks:             make(map[string]collabLock),
	}
	legacyHost := &collabMember{ID: collabUUID(), Token: collabRandomToken(24), Role: "host", Online: true}
	legacy.HostID = legacyHost.ID
	legacy.Members[legacyHost.ID] = legacyHost
	rooms.mu.Lock()
	rooms.rooms[legacy.ID] = legacy
	rooms.mu.Unlock()
	if _, request, failure := rooms.requestJoin(legacy.ID, "old1", collabProfile{Name: "Guest", Color: "#00ff00"}); failure != nil || request == nil {
		t.Fatalf("legacy short-password join = %v", failure)
	}
	if room.Invite != "Secret42" {
		t.Fatalf("invite = %q", room.Invite)
	}
}

func TestCollabRoomCreationLimits(t *testing.T) {
	rooms := NewRooms()
	for index := 0; index < collabMaxRoomsPerOwner; index++ {
		if _, _, failure := rooms.create(
			collabProfile{Name: "Host", Color: "#ffffff"},
			collabTestChart(),
			"",
			collabCreateOptions{Owner: "client:a"},
		); failure != nil {
			t.Fatalf("owner room %d: %v", index, failure)
		}
	}
	if _, _, failure := rooms.create(
		collabProfile{Name: "Host", Color: "#ffffff"},
		collabTestChart(),
		"",
		collabCreateOptions{Owner: "client:a"},
	); failure == nil || failure.Code != "owner_rooms_full" {
		t.Fatalf("owner quota = %v", failure)
	}
	for index := rooms.roomCount(); index < collabMaxRooms; index++ {
		if _, _, failure := rooms.create(
			collabProfile{Name: "Host", Color: "#ffffff"},
			collabTestChart(),
			"",
			collabCreateOptions{Owner: "client:" + collabRandomToken(4)},
		); failure != nil {
			t.Fatalf("global room %d: %v", index, failure)
		}
	}
	if _, _, failure := rooms.create(
		collabProfile{Name: "Host", Color: "#ffffff"},
		collabTestChart(),
		"",
		collabCreateOptions{Owner: "client:overflow"},
	); failure == nil || failure.Code != "rooms_full" {
		t.Fatalf("global quota = %v", failure)
	}
}

func TestCollabPlaintextLogEvictsOldestByBytes(t *testing.T) {
	rooms, room, host := collabSetup(t)
	if _, failure := rooms.commit(host.ID, "first", "first", []collabChange{
		{Op: "set", Path: "/META/name", Before: "room", After: "one"},
	}, ""); failure != nil {
		t.Fatalf("first commit: %v", failure)
	}
	room.TransactionBytes = collabMaxTxLogBytes - 10
	if _, failure := rooms.commit(host.ID, "second", "second", []collabChange{
		{Op: "set", Path: "/META/name", Before: "one", After: "two"},
	}, ""); failure != nil {
		t.Fatalf("second commit: %v", failure)
	}
	if len(room.Transactions) != 1 {
		t.Fatalf("retained transactions = %d", len(room.Transactions))
	}
	if room.TransactionBytes > collabMaxTxLogBytes {
		t.Fatalf("retained bytes = %d", room.TransactionBytes)
	}
	if _, ok := room.Transactions[collabTransactionKey(host.ID, "second")]; !ok {
		t.Fatal("newest transaction was evicted")
	}
}

func TestCollabEncryptedLogRejectsWhenBytesAreFull(t *testing.T) {
	rooms := NewRooms()
	payload := map[string]any{
		"v": 1.0, "alg": "AES-GCM", "iv": "0123456789abcdef", "data": "initial",
	}
	room, host, failure := rooms.create(
		collabProfile{Name: "Host", Color: "#ffffff"},
		payload,
		"",
		collabCreateOptions{Encrypted: true},
	)
	if failure != nil {
		t.Fatalf("create: %v", failure)
	}
	if _, failure := rooms.acquireLocks(host.ID, []string{"chart"}, 15000); failure != nil {
		t.Fatalf("lock: %v", failure)
	}
	room.TransactionBytes = collabMaxEncryptedLogBytes - 10
	change := map[string]any{
		"v": 1.0, "alg": "AES-GCM", "iv": "fedcba9876543210", "data": "next",
	}
	if _, failure := rooms.commit(host.ID, "tx", "edit", change, "", []string{"chart"}); failure == nil || failure.Code != "log_full" {
		t.Fatalf("full encrypted log = %v", failure)
	}
	if room.Revision != 0 || len(room.Transactions) != 0 {
		t.Fatalf("rejected commit changed the room: revision %d, log %d", room.Revision, len(room.Transactions))
	}
}

func TestCollabOversizedTransactionIsRejectedByBytes(t *testing.T) {
	rooms, room, host := collabSetup(t)
	oversized := strings.Repeat("x", collabMaxTxLogBytes+1)
	_, failure := rooms.commit(host.ID, "oversized", "oversized", []collabChange{
		{Op: "set", Path: "/META/name", Before: "room", After: oversized},
	}, "")
	if failure == nil || failure.Code != "log_full" {
		t.Fatalf("oversized transaction = %v", failure)
	}
	if room.Revision != 0 || len(room.Transactions) != 0 || room.TransactionBytes != 0 {
		t.Fatalf(
			"rejected transaction changed the room: revision %d, log %d, bytes %d",
			room.Revision,
			len(room.Transactions),
			room.TransactionBytes,
		)
	}
}

func TestCollabTransactionDedupBindsActorAndContent(t *testing.T) {
	rooms, room, _ := collabSetup(t)
	editor := collabJoinEditor(t, rooms, room)
	other := collabJoinEditor(t, rooms, room)
	firstChange := []collabChange{{Op: "set", Path: "/META/name", Before: "room", After: "once"}}
	first, failure := rooms.commit(editor.ID, "same", "edit", firstChange, "")
	if failure != nil {
		t.Fatalf("first commit: %v", failure)
	}
	replay, failure := rooms.commit(editor.ID, "same", "edit", firstChange, "")
	if failure != nil {
		t.Fatalf("replay: %v", failure)
	}
	if !replay.Replay || replay.Revision != first.Revision || room.Revision != 1 {
		t.Fatalf("replay = %+v, room revision = %d", replay, room.Revision)
	}
	if _, failure := rooms.commit(editor.ID, "same", "edit", []collabChange{
		{Op: "set", Path: "/META/name", Before: "room", After: "other"},
	}, ""); failure == nil || failure.Code != "transaction_reused" {
		t.Fatalf("reused id = %v", failure)
	}
	secondChange := []collabChange{{Op: "set", Path: "/META/name", Before: "once", After: "twice"}}
	otherCommit, failure := rooms.commit(other.ID, "same", "edit", secondChange, "")
	if failure != nil {
		t.Fatalf("other actor commit: %v", failure)
	}
	if otherCommit.Replay || otherCommit.Revision != 2 {
		t.Fatalf("other actor commit = %+v", otherCommit)
	}
}

func TestCollabHostClosesRoom(t *testing.T) {
	rooms, room, host := collabSetup(t)
	editor := collabJoinEditor(t, rooms, room)
	if _, _, failure := rooms.closeRoom(editor.ID); failure == nil || failure.Code != "forbidden" {
		t.Fatalf("editor close = %v", failure)
	}
	_, memberIDs, failure := rooms.closeRoom(host.ID)
	if failure != nil {
		t.Fatalf("host close: %v", failure)
	}
	if len(memberIDs) != 2 || rooms.roomCount() != 0 {
		t.Fatalf("members = %v, rooms = %d", memberIDs, rooms.roomCount())
	}
	if _, _, failure := rooms.resume(room.ID, host.Token); failure == nil || failure.Code != "no_room" {
		t.Fatalf("resume closed room = %v", failure)
	}
}
