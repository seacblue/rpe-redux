// Content-addressed object storage with an encoding header. Objects are
// immutable; a writer never replaces a valid object.
package librarybackup

import (
	"bytes"
	"compress/gzip"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

const objectHeaderSize = 16

// objectKind selects the directory and the diagnostic type byte.
type objectKind struct {
	dir  string
	code byte
}

var (
	kindAsset       = objectKind{dir: "objects", code: 0}
	kindChart       = objectKind{dir: "objects", code: 1}
	kindCommit      = objectKind{dir: "commits", code: 2}
	kindProject     = objectKind{dir: "objects", code: 3}
	kindRevisions   = objectKind{dir: "objects", code: 4}
	kindPreferences = objectKind{dir: "objects", code: 5}
	kindTree        = objectKind{dir: "objects", code: 6}
)

// objectStore owns the objects/, commits/, refs/, and tmp/ directories.
type objectStore struct {
	root string
}

func newObjectStore(root string) (*objectStore, error) {
	for _, name := range []string{"objects", "commits", "refs", "tmp"} {
		if err := os.MkdirAll(filepath.Join(root, name), 0o755); err != nil {
			return nil, fmt.Errorf("create backup directory %s: %w", name, err)
		}
	}
	return &objectStore{root: root}, nil
}

func (s *objectStore) objectPath(kind objectKind, hash string) string {
	return filepath.Join(s.root, kind.dir, hash)
}

func (s *objectStore) refPath(generation int64) string {
	return filepath.Join(s.root, "refs", fmt.Sprintf("%012d.json", generation))
}

func hashBytes(data []byte) string {
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}

// write stores raw bytes and returns their reference. An existing object wins;
// its actual encoding is reported so the commit never disagrees with the file.
func (s *objectStore) write(kind objectKind, raw []byte) (ObjectRef, error) {
	hash := hashBytes(raw)
	path := s.objectPath(kind, hash)
	if ref, ok := readExisting(path, hash); ok {
		return ref, nil
	}

	payload := raw
	encoding := EncodingRaw
	if compressed, ok := compress(raw); ok {
		payload = compressed
		encoding = EncodingGzip
	}
	header := make([]byte, objectHeaderSize)
	copy(header[0:4], ObjectMagic)
	header[4] = ObjectVersion
	if encoding == EncodingGzip {
		header[5] = 1
	}
	header[6] = kind.code
	binary.BigEndian.PutUint64(header[8:16], uint64(len(raw)))

	temporary, err := os.CreateTemp(filepath.Join(s.root, "tmp"), "object-*")
	if err != nil {
		return ObjectRef{}, fmt.Errorf("create object temporary file: %w", err)
	}
	temporaryName := temporary.Name()
	defer func() {
		_ = temporary.Close()
		_ = os.Remove(temporaryName)
	}()
	if _, err := temporary.Write(header); err != nil {
		return ObjectRef{}, fmt.Errorf("write object header: %w", err)
	}
	if _, err := temporary.Write(payload); err != nil {
		return ObjectRef{}, fmt.Errorf("write object payload: %w", err)
	}
	if err := temporary.Sync(); err != nil {
		return ObjectRef{}, fmt.Errorf("flush object: %w", err)
	}
	if err := temporary.Close(); err != nil {
		return ObjectRef{}, fmt.Errorf("close object: %w", err)
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return ObjectRef{}, fmt.Errorf("create object directory: %w", err)
	}
	if existing, ok := readExisting(path, hash); ok {
		return existing, nil
	}
	_ = os.Remove(path)
	if err := os.Rename(temporaryName, path); err != nil {
		return ObjectRef{}, fmt.Errorf("publish object: %w", err)
	}
	return ObjectRef{
		Hash:       hash,
		Encoding:   encoding,
		Size:       int64(len(raw)),
		StoredSize: int64(objectHeaderSize + len(payload)),
	}, nil
}

// read decodes one object and verifies its length and content hash.
func (s *objectStore) read(kind objectKind, ref ObjectRef) ([]byte, error) {
	if ref.Hash == "" {
		return nil, errors.New("object reference has no hash")
	}
	path := s.objectPath(kind, ref.Hash)
	file, err := os.Open(path)
	if err != nil {
		return nil, fmt.Errorf("open object %s: %w", ref.Hash, err)
	}
	defer file.Close()
	header := make([]byte, objectHeaderSize)
	if _, err := io.ReadFull(file, header); err != nil {
		return nil, fmt.Errorf("read object header %s: %w", ref.Hash, err)
	}
	if string(header[0:4]) != ObjectMagic || header[4] != ObjectVersion {
		return nil, fmt.Errorf("object %s has an invalid header", ref.Hash)
	}
	rawSize := binary.BigEndian.Uint64(header[8:16])
	payload, err := io.ReadAll(file)
	if err != nil {
		return nil, fmt.Errorf("read object %s: %w", ref.Hash, err)
	}
	raw := payload
	if header[5] == 1 {
		reader, err := gzip.NewReader(bytes.NewReader(payload))
		if err != nil {
			return nil, fmt.Errorf("open compressed object %s: %w", ref.Hash, err)
		}
		raw, err = io.ReadAll(reader)
		_ = reader.Close()
		if err != nil {
			return nil, fmt.Errorf("decompress object %s: %w", ref.Hash, err)
		}
	} else if header[5] != 0 {
		return nil, fmt.Errorf("object %s has an unknown encoding", ref.Hash)
	}
	if uint64(len(raw)) != rawSize {
		return nil, fmt.Errorf("object %s size is %d, header says %d", ref.Hash, len(raw), rawSize)
	}
	if hashBytes(raw) != ref.Hash {
		return nil, fmt.Errorf("object %s failed its content hash", ref.Hash)
	}
	return raw, nil
}

func (s *objectStore) has(kind objectKind, hash string) bool {
	_, err := os.Stat(s.objectPath(kind, hash))
	return err == nil
}

func (s *objectStore) list(kind objectKind) ([]string, error) {
	entries, err := os.ReadDir(filepath.Join(s.root, kind.dir))
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}
	names := make([]string, 0, len(entries))
	for _, entry := range entries {
		if !entry.IsDir() {
			names = append(names, entry.Name())
		}
	}
	sort.Strings(names)
	return names, nil
}

func (s *objectStore) delete(kind objectKind, hash string) error {
	if !validObjectName(hash) {
		return fmt.Errorf("invalid object name %q", hash)
	}
	err := os.Remove(s.objectPath(kind, hash))
	if os.IsNotExist(err) {
		return nil
	}
	return err
}

func readExisting(path, hash string) (ObjectRef, bool) {
	file, err := os.Open(path)
	if err != nil {
		return ObjectRef{}, false
	}
	defer file.Close()
	header := make([]byte, objectHeaderSize)
	if _, err := io.ReadFull(file, header); err != nil {
		return ObjectRef{}, false
	}
	if string(header[0:4]) != ObjectMagic || header[4] != ObjectVersion {
		return ObjectRef{}, false
	}
	encoding := EncodingRaw
	if header[5] == 1 {
		encoding = EncodingGzip
	} else if header[5] != 0 {
		return ObjectRef{}, false
	}
	stat, err := file.Stat()
	if err != nil {
		return ObjectRef{}, false
	}
	rawSize := binary.BigEndian.Uint64(header[8:16])
	return ObjectRef{
		Hash:       hash,
		Encoding:   encoding,
		Size:       int64(rawSize),
		StoredSize: stat.Size(),
	}, true
}

func compress(raw []byte) ([]byte, bool) {
	if len(raw) == 0 {
		return raw, false
	}
	var buffer bytes.Buffer
	writer, err := gzip.NewWriterLevel(&buffer, gzip.BestSpeed)
	if err != nil {
		return raw, false
	}
	if _, err := writer.Write(raw); err != nil {
		return raw, false
	}
	if err := writer.Close(); err != nil {
		return raw, false
	}
	if buffer.Len() >= len(raw) {
		return raw, false
	}
	return buffer.Bytes(), true
}

func validObjectName(name string) bool {
	if len(name) != 64 {
		return false
	}
	for _, character := range name {
		if (character < '0' || character > '9') && (character < 'a' || character > 'f') {
			return false
		}
	}
	return true
}

// writeJSON marshals one logical object and stores it under its format kind.
func (s *objectStore) writeJSON(kind objectKind, value any) (ObjectRef, []byte, error) {
	raw, err := jsonMarshal(value)
	if err != nil {
		return ObjectRef{}, nil, err
	}
	ref, err := s.write(kind, raw)
	return ref, raw, err
}

// jsonMarshal keeps one serializer so two calls with the same value produce the
// same bytes and therefore the same object id.
func jsonMarshal(value any) ([]byte, error) {
	return json.Marshal(value)
}

// objectCounts returns the number and total bytes of content objects and
// commits.
func (s *objectStore) objectCounts() (int, int64) {
	var count int
	var bytesTotal int64
	for _, kind := range []objectKind{kindAsset, kindCommit} {
		entries, err := os.ReadDir(filepath.Join(s.root, kind.dir))
		if err != nil {
			continue
		}
		for _, entry := range entries {
			if entry.IsDir() {
				continue
			}
			info, err := entry.Info()
			if err != nil {
				continue
			}
			count++
			bytesTotal += info.Size()
		}
	}
	return count, bytesTotal
}

// cleanTemp removes stale temporary files. It runs under the writer lock.
func (s *objectStore) cleanTemp() {
	entries, err := os.ReadDir(filepath.Join(s.root, "tmp"))
	if err != nil {
		return
	}
	for _, entry := range entries {
		if !entry.IsDir() && strings.HasPrefix(entry.Name(), "object-") {
			_ = os.Remove(filepath.Join(s.root, "tmp", entry.Name()))
		}
	}
}
