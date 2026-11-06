/** Desktop adapter for the bounded audio and frame stream sent to the video encoder. */
import { invoke } from "@tauri-apps/api/core";
import { dialogDefaultPath, rememberDialogFile } from "./dialogPath.ts";

/** Container and codec profile understood by the native recording host. */
export type RecordingFormat =
  "mp4" | "mkv" | "mov" | "webm" | "gif" | "apng" | "webp" | "mp3" | "flac" | "wav" | "ogg";

/** Video rate-control profile used by the chart renderer. */
export type RecordingRateControl = "standard" | "vbr2";

/** One selectable output format and the rules the recording surface follows. */
export interface RecordingFormatSpec {
  readonly id: RecordingFormat;
  /** Destination extension, also used for the partial file. */
  readonly extension: string;
  /** True when the soundtrack is the only stream in the output. */
  readonly audioOnly: boolean;
  /** True when the output contains an audio stream at all. */
  readonly hasAudio: boolean;
  /** True when FFmpeg always re-encodes the video instead of copying H.264. */
  readonly transcodesVideo: boolean;
  /** True when the selected video bitrate can affect the output. */
  readonly usesVideoBitrate: boolean;
}

/** Ordered format list shared by the inspector and the destination chooser. */
export const RECORDING_FORMATS: readonly RecordingFormatSpec[] = [
  {
    id: "mp4",
    extension: "mp4",
    audioOnly: false,
    hasAudio: true,
    transcodesVideo: false,
    usesVideoBitrate: true,
  },
  {
    id: "mkv",
    extension: "mkv",
    audioOnly: false,
    hasAudio: true,
    transcodesVideo: false,
    usesVideoBitrate: true,
  },
  {
    id: "mov",
    extension: "mov",
    audioOnly: false,
    hasAudio: true,
    transcodesVideo: false,
    usesVideoBitrate: true,
  },
  {
    id: "webm",
    extension: "webm",
    audioOnly: false,
    hasAudio: true,
    transcodesVideo: true,
    usesVideoBitrate: true,
  },
  {
    id: "gif",
    extension: "gif",
    audioOnly: false,
    hasAudio: false,
    transcodesVideo: true,
    usesVideoBitrate: false,
  },
  {
    id: "apng",
    extension: "apng",
    audioOnly: false,
    hasAudio: false,
    transcodesVideo: true,
    usesVideoBitrate: false,
  },
  {
    id: "webp",
    extension: "webp",
    audioOnly: false,
    hasAudio: false,
    transcodesVideo: true,
    usesVideoBitrate: false,
  },
  {
    id: "mp3",
    extension: "mp3",
    audioOnly: true,
    hasAudio: true,
    transcodesVideo: false,
    usesVideoBitrate: false,
  },
  {
    id: "flac",
    extension: "flac",
    audioOnly: true,
    hasAudio: true,
    transcodesVideo: false,
    usesVideoBitrate: false,
  },
  {
    id: "wav",
    extension: "wav",
    audioOnly: true,
    hasAudio: true,
    transcodesVideo: false,
    usesVideoBitrate: false,
  },
  {
    id: "ogg",
    extension: "ogg",
    audioOnly: true,
    hasAudio: true,
    transcodesVideo: false,
    usesVideoBitrate: false,
  },
];

/** Format rules for an id; missing values fall back to the default MP4 profile. */
export function recordingFormatSpec(format: RecordingFormat | undefined): RecordingFormatSpec {
  return RECORDING_FORMATS.find((spec) => spec.id === format) ?? RECORDING_FORMATS[0];
}

/** Fixed-rate output requested by the recording surface. */
export interface DesktopRecordingOptions {
  readonly path: string;
  /** Encoded chunks when the platform encoder is available, PNG frames otherwise. */
  readonly videoInput: "h264" | "png";
  readonly format: RecordingFormat;
  readonly fps: number;
  readonly frameCount: number;
  /** Song seconds advanced per output frame; the encoder compresses audio by this factor. */
  readonly speed: number;
  /** Source PCM samples expected before `atempo`; eight bytes per stereo frame. */
  readonly audioSampleCount: number;
  readonly videoBitrate: number;
  readonly videoRateControl: RecordingRateControl;
}

/** One native recording session with its staging files and encoder process. */
export interface DesktopRecording {
  /** Growing partial output; complete fragments can be opened while encoding. */
  readonly partialPath: string;
  writeAudio(chunk: Uint8Array): Promise<void>;
  start(): Promise<void>;
  /** One PNG frame or one Annex B H.264 access unit, as the session declared. */
  writeFrame(frame: Uint8Array): Promise<void>;
  finish(): Promise<void>;
  cancel(): Promise<void>;
}

/** Prefix the session id to a binary payload sent to the encoder. */
function packet(id: string, data: Uint8Array): Uint8Array {
  const identifier = new TextEncoder().encode(id);
  if (identifier.length !== 36) {
    throw new Error("Invalid recording session identifier");
  }
  const body = new Uint8Array(identifier.length + data.length);
  body.set(identifier);
  body.set(data, identifier.length);
  return body;
}

/** Begin one native session; callers cancel it on every unsuccessful exit. */
export async function beginDesktopRecording(
  options: DesktopRecordingOptions,
): Promise<DesktopRecording> {
  const { id, partialPath } = await invoke<{ id: string; partialPath: string }>("recording_begin", {
    path: options.path,
    videoInput: options.videoInput,
    format: options.format,
    fps: options.fps,
    frameCount: options.frameCount,
    speed: options.speed,
    audioSampleCount: options.audioSampleCount,
    videoBitrate: options.videoBitrate,
    videoRateControl: options.videoRateControl,
  });
  let finished = false;
  return {
    partialPath,
    writeAudio: (chunk) => invoke("recording_audio", packet(id, chunk)),
    start: () => invoke("recording_start", { id }),
    writeFrame: (frame) => invoke("recording_frame", packet(id, frame)),
    async finish() {
      await invoke("recording_finish", { id });
      finished = true;
    },
    async cancel() {
      if (!finished) {
        await invoke("recording_cancel", { id });
        finished = true;
      }
    },
  };
}

/** Ask Windows for the output file, including its standard overwrite confirmation. */
export async function chooseRecordingDestination(
  defaultPath: string,
  format: RecordingFormat,
): Promise<string | null> {
  const { save } = await import("@tauri-apps/plugin-dialog");
  const spec = recordingFormatSpec(format);
  const suggested = /[\\/]/.test(defaultPath)
    ? defaultPath
    : (dialogDefaultPath("recording", defaultPath) ?? defaultPath);
  const path = await save({
    defaultPath: suggested,
    filters: [{ name: spec.id.toUpperCase(), extensions: [spec.extension] }],
  });
  if (path) {
    rememberDialogFile("recording", path);
  }
  return path;
}
