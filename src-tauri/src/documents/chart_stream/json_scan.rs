//! Structural JSON scanner for chart sources. It validates the document and
//! records UTF-8 byte ranges for `judgeLineList` elements without building the
//! chart object graph. Header values are parsed one at a time because the
//! header is small; line values are only sliced and handed to later stages.
//!
//! The scanner accepts any top-level key order and skips a leading UTF-8 BOM.
//! Line ranges are byte offsets into the original input, including the BOM, so
//! random access can slice the stored bytes directly. Invalid UTF-8 inside a
//! line string is left for the later line parse, which summarizes that line as
//! invalid instead of failing the whole chart.

use serde_json::{Map, Value};
use std::fmt;

/// UTF-8 byte-order mark accepted at the start of a chart source.
const BOM: [u8; 3] = [0xef, 0xbb, 0xbf];
/// Maximum container nesting accepted before the input is treated as hostile.
const MAX_JSON_DEPTH: usize = 256;

/// One `judgeLineList` element's UTF-8 byte range in the source.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct LineRange {
    pub(crate) start: usize,
    pub(crate) end: usize,
}

impl LineRange {
    /// Number of source bytes in this range.
    pub(crate) fn len(&self) -> usize {
        self.end - self.start
    }
}

/// A structural scan failure with the byte offset where it was detected.
#[derive(Debug)]
pub(crate) struct ScanError {
    message: String,
    offset: usize,
}

impl ScanError {
    fn new(message: impl Into<String>, offset: usize) -> Self {
        Self {
            message: message.into(),
            offset,
        }
    }
}

impl fmt::Display for ScanError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "{} at byte {}", self.message, self.offset)
    }
}

impl std::error::Error for ScanError {}

/// Header values and line ranges read from one chart JSON source.
#[derive(Debug)]
pub(crate) struct ChartJsonScan {
    /// Every top-level value except `judgeLineList`.
    pub(crate) header: Map<String, Value>,
    pub(crate) line_ranges: Vec<LineRange>,
}

/// Scan chart JSON into a header and per-line byte ranges.
///
/// The top-level value must be an object and the source must contain no
/// trailing content. `judgeLineList` may appear in any position; every element
/// is validated structurally but never parsed here.
pub(crate) fn scan_chart_json(bytes: &[u8]) -> Result<ChartJsonScan, ScanError> {
    let mut scanner = Scanner::new(bytes);
    scanner.skip_whitespace();
    scanner.expect(b'{')?;
    scanner.skip_whitespace();

    let mut header = Map::new();
    let mut line_ranges = Vec::new();
    if scanner.peek() == Some(b'}') {
        scanner.advance();
    } else {
        loop {
            scanner.skip_whitespace();
            let key_start = scanner.position();
            let (_, key_end) = scanner.scan_string()?;
            let key = parse_string_slice(bytes, key_start, key_end)?;
            scanner.skip_whitespace();
            scanner.expect(b':')?;
            scanner.skip_whitespace();
            if key == "judgeLineList" {
                scanner.scan_line_array(&mut line_ranges)?;
            } else {
                let value_start = scanner.position();
                scanner.scan_value(1)?;
                let value_end = scanner.position();
                let value = serde_json::from_slice::<Value>(&bytes[value_start..value_end])
                    .map_err(|scan_error| {
                        ScanError::new(
                            format!("Invalid JSON value for {key}: {scan_error}"),
                            value_start,
                        )
                    })?;
                header.insert(key, value);
            }
            scanner.skip_whitespace();
            match scanner.peek() {
                Some(b',') => scanner.advance(),
                Some(b'}') => {
                    scanner.advance();
                    break;
                }
                _ => return Err(scanner.error("Expected ',' or '}'")),
            }
        }
    }

    scanner.skip_whitespace();
    if scanner.position() != bytes.len() {
        return Err(scanner.error("Trailing content after chart JSON"));
    }
    Ok(ChartJsonScan {
        header,
        line_ranges,
    })
}

/// Decode one quoted JSON string slice into its unescaped value.
fn parse_string_slice(bytes: &[u8], start: usize, end: usize) -> Result<String, ScanError> {
    serde_json::from_slice::<String>(&bytes[start..end])
        .map_err(|scan_error| ScanError::new(format!("Invalid JSON string: {scan_error}"), start))
}

/// Byte cursor over one chart source.
struct Scanner<'a> {
    bytes: &'a [u8],
    position: usize,
}

impl<'a> Scanner<'a> {
    fn new(bytes: &'a [u8]) -> Self {
        let position = if bytes.starts_with(&BOM) {
            BOM.len()
        } else {
            0
        };
        Self { bytes, position }
    }

    fn position(&self) -> usize {
        self.position
    }

    fn advance(&mut self) {
        self.position += 1;
    }

    fn peek(&self) -> Option<u8> {
        self.bytes.get(self.position).copied()
    }

    fn error(&self, message: impl Into<String>) -> ScanError {
        ScanError::new(message, self.position)
    }

    fn skip_whitespace(&mut self) {
        while matches!(self.peek(), Some(b' ' | b'\t' | b'\n' | b'\r')) {
            self.advance();
        }
    }

    fn expect(&mut self, expected: u8) -> Result<(), ScanError> {
        if self.peek() == Some(expected) {
            self.advance();
            Ok(())
        } else {
            Err(self.error(format!("Expected '{}'", expected as char)))
        }
    }

    fn expect_literal(&mut self, literal: &[u8]) -> Result<(), ScanError> {
        if self.bytes[self.position..].starts_with(literal) {
            self.position += literal.len();
            Ok(())
        } else {
            Err(self.error("Expected a JSON literal"))
        }
    }

    /// Validate one JSON string and return its start and end byte offsets.
    fn scan_string(&mut self) -> Result<(usize, usize), ScanError> {
        let start = self.position;
        self.expect(b'"')?;
        while let Some(byte) = self.peek() {
            match byte {
                b'"' => {
                    self.advance();
                    return Ok((start, self.position));
                }
                b'\\' => {
                    self.advance();
                    match self.peek() {
                        Some(b'"' | b'\\' | b'/' | b'b' | b'f' | b'n' | b'r' | b't') => {
                            self.advance();
                        }
                        Some(b'u') => {
                            self.advance();
                            for _ in 0..4 {
                                if !self.peek().is_some_and(|value| value.is_ascii_hexdigit()) {
                                    return Err(self.error("Invalid \\u escape"));
                                }
                                self.advance();
                            }
                        }
                        _ => return Err(self.error("Invalid string escape")),
                    }
                }
                value if value < 0x20 => {
                    return Err(self.error("Unescaped control character in string"));
                }
                _ => self.advance(),
            }
        }
        Err(self.error("Unterminated JSON string"))
    }

    /// Validate one JSON value without retaining it.
    fn scan_value(&mut self, depth: usize) -> Result<(), ScanError> {
        if depth > MAX_JSON_DEPTH {
            return Err(self.error("JSON nesting limit exceeded"));
        }
        self.skip_whitespace();
        match self.peek() {
            Some(b'"') => {
                self.scan_string()?;
                Ok(())
            }
            Some(b'{') => self.scan_object(depth),
            Some(b'[') => self.scan_array(depth),
            Some(b'-' | b'0'..=b'9') => self.scan_number(),
            Some(b't') => self.expect_literal(b"true"),
            Some(b'f') => self.expect_literal(b"false"),
            Some(b'n') => self.expect_literal(b"null"),
            _ => Err(self.error("Expected a JSON value")),
        }
    }

    fn scan_object(&mut self, depth: usize) -> Result<(), ScanError> {
        self.expect(b'{')?;
        self.skip_whitespace();
        if self.peek() == Some(b'}') {
            self.advance();
            return Ok(());
        }
        loop {
            self.skip_whitespace();
            self.scan_string()?;
            self.skip_whitespace();
            self.expect(b':')?;
            self.scan_value(depth + 1)?;
            self.skip_whitespace();
            match self.peek() {
                Some(b',') => self.advance(),
                Some(b'}') => {
                    self.advance();
                    return Ok(());
                }
                _ => return Err(self.error("Expected ',' or '}'")),
            }
        }
    }

    fn scan_array(&mut self, depth: usize) -> Result<(), ScanError> {
        self.expect(b'[')?;
        self.skip_whitespace();
        if self.peek() == Some(b']') {
            self.advance();
            return Ok(());
        }
        loop {
            self.scan_value(depth + 1)?;
            self.skip_whitespace();
            match self.peek() {
                Some(b',') => self.advance(),
                Some(b']') => {
                    self.advance();
                    return Ok(());
                }
                _ => return Err(self.error("Expected ',' or ']'")),
            }
        }
    }

    /// Scan `judgeLineList`, recording each element's raw byte range.
    fn scan_line_array(&mut self, ranges: &mut Vec<LineRange>) -> Result<(), ScanError> {
        self.expect(b'[')?;
        self.skip_whitespace();
        if self.peek() == Some(b']') {
            self.advance();
            return Ok(());
        }
        loop {
            self.skip_whitespace();
            let start = self.position;
            self.scan_value(1)?;
            let end = self.position;
            ranges.push(LineRange { start, end });
            self.skip_whitespace();
            match self.peek() {
                Some(b',') => self.advance(),
                Some(b']') => {
                    self.advance();
                    return Ok(());
                }
                _ => return Err(self.error("Expected ',' or ']' in judgeLineList")),
            }
        }
    }

    /// Validate one JSON number using the RFC 8259 grammar.
    fn scan_number(&mut self) -> Result<(), ScanError> {
        if self.peek() == Some(b'-') {
            self.advance();
        }
        match self.peek() {
            Some(b'0') => self.advance(),
            Some(b'1'..=b'9') => {
                self.advance();
                while self.peek().is_some_and(|value| value.is_ascii_digit()) {
                    self.advance();
                }
            }
            _ => return Err(self.error("Invalid JSON number")),
        }
        if self.peek() == Some(b'.') {
            self.advance();
            if !self.peek().is_some_and(|value| value.is_ascii_digit()) {
                return Err(self.error("Invalid JSON number fraction"));
            }
            while self.peek().is_some_and(|value| value.is_ascii_digit()) {
                self.advance();
            }
        }
        if matches!(self.peek(), Some(b'e' | b'E')) {
            self.advance();
            if matches!(self.peek(), Some(b'+' | b'-')) {
                self.advance();
            }
            if !self.peek().is_some_and(|value| value.is_ascii_digit()) {
                return Err(self.error("Invalid JSON number exponent"));
            }
            while self.peek().is_some_and(|value| value.is_ascii_digit()) {
                self.advance();
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::{scan_chart_json, ScanError};

    fn line_bytes<'a>(bytes: &'a [u8], scan: &super::ChartJsonScan, index: usize) -> &'a [u8] {
        let range = scan.line_ranges[index];
        &bytes[range.start..range.end]
    }

    #[test]
    fn scanner_accepts_any_top_level_key_order() {
        let bytes = br#"{"judgeLineList":[{"Name":"A"},{"Name":"B"}],"META":{"id":"m"},"BPMList":[{"bpm":120,"startTime":[0,0,1]}]}"#;
        let scan = scan_chart_json(bytes).unwrap();

        assert_eq!(scan.line_ranges.len(), 2);
        assert_eq!(line_bytes(bytes, &scan, 0), br#"{"Name":"A"}"#);
        assert_eq!(line_bytes(bytes, &scan, 1), br#"{"Name":"B"}"#);
        assert_eq!(scan.header["META"]["id"], "m");
        assert!(scan.header.get("judgeLineList").is_none());
        assert_eq!(scan.header["BPMList"][0]["bpm"], 120);
    }

    #[test]
    fn scanner_records_ranges_around_nested_values_and_escapes() {
        let bytes = br#"{"META":{"name":"a\"b\\c\u4e2d"},"judgeLineList":[{"Name":"x]}\\\""},{"notes":[{"id":"n","startTime":[0,0,1]}]}]}"#;
        let scan = scan_chart_json(bytes).unwrap();

        assert_eq!(scan.line_ranges.len(), 2);
        assert_eq!(line_bytes(bytes, &scan, 0), br#"{"Name":"x]}\\\""}"#);
        assert_eq!(
            line_bytes(bytes, &scan, 1),
            br#"{"notes":[{"id":"n","startTime":[0,0,1]}]}"#
        );
        assert_eq!(scan.header["META"]["name"], "a\"b\\c中");
    }

    #[test]
    fn scanner_accepts_a_bom_and_crlf_whitespace() {
        let mut bytes = vec![0xef, 0xbb, 0xbf];
        bytes.extend_from_slice(
            b"{\r\n  \"META\": {},\r\n  \"judgeLineList\": [\r\n    {\"a\": 1}\r\n  ]\r\n}",
        );
        let scan = scan_chart_json(&bytes).unwrap();

        assert_eq!(scan.line_ranges.len(), 1);
        assert_eq!(line_bytes(&bytes, &scan, 0), br#"{"a": 1}"#);
        assert!(scan.header.contains_key("META"));
    }

    #[test]
    fn scanner_accepts_an_empty_line_list() {
        let scan = scan_chart_json(br#"{"judgeLineList":[],"META":{}}"#).unwrap();
        assert!(scan.line_ranges.is_empty());
        assert!(scan.header.contains_key("META"));
    }

    #[test]
    fn scanner_rejects_malformed_inputs() {
        let cases: &[&[u8]] = &[
            br#"{"META":{"#,
            br#"{"META":"bad\q"}"#,
            b"{\"META\":\"bad\x01\"}",
            br#"{"judgeLineList":[1,]}"#,
            br#"{"META":1} trailing"#,
            br#"{"META":01}"#,
            br#"{"META":.5}"#,
            br#"{"META":1.}"#,
            b"[1]",
            br#"{"judgeLineList":[{"a":1}]"#,
            br#"{"META":truex}"#,
            br#"{"META":-}"#,
        ];
        for case in cases {
            assert!(
                scan_chart_json(case).is_err(),
                "accepted malformed input: {}",
                String::from_utf8_lossy(case)
            );
        }
    }

    #[test]
    fn scanner_rejects_excessive_nesting() {
        let mut bytes = Vec::new();
        bytes.extend_from_slice(br#"{"META":"#);
        for _ in 0..300 {
            bytes.push(b'[');
        }
        for _ in 0..300 {
            bytes.push(b']');
        }
        bytes.push(b'}');

        let error: ScanError = scan_chart_json(&bytes).unwrap_err();
        assert!(error.to_string().contains("nesting limit"));
    }

    #[test]
    fn scanner_rejects_trailing_content_after_the_object() {
        let error = scan_chart_json(br#"{"META":{}}[]"#).unwrap_err();
        assert!(error.to_string().contains("Trailing content"));
    }
}
