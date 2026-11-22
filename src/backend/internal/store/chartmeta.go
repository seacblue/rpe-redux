// Byte-level chart metadata scanner for the SQLite library.
//
// The library keeps only a few searchable fields plus two totals, so it must not
// build a chart object graph: decoding a 47 MiB chart into `map[string]any`
// costs seconds and hundreds of megabytes for counts that one linear pass over
// the bytes produces. The scanner walks the source once, keeps the raw header
// values it needs, and counts notes and events on every judge line without
// materialising them.

package store

import (
	"bytes"
	"encoding/json"
	"fmt"
)

// eventLayerKeys are the event arrays a judge line can carry. The five ordinary
// tracks live on each `eventLayers` entry; the extended tracks live on the
// line's own `extended` object, which is why both containers are walked.
var eventLayerKeys = map[string]bool{
	"moveXEvents":   true,
	"moveYEvents":   true,
	"rotateEvents":  true,
	"alphaEvents":   true,
	"speedEvents":   true,
	"scaleXEvents":  true,
	"scaleYEvents":  true,
	"colorEvents":   true,
	"paintEvents":   true,
	"textEvents":    true,
	"inclineEvents": true,
	"gifEvents":     true,
}

// scanner walks chart JSON without decoding values it does not need.
type scanner struct {
	text []byte
	pos  int
}

// skipSpace advances past JSON whitespace.
func (s *scanner) skipSpace() {
	for s.pos < len(s.text) {
		switch s.text[s.pos] {
		case ' ', '\t', '\n', '\r':
			s.pos++
		default:
			return
		}
	}
}

// peek returns the next non-space byte, or zero at the end of the source.
func (s *scanner) peek() byte {
	s.skipSpace()
	if s.pos >= len(s.text) {
		return 0
	}
	return s.text[s.pos]
}

// expect consumes one punctuation byte.
func (s *scanner) expect(character byte) error {
	if s.peek() != character {
		return fmt.Errorf("expected %q at byte %d", character, s.pos)
	}
	s.pos++
	return nil
}

// rawString captures one JSON string token verbatim, including its quotes.
func (s *scanner) rawString() ([]byte, error) {
	s.skipSpace()
	start := s.pos
	if start >= len(s.text) || s.text[start] != '"' {
		return nil, fmt.Errorf("expected a string at byte %d", start)
	}
	s.pos++
	for s.pos < len(s.text) {
		switch s.text[s.pos] {
		case '\\':
			s.pos += 2
		case '"':
			s.pos++
			return s.text[start:s.pos], nil
		default:
			s.pos++
		}
	}
	return nil, fmt.Errorf("unterminated string at byte %d", start)
}

// rawValue captures one complete JSON value verbatim.
func (s *scanner) rawValue() ([]byte, error) {
	s.skipSpace()
	start := s.pos
	if err := s.skipValue(); err != nil {
		return nil, err
	}
	return s.text[start:s.pos], nil
}

// skipValue advances past one complete JSON value without capturing it.
func (s *scanner) skipValue() error {
	switch s.peek() {
	case 0:
		return fmt.Errorf("unexpected end of chart JSON at byte %d", s.pos)
	case '"':
		_, err := s.rawString()
		return err
	case '{':
		return s.skipObject()
	case '[':
		return s.skipArray()
	default:
		return s.skipPrimitive()
	}
}

// skipPrimitive advances past a number, `true`, `false`, or `null`.
func (s *scanner) skipPrimitive() error {
	start := s.pos
	s.skipSpace()
	for s.pos < len(s.text) {
		switch s.text[s.pos] {
		case ',', '}', ']', ' ', '\t', '\n', '\r':
			if s.pos == start {
				return fmt.Errorf("expected a JSON value at byte %d", start)
			}
			return nil
		default:
			s.pos++
		}
	}
	if s.pos == start {
		return fmt.Errorf("expected a JSON value at byte %d", start)
	}
	return nil
}

// skipObject advances past one JSON object without capturing any member.
func (s *scanner) skipObject() error {
	if err := s.expect('{'); err != nil {
		return err
	}
	if s.peek() == '}' {
		s.pos++
		return nil
	}
	for {
		if _, err := s.rawString(); err != nil {
			return err
		}
		if err := s.expect(':'); err != nil {
			return err
		}
		if err := s.skipValue(); err != nil {
			return err
		}
		switch s.peek() {
		case ',':
			s.pos++
		case '}':
			s.pos++
			return nil
		default:
			return fmt.Errorf("expected ',' or '}' at byte %d", s.pos)
		}
	}
}

// skipArray advances past one JSON array without capturing any element.
func (s *scanner) skipArray() error {
	if err := s.expect('['); err != nil {
		return err
	}
	if s.peek() == ']' {
		s.pos++
		return nil
	}
	for {
		if err := s.skipValue(); err != nil {
			return err
		}
		switch s.peek() {
		case ',':
			s.pos++
		case ']':
			s.pos++
			return nil
		default:
			return fmt.Errorf("expected ',' or ']' at byte %d", s.pos)
		}
	}
}

// countArrayElements counts one array's direct elements.
func (s *scanner) countArrayElements() (int, error) {
	if err := s.expect('['); err != nil {
		return 0, err
	}
	if s.peek() == ']' {
		s.pos++
		return 0, nil
	}
	count := 0
	for {
		if err := s.skipValue(); err != nil {
			return 0, err
		}
		count++
		switch s.peek() {
		case ',':
			s.pos++
		case ']':
			s.pos++
			return count, nil
		default:
			return 0, fmt.Errorf("expected ',' or ']' at byte %d", s.pos)
		}
	}
}

// countEventTracks adds one layer object's known event arrays to tracks.
func (s *scanner) countEventTracks(tracks *int) error {
	if err := s.expect('{'); err != nil {
		return err
	}
	if s.peek() == '}' {
		s.pos++
		return nil
	}
	for {
		raw, err := s.rawString()
		if err != nil {
			return err
		}
		if err := s.expect(':'); err != nil {
			return err
		}
		if key, ok := decodeKey(raw); ok && eventLayerKeys[key] {
			count, err := s.countArrayElements()
			if err != nil {
				return err
			}
			*tracks += count
		} else if err := s.skipValue(); err != nil {
			return err
		}
		switch s.peek() {
		case ',':
			s.pos++
		case '}':
			s.pos++
			return nil
		default:
			return fmt.Errorf("expected ',' or '}' at byte %d", s.pos)
		}
	}
}

// scanLayerArray adds every `eventLayers` entry's tracks to counts.
func (s *scanner) scanLayerArray(counts *scanCounts) error {
	if err := s.expect('['); err != nil {
		return err
	}
	if s.peek() == ']' {
		s.pos++
		return nil
	}
	for {
		if s.peek() == '{' {
			if err := s.countEventTracks(&counts.events); err != nil {
				return err
			}
		} else if err := s.skipValue(); err != nil {
			return err
		}
		switch s.peek() {
		case ',':
			s.pos++
		case ']':
			s.pos++
			return nil
		default:
			return fmt.Errorf("expected ',' or ']' at byte %d", s.pos)
		}
	}
}

// decodeKey decodes one JSON object key token.
func decodeKey(raw []byte) (string, bool) {
	var key string
	if err := json.Unmarshal(raw, &key); err != nil {
		return "", false
	}
	return key, true
}

// scanCounts is the one-pass result for a chart source.
type scanCounts struct {
	notes int
	events int
	// sawNotes reports that at least one judge line carried a `notes` array, so
	// the summed total wins over META.numOfNotes.
	sawNotes bool
	meta     map[string]any
}

// scanLine adds one judge line's notes and events to counts.
func (s *scanner) scanLine(counts *scanCounts) error {
	if err := s.expect('{'); err != nil {
		return err
	}
	if s.peek() == '}' {
		s.pos++
		return nil
	}
	for {
		raw, err := s.rawString()
		if err != nil {
			return err
		}
		if err := s.expect(':'); err != nil {
			return err
		}
		key, _ := decodeKey(raw)
		switch {
		case key == "notes":
			if s.peek() != '[' {
				if err := s.skipValue(); err != nil {
					return err
				}
				break
			}
			count, err := s.countArrayElements()
			if err != nil {
				return err
			}
			counts.sawNotes = true
			counts.notes += count
		case key == "eventLayers":
			if s.peek() != '[' {
				if err := s.skipValue(); err != nil {
					return err
				}
				break
			}
			if err := s.scanLayerArray(counts); err != nil {
				return err
			}
		case key == "extended":
			if s.peek() != '{' {
				if err := s.skipValue(); err != nil {
					return err
				}
				break
			}
			if err := s.countEventTracks(&counts.events); err != nil {
				return err
			}
		case eventLayerKeys[key]:
			if s.peek() != '[' {
				if err := s.skipValue(); err != nil {
					return err
				}
				break
			}
			count, err := s.countArrayElements()
			if err != nil {
				return err
			}
			counts.events += count
		default:
			if err := s.skipValue(); err != nil {
				return err
			}
		}
		switch s.peek() {
		case ',':
			s.pos++
		case '}':
			s.pos++
			return nil
		default:
			return fmt.Errorf("expected ',' or '}' at byte %d", s.pos)
		}
	}
}

// scanJudgeLines adds every judge line's counts to state.
func (s *scanner) scanJudgeLines(counts *scanCounts) error {
	if err := s.expect('['); err != nil {
		return err
	}
	if s.peek() == ']' {
		s.pos++
		return nil
	}
	for {
		if s.peek() == '{' {
			if err := s.scanLine(counts); err != nil {
				return err
			}
		} else if err := s.skipValue(); err != nil {
			return err
		}
		switch s.peek() {
		case ',':
			s.pos++
		case ']':
			s.pos++
			return nil
		default:
			return fmt.Errorf("expected ',' or ']' at byte %d", s.pos)
		}
	}
}

// scanChart walks one chart object, collecting stored metadata and counts.
//
// A malformed chart returns an error instead of a partial summary, so a caller
// never persists a count it could not derive.
func scanChart(text []byte) (*scanCounts, error) {
	if bytes.HasPrefix(text, []byte{0xEF, 0xBB, 0xBF}) {
		text = text[3:]
	}
	s := &scanner{text: text}
	if err := s.expect('{'); err != nil {
		return nil, err
	}
	counts := &scanCounts{}
	if s.peek() == '}' {
		return counts, nil
	}
	for {
		raw, err := s.rawString()
		if err != nil {
			return nil, err
		}
		if err := s.expect(':'); err != nil {
			return nil, err
		}
		key, _ := decodeKey(raw)
		switch {
		case key == "META":
			value, err := s.rawValue()
			if err != nil {
				return nil, err
			}
			var meta map[string]any
			if json.Unmarshal(value, &meta) == nil {
				counts.meta = meta
			}
		case key == "judgeLineList" && s.peek() == '[':
			if err := s.scanJudgeLines(counts); err != nil {
				return nil, err
			}
		default:
			if err := s.skipValue(); err != nil {
				return nil, err
			}
		}
		switch s.peek() {
		case ',':
			s.pos++
		case '}':
			return counts, nil
		default:
			return nil, fmt.Errorf("expected ',' or '}' at byte %d", s.pos)
		}
	}
}
