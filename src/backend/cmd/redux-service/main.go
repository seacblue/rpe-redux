// Entry point for the loopback Go service that keeps the chart library in
// SQLite. It resolves configuration, opens the store, serves the HTTP API, and
// prints the readiness line the desktop shell parses.

package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"sync"
	"syscall"
	"time"

	"rperedux/server/internal/codecell"
	"rperedux/server/internal/collab"
	"rperedux/server/internal/config"
	"rperedux/server/internal/httpapi"
	"rperedux/server/internal/instances"
	"rperedux/server/internal/preferences"
	"rperedux/server/internal/store"
)

// shutdownTimeout bounds graceful shutdown.
const shutdownTimeout = 5 * time.Second

// HTTP timeouts bound request reads, response writes, and idle keep-alive
// connections on both listeners. Large local asset transfers stay under the
// read and write limits while stalled clients cannot hold a connection open.
const (
	httpReadTimeout  = 2 * time.Minute
	httpWriteTimeout = 2 * time.Minute
	httpIdleTimeout  = 2 * time.Minute
)

// version is the product version, injected by src/backend/build.ts. A plain
// `go run` keeps the development marker.
var version = "dev"

// listeningEvent is the readiness line the desktop shell parses.
type listeningEvent struct {
	Event  string `json:"event"`
	Name   string `json:"name"`
	API    int    `json:"api"`
	Port   int    `json:"port"`
	AIPort int    `json:"aiPort"`
	DB     string `json:"db"`
	// Version is the product version the sidecar was built with.
	Version string `json:"version,omitempty"`
	// CollabPort is the bound room port, or zero when collaboration is
	// disabled or the port is already in use.
	CollabPort int `json:"collabPort,omitempty"`
}

// main runs the sidecar and exits non-zero when startup or serving fails.
func main() {
	if err := run(os.Args[1:], os.Stdout); err != nil {
		fmt.Fprintln(os.Stderr, "rpe-redux-server:", err)
		os.Exit(1)
	}
}

// run wires configuration, storage, and HTTP together. It returns once the
// server has shut down.
func run(args []string, stdout io.Writer) error {
	cfg, err := config.Resolve(args)
	if err != nil {
		return err
	}

	data, err := store.Open(cfg.DB)
	if err != nil {
		return err
	}
	defer data.Close()

	// The Code Cell service and health payload report the same linker-injected
	// product version.
	httpapi.Version = version
	codecell.Version = version

	absDB, err := filepath.Abs(cfg.DB)
	if err != nil {
		return err
	}
	cellServer := codecell.NewServer(absDB)
	defer cellServer.CloseAll()

	// Mint the Code Cell bridge credential before serving so a file left by an
	// earlier process can never authorize this one.
	if _, err := codecell.EnsureEndpoint(absDB); err != nil {
		fmt.Fprintf(os.Stderr, "Code Cell bridge credential unavailable: %v\n", err)
	}
	if _, err := preferences.EnsureEndpoint(absDB); err != nil {
		fmt.Fprintf(os.Stderr, "preference write credential unavailable: %v\n", err)
	}

	addr := net.JoinHostPort(cfg.Host, fmt.Sprintf("%d", cfg.Port))
	listener, err := net.Listen("tcp", addr)
	if err != nil {
		return fmt.Errorf("listen on %s: %w", addr, err)
	}

	// Report the port actually bound (matters for --port 0).
	actualPort := cfg.Port
	if tcpAddr, ok := listener.Addr().(*net.TCPAddr); ok {
		actualPort = tcpAddr.Port
	}
	aiAddr := net.JoinHostPort("127.0.0.1", fmt.Sprintf("%d", cfg.AIPort))
	aiListener, err := net.Listen("tcp", aiAddr)
	if err != nil {
		_ = listener.Close()
		return fmt.Errorf("listen on AI bridge %s: %w", aiAddr, err)
	}
	actualAIPort := cfg.AIPort
	if tcpAddr, ok := aiListener.Addr().(*net.TCPAddr); ok {
		actualAIPort = tcpAddr.Port
	}

	// Code cells are a read-only but locally privileged surface. Keep them off
	// whenever the service is reachable beyond loopback.
	if !cellServer.RestrictCellsToListener(listener.Addr()) {
		fmt.Fprintln(os.Stderr, "WARNING: code-cell endpoints are disabled because the service is not bound to a loopback address.")
	}

	var collabServer *collab.Server
	var collabHTTP *http.Server
	var collabPersister *collab.Persister
	var collabTicker *time.Ticker
	var collabStop chan struct{}
	actualCollabPort := 0
	collabStatus := httpapi.CollabHealth{Enabled: !cfg.CollabDisabled}
	if cfg.CollabDisabled {
		collabStatus.Error = "collaboration is disabled"
	}
	if !cfg.CollabDisabled {
		if cfg.CollabHost != "127.0.0.1" && cfg.CollabHost != "localhost" && cfg.CollabHost != "::1" {
			fmt.Fprintln(os.Stderr, "WARNING: collaboration rooms are exposed with plaintext ws://; use a TLS reverse proxy outside this machine.")
		}
		rooms := collab.NewRooms()
		collabPersister = collab.NewPersister(cfg.CollabData, rooms, log.New(os.Stderr, "collaboration: ", log.LstdFlags))
		if err := collabPersister.Load(); err != nil {
			fmt.Fprintf(os.Stderr, "collaboration state could not be restored: %v\n", err)
		}
		collabServer = collab.NewServer(rooms, collabPersister, log.New(os.Stderr, "collaboration: ", log.LstdFlags))
		collabListener, status := bindCollabListener(cfg)
		collabStatus = status
		if collabListener == nil {
			fmt.Fprintf(os.Stderr, "%s (health reports degraded)\n", collabStatus.Error)
		} else {
			actualCollabPort = collabStatus.Port
			collabHTTP = &http.Server{
				Handler:           collabServer.Handler(),
				ReadHeaderTimeout: 10 * time.Second,
				ReadTimeout:       httpReadTimeout,
				WriteTimeout:      httpWriteTimeout,
				IdleTimeout:       httpIdleTimeout,
			}
			go func() {
				if serveErr := collabHTTP.Serve(collabListener); serveErr != nil && !errors.Is(serveErr, http.ErrServerClosed) {
					fmt.Fprintf(os.Stderr, "collaboration server stopped: %v\n", serveErr)
				}
			}()
			collabStop = make(chan struct{})
			collabTicker = time.NewTicker(time.Minute)
			go func() {
				defer collabTicker.Stop()
				for {
					select {
					case <-collabTicker.C:
						collabServer.Prune()
					case <-collabStop:
						return
					}
				}
			}()
		}
	}
	var stopCollabOnce sync.Once
	stopCollab := func() {
		stopCollabOnce.Do(func() {
			if collabStop != nil {
				close(collabStop)
				collabStop = nil
			}
			if collabServer != nil {
				collabServer.CloseAll()
			}
			if collabHTTP != nil {
				shutdownCtx, cancel := context.WithTimeout(context.Background(), shutdownTimeout)
				_ = collabHTTP.Shutdown(shutdownCtx)
				cancel()
			}
			if collabPersister != nil {
				_ = collabPersister.Close()
			}
		})
	}
	defer stopCollab()

	liveInstances := instances.NewHub()
	shutdownRequested := make(chan struct{}, 1)
	requestShutdown := func() {
		select {
		case shutdownRequested <- struct{}{}:
		default:
		}
	}
	apiHandler := httpapi.NewAPIWithRuntimeAndDocs(data, liveInstances, collabStatus, requestShutdown, cfg.DocsDir, cfg.Origins...)
	root := http.NewServeMux()
	root.Handle("/api/cell/bridge", cellServer)
	root.Handle("/api/cell/guide", cellServer)
	root.Handle("/api/cell/run", cellServer)
	root.Handle("/", apiHandler)
	handler := http.Handler(root)
	server := &http.Server{
		Handler:           handler,
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       httpReadTimeout,
		WriteTimeout:      httpWriteTimeout,
		IdleTimeout:       httpIdleTimeout,
	}
	aiServer := &http.Server{
		Handler:           cellServer,
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       httpReadTimeout,
		WriteTimeout:      httpWriteTimeout,
		IdleTimeout:       httpIdleTimeout,
	}

	serveErr := make(chan error, 2)
	go func() {
		if err := server.Serve(listener); err != nil && !errors.Is(err, http.ErrServerClosed) {
			serveErr <- err
			return
		}
		serveErr <- nil
	}()
	go func() {
		if err := aiServer.Serve(aiListener); err != nil && !errors.Is(err, http.ErrServerClosed) {
			serveErr <- err
			return
		}
		serveErr <- nil
	}()

	// The readiness contract: the host reads one line and then treats the
	// service as available. Poll the real health route first so the line is not
	// emitted during the gap between binding the listener and accepting
	// requests.
	if err := waitForHTTPReady(listener, 5*time.Second); err != nil {
		_ = server.Close()
		_ = aiServer.Close()
		return err
	}
	line, err := json.Marshal(listeningEvent{
		Event:      "listening",
		Name:       httpapi.Name,
		API:        httpapi.APIVersion,
		Port:       actualPort,
		AIPort:     actualAIPort,
		DB:         absDB,
		Version:    version,
		CollabPort: actualCollabPort,
	})
	if err != nil {
		_ = server.Close()
		_ = aiServer.Close()
		return err
	}
	if _, err := fmt.Fprintf(stdout, "%s\n", line); err != nil {
		_ = server.Close()
		_ = aiServer.Close()
		return err
	}
	if f, ok := stdout.(*os.File); ok {
		_ = f.Sync()
	}

	parentExited := make(chan struct{}, 1)
	parentDone := make(chan struct{})
	if parentPID, ok := configuredParentPID(); ok {
		go watchParent(parentPID, parentExited, parentDone)
		defer close(parentDone)
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	// Every normal stop path flushes collaboration state before the main
	// listener closes, then drains in-flight requests. The deferred store close
	// runs before run returns. A host restart that waits for the port to close
	// therefore also waits for the room snapshot write.
	shutdown := func() error {
		stopCollab()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), shutdownTimeout)
		defer cancel()
		mainErr := server.Shutdown(shutdownCtx)
		aiErr := aiServer.Shutdown(shutdownCtx)
		if mainErr != nil {
			return mainErr
		}
		return aiErr
	}

	select {
	case err := <-serveErr:
		return err
	case <-ctx.Done():
		return shutdown()
	case <-shutdownRequested:
		return shutdown()
	case <-parentExited:
		// Another editor copy may still be using this sidecar. Let their
		// heartbeats keep it alive until the last instance leaves or expires.
		for liveInstances.ActiveCount() > 0 {
			time.Sleep(time.Second)
		}
		return shutdown()
	}
}

// waitForHTTPReady polls the loopback health route after the main listener
// starts, so the readiness line means requests can be answered rather than
// only that the port is bound.
func waitForHTTPReady(listener net.Listener, timeout time.Duration) error {
	addr, ok := listener.Addr().(*net.TCPAddr)
	if !ok {
		return fmt.Errorf("service listener has no TCP address")
	}
	host := addr.IP.String()
	if host == "0.0.0.0" || host == "::" {
		host = "127.0.0.1"
	}
	url := "http://" + net.JoinHostPort(host, fmt.Sprintf("%d", addr.Port)) + "/api/health"
	client := &http.Client{Timeout: 500 * time.Millisecond}
	deadline := time.Now().Add(timeout)
	for {
		response, err := client.Get(url)
		if err == nil {
			_ = response.Body.Close()
			if response.StatusCode == http.StatusOK {
				return nil
			}
		}
		if time.Now().After(deadline) {
			return fmt.Errorf("service did not answer health at %s within %s", url, timeout)
		}
		time.Sleep(20 * time.Millisecond)
	}
}
