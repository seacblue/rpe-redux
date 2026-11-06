//! Serves document media over the Tauri asset protocol, including HTTP range
//! requests so audio seeking works without materialising whole files.

use super::{
    archive_has_entry, document, error, zip_name, Document, DocumentHost, Result,
    MAX_MEDIA_RESPONSE_BYTES, MAX_RESOURCE_BYTES,
};
use std::{
    fs::File,
    io::{Read, Seek, SeekFrom},
    path::Path,
};
use tauri::Manager;
use zip::ZipArchive;

/// Serve one document resource, honouring HEAD and a single byte range.
pub(super) fn serve_media(
    doc: &Document,
    name: &str,
    request: &tauri::http::Request<Vec<u8>>,
) -> Result<tauri::http::Response<Vec<u8>>> {
    let range = request.headers().get("range").and_then(|v| v.to_str().ok());
    let head = request.method() == tauri::http::Method::HEAD;
    // Build the response for the requested range; a bad range becomes 416.
    let read = |reader: &mut dyn Read,
                total: u64,
                skip_prefix: bool|
     -> Result<tauri::http::Response<Vec<u8>>> {
        let (start, end) = if total == 0 && range.is_none() {
            (0, 0)
        } else {
            match parse_range(range, total) {
                Ok(v) => v,
                Err(_) => {
                    return tauri::http::Response::builder()
                        .status(416)
                        .header("Content-Range", format!("bytes */{total}"))
                        .body(vec![])
                        .map_err(error)
                }
            }
        };
        let length = if total == 0 { 0 } else { end - start + 1 };
        if length > MAX_MEDIA_RESPONSE_BYTES {
            return Err("media_response_too_large".into());
        }
        let mut bytes = Vec::new();
        if !head && length > 0 {
            if skip_prefix {
                std::io::copy(&mut reader.take(start), &mut std::io::sink()).map_err(error)?;
            }
            bytes.resize(length as usize, 0);
            reader.read_exact(&mut bytes).map_err(error)?;
        }
        let status = if range.is_some() { 206 } else { 200 };
        let mut builder = tauri::http::Response::builder()
            .status(status)
            .header(
                "Content-Type",
                mime_guess::from_path(name).first_or_octet_stream().as_ref(),
            )
            .header("Accept-Ranges", "bytes")
            .header("Content-Length", length)
            .header("X-Content-Type-Options", "nosniff");
        if status == 206 {
            builder = builder.header("Content-Range", format!("bytes {start}-{end}/{total}"));
        }
        builder.body(bytes).map_err(error)
    };
    if !doc.packed {
        let path = super::readable_resource_path(doc, name)?;
        let mut file = File::open(path).map_err(error)?;
        let total = file.metadata().map_err(error)?.len();
        if total > MAX_RESOURCE_BYTES {
            return Err("resource_too_large".into());
        }
        // File ranges seek directly; archive ranges discard the prefix without retaining it.
        let (start, _) = if total == 0 {
            (0, 0)
        } else {
            parse_range(range, total).unwrap_or((0, 0))
        };
        file.seek(SeekFrom::Start(start)).map_err(error)?;
        read(&mut file, total, false)
    } else {
        if !doc.resources.contains_key(name) {
            zip_name(name)?;
        }
        let mut archive = ZipArchive::new(File::open(&doc.path).map_err(error)?).map_err(error)?;
        let relative = Path::new(&doc.chart_name)
            .parent()
            .unwrap_or(Path::new(""))
            .join(name)
            .to_string_lossy()
            .replace('\\', "/");
        let alias = doc
            .resources
            .get(name)
            .map(|p| p.to_string_lossy().replace('\\', "/"));
        let selected = match alias {
            Some(alias) if archive_has_entry(&archive, &alias)? => alias,
            _ if archive_has_entry(&archive, &relative)? => relative,
            _ => name.to_owned(),
        };
        let mut entry = archive.by_name(&selected).map_err(error)?;
        let total = entry.size();
        if total > MAX_RESOURCE_BYTES {
            return Err("resource_too_large".into());
        }
        read(&mut entry, total, true)
    }
}
/// Parse one `bytes=` range against `total`, clamping the end and rejecting an
/// inverted or out-of-bounds span. A missing header selects the whole non-empty
/// resource.
pub(super) fn parse_range(range: Option<&str>, total: u64) -> Result<(u64, u64)> {
    if total == 0 {
        return Err("Resource is empty.".into());
    }
    let Some(range) = range else {
        return Ok((0, total - 1));
    };
    let (a, b) = range
        .strip_prefix("bytes=")
        .ok_or("Invalid Range header")?
        .split_once('-')
        .ok_or("Invalid Range header")?;
    let start = if a.is_empty() {
        let length = b.parse::<u64>().map_err(error)?;
        total.saturating_sub(length)
    } else {
        a.parse::<u64>().map_err(error)?
    };
    let end = if a.is_empty() || b.is_empty() {
        total - 1
    } else {
        b.parse::<u64>().map_err(error)?.min(total - 1)
    };
    if start >= total || end < start {
        return Err("Range is out of bounds.".into());
    }
    Ok((start, end))
}

/// Handle `redux://<document-id>/<resource>` requests; any failure becomes 404.
pub fn media_response(
    app: &tauri::AppHandle,
    request: tauri::http::Request<Vec<u8>>,
) -> tauri::http::Response<Vec<u8>> {
    let result = (|| -> Result<tauri::http::Response<Vec<u8>>> {
        let path = request.uri().path().trim_start_matches('/');
        let (id, encoded) = path.split_once('/').ok_or("Invalid resource URL")?;
        let name = percent_encoding::percent_decode_str(encoded)
            .decode_utf8()
            .map_err(error)?;
        let doc = document(&app.state::<DocumentHost>(), id)?;
        serve_media(&doc, &name, &request)
    })();
    let mut response = result.unwrap_or_else(|e| {
        tauri::http::Response::builder()
            .status(404)
            .body(e.into_bytes())
            .unwrap()
    });
    if let Some(origin) = request
        .headers()
        .get("origin")
        .and_then(|v| v.to_str().ok())
    {
        if [
            "http://tauri.localhost",
            "https://tauri.localhost",
            "tauri://localhost",
            "http://127.0.0.1:4173",
        ]
        .contains(&origin)
        {
            if let Ok(value) = origin.parse() {
                response
                    .headers_mut()
                    .insert("Access-Control-Allow-Origin", value);
            }
            if let Ok(value) = "Content-Range, Accept-Ranges, Content-Length".parse() {
                response
                    .headers_mut()
                    .insert("Access-Control-Expose-Headers", value);
            }
        }
    }
    response
}
