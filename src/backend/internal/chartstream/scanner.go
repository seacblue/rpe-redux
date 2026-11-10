// Scanner for RPE chart JSON. It finds the top-level `judgeLineList` element
// byte ranges and keeps every other top-level value raw, so the caller can build
// a header and a line index without constructing the full chart object graph.

package chartstream

import (
	"bytes"
	"encoding/json"
	"fmt"
)

// Range is a half-open byte range inside a chart source.
type Range struct {
	Start int
	End   int
}

// Scan holds the top-level header values and line ranges read from one source.
type Scan struct {
	// Text is the complete source; ranges index into it.
	Text []byte
	// HeaderRaw holds every top-level value except `judgeLineList`, verbatim.
	HeaderRaw map[string]json.RawMessage
	// KeyOrder records the top-level keys in source order, including duplicates.
	KeyOrder []string
	// LineRanges holds the byte range of every `judgeLineList` element.
	LineRanges []Range
}

// SkipWhitespace returns the next non-whitespace byte index at or after start.
func SkipWhitespace(text []byte, start int) int {
	index := start
	for index < len(text) {
		switch text[index] {
		case ' ', '\t', '\n', '\r':
			index++
		default:
			return index
		}
	}
	return index
}

// charAt returns one byte, or zero at the end of the source.
func charAt(text []byte, index int) byte {
	if index < 0 || index >= len(text) {
		return 0
	}
	return text[index]
}

// expect requires one punctuation byte and returns the index after it.
func expect(text []byte, index int, character byte) (int, error) {
	if charAt(text, index) != character {
		return 0, fmt.Errorf("expected %q at byte %d", character, index)
	}
	return index + 1, nil
}

// scanString returns the index after a JSON string's closing quote.
func scanString(text []byte, start int) (int, error) {
	index := start + 1
	for index < len(text) {
		switch text[index] {
		case '"':
			return index + 1, nil
		case '\\':
			// Skip the escaped character; `\u` hex digits are ordinary bytes
			// for the scanner and are validated by json.Valid later.
			index += 2
		default:
			index++
		}
	}
	return 0, fmt.Errorf("unterminated JSON string at byte %d", start)
}

// scanNumber returns the index after the last numeric character.
func scanNumber(text []byte, start int) (int, error) {
	index := start
	for index < len(text) {
		code := text[index]
		numeric := (code >= '0' && code <= '9') || code == '-' || code == '+' ||
			code == '.' || code == 'E' || code == 'e'
		if !numeric {
			break
		}
		index++
	}
	if index == start {
		return 0, fmt.Errorf("expected a JSON number at byte %d", start)
	}
	return index, nil
}

// scanValue returns the index after one complete JSON value.
func scanValue(text []byte, start int) (int, error) {
	index := SkipWhitespace(text, start)
	if index >= len(text) {
		return 0, fmt.Errorf("expected a JSON value at byte %d", index)
	}
	switch text[index] {
	case '"':
		return scanString(text, index)
	case '{':
		return scanObject(text, index)
	case '[':
		return scanArray(text, index, nil)
	case '-':
		return scanNumber(text, index)
	}
	if text[index] >= '0' && text[index] <= '9' {
		return scanNumber(text, index)
	}
	switch {
	case bytes.HasPrefix(text[index:], []byte("true")):
		return index + 4, nil
	case bytes.HasPrefix(text[index:], []byte("false")):
		return index + 5, nil
	case bytes.HasPrefix(text[index:], []byte("null")):
		return index + 4, nil
	}
	return 0, fmt.Errorf("expected a JSON value at byte %d", index)
}

// scanObject returns the index after an object, validating punctuation.
func scanObject(text []byte, start int) (int, error) {
	index, err := expect(text, start, '{')
	if err != nil {
		return 0, err
	}
	index = SkipWhitespace(text, index)
	if charAt(text, index) == '}' {
		return index + 1, nil
	}
	for index < len(text) {
		index = SkipWhitespace(text, index)
		if charAt(text, index) != '"' {
			return 0, fmt.Errorf("expected an object key at byte %d", index)
		}
		index, err = scanString(text, index)
		if err != nil {
			return 0, err
		}
		index, err = expect(text, SkipWhitespace(text, index), ':')
		if err != nil {
			return 0, err
		}
		index, err = scanValue(text, index)
		if err != nil {
			return 0, err
		}
		index = SkipWhitespace(text, index)
		if charAt(text, index) == ',' {
			index = SkipWhitespace(text, index+1)
			continue
		}
		return expect(text, index, '}')
	}
	return 0, fmt.Errorf("unterminated JSON object at byte %d", start)
}

// scanArray returns the index after an array, recording element ranges when
// ranges is non-nil.
func scanArray(text []byte, start int, ranges *[]Range) (int, error) {
	index, err := expect(text, start, '[')
	if err != nil {
		return 0, err
	}
	index = SkipWhitespace(text, index)
	if charAt(text, index) == ']' {
		return index + 1, nil
	}
	for index < len(text) {
		elementStart := index
		index, err = scanValue(text, index)
		if err != nil {
			return 0, err
		}
		if ranges != nil {
			*ranges = append(*ranges, Range{Start: elementStart, End: index})
		}
		index = SkipWhitespace(text, index)
		if charAt(text, index) == ',' {
			index = SkipWhitespace(text, index+1)
			continue
		}
		return expect(text, index, ']')
	}
	return 0, fmt.Errorf("unterminated JSON array at byte %d", start)
}

// scanLineArray scans the `judgeLineList` array and records element ranges.
func scanLineArray(text []byte, start int) (int, []Range, error) {
	ranges := make([]Range, 0)
	index, err := scanArray(text, start, &ranges)
	if err != nil {
		return 0, nil, err
	}
	return index, ranges, nil
}

// decodeJSONString decodes a raw JSON string token.
func decodeJSONString(raw []byte) (string, error) {
	var value string
	if err := json.Unmarshal(raw, &value); err != nil {
		return "", fmt.Errorf("invalid JSON string: %w", err)
	}
	return value, nil
}

// ScanChartJSON scans one chart object into header values and line ranges.
//
// The scanner accepts any top-level key order, including `judgeLineList` before
// `META`. A UTF-8 byte-order mark at the start is ignored without shifting the
// byte offsets that point into Text.
func ScanChartJSON(text []byte) (*Scan, error) {
	scan := &Scan{
		Text:      text,
		HeaderRaw: make(map[string]json.RawMessage),
	}
	index := 0
	if len(text) >= 3 && text[0] == 0xEF && text[1] == 0xBB && text[2] == 0xBF {
		index = 3
	}
	index = SkipWhitespace(text, index)
	index, err := expect(text, index, '{')
	if err != nil {
		return nil, fmt.Errorf("chart must be a JSON object: %w", err)
	}
	index = SkipWhitespace(text, index)
	if charAt(text, index) == '}' {
		index++
	} else {
		for index < len(text) {
			keyStart := index
			if charAt(text, keyStart) != '"' {
				return nil, fmt.Errorf("expected a top-level key at byte %d", keyStart)
			}
			keyEnd, err := scanString(text, keyStart)
			if err != nil {
				return nil, err
			}
			key, err := decodeJSONString(text[keyStart:keyEnd])
			if err != nil {
				return nil, err
			}
			index, err = expect(text, SkipWhitespace(text, keyEnd), ':')
			if err != nil {
				return nil, err
			}
			index = SkipWhitespace(text, index)
			if key == "judgeLineList" {
				next, ranges, err := scanLineArray(text, index)
				if err != nil {
					return nil, err
				}
				scan.LineRanges = append(scan.LineRanges, ranges...)
				index = next
			} else {
				valueStart := index
				valueEnd, err := scanValue(text, valueStart)
				if err != nil {
					return nil, err
				}
				raw := text[valueStart:valueEnd]
				if !json.Valid(raw) {
					return nil, fmt.Errorf("invalid JSON value for %q", key)
				}
				scan.HeaderRaw[key] = append(json.RawMessage(nil), raw...)
				index = valueEnd
			}
			scan.KeyOrder = append(scan.KeyOrder, key)
			index = SkipWhitespace(text, index)
			if charAt(text, index) == ',' {
				index = SkipWhitespace(text, index+1)
				continue
			}
			index, err = expect(text, index, '}')
			if err != nil {
				return nil, err
			}
			break
		}
	}
	if SkipWhitespace(text, index) != len(text) {
		return nil, fmt.Errorf("trailing content after chart JSON")
	}
	return scan, nil
}

// ScanArrayRanges scans one top-level JSON array into element byte ranges.
func ScanArrayRanges(text []byte) ([]Range, error) {
	ranges := make([]Range, 0)
	index := SkipWhitespace(text, 0)
	index, err := scanArray(text, index, &ranges)
	if err != nil {
		return nil, err
	}
	if SkipWhitespace(text, index) != len(text) {
		return nil, fmt.Errorf("trailing content after JSON array")
	}
	return ranges, nil
}

// isJSONObject reports whether raw is a JSON object token.
func isJSONObject(raw json.RawMessage) bool {
	trimmed := bytes.TrimSpace(raw)
	return len(trimmed) >= 2 && trimmed[0] == '{' && trimmed[len(trimmed)-1] == '}' && json.Valid(trimmed)
}

// isJSONArray reports whether raw is a JSON array token.
func isJSONArray(raw json.RawMessage) bool {
	trimmed := bytes.TrimSpace(raw)
	return len(trimmed) >= 2 && trimmed[0] == '[' && trimmed[len(trimmed)-1] == ']' && json.Valid(trimmed)
}

// HeaderValues parses every top-level value for digesting. The line list is
// replaced with an empty array so the header digest is independent of lines.
func (s *Scan) HeaderValues() (map[string]any, error) {
	values := make(map[string]any, len(s.HeaderRaw)+1)
	for key, raw := range s.HeaderRaw {
		var value any
		if err := json.Unmarshal(raw, &value); err != nil {
			return nil, fmt.Errorf("parse %q: %w", key, err)
		}
		values[key] = value
	}
	values["judgeLineList"] = []any{}
	return values, nil
}
