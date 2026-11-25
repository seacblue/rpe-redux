use std::env;
use std::path::{Path, PathBuf};

/// Note left in a resource folder whose optional tool was not staged.
const SKIPPED_TOOL_NOTE: &str = "NOT-BUNDLED.txt";

/// Create a resource folder for a tool this build does not bundle.
///
/// The bundle resource globs need at least one match, and a packaged folder
/// without the tool should explain itself. A staging script removes the note
/// when it copies the real binary in.
fn mark_tool_missing(manifest: &Path, folder: &str, tool: &str, script: &str) {
    let directory = manifest.join("resources").join(folder);
    let populated = std::fs::read_dir(&directory)
        .map(|mut entries| entries.next().is_some())
        .unwrap_or(false);
    if populated || std::fs::create_dir_all(&directory).is_err() {
        return;
    }
    let _ = std::fs::write(
        directory.join(SKIPPED_TOOL_NOTE),
        format!(
            "This build was created without the bundled {tool} download.\n\
             The matching feature reports itself as unavailable at runtime.\n\
             Run `node scripts/{script}` to stage it.\n"
        ),
    );
}

fn main() {
    let manifest = PathBuf::from(env::var_os("CARGO_MANIFEST_DIR").unwrap());
    let target_name = "redux-service";
    let source = manifest.join("resources").join(target_name);
    let source_size = std::fs::metadata(&source)
        .map(|metadata| metadata.len())
        .unwrap_or(0);
    if source_size == 0 {
        panic!(
            "backend helper is missing or empty at {}; run `npm run build` before building the desktop app",
            source.display()
        );
    }
    println!("cargo:rerun-if-changed={}", source.display());
    // The two release-resolved helper downloads are optional. A build made without them
    // keeps a self-describing resource folder so the bundle globs still resolve.
    mark_tool_missing(&manifest, "ffmpeg", "FFmpeg", "prepareFfmpeg.mjs");
    mark_tool_missing(
        &manifest,
        "cloudflared",
        "Cloudflare Tunnel client",
        "prepareCloudflared.mjs",
    );
    let encoder = manifest.join("resources").join("ffmpeg").join("ffmpeg.exe");
    // Recording, and therefore the bundled encoder, is a Windows-only feature.
    if cfg!(windows)
        && std::fs::metadata(&encoder)
            .map(|metadata| metadata.len())
            .unwrap_or(0)
            == 0
    {
        println!(
            "cargo:warning=bundled FFmpeg is not staged at {}; chart export stays unavailable in this build",
            encoder.display()
        );
    }
    println!("cargo:rerun-if-changed={}", encoder.display());
    println!("cargo:rerun-if-env-changed=REDUX_UPDATE_PUBLIC_KEY");
    tauri_build::build()
}
