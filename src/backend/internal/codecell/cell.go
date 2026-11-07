// Loopback Code Cell HTTP routes and the authenticated editor bridge.
// External clients use the explicit cell API; no protocol adapter is exposed.
package codecell

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"mime"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"rperedux/server/internal/ws"
)

const (
	cellMaxBody     = 4 << 20
	cellRequestTTL  = 30 * time.Second
	endpointName    = "codecell-endpoint.json"
	endpointVersion = 1
	BridgePath      = "/api/cell/bridge"
)

// Version is reported by the sidecar health contract and injected at build time.
var Version = "dev"

type endpointFile struct {
	Version int    `json:"version"`
	Token   string `json:"token"`
	Bridge  string `json:"bridge"`
}

var bridgeCredential struct {
	once  sync.Once
	token string
	err   error
}

/** Return the current process's editor-bridge token. */
func bridgeToken() (string, error) {
	bridgeCredential.once.Do(func() {
		raw := make([]byte, 32)
		if _, err := rand.Read(raw); err != nil {
			bridgeCredential.err = err
			return
		}
		bridgeCredential.token = base64.RawURLEncoding.EncodeToString(raw)
	})
	return bridgeCredential.token, bridgeCredential.err
}

// EnsureEndpoint writes the authenticated Code Cell bridge record beside the database.
func EnsureEndpoint(dbPath string) (string, error) {
	token, err := bridgeToken()
	if err != nil {
		return "", fmt.Errorf("generate code-cell bridge token: %w", err)
	}
	absolute, err := filepath.Abs(dbPath)
	if err != nil {
		return "", err
	}
	directory := filepath.Dir(absolute)
	path := filepath.Join(directory, endpointName)
	payload, err := json.Marshal(endpointFile{
		Version: endpointVersion,
		Token:   token,
		Bridge:  BridgePath,
	})
	if err != nil {
		return "", err
	}
	if err := os.WriteFile(path, append(payload, '\n'), 0o600); err != nil {
		return "", err
	}
	_ = os.Chmod(path, 0o600)
	return path, nil
}

// Server multiplexes the loopback Code Cell routes over one editor bridge.
type Server struct {
	mu           sync.Mutex
	bridge       *ws.Conn
	pending      map[string]chan map[string]any
	nextID       uint64
	cellLoopback bool
	dbPath       string
}

// NewServer returns a server with an empty pending-request map and database path.
func NewServer(dbPath string) *Server {
	return &Server{pending: make(map[string]chan map[string]any), dbPath: dbPath}
}

// ServeHTTP routes the Code Cell HTTP endpoints and the private editor bridge.
func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if handleCellCORS(w, r) {
		return
	}
	switch r.URL.Path {
	case "/api/cell/endpoint":
		s.handleEndpoint(w, r)
	case "/api/cell/bridge":
		s.handleBridge(w, r)
	case "/api/cell/guide":
		s.handleCellGuide(w, r)
	case "/api/cell/run":
		s.handleCellRun(w, r)
	default:
		http.NotFound(w, r)
	}
}

// handleCellCORS exposes only the native Tauri origins to browser fetches.
// Loopback and origin checks still run in every endpoint handler; this helper
// only supplies the browser response headers and answers preflight requests.
func handleCellCORS(w http.ResponseWriter, r *http.Request) bool {
	origin := strings.TrimSpace(r.Header.Get("Origin"))
	if origin != "" {
		if !OriginAllowed(r) {
			return false
		}
		w.Header().Set("Access-Control-Allow-Origin", origin)
		w.Header().Set("Vary", "Origin")
		w.Header().Set("Access-Control-Allow-Methods", "GET, HEAD, POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
		w.Header().Set("Access-Control-Max-Age", "600")
	}
	if r.Method == http.MethodOptions {
		if origin == "" || !OriginAllowed(r) {
			http.Error(w, "forbidden", http.StatusForbidden)
			return true
		}
		w.WriteHeader(http.StatusNoContent)
		return true
	}
	return false
}

func (s *Server) handleEndpoint(w http.ResponseWriter, r *http.Request) {
	if !LoopbackRequest(r) || !OriginAllowed(r) {
		writeCellHTTPError(w, http.StatusForbidden, "loopback_required",
			"Code Cell endpoint is only available on loopback", nil, nil)
		return
	}
	if r.Method != http.MethodGet {
		w.Header().Set("Allow", http.MethodGet)
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	path, err := EnsureEndpoint(s.dbPath)
	if err != nil {
		writeCellHTTPError(w, http.StatusServiceUnavailable, "codecell_endpoint_unavailable",
			"The Code Cell bridge credential is unavailable", nil, nil)
		return
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(map[string]any{"path": path, "bridge": BridgePath})
}

// LoopbackRequest keeps local-only routes local even when rooms use a LAN listener.
func LoopbackRequest(r *http.Request) bool {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return false
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}

// OriginAllowed accepts native clients and the Tauri shell, but not web pages.
func OriginAllowed(r *http.Request) bool {
	origin := strings.TrimSpace(r.Header.Get("Origin"))
	return origin == "" || origin == "http://tauri.localhost" || origin == "https://tauri.localhost"
}

// RestrictCellsToListener records whether the service listener is loopback-only.
func (s *Server) RestrictCellsToListener(addr net.Addr) bool {
	s.cellLoopback = addrIsLoopback(addr)
	return s.cellLoopback
}

func addrIsLoopback(addr net.Addr) bool {
	tcp, ok := addr.(*net.TCPAddr)
	return ok && tcp.IP.IsLoopback()
}

func (s *Server) cellAccessAllowed(r *http.Request) bool {
	return s.cellLoopback && LoopbackRequest(r) && OriginAllowed(r)
}

func cellHTTPStatus(code string) int {
	switch code {
	case "disabled":
		return http.StatusForbidden
	case "stale_read", "busy", "cancelled":
		return http.StatusConflict
	case "timeout":
		return http.StatusGatewayTimeout
	case "runtime", "unavailable":
		return http.StatusServiceUnavailable
	default:
		return http.StatusBadRequest
	}
}

func writeCellHTTPError(w http.ResponseWriter, status int, code, message string, details, revisions any) {
	errorRecord := map[string]any{"code": code, "message": message}
	if details != nil {
		errorRecord["details"] = details
	}
	payload := map[string]any{"ok": false, "error": errorRecord}
	if revisions != nil {
		payload["revisions"] = revisions
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}

func (s *Server) handleCellGuide(w http.ResponseWriter, r *http.Request) {
	if !s.cellAccessAllowed(r) {
		writeCellHTTPError(w, http.StatusForbidden, "loopback_required",
			"Code Cell API is loopback-only; bind the service to 127.0.0.1", nil, nil)
		return
	}
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		w.Header().Set("Allow", "GET, HEAD")
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	response, err := s.forward(map[string]any{"method": "cell.guide"})
	if err != nil {
		writeCellHTTPError(w, http.StatusServiceUnavailable, "unavailable", err.Error(), nil, nil)
		return
	}
	value, _ := response["value"].(map[string]any)
	text, _ := value["text"].(string)
	ok, _ := response["ok"].(bool)
	if !ok || strings.TrimSpace(text) == "" {
		writeCellHTTPError(w, http.StatusServiceUnavailable, "unavailable",
			"The editor did not provide the Code Cell guide", nil, nil)
		return
	}
	w.Header().Set("Content-Type", "text/markdown; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	if r.Method == http.MethodHead {
		w.WriteHeader(http.StatusOK)
		return
	}
	_, _ = io.WriteString(w, text)
}

func (s *Server) handleCellRun(w http.ResponseWriter, r *http.Request) {
	if !s.cellAccessAllowed(r) {
		writeCellHTTPError(w, http.StatusForbidden, "loopback_required",
			"Code Cell API is loopback-only; bind the service to 127.0.0.1", nil, nil)
		return
	}
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", http.MethodPost)
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	mediaType, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if err != nil || (mediaType != "" && mediaType != "application/json") {
		writeCellHTTPError(w, http.StatusUnsupportedMediaType, "invalid_request",
			"Code Cell requests require JSON", nil, nil)
		return
	}
	body, err := io.ReadAll(io.LimitReader(r.Body, cellMaxBody+1))
	if err != nil || len(body) > cellMaxBody {
		writeCellHTTPError(w, http.StatusRequestEntityTooLarge, "invalid_request",
			"Code Cell request is too large", nil, nil)
		return
	}
	var params map[string]any
	if err := json.Unmarshal(body, &params); err != nil || params == nil {
		writeCellHTTPError(w, http.StatusBadRequest, "invalid_request",
			"Code Cell request must be a JSON object", nil, nil)
		return
	}
	response, err := s.forward(map[string]any{"method": "cell.run", "params": params})
	if err != nil {
		writeCellHTTPError(w, http.StatusServiceUnavailable, "unavailable", err.Error(), nil, nil)
		return
	}
	if ok, _ := response["ok"].(bool); !ok {
		code := "failed"
		message := "The editor rejected the Code Cell"
		var details any
		if errorRecord, ok := response["error"].(map[string]any); ok {
			if value, ok := errorRecord["code"].(string); ok && value != "" {
				code = value
			}
			if value, ok := errorRecord["message"].(string); ok && value != "" {
				message = value
			}
			details = errorRecord["details"]
		}
		writeCellHTTPError(w, cellHTTPStatus(code), code, message, details, response["revisions"])
		return
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	_ = json.NewEncoder(w).Encode(response["value"])
}

func (s *Server) bridgeTokenValid(r *http.Request) bool {
	expected, err := bridgeToken()
	if err != nil || expected == "" {
		return false
	}
	supplied := r.URL.Query().Get("token")
	if supplied == "" {
		const bearer = "Bearer "
		if authorization := r.Header.Get("Authorization"); strings.HasPrefix(authorization, bearer) {
			supplied = strings.TrimSpace(strings.TrimPrefix(authorization, bearer))
		}
	}
	return subtle.ConstantTimeCompare([]byte(supplied), []byte(expected)) == 1
}

func (s *Server) handleBridge(w http.ResponseWriter, r *http.Request) {
	if !LoopbackRequest(r) || !OriginAllowed(r) {
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}
	if !s.bridgeTokenValid(r) {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	socket, err := ws.Upgrade(w, r)
	if err != nil {
		return
	}
	s.mu.Lock()
	previous := s.bridge
	s.bridge = socket
	for id, waiter := range s.pending {
		delete(s.pending, id)
		waiter <- nil
	}
	s.mu.Unlock()
	if previous != nil {
		previous.Close()
	}
	defer func() {
		s.mu.Lock()
		if s.bridge == socket {
			s.bridge = nil
			for id, waiter := range s.pending {
				delete(s.pending, id)
				waiter <- nil
			}
		}
		s.mu.Unlock()
		socket.Close()
	}()
	for {
		payload, err := socket.ReadMessage()
		if err != nil {
			return
		}
		var message map[string]any
		if err := json.Unmarshal(payload, &message); err != nil {
			continue
		}
		if stringField(message, "type") != "response" {
			continue
		}
		id := stringField(message, "id")
		s.mu.Lock()
		waiter := s.pending[id]
		delete(s.pending, id)
		s.mu.Unlock()
		if waiter != nil {
			waiter <- message
		}
	}
}

func stringField(message map[string]any, key string) string {
	value, _ := message[key].(string)
	return value
}

func (s *Server) forward(request map[string]any) (map[string]any, error) {
	s.mu.Lock()
	bridge := s.bridge
	if bridge == nil {
		s.mu.Unlock()
		return nil, fmt.Errorf("no editor is connected; open a chart and enable Code Cells in Settings")
	}
	s.nextID++
	id := strconv.FormatUint(s.nextID, 10)
	waiter := make(chan map[string]any, 1)
	s.pending[id] = waiter
	s.mu.Unlock()
	payload, err := json.Marshal(map[string]any{"type": "request", "id": id, "request": request})
	if err != nil {
		s.removePending(id)
		return nil, err
	}
	if err := bridge.WriteText(payload); err != nil {
		s.removePending(id)
		return nil, fmt.Errorf("Code Cell editor bridge is unavailable")
	}
	select {
	case message := <-waiter:
		if message == nil {
			return nil, fmt.Errorf("Code Cell editor bridge closed")
		}
		response, _ := message["response"].(map[string]any)
		if response == nil {
			return nil, fmt.Errorf("editor returned an invalid Code Cell response")
		}
		return response, nil
	case <-time.After(cellRequestTTL):
		s.removePending(id)
		return nil, fmt.Errorf("editor did not answer within %s", cellRequestTTL)
	}
}

func (s *Server) removePending(id string) {
	s.mu.Lock()
	delete(s.pending, id)
	s.mu.Unlock()
}

// CloseAll closes the editor bridge and releases every pending request.
func (s *Server) CloseAll() {
	s.mu.Lock()
	bridge := s.bridge
	s.bridge = nil
	pending := s.pending
	s.pending = make(map[string]chan map[string]any)
	s.mu.Unlock()
	if bridge != nil {
		bridge.Close()
	}
	for _, waiter := range pending {
		waiter <- nil
	}
}
