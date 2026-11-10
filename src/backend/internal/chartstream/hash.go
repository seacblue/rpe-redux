// Canonical content hashing shared by whole-chart fingerprints and the streaming
// line index. Editor-only `id` fields are ignored for line content so a clean
// line's digest does not depend on whether it has been materialized yet.
//
// The hash is FNV-1a over a canonical, sorted-key JSON walk. It mirrors the
// TypeScript chart content hash: object keys are ordered by UTF-16 code units,
// strings are hashed as JSON text, numbers use ECMAScript number formatting, and
// arrays fold their length before their elements.

package chartstream

import (
	"encoding/json"
	"fmt"
	"math"
	"sort"
	"strconv"
	"strings"
)

const (
	hashSeed     uint32 = 0x811c9dc5
	hashPrime    uint32 = 0x01000193
	maxHashDepth        = 64
)

// Markers used by the TypeScript hash for values that cannot be represented in
// JSON. Parsed chart values never produce a cycle, but depth limiting is kept
// for parity and hostile input.
const (
	negativeZeroMarker = "\"\\u0000rpe-fingerprint-negative-zero\\u0000\""
	cycleMarker        = "\\u0000rpe-fingerprint-cycle\\u0000"
)

// utf16Units returns the UTF-16 code units of a string.
func utf16Units(value string) []uint16 {
	units := make([]uint16, 0, len(value))
	for _, r := range value {
		if r <= 0xFFFF {
			units = append(units, uint16(r))
			continue
		}
		offset := r - 0x10000
		units = append(units, uint16(0xD800+(offset>>10)), uint16(0xDC00+(offset&0x3FF)))
	}
	return units
}

// hashText folds one string's UTF-16 code units into a running hash.
func hashText(value string, initial uint32) uint32 {
	hash := initial
	for _, r := range value {
		if r <= 0xFFFF {
			hash ^= uint32(r)
			hash *= hashPrime
			continue
		}
		offset := r - 0x10000
		hash ^= uint32(0xD800 + (offset >> 10))
		hash *= hashPrime
		hash ^= uint32(0xDC00 + (offset & 0x3FF))
		hash *= hashPrime
	}
	return hash
}

// hashWord folds one 32-bit word into a running hash, least significant byte
// first.
func hashWord(hash, value uint32) uint32 {
	hash = (hash ^ (value & 0xFF)) * hashPrime
	hash = (hash ^ ((value >> 8) & 0xFF)) * hashPrime
	hash = (hash ^ ((value >> 16) & 0xFF)) * hashPrime
	hash = (hash ^ ((value >> 24) & 0xFF)) * hashPrime
	return hash
}

// compareUTF16 compares two strings by UTF-16 code units, matching JavaScript's
// default string ordering.
func compareUTF16(left, right string) int {
	a, b := utf16Units(left), utf16Units(right)
	length := len(a)
	if len(b) < length {
		length = len(b)
	}
	for index := 0; index < length; index++ {
		if a[index] != b[index] {
			if a[index] < b[index] {
				return -1
			}
			return 1
		}
	}
	switch {
	case len(a) < len(b):
		return -1
	case len(a) > len(b):
		return 1
	default:
		return 0
	}
}

// quoteJSONString encodes a string the way JSON.stringify does: no HTML
// escaping, short escapes for the common control characters, and raw UTF-8 for
// every other rune.
func quoteJSONString(value string) string {
	var builder strings.Builder
	builder.Grow(len(value) + 2)
	builder.WriteByte('"')
	for _, r := range value {
		switch r {
		case '"':
			builder.WriteString(`\"`)
		case '\\':
			builder.WriteString(`\\`)
		case '\b':
			builder.WriteString(`\b`)
		case '\f':
			builder.WriteString(`\f`)
		case '\n':
			builder.WriteString(`\n`)
		case '\r':
			builder.WriteString(`\r`)
		case '\t':
			builder.WriteString(`\t`)
		default:
			if r < 0x20 {
				builder.WriteString(`\u`)
				builder.WriteString(fmt.Sprintf("%04x", r))
				continue
			}
			builder.WriteRune(r)
		}
	}
	builder.WriteByte('"')
	return builder.String()
}

// jsNumberString formats a float the way JSON.stringify does.
func jsNumberString(value float64) string {
	if math.IsNaN(value) || math.IsInf(value, 0) {
		return "null"
	}
	if value == 0 {
		return "0"
	}
	sign := ""
	if value < 0 {
		sign = "-"
		value = -value
	}
	// strconv's shortest scientific form gives the digits and exponent needed
	// by the ECMAScript Number::toString layout rules.
	scientific := strconv.FormatFloat(value, 'e', -1, 64)
	exponentAt := strings.IndexByte(scientific, 'e')
	if exponentAt < 0 {
		return sign + scientific
	}
	mantissa := scientific[:exponentAt]
	exponent, err := strconv.Atoi(scientific[exponentAt+1:])
	if err != nil {
		return sign + scientific
	}
	digits := strings.Replace(mantissa, ".", "", 1)
	digitCount := len(digits)
	decimalPosition := exponent + 1
	switch {
	case digitCount <= decimalPosition && decimalPosition <= 21:
		return sign + digits + strings.Repeat("0", decimalPosition-digitCount)
	case 0 < decimalPosition && decimalPosition <= 21:
		return sign + digits[:decimalPosition] + "." + digits[decimalPosition:]
	case -6 < decimalPosition && decimalPosition <= 0:
		return sign + "0." + strings.Repeat("0", -decimalPosition) + digits
	default:
		exponentPart := strconv.Itoa(decimalPosition - 1)
		if decimalPosition-1 >= 0 {
			exponentPart = "+" + exponentPart
		}
		if digitCount == 1 {
			return sign + digits + "e" + exponentPart
		}
		return sign + digits[:1] + "." + digits[1:] + "e" + exponentPart
	}
}

// numberHash folds one number into a hash using the JSON text JSON.stringify
// would produce.
func numberHash(value float64) uint32 {
	if math.IsNaN(value) || math.IsInf(value, 0) {
		return hashText("null", hashSeed)
	}
	if value == 0 && math.Signbit(value) {
		return hashText(negativeZeroMarker, hashSeed)
	}
	return hashText(jsNumberString(value), hashSeed)
}

// valueHash hashes one decoded JSON value with sorted object keys.
func valueHash(value any, ignoreIDs bool, depth int) uint32 {
	if value == nil {
		return hashText("null", hashSeed)
	}
	switch typed := value.(type) {
	case bool:
		if typed {
			return hashText("true", hashSeed)
		}
		return hashText("false", hashSeed)
	case string:
		return hashText(quoteJSONString(typed), hashSeed)
	case float64:
		return numberHash(typed)
	case float32:
		return numberHash(float64(typed))
	case int:
		return numberHash(float64(typed))
	case int64:
		return numberHash(float64(typed))
	case uint64:
		return numberHash(float64(typed))
	case json.Number:
		parsed, err := typed.Float64()
		if err != nil {
			return hashText("null", hashSeed)
		}
		return numberHash(parsed)
	case []any:
		if depth > maxHashDepth {
			return hashText(cycleMarker, hashSeed)
		}
		hash := hashText("[", hashSeed)
		hash = hashWord(hash, uint32(len(typed)))
		for _, child := range typed {
			hash = hashWord(hash, valueHash(child, ignoreIDs, depth+1))
		}
		return hashText("]", hash)
	case map[string]any:
		if depth > maxHashDepth {
			return hashText(cycleMarker, hashSeed)
		}
		keys := make([]string, 0, len(typed))
		for key := range typed {
			keys = append(keys, key)
		}
		sort.Slice(keys, func(left, right int) bool {
			return compareUTF16(keys[left], keys[right]) < 0
		})
		hash := hashText("{", hashSeed)
		for _, key := range keys {
			if ignoreIDs && key == "id" {
				continue
			}
			hash = hashText(key, hash)
			hash = hashWord(hash, valueHash(typed[key], ignoreIDs, depth+1))
		}
		return hashText("}", hash)
	default:
		return hashText("null", hashSeed)
	}
}

// ContentFingerprint hashes one decoded value as a short opaque digest.
func ContentFingerprint(value any, ignoreIDs bool) string {
	return fmt.Sprintf("%08x", valueHash(value, ignoreIDs, 0))
}

// LineContentFingerprint hashes a line while ignoring editor-only object ids.
func LineContentFingerprint(line any) string {
	return ContentFingerprint(line, true)
}

// HeaderContentFingerprint hashes the chart fields outside `judgeLineList`,
// including `META.id`.
func HeaderContentFingerprint(chart map[string]any) string {
	header := make(map[string]any, len(chart))
	for key, value := range chart {
		if key == "judgeLineList" {
			continue
		}
		header[key] = value
	}
	return ContentFingerprint(header, false)
}

// CombineContentFingerprint combines a header digest and ordered line digests
// into one chart digest.
func CombineContentFingerprint(headerDigest string, lineDigests []string) string {
	parts := make([]string, 0, len(lineDigests)+1)
	parts = append(parts, headerDigest)
	parts = append(parts, lineDigests...)
	return fmt.Sprintf("%08x", hashText(strings.Join(parts, "|"), hashSeed))
}
