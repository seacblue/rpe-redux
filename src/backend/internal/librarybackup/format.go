// Package librarybackup stores content-addressed snapshots of the chart
// library beside the live SQLite database. The browser worker implements the
// same on-disk format for OPFS; this package owns the desktop and remote
// implementation.
package librarybackup

import (
	"encoding/json"
	"time"
)

// Store and object formats. Bump a version only for a breaking layout change;
// readers accept older versions and refuse to write a newer one.
const (
	StoreFormat       = "rpe-redux-library-history"
	StoreVersion      = 1
	CommitFormat      = "rpe-redux-library-commit"
	TreeFormat        = "rpe-redux-library-tree"
	ProjectFormat     = "rpe-redux-library-project"
	RevisionsFormat   = "rpe-redux-library-revisions"
	PreferencesFormat = "rpe-redux-library-preferences"
	RefFormat         = "rpe-redux-library-ref"
	ObjectMagic       = "RPEB"
	ObjectVersion     = 1
	SchemaVersion     = 2
	PreferencePolicy  = "portable-v1"
)

// Preference keys that control the automatic snapshot loop.
const (
	BackupAutoKey     = "library-backup-auto"
	BackupIntervalKey = "library-backup-interval-seconds"
)

// Encoding identifies how an object payload is stored.
type Encoding string

const (
	EncodingRaw  Encoding = "raw"
	EncodingGzip Encoding = "gzip"
)

// ObjectRef points at one content-addressed object. Size is the uncompressed
// byte count; StoredSize includes the object header.
type ObjectRef struct {
	Hash       string   `json:"hash"`
	Encoding   Encoding `json:"encoding"`
	Size       int64    `json:"size"`
	StoredSize int64    `json:"storedSize,omitempty"`
}

// Commit describes one whole-library snapshot.
type Commit struct {
	Format           string        `json:"format"`
	Version          int           `json:"version"`
	Parent           string        `json:"parent,omitempty"`
	Reason           string        `json:"reason"`
	CreatedAt        string        `json:"createdAt"`
	SchemaVersion    int           `json:"schemaVersion"`
	AppVersion       string        `json:"appVersion"`
	SourceHost       string        `json:"sourceHost"`
	DatabaseID       string        `json:"databaseId"`
	PreferencePolicy string        `json:"preferencePolicy"`
	Tree             ObjectRef     `json:"tree"`
	Preferences      ObjectRef     `json:"preferences"`
	Stats            SnapshotStats `json:"stats"`
}

// SnapshotStats summarizes the committed tree.
type SnapshotStats struct {
	Projects  int   `json:"projects"`
	Assets    int   `json:"assets"`
	Revisions int   `json:"revisions"`
	Objects   int   `json:"objects"`
	RawBytes  int64 `json:"rawBytes"`
}

// Tree lists every project manifest in a snapshot.
type Tree struct {
	Format   string     `json:"format"`
	Version  int        `json:"version"`
	Projects []TreeItem `json:"projects"`
}

// TreeItem points at one project manifest.
type TreeItem struct {
	ID       string    `json:"id"`
	Manifest ObjectRef `json:"manifest"`
}

// ProjectManifest is the complete portable state of one project.
type ProjectManifest struct {
	Format       string          `json:"format"`
	Version      int             `json:"version"`
	ID           string          `json:"id"`
	Name         string          `json:"name"`
	Group        string          `json:"group"`
	Archived     bool            `json:"archived"`
	Charter      string          `json:"charter"`
	Composer     string          `json:"composer"`
	Level        string          `json:"level"`
	Background   string          `json:"background"`
	Song         string          `json:"song"`
	NoteCount    int             `json:"noteCount"`
	Revision     int             `json:"revision"`
	ViewState    json.RawMessage `json:"viewState,omitempty"`
	AssetFolders json.RawMessage `json:"assetFolders,omitempty"`
	CreatedAt    string          `json:"createdAt"`
	UpdatedAt    string          `json:"updatedAt"`
	Chart        ObjectRef       `json:"chart"`
	Assets       []AssetRef      `json:"assets"`
	Revisions    ObjectRef       `json:"revisions"`
}

// AssetRef names one asset within a project or revision.
type AssetRef struct {
	Name     string   `json:"name"`
	Hash     string   `json:"hash"`
	Encoding Encoding `json:"encoding,omitempty"`
	Size     int64    `json:"size,omitempty"`
}

// RevisionSet is one project's immutable revision history.
type RevisionSet struct {
	Format    string           `json:"format"`
	Version   int              `json:"version"`
	ProjectID string           `json:"projectId"`
	Revisions []RevisionRecord `json:"revisions"`
}

// RevisionRecord is one stored revision.
type RevisionRecord struct {
	ID        string     `json:"id"`
	Label     string     `json:"label"`
	CreatedAt string     `json:"createdAt"`
	Size      int64      `json:"size"`
	Chart     ObjectRef  `json:"chart"`
	Assets    []AssetRef `json:"assets"`
}

// Preferences is the filtered portable preference document.
type Preferences struct {
	Format   string                     `json:"format"`
	Version  int                        `json:"version"`
	Policy   string                     `json:"policy"`
	Sections map[string]json.RawMessage `json:"sections"`
}

// Ref is one append-only generation pointer.
type Ref struct {
	Format     string `json:"format"`
	Version    int    `json:"version"`
	Generation int64  `json:"generation"`
	CommitID   string `json:"commitId"`
	Checksum   string `json:"checksum"`
	CreatedAt  string `json:"createdAt"`
}

// Policy controls automatic snapshots and retention. It is stored in
// policy.json, not in the live database, so a restore cannot change it.
type Policy struct {
	Version         int  `json:"version"`
	Auto            bool `json:"auto"`
	PollSeconds     int  `json:"pollSeconds"`
	DebounceSeconds int  `json:"debounceSeconds"`
	// MaxDelaySeconds is the longest a dirty library may wait for a snapshot
	// while edits continue. It prevents a continuous writer from postponing
	// every automatic snapshot indefinitely.
	MaxDelaySeconds int   `json:"maxDelaySeconds"`
	KeepCommits     int   `json:"keepCommits"`
	KeepDays        int   `json:"keepDays"`
	MaxCommits      int   `json:"maxCommits"`
	MaxBytes        int64 `json:"maxBytes"`
}

// DefaultPolicy is the safe default for desktop, remote, and browser hosts.
func DefaultPolicy() Policy {
	return Policy{
		Version:         1,
		Auto:            true,
		PollSeconds:     10,
		DebounceSeconds: 20,
		MaxDelaySeconds: 120,
		KeepCommits:     50,
		KeepDays:        30,
		MaxCommits:      100,
		MaxBytes:        0,
	}
}

// CommitSummary is the history row returned to callers.
type CommitSummary struct {
	ID         string        `json:"id"`
	Parent     string        `json:"parent,omitempty"`
	Reason     string        `json:"reason"`
	CreatedAt  string        `json:"createdAt"`
	Pinned     bool          `json:"pinned"`
	Stats      SnapshotStats `json:"stats"`
	SourceHost string        `json:"sourceHost"`
	Damaged    bool          `json:"damaged"`
}

// Status is the user-visible state of the backup store.
type Status struct {
	Enabled      bool           `json:"enabled"`
	Head         string         `json:"head,omitempty"`
	Healthy      bool           `json:"healthy"`
	Commits      int            `json:"commits"`
	Objects      int            `json:"objects"`
	Bytes        int64          `json:"bytes"`
	LiveBytes    int64          `json:"liveBytes"`
	LastBackupAt string         `json:"lastBackupAt,omitempty"`
	LastError    string         `json:"lastError,omitempty"`
	Policy       Policy         `json:"policy"`
	HeadSummary  *CommitSummary `json:"headSummary,omitempty"`
}

// VerifyReport summarizes a full object check.
type VerifyReport struct {
	CheckedCommits int      `json:"checkedCommits"`
	CheckedObjects int      `json:"checkedObjects"`
	Missing        []string `json:"missing,omitempty"`
	Corrupt        []string `json:"corrupt,omitempty"`
}

// CompactReport summarizes a retention pass.
type CompactReport struct {
	BeforeCommits  int   `json:"beforeCommits"`
	AfterCommits   int   `json:"afterCommits"`
	DeletedCommits int   `json:"deletedCommits"`
	DeletedObjects int   `json:"deletedObjects"`
	BeforeBytes    int64 `json:"beforeBytes"`
	AfterBytes     int64 `json:"afterBytes"`
}

// now returns the canonical snapshot timestamp.
func now() string {
	return time.Now().UTC().Format(time.RFC3339Nano)
}
