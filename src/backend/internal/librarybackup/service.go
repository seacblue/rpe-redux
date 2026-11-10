// Snapshot service: reads the live library through a separate read-only SQLite
// connection, writes content-addressed objects, and advances an append-only ref.
package librarybackup

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	_ "modernc.org/sqlite"
)

// Service owns the backup store and the automatic snapshot loop.
type Service struct {
	dbPath     string
	backupDir  string
	appVersion string
	sourceHost string
	objects    *objectStore
	readDB     *sql.DB

	mu            sync.Mutex
	policy        Policy
	policyChanged chan struct{}
	cancel        context.CancelFunc
	done          chan struct{}
	lastVersion   int64
	dirty         bool
	dirtySince    time.Time
	lastChange    time.Time
	lastError     string
	failures      int
	nextAttempt   time.Time
}

// Open creates the backup store beside a library database. A malformed store
// policy falls back to defaults; an unreadable store is reported on first use.
func Open(dbPath, backupDir, appVersion, sourceHost string) (*Service, error) {
	absolute, err := filepath.Abs(dbPath)
	if err != nil {
		return nil, fmt.Errorf("resolve library path: %w", err)
	}
	if backupDir == "" {
		backupDir = filepath.Join(filepath.Dir(absolute), "library-history")
	}
	objects, err := newObjectStore(backupDir)
	if err != nil {
		return nil, err
	}
	readDB, err := sql.Open("sqlite", absolute+"?_pragma=busy_timeout(15000)&_pragma=query_only(1)")
	if err != nil {
		return nil, fmt.Errorf("open library snapshot reader: %w", err)
	}
	readDB.SetMaxOpenConns(1)
	readDB.SetMaxIdleConns(1)
	service := &Service{
		dbPath:        absolute,
		backupDir:     backupDir,
		appVersion:    appVersion,
		sourceHost:    sourceHost,
		objects:       objects,
		readDB:        readDB,
		policy:        DefaultPolicy(),
		policyChanged: make(chan struct{}, 1),
		done:          make(chan struct{}),
	}
	service.policy = service.loadPolicy()
	service.RefreshPolicy()
	service.lastVersion = service.currentDataVersion()
	if service.dirtyMarkerExists() {
		// A previous process stopped after a write but before its snapshot.
		// Treat the marker as immediately overdue so the first poll flushes it.
		service.dirty = true
		service.dirtySince = time.Now().Add(
			-time.Duration(service.policy.MaxDelaySeconds) * time.Second,
		)
		service.lastChange = time.Now()
	}
	return service, nil
}

// Start launches the polling loop. It is safe to call once; repeated calls
// return the existing loop.
func (s *Service) Start(parent context.Context) {
	s.mu.Lock()
	if s.cancel != nil {
		s.mu.Unlock()
		return
	}
	ctx, cancel := context.WithCancel(parent)
	s.cancel = cancel
	s.mu.Unlock()
	go s.loop(ctx)
}

// Close stops the loop and closes the read connection.
func (s *Service) Close() {
	s.mu.Lock()
	cancel := s.cancel
	s.cancel = nil
	s.mu.Unlock()
	if cancel != nil {
		cancel()
		<-s.done
	}
	if s.readDB != nil {
		_ = s.readDB.Close()
	}
}

// Policy returns a copy of the current automatic-backup policy.
func (s *Service) Policy() Policy {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.policy
}

// SetPolicy replaces the automatic-backup policy and persists it.
func (s *Service) SetPolicy(policy Policy) error {
	if policy.PollSeconds < 1 {
		policy.PollSeconds = 1
	}
	if policy.DebounceSeconds < 1 {
		policy.DebounceSeconds = 1
	}
	if policy.MaxDelaySeconds < policy.DebounceSeconds {
		policy.MaxDelaySeconds = policy.DebounceSeconds
	}
	if policy.KeepCommits < 1 {
		policy.KeepCommits = 1
	}
	if policy.MaxCommits < policy.KeepCommits {
		policy.MaxCommits = policy.KeepCommits
	}
	if policy.Version == 0 {
		policy.Version = 1
	}
	s.mu.Lock()
	s.policy = policy
	s.mu.Unlock()
	s.signalPolicy()
	return s.writeJSON("policy.json", policy)
}

// RefreshPolicy reads the settings-backed automatic snapshot controls from the
// live preference document. It is called at startup and after every preference
// save, so turning the toggle off stops the timer completely.
func (s *Service) RefreshPolicy() {
	policy := s.Policy()
	var raw string
	if err := s.readDB.QueryRow(`SELECT data FROM preferences WHERE id = 1`).Scan(&raw); err == nil {
		policy = policyFromPreferences(raw, policy)
	}
	s.mu.Lock()
	changed := policy != s.policy
	if changed {
		s.policy = policy
	}
	s.mu.Unlock()
	if changed {
		s.signalPolicy()
		_ = s.writeJSON("policy.json", policy)
	}
}

// policyFromPreferences overlays the two user-facing controls on a fallback
// policy. Missing or malformed values keep the fallback.
func policyFromPreferences(raw string, fallback Policy) Policy {
	var document map[string]json.RawMessage
	if err := json.Unmarshal([]byte(raw), &document); err != nil {
		return fallback
	}
	var settings map[string]json.RawMessage
	if err := json.Unmarshal(document["settings"], &settings); err != nil {
		return fallback
	}
	var auto bool
	if value, ok := settings[BackupAutoKey]; ok {
		if err := json.Unmarshal(value, &auto); err == nil {
			fallback.Auto = auto
		}
	}
	var interval int
	if value, ok := settings[BackupIntervalKey]; ok {
		if err := json.Unmarshal(value, &interval); err == nil && interval > 0 {
			if interval < 30 {
				interval = 30
			}
			if interval > 3600 {
				interval = 3600
			}
			fallback.MaxDelaySeconds = interval
			fallback.DebounceSeconds = interval
			if fallback.DebounceSeconds > 20 {
				fallback.DebounceSeconds = 20
			}
		}
	}
	return fallback
}

func (s *Service) signalPolicy() {
	if s.policyChanged == nil {
		return
	}
	select {
	case s.policyChanged <- struct{}{}:
	default:
	}
}

// Status reports the current head and store size.
func (s *Service) Status(ctx context.Context) (Status, error) {
	policy := s.Policy()
	status := Status{Enabled: true, Policy: policy}
	head, err := s.head(ctx)
	if err != nil {
		status.LastError = err.Error()
	}
	if head != nil {
		status.Head = head.commitID
		status.Healthy = true
		status.LastBackupAt = head.commit.CreatedAt
		summary := summaryFromCommit(head.commitID, head.commit, false)
		status.HeadSummary = &summary
	}
	status.Commits = s.commitCount()
	status.Objects, status.Bytes = s.objects.objectCounts()
	if info, err := os.Stat(s.dbPath); err == nil {
		status.LiveBytes = info.Size()
	}
	s.mu.Lock()
	status.LastError = s.lastError
	s.mu.Unlock()
	return status, nil
}

// History walks the parent chain from HEAD and returns the latest commits.
func (s *Service) History(ctx context.Context, limit int) ([]CommitSummary, error) {
	if limit <= 0 {
		limit = 50
	}
	head, err := s.head(ctx)
	if err != nil || head == nil {
		return nil, err
	}
	out := make([]CommitSummary, 0, limit)
	current := head
	for current != nil && len(out) < limit {
		out = append(out, summaryFromCommit(current.commitID, current.commit, false))
		if current.commit.Parent == "" {
			break
		}
		parent, err := s.readCommit(current.commit.Parent)
		if err != nil {
			break
		}
		current = parent
	}
	return out, nil
}

// Notify marks the library dirty for callers that already know a write
// happened. The polling loop still catches changes made by other connections.
func (s *Service) Notify() {
	s.mu.Lock()
	defer s.mu.Unlock()
	if !s.dirty {
		s.dirtySince = time.Now()
	}
	s.dirty = true
	s.lastChange = time.Now()
	s.markDirty()
}

// Snapshot writes one whole-library commit and advances HEAD.
func (s *Service) Snapshot(ctx context.Context, reason string) (CommitSummary, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	commit, err := s.snapshotLocked(ctx, reason)
	if err != nil {
		s.lastError = err.Error()
		return CommitSummary{}, err
	}
	s.lastError = ""
	s.failures = 0
	s.clearDirty()
	return summaryFromCommit(commit.commitID, commit.commit, false), nil
}

// RestoreLatest replaces the live library with the newest complete snapshot.
func (s *Service) RestoreLatest(ctx context.Context) (CommitSummary, error) {
	head, err := s.head(ctx)
	if err != nil || head == nil {
		if err == nil {
			err = errors.New("no backup snapshot is available")
		}
		return CommitSummary{}, err
	}
	return s.Restore(ctx, head.commitID)
}

// Restore replaces the live library with one specific commit.
func (s *Service) Restore(ctx context.Context, commitID string) (CommitSummary, error) {
	target, err := s.readCommit(commitID)
	if err != nil {
		return CommitSummary{}, err
	}
	// Keep the state being replaced before touching the live tables.
	if _, err := s.Snapshot(ctx, "pre-restore"); err != nil {
		return CommitSummary{}, fmt.Errorf("write pre-restore snapshot: %w", err)
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.restoreCommitLocked(ctx, target); err != nil {
		s.lastError = err.Error()
		return CommitSummary{}, err
	}
	// Record the restored state as a normal commit so history stays linear.
	restored, err := s.snapshotLocked(ctx, "restore")
	if err != nil {
		s.lastError = err.Error()
		return CommitSummary{}, err
	}
	s.lastError = ""
	return summaryFromCommit(restored.commitID, restored.commit, false), nil
}

// Verify reads every object reachable from HEAD and reports missing or corrupt
// entries. An empty commit ID verifies HEAD.
func (s *Service) Verify(ctx context.Context, commitID string) (VerifyReport, error) {
	report := VerifyReport{}
	if commitID == "" {
		head, err := s.head(ctx)
		if err != nil {
			return report, err
		}
		if head == nil {
			return report, errors.New("no backup snapshot is available")
		}
		commitID = head.commitID
	}
	commit, err := s.readCommit(commitID)
	if err != nil {
		return report, err
	}
	report.CheckedCommits = 1
	if err := s.verifyCommit(commit.commit, &report); err != nil {
		return report, err
	}
	return report, nil
}

// Compact prunes old commits and deletes unreachable objects. A positive keep
// overrides the stored policy.
func (s *Service) Compact(ctx context.Context, keep int) (CompactReport, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	policy := s.policy
	if keep > 0 {
		policy.KeepCommits = keep
	}
	return s.compactLocked(ctx, policy)
}

// loop polls the database and runs snapshots when the debounce or maximum
// delay expires. The maximum delay is what prevents continuous edits from
// postponing a backup forever.
func (s *Service) loop(ctx context.Context) {
	defer close(s.done)
	for {
		policy := s.Policy()
		if !policy.Auto {
			// Turning automatic snapshots off removes the timer entirely; the
			// loop only waits for a settings change or shutdown.
			select {
			case <-ctx.Done():
				return
			case <-s.policyChanged:
				continue
			}
		}
		interval := time.Duration(policy.PollSeconds) * time.Second
		if interval <= 0 {
			interval = 10 * time.Second
		}
		ticker := time.NewTicker(interval)
		select {
		case <-ctx.Done():
			ticker.Stop()
			return
		case <-s.policyChanged:
			ticker.Stop()
			continue
		case <-ticker.C:
			ticker.Stop()
			if err := s.runOnce(ctx, time.Now()); err != nil {
				log.Printf("library backup: %v", err)
			}
		}
	}
}

// runOnce is one polling decision. It is exported for tests through the same
// package and uses the supplied clock so debounce behavior is deterministic.
func (s *Service) runOnce(ctx context.Context, now time.Time) error {
	s.mu.Lock()
	policy := s.policy
	current := s.currentDataVersion()
	changed := current != s.lastVersion
	if changed {
		s.lastVersion = current
		if !s.dirty {
			s.dirtySince = now
		}
		s.dirty = true
		s.lastChange = now
		s.markDirty()
	}
	hasData := s.hasLibraryData(ctx)
	head, _ := s.readHead(ctx)
	if head == nil && hasData && !s.dirty {
		// First run on an existing library: make a baseline immediately.
		s.dirty = true
		s.dirtySince = now.Add(-time.Duration(policy.MaxDelaySeconds) * time.Second)
		s.lastChange = now.Add(-time.Duration(policy.DebounceSeconds) * time.Second)
	}
	if !policy.Auto {
		s.mu.Unlock()
		return nil
	}
	if !s.dirty || now.Before(s.nextAttempt) {
		s.mu.Unlock()
		return nil
	}
	deadline := s.lastChange.Add(time.Duration(policy.DebounceSeconds) * time.Second)
	maxDeadline := s.dirtySince.Add(time.Duration(policy.MaxDelaySeconds) * time.Second)
	ready := !now.Before(deadline) || !now.Before(maxDeadline)
	if !ready {
		s.mu.Unlock()
		return nil
	}
	s.mu.Unlock()

	if _, err := s.Snapshot(ctx, "auto"); err != nil {
		s.mu.Lock()
		s.failures++
		s.lastError = err.Error()
		s.nextAttempt = now.Add(backoff(s.failures))
		s.mu.Unlock()
		return err
	}

	s.mu.Lock()
	s.nextAttempt = time.Time{}
	s.failures = 0
	s.lastVersion = s.currentDataVersion()
	if s.lastVersion != current {
		s.dirty = true
		s.dirtySince = now
		s.lastChange = now
		s.markDirty()
	} else {
		s.dirty = false
	}
	s.lastError = ""
	if s.commitCount() > policy.MaxCommits {
		if _, err := s.compactLocked(ctx, policy); err != nil {
			s.lastError = err.Error()
		}
	}
	s.mu.Unlock()
	return nil
}

func backoff(failures int) time.Duration {
	switch {
	case failures <= 1:
		return 30 * time.Second
	case failures == 2:
		return 2 * time.Minute
	case failures == 3:
		return 10 * time.Minute
	default:
		return time.Hour
	}
}

func (s *Service) currentDataVersion() int64 {
	var version int64
	if err := s.readDB.QueryRow("PRAGMA data_version").Scan(&version); err != nil {
		return 0
	}
	return version
}

func (s *Service) hasLibraryData(ctx context.Context) bool {
	var projects int
	if err := s.readDB.QueryRowContext(ctx, "SELECT COUNT(*) FROM projects").Scan(&projects); err == nil && projects > 0 {
		return true
	}
	var preferences string
	if err := s.readDB.QueryRowContext(ctx,
		"SELECT data FROM preferences WHERE id = 1").Scan(&preferences); err == nil {
		trimmed := strings.TrimSpace(preferences)
		return trimmed != "" && trimmed != "{}" && trimmed != "null"
	}
	return false
}

func (s *Service) loadPolicy() Policy {
	var policy Policy
	if err := s.readJSON("policy.json", &policy); err != nil || policy.Version == 0 {
		policy = DefaultPolicy()
		_ = s.writeJSON("policy.json", policy)
	}
	return policy
}

// dirtyMarker survives a process crash between a library write and the next
// snapshot. It is advisory: a missing marker only means the process stopped
// cleanly or the marker could not be written.
func (s *Service) markDirty() {
	_ = s.writeJSON("dirty.json", map[string]string{"changedAt": now()})
}

func (s *Service) clearDirty() {
	_ = os.Remove(filepath.Join(s.backupDir, "dirty.json"))
}

func (s *Service) dirtyMarkerExists() bool {
	_, err := os.Stat(filepath.Join(s.backupDir, "dirty.json"))
	return err == nil
}

func (s *Service) readJSON(name string, target any) error {
	bytes, err := os.ReadFile(filepath.Join(s.backupDir, name))
	if err != nil {
		return err
	}
	return json.Unmarshal(bytes, target)
}

func (s *Service) writeJSON(name string, value any) error {
	bytes, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return err
	}
	temporary, err := os.CreateTemp(s.backupDir, "meta-*")
	if err != nil {
		return err
	}
	nameTemp := temporary.Name()
	defer func() {
		_ = temporary.Close()
		_ = os.Remove(nameTemp)
	}()
	if _, err := temporary.Write(append(bytes, '\n')); err != nil {
		return err
	}
	if err := temporary.Sync(); err != nil {
		return err
	}
	if err := temporary.Close(); err != nil {
		return err
	}
	return os.Rename(nameTemp, filepath.Join(s.backupDir, name))
}

// headResult is one validated ref and its commit.
type headResult struct {
	commitID   string
	generation int64
	commit     *Commit
}

func (s *Service) head(ctx context.Context) (*headResult, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.readHead(ctx)
}

func (s *Service) readHead(ctx context.Context) (*headResult, error) {
	refs, err := s.refs()
	if err != nil {
		return nil, err
	}
	sort.Slice(refs, func(left, right int) bool { return refs[left].Generation > refs[right].Generation })
	for _, ref := range refs {
		if !validRef(ref) {
			continue
		}
		commit, err := s.readCommit(ref.CommitID)
		if err != nil {
			continue
		}
		return &headResult{commitID: ref.CommitID, generation: ref.Generation, commit: commit.commit}, nil
	}
	return nil, nil
}

func (s *Service) refs() ([]Ref, error) {
	entries, err := os.ReadDir(filepath.Join(s.backupDir, "refs"))
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}
	out := make([]Ref, 0, len(entries))
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".json") {
			continue
		}
		bytes, err := os.ReadFile(filepath.Join(s.backupDir, "refs", entry.Name()))
		if err != nil {
			continue
		}
		var ref Ref
		if err := json.Unmarshal(bytes, &ref); err != nil {
			continue
		}
		out = append(out, ref)
	}
	return out, nil
}

func (s *Service) nextGeneration() int64 {
	entries, err := os.ReadDir(filepath.Join(s.backupDir, "refs"))
	if err != nil {
		return 1
	}
	var max int64
	for _, entry := range entries {
		name := strings.TrimSuffix(entry.Name(), ".json")
		value, err := strconv.ParseInt(name, 10, 64)
		if err == nil && value > max {
			max = value
		}
	}
	return max + 1
}

func (s *Service) writeRef(commitID string) (Ref, error) {
	generation := s.nextGeneration()
	created := now()
	ref := Ref{
		Format:     RefFormat,
		Version:    1,
		Generation: generation,
		CommitID:   commitID,
		CreatedAt:  created,
	}
	ref.Checksum = refChecksum(generation, commitID, created)
	bytes, err := json.MarshalIndent(ref, "", "  ")
	if err != nil {
		return Ref{}, err
	}
	temporary, err := os.CreateTemp(filepath.Join(s.backupDir, "tmp"), "ref-*")
	if err != nil {
		return Ref{}, err
	}
	nameTemp := temporary.Name()
	defer func() {
		_ = temporary.Close()
		_ = os.Remove(nameTemp)
	}()
	if _, err := temporary.Write(append(bytes, '\n')); err != nil {
		return Ref{}, err
	}
	if err := temporary.Sync(); err != nil {
		return Ref{}, err
	}
	if err := temporary.Close(); err != nil {
		return Ref{}, err
	}
	if err := os.Rename(nameTemp, s.objects.refPath(generation)); err != nil {
		return Ref{}, err
	}
	return ref, nil
}

func refChecksum(generation int64, commitID, created string) string {
	sum := sha256.Sum256([]byte(fmt.Sprintf("%s\n1\n%d\n%s\n%s", RefFormat, generation, commitID, created)))
	return hex.EncodeToString(sum[:])
}

func validRef(ref Ref) bool {
	return ref.Format == RefFormat && ref.Version == 1 && ref.Generation > 0 &&
		ref.Checksum == refChecksum(ref.Generation, ref.CommitID, ref.CreatedAt)
}

func (s *Service) readCommit(commitID string) (*headResult, error) {
	if !validObjectName(commitID) {
		return nil, fmt.Errorf("invalid commit id %q", commitID)
	}
	path := filepath.Join(s.backupDir, "commits", commitID)
	ref, ok := readExisting(path, commitID)
	if !ok {
		return nil, fmt.Errorf("commit %s is missing", commitID)
	}
	raw, err := s.objects.read(kindCommit, ref)
	if err != nil {
		return nil, err
	}
	if hashBytes(raw) != commitID {
		return nil, fmt.Errorf("commit %s failed its content hash", commitID)
	}
	var commit Commit
	if err := json.Unmarshal(raw, &commit); err != nil {
		return nil, fmt.Errorf("decode commit %s: %w", commitID, err)
	}
	if commit.Format != CommitFormat || commit.Version > 1 {
		return nil, fmt.Errorf("commit %s has an unsupported format", commitID)
	}
	return &headResult{commitID: commitID, commit: &commit}, nil
}

func (s *Service) commitCount() int {
	entries, err := os.ReadDir(filepath.Join(s.backupDir, "commits"))
	if err != nil {
		return 0
	}
	count := 0
	for _, entry := range entries {
		if !entry.IsDir() {
			count++
		}
	}
	return count
}

func summaryFromCommit(id string, commit *Commit, damaged bool) CommitSummary {
	if commit == nil {
		return CommitSummary{ID: id, Damaged: damaged}
	}
	return CommitSummary{
		ID:         id,
		Parent:     commit.Parent,
		Reason:     commit.Reason,
		CreatedAt:  commit.CreatedAt,
		Stats:      commit.Stats,
		SourceHost: commit.SourceHost,
		Damaged:    damaged,
	}
}
