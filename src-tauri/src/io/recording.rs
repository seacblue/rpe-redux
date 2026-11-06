//! Encodes a playable recording while preserving the final destination until success.
//!
//! The frontend supplies a bounded stream of stereo f32 samples and either PNG
//! frames or Annex B H.264 access units. FFmpeg writes a visible partial file;
//! the selected destination is published only after a successful exit and
//! remains protected against concurrent edits.

use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    process::{Child, ChildStdin, Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::Duration,
};
use tauri::{
    ipc::{InvokeBody, Request},
    AppHandle, Manager, State,
};
use tempfile::{Builder, NamedTempFile};
use uuid::Uuid;

type Result<T> = std::result::Result<T, String>;
// Leaves room for the session id and a 4K PNG fallback frame; platform-encoded
// H.264 access units are much smaller.
const MAX_CHUNK: usize = 64 * 1024 * 1024;
/// Bundled encoder file name for the host platform.
const ENCODER_FILE: &str = if cfg!(windows) {
    "ffmpeg.exe"
} else {
    "ffmpeg"
};

/// Active recording sessions, shared by the IPC commands.
#[derive(Default)]
pub struct RecordingHost {
    sessions: Mutex<HashMap<String, Arc<Session>>>,
}

/// The frame stream the frontend sends for this session.
#[derive(Clone, Copy, PartialEq, Eq)]
enum VideoInput {
    Png,
    H264,
}

/// Video rate-control profile requested by the recording surface.
#[derive(Clone, Copy, PartialEq, Eq)]
enum VideoRateControl {
    Standard,
    Vbr2,
}

impl VideoRateControl {
    /// Parse the rate-control identifier sent by the frontend.
    fn parse(value: &str) -> Option<Self> {
        match value {
            "standard" => Some(Self::Standard),
            "vbr2" => Some(Self::Vbr2),
            _ => None,
        }
    }
}

/// Output container and codec profile requested by the recording surface.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum RecordingFormat {
    Mp4,
    Mkv,
    Mov,
    Webm,
    Gif,
    Apng,
    Webp,
    Mp3,
    Flac,
    Wav,
    Ogg,
}

impl RecordingFormat {
    /// Parse the identifier the frontend sends.
    fn parse(value: &str) -> Option<Self> {
        Some(match value.to_ascii_lowercase().as_str() {
            "mp4" => Self::Mp4,
            "mkv" => Self::Mkv,
            "mov" => Self::Mov,
            "webm" => Self::Webm,
            "gif" => Self::Gif,
            "apng" => Self::Apng,
            "webp" => Self::Webp,
            "mp3" => Self::Mp3,
            "flac" => Self::Flac,
            "wav" => Self::Wav,
            "ogg" => Self::Ogg,
            _ => return None,
        })
    }

    /// Extension used by the destination, the partial file, and the publish fallback.
    fn extension(self) -> &'static str {
        match self {
            Self::Mp4 => "mp4",
            Self::Mkv => "mkv",
            Self::Mov => "mov",
            Self::Webm => "webm",
            Self::Gif => "gif",
            Self::Apng => "apng",
            Self::Webp => "webp",
            Self::Mp3 => "mp3",
            Self::Flac => "flac",
            Self::Wav => "wav",
            Self::Ogg => "ogg",
        }
    }

    /// Audio-only outputs stream the soundtrack and never accept video frames.
    fn audio_only(self) -> bool {
        matches!(self, Self::Mp3 | Self::Flac | Self::Wav | Self::Ogg)
    }

    /// Containers that carry a soundtrack and therefore need the speed filter.
    fn has_audio(self) -> bool {
        !matches!(self, Self::Gif | Self::Apng | Self::Webp)
    }

    /// Containers that can copy an already encoded H.264 stream.
    fn copies_h264(self) -> bool {
        matches!(self, Self::Mp4 | Self::Mkv | Self::Mov)
    }
}

/// One recording: staging files, encoder process, and frame counters.
struct Session {
    target: PathBuf,
    baseline: Option<[u8; 32]>,
    encoder: PathBuf,
    audio: Mutex<Option<NamedTempFile>>,
    output: Mutex<Option<NamedTempFile>>,
    log: NamedTempFile,
    child: Mutex<Option<Child>>,
    input: Mutex<Option<ChildStdin>>,
    cancelled: AtomicBool,
    video_input: VideoInput,
    format: RecordingFormat,
    fps: u32,
    frame_count: u32,
    speed: f64,
    expected_audio_bytes: u64,
    video_bitrate: u32,
    rate_control: VideoRateControl,
    written_frames: Mutex<u32>,
    audio_bytes: Mutex<u64>,
    publish: Mutex<()>,
}

impl Drop for Session {
    fn drop(&mut self) {
        if let Ok(child) = self.child.get_mut() {
            if let Some(child) = child.as_mut() {
                let _ = child.kill();
                let _ = child.wait();
            }
        }
    }
}

fn err(error: impl std::fmt::Display) -> String {
    error.to_string()
}

/// Validate the numeric recording request shared by the command and its tests.
fn recording_options_valid(
    fps: u32,
    video_bitrate: u32,
    frame_count: u32,
    speed: f64,
    audio_sample_count: u64,
) -> bool {
    (1..=240).contains(&fps)
        && (1..=100).contains(&video_bitrate)
        && frame_count > 0
        && speed.is_finite()
        && (0.5..=4.0).contains(&speed)
        && audio_sample_count > 0
}

/// Validate and canonicalize the destination selected by the native save dialog.
///
/// The output must be an absolute path directly inside an existing directory,
/// use the selected container's extension, and carry a safe file name. The
/// returned path uses the canonical parent, so staging and publication stay in
/// the directory the user chose.
fn recording_target(path: &str, format: RecordingFormat) -> Result<PathBuf> {
    let raw = PathBuf::from(path);
    if !raw.is_absolute()
        || raw
            .components()
            .any(|component| matches!(component, std::path::Component::ParentDir))
    {
        return Err("recording_invalid_destination".into());
    }
    let name = raw
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or("recording_invalid_destination")?;
    let normalized = crate::storage::path_safety::single_segment(name)
        .ok_or_else(|| "recording_invalid_destination".to_string())?;
    if normalized != name
        || raw
            .extension()
            .and_then(|value| value.to_str())
            .map(|value| value.eq_ignore_ascii_case(format.extension()))
            != Some(true)
    {
        return Err("recording_invalid_options".into());
    }
    let parent = raw
        .parent()
        .filter(|value| value.is_dir())
        .ok_or("recording_invalid_destination")?;
    let parent =
        fs::canonicalize(parent).map_err(|_| "recording_invalid_destination".to_string())?;
    let target = parent.join(normalized);
    if let Ok(metadata) = fs::symlink_metadata(&target) {
        if metadata.file_type().is_symlink() || !metadata.is_file() {
            return Err("recording_invalid_destination".into());
        }
    }
    Ok(target)
}

/// Identify the selected destination so an external edit during export is not overwritten.
fn destination_hash(path: &std::path::Path) -> Result<Option<[u8; 32]>> {
    let mut file = match std::fs::File::open(path) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(err(error)),
    };
    let mut hash = Sha256::new();
    let mut buffer = [0u8; 64 * 1024];
    loop {
        let count = file.read(&mut buffer).map_err(err)?;
        if count == 0 {
            break;
        }
        hash.update(&buffer[..count]);
    }
    Ok(Some(hash.finalize().into()))
}

/// Fetch a live session by id; an unknown id is a missing-session error.
fn session(host: &RecordingHost, id: &str) -> Result<Arc<Session>> {
    host.sessions
        .lock()
        .map_err(err)?
        .get(id)
        .cloned()
        .ok_or_else(|| "recording_session_missing".into())
}

/// Fail when the session was cancelled before this step ran.
fn check_active(session: &Session) -> Result<()> {
    if session.cancelled.load(Ordering::SeqCst) {
        Err("recording_cancelled".into())
    } else {
        Ok(())
    }
}

/// Locate only the FFmpeg binary shipped with the application. Development
/// builds use the staged resource directory when there is no installed bundle.
fn bundled_encoder(app: &AppHandle) -> Result<PathBuf> {
    let mut candidates = Vec::new();
    if let Ok(resources) = app.path().resource_dir() {
        candidates.push(
            resources
                .join("resources")
                .join("ffmpeg")
                .join(ENCODER_FILE),
        );
    }
    if let Ok(executable) = std::env::current_exe() {
        if let Some(parent) = executable.parent() {
            candidates.push(parent.join("resources").join("ffmpeg").join(ENCODER_FILE));
        }
    }
    if cfg!(debug_assertions) {
        candidates.push(
            PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("resources")
                .join("ffmpeg")
                .join(ENCODER_FILE),
        );
    }
    let encoder = candidates
        .into_iter()
        .find(|path| path.is_file())
        .ok_or("recording_encoder_missing")?;
    crate::storage::ensure_executable(&encoder).map_err(|_| "recording_encoder_missing")?;
    Ok(encoder)
}

/// Session handle plus the readable partial file.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordingStarted {
    id: String,
    partial_path: PathBuf,
}

/// Create staging files on the same volume as the final destination.
#[tauri::command]
pub fn recording_begin(
    app: AppHandle,
    host: State<'_, RecordingHost>,
    token: State<'_, crate::app::ipc_guard::HostToken>,
    request: tauri::ipc::Request<'_>,
    path: String,
    video_input: String,
    format: String,
    fps: u32,
    frame_count: u32,
    speed: f64,
    audio_sample_count: u64,
    video_bitrate: u32,
    video_rate_control: String,
) -> Result<RecordingStarted> {
    crate::app::ipc_guard::HostToken::require(token.inner(), request.headers())?;
    let video_input = match video_input.as_str() {
        "png" => VideoInput::Png,
        "h264" => VideoInput::H264,
        _ => return Err("recording_invalid_options".into()),
    };
    let format = RecordingFormat::parse(&format).ok_or("recording_invalid_options")?;
    let rate_control =
        VideoRateControl::parse(&video_rate_control).ok_or("recording_invalid_options")?;
    if !recording_options_valid(fps, video_bitrate, frame_count, speed, audio_sample_count) {
        return Err("recording_invalid_options".into());
    }
    let target = recording_target(&path, format)?;
    let baseline = destination_hash(&target)?;
    let encoder = bundled_encoder(&app)?;
    let parent = target
        .parent()
        .filter(|p| p.is_dir())
        .ok_or("recording_invalid_destination")?;
    let audio = Builder::new()
        .prefix(".redux-audio-")
        .tempfile_in(parent)
        .map_err(err)?;
    let output = Builder::new()
        .prefix("redux-preview-")
        .suffix(&format!(".{}", format.extension()))
        .tempfile_in(parent)
        .map_err(err)?;
    let log = Builder::new()
        .prefix(".redux-encoder-")
        .tempfile_in(parent)
        .map_err(err)?;
    let id = Uuid::new_v4().to_string();
    let partial_path = output.path().to_path_buf();
    let entry = Session {
        target,
        baseline,
        encoder,
        audio: Mutex::new(Some(audio)),
        output: Mutex::new(Some(output)),
        log,
        child: Mutex::new(None),
        input: Mutex::new(None),
        cancelled: AtomicBool::new(false),
        video_input,
        format,
        fps,
        frame_count,
        speed,
        expected_audio_bytes: audio_sample_count * 8,
        video_bitrate,
        rate_control,
        written_frames: Mutex::new(0),
        audio_bytes: Mutex::new(0),
        publish: Mutex::new(()),
    };
    host.sessions
        .lock()
        .map_err(err)?
        .insert(id.clone(), Arc::new(entry));
    Ok(RecordingStarted { id, partial_path })
}

/// Decode an IPC packet: 36-byte ASCII UUID followed by the payload.
fn packet(body: &InvokeBody) -> Result<(String, Vec<u8>)> {
    let bytes = match body {
        InvokeBody::Raw(bytes) => bytes,
        _ => return Err("recording_binary_required".into()),
    };
    if bytes.len() <= 36 || bytes.len() > MAX_CHUNK + 36 {
        return Err("recording_invalid_chunk".into());
    }
    let id = std::str::from_utf8(&bytes[..36]).map_err(err)?;
    Uuid::parse_str(id).map_err(err)?;
    Ok((id.to_owned(), bytes[36..].to_vec()))
}

/// Append one interleaved float PCM chunk before starting the encoder.
#[tauri::command]
pub async fn recording_audio(host: State<'_, RecordingHost>, request: Request<'_>) -> Result<()> {
    let (id, bytes) = packet(request.body())?;
    let entry = session(&host, &id)?;
    tauri::async_runtime::spawn_blocking(move || {
        check_active(&entry)?;
        if bytes.len() % 8 != 0 {
            return Err("recording_invalid_audio".into());
        }
        let mut audio = entry.audio.lock().map_err(err)?;
        if entry.child.lock().map_err(err)?.is_some() {
            return Err("recording_audio_closed".into());
        }
        let file = audio.as_mut().ok_or("recording_audio_closed")?;
        let mut total = entry.audio_bytes.lock().map_err(err)?;
        if *total + bytes.len() as u64 > entry.expected_audio_bytes {
            return Err("recording_invalid_audio".into());
        }
        file.write_all(&bytes).map_err(err)?;
        *total += bytes.len() as u64;
        Ok(())
    })
    .await
    .map_err(err)?
}

/// Build the atempo chain that compresses the source soundtrack by `speed`.
///
/// Each atempo stage accepts 0.5–2.0, so speeds above 2 are split into equal
/// doublings followed by the remainder (4x becomes `atempo=2,atempo=2`).
fn atempo_filter(speed: f64) -> Option<String> {
    if !speed.is_finite() || speed == 1.0 {
        return None;
    }
    let mut remaining = speed;
    let mut stages = Vec::new();
    while remaining > 2.0 {
        stages.push(2.0);
        remaining /= 2.0;
    }
    stages.push(remaining);
    Some(
        stages
            .into_iter()
            .map(|stage| format!("atempo={stage}"))
            .collect::<Vec<_>>()
            .join(","),
    )
}

/// Add a bounded VBR profile with a 2x peak target and a 4x VBV buffer.
fn append_bounded_vbr(command: &mut Command, bitrate: u32) {
    let target = format!("{bitrate}M");
    let maxrate = format!("{}M", bitrate.saturating_mul(2));
    let bufsize = format!("{}M", bitrate.saturating_mul(4));
    command.args([
        "-b:v",
        target.as_str(),
        "-maxrate",
        maxrate.as_str(),
        "-bufsize",
        bufsize.as_str(),
    ]);
}

/// Append the selected video rate-control profile to an encoder command.
fn append_video_rate_control(command: &mut Command, bitrate: u32, rate_control: VideoRateControl) {
    match rate_control {
        VideoRateControl::Standard => {
            let target = format!("{bitrate}M");
            command.args(["-b:v", target.as_str()]);
        }
        VideoRateControl::Vbr2 => append_bounded_vbr(command, bitrate),
    }
}

/// Build the fixed encoder command shared by the host and its format regression tests.
fn encoder_command(
    encoder: &Path,
    audio: &Path,
    output: &Path,
    video_input: VideoInput,
    format: RecordingFormat,
    fps: u32,
    bitrate: u32,
    rate_control: VideoRateControl,
    speed: f64,
) -> Command {
    let mut command = Command::new(encoder);
    command.args(["-hide_banner", "-loglevel", "error", "-y"]);
    if !format.audio_only() {
        match video_input {
            // The platform encoder already produced Annex B H.264. Copying it
            // avoids decoding and re-encoding every frame inside FFmpeg.
            VideoInput::H264 => {
                command.args(["-f", "h264", "-r", &fps.to_string(), "-i", "pipe:0"]);
            }
            VideoInput::Png => {
                command.args([
                    // Keep image2pipe from buffering a probe window before the
                    // first frame is written.
                    "-probesize",
                    "32",
                    "-analyzeduration",
                    "0",
                    "-fpsprobesize",
                    "0",
                    "-f",
                    "image2pipe",
                    "-framerate",
                    &fps.to_string(),
                    "-vcodec",
                    "png",
                    "-i",
                    "pipe:0",
                ]);
            }
        }
    }
    command
        .args(["-f", "f32le", "-ar", "48000", "-ac", "2", "-i"])
        .arg(audio);
    if format.audio_only() {
        command.args(["-map", "0:a:0"]);
    } else {
        command.args(["-map", "0:v:0", "-map", "1:a:0"]);
        if format.copies_h264() {
            match video_input {
                VideoInput::H264 => {
                    command.args(["-c:v", "copy"]);
                }
                VideoInput::Png => {
                    command.args([
                        "-c:v",
                        "libx264",
                        "-preset",
                        "veryfast",
                        "-tune",
                        "zerolatency",
                        "-g",
                        &fps.to_string(),
                        "-keyint_min",
                        &fps.to_string(),
                        "-sc_threshold",
                        "0",
                        "-pix_fmt",
                        "yuv420p",
                    ]);
                    append_video_rate_control(&mut command, bitrate, rate_control);
                }
            }
        } else {
            match format {
                RecordingFormat::Webm => {
                    command.args([
                        "-c:v",
                        "libvpx-vp9",
                        "-g",
                        &fps.to_string(),
                        "-row-mt",
                        "1",
                        "-deadline",
                        "good",
                        "-cpu-used",
                        "4",
                        "-pix_fmt",
                        "yuv420p",
                    ]);
                    append_video_rate_control(&mut command, bitrate, rate_control);
                }
                RecordingFormat::Gif => {
                    command.args(["-vf", "split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse"]);
                }
                RecordingFormat::Apng => {
                    command.args(["-c:v", "apng", "-plays", "0"]);
                }
                RecordingFormat::Webp => {
                    command.args(["-c:v", "libwebp_anim", "-quality", "80", "-loop", "0"]);
                }
                _ => unreachable!(),
            }
        }
    }
    if format.has_audio() {
        if let Some(filter) = atempo_filter(speed) {
            command.args(["-filter:a", &filter]);
        }
    }
    match format {
        RecordingFormat::Mp4 | RecordingFormat::Mkv | RecordingFormat::Mov => {
            command.args(["-c:a", "aac"]);
        }
        RecordingFormat::Webm => {
            command.args(["-c:a", "libopus", "-b:a", "160k"]);
        }
        RecordingFormat::Gif | RecordingFormat::Apng | RecordingFormat::Webp => {
            command.args(["-an"]);
        }
        RecordingFormat::Mp3 => {
            command.args(["-c:a", "libmp3lame", "-b:a", "192k"]);
        }
        RecordingFormat::Flac => {
            command.args(["-c:a", "flac"]);
        }
        RecordingFormat::Wav => {
            command.args(["-c:a", "pcm_s16le"]);
        }
        RecordingFormat::Ogg => {
            command.args(["-c:a", "libvorbis", "-q:a", "5"]);
        }
    }
    match format {
        RecordingFormat::Mp4 | RecordingFormat::Mov => {
            command.args([
                "-movflags",
                "+empty_moov+default_base_moof+frag_keyframe",
                "-flush_packets",
                "1",
                "-f",
                format.extension(),
            ]);
        }
        RecordingFormat::Mkv => {
            command.args(["-flush_packets", "1", "-f", "matroska"]);
        }
        RecordingFormat::Webm => {
            command.args(["-flush_packets", "1", "-f", "webm"]);
        }
        RecordingFormat::Gif => {
            command.args(["-loop", "0", "-f", "gif"]);
        }
        RecordingFormat::Apng => {
            command.args(["-f", "apng"]);
        }
        RecordingFormat::Webp => {
            command.args(["-f", "webp"]);
        }
        RecordingFormat::Mp3 => {
            command.args(["-f", "mp3"]);
        }
        RecordingFormat::Flac => {
            command.args(["-f", "flac"]);
        }
        RecordingFormat::Wav => {
            command.args(["-f", "wav"]);
        }
        RecordingFormat::Ogg => {
            command.args(["-f", "ogg"]);
        }
    }
    command.arg(output);
    command
}

/// Launch the fixed encoder command. It never invokes a shell.
#[tauri::command]
pub async fn recording_start(host: State<'_, RecordingHost>, id: String) -> Result<()> {
    let entry = session(&host, &id)?;
    tauri::async_runtime::spawn_blocking(move || {
        check_active(&entry)?;
        let mut audio = entry.audio.lock().map_err(err)?;
        let file = audio.as_mut().ok_or("recording_audio_closed")?;
        if *entry.audio_bytes.lock().map_err(err)? != entry.expected_audio_bytes {
            return Err("recording_incomplete_audio".into());
        }
        file.flush().map_err(err)?;
        let output = entry.output.lock().map_err(err)?;
        let output_path = output.as_ref().ok_or("recording_output_closed")?.path();
        let mut child = entry.child.lock().map_err(err)?;
        if child.is_some() {
            return Err("recording_already_started".into());
        }
        let mut command = encoder_command(
            &entry.encoder,
            file.path(),
            output_path,
            entry.video_input,
            entry.format,
            entry.fps,
            entry.video_bitrate,
            entry.rate_control,
            entry.speed,
        );
        command
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::from(entry.log.reopen().map_err(err)?));
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x08000000);
        }
        let mut process = command
            .spawn()
            .map_err(|error| format!("recording_encoder_start:{error}"))?;
        *entry.input.lock().map_err(err)? = process.stdin.take();
        *child = Some(process);
        // Drop the writable handle but retain the temp file until encoding ends.
        Ok(())
    })
    .await
    .map_err(err)?
}

/// Write one PNG frame or one H.264 access unit in frame order.
#[tauri::command]
pub async fn recording_frame(host: State<'_, RecordingHost>, request: Request<'_>) -> Result<()> {
    let (id, bytes) = packet(request.body())?;
    let entry = session(&host, &id)?;
    tauri::async_runtime::spawn_blocking(move || {
        check_active(&entry)?;
        if entry.format.audio_only() {
            return Err("recording_invalid_frame".into());
        }
        let valid = match entry.video_input {
            VideoInput::Png => bytes.starts_with(b"\x89PNG\r\n\x1a\n"),
            VideoInput::H264 => bytes.starts_with(&[0, 0, 0, 1]) || bytes.starts_with(&[0, 0, 1]),
        };
        if !valid {
            return Err("recording_invalid_frame".into());
        }
        let mut count = entry.written_frames.lock().map_err(err)?;
        if *count >= entry.frame_count {
            return Err("recording_too_many_frames".into());
        }
        entry
            .input
            .lock()
            .map_err(err)?
            .as_mut()
            .ok_or("recording_not_started")?
            .write_all(&bytes)
            .map_err(err)?;
        *count += 1;
        Ok(())
    })
    .await
    .map_err(err)?
}

/// Stop a session; killing the process also unblocks a pending frame write.
#[tauri::command]
pub fn recording_cancel(host: State<'_, RecordingHost>, id: String) -> Result<()> {
    let entry = host.sessions.lock().map_err(err)?.remove(&id);
    if let Some(entry) = entry {
        let _publish = entry.publish.lock().map_err(err)?;
        entry.cancelled.store(true, Ordering::SeqCst);
        if let Some(child) = entry.child.lock().map_err(err)?.as_mut() {
            let _ = child.kill();
        }
    }
    Ok(())
}

/// Publish without requiring a viewer of the partial file to close its handle.
fn publish_output(output: NamedTempFile, target: &Path, baseline: Option<[u8; 32]>) -> Result<()> {
    let result = if baseline.is_some() {
        output.persist(target)
    } else {
        output.persist_noclobber(target)
    };
    match result {
        Ok(_) => Ok(()),
        Err(failure) => {
            if failure.error.kind() == std::io::ErrorKind::AlreadyExists {
                return Err("recording_destination_changed".into());
            }
            // When Windows refuses the rename because a reader holds the partial
            // file open, copy to a second same-volume staging file and publish that.
            #[cfg(windows)]
            if matches!(failure.error.raw_os_error(), Some(5 | 32 | 33)) {
                let parent = target.parent().ok_or("recording_invalid_destination")?;
                let extension = target
                    .extension()
                    .and_then(|value| value.to_str())
                    .map(|value| format!(".{value}"))
                    .unwrap_or_default();
                let copy = Builder::new()
                    .prefix(".redux-final-")
                    .suffix(&extension)
                    .tempfile_in(parent)
                    .map_err(err)?;
                fs::copy(failure.file.path(), copy.path()).map_err(err)?;
                if destination_hash(target)? != baseline {
                    return Err("recording_destination_changed".into());
                }
                return if baseline.is_some() {
                    copy.persist(target).map(|_| ()).map_err(err)
                } else {
                    copy.persist_noclobber(target).map(|_| ()).map_err(|error| {
                        if error.error.kind() == std::io::ErrorKind::AlreadyExists {
                            "recording_destination_changed".to_owned()
                        } else {
                            err(error)
                        }
                    })
                };
            }
            Err(err(failure))
        }
    }
}

/// Finish the stream and publish the output only after all frames encode successfully.
#[tauri::command]
pub async fn recording_finish(host: State<'_, RecordingHost>, id: String) -> Result<()> {
    let entry = session(&host, &id)?;
    let result = tauri::async_runtime::spawn_blocking(move || {
        check_active(&entry)?;
        if !entry.format.audio_only()
            && *entry.written_frames.lock().map_err(err)? != entry.frame_count
        {
            return Err("recording_incomplete_frames".into());
        }
        if *entry.audio_bytes.lock().map_err(err)? != entry.expected_audio_bytes {
            return Err("recording_incomplete_audio".into());
        }
        entry.input.lock().map_err(err)?.take();
        loop {
            check_active(&entry)?;
            let status = entry
                .child
                .lock()
                .map_err(err)?
                .as_mut()
                .ok_or("recording_not_started")?
                .try_wait()
                .map_err(err)?;
            if let Some(status) = status {
                if !status.success() {
                    let log = fs::read(entry.log.path()).unwrap_or_default();
                    return Err(format!(
                        "recording_encoder_failed:{}",
                        String::from_utf8_lossy(&log[..log.len().min(4096)])
                    ));
                }
                break;
            }
            std::thread::sleep(Duration::from_millis(100));
        }
        let _publish = entry.publish.lock().map_err(err)?;
        check_active(&entry)?;
        let output = entry
            .output
            .lock()
            .map_err(err)?
            .take()
            .ok_or("recording_output_closed")?;
        if destination_hash(&entry.target)? != entry.baseline {
            return Err("recording_destination_changed".into());
        }
        publish_output(output, &entry.target, entry.baseline)?;
        Ok(())
    })
    .await
    .map_err(err)?;
    host.sessions.lock().map_err(err)?.remove(&id);
    result
}

#[cfg(test)]
mod destination_tests {
    use super::{recording_target, RecordingFormat};
    use std::{
        fs,
        path::{Path, PathBuf},
    };

    /// Temporary output directory that cleans itself up after a test.
    struct TestDirectory(PathBuf);

    impl TestDirectory {
        fn new() -> Self {
            let path =
                std::env::temp_dir().join(format!("rpe-redux-recording-{}", uuid::Uuid::new_v4()));
            fs::create_dir_all(&path).unwrap();
            Self(path)
        }

        fn path(&self) -> &Path {
            &self.0
        }
    }

    impl Drop for TestDirectory {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn recording_target_accepts_a_matching_file_in_an_existing_directory() {
        let directory = TestDirectory::new();
        let selected = directory.path().join("capture.mp4");

        let target = recording_target(selected.to_str().unwrap(), RecordingFormat::Mp4).unwrap();

        assert_eq!(
            target,
            fs::canonicalize(directory.path())
                .unwrap()
                .join("capture.mp4")
        );
    }

    #[test]
    fn recording_target_rejects_a_wrong_extension_or_missing_directory() {
        let directory = TestDirectory::new();
        let wrong = directory.path().join("capture.mkv");
        assert_eq!(
            recording_target(wrong.to_str().unwrap(), RecordingFormat::Mp4).unwrap_err(),
            "recording_invalid_options"
        );
        let missing = directory.path().join("missing").join("capture.mp4");
        assert_eq!(
            recording_target(missing.to_str().unwrap(), RecordingFormat::Mp4).unwrap_err(),
            "recording_invalid_destination"
        );
    }

    #[test]
    fn recording_target_rejects_parent_and_device_names() {
        let directory = TestDirectory::new();
        let traversal = directory.path().join("..").join("capture.mp4");
        assert_eq!(
            recording_target(traversal.to_str().unwrap(), RecordingFormat::Mp4).unwrap_err(),
            "recording_invalid_destination"
        );
        let device = directory.path().join("CON.mp4");
        assert_eq!(
            recording_target(device.to_str().unwrap(), RecordingFormat::Mp4).unwrap_err(),
            "recording_invalid_destination"
        );
    }
}

#[cfg(test)]
mod streaming_tests {
    use super::*;
    use std::{thread, time::Instant};

    /// A player can keep the partial file open without preventing final publication.
    #[cfg(windows)]
    #[test]
    fn publishes_when_a_viewer_holds_the_partial_file_open() {
        use std::os::windows::fs::OpenOptionsExt;
        let dir = tempfile::tempdir().unwrap();
        for existing in [false, true] {
            let target = dir
                .path()
                .join(if existing { "replace.mp4" } else { "new.mp4" });
            if existing {
                fs::write(&target, b"original").unwrap();
            }
            let baseline = destination_hash(&target).unwrap();
            let mut partial = Builder::new()
                .suffix(".mp4")
                .tempfile_in(dir.path())
                .unwrap();
            partial.write_all(b"encoded video").unwrap();
            partial.flush().unwrap();
            let viewer = fs::OpenOptions::new()
                .read(true)
                .share_mode(1 | 2)
                .open(partial.path())
                .unwrap();
            publish_output(partial, &target, baseline).unwrap();
            assert_eq!(fs::read(&target).unwrap(), b"encoded video");
            drop(viewer);
        }
    }

    /// Exercise the actual encoder command before closing its input: the published
    /// fragments must decode at nonsequential timestamps while encoding continues.
    #[test]
    fn fragments_are_readable_and_seekable_before_encoder_finishes() {
        let encoder = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("resources/ffmpeg")
            .join(ENCODER_FILE);
        assert!(
            encoder.is_file(),
            "stage the bundled FFmpeg before running this test"
        );
        let dir = tempfile::tempdir().unwrap();
        let audio = dir.path().join("audio.raw");
        let output = dir.path().join("partial.mp4");
        fs::write(&audio, vec![0u8; 48_000 * 8 * 5]).unwrap();
        let mut frames = Vec::new();
        for color in ["red", "green", "blue", "yellow", "magenta"] {
            let mut generator = Command::new(&encoder);
            generator.args([
                "-v",
                "error",
                "-f",
                "lavfi",
                "-i",
                &format!("color={color}:s=64x64"),
                "-frames:v",
                "1",
                "-f",
                "image2pipe",
                "-vcodec",
                "png",
                "pipe:1",
            ]);
            #[cfg(windows)]
            {
                use std::os::windows::process::CommandExt;
                generator.creation_flags(0x08000000);
            }
            let frame = generator.output().unwrap();
            assert!(frame.status.success());
            frames.push(frame.stdout);
        }
        let mut command = encoder_command(
            &encoder,
            &audio,
            &output,
            VideoInput::Png,
            RecordingFormat::Mp4,
            30,
            2,
            VideoRateControl::Standard,
            1.0,
        );
        command
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::piped());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x08000000);
        }
        let mut child = command.spawn().unwrap();
        let mut input = child.stdin.take().unwrap();
        for frame in &frames {
            for _ in 0..30 {
                input.write_all(frame).unwrap();
            }
        }
        input.flush().unwrap();
        let deadline = Instant::now() + Duration::from_secs(30);
        loop {
            let bytes = fs::read(&output).unwrap_or_default();
            if bytes.windows(4).filter(|window| *window == b"moof").count() >= 4 {
                break;
            }
            assert!(
                child.try_wait().unwrap().is_none(),
                "encoder exited before input closed"
            );
            if Instant::now() >= deadline {
                let _ = child.kill();
                panic!("fragments did not flush before input closed");
            }
            thread::sleep(Duration::from_millis(50));
        }
        assert!(child.try_wait().unwrap().is_none());
        for (seek, channel) in [("2.2", 2), ("0.2", 0), ("1.5", 1)] {
            let mut decoder = Command::new(&encoder);
            decoder
                .args(["-v", "error", "-ss", seek, "-i"])
                .arg(&output)
                .args([
                    "-frames:v",
                    "1",
                    "-f",
                    "rawvideo",
                    "-pix_fmt",
                    "rgb24",
                    "pipe:1",
                ]);
            #[cfg(windows)]
            {
                use std::os::windows::process::CommandExt;
                decoder.creation_flags(0x08000000);
            }
            let result = decoder.output().unwrap();
            assert!(
                result.status.success()
                    && result.stdout.len() >= 3
                    && result.stdout[channel] > 70
                    && result.stdout[channel] > result.stdout[(channel + 1) % 3].saturating_add(30)
                    && result.stdout[channel] > result.stdout[(channel + 2) % 3].saturating_add(30),
                "seek {seek} failed: {}",
                String::from_utf8_lossy(&result.stderr)
            );
        }
        let mut audio_reader = Command::new(&encoder);
        audio_reader
            .args(["-v", "error", "-ss", "1.5", "-i"])
            .arg(&output)
            .args(["-vn", "-t", "0.1", "-f", "f32le", "pipe:1"]);
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            audio_reader.creation_flags(0x08000000);
        }
        let audio_sample = audio_reader.output().unwrap();
        assert!(
            audio_sample.status.success() && !audio_sample.stdout.is_empty(),
            "audio seek failed: {}",
            String::from_utf8_lossy(&audio_sample.stderr)
        );
        drop(input);
        let result = child.wait_with_output().unwrap();
        assert!(
            result.status.success(),
            "{}",
            String::from_utf8_lossy(&result.stderr)
        );
    }

    /// A platform-encoded H.264 stream is copied into the same fragmented MP4
    /// layout without a second video encode.
    #[test]
    fn encoded_h264_stream_is_muxed_without_reencoding() {
        let encoder = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("resources/ffmpeg")
            .join(ENCODER_FILE);
        let dir = tempfile::tempdir().unwrap();
        let video = dir.path().join("video.h264");
        let audio = dir.path().join("audio.raw");
        let output = dir.path().join("encoded.mp4");
        fs::write(&audio, vec![0u8; 48_000 * 8 * 2]).unwrap();
        let mut generator = Command::new(&encoder);
        generator
            .args([
                "-v",
                "error",
                "-f",
                "lavfi",
                "-i",
                "testsrc=size=64x64:rate=30",
                "-t",
                "2",
                "-c:v",
                "libx264",
                "-preset",
                "veryfast",
                "-bf",
                "0",
                "-pix_fmt",
                "yuv420p",
                "-f",
                "h264",
            ])
            .arg(&video);
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            generator.creation_flags(0x08000000);
        }
        assert!(generator.output().unwrap().status.success());
        let chunks = fs::read(&video).unwrap();
        let mut command = encoder_command(
            &encoder,
            &audio,
            &output,
            VideoInput::H264,
            RecordingFormat::Mp4,
            30,
            2,
            VideoRateControl::Standard,
            1.0,
        );
        command
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::piped());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x08000000);
        }
        let mut child = command.spawn().unwrap();
        child.stdin.take().unwrap().write_all(&chunks).unwrap();
        let result = child.wait_with_output().unwrap();
        assert!(
            result.status.success(),
            "{}",
            String::from_utf8_lossy(&result.stderr)
        );
        let mut decode = Command::new(&encoder);
        decode
            .args(["-v", "error", "-i"])
            .arg(&output)
            .args(["-f", "null", "-"]);
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            decode.creation_flags(0x08000000);
        }
        let decoded = decode.output().unwrap();
        assert!(
            decoded.status.success(),
            "{}",
            String::from_utf8_lossy(&decoded.stderr)
        );
    }
}

#[cfg(test)]
mod format_tests {
    use super::*;

    /// Collect the fixed argument list so assertions do not depend on the shell.
    fn args(command: &Command) -> Vec<String> {
        command
            .get_args()
            .map(|argument| argument.to_string_lossy().into_owned())
            .collect()
    }

    /// True when `pair` appears as consecutive arguments.
    fn has_pair(args: &[String], first: &str, second: &str) -> bool {
        args.windows(2)
            .any(|pair| pair[0] == first && pair[1] == second)
    }

    #[test]
    fn mkv_moves_h264_and_aac_without_reencoding() {
        let command = encoder_command(
            Path::new("ffmpeg"),
            Path::new("audio.raw"),
            Path::new("output.mkv"),
            VideoInput::H264,
            RecordingFormat::Mkv,
            60,
            12,
            VideoRateControl::Standard,
            1.0,
        );
        let args = args(&command);
        assert!(has_pair(&args, "-c:v", "copy"));
        assert!(has_pair(&args, "-c:a", "aac"));
        assert!(has_pair(&args, "-f", "matroska"));
        assert!(has_pair(&args, "-map", "0:v:0"));
        assert!(args.contains(&"output.mkv".to_owned()));
    }

    #[test]
    fn png_h264_fallback_uses_bounded_vbr() {
        let command = encoder_command(
            Path::new("ffmpeg"),
            Path::new("audio.raw"),
            Path::new("output.mp4"),
            VideoInput::Png,
            RecordingFormat::Mp4,
            60,
            12,
            VideoRateControl::Vbr2,
            1.0,
        );
        let args = args(&command);
        assert!(has_pair(&args, "-c:v", "libx264"));
        assert!(has_pair(&args, "-b:v", "12M"));
        assert!(has_pair(&args, "-maxrate", "24M"));
        assert!(has_pair(&args, "-bufsize", "48M"));
    }

    #[test]
    fn png_h264_fallback_uses_standard_bitrate() {
        let command = encoder_command(
            Path::new("ffmpeg"),
            Path::new("audio.raw"),
            Path::new("output.mp4"),
            VideoInput::Png,
            RecordingFormat::Mp4,
            60,
            12,
            VideoRateControl::Standard,
            1.0,
        );
        let args = args(&command);
        assert!(has_pair(&args, "-b:v", "12M"));
        assert!(!args.contains(&"-maxrate".to_owned()));
        assert!(!args.contains(&"-bufsize".to_owned()));
    }

    #[test]
    fn webm_reencodes_h264_to_vp9_and_opus() {
        let command = encoder_command(
            Path::new("ffmpeg"),
            Path::new("audio.raw"),
            Path::new("output.webm"),
            VideoInput::H264,
            RecordingFormat::Webm,
            30,
            8,
            VideoRateControl::Vbr2,
            1.0,
        );
        let args = args(&command);
        assert!(has_pair(&args, "-c:v", "libvpx-vp9"));
        assert!(has_pair(&args, "-b:v", "8M"));
        assert!(has_pair(&args, "-maxrate", "16M"));
        assert!(has_pair(&args, "-bufsize", "32M"));
        assert!(has_pair(&args, "-c:a", "libopus"));
        assert!(has_pair(&args, "-f", "webm"));
        assert!(has_pair(&args, "-i", "pipe:0"));
        assert!(!args.contains(&"copy".to_owned()));
    }

    #[test]
    fn gif_uses_the_palette_filter_and_drops_audio() {
        let command = encoder_command(
            Path::new("ffmpeg"),
            Path::new("audio.raw"),
            Path::new("output.gif"),
            VideoInput::Png,
            RecordingFormat::Gif,
            30,
            8,
            VideoRateControl::Standard,
            1.0,
        );
        let args = args(&command);
        assert!(has_pair(
            &args,
            "-vf",
            "split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse"
        ));
        assert!(args.contains(&"-an".to_owned()));
        assert!(has_pair(&args, "-f", "gif"));
        assert!(!args.contains(&"aac".to_owned()));
    }

    #[test]
    fn speed_splits_atempo_into_supported_stages() {
        for (speed, filter) in [
            (2.0, "atempo=2"),
            (4.0, "atempo=2,atempo=2"),
            (0.5, "atempo=0.5"),
            (1.25, "atempo=1.25"),
        ] {
            let command = encoder_command(
                Path::new("ffmpeg"),
                Path::new("audio.raw"),
                Path::new("output.mp4"),
                VideoInput::Png,
                RecordingFormat::Mp4,
                30,
                8,
                VideoRateControl::Standard,
                speed,
            );
            let args = args(&command);
            assert!(
                has_pair(&args, "-filter:a", filter),
                "{speed}x produced {args:?}"
            );
        }
        assert_eq!(atempo_filter(1.0), None);
    }

    #[test]
    fn animation_formats_skip_the_speed_filter() {
        for format in [
            RecordingFormat::Gif,
            RecordingFormat::Apng,
            RecordingFormat::Webp,
        ] {
            let command = encoder_command(
                Path::new("ffmpeg"),
                Path::new("audio.raw"),
                Path::new("output"),
                VideoInput::Png,
                format,
                30,
                8,
                VideoRateControl::Standard,
                4.0,
            );
            let args = args(&command);
            assert!(!args.contains(&"-filter:a".to_owned()), "{format:?}");
            assert!(args.contains(&"-an".to_owned()), "{format:?}");
        }
    }

    #[test]
    fn audio_only_outputs_apply_atempo() {
        let command = encoder_command(
            Path::new("ffmpeg"),
            Path::new("audio.raw"),
            Path::new("output.mp3"),
            VideoInput::Png,
            RecordingFormat::Mp3,
            30,
            8,
            VideoRateControl::Standard,
            2.0,
        );
        let args = args(&command);
        assert!(has_pair(&args, "-filter:a", "atempo=2"));
        assert!(has_pair(&args, "-c:a", "libmp3lame"));
    }

    #[test]
    fn rejects_invalid_speed_and_audio_sample_count() {
        assert!(recording_options_valid(60, 12, 60, 1.0, 1));
        assert!(recording_options_valid(60, 12, 60, 0.5, 1));
        assert!(recording_options_valid(60, 12, 60, 4.0, 1));
        for speed in [0.49, 4.01, f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
            assert!(
                !recording_options_valid(60, 12, 60, speed, 1),
                "speed {speed} was accepted"
            );
        }
        assert!(!recording_options_valid(60, 12, 60, 1.0, 0));
    }

    #[test]
    fn audio_only_mp3_maps_no_video_stream() {
        let command = encoder_command(
            Path::new("ffmpeg"),
            Path::new("audio.raw"),
            Path::new("output.mp3"),
            VideoInput::Png,
            RecordingFormat::Mp3,
            30,
            8,
            VideoRateControl::Standard,
            1.0,
        );
        let args = args(&command);
        assert!(has_pair(&args, "-map", "0:a:0"));
        assert!(!args.contains(&"0:v:0".to_owned()));
        assert!(!args.contains(&"pipe:0".to_owned()));
        assert!(has_pair(&args, "-c:a", "libmp3lame"));
        assert!(has_pair(&args, "-f", "mp3"));
    }

    #[test]
    fn format_identifiers_are_case_insensitive_and_match_extensions() {
        assert_eq!(
            RecordingFormat::parse("MP4").map(RecordingFormat::extension),
            Some("mp4")
        );
        assert_eq!(
            RecordingFormat::parse("WebM").map(RecordingFormat::extension),
            Some("webm")
        );
        assert_eq!(RecordingFormat::parse("av1"), None);
    }
}
