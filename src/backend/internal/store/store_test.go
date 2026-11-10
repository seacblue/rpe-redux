// Store-level regression tests for the library's revision token, content
// addressed assets, and garbage collection.
package store

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

func testStore(t *testing.T) *Store {
	t.Helper()
	store, err := Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })
	return store
}

func testChart(name string) json.RawMessage {
	return json.RawMessage(`{"META":{"name":"` + name + `"},"BPMList":[{"bpm":120,"startTime":[0,0,1]}],"judgeLineList":[]}`)
}

func createTestProject(t *testing.T, store *Store) *ProjectFull {
	t.Helper()
	project, err := store.CreateProject(context.Background(), CreateProjectInput{
		Name:  "project",
		Chart: testChart("project"),
	})
	if err != nil {
		t.Fatalf("create project: %v", err)
	}
	return project
}

func stage(t *testing.T, store *Store, projectID, name, value string) *Asset {
	t.Helper()
	asset, err := store.StageAsset(context.Background(), projectID, name, []byte(value))
	if err != nil {
		t.Fatalf("stage %s: %v", name, err)
	}
	return asset
}

func TestAssetsAreContentAddressedAndIncremental(t *testing.T) {
	store := testStore(t)
	project := createTestProject(t, store)
	ctx := context.Background()

	bg := stage(t, store, project.ID, "bg.png", "same bytes")
	manifest := []AssetMapping{{Name: bg.Name, Hash: bg.Hash}}
	first, err := store.CommitProject(ctx, CommitProjectInput{
		ProjectID:    project.ID,
		BaseRevision: &project.Revision,
		Chart:        testChart("first"),
		Assets:       &manifest,
	})
	if err != nil {
		t.Fatalf("commit first: %v", err)
	}
	if first.Revision != project.Revision+1 {
		t.Fatalf("revision = %d, want %d", first.Revision, project.Revision+1)
	}

	assets, err := store.ListProjectAssets(ctx, project.ID)
	if err != nil {
		t.Fatalf("list assets: %v", err)
	}
	if len(assets) != 1 || assets[0].Name != "bg.png" {
		t.Fatalf("assets = %#v", assets)
	}

	second, err := store.CommitProject(ctx, CommitProjectInput{
		ProjectID:    project.ID,
		BaseRevision: &first.Revision,
		Chart:        testChart("first"),
		Assets:       &manifest,
	})
	if err != nil {
		t.Fatalf("commit same chart: %v", err)
	}
	if second.Revision != first.Revision {
		t.Fatalf("unchanged commit moved revision %d -> %d", first.Revision, second.Revision)
	}

	other := createTestProject(t, store)
	duplicate := stage(t, store, other.ID, "copy.png", "same bytes")
	if duplicate.Hash != bg.Hash {
		t.Fatalf("identical bytes have different hashes: %s / %s", bg.Hash, duplicate.Hash)
	}
	var blobs int
	if err := store.db.QueryRow(`SELECT COUNT(*) FROM assets`).Scan(&blobs); err != nil {
		t.Fatal(err)
	}
	if blobs != 1 {
		t.Fatalf("asset blobs = %d, want 1", blobs)
	}
}

func TestAssetReaderStreamsAcrossChunks(t *testing.T) {
	store := testStore(t)
	project := createTestProject(t, store)
	ctx := context.Background()
	payload := bytes.Repeat([]byte("0123456789abcdef"), 50_000)
	asset := stage(t, store, project.ID, "large.bin", string(payload))
	manifest := []AssetMapping{{Name: asset.Name, Hash: asset.Hash}}
	if _, err := store.CommitProject(ctx, CommitProjectInput{
		ProjectID: project.ID,
		Chart:     testChart("large"),
		Assets:    &manifest,
	}); err != nil {
		t.Fatalf("commit: %v", err)
	}

	_, reader, err := store.OpenProjectAsset(ctx, project.ID, "large.bin")
	if err != nil {
		t.Fatalf("open asset: %v", err)
	}
	whole, err := io.ReadAll(reader)
	if err != nil {
		t.Fatalf("read all: %v", err)
	}
	if !bytes.Equal(whole, payload) {
		t.Fatalf("streamed %d bytes, want %d", len(whole), len(payload))
	}

	if _, err := reader.Seek(assetChunkBytes-10, io.SeekStart); err != nil {
		t.Fatalf("seek: %v", err)
	}
	window := make([]byte, 40)
	if _, err := io.ReadFull(reader, window); err != nil {
		t.Fatalf("read window: %v", err)
	}
	start := int64(assetChunkBytes - 10)
	if !bytes.Equal(window, payload[start:start+int64(len(window))]) {
		t.Fatal("range crossing a reader chunk boundary was corrupted")
	}
}

func TestOpenAssetByHashFindsAnExistingBlob(t *testing.T) {
	store := testStore(t)
	project := createTestProject(t, store)
	ctx := context.Background()
	payload := []byte("content addressed bytes")
	asset := stage(t, store, project.ID, "cover.png", string(payload))

	reader, size, err := store.OpenAssetByHash(ctx, asset.Hash)
	if err != nil {
		t.Fatalf("open asset by hash: %v", err)
	}
	if size != int64(len(payload)) {
		t.Fatalf("size = %d, want %d", size, len(payload))
	}
	whole, err := io.ReadAll(reader)
	if err != nil {
		t.Fatalf("read asset by hash: %v", err)
	}
	if !bytes.Equal(whole, payload) {
		t.Fatalf("bytes = %q", whole)
	}
	if _, _, err := store.OpenAssetByHash(ctx, strings.Repeat("0", 64)); !errors.Is(err, ErrNotFound) {
		t.Fatalf("missing hash error = %v", err)
	}
}

func TestProjectSummaryCarriesMediaReferences(t *testing.T) {
	store := testStore(t)
	ctx := context.Background()
	chart := json.RawMessage(`{"META":{"name":"cover","background":"covers/bg.png","song":"audio/track.ogg","charter":"a","composer":"b","level":"c"},"judgeLineList":[]}`)
	project, err := store.CreateProject(ctx, CreateProjectInput{Name: "cover", Chart: chart})
	if err != nil {
		t.Fatalf("create project: %v", err)
	}
	if project.Background != "covers/bg.png" {
		t.Fatalf("background = %q, want covers/bg.png", project.Background)
	}
	if project.Song != "audio/track.ogg" {
		t.Fatalf("song = %q, want audio/track.ogg", project.Song)
	}
	listed, _, err := store.ListProjects(ctx, ListProjectsInput{})
	if err != nil {
		t.Fatalf("list projects: %v", err)
	}
	if len(listed) != 1 || listed[0].Background != "covers/bg.png" ||
		listed[0].Song != "audio/track.ogg" {
		t.Fatalf("listed = %#v", listed)
	}
}

func TestCommitFallsBackToTheOnlyMediaAssets(t *testing.T) {
	store := testStore(t)
	project := createTestProject(t, store)
	ctx := context.Background()
	cover := stage(t, store, project.ID, "cover.png", "image bytes")
	track := stage(t, store, project.ID, "track.ogg", "music bytes")
	manifest := []AssetMapping{
		{Name: cover.Name, Hash: cover.Hash},
		{Name: track.Name, Hash: track.Hash},
	}
	committed, err := store.CommitProject(ctx, CommitProjectInput{
		ProjectID: project.ID,
		Chart:     testChart("fallback"),
		Assets:    &manifest,
	})
	if err != nil {
		t.Fatalf("commit: %v", err)
	}
	if committed.Background != "cover.png" {
		t.Fatalf("background = %q, want cover.png", committed.Background)
	}
	if committed.Song != "track.ogg" {
		t.Fatalf("song = %q, want track.ogg", committed.Song)
	}
}

func TestListProjectsSortsByRequestedField(t *testing.T) {
	store := testStore(t)
	ctx := context.Background()
	create := func(name, composer, charter, created, updated string) {
		t.Helper()
		project, err := store.CreateProject(ctx, CreateProjectInput{
			Name:  name,
			Chart: json.RawMessage(`{"META":{"name":"` + name + `","composer":"` + composer + `","charter":"` + charter + `"},"judgeLineList":[]}`),
		})
		if err != nil {
			t.Fatalf("create %s: %v", name, err)
		}
		if _, err := store.db.Exec(
			`UPDATE projects SET created_at = ?, updated_at = ? WHERE id = ?`,
			created, updated, project.ID,
		); err != nil {
			t.Fatalf("stamp %s: %v", name, err)
		}
	}
	create("Alpha", "Zed", "Mia", "2026-01-01T00:00:00Z", "2026-01-03T00:00:00Z")
	create("Beta", "Amy", "Zoe", "2026-01-03T00:00:00Z", "2026-01-01T00:00:00Z")
	create("Gamma", "Mia", "Amy", "2026-01-02T00:00:00Z", "2026-01-02T00:00:00Z")

	names := func(sort, direction string) []string {
		t.Helper()
		projects, _, err := store.ListProjects(ctx, ListProjectsInput{Sort: sort, Direction: direction})
		if err != nil {
			t.Fatalf("list %s %s: %v", sort, direction, err)
		}
		out := make([]string, len(projects))
		for index, project := range projects {
			out[index] = project.Name
		}
		return out
	}

	if got := names("updated", "desc"); !reflect.DeepEqual(got, []string{"Alpha", "Gamma", "Beta"}) {
		t.Fatalf("updated desc = %#v", got)
	}
	if got := names("created", "desc"); !reflect.DeepEqual(got, []string{"Beta", "Gamma", "Alpha"}) {
		t.Fatalf("created desc = %#v", got)
	}
	if got := names("name", "asc"); !reflect.DeepEqual(got, []string{"Alpha", "Beta", "Gamma"}) {
		t.Fatalf("name asc = %#v", got)
	}
	if got := names("composer", "asc"); !reflect.DeepEqual(got, []string{"Beta", "Gamma", "Alpha"}) {
		t.Fatalf("composer asc = %#v", got)
	}
	if got := names("charter", "asc"); !reflect.DeepEqual(got, []string{"Gamma", "Alpha", "Beta"}) {
		t.Fatalf("charter asc = %#v", got)
	}
}

func TestCommitRejectsStaleRevision(t *testing.T) {
	store := testStore(t)
	project := createTestProject(t, store)
	ctx := context.Background()
	base := project.Revision + 1
	_, err := store.CommitProject(ctx, CommitProjectInput{
		ProjectID:    project.ID,
		BaseRevision: &base,
		Chart:        testChart("stale"),
	})
	var conflict *RevisionConflictError
	if !errors.As(err, &conflict) {
		t.Fatalf("error = %v, want RevisionConflictError", err)
	}
	if conflict.CurrentRevision != project.Revision {
		t.Fatalf("current revision = %d, want %d", conflict.CurrentRevision, project.Revision)
	}
}

func TestDuplicateAndDeleteKeepTheBlobStoreConsistent(t *testing.T) {
	store := testStore(t)
	project := createTestProject(t, store)
	ctx := context.Background()
	asset := stage(t, store, project.ID, "song.mp3", "music bytes")
	manifest := []AssetMapping{{Name: asset.Name, Hash: asset.Hash}}
	updated, err := store.CommitProject(ctx, CommitProjectInput{
		ProjectID: project.ID,
		Chart:     testChart("song"),
		Assets:    &manifest,
		Snapshot:  true,
		Label:     "snapshot",
	})
	if err != nil {
		t.Fatalf("commit: %v", err)
	}

	copyProject, err := store.DuplicateProject(ctx, project.ID, "copy")
	if err != nil {
		t.Fatalf("duplicate: %v", err)
	}
	copied, err := store.ListProjectAssets(ctx, copyProject.ID)
	if err != nil || len(copied) != 1 || copied[0].Hash != asset.Hash {
		t.Fatalf("copied assets = %#v, err = %v", copied, err)
	}
	if copyProject.Revision != 1 {
		t.Fatalf("copy revision = %d, want 1", copyProject.Revision)
	}

	if err := store.DeleteProject(ctx, copyProject.ID); err != nil {
		t.Fatalf("delete copy: %v", err)
	}
	// The original project and its revision still reference the blob.
	var blobs int
	if err := store.db.QueryRow(`SELECT COUNT(*) FROM assets`).Scan(&blobs); err != nil {
		t.Fatal(err)
	}
	if blobs != 1 {
		t.Fatalf("blobs after copy delete = %d, want 1", blobs)
	}

	if err := store.DeleteProject(ctx, updated.ID); err != nil {
		t.Fatalf("delete original: %v", err)
	}
	if err := store.db.QueryRow(`SELECT COUNT(*) FROM assets`).Scan(&blobs); err != nil {
		t.Fatal(err)
	}
	if blobs != 0 {
		t.Fatalf("blobs after deleting both projects = %d, want 0", blobs)
	}
}
