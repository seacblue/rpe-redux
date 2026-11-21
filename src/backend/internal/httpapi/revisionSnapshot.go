// Consistent revision-list snapshots for paginated clients.
//
// A revision page alone cannot be consistent: revisions may be appended or
// deleted between two offset requests. The first request materializes the
// ordered summaries once and returns a short-lived token; later pages read the
// same materialized list even when the live table has moved on.

package httpapi

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"sync"
	"time"

	"rperedux/server/internal/store"
)

const (
	revisionSnapshotTTL       = 5 * time.Minute
	maxRevisionSnapshots      = 32
	maxRevisionSnapshotPage   = 200
	defaultRevisionSnapshotPg = 50
)

var errRevisionSnapshotExpired = errors.New("revision snapshot expired")

type revisionSnapshot struct {
	projectID string
	expiresAt time.Time
	revisions []store.RevisionSummary
}

type revisionSnapshotCache struct {
	mu      sync.Mutex
	entries map[string]revisionSnapshot
}

func newRevisionSnapshotCache() *revisionSnapshotCache {
	return &revisionSnapshotCache{entries: make(map[string]revisionSnapshot)}
}

// page returns one slice of the token's materialized list. An empty token
// creates a snapshot from the store and returns its token.
func (c *revisionSnapshotCache) page(
	ctx context.Context,
	data *store.Store,
	projectID string,
	token string,
	limit int,
	offset int,
) ([]store.RevisionSummary, int, string, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	now := time.Now()
	c.prune(now)

	if token == "" {
		revisions, err := data.ListAllRevisions(ctx, projectID)
		if err != nil {
			return nil, 0, "", err
		}
		token, err = c.insert(projectID, revisions, now)
		if err != nil {
			return nil, 0, "", err
		}
	}

	entry, ok := c.entries[token]
	if !ok || entry.projectID != projectID || now.After(entry.expiresAt) {
		return nil, 0, "", errRevisionSnapshotExpired
	}
	if limit <= 0 {
		limit = defaultRevisionSnapshotPg
	}
	if limit > maxRevisionSnapshotPage {
		limit = maxRevisionSnapshotPage
	}
	if offset < 0 {
		offset = 0
	}
	total := len(entry.revisions)
	if offset >= total {
		return []store.RevisionSummary{}, total, token, nil
	}
	end := offset + limit
	if end > total {
		end = total
	}
	return entry.revisions[offset:end], total, token, nil
}

// insert stores one materialized list under a fresh random token.
func (c *revisionSnapshotCache) insert(
	projectID string,
	revisions []store.RevisionSummary,
	now time.Time,
) (string, error) {
	if len(c.entries) >= maxRevisionSnapshots {
		c.evictOldest()
	}
	raw := make([]byte, 16)
	if _, err := rand.Read(raw); err != nil {
		return "", err
	}
	token := hex.EncodeToString(raw)
	c.entries[token] = revisionSnapshot{
		projectID: projectID,
		expiresAt: now.Add(revisionSnapshotTTL),
		revisions: revisions,
	}
	return token, nil
}

// prune drops expired snapshots. The caller holds the cache lock.
func (c *revisionSnapshotCache) prune(now time.Time) {
	for token, entry := range c.entries {
		if now.After(entry.expiresAt) {
			delete(c.entries, token)
		}
	}
}

// evictOldest removes the entry that expires first. The caller holds the lock.
func (c *revisionSnapshotCache) evictOldest() {
	var oldestToken string
	var oldest time.Time
	for token, entry := range c.entries {
		if oldestToken == "" || entry.expiresAt.Before(oldest) {
			oldestToken = token
			oldest = entry.expiresAt
		}
	}
	if oldestToken != "" {
		delete(c.entries, oldestToken)
	}
}
