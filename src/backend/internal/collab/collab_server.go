// WebSocket transport and message dispatch for the embedded collaboration
// room. The room module (collab_room.go) owns every ordering and permission
// decision; this file only maps wire messages onto it.

package collab

import (
	"encoding/base64"
	"encoding/json"
	"log"
	"math"
	"net"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"rperedux/server/internal/ws"
)

// Per-socket upload concurrency and the shared upload reservation cap.
const collabMaxUploadsPerSocket = 2
const collabMaxUploadReserved = int64(512) << 20

// Concurrent upgraded sockets. The bound keeps a caller that opens connections
// without joining from growing per-connection state without limit.
const collabMaxSockets = 256

// Upgrade attempts allowed in one window. A forwarded client address gets the
// tight per-client budget; the direct transport peer always keeps an aggregate
// budget so a forged forwarding header cannot bypass the limiter. A loopback
// peer is the desktop LAN/Tunnel bridge, where every guest shares the bridge
// address, so it gets a larger aggregate budget until the bridge forwards a
// trusted source identity.
const collabUpgradeWindow = 10 * time.Second
const collabUpgradeLimit = 30
const collabSharedUpgradeLimit = 300

// Failed join attempts allowed on one socket before it must reconnect.
const collabMaxJoinAttempts = 10

// collabRateWindow counts upgrade attempts for one remote address.
type collabRateWindow struct {
	start int64
	count int
}

// collabConn is the room and member a socket is attached to.
type collabConn struct {
	roomID   string
	memberID string
}

// collabUpload tracks chunked asset upload state for one request.
type collabUpload struct {
	socket        *collabSocket
	memberID      string
	name          string
	hash          string
	mime          string
	plaintextHash string
	size          int64
	chunks        [][]byte
	received      int64
	next          int
}

// Server fans room events out to connected sockets.
type Server struct {
	rooms   *Rooms
	persist *Persister
	logger  *log.Logger

	mu      sync.Mutex
	sockets map[*collabSocket]*collabConn
	members map[string]*collabSocket
	pending map[string]*collabSocket
	uploads map[string]*collabUpload

	rateMu   sync.Mutex
	upgrades map[string]collabRateWindow
}

// NewServer returns a server with empty socket, upload, and rate maps.
func NewServer(rooms *Rooms, persist *Persister, logger *log.Logger) *Server {
	return &Server{
		rooms:    rooms,
		persist:  persist,
		logger:   logger,
		sockets:  make(map[*collabSocket]*collabConn),
		members:  make(map[string]*collabSocket),
		pending:  make(map[string]*collabSocket),
		uploads:  make(map[string]*collabUpload),
		upgrades: make(map[string]collabRateWindow),
	}
}

// Handler serves the health probe and upgrades every other path to a socket.
func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"ok":      true,
			"service": "rpe-redux-collaboration",
			"rooms":   s.rooms.roomCount(),
		})
	})
	mux.HandleFunc("/", s.handleUpgrade)
	return mux
}

// collabOriginAllowed accepts the desktop webview and local development
// origins. A browser tab on an unrelated site cannot open the loopback room
// socket even though WebSocket itself is not subject to CORS.
func collabOriginAllowed(origin string) bool {
	if origin == "" {
		return true
	}
	parsed, err := url.Parse(origin)
	if err != nil {
		return false
	}
	host := strings.ToLower(parsed.Hostname())
	switch parsed.Scheme {
	case "tauri":
		return host == "localhost" || host == "" || host == "tauri.localhost"
	case "http", "https":
		return host == "localhost" || host == "127.0.0.1" || host == "::1" || host == "tauri.localhost"
	default:
		return false
	}
}

// collabPeerHost returns the normalized transport peer host.
func collabPeerHost(remoteAddr string) string {
	host, _, err := net.SplitHostPort(remoteAddr)
	if err != nil {
		host = remoteAddr
	}
	host = strings.Trim(strings.ToLower(host), "[]")
	if host == "::ffff:127.0.0.1" {
		return "127.0.0.1"
	}
	return host
}

// collabLoopbackHost reports whether host is a local proxy address.
func collabLoopbackHost(host string) bool {
	if host == "localhost" {
		return true
	}
	address := net.ParseIP(host)
	return address != nil && address.IsLoopback()
}

// collabForwardedClient returns a syntactically valid client address supplied
// by a loopback proxy. The header is only a per-client hint: the transport peer
// aggregate window still applies, so a forged value cannot remove the cap.
func collabForwardedClient(headers http.Header) string {
	if headers == nil {
		return ""
	}
	candidates := []string{
		headers.Get("CF-Connecting-IP"),
		headers.Get("X-Real-IP"),
	}
	if forwarded := headers.Get("X-Forwarded-For"); forwarded != "" {
		candidates = append(candidates, strings.Split(forwarded, ",")[0])
	}
	for _, candidate := range candidates {
		host := strings.Trim(strings.TrimSpace(candidate), "[]")
		if host == "" || net.ParseIP(host) == nil {
			continue
		}
		return strings.ToLower(host)
	}
	return ""
}

// collabClientKey is the stable rate-limit identity for room creation. It uses
// a forwarded client address only when the direct peer is loopback; otherwise
// the accepted peer address identifies the creator.
func collabClientKey(remoteAddr string, headers http.Header) string {
	peer := collabPeerHost(remoteAddr)
	if collabLoopbackHost(peer) {
		if forwarded := collabForwardedClient(headers); forwarded != "" {
			return "client:" + forwarded
		}
	}
	return "peer:" + peer
}

// allowUpgrade applies the rate windows to a handshake without request headers.
func (s *Server) allowUpgrade(remoteAddr string) bool {
	return s.allowUpgradeRequest(remoteAddr, nil)
}

// allowUpgradeRequest applies the transport peer window and, behind a loopback
// proxy, the forwarded client window.
func (s *Server) allowUpgradeRequest(remoteAddr string, headers http.Header) bool {
	peer := collabPeerHost(remoteAddr)
	now := time.Now().UnixMilli()
	sharedLimit := collabUpgradeLimit
	if collabLoopbackHost(peer) {
		sharedLimit = collabSharedUpgradeLimit
	}
	s.rateMu.Lock()
	defer s.rateMu.Unlock()
	allowed := s.allowRateLocked("peer:"+peer, sharedLimit, now)
	if collabLoopbackHost(peer) {
		if forwarded := collabForwardedClient(headers); forwarded != "" {
			allowed = s.allowRateLocked("client:"+forwarded, collabUpgradeLimit, now) && allowed
		}
	}
	if len(s.upgrades) > 1024 {
		for address, entry := range s.upgrades {
			if now-entry.start >= collabUpgradeWindow.Milliseconds() {
				delete(s.upgrades, address)
			}
		}
	}
	return allowed
}

// allowRateLocked counts one hit for key and reports whether it is within limit;
// the caller holds s.rateMu.
func (s *Server) allowRateLocked(key string, limit int, now int64) bool {
	if s.upgrades == nil {
		s.upgrades = make(map[string]collabRateWindow)
	}
	window := s.upgrades[key]
	if now-window.start >= collabUpgradeWindow.Milliseconds() {
		window = collabRateWindow{start: now}
	}
	window.count++
	s.upgrades[key] = window
	return window.count <= limit
}

// handleUpgrade validates the path and upgrade headers, then serves the socket.
func (s *Server) handleUpgrade(w http.ResponseWriter, r *http.Request) {
	if !collabOriginAllowed(r.Header.Get("Origin")) {
		http.Error(w, "origin not allowed", http.StatusForbidden)
		return
	}
	if !s.allowUpgradeRequest(r.RemoteAddr, r.Header) {
		http.Error(w, "too many connection attempts", http.StatusTooManyRequests)
		return
	}
	s.mu.Lock()
	full := len(s.sockets) >= collabMaxSockets
	s.mu.Unlock()
	if full {
		http.Error(w, "room server is at its connection limit", http.StatusServiceUnavailable)
		return
	}
	if r.URL.Path != "/" && !strings.HasPrefix(r.URL.Path, "/rooms") {
		http.NotFound(w, r)
		return
	}
	if !strings.EqualFold(r.Header.Get("Upgrade"), "websocket") {
		http.Error(w, "websocket upgrade required", http.StatusUpgradeRequired)
		return
	}
	upgraded, err := ws.Upgrade(w, r)
	if err != nil {
		s.logf("upgrade failed: %v", err)
		return
	}
	socket := &collabSocket{Conn: upgraded, clientKey: collabClientKey(r.RemoteAddr, r.Header)}
	s.mu.Lock()
	s.sockets[socket] = nil
	s.mu.Unlock()
	defer s.cleanup(socket)
	s.serve(socket)
}

// serve reads JSON messages until the socket closes.
func (s *Server) serve(socket *collabSocket) {
	for {
		socket.ArmReadDeadline()
		payload, err := socket.ReadMessage()
		if err != nil {
			return
		}
		var message map[string]any
		if err := json.Unmarshal(payload, &message); err != nil || message == nil {
			s.send(socket, map[string]any{
				"type":    "error",
				"code":    "invalid_json",
				"message": "Message is not JSON",
			})
			continue
		}
		s.dispatch(socket, message)
	}
}

// dispatch runs one message handler and reports a panic as a server_error reply.
func (s *Server) dispatch(socket *collabSocket, message map[string]any) {
	defer func() {
		if recovered := recover(); recovered != nil {
			s.logf("message handler panic: %v", recovered)
			s.send(socket, map[string]any{
				"type":    "error",
				"code":    "server_error",
				"message": "The room could not process that message",
			})
		}
	}()
	s.handleMessage(socket, message)
}

// logf writes through the optional logger.
func (s *Server) logf(format string, values ...any) {
	if s.logger != nil {
		s.logger.Printf(format, values...)
	}
}

// send encodes value and closes the socket when the write fails.
func (s *Server) send(socket *collabSocket, value any) {
	payload, err := json.Marshal(value)
	if err != nil {
		s.logf("encode message: %v", err)
		return
	}
	if err := socket.WriteText(payload); err != nil {
		socket.Close()
	}
}

// sendWait queues one isolated stream frame with backpressure. Unlike send,
// this path may wait for a slow peer because asset streams already run in
// their own goroutine and must not lose a chunk when the socket queue fills.
func (s *Server) sendWait(socket *collabSocket, value any) bool {
	payload, err := json.Marshal(value)
	if err != nil {
		s.logf("encode message: %v", err)
		return false
	}
	if err := socket.WriteTextWait(payload); err != nil {
		socket.Close()
		return false
	}
	return true
}

func (s *Server) sendError(socket *collabSocket, code, message string) {
	s.send(socket, map[string]any{"type": "error", "code": code, "message": message})
}

// connection returns a copy of a socket's attachment.
func (s *Server) connection(socket *collabSocket) *collabConn {
	s.mu.Lock()
	defer s.mu.Unlock()
	connection := s.sockets[socket]
	if connection == nil {
		return nil
	}
	copy := *connection
	return &copy
}

// attach binds a socket to a member and closes any previous socket for that
// member.
func (s *Server) attach(socket *collabSocket, room *collabRoom, member *collabMember) {
	s.mu.Lock()
	previous := s.members[member.ID]
	if previous != nil && previous != socket {
		previous.Close()
	}
	s.members[member.ID] = socket
	s.sockets[socket] = &collabConn{roomID: room.ID, memberID: member.ID}
	s.mu.Unlock()
}

// socketFor resolves the live socket of a member.
func (s *Server) socketFor(memberID string) *collabSocket {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.members[memberID]
}

// broadcast sends a payload to every room member except the excluded socket.
func (s *Server) broadcast(room *collabRoom, value any, except *collabSocket) {
	payload, err := json.Marshal(value)
	if err != nil {
		s.logf("encode broadcast: %v", err)
		return
	}
	ids := s.rooms.memberIDs(room)
	s.mu.Lock()
	targets := make([]*collabSocket, 0, len(ids))
	for _, id := range ids {
		if socket := s.members[id]; socket != nil {
			targets = append(targets, socket)
		}
	}
	s.mu.Unlock()
	for _, socket := range targets {
		if socket == except {
			continue
		}
		if err := socket.WriteText(payload); err != nil {
			socket.Close()
		}
	}
}

// welcome sends the room snapshot for one member.
func (s *Server) welcome(socket *collabSocket, room *collabRoom, member *collabMember, includeChart bool) {
	payload, ok := s.rooms.welcomePayload(room, member.ID, includeChart)
	if !ok {
		s.sendError(socket, "no_member", "Member is no longer in the room")
		return
	}
	s.send(socket, payload)
}

// cleanup forgets a closed socket's pending requests, detaches it, and stops
// its writer so a normal peer close cannot leave a goroutine or connection.
func (s *Server) cleanup(socket *collabSocket) {
	s.forgetPending(socket)
	s.detach(socket)
	socket.Close()
}

// forgetPending discards join requests owned by a closed socket and notifies
// their hosts.
func (s *Server) forgetPending(socket *collabSocket) {
	requests := make([]string, 0)
	s.mu.Lock()
	for requestID, pendingSocket := range s.pending {
		if pendingSocket == socket {
			delete(s.pending, requestID)
			requests = append(requests, requestID)
		}
	}
	s.mu.Unlock()
	for _, requestID := range requests {
		hostID, ok := s.rooms.discardPending(requestID)
		if ok {
			if host := s.socketFor(hostID); host != nil {
				s.send(host, map[string]any{"type": "pending-cleared", "requestId": requestID})
			}
		}
	}
}

// detach removes a socket and publishes member, lock, and presence state after
// a disconnect.
func (s *Server) detach(socket *collabSocket) {
	s.mu.Lock()
	connection := s.sockets[socket]
	delete(s.sockets, socket)
	for requestID, upload := range s.uploads {
		if upload.socket == socket {
			delete(s.uploads, requestID)
		}
	}
	if connection == nil {
		s.mu.Unlock()
		return
	}
	if s.members[connection.memberID] != socket {
		s.mu.Unlock()
		return
	}
	delete(s.members, connection.memberID)
	s.mu.Unlock()

	room := s.rooms.disconnect(connection.memberID)
	if room == nil {
		return
	}
	s.broadcast(room, map[string]any{"type": "members", "members": s.rooms.members(room)}, nil)
	s.broadcast(room, map[string]any{"type": "locks", "locks": s.rooms.roomLocks(room)}, nil)
	s.broadcast(room, map[string]any{
		"type": "presence",
		"presence": collabPresence{
			MemberID: connection.memberID,
			Area:     "edit",
		},
	}, nil)
}

// collabProtocolFailure validates a handshake's required numeric protocol
// revision. Missing, mistyped, fractional, and mismatched revisions are all
// rejected before any room state changes.
func collabProtocolFailure(message map[string]any) *collabError {
	value, ok := message["protocolVersion"]
	if !ok {
		return collabFailure("protocol_mismatch", "This room requires protocol version 1.")
	}
	number, ok := value.(float64)
	if !ok || math.IsNaN(number) || math.IsInf(number, 0) || math.Trunc(number) != number {
		return collabFailure("protocol_mismatch", "The protocol version is invalid.")
	}
	if int(number) != collabProtocolVersion {
		return collabFailure("protocol_mismatch", "This room requires protocol version 1.")
	}
	return nil
}

// collabProtocolAccepted reports whether a handshake message can be served by
// this build.
func collabProtocolAccepted(message map[string]any) bool {
	return collabProtocolFailure(message) == nil
}

// handleMessage maps one wire message onto the room API.
func (s *Server) handleMessage(socket *collabSocket, message map[string]any) {
	switch collabStringField(message, "type") {
	case "create":
		if failure := collabProtocolFailure(message); failure != nil {
			s.sendError(socket, failure.Code, failure.Message)
			return
		}
		if s.connection(socket) != nil {
			s.sendError(socket, "already_in_room", "Leave the current room before creating another")
			return
		}
		profile := collabProfileFrom(message["profile"])
		if strings.TrimSpace(profile.Name) == "" {
			s.sendError(socket, "invalid_profile", "A display name is required")
			return
		}
		room, member, failure := s.rooms.create(
			profile,
			message["chart"],
			collabStringField(message, "fingerprint"),
			collabCreateOptions{
				Encrypted:         message["encrypted"] == true,
				AutoApproveEditor: message["autoApproveEditor"] == true,
				Invite:            collabStringField(message, "invite"),
				Owner:             socket.clientKey,
			},
		)
		if failure != nil {
			s.sendError(socket, failure.Code, failure.Message)
			return
		}
		s.attach(socket, room, member)
		s.welcome(socket, room, member, false)
		s.persistSchedule()
		return
	case "join":
		if failure := collabProtocolFailure(message); failure != nil {
			s.sendError(socket, failure.Code, failure.Message)
			return
		}
		if socket.joinFailures >= collabMaxJoinAttempts {
			s.sendError(socket, "too_many_joins", "Too many failed join attempts; reconnect to try again.")
			socket.Close()
			return
		}
		roomID := collabStringField(message, "roomId")
		invite := collabStringField(message, "invite")
		profile := collabProfileFrom(message["profile"])
		if invite == "" {
			socket.joinFailures++
			s.sendError(socket, "invalid_join", "Room password is required")
			return
		}
		if strings.TrimSpace(profile.Name) == "" {
			socket.joinFailures++
			s.sendError(socket, "invalid_profile", "A display name is required")
			return
		}
		room, request, member, failure := s.rooms.requestJoinWithAuto(roomID, invite, profile)
		if failure != nil {
			socket.joinFailures++
			s.send(socket, map[string]any{"type": "rejected", "reason": failure.Code, "message": failure.Message})
			return
		}
		if member != nil {
			socket.joinFailures = 0
			s.attach(socket, room, member)
			s.welcome(socket, room, member, true)
			s.broadcast(room, map[string]any{"type": "members", "members": s.rooms.members(room)}, socket)
			s.persistSchedule()
			return
		}
		socket.joinFailures = 0
		s.mu.Lock()
		s.pending[request.RequestID] = socket
		s.mu.Unlock()
		s.send(socket, map[string]any{"type": "waiting", "roomId": room.ID})
		if host := s.socketFor(room.HostID); host != nil {
			s.send(host, map[string]any{"type": "pending", "requestId": request.RequestID, "profile": request.Profile})
		}
		return
	case "inspect-room":
		if failure := collabProtocolFailure(message); failure != nil {
			s.sendError(socket, failure.Code, failure.Message)
			return
		}
		room, failure := s.rooms.inspectRoom(
			collabStringField(message, "roomId"),
			collabStringField(message, "invite"),
		)
		if failure != nil {
			s.send(socket, map[string]any{"type": "rejected", "reason": failure.Code, "message": failure.Message})
			return
		}
		s.send(socket, map[string]any{
			"type":       "room-info",
			"roomId":     room.ID,
			"maxMembers": room.MaxMembers,
			"members":    s.rooms.members(room),
		})
		return
	case "max-members":
		connection := s.connection(socket)
		if connection == nil {
			s.sendError(socket, "no_room", "Not in a room")
			return
		}
		value, ok := message["maxMembers"].(float64)
		if !ok || value != math.Trunc(value) {
			s.sendError(socket, "bad_max_members", "Maximum members must be between 2 and 32")
			return
		}
		room, failure := s.rooms.setMaxMembers(connection.memberID, int(value))
		if failure != nil {
			s.sendError(socket, failure.Code, failure.Message)
			return
		}
		s.broadcast(room, map[string]any{"type": "room-settings", "maxMembers": room.MaxMembers}, nil)
		s.persistSchedule()
		return
	case "set-password":
		connection := s.connection(socket)
		if connection == nil {
			s.sendError(socket, "no_room", "Not in a room")
			return
		}
		invite := collabStringField(message, "invite")
		room, failure := s.rooms.setPassword(connection.memberID, invite)
		if failure != nil {
			s.sendError(socket, failure.Code, failure.Message)
			return
		}
		s.broadcast(room, map[string]any{
			"type":       "room-settings",
			"maxMembers": room.MaxMembers,
			"invite":     room.Invite,
		}, nil)
		s.persistSchedule()
		return
	case "resume":
		if failure := collabProtocolFailure(message); failure != nil {
			s.sendError(socket, failure.Code, failure.Message)
			return
		}
		room, member, failure := s.rooms.resume(collabStringField(message, "roomId"), collabStringField(message, "token"))
		if failure != nil {
			s.send(socket, map[string]any{"type": "rejected", "reason": failure.Code, "message": failure.Message})
			return
		}
		s.attach(socket, room, member)
		s.welcome(socket, room, member, true)
		if member.Role == "host" {
			for _, request := range s.rooms.pendingFor(room) {
				s.send(socket, map[string]any{"type": "pending", "requestId": request.RequestID, "profile": request.Profile})
			}
		}
		s.broadcast(room, map[string]any{"type": "members", "members": s.rooms.members(room)}, nil)
		return
	}

	connection := s.connection(socket)
	if connection == nil {
		s.sendError(socket, "not_joined", "Join a room first")
		return
	}
	room := s.rooms.roomForMember(connection.memberID)
	if room == nil {
		s.sendError(socket, "no_room", "Room is closed")
		return
	}

	switch collabStringField(message, "type") {
	case "asset-begin":
		s.handleAssetBegin(socket, connection, room, message)
	case "asset-chunk":
		s.handleAssetChunk(socket, message)
	case "asset-commit":
		s.handleAssetCommit(socket, connection, room, message)
	case "asset-request":
		s.handleAssetRequest(socket, connection, message)
	case "approve":
		s.handleApprove(socket, connection, room, message)
	case "set-role":
		s.handleSetRole(socket, connection, room, message)
	case "remove-member":
		s.handleRemoveMember(socket, connection, room, message)
	case "close-room":
		_, memberIDs, failure := s.rooms.closeRoom(connection.memberID)
		if failure != nil {
			s.sendError(socket, failure.Code, failure.Message)
			return
		}
		s.broadcast(room, map[string]any{
			"type":    "room-closed",
			"reason":  "host_closed",
			"message": "The host closed the room",
		}, nil)
		for _, memberID := range memberIDs {
			if target := s.socketFor(memberID); target != nil {
				target.CloseAfterFlush()
			}
		}
		s.rooms.collectAssets()
		if s.persist != nil {
			if err := s.persist.flush(); err != nil {
				s.logf("persist room deletion: %v", err)
				s.persistSchedule()
			}
		}
	case "leave":
		s.rooms.leave(connection.memberID)
		s.mu.Lock()
		delete(s.sockets, socket)
		if s.members[connection.memberID] == socket {
			delete(s.members, connection.memberID)
		}
		s.mu.Unlock()
		s.broadcast(room, map[string]any{"type": "members", "members": s.rooms.members(room)}, nil)
		s.broadcast(room, map[string]any{"type": "locks", "locks": s.rooms.roomLocks(room)}, nil)
		s.broadcast(room, map[string]any{
			"type":     "presence",
			"presence": collabPresence{MemberID: connection.memberID, Area: "edit"},
		}, nil)
		socket.Close()
	case "lock-request":
		s.handleLockRequest(socket, connection, message)
	case "lock-release":
		s.handleLockRelease(socket, connection, message)
	case "presence":
		s.handlePresence(socket, connection, room, message)
	case "snapshot-request":
		revision, chart, fingerprint, ok := s.rooms.snapshot(room)
		if ok {
			payload := map[string]any{
				"type":        "snapshot",
				"revision":    revision,
				"chart":       chart,
				"fingerprint": fingerprint,
			}
			if room.Encrypted {
				payload["encrypted"] = true
				payload["transactions"] = s.rooms.transactionLog(room)
			}
			s.send(socket, payload)
		}
	case "transaction":
		s.handleTransaction(socket, connection, room, message)
	case "ping":
		s.send(socket, map[string]any{"type": "pong"})
	}
}

// handleAssetBegin validates an upload declaration and reserves its size.
func (s *Server) handleAssetBegin(socket *collabSocket, connection *collabConn, room *collabRoom, message map[string]any) {
	requestID := collabStringField(message, "requestId")
	name := collabSanitizeAssetName(collabStringField(message, "name"))
	hash := collabStringField(message, "hash")
	mime := collabStringField(message, "mime")
	plaintextHash := collabStringField(message, "plaintextHash")
	size, sizeOK := collabIntField(message, "size")
	if name == "" || !collabAssetHashPattern.MatchString(hash) || !collabAllowedMime[mime] ||
		(plaintextHash != "" && !collabAssetHashPattern.MatchString(plaintextHash)) ||
		!sizeOK || size <= 0 || size > collabMaxAssetBytes {
		s.sendAssetRejected(socket, requestID, hash, collabStringField(message, "name"), "Asset declaration is invalid")
		return
	}
	if role, ok := s.rooms.memberRole(room, connection.memberID); !ok || role == "viewer" {
		s.sendAssetRejected(socket, requestID, hash, name, "This member has read-only access")
		return
	}
	s.mu.Lock()
	active := 0
	reserved := int64(0)
	for _, upload := range s.uploads {
		if upload.socket == socket {
			active++
		}
		reserved += upload.size
	}
	if active >= collabMaxUploadsPerSocket || reserved+size > collabMaxUploadReserved {
		s.mu.Unlock()
		s.sendAssetRejected(socket, requestID, hash, name, "Too many concurrent asset uploads")
		return
	}
	s.uploads[requestID] = &collabUpload{
		socket:        socket,
		memberID:      connection.memberID,
		name:          name,
		hash:          hash,
		mime:          mime,
		plaintextHash: plaintextHash,
		size:          size,
	}
	s.mu.Unlock()
}

// handleAssetChunk appends one ordered chunk to an active upload.
func (s *Server) handleAssetChunk(socket *collabSocket, message map[string]any) {
	requestID := collabStringField(message, "requestId")
	index, indexOK := collabIntField(message, "index")
	data, dataOK := message["data"].(string)
	s.mu.Lock()
	upload := s.uploads[requestID]
	if upload == nil || upload.socket != socket || !indexOK || int64(index) != int64(upload.next) || !dataOK {
		s.mu.Unlock()
		s.sendAssetRejected(socket, requestID, "", "", "Asset chunk is out of order")
		return
	}
	chunk, err := base64.StdEncoding.DecodeString(data)
	if err != nil || len(chunk) == 0 || len(chunk) > collabAssetChunkBytes {
		delete(s.uploads, requestID)
		s.mu.Unlock()
		s.sendAssetRejected(socket, requestID, upload.hash, upload.name, "Asset chunk has an invalid size")
		return
	}
	if upload.received+int64(len(chunk)) > upload.size {
		delete(s.uploads, requestID)
		s.mu.Unlock()
		s.sendAssetRejected(socket, requestID, upload.hash, upload.name, "Asset upload exceeds its declared size")
		return
	}
	upload.chunks = append(upload.chunks, chunk)
	upload.received += int64(len(chunk))
	upload.next++
	s.mu.Unlock()
}

// handleAssetCommit verifies the assembled bytes and publishes the asset.
func (s *Server) handleAssetCommit(socket *collabSocket, connection *collabConn, room *collabRoom, message map[string]any) {
	requestID := collabStringField(message, "requestId")
	s.mu.Lock()
	upload := s.uploads[requestID]
	if upload == nil || upload.socket != socket {
		s.mu.Unlock()
		s.sendAssetRejected(socket, requestID, "", "", "Asset upload is not active")
		return
	}
	delete(s.uploads, requestID)
	s.mu.Unlock()
	bytes := make([]byte, 0, upload.size)
	for _, chunk := range upload.chunks {
		bytes = append(bytes, chunk...)
	}
	hash := sha256Hex(bytes)
	if int64(len(bytes)) != upload.size || hash != upload.hash {
		s.sendAssetRejected(socket, requestID, upload.hash, upload.name, "Asset integrity check failed")
		return
	}
	if !room.Encrypted && !collabMatchesAssetMagic(upload.mime, bytes) {
		s.sendAssetRejected(socket, requestID, hash, upload.name, "Asset content does not match its declared type")
		return
	}
	asset, failure := s.rooms.acceptAsset(
		connection.memberID,
		upload.name,
		hash,
		int64(len(bytes)),
		upload.mime,
		bytes,
		upload.plaintextHash,
	)
	if failure != nil {
		s.sendAssetRejected(socket, requestID, hash, upload.name, failure.Message, failure.Code)
		return
	}
	if err := s.persistBlob(hash, bytes); err != nil {
		s.logf("persist asset %s: %v", hash, err)
	}
	s.persistSchedule()
	s.broadcast(room, map[string]any{"type": "asset-accepted", "asset": asset}, nil)
	s.broadcast(room, map[string]any{"type": "asset-manifest", "assets": s.rooms.assetManifest(room)}, nil)
}

// handleAssetRequest streams a room asset to the requesting member.
func (s *Server) handleAssetRequest(socket *collabSocket, connection *collabConn, message map[string]any) {
	requestID := collabStringField(message, "requestId")
	hash := collabStringField(message, "hash")
	name := collabStringField(message, "name")
	asset, bytes, failure := s.rooms.assetForMember(connection.memberID, hash, name)
	if failure != nil {
		s.sendAssetRejected(socket, requestID, hash, "", failure.Message)
		return
	}
	go s.sendAsset(socket, requestID, asset, bytes)
}

// sendAsset streams one asset as chunked download messages.
func (s *Server) sendAsset(socket *collabSocket, requestID string, asset collabAsset, bytes []byte) {
	total := (len(bytes) + collabAssetChunkBytes - 1) / collabAssetChunkBytes
	if total < 1 {
		total = 1
	}
	if !s.sendWait(socket, map[string]any{
		"type":        "asset-download-begin",
		"requestId":   requestID,
		"asset":       asset,
		"totalChunks": total,
		"chunkSize":   collabAssetChunkBytes,
	}) {
		return
	}
	for index := 0; index < total; index++ {
		start := index * collabAssetChunkBytes
		end := start + collabAssetChunkBytes
		if end > len(bytes) {
			end = len(bytes)
		}
		if start > len(bytes) {
			start = len(bytes)
		}
		if !s.sendWait(socket, map[string]any{
			"type":      "asset-download-chunk",
			"requestId": requestID,
			"index":     index,
			"data":      base64.StdEncoding.EncodeToString(bytes[start:end]),
		}) {
			return
		}
	}
	s.sendWait(socket, map[string]any{"type": "asset-download-end", "requestId": requestID, "hash": asset.Hash})
}

// handleApprove resolves one join request and admits or rejects the waiting
// socket.
func (s *Server) handleApprove(socket *collabSocket, connection *collabConn, room *collabRoom, message map[string]any) {
	requestID := collabStringField(message, "requestId")
	allow, _ := message["allow"].(bool)
	role := collabStringField(message, "role")
	_, _, member, failure := s.rooms.approve(connection.memberID, requestID, allow, role)
	if failure != nil {
		// A capacity rejection leaves the request pending so the host can retry
		// after a slot opens; every other failure clears the stale entry.
		if failure.Code != "room_full" {
			s.send(socket, map[string]any{"type": "pending-cleared", "requestId": requestID})
		}
		s.sendError(socket, failure.Code, failure.Message)
		return
	}
	s.send(socket, map[string]any{"type": "pending-cleared", "requestId": requestID})
	s.mu.Lock()
	pendingSocket := s.pending[requestID]
	delete(s.pending, requestID)
	s.mu.Unlock()
	if !allow || member == nil {
		if pendingSocket != nil {
			s.send(pendingSocket, map[string]any{"type": "rejected", "reason": "declined", "message": "The host declined this request"})
			pendingSocket.Close()
		}
		return
	}
	if pendingSocket == nil {
		_, _, _ = s.rooms.removeMember(connection.memberID, member.ID)
		return
	}
	s.attach(pendingSocket, room, member)
	s.welcome(pendingSocket, room, member, true)
	s.broadcast(room, map[string]any{"type": "members", "members": s.rooms.members(room)}, pendingSocket)
}

// handleSetRole applies a host role change and publishes the member list.
func (s *Server) handleSetRole(socket *collabSocket, connection *collabConn, room *collabRoom, message map[string]any) {
	room, member, failure := s.rooms.setRole(connection.memberID, collabStringField(message, "memberId"), collabStringField(message, "role"))
	if failure != nil {
		s.sendError(socket, failure.Code, failure.Message)
		return
	}
	s.broadcast(room, map[string]any{"type": "members", "members": s.rooms.members(room)}, nil)
	s.broadcast(room, map[string]any{"type": "locks", "locks": s.rooms.roomLocks(room)}, nil)
	if target := s.socketFor(member.ID); target != nil {
		s.send(target, map[string]any{"type": "permission", "role": member.Role})
	}
}

// handleRemoveMember removes a member and closes its socket.
func (s *Server) handleRemoveMember(socket *collabSocket, connection *collabConn, room *collabRoom, message map[string]any) {
	room, member, failure := s.rooms.removeMember(connection.memberID, collabStringField(message, "memberId"))
	if failure != nil {
		s.sendError(socket, failure.Code, failure.Message)
		return
	}
	if target := s.socketFor(member.ID); target != nil {
		s.send(target, map[string]any{"type": "rejected", "reason": "removed", "message": "The host removed you from the room"})
		target.Close()
	}
	s.broadcast(room, map[string]any{"type": "members", "members": s.rooms.members(room)}, nil)
	s.broadcast(room, map[string]any{"type": "locks", "locks": s.rooms.roomLocks(room)}, nil)
	s.broadcast(room, map[string]any{
		"type":     "presence",
		"presence": collabPresence{MemberID: member.ID, Area: "edit"},
	}, nil)
}

// handleLockRequest acquires cooperative locks and reports the result.
func (s *Server) handleLockRequest(socket *collabSocket, connection *collabConn, message map[string]any) {
	ids := collabStringList(message["ids"])
	ttl, _ := collabIntField(message, "ttlMs")
	_, failure := s.rooms.acquireLocks(connection.memberID, ids, int(ttl))
	if failure != nil {
		s.send(socket, map[string]any{
			"type":      "lock-result",
			"requestId": collabStringField(message, "requestId"),
			"granted":   false,
			"conflicts": s.rooms.lockConflicts(connection.memberID, ids),
		})
		return
	}
	s.send(socket, map[string]any{
		"type":      "lock-result",
		"requestId": collabStringField(message, "requestId"),
		"granted":   true,
	})
	if room := s.rooms.roomForMember(connection.memberID); room != nil {
		s.broadcast(room, map[string]any{"type": "locks", "locks": s.rooms.roomLocks(room)}, nil)
	}
}

// handleLockRelease releases locks owned by the caller.
func (s *Server) handleLockRelease(socket *collabSocket, connection *collabConn, message map[string]any) {
	ids := collabStringList(message["ids"])
	if s.rooms.releaseLocks(connection.memberID, ids) {
		if room := s.rooms.roomForMember(connection.memberID); room != nil {
			s.broadcast(room, map[string]any{"type": "locks", "locks": s.rooms.roomLocks(room)}, nil)
		}
	}
}

// handlePresence stores a member's cursor state and relays it to the room.
func (s *Server) handlePresence(socket *collabSocket, connection *collabConn, room *collabRoom, message map[string]any) {
	raw, ok := message["presence"]
	if !ok {
		return
	}
	encoded, err := json.Marshal(raw)
	if err != nil {
		return
	}
	var presence collabPresence
	if err := json.Unmarshal(encoded, &presence); err != nil {
		return
	}
	updated, ok := s.rooms.updatePresence(connection.memberID, presence)
	if !ok {
		return
	}
	s.broadcast(room, map[string]any{"type": "presence", "presence": updated}, socket)
}

// handleTransaction commits a change set and broadcasts the result or conflict.
func (s *Server) handleTransaction(socket *collabSocket, connection *collabConn, room *collabRoom, message map[string]any) {
	transactionID := collabStringField(message, "transactionId")
	label := collabStringField(message, "label")
	if label == "" {
		label = "Remote edit"
	}
	changePayload := message["changes"]
	if !room.Encrypted {
		changePayload = collabChangesFrom(changePayload)
	}
	committed, failure := s.rooms.commit(
		connection.memberID,
		transactionID,
		label,
		changePayload,
		collabStringField(message, "undoOf"),
		collabStringList(message["lockIds"]),
	)
	if failure != nil {
		if failure.Code == "conflict" {
			revision, _, _, _ := s.rooms.snapshot(room)
			s.send(socket, map[string]any{
				"type":          "conflict",
				"revision":      revision,
				"transactionId": transactionID,
				"paths":         failure.Paths,
				"message":       failure.Message,
			})
			return
		}
		s.send(socket, map[string]any{
			"type":          "error",
			"code":          failure.Code,
			"message":       failure.Message,
			"transactionId": transactionID,
		})
		return
	}
	payload := map[string]any{
		"type":          "committed",
		"revision":      committed.Revision,
		"transactionId": committed.TransactionID,
		"actorId":       committed.ActorID,
		"label":         committed.Label,
		"changes":       committed.Changes,
		"fingerprint":   committed.Fingerprint,
	}
	if committed.UndoOf != "" {
		payload["undoOf"] = committed.UndoOf
	}
	if committed.Replay {
		// A retry gets the original result only on the requesting socket; other
		// members have already applied that revision exactly once.
		s.send(socket, payload)
		return
	}
	s.broadcast(room, payload, nil)
	s.persistSchedule()
}

// sendAssetRejected reports an asset failure, echoing the request fields that
// are known and an optional stable rejection code.
func (s *Server) sendAssetRejected(socket *collabSocket, requestID, hash, name, message string, code ...string) {
	payload := map[string]any{
		"type":      "asset-rejected",
		"requestId": requestID,
		"message":   message,
	}
	if len(code) > 0 && code[0] != "" {
		payload["code"] = code[0]
	}
	if hash != "" {
		payload["hash"] = hash
	}
	if name != "" {
		payload["name"] = name
	}
	s.send(socket, payload)
}

// persistSchedule queues a debounced state write when persistence is enabled.
func (s *Server) persistSchedule() {
	if s.persist != nil {
		s.persist.schedule()
	}
}

// persistBlob stores one asset blob when persistence is enabled.
func (s *Server) persistBlob(hash string, bytes []byte) error {
	if s.persist == nil {
		return nil
	}
	return s.persist.saveBlob(hash, bytes)
}

// CloseAll closes every connected socket.
func (s *Server) CloseAll() {
	s.mu.Lock()
	sockets := make([]*collabSocket, 0, len(s.sockets))
	for socket := range s.sockets {
		sockets = append(sockets, socket)
	}
	s.mu.Unlock()
	for _, socket := range sockets {
		socket.Close()
	}
}

// Prune sweeps expired locks and rooms, then collects unreferenced blobs.
func (s *Server) Prune() {
	s.rooms.sweepLocks()
	s.rooms.prune(time.Now().UnixMilli())
	s.rooms.collectAssets()
}

// collabStringField returns a string field, or "" when absent or mistyped.
func collabStringField(message map[string]any, key string) string {
	value, _ := message[key].(string)
	return value
}

// collabIntField returns an integral JSON number, rejecting fractional and
// non-finite values.
func collabIntField(message map[string]any, key string) (int64, bool) {
	value, ok := message[key].(float64)
	if !ok || math.IsNaN(value) || math.IsInf(value, 0) || math.Trunc(value) != value {
		return 0, false
	}
	return int64(value), true
}

// collabStringList keeps the string members of a JSON array.
func collabStringList(value any) []string {
	items, ok := value.([]any)
	if !ok {
		return nil
	}
	result := make([]string, 0, len(items))
	for _, item := range items {
		if text, ok := item.(string); ok {
			result = append(result, text)
		}
	}
	return result
}

// collabProfileFrom decodes the optional profile object of a create or join
// message.
func collabProfileFrom(value any) collabProfile {
	record, _ := value.(map[string]any)
	return collabProfile{
		Name:  collabStringField(record, "name"),
		Color: collabStringField(record, "color"),
	}
}

// collabChangesFrom decodes a plaintext change array, returning nil on a shape
// mismatch.
func collabChangesFrom(value any) []collabChange {
	raw, err := json.Marshal(value)
	if err != nil {
		return nil
	}
	var changes []collabChange
	if err := json.Unmarshal(raw, &changes); err != nil {
		return nil
	}
	return changes
}
