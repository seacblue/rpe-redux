// Resolves the sidecar's runtime configuration: port, loopback host, extra CORS
// origins, and the platform-specific SQLite database path.

package config

import (
	"flag"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
)

// DefaultPort is the coded default TCP port for the sidecar.
const DefaultPort = 47821

// DefaultAIPort is the loopback listener reserved for the editor's Code Cell bridge.
const DefaultAIPort = 47822

// DefaultHost keeps the service loopback-only unless explicitly overridden.
const DefaultHost = "127.0.0.1"

// DefaultCollabPort matches the standalone `npm run dev:collab` contract. The
// desktop app uses the same URL so room creation works without extra setup.
const DefaultCollabPort = 47830

// DefaultCollabHost keeps rooms loopback-only unless a host explicitly exposes
// them on a LAN interface.
const DefaultCollabHost = "127.0.0.1"

// DefaultOrigins are the origins a packaged desktop window uses. The service is
// loopback-only, but a loopback port is still reachable from any page the user
// visits, so CORS is an allowlist rather than "*".
var DefaultOrigins = []string{
	"http://tauri.localhost",
	"https://tauri.localhost",
}

// DevOrigins are the Vite and local harness origins. Resolve adds them only for
// a development launch; a packaged sidecar never trusts them.
var DevOrigins = []string{
	"http://localhost:4173",
	"http://127.0.0.1:4173",
	"http://localhost:4174",
	"http://127.0.0.1:4174",
	// Local performance/smoke harnesses.
	"http://127.0.0.1:4181",
	"http://127.0.0.1:4182",
}

// dataDirName is the per-application directory used for the database.
const dataDirName = "io.rperedux.editor"

// dbFileName is the database file name inside the application directory.
const dbFileName = "redux.db"

// Config holds the resolved runtime configuration.
type Config struct {
	Port   int
	AIPort int
	Host   string
	DB     string
	// Origins are extra CORS origins beyond the built-in application origins.
	Origins []string
	// Dev adds the local Vite and harness origins to the CORS allowlist. It is
	// false for a packaged sidecar so developer ports cannot reach production.
	Dev bool
	// Collaboration is the embedded WebSocket room server. It shares this
	// sidecar process but listens on its own loopback port so a room can be
	// hosted without a separate Node process.
	CollabPort     int
	CollabHost     string
	CollabData     string
	CollabDisabled bool
	// DocsDir is the static documentation directory served under /docs/. An
	// empty value disables the route.
	DocsDir string
}

// defaultDBPath resolves the platform-appropriate database location.
//
// Windows: %LOCALAPPDATA%\io.rperedux.editor\redux.db
// macOS:   ~/Library/Application Support/io.rperedux.editor/redux.db
// Linux:   $XDG_DATA_HOME/io.rperedux.editor/redux.db, falling back to
//
//	~/.local/share/io.rperedux.editor/redux.db
func defaultDBPath() string {
	if runtime.GOOS == "windows" {
		if dir := os.Getenv("LOCALAPPDATA"); dir != "" {
			return databasePath(dir)
		}
	}
	if runtime.GOOS == "darwin" {
		if dir, err := os.UserConfigDir(); err == nil && dir != "" {
			return databasePath(dir)
		}
	}
	if dir := os.Getenv("XDG_DATA_HOME"); dir != "" {
		return databasePath(dir)
	}
	if home, err := os.UserHomeDir(); err == nil && home != "" {
		return databasePath(filepath.Join(home, ".local", "share"))
	}
	// Last resort: relative to the working directory.
	return databasePath(".")
}

func databasePath(root string) string {
	return filepath.Join(root, dataDirName, dbFileName)
}

// Resolve layers flags over environment variables over coded defaults.
//
// Precedence: explicit flag > environment variable > default.
func Resolve(args []string) (*Config, error) {
	fs := flag.NewFlagSet("rpe-redux-server", flag.ContinueOnError)

	port := fs.Int("port", DefaultPort, "TCP port to listen on (0 selects a free port)")
	aiPort := fs.Int("ai-port", DefaultAIPort, "loopback TCP port for the Code Cell bridge (0 selects a free port)")
	host := fs.String("host", DefaultHost, "host/interface to bind (loopback by default)")
	db := fs.String("db", defaultDBPath(), "path to the SQLite database file")
	origins := fs.String("origins", "", "comma-separated extra CORS origins")
	dev := fs.Bool("dev", envFlag("REDUX_SERVER_DEV"), "allow local Vite development origins")
	collabPort := fs.Int("collab-port", DefaultCollabPort, "collaboration WebSocket port (0 selects a free port)")
	collabHost := fs.String("collab-host", DefaultCollabHost, "collaboration host/interface to bind")
	collabData := fs.String("collab-data", "", "directory for persisted rooms and assets")
	noCollab := fs.Bool("no-collab", false, "disable the embedded collaboration server")
	docsDir := fs.String("docs-dir", "", "static documentation directory served under /docs/ (empty disables it)")

	if err := fs.Parse(args); err != nil {
		return nil, err
	}

	cfg := &Config{
		Port:       *port,
		AIPort:     *aiPort,
		Host:       *host,
		DB:         *db,
		Dev:        *dev,
		CollabPort: *collabPort,
		CollabHost: *collabHost,
		CollabData: *collabData,
		DocsDir:    *docsDir,
	}

	// Environment variables apply only where the flag was not given explicitly.
	set := map[string]bool{}
	fs.Visit(func(f *flag.Flag) { set[f.Name] = true })

	if !set["port"] {
		if raw := os.Getenv("REDUX_SERVER_PORT"); raw != "" {
			p, err := strconv.Atoi(raw)
			if err != nil {
				return nil, &configError{"REDUX_SERVER_PORT must be an integer"}
			}
			cfg.Port = p
		}
	}
	if !set["ai-port"] {
		if raw := os.Getenv("REDUX_AI_PORT"); raw != "" {
			p, err := strconv.Atoi(raw)
			if err != nil {
				return nil, &configError{"REDUX_AI_PORT must be an integer"}
			}
			cfg.AIPort = p
		}
	}
	if !set["host"] {
		if raw := os.Getenv("REDUX_SERVER_HOST"); raw != "" {
			cfg.Host = raw
		}
	}
	if !set["db"] {
		if raw := os.Getenv("REDUX_SERVER_DB"); raw != "" {
			cfg.DB = raw
		}
	}
	if !set["collab-port"] {
		if raw := os.Getenv("REDUX_COLLAB_PORT"); raw != "" {
			value, err := strconv.Atoi(raw)
			if err != nil {
				return nil, &configError{"REDUX_COLLAB_PORT must be an integer"}
			}
			cfg.CollabPort = value
		}
	}
	if !set["collab-host"] {
		if raw := os.Getenv("REDUX_COLLAB_HOST"); raw != "" {
			cfg.CollabHost = raw
		}
	}
	if !set["collab-data"] {
		if raw := os.Getenv("REDUX_COLLAB_DATA"); raw != "" {
			cfg.CollabData = raw
		}
	}
	if !set["no-collab"] {
		cfg.CollabDisabled = envFlag("REDUX_COLLAB_DISABLED")
	}
	if *noCollab {
		cfg.CollabDisabled = true
	}
	if cfg.CollabData == "" {
		cfg.CollabData = filepath.Join(filepath.Dir(cfg.DB), "collaboration")
	}
	rawOrigins := *origins
	if !set["origins"] {
		rawOrigins = os.Getenv("REDUX_SERVER_ORIGINS")
	}
	for _, origin := range strings.Split(rawOrigins, ",") {
		if trimmed := strings.TrimSpace(origin); trimmed != "" {
			cfg.Origins = append(cfg.Origins, trimmed)
		}
	}
	if cfg.Dev {
		cfg.Origins = append(cfg.Origins, DevOrigins...)
	}

	if cfg.Port < 0 || cfg.Port > 65535 {
		return nil, &configError{"port must be between 0 and 65535"}
	}
	if cfg.AIPort < 0 || cfg.AIPort > 65535 {
		return nil, &configError{"AI port must be between 0 and 65535"}
	}
	if cfg.Host == "" {
		return nil, &configError{"host must not be empty"}
	}
	if cfg.DB == "" {
		return nil, &configError{"db path must not be empty"}
	}
	if cfg.CollabPort < 0 || cfg.CollabPort > 65535 {
		return nil, &configError{"collab port must be between 0 and 65535"}
	}
	if cfg.CollabHost == "" {
		return nil, &configError{"collab host must not be empty"}
	}
	if cfg.CollabData == "" {
		return nil, &configError{"collab data path must not be empty"}
	}
	if cfg.DocsDir != "" {
		absolute, err := filepath.Abs(cfg.DocsDir)
		if err != nil {
			return nil, &configError{"docs dir must be a valid path"}
		}
		cfg.DocsDir = filepath.Clean(absolute)
		if info, err := os.Stat(cfg.DocsDir); err == nil && !info.IsDir() {
			return nil, &configError{"docs dir must be a directory"}
		}
	}
	return cfg, nil
}

// envFlag reports whether an environment variable spells a true value.
func envFlag(name string) bool {
	switch strings.ToLower(strings.TrimSpace(os.Getenv(name))) {
	case "1", "true", "yes", "on":
		return true
	default:
		return false
	}
}

// configError is a user-facing configuration problem.
type configError struct{ msg string }

// Error returns the user-facing configuration message.
func (e *configError) Error() string { return e.msg }
