// Authoritative collaboration room state for the embedded Go service. This is
// the desktop counterpart of src/core/collaboration/room.ts: it orders
// transactions, enforces roles and leases, and owns accepted chart revisions.

package collab

import (
	"crypto/rand"
	"encoding/json"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode/utf8"
)

// Room limits, lease timing, and asset quotas.
const (
	collabTokenAlphabet  = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
	collabMaxMembers     = 32
	collabDefaultMembers = 4
	// Room creation is bounded globally and per creator address so an
	// unauthenticated caller cannot retain unlimited charts and logs.
	collabMaxRooms         = 32
	collabMaxRoomsPerOwner = 4
	// Plaintext logs keep the newest entries within both bounds. Encrypted logs
	// cannot drop old entries because clients replay the log from the initial
	// envelope, so they reject commits at the same bounds.
	collabMaxTxLog             = 5000
	collabMaxEncryptedLog      = 5000
	collabMaxTxLogBytes        = 8 << 20
	collabMaxEncryptedLogBytes = 8 << 20
	collabLockTTL              = 15_000
	collabLockMinTTL           = 1_000
	collabLockMaxTTL           = 60_000
	collabMaxAssetBytes        = 256 << 20
	collabMaxRoomAssets        = 512
	collabMaxAssetTotal        = int64(2) << 30
)

// collabNormalizeMaxMembers accepts only an integer in the supported range.
// Legacy zero, out-of-range, and otherwise unusable persisted values fall back
// to the default so both room implementations restore the same limit.
func collabNormalizeMaxMembers(value int) int {
	if value < 2 || value > collabMaxMembers {
		return collabDefaultMembers
	}
	return value
}

// collabProfile is the display identity a member chooses.
type collabProfile struct {
	Name  string `json:"name"`
	Color string `json:"color"`
}

// collabMember is the server-side record of one room participant.
type collabMember struct {
	ID       string          `json:"id"`
	Token    string          `json:"token,omitempty"`
	Profile  collabProfile   `json:"profile"`
	Role     string          `json:"role"`
	Online   bool            `json:"online"`
	Presence *collabPresence `json:"presence,omitempty"`
}

// collabMemberWire is the member view broadcast to other clients; it omits the
// resume token.
type collabMemberWire struct {
	ID      string        `json:"id"`
	Profile collabProfile `json:"profile"`
	Role    string        `json:"role"`
	Online  bool          `json:"online"`
}

// collabPresence is a member's cursor and viewport state.
type collabPresence struct {
	MemberID     string   `json:"memberId"`
	Area         string   `json:"area"`
	Section      string   `json:"section,omitempty"`
	LineID       string   `json:"lineId,omitempty"`
	Beat         *float64 `json:"beat,omitempty"`
	PositionX    *float64 `json:"positionX,omitempty"`
	CursorRatio  *float64 `json:"cursorRatio,omitempty"`
	Timeline     bool     `json:"timeline"`
	TimelineArea string   `json:"timelineArea,omitempty"`
	Playhead     *float64 `json:"playheadBeat,omitempty"`
	UpdatedAt    int64    `json:"updatedAt"`
}

// collabAsset is one accepted room asset.
type collabAsset struct {
	Name          string `json:"name"`
	Hash          string `json:"hash"`
	Size          int64  `json:"size"`
	Mime          string `json:"mime"`
	PlaintextHash string `json:"plaintextHash,omitempty"`
}

// collabLock is a cooperative edit lease on one scope.
type collabLock struct {
	ID        string `json:"id"`
	OwnerID   string `json:"ownerId"`
	Scope     string `json:"scope"`
	ExpiresAt int64  `json:"expiresAt"`
}

// collabPending is a join request waiting for host approval.
type collabPending struct {
	RequestID string        `json:"requestId"`
	Profile   collabProfile `json:"profile"`
}

// collabUndo records which member committed a transaction and what it undoes.
type collabUndo struct {
	ActorID       string
	TransactionID string
	UndoOf        string
}

// collabCommitted is one accepted transaction and its resulting revision.
type collabCommitted struct {
	Revision      int    `json:"revision"`
	TransactionID string `json:"transactionId"`
	ActorID       string `json:"actorId"`
	Label         string `json:"label"`
	// Plaintext rooms store []collabChange; encrypted rooms store one opaque
	// AES-GCM envelope and never inspect it.
	Changes     any    `json:"changes"`
	UndoOf      string `json:"undoOf,omitempty"`
	Fingerprint string `json:"fingerprint"`
	// Replay marks a deduplicated retry. It is never persisted or broadcast to
	// other members.
	Replay bool `json:"-"`
}

// collabCreateOptions are the optional room settings for a create message.
type collabCreateOptions struct {
	Encrypted         bool
	AutoApproveEditor bool
	// Invite is the user-visible room password. Empty means generate one.
	Invite string
	// Owner is the rate-limit identity of the creating connection.
	Owner string
	// AppVersion is product metadata used for compatibility warnings.
	AppVersion string
}

// collabMinInviteLength is the shortest custom room password. Generated
// passwords remain longer than this. Rooms persisted with a shorter password
// and invitation links that carry one remain joinable because the rule only
// applies when a room is created.
const collabMinInviteLength = 8

// collabRoomInvite validates a custom password or generates the default code.
func collabRoomInvite(value string) (string, *collabError) {
	invite := strings.TrimSpace(value)
	if invite == "" {
		return collabRandomToken(10), nil
	}
	length := len([]rune(invite))
	if length < collabMinInviteLength || length > 64 {
		return "", collabFailure("bad_invite", "Room password must be 8 to 64 characters")
	}
	return invite, nil
}

// collabClosedRoom is one evicted owned room plus its member ids.
type collabClosedRoom struct {
	room      *collabRoom
	memberIDs []string
}

// collabRoom is the authoritative state of one collaboration session.
type collabRoom struct {
	ID                string
	Invite            string
	HostID            string
	Owner             string
	Chart             any
	Fingerprint       string
	AppVersion        string
	Revision          int
	Encrypted         bool
	AutoApproveEditor bool
	MaxMembers        int
	CreatedAt         int64
	Members           map[string]*collabMember
	Pending           map[string]*collabPending
	Transactions      map[string]*collabCommitted
	TransactionOrder  []string
	TransactionHashes map[string]string
	TransactionBytes  int64
	UndoLedger        map[string]collabUndo
	UndoOrder         []string
	Assets            map[string]collabAsset
	Locks             map[string]collabLock
}

// collabError is a room rejection with a stable code and optional conflict
// paths.
type collabError struct {
	Code    string
	Message string
	Paths   []string
}

// Error returns the human-readable rejection message.
func (e *collabError) Error() string { return e.Message }

// collabFailure builds a rejection without conflict paths.
func collabFailure(code, message string) *collabError {
	return &collabError{Code: code, Message: message}
}

// collabVersionFailure rejects a join or resume when the room and client
// product versions differ. A room has no cross-version contract: both copies
// must run the same build version.
func collabVersionFailure(room *collabRoom, clientVersion string) *collabError {
	expected := strings.TrimSpace(room.AppVersion)
	actual := strings.TrimSpace(clientVersion)
	if expected == actual {
		return nil
	}
	label := func(value string) string {
		if value == "" {
			return "unknown"
		}
		return value
	}
	code := "version_mismatch_unknown"
	message := fmt.Sprintf(
		"This room uses RPE Redux %s; this client is %s. Both copies must use the same version.",
		label(expected),
		label(actual),
	)
	switch collabCompareVersions(expected, actual) {
	case -1:
		code = "version_mismatch_client_newer"
		message = fmt.Sprintf(
			"This room uses RPE Redux %s, but this client is newer (%s). Ask the host to update RPE Redux, or use the host's version to join.",
			label(expected),
			label(actual),
		)
	case 1:
		code = "version_mismatch_client_older"
		message = fmt.Sprintf(
			"This room uses RPE Redux %s, but this client is older (%s). Update RPE Redux to join.",
			label(expected),
			label(actual),
		)
	}
	return collabFailure(code, message)
}

// collabCompareVersions compares dotted numeric versions. A non-numeric or
// empty value compares as equal so it keeps the generic exact-version rejection.
func collabCompareVersions(left, right string) int {
	parse := func(value string) ([]int, bool) {
		numeric := strings.TrimSpace(value)
		if len(numeric) > 0 && (numeric[0] == 'v' || numeric[0] == 'V') {
			numeric = numeric[1:]
		}
		if at := strings.IndexAny(numeric, "-+"); at >= 0 {
			numeric = numeric[:at]
		}
		if numeric == "" {
			return nil, false
		}
		fields := strings.Split(numeric, ".")
		parts := make([]int, 0, len(fields))
		for _, field := range fields {
			part, err := strconv.Atoi(field)
			if err != nil {
				return nil, false
			}
			parts = append(parts, part)
		}
		return parts, true
	}
	leftParts, leftOK := parse(left)
	rightParts, rightOK := parse(right)
	if !leftOK || !rightOK {
		return 0
	}
	length := len(leftParts)
	if len(rightParts) > length {
		length = len(rightParts)
	}
	for index := 0; index < length; index++ {
		a, b := 0, 0
		if index < len(leftParts) {
			a = leftParts[index]
		}
		if index < len(rightParts) {
			b = rightParts[index]
		}
		if a < b {
			return -1
		}
		if a > b {
			return 1
		}
	}
	return 0
}

// Rooms owns every room and the shared asset blobs.
type Rooms struct {
	mu    sync.Mutex
	rooms map[string]*collabRoom
	blobs map[string][]byte
}

// NewRooms returns an empty room registry.
func NewRooms() *Rooms {
	return &Rooms{
		rooms: make(map[string]*collabRoom),
		blobs: make(map[string][]byte),
	}
}

// collabRandomToken returns a random code drawn from the unambiguous alphabet.
func collabRandomToken(size int) string {
	bytes := make([]byte, size)
	if _, err := rand.Read(bytes); err != nil {
		panic(err)
	}
	var builder strings.Builder
	for _, value := range bytes {
		builder.WriteByte(collabTokenAlphabet[int(value)%len(collabTokenAlphabet)])
	}
	return builder.String()
}

// collabUUID returns a random UUID v4 string.
func collabUUID() string {
	bytes := make([]byte, 16)
	if _, err := rand.Read(bytes); err != nil {
		panic(err)
	}
	bytes[6] = (bytes[6] & 0x0f) | 0x40
	bytes[8] = (bytes[8] & 0x3f) | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", bytes[0:4], bytes[4:6], bytes[6:8], bytes[8:10], bytes[10:16])
}

// collabCleanProfile trims the display name, clamps its length, and defaults an
// invalid color.
func collabCleanProfile(profile collabProfile) collabProfile {
	name := strings.TrimSpace(profile.Name)
	if utf8.RuneCountInString(name) > 40 {
		name = string([]rune(name)[:40])
	}
	if name == "" {
		name = "Member"
	}
	color := strings.ToLower(profile.Color)
	if !collabColorPattern.MatchString(color) {
		color = "#77b7ff"
	}
	return collabProfile{Name: name, Color: color}
}

// collabOnlineMembers counts the members currently holding an online slot.
func collabOnlineMembers(room *collabRoom) int {
	online := 0
	for _, member := range room.Members {
		if member.Online {
			online++
		}
	}
	return online
}

// collabTransactionKey binds a client transaction id to the actor that chose it,
// so one member cannot replay another member's id or receive their result.
func collabTransactionKey(actorID, transactionID string) string {
	return actorID + "\x00" + transactionID
}

// collabTransactionHash is the content digest used to distinguish an exact
// retry from a reused transaction id. The payload is normalized through JSON so
// a live struct and a restored decoded record hash identically.
func collabTransactionHash(payload any, undoOf string) string {
	encoded, err := json.Marshal(payload)
	if err == nil {
		var decoded any
		if json.Unmarshal(encoded, &decoded) == nil {
			payload = decoded
		}
	}
	return collabFingerprint(map[string]any{"changes": payload, "undoOf": undoOf})
}

// collabRoomQuotaLocked reports whether another room may be created by owner;
// the caller holds r.mu.
func (r *Rooms) collabRoomQuotaLocked(owner string) *collabError {
	if len(r.rooms) >= collabMaxRooms {
		return collabFailure("rooms_full", "The server has reached its room limit; close a room and retry")
	}
	if owner == "" {
		return nil
	}
	owned := 0
	for _, room := range r.rooms {
		if room.Owner == owner {
			owned++
		}
	}
	if owned >= collabMaxRoomsPerOwner {
		return collabFailure("owner_rooms_full", "This client has reached its room limit; close a room and retry")
	}
	return nil
}

// collabIsChartLike reports whether value has the chart envelope the room
// accepts. Note and event collections are optional in the document model, so a
// line that omits its empty collections is still a valid room chart.
func collabIsChartLike(value any) bool {
	record, ok := collabIsRecord(value)
	if !ok {
		return false
	}
	if _, ok := collabIsRecord(record["META"]); !ok {
		return false
	}
	if _, ok := record["BPMList"].([]any); !ok {
		return false
	}
	linesValue, present := record["judgeLineList"]
	if !present || linesValue == nil {
		return true
	}
	lines, ok := linesValue.([]any)
	if !ok {
		return false
	}
	for _, item := range lines {
		line, ok := collabIsRecord(item)
		if !ok {
			return false
		}
		for _, field := range []string{"notes", "eventLayers"} {
			value, present := line[field]
			if !present || value == nil {
				continue
			}
			if _, ok := value.([]any); !ok {
				return false
			}
		}
	}
	return true
}

// create registers a room with the caller as host. Chart is either a validated
// chart object or an encrypted envelope.
func (r *Rooms) create(profile collabProfile, chart any, fingerprint string, options ...collabCreateOptions) (*collabRoom, *collabMember, *collabError) {
	opts := collabCreateOptions{}
	if len(options) > 0 {
		opts = options[0]
	}
	r.mu.Lock()
	quotaFailure := r.collabRoomQuotaLocked(opts.Owner)
	r.mu.Unlock()
	if quotaFailure != nil {
		return nil, nil, quotaFailure
	}
	isEncrypted := opts.Encrypted
	if isEncrypted {
		if !collabIsEncryptedPayload(chart) {
			return nil, nil, collabFailure("invalid_encrypted_chart", "The encrypted chart envelope is invalid")
		}
	} else if !collabIsChartLike(chart) {
		return nil, nil, collabFailure("invalid_chart", "The room chart is not a valid chart")
	}
	invite, inviteFailure := collabRoomInvite(opts.Invite)
	if inviteFailure != nil {
		return nil, nil, inviteFailure
	}
	now := time.Now().UnixMilli()
	room := &collabRoom{
		ID:                collabRandomToken(8),
		Invite:            invite,
		Owner:             opts.Owner,
		Chart:             collabClone(chart),
		Fingerprint:       fingerprint,
		AppVersion:        strings.TrimSpace(opts.AppVersion),
		Encrypted:         isEncrypted,
		AutoApproveEditor: opts.AutoApproveEditor,
		MaxMembers:        collabDefaultMembers,
		CreatedAt:         now,
		Members:           make(map[string]*collabMember),
		Pending:           make(map[string]*collabPending),
		Transactions:      make(map[string]*collabCommitted),
		TransactionHashes: make(map[string]string),
		UndoLedger:        make(map[string]collabUndo),
		Assets:            make(map[string]collabAsset),
		Locks:             make(map[string]collabLock),
	}
	if room.Fingerprint == "" {
		room.Fingerprint = collabFingerprint(room.Chart)
	}
	host := &collabMember{
		ID:      collabUUID(),
		Token:   collabRandomToken(24),
		Profile: collabCleanProfile(profile),
		Role:    "host",
		Online:  true,
	}
	room.HostID = host.ID
	room.Members[host.ID] = host
	r.mu.Lock()
	defer r.mu.Unlock()
	if failure := r.collabRoomQuotaLocked(room.Owner); failure != nil {
		return nil, nil, failure
	}
	r.rooms[room.ID] = room
	return room, host, nil
}

// requestJoin returns the room and pending request, discarding the direct-member
// result used by the auto-approve path.
func (r *Rooms) requestJoin(roomID, invite string, profile collabProfile, appVersion ...string) (*collabRoom, *collabPending, *collabError) {
	room, request, _, failure := r.requestJoinWithAuto(roomID, invite, profile, appVersion...)
	return room, request, failure
}

// inspectRoom authenticates an invitation without creating a member or a
// pending join request. It is used by the welcome-page deep-link preview.
func (r *Rooms) inspectRoom(roomID, invite, appVersion string) (*collabRoom, *collabError) {
	r.mu.Lock()
	defer r.mu.Unlock()
	code := strings.ToUpper(strings.TrimSpace(roomID))
	var room *collabRoom
	if code != "" {
		room = r.rooms[code]
	} else {
		for _, candidate := range r.rooms {
			if candidate.Invite == strings.TrimSpace(invite) &&
				(room == nil || candidate.CreatedAt > room.CreatedAt) {
				room = candidate
			}
		}
	}
	if room == nil {
		return nil, collabFailure("no_room", "Room not found")
	}
	if room.Invite != strings.TrimSpace(invite) {
		return nil, collabFailure("bad_invite", "Room password is incorrect")
	}
	if failure := collabVersionFailure(room, appVersion); failure != nil {
		return nil, failure
	}
	return room, nil
}

// requestJoinWithAuto creates an editor directly when the room opted out of
// host approval; otherwise it returns a pending request for the host.
func (r *Rooms) requestJoinWithAuto(roomID, invite string, profile collabProfile, appVersion ...string) (*collabRoom, *collabPending, *collabMember, *collabError) {
	clientVersion := ""
	if len(appVersion) > 0 {
		clientVersion = appVersion[0]
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	code := strings.ToUpper(strings.TrimSpace(roomID))
	var room *collabRoom
	if code == "" {
		// The endpoint identifies the room. Without a code, the password picks
		// the newest matching room; fall back to the newest room so a wrong
		// password reports the password error rather than a missing room.
		var newest *collabRoom
		for _, candidate := range r.rooms {
			if newest == nil || candidate.CreatedAt > newest.CreatedAt {
				newest = candidate
			}
			if candidate.Invite == strings.TrimSpace(invite) &&
				(room == nil || candidate.CreatedAt > room.CreatedAt) {
				room = candidate
			}
		}
		if room == nil {
			room = newest
		}
	} else {
		room = r.rooms[code]
	}
	if room == nil {
		return nil, nil, nil, collabFailure("no_room", "Room not found")
	}
	if room.Invite != strings.TrimSpace(invite) {
		return nil, nil, nil, collabFailure("bad_invite", "Room password is incorrect")
	}
	if failure := collabVersionFailure(room, clientVersion); failure != nil {
		return nil, nil, nil, failure
	}
	if collabOnlineMembers(room) >= room.MaxMembers {
		return nil, nil, nil, collabFailure("room_full", "Room is full")
	}
	clean := collabCleanProfile(profile)
	if room.AutoApproveEditor {
		member := &collabMember{
			ID:      collabUUID(),
			Token:   collabRandomToken(24),
			Profile: clean,
			Role:    "editor",
			Online:  true,
		}
		room.Members[member.ID] = member
		return room, nil, member, nil
	}
	request := &collabPending{RequestID: collabUUID(), Profile: clean}
	room.Pending[request.RequestID] = request
	return room, request, nil, nil
}

// setMaxMembers changes the member cap; only the host may call it.
func (r *Rooms) setMaxMembers(actorID string, value int) (*collabRoom, *collabError) {
	if value < 2 || value > collabMaxMembers {
		return nil, collabFailure("bad_max_members", "Maximum members must be between 2 and 32")
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	room := r.roomForMemberLocked(actorID)
	if room == nil {
		return nil, collabFailure("no_room", "Not in a room")
	}
	actor := room.Members[actorID]
	if actor == nil || actor.Role != "host" {
		return nil, collabFailure("forbidden", "Only the host can change the limit")
	}
	// Existing members keep their place when the host lowers the cap. Later
	// joins and resumes are refused by the capacity checks, so the room never
	// removes or disconnects anyone as a side effect of a limit change.
	room.MaxMembers = value
	return room, nil
}

// setPassword replaces the room password; only the host may rotate it.
func (r *Rooms) setPassword(actorID, value string) (*collabRoom, *collabError) {
	invite, failure := collabRoomInvite(value)
	if failure != nil {
		return nil, failure
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	room := r.roomForMemberLocked(actorID)
	if room == nil {
		return nil, collabFailure("no_room", "Not in a room")
	}
	actor := room.Members[actorID]
	if actor == nil || actor.Role != "host" {
		return nil, collabFailure("forbidden", "Only the host can change the room password")
	}
	room.Invite = invite
	return room, nil
}

// approve resolves a join request; on allow it creates an editor or viewer.
func (r *Rooms) approve(actorID, requestID string, allow bool, role string) (*collabRoom, *collabPending, *collabMember, *collabError) {
	r.mu.Lock()
	defer r.mu.Unlock()
	room := r.roomForMemberLocked(actorID)
	if room == nil {
		return nil, nil, nil, collabFailure("no_room", "Not in a room")
	}
	actor := room.Members[actorID]
	if actor == nil || actor.Role != "host" {
		return nil, nil, nil, collabFailure("forbidden", "Only the host can approve members")
	}
	request := room.Pending[requestID]
	if request == nil {
		return nil, nil, nil, collabFailure("no_request", "Join request expired")
	}
	if !allow {
		delete(room.Pending, requestID)
		return room, request, nil, nil
	}
	// A pending request may outlive a host limit change or wait while the room
	// fills with other approvals. Recheck capacity before consuming it so the
	// host can retry after a slot opens.
	if collabOnlineMembers(room) >= room.MaxMembers {
		return nil, nil, nil, collabFailure("room_full", "Room is full")
	}
	delete(room.Pending, requestID)
	memberRole := "editor"
	if role == "viewer" {
		memberRole = "viewer"
	}
	member := &collabMember{
		ID:      collabUUID(),
		Token:   collabRandomToken(24),
		Profile: request.Profile,
		Role:    memberRole,
		Online:  true,
	}
	room.Members[member.ID] = member
	return room, request, member, nil
}

// resume reconnects a member by its resume token and marks it online.
func (r *Rooms) resume(roomID, token string, appVersion ...string) (*collabRoom, *collabMember, *collabError) {
	clientVersion := ""
	if len(appVersion) > 0 {
		clientVersion = appVersion[0]
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	room := r.rooms[strings.ToUpper(strings.TrimSpace(roomID))]
	if room == nil {
		return nil, nil, collabFailure("no_room", "Room not found")
	}
	for _, member := range room.Members {
		if member.Token == token {
			if failure := collabVersionFailure(room, clientVersion); failure != nil {
				return nil, nil, failure
			}
			// A reconnect must not add an online member beyond the cap. A member
			// whose previous socket is still marked online keeps its existing
			// slot; an offline member needs a free one.
			if !member.Online && collabOnlineMembers(room) >= room.MaxMembers {
				return nil, nil, collabFailure("room_full", "Room is full")
			}
			member.Online = true
			return room, member, nil
		}
	}
	return nil, nil, collabFailure("bad_resume", "Room session expired")
}

// setRole changes a non-host member's role and drops its locks when it becomes
// a viewer.
func (r *Rooms) setRole(actorID, memberID, role string) (*collabRoom, *collabMember, *collabError) {
	r.mu.Lock()
	defer r.mu.Unlock()
	room := r.roomForMemberLocked(actorID)
	if room == nil {
		return nil, nil, collabFailure("no_room", "Not in a room")
	}
	if actor := room.Members[actorID]; actor == nil || actor.Role != "host" {
		return nil, nil, collabFailure("forbidden", "Only the host can change roles")
	}
	member := room.Members[memberID]
	if member == nil || member.Role == "host" {
		return nil, nil, collabFailure("no_member", "Member cannot be changed")
	}
	if role == "viewer" {
		member.Role = "viewer"
		for id, lock := range room.Locks {
			if lock.OwnerID == memberID {
				delete(room.Locks, id)
			}
		}
	} else {
		member.Role = "editor"
	}
	return room, member, nil
}

// removeMember removes a non-host member, its locks, and its pending request.
func (r *Rooms) removeMember(actorID, memberID string) (*collabRoom, *collabMember, *collabError) {
	r.mu.Lock()
	defer r.mu.Unlock()
	room := r.roomForMemberLocked(actorID)
	if room == nil {
		return nil, nil, collabFailure("no_room", "Not in a room")
	}
	if actor := room.Members[actorID]; actor == nil || actor.Role != "host" {
		return nil, nil, collabFailure("forbidden", "Only the host can remove members")
	}
	member := room.Members[memberID]
	if member == nil || member.Role == "host" {
		return nil, nil, collabFailure("no_member", "Member cannot be removed")
	}
	member.Online = false
	delete(room.Members, memberID)
	for id, lock := range room.Locks {
		if lock.OwnerID == memberID {
			delete(room.Locks, id)
		}
	}
	for requestID, request := range room.Pending {
		if request.Profile.Name == member.Profile.Name {
			delete(room.Pending, requestID)
		}
	}
	return room, member, nil
}

// leave marks a member offline and releases its locks, keeping its record for a
// later resume.
func (r *Rooms) leave(memberID string) *collabRoom {
	r.mu.Lock()
	defer r.mu.Unlock()
	room := r.roomForMemberLocked(memberID)
	if room == nil {
		return nil
	}
	if member := room.Members[memberID]; member != nil {
		member.Online = false
		member.Presence = nil
	}
	for id, lock := range room.Locks {
		if lock.OwnerID == memberID {
			delete(room.Locks, id)
		}
	}
	return room
}

// closeOwnedRooms deletes every room owned by one client and reports the rooms
// and members that must be notified. A host starting a new room replaces the
// persisted rooms left by earlier sessions instead of accumulating them.
func (r *Rooms) closeOwnedRooms(owner string) []collabClosedRoom {
	r.mu.Lock()
	defer r.mu.Unlock()
	if owner == "" {
		return nil
	}
	var closed []collabClosedRoom
	for id, room := range r.rooms {
		if room.Owner != owner {
			continue
		}
		memberIDs := make([]string, 0, len(room.Members))
		for memberID := range room.Members {
			memberIDs = append(memberIDs, memberID)
		}
		delete(r.rooms, id)
		closed = append(closed, collabClosedRoom{room: room, memberIDs: memberIDs})
	}
	return closed
}

// closeRoom deletes a room after a host request and reports the members that
// should be notified. The caller owns persistence scheduling and socket
// shutdown.
func (r *Rooms) closeRoom(actorID string) (*collabRoom, []string, *collabError) {
	r.mu.Lock()
	defer r.mu.Unlock()
	room := r.roomForMemberLocked(actorID)
	if room == nil {
		return nil, nil, collabFailure("no_room", "Not in a room")
	}
	actor := room.Members[actorID]
	if actor == nil || actor.Role != "host" {
		return nil, nil, collabFailure("forbidden", "Only the host can close the room")
	}
	memberIDs := make([]string, 0, len(room.Members))
	for id := range room.Members {
		memberIDs = append(memberIDs, id)
	}
	delete(r.rooms, room.ID)
	return room, memberIDs, nil
}

// disconnect treats a lost socket as leaving the room.
func (r *Rooms) disconnect(memberID string) *collabRoom {
	return r.leave(memberID)
}

// updatePresence stores a member's presence and stamps it with the server time.
func (r *Rooms) updatePresence(memberID string, presence collabPresence) (collabPresence, bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	room := r.roomForMemberLocked(memberID)
	if room == nil {
		return collabPresence{}, false
	}
	member := room.Members[memberID]
	if member == nil {
		return collabPresence{}, false
	}
	presence.MemberID = memberID
	presence.UpdatedAt = time.Now().UnixMilli()
	member.Presence = &presence
	return presence, true
}

// commit orders one transaction. Plaintext batches are applied to the chart;
// encrypted rooms only validate the envelope and leases.
func (r *Rooms) commit(
	actorID, transactionID, label string,
	payload any,
	undoOf string,
	lockIDs ...[]string,
) (*collabCommitted, *collabError) {
	r.mu.Lock()
	defer r.mu.Unlock()
	room := r.roomForMemberLocked(actorID)
	if room == nil {
		return nil, collabFailure("no_room", "Not in a room")
	}
	actor := room.Members[actorID]
	if actor == nil {
		return nil, collabFailure("no_member", "Member is no longer in the room")
	}
	if actor.Role == "viewer" {
		return nil, collabFailure("read_only", "This member has read-only access")
	}
	var changes []collabChange
	if room.Encrypted {
		if !collabIsEncryptedPayload(payload) {
			return nil, collabFailure("invalid_change", "Encrypted change envelope is invalid")
		}
	} else {
		parsed, ok := payload.([]collabChange)
		if !ok || len(parsed) == 0 {
			return nil, collabFailure("invalid_change", "Transaction has no changes")
		}
		changes = parsed
	}
	contentHash := collabTransactionHash(payload, undoOf)
	transactionKey := collabTransactionKey(actorID, transactionID)
	if previous := room.Transactions[transactionKey]; previous != nil {
		if room.TransactionHashes[transactionKey] != contentHash {
			return nil, collabFailure("transaction_reused", "That transaction id was already used with different content")
		}
		copy := *previous
		copy.Replay = true
		return &copy, nil
	}
	entryBytes := int64(len(collabCanonical(payload)))
	if entryBytes > collabMaxTxLogBytes {
		return nil, collabFailure("log_full", "That transaction is larger than the room log limit")
	}
	if room.Encrypted && (len(room.Transactions) >= collabMaxEncryptedLog ||
		room.TransactionBytes+entryBytes > collabMaxEncryptedLogBytes) {
		return nil, collabFailure("log_full", "The encrypted room log is full; create a new room to continue")
	}
	if room.Encrypted {
		locks := []string{}
		if len(lockIDs) > 0 {
			locks = lockIDs[0]
		}
		if failure := r.checkEncryptedLocksLocked(room, actorID, locks); failure != nil {
			return nil, failure
		}
	} else {
		if failure := r.checkLocksLocked(room, actorID, changes); failure != nil {
			return nil, failure
		}
	}
	if undoOf != "" {
		original, ok := room.UndoLedger[collabTransactionKey(actorID, undoOf)]
		if !ok {
			// A foreign member's transaction is still reported as forbidden
			// rather than missing, without revealing anything beyond its id.
			for _, entry := range room.UndoLedger {
				if entry.TransactionID == undoOf {
					original = entry
					ok = true
					break
				}
			}
		}
		if !ok {
			return nil, collabFailure("unknown_transaction", "The transaction being undone is no longer available")
		}
		if original.ActorID != actorID {
			return nil, collabFailure("undo_forbidden", "Only the author of a transaction can undo it")
		}
		for _, entry := range room.UndoLedger {
			if entry.ActorID == actorID && entry.UndoOf == undoOf {
				return nil, collabFailure("already_undone", "That transaction was already compensated")
			}
		}
	}
	if room.Encrypted {
		room.Revision++
		room.Fingerprint = collabFingerprint(map[string]any{"chart": room.Chart, "revision": room.Revision})
	} else {
		applied, conflicts := collabApplyChanges(room.Chart, changes)
		if len(conflicts) > 0 {
			failure := collabFailure("conflict", "Conflicting paths: "+strings.Join(conflicts, ", "))
			failure.Paths = conflicts
			return nil, failure
		}
		if !collabIsChartLike(applied) {
			return nil, collabFailure("invalid_chart", "Transaction produced an invalid chart")
		}
		room.Chart = applied
		room.Revision++
		room.Fingerprint = collabFingerprint(room.Chart)
	}
	committed := &collabCommitted{
		Revision:      room.Revision,
		TransactionID: transactionID,
		ActorID:       actorID,
		Label:         label,
		Changes:       payload,
		UndoOf:        undoOf,
		Fingerprint:   room.Fingerprint,
	}
	room.Transactions[transactionKey] = committed
	room.TransactionHashes[transactionKey] = contentHash
	room.TransactionOrder = append(room.TransactionOrder, transactionKey)
	room.TransactionBytes += entryBytes
	room.UndoLedger[transactionKey] = collabUndo{
		ActorID:       actorID,
		TransactionID: transactionID,
		UndoOf:        undoOf,
	}
	room.UndoOrder = append(room.UndoOrder, transactionKey)
	if !room.Encrypted {
		for len(room.TransactionOrder) > 1 &&
			(len(room.TransactionOrder) > collabMaxTxLog || room.TransactionBytes > collabMaxTxLogBytes) {
			r.evictOldestTransactionLocked(room)
		}
	}
	copy := *committed
	return &copy, nil
}

// evictOldestTransactionLocked drops the oldest retained transaction and its
// undo entry; the caller holds r.mu.
func (r *Rooms) evictOldestTransactionLocked(room *collabRoom) {
	if len(room.TransactionOrder) == 0 {
		return
	}
	oldest := room.TransactionOrder[0]
	room.TransactionOrder = room.TransactionOrder[1:]
	if entry := room.Transactions[oldest]; entry != nil {
		room.TransactionBytes -= int64(len(collabCanonical(entry.Changes)))
	}
	delete(room.Transactions, oldest)
	delete(room.TransactionHashes, oldest)
	delete(room.UndoLedger, oldest)
	for index, id := range room.UndoOrder {
		if id == oldest {
			room.UndoOrder = append(room.UndoOrder[:index], room.UndoOrder[index+1:]...)
			break
		}
	}
}

// acceptAsset records one uploaded asset, enforcing role, name, type, and quota.
// Editors may add or replace a resource; viewers may never upload.
func (r *Rooms) acceptAsset(memberID, name, hash string, size int64, mime string, bytes []byte, plaintextHash ...string) (collabAsset, *collabError) {
	r.mu.Lock()
	defer r.mu.Unlock()
	room := r.roomForMemberLocked(memberID)
	if room == nil {
		return collabAsset{}, collabFailure("no_room", "Not in a room")
	}
	member := room.Members[memberID]
	if member == nil {
		return collabAsset{}, collabFailure("no_member", "Member is no longer in the room")
	}
	if member.Role == "viewer" {
		return collabAsset{}, collabFailure("read_only", "This member has read-only access")
	}
	safeName := collabSanitizeAssetName(name)
	if safeName == "" {
		return collabAsset{}, collabFailure("invalid_name", "Asset name is not safe")
	}
	_, exists := room.Assets[safeName]
	if !collabAssetHashPattern.MatchString(hash) || !collabAllowedMime[mime] {
		return collabAsset{}, collabFailure("invalid_asset", "Asset hash or type is invalid")
	}
	plain := ""
	if len(plaintextHash) > 0 {
		plain = plaintextHash[0]
	}
	if plain != "" && !collabAssetHashPattern.MatchString(plain) {
		return collabAsset{}, collabFailure("invalid_asset", "Asset plaintext hash is invalid")
	}
	if size <= 0 || size > collabMaxAssetBytes {
		return collabAsset{}, collabFailure("invalid_size", "Asset size is outside the room limit")
	}
	if int64(len(bytes)) != size {
		return collabAsset{}, collabFailure("invalid_size", "Asset size does not match its bytes")
	}
	retained := int64(0)
	for entryName, entry := range room.Assets {
		if entryName != safeName {
			retained += entry.Size
		}
	}
	if !exists && len(room.Assets) >= collabMaxRoomAssets {
		return collabAsset{}, collabFailure("room_assets_full", "Room asset limit reached")
	}
	if retained+size > collabMaxAssetTotal {
		return collabAsset{}, collabFailure("room_assets_full", "Room asset size limit reached")
	}
	asset := collabAsset{Name: safeName, Hash: hash, Size: size, Mime: mime, PlaintextHash: plain}
	r.blobs[hash] = bytes
	room.Assets[safeName] = asset
	return asset, nil
}

// assetForMember resolves an asset and its bytes for a room member.
func (r *Rooms) assetForMember(memberID, hash, name string) (collabAsset, []byte, *collabError) {
	r.mu.Lock()
	defer r.mu.Unlock()
	room := r.roomForMemberLocked(memberID)
	if room == nil || room.Members[memberID] == nil {
		return collabAsset{}, nil, collabFailure("no_member", "Member is no longer in the room")
	}
	for _, asset := range room.Assets {
		if asset.Hash == hash && (name == "" || asset.Name == name) {
			bytes, ok := r.blobs[hash]
			if !ok {
				break
			}
			return asset, bytes, nil
		}
	}
	return collabAsset{}, nil, collabFailure("no_asset", "Asset is not available in this room")
}

// assetManifest returns a room's assets sorted by name.
func (r *Rooms) assetManifest(room *collabRoom) []collabAsset {
	r.mu.Lock()
	defer r.mu.Unlock()
	assets := make([]collabAsset, 0, len(room.Assets))
	for _, asset := range room.Assets {
		assets = append(assets, asset)
	}
	sort.Slice(assets, func(left, right int) bool { return assets[left].Name < assets[right].Name })
	return assets
}

// acquireLocks grants up to 64 de-duplicated locks for one member and returns
// the new leases.
func (r *Rooms) acquireLocks(memberID string, requested []string, ttlMs int) ([]collabLock, *collabError) {
	r.mu.Lock()
	defer r.mu.Unlock()
	room := r.roomForMemberLocked(memberID)
	if room == nil {
		return nil, collabFailure("no_room", "Not in a room")
	}
	member := room.Members[memberID]
	if member == nil {
		return nil, collabFailure("no_member", "Member is no longer in the room")
	}
	if member.Role == "viewer" {
		return nil, collabFailure("read_only", "This member has read-only access")
	}
	seen := make(map[string]struct{})
	ids := make([]string, 0, len(requested))
	for _, id := range requested {
		if id == "" || len(id) > 160 {
			continue
		}
		if _, exists := seen[id]; exists {
			continue
		}
		seen[id] = struct{}{}
		ids = append(ids, id)
		if len(ids) == 64 {
			break
		}
	}
	if len(ids) == 0 {
		return nil, collabFailure("invalid_lock", "No lock targets were requested")
	}
	now := time.Now().UnixMilli()
	r.sweepLocksLocked(now)
	conflicts := r.lockConflictsLocked(room, memberID, ids, now)
	if len(conflicts) > 0 {
		names := make([]string, len(conflicts))
		for index, lock := range conflicts {
			names[index] = lock.ID
		}
		return nil, collabFailure("locked", "Locked: "+strings.Join(names, ", "))
	}
	if ttlMs == 0 {
		ttlMs = collabLockTTL
	}
	if ttlMs < collabLockMinTTL {
		ttlMs = collabLockMinTTL
	}
	if ttlMs > collabLockMaxTTL {
		ttlMs = collabLockMaxTTL
	}
	locks := make([]collabLock, 0, len(ids))
	for _, id := range ids {
		scope := "object"
		if id == "chart" {
			scope = "chart"
		} else if strings.HasPrefix(id, "line:") {
			scope = "line"
		}
		lock := collabLock{ID: id, OwnerID: memberID, Scope: scope, ExpiresAt: now + int64(ttlMs)}
		room.Locks[id] = lock
		locks = append(locks, lock)
	}
	return locks, nil
}

// lockConflicts reports live locks that would block the requested ids.
func (r *Rooms) lockConflicts(memberID string, ids []string) []collabLock {
	r.mu.Lock()
	defer r.mu.Unlock()
	room := r.roomForMemberLocked(memberID)
	if room == nil {
		return nil
	}
	now := time.Now().UnixMilli()
	r.sweepLocksLocked(now)
	return r.lockConflictsLocked(room, memberID, ids, now)
}

// lockConflictsLocked computes conflicts while the caller holds r.mu. A chart
// request conflicts with every lock and any request conflicts with a chart
// lock.
func (r *Rooms) lockConflictsLocked(room *collabRoom, memberID string, ids []string, now int64) []collabLock {
	requested := make(map[string]struct{}, len(ids))
	for _, id := range ids {
		requested[id] = struct{}{}
	}
	seen := make(map[string]struct{})
	conflicts := make([]collabLock, 0)
	add := func(lock collabLock) {
		if lock.OwnerID == memberID || lock.ExpiresAt <= now {
			return
		}
		if _, exists := seen[lock.ID]; exists {
			return
		}
		seen[lock.ID] = struct{}{}
		conflicts = append(conflicts, lock)
	}
	if chart, ok := room.Locks["chart"]; ok && !containsKey(requested, "chart") {
		add(chart)
	}
	for _, id := range ids {
		if lock, ok := room.Locks[id]; ok {
			add(lock)
		}
	}
	if containsKey(requested, "chart") {
		for _, lock := range room.Locks {
			if lock.ID != "chart" {
				add(lock)
			}
		}
	}
	return conflicts
}

// releaseLocks releases the caller's locks and reports whether any were removed.
func (r *Rooms) releaseLocks(memberID string, ids []string) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	room := r.roomForMemberLocked(memberID)
	if room == nil {
		return false
	}
	changed := false
	for _, id := range ids {
		if lock, ok := room.Locks[id]; ok && lock.OwnerID == memberID {
			delete(room.Locks, id)
			changed = true
		}
	}
	return changed
}

// releaseMemberLocks drops every lock held by a member and reports whether any
// were removed.
func (r *Rooms) releaseMemberLocks(memberID string) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	room := r.roomForMemberLocked(memberID)
	if room == nil {
		return false
	}
	changed := false
	for id, lock := range room.Locks {
		if lock.OwnerID == memberID {
			delete(room.Locks, id)
			changed = true
		}
	}
	return changed
}

// roomLocks returns a room's live locks sorted by id.
func (r *Rooms) roomLocks(room *collabRoom) []collabLock {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.sweepLocksLocked(time.Now().UnixMilli())
	locks := make([]collabLock, 0, len(room.Locks))
	for _, lock := range room.Locks {
		locks = append(locks, lock)
	}
	sort.Slice(locks, func(left, right int) bool { return locks[left].ID < locks[right].ID })
	return locks
}

// sweepLocks removes expired leases from every room and reports whether any
// changed.
func (r *Rooms) sweepLocks() bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.sweepLocksLocked(time.Now().UnixMilli())
}

// sweepLocksLocked removes leases expired at now; the caller holds r.mu.
func (r *Rooms) sweepLocksLocked(now int64) bool {
	changed := false
	for _, room := range r.rooms {
		for id, lock := range room.Locks {
			if lock.ExpiresAt <= now {
				delete(room.Locks, id)
				changed = true
			}
		}
	}
	return changed
}

// checkEncryptedLocksLocked requires the actor to hold a live lease for every
// id an encrypted transaction declares.
func (r *Rooms) checkEncryptedLocksLocked(room *collabRoom, actorID string, lockIDs []string) *collabError {
	if len(lockIDs) == 0 {
		return collabFailure("missing_lock", "Encrypted transactions require leases")
	}
	now := time.Now().UnixMilli()
	r.sweepLocksLocked(now)
	seen := make(map[string]struct{}, len(lockIDs))
	for _, id := range lockIDs {
		if _, exists := seen[id]; exists {
			continue
		}
		seen[id] = struct{}{}
		lock, ok := room.Locks[id]
		if !ok || lock.OwnerID != actorID || lock.ExpiresAt <= now {
			return collabFailure("locked", "Lease is not held: "+id)
		}
	}
	return nil
}

// checkLocksLocked rejects a plaintext batch when another member holds a chart,
// line, or object lease covering it.
func (r *Rooms) checkLocksLocked(room *collabRoom, actorID string, changes []collabChange) *collabError {
	keys := collabChangeLockKeys(changes)
	ids := make(map[string]struct{})
	// A chart lease blocks every change, not only chart-wide ones.
	ids["chart"] = struct{}{}
	for _, id := range keys.lines {
		ids[id] = struct{}{}
	}
	for _, id := range keys.objects {
		ids[id] = struct{}{}
	}
	now := time.Now().UnixMilli()
	r.sweepLocksLocked(now)
	for id := range ids {
		if lock, ok := room.Locks[id]; ok && lock.OwnerID != actorID && lock.ExpiresAt > now {
			return collabFailure("locked", "Object is locked by another member: "+id)
		}
	}
	return nil
}

// roomForMember returns the room containing memberID, or nil.
func (r *Rooms) roomForMember(memberID string) *collabRoom {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.roomForMemberLocked(memberID)
}

// roomForMemberLocked finds a member's room; the caller holds r.mu.
func (r *Rooms) roomForMemberLocked(memberID string) *collabRoom {
	for _, room := range r.rooms {
		if room.Members[memberID] != nil {
			return room
		}
	}
	return nil
}

// memberRole returns a member's role and whether the member is still present.
func (r *Rooms) memberRole(room *collabRoom, memberID string) (string, bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	member := room.Members[memberID]
	if member == nil {
		return "", false
	}
	return member.Role, true
}

// memberIDs returns the ids of every member in a room.
func (r *Rooms) memberIDs(room *collabRoom) []string {
	r.mu.Lock()
	defer r.mu.Unlock()
	ids := make([]string, 0, len(room.Members))
	for id := range room.Members {
		ids = append(ids, id)
	}
	return ids
}

// members returns the broadcast member view sorted by id.
func (r *Rooms) members(room *collabRoom) []collabMemberWire {
	r.mu.Lock()
	defer r.mu.Unlock()
	members := make([]collabMemberWire, 0, len(room.Members))
	for _, member := range room.Members {
		members = append(members, collabMemberWire{
			ID:      member.ID,
			Profile: member.Profile,
			Role:    member.Role,
			Online:  member.Online,
		})
	}
	sort.Slice(members, func(left, right int) bool { return members[left].ID < members[right].ID })
	return members
}

// presence returns the latest presence of every member that published one.
func (r *Rooms) presence(room *collabRoom) []collabPresence {
	r.mu.Lock()
	defer r.mu.Unlock()
	presence := make([]collabPresence, 0)
	for _, member := range room.Members {
		if member.Presence != nil {
			presence = append(presence, *member.Presence)
		}
	}
	return presence
}

// welcomePayload builds the room snapshot sent to one member, optionally with
// the chart and encrypted transaction log.
func (r *Rooms) welcomePayload(room *collabRoom, memberID string, includeChart bool) (map[string]any, bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	member := room.Members[memberID]
	if member == nil {
		return nil, false
	}
	r.sweepLocksLocked(time.Now().UnixMilli())
	members := make([]collabMemberWire, 0, len(room.Members))
	for _, entry := range room.Members {
		members = append(members, collabMemberWire{
			ID:      entry.ID,
			Profile: entry.Profile,
			Role:    entry.Role,
			Online:  entry.Online,
		})
	}
	sort.Slice(members, func(left, right int) bool { return members[left].ID < members[right].ID })
	presence := make([]collabPresence, 0)
	for _, entry := range room.Members {
		if entry.Presence != nil {
			presence = append(presence, *entry.Presence)
		}
	}
	assets := make([]collabAsset, 0, len(room.Assets))
	for _, asset := range room.Assets {
		assets = append(assets, asset)
	}
	sort.Slice(assets, func(left, right int) bool { return assets[left].Name < assets[right].Name })
	locks := make([]collabLock, 0, len(room.Locks))
	for _, lock := range room.Locks {
		locks = append(locks, lock)
	}
	sort.Slice(locks, func(left, right int) bool { return locks[left].ID < locks[right].ID })
	payload := map[string]any{
		"type":        "welcome",
		"roomId":      room.ID,
		"invite":      room.Invite,
		"memberId":    member.ID,
		"hostId":      room.HostID,
		"role":        member.Role,
		"revision":    room.Revision,
		"fingerprint": room.Fingerprint,
		"maxMembers":  room.MaxMembers,
		"members":     members,
		"presence":    presence,
		"assets":      assets,
		"locks":       locks,
		"resumeToken": member.Token,
		"appVersion":  room.AppVersion,
	}
	if includeChart {
		payload["chart"] = room.Chart
	}
	if room.Encrypted {
		payload["encrypted"] = true
		payload["transactions"] = r.transactionLogLocked(room)
	}
	return payload, true
}

// transactionLogLocked returns committed entries in commit order; the caller
// holds r.mu.
func (r *Rooms) transactionLogLocked(room *collabRoom) []collabCommitted {
	log := make([]collabCommitted, 0, len(room.TransactionOrder))
	for _, id := range room.TransactionOrder {
		if entry := room.Transactions[id]; entry != nil {
			log = append(log, *entry)
		}
	}
	return log
}

// transactionLog returns committed entries in commit order.
func (r *Rooms) transactionLog(room *collabRoom) []collabCommitted {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.transactionLogLocked(room)
}

// snapshot returns the current revision, chart, and fingerprint.
func (r *Rooms) snapshot(room *collabRoom) (int, any, string, bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if room == nil {
		return 0, nil, "", false
	}
	return room.Revision, room.Chart, room.Fingerprint, true
}

// pendingFor returns the join requests waiting on a room.
func (r *Rooms) pendingFor(room *collabRoom) []collabPending {
	r.mu.Lock()
	defer r.mu.Unlock()
	pending := make([]collabPending, 0, len(room.Pending))
	for _, request := range room.Pending {
		pending = append(pending, *request)
	}
	return pending
}

// discardPending removes a join request and returns the host that should be
// notified.
func (r *Rooms) discardPending(requestID string) (string, bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, room := range r.rooms {
		if _, ok := room.Pending[requestID]; ok {
			delete(room.Pending, requestID)
			return room.HostID, true
		}
	}
	return "", false
}

// roomCount returns the number of open rooms.
func (r *Rooms) roomCount() int {
	r.mu.Lock()
	defer r.mu.Unlock()
	return len(r.rooms)
}

// prune drops rooms with no online member that were created more than a day
// before now.
func (r *Rooms) prune(now int64) {
	r.mu.Lock()
	defer r.mu.Unlock()
	for roomID, room := range r.rooms {
		online := false
		for _, member := range room.Members {
			if member.Online {
				online = true
				break
			}
		}
		if !online && now-room.CreatedAt > 24*60*60*1000 {
			delete(r.rooms, roomID)
		}
	}
}

// collectAssets drops blobs no room manifest references.
func (r *Rooms) collectAssets() {
	r.mu.Lock()
	defer r.mu.Unlock()
	referenced := make(map[string]struct{})
	for _, room := range r.rooms {
		for _, asset := range room.Assets {
			referenced[asset.Hash] = struct{}{}
		}
	}
	for hash := range r.blobs {
		if _, ok := referenced[hash]; !ok {
			delete(r.blobs, hash)
		}
	}
}

// blob returns the stored bytes for one asset hash.
func (r *Rooms) blob(hash string) ([]byte, bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	bytes, ok := r.blobs[hash]
	return bytes, ok
}

// collabState is the persisted room document. Its shape matches the standalone
// Node server so a data directory can be moved between the two.
type collabState struct {
	Rooms       []collabRoomState `json:"rooms"`
	AssetHashes []string          `json:"assetHashes"`
}

// collabRoomState is the persisted form of one room.
type collabRoomState struct {
	ID                string            `json:"id"`
	Invite            string            `json:"invite"`
	HostID            string            `json:"hostId"`
	Host              collabHostState   `json:"host"`
	Owner             string            `json:"owner,omitempty"`
	Chart             any               `json:"chart"`
	Fingerprint       string            `json:"fingerprint"`
	Revision          int               `json:"revision"`
	AppVersion        string            `json:"appVersion,omitempty"`
	Encrypted         bool              `json:"encrypted,omitempty"`
	AutoApproveEditor bool              `json:"autoApproveEditor,omitempty"`
	MaxMembers        int               `json:"maxMembers"`
	CreatedAt         int64             `json:"createdAt"`
	Assets            []collabAsset     `json:"assets"`
	Log               []collabCommitted `json:"log,omitempty"`
	Undo              []collabUndoEntry `json:"undo"`
}

// collabHostState is the persisted host identity and resume token.
type collabHostState struct {
	ID      string        `json:"id"`
	Token   string        `json:"token"`
	Profile collabProfile `json:"profile"`
}

// collabUndoEntry is the persisted undo-ledger entry.
type collabUndoEntry struct {
	ID      string `json:"id"`
	ActorID string `json:"actorId"`
	UndoOf  string `json:"undoOf,omitempty"`
}

// exportStateLocked builds the persisted document; the caller holds r.mu.
func (r *Rooms) exportStateLocked() collabState {
	state := collabState{Rooms: make([]collabRoomState, 0, len(r.rooms)), AssetHashes: make([]string, 0, len(r.blobs))}
	for hash := range r.blobs {
		state.AssetHashes = append(state.AssetHashes, hash)
	}
	sort.Strings(state.AssetHashes)
	for _, room := range r.rooms {
		host := room.Members[room.HostID]
		if host == nil {
			continue
		}
		assets := make([]collabAsset, 0, len(room.Assets))
		for _, asset := range room.Assets {
			assets = append(assets, asset)
		}
		sort.Slice(assets, func(left, right int) bool { return assets[left].Name < assets[right].Name })
		undo := make([]collabUndoEntry, 0, len(room.UndoLedger))
		appended := make(map[string]struct{})
		for _, id := range room.UndoOrder {
			entry, ok := room.UndoLedger[id]
			if !ok {
				continue
			}
			undo = append(undo, collabUndoEntry{
				ID:      entry.TransactionID,
				ActorID: entry.ActorID,
				UndoOf:  entry.UndoOf,
			})
			appended[id] = struct{}{}
		}
		for id, entry := range room.UndoLedger {
			if _, ok := appended[id]; ok {
				continue
			}
			undo = append(undo, collabUndoEntry{
				ID:      entry.TransactionID,
				ActorID: entry.ActorID,
				UndoOf:  entry.UndoOf,
			})
		}
		state.Rooms = append(state.Rooms, collabRoomState{
			ID:                room.ID,
			Invite:            room.Invite,
			HostID:            room.HostID,
			Host:              collabHostState{ID: host.ID, Token: host.Token, Profile: host.Profile},
			Owner:             room.Owner,
			Chart:             room.Chart,
			Fingerprint:       room.Fingerprint,
			AppVersion:        room.AppVersion,
			Revision:          room.Revision,
			Encrypted:         room.Encrypted,
			AutoApproveEditor: room.AutoApproveEditor,
			MaxMembers:        room.MaxMembers,
			CreatedAt:         room.CreatedAt,
			Assets:            assets,
			Log: func() []collabCommitted {
				if room.Encrypted {
					return r.transactionLogLocked(room)
				}
				return nil
			}(),
			Undo: undo,
		})
	}
	sort.Slice(state.Rooms, func(left, right int) bool { return state.Rooms[left].ID < state.Rooms[right].ID })
	return state
}

// exportState returns a consistent copy of the persisted document.
func (r *Rooms) exportState() collabState {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.exportStateLocked()
}

// stateBytes encodes the persisted document as JSON.
func (r *Rooms) stateBytes() ([]byte, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	return json.Marshal(r.exportStateLocked())
}

// importState replaces all rooms with persisted state, normalizes the member
// limit, and skips entries whose chart or assets are no longer valid.
func (r *Rooms) importState(state collabState, blobs map[string][]byte) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.rooms = make(map[string]*collabRoom)
	r.blobs = make(map[string][]byte, len(blobs))
	for hash, bytes := range blobs {
		r.blobs[hash] = bytes
	}
	for _, record := range state.Rooms {
		if len(r.rooms) >= collabMaxRooms {
			break
		}
		if record.Encrypted {
			if !collabIsEncryptedPayload(record.Chart) {
				continue
			}
		} else if !collabIsChartLike(record.Chart) {
			continue
		}
		host := &collabMember{
			ID:      record.Host.ID,
			Token:   record.Host.Token,
			Profile: collabCleanProfile(record.Host.Profile),
			Role:    "host",
			Online:  false,
		}
		assets := make(map[string]collabAsset)
		for _, asset := range record.Assets {
			if _, ok := r.blobs[asset.Hash]; ok {
				assets[asset.Name] = asset
			}
		}
		undo := make(map[string]collabUndo)
		undoOrder := make([]string, 0, len(record.Undo))
		for _, entry := range record.Undo {
			key := collabTransactionKey(entry.ActorID, entry.ID)
			undo[key] = collabUndo{
				ActorID:       entry.ActorID,
				TransactionID: entry.ID,
				UndoOf:        entry.UndoOf,
			}
			undoOrder = append(undoOrder, key)
		}
		fingerprint := record.Fingerprint
		if fingerprint == "" {
			fingerprint = collabFingerprint(record.Chart)
		}
		transactions := make(map[string]*collabCommitted)
		transactionHashes := make(map[string]string)
		transactionOrder := make([]string, 0, len(record.Log))
		transactionBytes := int64(0)
		for index := range record.Log {
			entry := record.Log[index]
			key := collabTransactionKey(entry.ActorID, entry.TransactionID)
			if _, exists := transactions[key]; exists {
				continue
			}
			copy := entry
			transactions[key] = &copy
			transactionHashes[key] = collabTransactionHash(entry.Changes, entry.UndoOf)
			transactionBytes += int64(len(collabCanonical(entry.Changes)))
			transactionOrder = append(transactionOrder, key)
		}
		r.rooms[record.ID] = &collabRoom{
			ID:                record.ID,
			Invite:            record.Invite,
			HostID:            record.HostID,
			Owner:             record.Owner,
			Chart:             record.Chart,
			Fingerprint:       fingerprint,
			AppVersion:        strings.TrimSpace(record.AppVersion),
			Revision:          record.Revision,
			Encrypted:         record.Encrypted,
			AutoApproveEditor: record.AutoApproveEditor,
			MaxMembers:        collabNormalizeMaxMembers(record.MaxMembers),
			CreatedAt:         record.CreatedAt,
			Members:           map[string]*collabMember{host.ID: host},
			Pending:           make(map[string]*collabPending),
			Transactions:      transactions,
			TransactionOrder:  transactionOrder,
			TransactionHashes: transactionHashes,
			TransactionBytes:  transactionBytes,
			UndoLedger:        undo,
			UndoOrder:         undoOrder,
			Assets:            assets,
			Locks:             make(map[string]collabLock),
		}
	}
}

// state returns the persisted document projected from memory.
func (r *Rooms) state() collabState {
	return r.exportState()
}

func containsKey(values map[string]struct{}, key string) bool {
	_, ok := values[key]
	return ok
}
