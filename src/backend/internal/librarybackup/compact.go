// Retention and garbage collection for the snapshot store.
package librarybackup

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
)

// compactLocked keeps the newest commits and deletes unreachable content
// objects. The caller holds s.mu.
func (s *Service) compactLocked(ctx context.Context, policy Policy) (CompactReport, error) {
	report := CompactReport{}
	_, beforeBytes := s.objects.objectCounts()
	report.BeforeBytes = beforeBytes
	report.BeforeCommits = s.commitCount()

	head, err := s.readHead(ctx)
	if err != nil {
		return report, err
	}
	if head == nil {
		return report, nil
	}
	keepCount := policy.KeepCommits
	if keepCount < 1 {
		keepCount = 1
	}
	keep := make(map[string]bool)
	commits := make(map[string]*Commit)
	current := head
	for current != nil && len(keep) < keepCount {
		keep[current.commitID] = true
		commits[current.commitID] = current.commit
		if current.commit.Parent == "" {
			break
		}
		parent, err := s.readCommit(current.commit.Parent)
		if err != nil {
			break
		}
		current = parent
	}

	reachable := make(map[string]bool)
	for id, commit := range commits {
		if err := s.collectCommitObjects(commit, reachable); err != nil {
			return report, fmt.Errorf("inspect commit %s for compaction: %w", id, err)
		}
	}

	// Remove commits outside the retained chain first. A ref that still points
	// at one becomes invalid and is ignored by the next head scan.
	commitNames, err := s.objects.list(kindCommit)
	if err != nil {
		return report, err
	}
	for _, name := range commitNames {
		if !keep[name] {
			if err := s.objects.delete(kindCommit, name); err == nil {
				report.DeletedCommits++
			}
		}
	}
	refs, _ := s.refs()
	for _, ref := range refs {
		if !keep[ref.CommitID] {
			_ = os.Remove(s.objects.refPath(ref.Generation))
		}
	}

	objectNames, err := s.objects.list(kindAsset)
	if err != nil {
		return report, err
	}
	for _, name := range objectNames {
		if !reachable[name] {
			if err := s.objects.delete(kindAsset, name); err == nil {
				report.DeletedObjects++
			}
		}
	}
	_, afterBytes := s.objects.objectCounts()
	report.AfterBytes = afterBytes
	report.AfterCommits = s.commitCount()
	return report, nil
}

// collectCommitObjects adds every object reachable from one commit to the set.
func (s *Service) collectCommitObjects(commit *Commit, reachable map[string]bool) error {
	add := func(ref ObjectRef) {
		if ref.Hash != "" {
			reachable[ref.Hash] = true
		}
	}
	add(commit.Preferences)
	add(commit.Tree)

	treeRaw, err := s.objects.read(kindTree, commit.Tree)
	if err != nil {
		return err
	}
	var tree Tree
	if err := json.Unmarshal(treeRaw, &tree); err != nil {
		return err
	}
	for _, item := range tree.Projects {
		add(item.Manifest)
		manifestRaw, err := s.objects.read(kindProject, item.Manifest)
		if err != nil {
			return err
		}
		var manifest ProjectManifest
		if err := json.Unmarshal(manifestRaw, &manifest); err != nil {
			return err
		}
		add(manifest.Chart)
		for _, asset := range manifest.Assets {
			reachable[asset.Hash] = true
		}
		add(manifest.Revisions)
		revisionsRaw, err := s.objects.read(kindRevisions, manifest.Revisions)
		if err != nil {
			return err
		}
		var revisions RevisionSet
		if err := json.Unmarshal(revisionsRaw, &revisions); err != nil {
			return err
		}
		for _, revision := range revisions.Revisions {
			add(revision.Chart)
			for _, asset := range revision.Assets {
				reachable[asset.Hash] = true
			}
		}
	}
	return nil
}

// verifyCommit walks every object reachable from one commit.
func (s *Service) verifyCommit(commit *Commit, report *VerifyReport) error {
	check := func(kind objectKind, ref ObjectRef) bool {
		if ref.Hash == "" {
			report.Missing = append(report.Missing, "empty object reference")
			return false
		}
		if _, err := s.objects.read(kind, ref); err != nil {
			if os.IsNotExist(err) {
				report.Missing = append(report.Missing, ref.Hash)
			} else {
				report.Corrupt = append(report.Corrupt, ref.Hash)
			}
			return false
		}
		report.CheckedObjects++
		return true
	}
	if !check(kindPreferences, commit.Preferences) {
		return nil
	}
	if !check(kindTree, commit.Tree) {
		return nil
	}
	treeRaw, err := s.objects.read(kindTree, commit.Tree)
	if err != nil {
		return err
	}
	var tree Tree
	if err := json.Unmarshal(treeRaw, &tree); err != nil {
		return err
	}
	for _, item := range tree.Projects {
		if !check(kindProject, item.Manifest) {
			continue
		}
		manifestRaw, err := s.objects.read(kindProject, item.Manifest)
		if err != nil {
			return err
		}
		var manifest ProjectManifest
		if err := json.Unmarshal(manifestRaw, &manifest); err != nil {
			return err
		}
		check(kindChart, manifest.Chart)
		for _, asset := range manifest.Assets {
			check(kindAsset, ObjectRef{Hash: asset.Hash, Encoding: asset.Encoding, Size: asset.Size})
		}
		if !check(kindRevisions, manifest.Revisions) {
			continue
		}
		revisionsRaw, err := s.objects.read(kindRevisions, manifest.Revisions)
		if err != nil {
			return err
		}
		var revisions RevisionSet
		if err := json.Unmarshal(revisionsRaw, &revisions); err != nil {
			return err
		}
		for _, revision := range revisions.Revisions {
			check(kindChart, revision.Chart)
			for _, asset := range revision.Assets {
				check(kindAsset, ObjectRef{Hash: asset.Hash, Encoding: asset.Encoding, Size: asset.Size})
			}
		}
	}
	sort.Strings(report.Missing)
	sort.Strings(report.Corrupt)
	return nil
}

// pruneRefs keeps the newest valid refs up to limit. It is used after a
// compaction or a successful verification.
func (s *Service) pruneRefs(limit int) {
	refs, _ := s.refs()
	sort.Slice(refs, func(left, right int) bool { return refs[left].Generation > refs[right].Generation })
	for index, ref := range refs {
		if index < limit && validRef(ref) {
			continue
		}
		_ = os.Remove(filepath.Join(s.backupDir, "refs", fmt.Sprintf("%012d.json", ref.Generation)))
	}
}
