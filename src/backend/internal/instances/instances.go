// Alive frontend instances and document occupancy for the local service.
//
// The service is shared by every running editor copy. Instance leases and
// document keys live in memory; the SQLite library underneath already supports
// multi-process WAL access, while this layer prevents two editors from editing
// the same open document.

package instances

import (
	"crypto/rand"
	"encoding/hex"
	"sort"
	"sync"
	"time"
)

// instanceTTL is how long an instance lease survives without a heartbeat.
const instanceTTL = 30 * time.Second

// instanceRecord is the in-memory lease for one connected editor.
type instanceRecord struct {
	ID           string
	Label        string
	FrontendPort int
	PID          int
	StartedAt    time.Time
	HeartbeatAt  time.Time
}

// documentLock is an in-memory claim on one open document.
type documentLock struct {
	DocumentKey string
	InstanceID  string
	ChartName   string
	AcquiredAt  time.Time
	HeartbeatAt time.Time
}

// Snapshot is the JSON view of an instance and its lock keys.
type Snapshot struct {
	ID           string   `json:"id"`
	Label        string   `json:"label"`
	FrontendPort int      `json:"frontendPort,omitempty"`
	PID          int      `json:"pid"`
	StartedAt    string   `json:"startedAt"`
	HeartbeatAt  string   `json:"heartbeatAt"`
	Locks        []string `json:"locks,omitempty"`
}

// LockSnapshot is the JSON view of one document lock.
type LockSnapshot struct {
	DocumentKey string `json:"documentKey"`
	ChartName   string `json:"chartName"`
	InstanceID  string `json:"instanceId"`
	AcquiredAt  string `json:"acquiredAt"`
	HeartbeatAt string `json:"heartbeatAt"`
}

// Hub owns instance leases and document locks for the shared service.
type Hub struct {
	mu        sync.Mutex
	backendID string
	instances map[string]instanceRecord
	locks     map[string]documentLock
}

// NewHub starts an empty hub with a fresh backend id.
func NewHub() *Hub {
	return &Hub{
		backendID: randomInstanceID(),
		instances: make(map[string]instanceRecord),
		locks:     make(map[string]documentLock),
	}
}

// BackendID returns the per-process identifier reported to clients.
func (h *Hub) BackendID() string { return h.backendID }

// randomInstanceID returns a random hex id, falling back to a timestamp when
// entropy is unavailable.
func randomInstanceID() string {
	var raw [12]byte
	if _, err := rand.Read(raw[:]); err != nil {
		return time.Now().UTC().Format("20060102T150405.000000000")
	}
	return hex.EncodeToString(raw[:])
}

// pruneLocked drops instances past the TTL and any locks they owned.
func (h *Hub) pruneLocked(now time.Time) {
	for id, instance := range h.instances {
		if now.Sub(instance.HeartbeatAt) > instanceTTL {
			delete(h.instances, id)
		}
	}
	for key, lock := range h.locks {
		if _, ok := h.instances[lock.InstanceID]; !ok {
			delete(h.locks, key)
		}
	}
}

// ActiveCount returns live instances after pruning expired leases.
func (h *Hub) ActiveCount() int {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.pruneLocked(time.Now())
	return len(h.instances)
}

// Register creates or refreshes an instance lease and returns its snapshot.
func (h *Hub) Register(id, label string, pid, frontendPort int) Snapshot {
	now := time.Now()
	h.mu.Lock()
	defer h.mu.Unlock()
	h.pruneLocked(now)
	record, exists := h.instances[id]
	if !exists {
		record = instanceRecord{ID: id, StartedAt: now}
	}
	record.Label = label
	record.PID = pid
	if frontendPort > 0 {
		record.FrontendPort = frontendPort
	}
	record.HeartbeatAt = now
	h.instances[id] = record
	return h.snapshotLocked(record, now)
}

// Heartbeat refreshes an instance and its locks, reporting whether the
// instance is still registered.
func (h *Hub) Heartbeat(id string) bool {
	now := time.Now()
	h.mu.Lock()
	defer h.mu.Unlock()
	h.pruneLocked(now)
	record, ok := h.instances[id]
	if !ok {
		return false
	}
	record.HeartbeatAt = now
	h.instances[id] = record
	for key, lock := range h.locks {
		if lock.InstanceID == id {
			lock.HeartbeatAt = now
			h.locks[key] = lock
		}
	}
	return true
}

// Leave removes an instance and its locks, returning the remaining count.
func (h *Hub) Leave(id string) int {
	h.mu.Lock()
	defer h.mu.Unlock()
	delete(h.instances, id)
	for key, lock := range h.locks {
		if lock.InstanceID == id {
			delete(h.locks, key)
		}
	}
	return len(h.instances)
}

// ClearInstanceLocks drops every lock owned by an instance and returns how many.
func (h *Hub) ClearInstanceLocks(id string) int {
	h.mu.Lock()
	defer h.mu.Unlock()
	cleared := 0
	for key, lock := range h.locks {
		if lock.InstanceID == id {
			delete(h.locks, key)
			cleared++
		}
	}
	return cleared
}

// ClearDocument drops a document lock by key, reporting whether one existed.
func (h *Hub) ClearDocument(key string) bool {
	h.mu.Lock()
	defer h.mu.Unlock()
	if _, ok := h.locks[key]; !ok {
		return false
	}
	delete(h.locks, key)
	return true
}

// Acquire claims a document for an instance. When another live instance owns
// it, acquire returns that owner's snapshot and false.
func (h *Hub) Acquire(key, id, label, chartName string, frontendPort int) (Snapshot, bool) {
	now := time.Now()
	h.mu.Lock()
	defer h.mu.Unlock()
	h.pruneLocked(now)
	record, ok := h.instances[id]
	if !ok {
		record = instanceRecord{ID: id, Label: label, StartedAt: now}
	}
	if frontendPort > 0 {
		record.FrontendPort = frontendPort
	}
	record.HeartbeatAt = now
	h.instances[id] = record
	if lock, exists := h.locks[key]; exists && lock.InstanceID != id {
		owner, present := h.instances[lock.InstanceID]
		if present {
			return h.snapshotLocked(owner, now), false
		}
		delete(h.locks, key)
	}
	h.locks[key] = documentLock{
		DocumentKey: key,
		InstanceID:  id,
		ChartName:   chartName,
		AcquiredAt:  now,
		HeartbeatAt: now,
	}
	return h.snapshotLocked(record, now), true
}

// Release drops a document lock only when id is its owner.
func (h *Hub) Release(key, id string) bool {
	h.mu.Lock()
	defer h.mu.Unlock()
	lock, ok := h.locks[key]
	if !ok || lock.InstanceID != id {
		return false
	}
	delete(h.locks, key)
	return true
}

// Reconcile reports whether key is free for id and returns the current owner
// snapshot when another live instance holds it.
func (h *Hub) Reconcile(key string, id string) (Snapshot, bool) {
	now := time.Now()
	h.mu.Lock()
	defer h.mu.Unlock()
	h.pruneLocked(now)
	lock, ok := h.locks[key]
	if !ok || lock.InstanceID == id {
		return Snapshot{}, true
	}
	owner, present := h.instances[lock.InstanceID]
	if !present {
		delete(h.locks, key)
		return Snapshot{}, true
	}
	return h.snapshotLocked(owner, now), false
}

// snapshotLocked formats one instance snapshot; the caller holds h.mu.
func (h *Hub) snapshotLocked(record instanceRecord, now time.Time) Snapshot {
	locks := make([]string, 0)
	for key, lock := range h.locks {
		if lock.InstanceID == record.ID {
			locks = append(locks, key)
		}
	}
	sort.Strings(locks)
	return Snapshot{
		ID:           record.ID,
		Label:        record.Label,
		FrontendPort: record.FrontendPort,
		PID:          record.PID,
		StartedAt:    record.StartedAt.UTC().Format(time.RFC3339Nano),
		HeartbeatAt:  record.HeartbeatAt.UTC().Format(time.RFC3339Nano),
		Locks:        locks,
	}
}

// List returns sorted JSON views of live instances and locks.
func (h *Hub) List() map[string]any {
	now := time.Now()
	h.mu.Lock()
	defer h.mu.Unlock()
	h.pruneLocked(now)
	instances := make([]Snapshot, 0, len(h.instances))
	for _, record := range h.instances {
		instances = append(instances, h.snapshotLocked(record, now))
	}
	sort.Slice(instances, func(left, right int) bool {
		return instances[left].StartedAt < instances[right].StartedAt
	})
	locks := make([]LockSnapshot, 0, len(h.locks))
	for _, lock := range h.locks {
		locks = append(locks, LockSnapshot{
			DocumentKey: lock.DocumentKey,
			ChartName:   lock.ChartName,
			InstanceID:  lock.InstanceID,
			AcquiredAt:  lock.AcquiredAt.UTC().Format(time.RFC3339Nano),
			HeartbeatAt: lock.HeartbeatAt.UTC().Format(time.RFC3339Nano),
		})
	}
	sort.Slice(locks, func(left, right int) bool {
		return locks[left].DocumentKey < locks[right].DocumentKey
	})
	return map[string]any{
		"backendId": h.backendID,
		"instances": instances,
		"locks":     locks,
	}
}

// CountForHealth returns the live instance count after pruning.
func (h *Hub) CountForHealth() int {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.pruneLocked(time.Now())
	return len(h.instances)
}
