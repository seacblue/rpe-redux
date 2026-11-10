//! Line-index construction for streaming opens: tempo conversion, per-line
//! summaries, asset names, and the canonical content digest.
//!
//! The hash matches `chartContentHash.ts`: FNV-1a over UTF-16 code units, sorted
//! object keys, and editor-only `id` keys skipped for line content. Header
//! digests include `META.id`.
//!
//! Intentional differences from the TypeScript index:
//! - `byteOffset`/`byteLength`/`totalBytes` count UTF-8 bytes, not UTF-16 code
//!   units, because the Rust host slices the stored byte buffer directly.
//! - The scanner rejects excessive nesting instead of recursing without a
//!   bound.
//! - A number that serde_json cannot represent (for example `1e400`) makes the
//!   line invalid, while JavaScript `JSON.parse` would produce `Infinity` and
//!   hash it as `null`.

use serde::{Serialize, Serializer};
use serde_json::{Map, Value};
use std::cmp::Ordering;

use super::json_scan::ChartJsonScan;
use crate::documents::Result;

/// FNV-1a offset basis.
const HASH_SEED: u32 = 0x811c_9dc5;
/// FNV-1a prime.
const HASH_PRIME: u32 = 0x0100_0193;
/// Charts are shallow; deeper data is malformed or hostile and hashes as a marker.
const MAX_HASH_DEPTH: usize = 64;
/// Marker hashed for a negative zero number, matching the TypeScript source.
const NEGATIVE_ZERO_MARKER: &str = "\"\\u0000rpe-fingerprint-negative-zero\\u0000\"";
/// Marker hashed when the depth guard trips.
const CYCLE_MARKER: &str = "\\u0000rpe-fingerprint-cycle\\u0000";
/// Largest safe integer in JavaScript.
const MAX_SAFE_INTEGER: f64 = 9_007_199_254_740_991.0;

/// Line has no usable shape.
pub(crate) const LINE_FLAG_INVALID: u32 = 1 << 0;
/// The line has no finite end and can affect any later time.
pub(crate) const LINE_FLAG_UNBOUNDED: u32 = 1 << 1;
/// The line has no timed notes or events and is static.
pub(crate) const LINE_FLAG_STATIC: u32 = 1 << 2;
/// The line carries shader paint events.
pub(crate) const LINE_FLAG_SHADER: u32 = 1 << 3;
/// The line carries editor-only noise settings.
pub(crate) const LINE_FLAG_NOISE: u32 = 1 << 4;

/// Event tracks stored on a line, in the shared vocabulary order.
const EVENT_TRACKS: [&str; 12] = [
    "moveXEvents",
    "moveYEvents",
    "rotateEvents",
    "alphaEvents",
    "speedEvents",
    "scaleXEvents",
    "scaleYEvents",
    "colorEvents",
    "paintEvents",
    "textEvents",
    "inclineEvents",
    "gifEvents",
];

/// File suffixes the document host treats as shader resources.
const SHADER_SUFFIXES: [&str; 6] = [".glsl", ".frag", ".vert", ".vsh", ".fsh", ".shader"];

/// One line's index entry; it never contains note or event objects. Intervals
/// are disjoint activity ranges used by paged time windows.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ChartLineSummary {
    index: usize,
    byte_offset: u64,
    byte_length: u64,
    note_count: u64,
    event_count: u64,
    #[serde(serialize_with = "serialize_optional_js_number")]
    start_seconds: Option<f64>,
    #[serde(serialize_with = "serialize_optional_js_number")]
    end_seconds: Option<f64>,
    /// Disjoint activity ranges used by paged time windows.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    intervals: Vec<[f64; 2]>,
    digest: String,
    flags: u32,
    #[serde(serialize_with = "serialize_js_number")]
    group: f64,
    #[serde(serialize_with = "serialize_js_number")]
    father: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    id: Option<String>,
}

/// The complete line index for one chart source.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ChartIndex {
    version: u32,
    header_digest: String,
    lines: Vec<ChartLineSummary>,
    asset_names: Vec<String>,
    total_bytes: u64,
    canonical: bool,
}

impl ChartIndex {
    /// Canonical digest of every top-level field except `judgeLineList`.
    pub(crate) fn header_digest(&self) -> &str {
        &self.header_digest
    }

    /// Ordered line digests used by the combined chart digest.
    pub(crate) fn line_digests(&self) -> Vec<String> {
        self.lines.iter().map(|line| line.digest.clone()).collect()
    }
}

/// Index plus the complete resource-name set used by a streaming open.
pub(crate) struct BuiltIndex {
    pub(crate) index: ChartIndex,
    /// Asset names plus shader paths from the header and line paint events.
    pub(crate) resource_names: Vec<String>,
}

/// One validated tempo point.
#[derive(Clone, Copy)]
struct TempoPoint {
    beat: f64,
    seconds_per_beat: f64,
    seconds: f64,
}

/// Beat/second conversion for a sorted, validated `BPMList`.
pub(crate) struct TempoMap {
    points: Vec<TempoPoint>,
}

impl TempoMap {
    /// Build a tempo map from a header's `BPMList`, defaulting to 120 BPM.
    fn from_header(header: &Map<String, Value>) -> Result<Self> {
        let Some(entries) = header.get("BPMList").and_then(Value::as_array) else {
            return Ok(Self::default_tempo());
        };
        if entries.is_empty() {
            return Ok(Self::default_tempo());
        }
        let mut points = Vec::with_capacity(entries.len());
        for (index, entry) in entries.iter().enumerate() {
            let entry = entry
                .as_object()
                .ok_or_else(|| format!("invalid_bpm_list[{index}]"))?;
            let bpm = entry
                .get("bpm")
                .and_then(Value::as_f64)
                .filter(|value| value.is_finite() && *value > 0.0)
                .ok_or_else(|| format!("invalid_bpm_list[{index}]"))?;
            let beat = entry
                .get("startTime")
                .and_then(beat_tuple)
                .ok_or_else(|| format!("invalid_bpm_start_time[{index}]"))?;
            points.push(TempoPoint {
                beat,
                seconds_per_beat: 60.0 / bpm,
                seconds: 0.0,
            });
        }
        points.sort_by(|left, right| {
            left.beat
                .partial_cmp(&right.beat)
                .unwrap_or(Ordering::Equal)
        });
        let mut previous_beat = 0.0;
        let mut previous_seconds = 0.0;
        let mut previous_rate = points[0].seconds_per_beat;
        for point in &mut points {
            point.seconds = previous_seconds + (point.beat - previous_beat) * previous_rate;
            previous_beat = point.beat;
            previous_seconds = point.seconds;
            previous_rate = point.seconds_per_beat;
        }
        Ok(Self { points })
    }

    /// The fallback tempo used when a chart has no usable `BPMList`.
    fn default_tempo() -> Self {
        Self {
            points: vec![TempoPoint {
                beat: 0.0,
                seconds_per_beat: 0.5,
                seconds: 0.0,
            }],
        }
    }

    /// Chart seconds at `beat`, scaled by a per-line `bpmfactor`.
    fn seconds(&self, beat: f64, factor: f64) -> f64 {
        let rate = check_factor(factor);
        let upper = self.points.partition_point(|point| point.beat <= beat);
        let point = &self.points[upper.saturating_sub(1)];
        (point.seconds + (beat - point.beat) * point.seconds_per_beat) * rate
    }
}

/// A rate outside the playable range is normal speed, not a multiplier.
fn check_factor(factor: f64) -> f64 {
    if !factor.is_finite() || factor.abs() < 0.001 {
        1.0
    } else {
        factor
    }
}

/// Read a beat triple as its numeric value.
fn beat_tuple(value: &Value) -> Option<f64> {
    let parts = value.as_array()?;
    if parts.len() != 3 {
        return None;
    }
    let mut values = [0.0; 3];
    for (index, part) in parts.iter().enumerate() {
        let value = part.as_f64()?;
        if !value.is_finite() || value.fract() != 0.0 || value.abs() > MAX_SAFE_INTEGER {
            return None;
        }
        values[index] = value;
    }
    if values[2] <= 0.0 {
        return None;
    }
    Some(values[0] + values[1] / values[2])
}

/// Build the line index and resource-name set for one scanned chart.
pub(crate) fn build_chart_index(bytes: &[u8], scan: &ChartJsonScan) -> Result<BuiltIndex> {
    let tempo = TempoMap::from_header(&scan.header)?;
    let header_digest = header_content_fingerprint(&scan.header);
    let mut asset_names = Vec::new();
    let mut shader_names = Vec::new();

    if let Some(meta) = scan.header.get("META").and_then(Value::as_object) {
        for field in ["song", "background"] {
            if let Some(name) = meta.get(field).and_then(Value::as_str) {
                asset_names.push(name.to_owned());
            }
        }
        collect_shader_names(meta.get("effects"), &mut shader_names);
    }
    collect_shader_names(scan.header.get("effects"), &mut shader_names);
    collect_shader_names(scan.header.get("shaderEvents"), &mut shader_names);

    let mut lines = Vec::with_capacity(scan.line_ranges.len());
    for (index, range) in scan.line_ranges.iter().enumerate() {
        let line =
            serde_json::from_slice::<Value>(&bytes[range.start..range.end]).unwrap_or(Value::Null);
        collect_asset_names(&line, &mut asset_names);
        collect_line_shader_names(&line, &mut shader_names);
        lines.push(summarize_line(
            &line,
            index,
            &tempo,
            range.start,
            range.len(),
        ));
    }

    asset_names.sort_by(|left, right| js_string_cmp(left, right));
    asset_names.dedup();
    // Resolution uses the same default-name filter as `resource_names` in the
    // document host; the index still reports the full asset list to match TS.
    let mut resource_names = asset_names
        .iter()
        .filter(|name| {
            !name.is_empty()
                && name.as_str() != "line.png"
                && !matches!(name.as_str(), "tap" | "drag" | "flick")
        })
        .cloned()
        .collect::<Vec<_>>();
    resource_names.extend(shader_names);
    resource_names.sort_by(|left, right| js_string_cmp(left, right));
    resource_names.dedup();

    Ok(BuiltIndex {
        index: ChartIndex {
            version: 1,
            header_digest,
            lines,
            asset_names,
            total_bytes: bytes.len() as u64,
            canonical: false,
        },
        resource_names,
    })
}

/// Summarize one line without retaining any note or event object.
fn summarize_line(
    line: &Value,
    index: usize,
    tempo: &TempoMap,
    byte_offset: usize,
    byte_length: usize,
) -> ChartLineSummary {
    let digest = line_content_fingerprint(line);
    let Some(object) = line.as_object() else {
        return ChartLineSummary {
            index,
            byte_offset: byte_offset as u64,
            byte_length: byte_length as u64,
            note_count: 0,
            event_count: 0,
            start_seconds: None,
            end_seconds: None,
            intervals: Vec::new(),
            digest,
            flags: LINE_FLAG_INVALID | LINE_FLAG_UNBOUNDED,
            group: 0.0,
            father: -1.0,
            id: None,
        };
    };

    let factor = line_factor(object);
    let mut bounds = Bounds {
        start: f64::INFINITY,
        end: f64::NEG_INFINITY,
        timed: false,
    };
    let mut intervals: Vec<[f64; 2]> = Vec::new();
    let notes = object.get("notes").and_then(Value::as_array);
    let note_count = notes.map_or(0, |notes| notes.len() as u64);
    if let Some(notes) = notes {
        for note in notes {
            let Some(note) = note.as_object() else {
                continue;
            };
            let start = seconds_of(note.get("startTime"), tempo, factor);
            let end = seconds_of(note.get("endTime"), tempo, factor);
            extend(&mut bounds, start);
            extend(&mut bounds, end);
            let visible_time = match note.get("visibleTime") {
                None | Some(Value::Null) => 999_999.0,
                Some(value) => js_number(value),
            };
            if let Some(start) = start {
                if visible_time.is_finite() {
                    extend(&mut bounds, Some(start - visible_time));
                    add_interval(&mut intervals, Some(start - visible_time), end);
                } else {
                    add_interval(&mut intervals, Some(start), end);
                }
            }
        }
    }

    let mut layers: Vec<&Value> = Vec::new();
    if let Some(event_layers) = object.get("eventLayers").and_then(Value::as_array) {
        layers.extend(event_layers.iter());
    }
    if let Some(extended) = object.get("extended") {
        layers.push(extended);
    }

    let mut event_count = 0u64;
    let mut has_shader = false;
    let mut has_alpha_events = false;
    let mut last_alpha_end: Option<f64> = None;
    let mut last_alpha_end_value = f64::NAN;
    for layer in layers {
        let Some(layer) = layer.as_object() else {
            continue;
        };
        for track in EVENT_TRACKS {
            let Some(events) = layer.get(track).and_then(Value::as_array) else {
                continue;
            };
            event_count += events.len() as u64;
            if track == "paintEvents" && !events.is_empty() {
                has_shader = true;
            }
            for event in events {
                let Some(event) = event.as_object() else {
                    continue;
                };
                let start = seconds_of(event.get("startTime"), tempo, factor);
                let end = seconds_of(event.get("endTime"), tempo, factor);
                extend(&mut bounds, start);
                extend(&mut bounds, end);
                add_interval(&mut intervals, start, end);
                if track == "alphaEvents" {
                    has_alpha_events = true;
                    if let Some(end) = end {
                        if last_alpha_end.map_or(true, |last| end >= last) {
                            last_alpha_end = Some(end);
                            last_alpha_end_value =
                                event.get("end").map(js_number).unwrap_or(f64::NAN);
                        }
                    }
                }
            }
        }
    }

    let unbounded = !has_alpha_events
        || last_alpha_end.is_none()
        || !last_alpha_end_value.is_finite()
        || last_alpha_end_value > 0.0;
    let mut flags = 0;
    if unbounded {
        flags |= LINE_FLAG_UNBOUNDED;
    }
    if !bounds.timed {
        flags |= LINE_FLAG_STATIC;
    }
    if has_shader {
        flags |= LINE_FLAG_SHADER;
    }
    if object.contains_key("_reduxNoiseLine") {
        flags |= LINE_FLAG_NOISE;
    }
    if unbounded {
        intervals.push([
            last_alpha_end.map_or(0.0, |end| end.max(0.0)),
            MAX_SAFE_INTEGER,
        ]);
    }

    ChartLineSummary {
        index,
        byte_offset: byte_offset as u64,
        byte_length: byte_length as u64,
        note_count,
        event_count,
        start_seconds: if bounds.timed {
            Some(bounds.start.max(0.0))
        } else {
            None
        },
        end_seconds: if unbounded || !bounds.timed {
            None
        } else {
            Some(bounds.start.max(bounds.end))
        },
        intervals: merge_intervals(intervals),
        digest,
        flags,
        group: object
            .get("Group")
            .map(js_number)
            .filter(|value| value.is_finite())
            .unwrap_or(0.0),
        father: match object.get("father") {
            None | Some(Value::Null) => -1.0,
            Some(Value::String(value)) if value.is_empty() => -1.0,
            Some(value) => js_number(value),
        },
        id: object.get("id").and_then(Value::as_str).map(str::to_owned),
    }
}

/// Running time bounds for one line.
struct Bounds {
    start: f64,
    end: f64,
    timed: bool,
}

/// Extend a running time bound with one finite value.
fn extend(bounds: &mut Bounds, seconds: Option<f64>) {
    let Some(seconds) = seconds else {
        return;
    };
    if !seconds.is_finite() {
        return;
    }
    bounds.start = bounds.start.min(seconds);
    bounds.end = bounds.end.max(seconds);
    bounds.timed = true;
}

/// Add one finite activity interval.
fn add_interval(intervals: &mut Vec<[f64; 2]>, start: Option<f64>, end: Option<f64>) {
    let (Some(start), Some(end)) = (start, end) else {
        return;
    };
    if !start.is_finite() || !end.is_finite() {
        return;
    }
    intervals.push([start.max(0.0), start.max(end)]);
}

/// Sort and merge overlapping activity intervals.
fn merge_intervals(mut intervals: Vec<[f64; 2]>) -> Vec<[f64; 2]> {
    if intervals.len() <= 1 {
        return intervals;
    }
    intervals.sort_by(|left, right| {
        left[0]
            .partial_cmp(&right[0])
            .unwrap_or(Ordering::Equal)
            .then_with(|| left[1].partial_cmp(&right[1]).unwrap_or(Ordering::Equal))
    });
    let mut merged: Vec<[f64; 2]> = Vec::with_capacity(intervals.len());
    for interval in intervals {
        if let Some(current) = merged.last_mut() {
            if interval[0] <= current[1] {
                current[1] = current[1].max(interval[1]);
                continue;
            }
        }
        merged.push(interval);
    }
    merged
}

/// Seconds for one beat value, or null when it is malformed.
fn seconds_of(value: Option<&Value>, tempo: &TempoMap, factor: f64) -> Option<f64> {
    let value = value?;
    let beat = match value {
        Value::Array(_) => beat_tuple(value)?,
        _ => js_number(value),
    };
    if !beat.is_finite() {
        return None;
    }
    Some(tempo.seconds(beat, factor))
}

/// Read the line's `bpmfactor` with the tempo map's own fallback rule.
fn line_factor(line: &Map<String, Value>) -> f64 {
    match line.get("bpmfactor") {
        None | Some(Value::Null) => 1.0,
        Some(value) => {
            let value = js_number(value);
            if value.is_finite() && value > 0.0 {
                value
            } else {
                1.0
            }
        }
    }
}

/// Collect asset names from one line without retaining note objects.
fn collect_asset_names(line: &Value, names: &mut Vec<String>) {
    let Some(line) = line.as_object() else {
        return;
    };
    for field in ["Texture", "attachUI"] {
        if let Some(name) = line.get(field).and_then(Value::as_str) {
            names.push(name.to_owned());
        }
    }
    let Some(notes) = line.get("notes").and_then(Value::as_array) else {
        return;
    };
    for note in notes {
        let Some(note) = note.as_object() else {
            continue;
        };
        for field in ["hitSound", "hitsound"] {
            if let Some(name) = note.get(field).and_then(Value::as_str) {
                names.push(name.to_owned());
            }
        }
    }
}

/// Collect shader paths from one effects array.
fn collect_shader_names(effects: Option<&Value>, names: &mut Vec<String>) {
    let Some(effects) = effects.and_then(Value::as_array) else {
        return;
    };
    for effect in effects {
        let Some(effect) = effect.as_object() else {
            continue;
        };
        for field in ["shader", "source", "shaderPath"] {
            let Some(name) = effect.get(field).and_then(Value::as_str) else {
                continue;
            };
            let lower = name.to_ascii_lowercase();
            if SHADER_SUFFIXES.iter().any(|suffix| lower.ends_with(suffix)) {
                names.push(name.to_owned());
            }
        }
    }
}

/// Collect shader paths from one line's extended paint events.
fn collect_line_shader_names(line: &Value, names: &mut Vec<String>) {
    let Some(line) = line.as_object() else {
        return;
    };
    let paint_events = line
        .get("extended")
        .and_then(Value::as_object)
        .and_then(|extended| extended.get("paintEvents"));
    collect_shader_names(paint_events, names);
}

/// Hash a line while ignoring editor-only object ids.
pub(crate) fn line_content_fingerprint(line: &Value) -> String {
    content_fingerprint(line, true)
}

/// Hash the chart fields outside `judgeLineList`, including `META.id`.
pub(crate) fn header_content_fingerprint(header: &Map<String, Value>) -> String {
    content_fingerprint(&Value::Object(header.clone()), false)
}

/// Combine a header digest and ordered line digests into one chart digest.
pub(crate) fn combine_content_fingerprint(header_digest: &str, line_digests: &[String]) -> String {
    let mut joined = String::with_capacity(header_digest.len() + line_digests.len() * 9);
    joined.push_str(header_digest);
    for digest in line_digests {
        joined.push('|');
        joined.push_str(digest);
    }
    format!("{:08x}", hash_text(&joined, HASH_SEED))
}

/// Hash one value as a short opaque digest.
fn content_fingerprint(value: &Value, ignore_ids: bool) -> String {
    format!("{:08x}", value_hash(value, ignore_ids, 0))
}

/// Hash a value with sorted object keys.
fn value_hash(value: &Value, ignore_ids: bool, depth: usize) -> u32 {
    match value {
        Value::Null => hash_text("null", HASH_SEED),
        Value::Bool(value) => hash_text(if *value { "true" } else { "false" }, HASH_SEED),
        Value::Number(number) => {
            let value = number.as_f64().unwrap_or(f64::NAN);
            if !value.is_finite() {
                hash_text("null", HASH_SEED)
            } else if value == 0.0 && value.is_sign_negative() {
                hash_text(NEGATIVE_ZERO_MARKER, HASH_SEED)
            } else {
                hash_text(&js_number_string(value), HASH_SEED)
            }
        }
        Value::String(value) => hash_text(&json_string_literal(value), HASH_SEED),
        Value::Array(values) => {
            if depth > MAX_HASH_DEPTH {
                return hash_text(CYCLE_MARKER, HASH_SEED);
            }
            let mut hash = hash_text("[", HASH_SEED);
            hash = hash_word(hash, values.len() as u32);
            for child in values {
                hash = hash_word(hash, value_hash(child, ignore_ids, depth + 1));
            }
            hash_text("]", hash)
        }
        Value::Object(values) => {
            if depth > MAX_HASH_DEPTH {
                return hash_text(CYCLE_MARKER, HASH_SEED);
            }
            let mut hash = hash_text("{", HASH_SEED);
            let mut keys = values.keys().collect::<Vec<_>>();
            keys.sort_by(|left, right| js_string_cmp(left, right));
            for key in keys {
                if ignore_ids && key == "id" {
                    continue;
                }
                hash = hash_text(key, hash);
                hash = hash_word(hash, value_hash(&values[key], ignore_ids, depth + 1));
            }
            hash_text("}", hash)
        }
    }
}

/// FNV-1a over UTF-16 code units, matching JavaScript string hashing.
fn hash_text(text: &str, initial: u32) -> u32 {
    let mut hash = initial;
    for unit in text.encode_utf16() {
        hash ^= unit as u32;
        hash = hash.wrapping_mul(HASH_PRIME);
    }
    hash
}

/// Fold one 32-bit word into a running hash.
fn hash_word(hash: u32, value: u32) -> u32 {
    let mut next = hash;
    next = (next ^ (value & 0xff)).wrapping_mul(HASH_PRIME);
    next = (next ^ ((value >> 8) & 0xff)).wrapping_mul(HASH_PRIME);
    next = (next ^ ((value >> 16) & 0xff)).wrapping_mul(HASH_PRIME);
    (next ^ ((value >> 24) & 0xff)).wrapping_mul(HASH_PRIME)
}

/// Compare strings the way JavaScript's default `Array.prototype.sort` does.
fn js_string_cmp(left: &str, right: &str) -> Ordering {
    left.encode_utf16().cmp(right.encode_utf16())
}

/// Quote one string the way `JSON.stringify` does for valid Unicode.
fn json_string_literal(text: &str) -> String {
    let mut out = String::with_capacity(text.len() + 2);
    out.push('"');
    for character in text.chars() {
        match character {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\u{08}' => out.push_str("\\b"),
            '\u{0c}' => out.push_str("\\f"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            value if (value as u32) < 0x20 => {
                out.push_str(&format!("\\u{:04x}", value as u32));
            }
            value => out.push(value),
        }
    }
    out.push('"');
    out
}

/// Format a finite number the way ECMAScript `Number.prototype.toString` does.
fn js_number_string(value: f64) -> String {
    if value == 0.0 {
        return "0".to_owned();
    }
    let sign = if value < 0.0 { "-" } else { "" };
    let absolute = value.abs();
    let exponential = format!("{:e}", absolute);
    let (mantissa, exponent) = exponential
        .split_once('e')
        .expect("Rust lower-exponential formatting always has an exponent");
    let exponent = exponent
        .parse::<i32>()
        .expect("Rust lower-exponential formatting always has a numeric exponent");
    let digits = mantissa.replace('.', "");
    let digit_count = digits.len() as i32;
    let decimal_point = exponent + 1;
    let body = if digit_count <= decimal_point && decimal_point <= 21 {
        let mut body = digits;
        body.push_str(&"0".repeat((decimal_point - digit_count) as usize));
        body
    } else if 0 < decimal_point && decimal_point <= 21 {
        let split = decimal_point as usize;
        format!("{}.{}", &digits[..split], &digits[split..])
    } else if -6 < decimal_point && decimal_point <= 0 {
        format!("0.{}{}", "0".repeat((-decimal_point) as usize), digits)
    } else {
        let mut body = String::new();
        body.push(digits.as_bytes()[0] as char);
        if digits.len() > 1 {
            body.push('.');
            body.push_str(&digits[1..]);
        }
        body.push('e');
        let exponent = decimal_point - 1;
        if exponent >= 0 {
            body.push('+');
        }
        body.push_str(&exponent.to_string());
        body
    };
    format!("{sign}{body}")
}

/// Convert a value to a number with JavaScript coercion rules.
fn js_number(value: &Value) -> f64 {
    match value {
        Value::Null => 0.0,
        Value::Bool(value) => {
            if *value {
                1.0
            } else {
                0.0
            }
        }
        Value::Number(number) => number.as_f64().unwrap_or(f64::NAN),
        Value::String(value) => js_parse_number(value),
        Value::Array(values) => {
            if values.is_empty() {
                0.0
            } else if values.len() == 1 {
                js_number(&values[0])
            } else {
                f64::NAN
            }
        }
        Value::Object(_) => f64::NAN,
    }
}

/// Parse a string with the common JavaScript `Number` forms.
fn js_parse_number(text: &str) -> f64 {
    let text = text.trim();
    if text.is_empty() {
        return 0.0;
    }
    match text {
        "Infinity" | "+Infinity" => return f64::INFINITY,
        "-Infinity" => return f64::NEG_INFINITY,
        _ => {}
    }
    if let Some(hex) = text.strip_prefix("0x").or_else(|| text.strip_prefix("0X")) {
        return u64::from_str_radix(hex, 16).map_or(f64::NAN, |value| value as f64);
    }
    if let Some(binary) = text.strip_prefix("0b").or_else(|| text.strip_prefix("0B")) {
        return u64::from_str_radix(binary, 2).map_or(f64::NAN, |value| value as f64);
    }
    if let Some(octal) = text.strip_prefix("0o").or_else(|| text.strip_prefix("0O")) {
        return u64::from_str_radix(octal, 8).map_or(f64::NAN, |value| value as f64);
    }
    text.parse::<f64>().unwrap_or(f64::NAN)
}

/// Build a JSON number that serializes like JavaScript's `JSON.stringify`.
fn js_number_json(value: f64) -> Value {
    if !value.is_finite() {
        return Value::Null;
    }
    if value == 0.0 {
        return Value::Number(0.into());
    }
    if value.fract() == 0.0 && value >= i64::MIN as f64 && value <= i64::MAX as f64 {
        return Value::Number((value as i64).into());
    }
    serde_json::Number::from_f64(value)
        .map(Value::Number)
        .unwrap_or(Value::Null)
}

/// Serialize one finite number as a JavaScript-style JSON number.
fn serialize_js_number<S: Serializer>(
    value: &f64,
    serializer: S,
) -> std::result::Result<S::Ok, S::Error> {
    js_number_json(*value).serialize(serializer)
}

/// Serialize an optional number as a JavaScript-style JSON number or `null`.
fn serialize_optional_js_number<S: Serializer>(
    value: &Option<f64>,
    serializer: S,
) -> std::result::Result<S::Ok, S::Error> {
    match value {
        Some(value) => js_number_json(*value).serialize(serializer),
        None => serializer.serialize_none(),
    }
}

#[cfg(test)]
mod tests {
    use super::{
        build_chart_index, combine_content_fingerprint, header_content_fingerprint,
        js_number_string, line_content_fingerprint, summarize_line, ChartLineSummary, TempoMap,
        LINE_FLAG_INVALID, LINE_FLAG_NOISE, LINE_FLAG_SHADER, LINE_FLAG_STATIC,
        LINE_FLAG_UNBOUNDED, MAX_SAFE_INTEGER,
    };
    use crate::documents::chart_stream::json_scan::scan_chart_json;
    use serde_json::{json, Map, Value};

    fn header(value: Value) -> Map<String, Value> {
        value.as_object().unwrap().clone()
    }

    fn tempo(header: &Map<String, Value>) -> TempoMap {
        TempoMap::from_header(header).unwrap()
    }

    #[test]
    fn tempo_map_matches_bpm_changes_and_factors() {
        let header = header(json!({
            "BPMList": [
                {"bpm": 120, "startTime": [0, 0, 1]},
                {"bpm": 60, "startTime": [2, 0, 1]},
            ]
        }));
        let tempo = tempo(&header);

        assert_eq!(tempo.seconds(0.0, 1.0), 0.0);
        assert_eq!(tempo.seconds(2.0, 1.0), 1.0);
        assert_eq!(tempo.seconds(3.0, 1.0), 2.0);
        assert_eq!(tempo.seconds(3.0, 2.0), 4.0);
        assert_eq!(tempo.seconds(3.0, 0.0005), 2.0);
    }

    #[test]
    fn tempo_map_defaults_to_120_bpm_without_a_list() {
        let tempo = tempo(&header(json!({})));
        assert_eq!(tempo.seconds(2.0, 1.0), 1.0);
    }

    #[test]
    fn content_hash_matches_the_typescript_fixtures() {
        assert_eq!(line_content_fingerprint(&Value::Null), "77074ba4");
        assert_eq!(line_content_fingerprint(&json!({ "a": 1 })), "c5246417");
        assert_eq!(
            line_content_fingerprint(&json!({ "a": 1, "id": "ignored" })),
            "c5246417"
        );
        assert_eq!(
            line_content_fingerprint(&json!({ "a": 1, "id": "ignored" })),
            line_content_fingerprint(&json!({ "a": 1 }))
        );
        assert_eq!(
            line_content_fingerprint(&json!({
                "Name": "L",
                "notes": [{"startTime": [0, 0, 1], "endTime": [1, 0, 1]}]
            })),
            "3eb2951a"
        );
        assert_eq!(line_content_fingerprint(&json!(-0.0)), "b63221ba");
        assert_eq!(
            line_content_fingerprint(&json!({ "a": 1.0 })),
            line_content_fingerprint(&json!({ "a": 1 }))
        );
    }

    #[test]
    fn header_digest_includes_meta_id() {
        let first = header(json!({ "META": { "id": "a" }, "BPMList": [] }));
        let second = header(json!({ "META": { "id": "b" }, "BPMList": [] }));
        assert_ne!(
            header_content_fingerprint(&first),
            header_content_fingerprint(&second)
        );
        assert_eq!(
            header_content_fingerprint(&first),
            header_content_fingerprint(&first)
        );
    }

    #[test]
    fn line_digest_ignores_ids_at_every_depth() {
        let left = json!({
            "id": "line",
            "notes": [{"id": "note", "startTime": [0, 0, 1]}],
        });
        let right = json!({
            "id": "other-line",
            "notes": [{"id": "other-note", "startTime": [0, 0, 1]}],
        });
        assert_eq!(
            line_content_fingerprint(&left),
            line_content_fingerprint(&right)
        );

        let changed = json!({
            "notes": [{"startTime": [1, 0, 1]}],
        });
        assert_ne!(
            line_content_fingerprint(&left),
            line_content_fingerprint(&changed)
        );
    }

    #[test]
    fn number_formatting_matches_ecmascript_examples() {
        assert_eq!(js_number_string(1.0), "1");
        assert_eq!(js_number_string(1.5), "1.5");
        assert_eq!(js_number_string(1e20), "100000000000000000000");
        assert_eq!(js_number_string(1e21), "1e+21");
        assert_eq!(js_number_string(1e-6), "0.000001");
        assert_eq!(js_number_string(1e-7), "1e-7");
        assert_eq!(js_number_string(-1.5), "-1.5");
        assert_eq!(js_number_string(5e-324), "5e-324");
    }

    #[test]
    fn line_summary_counts_notes_events_and_time_bounds() {
        let header = header(json!({
            "BPMList": [{"bpm": 120, "startTime": [0, 0, 1]}]
        }));
        let tempo = tempo(&header);
        let line = json!({
            "Group": 2,
            "father": 1,
            "id": "line-id",
            "notes": [
                {"startTime": [0, 0, 1], "endTime": [1, 0, 1]},
            ],
            "eventLayers": [
                {"alphaEvents": [{"startTime": [0, 0, 1], "endTime": [2, 0, 1], "end": 0}]},
            ],
            "extended": {
                "paintEvents": [{"startTime": [0, 0, 1], "endTime": [1, 0, 1]}],
            },
        });

        let summary = summarize_line(&line, 4, &tempo, 10, 20);

        assert_eq!(summary.index, 4);
        assert_eq!(summary.byte_offset, 10);
        assert_eq!(summary.byte_length, 20);
        assert_eq!(summary.note_count, 1);
        assert_eq!(summary.event_count, 2);
        assert_eq!(summary.start_seconds, Some(0.0));
        assert_eq!(summary.end_seconds, Some(1.0));
        assert_eq!(summary.intervals, vec![[0.0, 1.0]]);
        assert_eq!(summary.flags, LINE_FLAG_SHADER);
        assert_eq!(summary.group, 2.0);
        assert_eq!(summary.father, 1.0);
        assert_eq!(summary.id.as_deref(), Some("line-id"));
    }

    #[test]
    fn line_summary_merges_activity_intervals() {
        let header = header(json!({
            "BPMList": [{"bpm": 60, "startTime": [0, 0, 1]}]
        }));
        let tempo = tempo(&header);
        let early = summarize_line(
            &json!({
                "notes": [{"startTime": [0, 0, 1], "endTime": [1, 0, 1], "visibleTime": 0}],
                "eventLayers": [
                    {"alphaEvents": [{"startTime": [0, 0, 1], "endTime": [4, 0, 1], "end": 0}]},
                ],
            }),
            0,
            &tempo,
            0,
            2,
        );
        assert_eq!(early.intervals, vec![[0.0, 4.0]]);

        let late = summarize_line(
            &json!({
                "notes": [{"startTime": [100, 0, 1], "endTime": [101, 0, 1], "visibleTime": 0}],
                "eventLayers": [
                    {"alphaEvents": [{"startTime": [100, 0, 1], "endTime": [104, 0, 1], "end": 0}]},
                ],
            }),
            1,
            &tempo,
            4,
            6,
        );
        assert_eq!(late.intervals, vec![[100.0, 104.0]]);
    }

    #[test]
    fn line_summary_marks_static_unbounded_and_invalid_lines() {
        let header = header(json!({}));
        let tempo = tempo(&header);

        let static_line = summarize_line(&json!({}), 0, &tempo, 0, 2);
        assert_eq!(static_line.flags, LINE_FLAG_STATIC | LINE_FLAG_UNBOUNDED);
        assert_eq!(static_line.start_seconds, None);
        assert_eq!(static_line.end_seconds, None);
        assert_eq!(static_line.intervals, vec![[0.0, MAX_SAFE_INTEGER]]);

        let invalid = summarize_line(&Value::Null, 1, &tempo, 2, 4);
        assert_eq!(invalid.flags, LINE_FLAG_INVALID | LINE_FLAG_UNBOUNDED);
    }

    #[test]
    fn line_summary_marks_noise_lines() {
        let header = header(json!({}));
        let tempo = tempo(&header);
        let summary = summarize_line(
            &json!({"_reduxNoiseLine": {}, "alphaEvents": []}),
            0,
            &tempo,
            0,
            2,
        );
        assert_eq!(summary.flags & LINE_FLAG_NOISE, LINE_FLAG_NOISE);
    }

    #[test]
    fn index_builds_assets_ranges_and_digests() {
        let bytes = br#"{
            "META": {"song": "song.ogg", "background": "bg.png"},
            "BPMList": [{"bpm": 120, "startTime": [0, 0, 1]}],
            "judgeLineList": [
                {"Texture": "line.png", "notes": [{"hitSound": "hit.wav"}]},
                {"attachUI": "ui.png", "extended": {"paintEvents": [{"shader": "fx.frag"}]}}
            ]
        }"#;
        let scan = scan_chart_json(bytes).unwrap();
        let built = build_chart_index(bytes, &scan).unwrap();

        assert_eq!(built.index.version, 1);
        assert_eq!(built.index.total_bytes, bytes.len() as u64);
        assert_eq!(built.index.lines.len(), 2);
        assert_eq!(
            built.index.asset_names,
            vec!["bg.png", "hit.wav", "line.png", "song.ogg", "ui.png"]
        );
        assert!(built.resource_names.iter().any(|name| name == "fx.frag"));
        assert_eq!(
            built.index.lines[0].byte_offset,
            scan.line_ranges[0].start as u64
        );
        assert_eq!(
            built.index.lines[0].byte_length,
            scan.line_ranges[0].len() as u64
        );
        assert!(!built.index.header_digest.is_empty());
        assert_eq!(built.index.lines[0].digest.len(), 8);
    }

    #[test]
    fn combined_digest_changes_with_a_line_digest() {
        let first = combine_content_fingerprint("aaaaaaaa", &["bbbbbbbb".into()]);
        let second = combine_content_fingerprint("aaaaaaaa", &["cccccccc".into()]);
        assert_ne!(first, second);
    }

    #[test]
    fn summaries_serialize_javascript_style_numbers() {
        let summary = ChartLineSummary {
            index: 0,
            byte_offset: 0,
            byte_length: 1,
            note_count: 0,
            event_count: 0,
            start_seconds: Some(1.0),
            end_seconds: None,
            intervals: Vec::new(),
            digest: "00000000".into(),
            flags: 0,
            group: 2.0,
            father: -1.0,
            id: None,
        };
        let value = serde_json::to_value(summary).unwrap();
        assert_eq!(value["startSeconds"], 1);
        assert_eq!(value["endSeconds"], Value::Null);
        assert_eq!(value["group"], 2);
        assert_eq!(value["father"], -1);
        assert!(value.get("id").is_none());
    }
}
