// Chart-index cache access for the library store. The index is a rebuildable
// cache keyed by project revision and chart hash; reads never change the chart
// payload, and a stale cache is simply replaced on the next stream request.

package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
)

// ProjectChartState describes the revision and content hash of one project's
// chart without loading the chart payload or the cached index.
type ProjectChartState struct {
	Revision  int
	ChartHash string
	HasIndex  bool
}

// ReadProjectChartState reads the revision, content hash, and cache presence for
// one project.
func (s *Store) ReadProjectChartState(ctx context.Context, id string) (*ProjectChartState, error) {
	var (
		state    ProjectChartState
		hasIndex int
	)
	err := s.db.QueryRowContext(ctx,
		`SELECT revision, chart_hash, chart_index != '' FROM projects WHERE id = ?`, id).
		Scan(&state.Revision, &state.ChartHash, &hasIndex)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("read project chart state: %w", err)
	}
	state.HasIndex = hasIndex != 0
	return &state, nil
}

// ReadProjectChartIndex reads the cached index text for one project.
func (s *Store) ReadProjectChartIndex(ctx context.Context, id string) (string, error) {
	var index string
	err := s.db.QueryRowContext(ctx,
		`SELECT chart_index FROM projects WHERE id = ?`, id).Scan(&index)
	if errors.Is(err, sql.ErrNoRows) {
		return "", ErrNotFound
	}
	if err != nil {
		return "", fmt.Errorf("read project chart index: %w", err)
	}
	return index, nil
}

// ReadProjectChartText loads one project's chart bytes and its cache state.
func (s *Store) ReadProjectChartText(ctx context.Context, id string) ([]byte, *ProjectChartState, error) {
	var (
		chart []byte
		state ProjectChartState
	)
	err := s.db.QueryRowContext(ctx,
		`SELECT revision, chart_hash, chart FROM projects WHERE id = ?`, id).
		Scan(&state.Revision, &state.ChartHash, &chart)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil, ErrNotFound
	}
	if err != nil {
		return nil, nil, fmt.Errorf("read project chart: %w", err)
	}
	return chart, &state, nil
}

// ReadProjectChartSlice reads a byte range of one project's chart without
// materializing the whole TEXT value. Offsets are zero-based byte offsets.
func (s *Store) ReadProjectChartSlice(ctx context.Context, id string, offset, length int64) ([]byte, error) {
	if offset < 0 || length < 0 {
		return nil, errors.New("chart slice offset and length must not be negative")
	}
	var data []byte
	err := s.db.QueryRowContext(ctx,
		`SELECT substr(CAST(chart AS BLOB), ?, ?) FROM projects WHERE id = ?`,
		offset+1, length, id).Scan(&data)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("read chart slice: %w", err)
	}
	return data, nil
}

// SaveProjectChartIndex stores the cache only when the project still carries
// the revision and hash the index was built from. A concurrent commit therefore
// wins and the cache stays stale until the next rebuild.
func (s *Store) SaveProjectChartIndex(
	ctx context.Context,
	id string,
	revision int,
	chartHash string,
	index string,
) error {
	if _, err := s.db.ExecContext(ctx, `
        UPDATE projects SET chart_index = ?
        WHERE id = ? AND revision = ? AND chart_hash = ?`,
		index, id, revision, chartHash); err != nil {
		return fmt.Errorf("save project chart index: %w", err)
	}
	return nil
}
