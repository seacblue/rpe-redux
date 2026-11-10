//! Binary chart-stream frames: a little-endian payload length, one kind byte,
//! and a raw payload. Payloads stay raw JSON so line text is never re-encoded
//! by the transport.
//!
//! The layout matches `src/core/global/chart/streaming/chartStreamCodec.ts`.

#![allow(dead_code)] // The codec defines every frame kind even when one phase emits a subset.

use serde::Serialize;

use crate::documents::{error, Result};

/// Header frame: the chart header without `judgeLineList`.
pub(crate) const FRAME_HEADER: u8 = 1;
/// Index frame: the line index.
pub(crate) const FRAME_INDEX: u8 = 2;
/// One line frame: `u32` line index followed by raw JSON.
pub(crate) const FRAME_LINE: u8 = 3;
/// A line batch: `u32` start, `u32` count, then a raw JSON array.
pub(crate) const FRAME_LINES: u8 = 4;
/// Effects frame: a raw JSON array.
pub(crate) const FRAME_EFFECTS: u8 = 5;
/// Block-area frame: a raw JSON array.
pub(crate) const FRAME_BLOCK: u8 = 6;
/// End frame: `{ digest, bytes }`.
pub(crate) const FRAME_END: u8 = 7;
/// Error frame: `{ code, message, path }`.
pub(crate) const FRAME_ERROR: u8 = 8;

/// Encode one frame with a little-endian `u32` length prefix and kind byte.
pub(crate) fn encode_frame(kind: u8, payload: &[u8]) -> Result<Vec<u8>> {
    let length = u32::try_from(payload.len()).map_err(|_| "chart_frame_too_large".to_string())?;
    let mut frame = Vec::with_capacity(5 + payload.len());
    frame.extend_from_slice(&length.to_le_bytes());
    frame.push(kind);
    frame.extend_from_slice(payload);
    Ok(frame)
}

/// Encode a serializable value as one JSON frame.
pub(crate) fn encode_json_frame<T: Serialize>(kind: u8, value: &T) -> Result<Vec<u8>> {
    let payload = serde_json::to_vec(value).map_err(error)?;
    encode_raw_json_frame(kind, &payload)
}

/// Encode raw JSON bytes as one frame without parsing or re-encoding them.
pub(crate) fn encode_raw_json_frame(kind: u8, raw: &[u8]) -> Result<Vec<u8>> {
    encode_frame(kind, raw)
}

/// Encode one line frame: a `u32` index followed by raw JSON text.
pub(crate) fn encode_line_frame(index: u32, raw: &[u8]) -> Result<Vec<u8>> {
    let mut payload = Vec::with_capacity(4 + raw.len());
    payload.extend_from_slice(&index.to_le_bytes());
    payload.extend_from_slice(raw);
    encode_frame(FRAME_LINE, &payload)
}

/// Encode one line batch: start, count, then a raw JSON array.
pub(crate) fn encode_lines_frame(start: u32, count: u32, raw: &[u8]) -> Result<Vec<u8>> {
    let mut payload = Vec::with_capacity(8 + raw.len());
    payload.extend_from_slice(&start.to_le_bytes());
    payload.extend_from_slice(&count.to_le_bytes());
    payload.extend_from_slice(raw);
    encode_frame(FRAME_LINES, &payload)
}

/// Encode one error frame.
pub(crate) fn encode_error_frame(code: &str, message: &str, path: &str) -> Result<Vec<u8>> {
    #[derive(Serialize)]
    struct ErrorFrame<'a> {
        code: &'a str,
        message: &'a str,
        path: &'a str,
    }
    encode_json_frame(
        FRAME_ERROR,
        &ErrorFrame {
            code,
            message,
            path,
        },
    )
}

#[cfg(test)]
mod tests {
    use super::{
        encode_error_frame, encode_frame, encode_json_frame, encode_line_frame, encode_lines_frame,
        FRAME_ERROR, FRAME_HEADER, FRAME_LINE, FRAME_LINES,
    };

    /// Split a frame into its length, kind, and payload.
    fn split(frame: &[u8]) -> (u32, u8, &[u8]) {
        assert!(frame.len() >= 5);
        let length = u32::from_le_bytes(frame[..4].try_into().unwrap());
        assert_eq!(frame.len(), 5 + length as usize);
        (length, frame[4], &frame[5..])
    }

    #[test]
    fn frame_layout_is_length_kind_payload() {
        let frame = encode_frame(FRAME_HEADER, b"{\"META\":{}}").unwrap();
        let (length, kind, payload) = split(&frame);
        assert_eq!(length, 11);
        assert_eq!(kind, FRAME_HEADER);
        assert_eq!(payload, b"{\"META\":{}}");
        assert_eq!(&frame[..4], &[11, 0, 0, 0]);
    }

    #[test]
    fn line_frame_prefixes_the_index() {
        let frame = encode_line_frame(7, b"{\"Name\":\"L\"}").unwrap();
        let (_, kind, payload) = split(&frame);
        assert_eq!(kind, FRAME_LINE);
        assert_eq!(&payload[..4], &7u32.to_le_bytes());
        assert_eq!(&payload[4..], b"{\"Name\":\"L\"}");
    }

    #[test]
    fn lines_frame_prefixes_start_and_count() {
        let frame = encode_lines_frame(12, 3, b"[{},{}]").unwrap();
        let (_, kind, payload) = split(&frame);
        assert_eq!(kind, FRAME_LINES);
        assert_eq!(&payload[..4], &12u32.to_le_bytes());
        assert_eq!(&payload[4..8], &3u32.to_le_bytes());
        assert_eq!(&payload[8..], b"[{},{}]");
    }

    #[test]
    fn json_frames_use_the_documented_kinds() {
        let frame =
            encode_json_frame(FRAME_HEADER, &serde_json::json!({ "lineCount": 0 })).unwrap();
        let (_, kind, payload) = split(&frame);
        assert_eq!(kind, FRAME_HEADER);
        assert_eq!(payload, b"{\"lineCount\":0}");
    }

    #[test]
    fn error_frame_carries_code_message_and_path() {
        let frame = encode_error_frame("chart_too_large", "too large", "$").unwrap();
        let (_, kind, payload) = split(&frame);
        assert_eq!(kind, FRAME_ERROR);
        let value: serde_json::Value = serde_json::from_slice(payload).unwrap();
        assert_eq!(value["code"], "chart_too_large");
        assert_eq!(value["message"], "too large");
        assert_eq!(value["path"], "$");
    }
}
