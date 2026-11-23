/**
 * Browser-side H.264 encoding for the recording path.
 *
 * WebCodecs lets the platform encoder turn each rendered canvas into a compact
 * Annex B chunk. The native host then only muxes those chunks with the audio,
 * instead of receiving full frames and encoding them again.
 */
export interface RecordingVideoEncoderOptions {
  readonly width: number;
  readonly height: number;
  readonly fps: number;
  readonly bitrateMbps: number;
  /** Use the encoder's target bitrate as an average for content-adaptive VBR. */
  readonly bitrateMode?: "constant" | "variable";
}

/** A configured encoder that writes chunks in the order they are produced. */
export interface RecordingVideoEncoder {
  /** Encode one rendered canvas at the next timeline index. */
  encode(canvas: HTMLCanvasElement, index: number): Promise<void>;
  /** Flush the encoder and write every remaining chunk. */
  finish(): Promise<void>;
  /** Release the encoder after a cancel or failure. */
  dispose(): void;
}

// Highest level first: the platform still checks the geometry, and a lower
// level is accepted when the higher one is not. 4K is commonly unsupported by
// the platform encoder, which leaves the PNG fallback in charge.
const H264_CODECS = [
  "avc1.640034",
  "avc1.640033",
  "avc1.64002a",
  "avc1.640028",
  "avc1.4d0033",
  "avc1.4d002a",
] as const;

/** The encoded chunk writer owned by the native recording session. */
type WriteChunk = (chunk: Uint8Array) => Promise<void>;

/**
 * Pick a supported H.264 configuration, or null when the platform encoder
 * cannot take this geometry. Unsupported geometry deliberately falls back to
 * the existing PNG path rather than failing the export.
 */
export async function selectRecordingVideoConfig(
  options: RecordingVideoEncoderOptions,
): Promise<VideoEncoderConfig | null> {
  if (
    typeof VideoEncoder === "undefined" ||
    !Number.isFinite(options.bitrateMbps) ||
    options.bitrateMbps <= 0
  ) {
    return null;
  }
  const bitrateMode = options.bitrateMode ?? "variable";
  const bitrate = Math.round(options.bitrateMbps * 1_000_000);
  for (const codec of H264_CODECS) {
    const config: VideoEncoderConfig = {
      codec,
      width: options.width,
      height: options.height,
      bitrate,
      bitrateMode,
      framerate: options.fps,
      hardwareAcceleration: "prefer-hardware",
      // The native host muxes the raw Annex B stream with `-c:v copy`, which
      // assigns timestamps in write order. A quality profile may enable
      // B-frames and emit chunks in decode order; realtime keeps output in
      // presentation order so the copied stream plays back correctly.
      latencyMode: "realtime",
      avc: { format: "annexb" },
    };
    try {
      const support = await VideoEncoder.isConfigSupported(config);
      if (support.supported) {
        return support.config ?? config;
      }
    } catch {
      // A rejected codec is simply not the one this platform offers.
    }
  }
  return null;
}

/** Create the encoder and its ordered chunk-writing loop. */
export function createRecordingVideoEncoder(
  config: VideoEncoderConfig,
  fps: number,
  writeChunk: WriteChunk,
): RecordingVideoEncoder {
  const keyframeInterval = Math.max(1, Math.round(fps));
  const queue: Uint8Array[] = [];
  let failure: unknown = null;
  let writeFailure: unknown = null;
  let closed = false;
  let wake: (() => void) | null = null;

  const notify = () => {
    const resolve = wake;
    wake = null;
    resolve?.();
  };
  const encoder = new VideoEncoder({
    output(chunk) {
      const bytes = new Uint8Array(chunk.byteLength);
      chunk.copyTo(bytes);
      queue.push(bytes);
      notify();
    },
    error(error) {
      failure = error;
      notify();
    },
  });
  encoder.configure(config);

  // The native stream must receive chunks in production order. Encoding stays
  // ahead of this loop, so the queue holds only the small compressed chunks.
  const drained = (async () => {
    while (true) {
      if (failure) {
        throw failure;
      }
      const chunk = queue.shift();
      if (chunk) {
        await writeChunk(chunk);
        continue;
      }
      if (closed) {
        return;
      }
      await new Promise<void>((resolve) => {
        wake = resolve;
      });
    }
  })().catch((error: unknown) => {
    writeFailure = error;
  });

  const check = () => {
    if (failure) {
      throw failure;
    }
    if (writeFailure) {
      throw writeFailure;
    }
  };

  return {
    async encode(canvas, index) {
      check();
      const timestamp = Math.round((index * 1_000_000) / fps);
      const frame = new VideoFrame(canvas, {
        timestamp,
        duration: Math.round(1_000_000 / fps),
      });
      try {
        encoder.encode(frame, { keyFrame: index % keyframeInterval === 0 });
      } finally {
        frame.close();
      }
      while (encoder.encodeQueueSize > 8) {
        await new Promise((resolve) => setTimeout(resolve, 0));
        check();
      }
    },
    async finish() {
      try {
        await encoder.flush();
      } finally {
        closed = true;
        notify();
      }
      await drained;
      check();
      encoder.close();
    },
    dispose() {
      closed = true;
      notify();
      try {
        encoder.close();
      } catch {
        // Closing an encoder that already failed is allowed to be a no-op.
      }
    },
  };
}
