/**
 * Inspector pane for recording options, progress, cancellation, and the
 * React-owned canvases that feed the offline renderer.
 */
import { useEffect, useRef, useState } from "react";
import { Button } from "../../../../../design/components/button/Button.tsx";
import { InlineAlert } from "../../../../../design/components/alert/InlineAlert.tsx";
import { FieldRow } from "../../../../../design/components/field/FieldRow.tsx";
import { FieldReset } from "../../../../../design/components/field/FieldReset.tsx";
import { Input } from "../../../../../design/components/input/Input.tsx";
import { Segmented } from "../../../../../design/components/segmented/Segmented.tsx";
import { Select } from "../../../../../design/components/select/Select.tsx";
import { SliderField } from "../../../../../design/components/slider/SliderField.tsx";
import { beatValue, fromNumber, type Beat } from "../../../../../core/global/chart/timing/beat.ts";
import { useTranslation } from "../../../../../i18n/react.ts";
import { useEditorRuntime } from "../runtime/composition/EditorRuntime.tsx";
import { bindInspectorLifecycle } from "../../inspector/controller.ts";
import { BeatField } from "../../inspector/beat/BeatField.tsx";
import { RecordingTimeField } from "./RecordingTimeField.tsx";
import { recordingError } from "./recordingErrors.ts";
import { captureRecording } from "./recordingJob.ts";
import { startRecordingTask } from "./RecordingHosts.tsx";
import {
  closestRecordingResolution,
  DEFAULT_RECORDING_RATIO,
  DEFAULT_RECORDING_RESOLUTION,
  RECORDING_RATIOS,
  RECORDING_RESOLUTIONS,
  recordingDimensions,
  type RecordingRatio,
} from "./recordingResolution.ts";
import {
  chooseRecordingDestination,
  RECORDING_FORMATS,
  recordingFormatSpec,
  type RecordingFormat,
  type RecordingRateControl,
} from "../../../../../core/platform/desktop/recording.ts";
import {
  AUTO_VIDEO_BITRATE,
  estimateRecording,
  resolveVideoBitrateMbps,
} from "./recordingEstimate.ts";

/** Format names shown in the selector; every entry exists in both catalogs. */
const FORMAT_LABEL_KEYS = {
  mp4: "editor.recording.format.mp4",
  mkv: "editor.recording.format.mkv",
  mov: "editor.recording.format.mov",
  webm: "editor.recording.format.webm",
  gif: "editor.recording.format.gif",
  apng: "editor.recording.format.apng",
  webp: "editor.recording.format.webp",
  mp3: "editor.recording.format.mp3",
  flac: "editor.recording.format.flac",
  wav: "editor.recording.format.wav",
  ogg: "editor.recording.format.ogg",
} as const;

/** One-line consequence of the selected format, shown under the selector. */
const FORMAT_HINT_KEYS = {
  mp4: "editor.recording.formatHint.mp4",
  mkv: "editor.recording.formatHint.mkv",
  mov: "editor.recording.formatHint.mov",
  webm: "editor.recording.formatHint.webm",
  gif: "editor.recording.formatHint.gif",
  apng: "editor.recording.formatHint.apng",
  webp: "editor.recording.formatHint.webp",
  mp3: "editor.recording.formatHint.mp3",
  flac: "editor.recording.formatHint.flac",
  wav: "editor.recording.formatHint.wav",
  ogg: "editor.recording.formatHint.ogg",
} as const;

/** Output speeds offered by the inspector; the output frame rate never changes. */
const RECORDING_SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4] as const;

/** Decimal units, matching the Mbps value the encoder receives. */
function formatEstimatedSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "—";
  }
  if (bytes < 1_000_000) {
    return `${(bytes / 1_000).toFixed(bytes < 10_000 ? 1 : 0)} KB`;
  }
  const megabytes = bytes / 1_000_000;
  if (megabytes < 10) {
    return `${megabytes.toFixed(1)} MB`;
  }
  return megabytes < 1000 ? `${Math.round(megabytes)} MB` : `${(megabytes / 1000).toFixed(2)} GB`;
}

/** One-decimal output duration for the estimate row. */
function formatOutputSeconds(seconds: number): string {
  return Number.isFinite(seconds) && seconds > 0 ? seconds.toFixed(1) : "0.0";
}

type RecordingRangeMode = "beats" | "time";

/** Owns the recording workflow and its offscreen drawing hosts. */
export function RecordingPanel() {
  const { t } = useTranslation();
  const runtime = useEditorRuntime();
  const [format, setFormat] = useState<RecordingFormat>("mp4");
  const [ratio, setRatio] = useState<RecordingRatio>(DEFAULT_RECORDING_RATIO);
  const [resolution, setResolution] = useState(DEFAULT_RECORDING_RESOLUTION);
  const [customWidth, setCustomWidth] = useState("1920");
  const [customHeight, setCustomHeight] = useState("1080");
  const [fps, setFps] = useState("60");
  const [speed, setSpeed] = useState("1");
  const [autoBitrate, setAutoBitrate] = useState(true);
  const [bitrate, setBitrate] = useState("12");
  const [rateControl, setRateControl] = useState<RecordingRateControl>("standard");
  const [musicVolume, setMusicVolume] = useState("100");
  const [effectsVolume, setEffectsVolume] = useState("100");
  const [rangeMode, setRangeMode] = useState<RecordingRangeMode>("beats");
  // Keep each endpoint in the unit it was entered in.
  const [start, setStart] = useState<number | Beat>(0);
  const [end, setEnd] = useState<number | Beat>(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const controller = useRef<AbortController | null>(null);

  useEffect(
    () =>
      bindInspectorLifecycle("recording", {
        onOpen: () => {
          const duration = runtime?.audio.buffer?.duration ?? 0;
          // The default is always the whole song: the first sample through the
          // last one, with no remembered or partially selected interval.
          setStart(0);
          setEnd(duration);
          setError("");
        },
      }),
    [runtime],
  );

  useEffect(() => () => controller.current?.abort(), []);

  const formatSpec = recordingFormatSpec(format);
  /** Audio-only output ignores the canvas geometry and frame rate. */
  const videoDisabled = busy || formatSpec.audioOnly;
  /** Palette and audio-only formats never read the video bitrate field. */
  const bitrateDisabled = busy || !formatSpec.usesVideoBitrate;
  /** Silent animation formats drop the soundtrack entirely. */
  const volumeDisabled = busy || !formatSpec.hasAudio;
  /** Audio-only output has no video timeline to shorten, so it stays at 1x. */
  const speedDisabled = busy || formatSpec.audioOnly;
  const selectedSpeed = formatSpec.audioOnly ? 1 : Number(speed);
  const requestedBitrate = autoBitrate ? AUTO_VIDEO_BITRATE : Number(bitrate);
  const estimateSize = recordingDimensions(ratio, resolution, customWidth, customHeight);
  const effectiveBitrate = resolveVideoBitrateMbps(
    estimateSize.width,
    estimateSize.height,
    Number(fps),
    requestedBitrate,
  );
  const displayedBitrate = autoBitrate
    ? Number.isFinite(effectiveBitrate)
      ? String(effectiveBitrate)
      : ""
    : bitrate;
  const audioDuration = runtime?.audio.buffer?.duration ?? 0;
  const chartOffset = Number(runtime?.session.chart.META.offset ?? 0) / 1000;
  const tempo = runtime?.providers.session.tempo.get() ?? null;
  /** Resolve a beat endpoint on the song clock; time endpoints are already exact. */
  const secondsOf = (endpoint: number | Beat): number => {
    if (typeof endpoint === "number") {
      return endpoint;
    }
    if (!tempo) {
      return 0;
    }
    try {
      return tempo.seconds(beatValue(endpoint)) + chartOffset;
    } catch {
      return 0;
    }
  };
  /** Display a time endpoint in beat mode without changing the stored range. */
  const beatOf = (endpoint: number | Beat): Beat =>
    typeof endpoint === "number" ? fromNumber(tempo?.beat(endpoint - chartOffset) ?? 0) : endpoint;
  const startSeconds = secondsOf(start);
  const endSeconds = secondsOf(end);
  const estimatedSeconds = Math.max(0, endSeconds - startSeconds);
  const estimate = estimateRecording({
    width: estimateSize.width,
    height: estimateSize.height,
    fps: Number(fps),
    videoBitrate: requestedBitrate,
    seconds: estimatedSeconds,
    format,
    speed: selectedSpeed,
  });

  /** Accept a start inside the song and before the current end. */
  const commitStartSeconds = (seconds: number): boolean => {
    if (!tempo || !Number.isFinite(seconds) || seconds < 0 || seconds >= endSeconds) {
      return false;
    }
    setStart(seconds);
    return true;
  };
  /** Accept an end inside the song and after the current start. */
  const commitEndSeconds = (seconds: number): boolean => {
    if (
      !tempo ||
      !Number.isFinite(seconds) ||
      seconds <= startSeconds ||
      seconds > audioDuration + 1e-6
    ) {
      return false;
    }
    setEnd(Math.min(seconds, audioDuration));
    return true;
  };
  /** Keep an exact beat when the range is edited in beat mode. */
  const commitStartBeat = (beat: Beat): boolean => {
    const seconds = secondsOf(beat);
    if (seconds < 0 || seconds >= endSeconds) {
      return false;
    }
    setStart(beat);
    return true;
  };
  /** Keep an exact beat when the range is edited in beat mode. */
  const commitEndBeat = (beat: Beat): boolean => {
    const seconds = secondsOf(beat);
    if (seconds <= startSeconds || seconds > audioDuration + 1e-6) {
      return false;
    }
    setEnd(beat);
    return true;
  };

  /** Keep the current output area when switching to another fixed ratio. */
  const changeRatio = (next: RecordingRatio) => {
    if (next === ratio) {
      return;
    }
    const current = recordingDimensions(ratio, resolution, customWidth, customHeight);
    if (next === "custom") {
      setCustomWidth(String(current.width));
      setCustomHeight(String(current.height));
    } else {
      setResolution(closestRecordingResolution(next, current));
    }
    setRatio(next);
  };

  /** Captures the chart, asks for a destination, and queues the recording job. */
  const run = async () => {
    if (!runtime || controller.current) {
      return;
    }
    const songDuration = runtime.audio.buffer?.duration;
    if (
      songDuration !== undefined &&
      (startSeconds < 0 || endSeconds <= startSeconds || endSeconds > songDuration + 1e-6)
    ) {
      setError(t("editor.recording.invalid"));
      return;
    }
    const { width, height } = recordingDimensions(ratio, resolution, customWidth, customHeight);
    const videoBitrate = resolveVideoBitrateMbps(
      width,
      height,
      Number(fps),
      autoBitrate ? AUTO_VIDEO_BITRATE : Number(bitrate),
    );
    const abort = new AbortController();
    controller.current = abort;
    setBusy(true);
    setError("");
    let snapshot: ReturnType<typeof captureRecording> | null = null;
    try {
      const options = {
        format,
        width,
        height,
        fps: Number(fps),
        speed: selectedSpeed,
        videoBitrate,
        videoRateControl: rateControl,
        musicVolume: Number(musicVolume) / 100,
        effectsVolume: Number(effectsVolume) / 100,
        start: startSeconds,
        end: songDuration ? Math.min(endSeconds, songDuration) : endSeconds,
      };
      snapshot = captureRecording(runtime, options, abort.signal);
      // Begin copying resources immediately, while the file chooser is open.
      const pending = snapshot.pending;
      void pending.catch(() => {});
      const current = runtime.documents?.current?.path ?? "";
      const defaultName = `${current ? current.replace(/\.[^\\/.]+$/, "") : "recording"}.${formatSpec.extension}`;
      const path = await chooseRecordingDestination(defaultName, format);
      if (!path || abort.signal.aborted) {
        abort.abort();
        const captured = await pending.catch(() => null);
        captured?.[0]?.dispose();
        snapshot.skin.dispose();
        return;
      }
      await pending;
      abort.signal.throwIfAborted();
      startRecordingTask(snapshot, { ...options, path });
      snapshot = null;
    } catch (reason) {
      if (snapshot) {
        const captured = await snapshot.pending.catch(() => null);
        captured?.[0]?.dispose();
        snapshot.skin.dispose();
      }
      if (!abort.signal.aborted) {
        const detail = recordingError(reason);
        setError(t("editor.recording.error", { detail }));
      }
    } finally {
      controller.current = null;
      setBusy(false);
    }
  };

  return (
    <div className="recording-panel">
      <div className="recording-options">
        <FieldRow
          layout="inline"
          density="compact"
          htmlFor="recording-format"
          label={t("editor.recording.format")}
          control={(id) => (
            <Select
              id={id}
              value={format}
              disabled={busy}
              onChange={(event) => {
                const next = event.currentTarget.value as RecordingFormat;
                setFormat(next);
                if (recordingFormatSpec(next).audioOnly) {
                  setSpeed("1");
                }
              }}
            >
              {RECORDING_FORMATS.map((spec) => (
                <option key={spec.id} value={spec.id}>
                  {t(FORMAT_LABEL_KEYS[spec.id])}
                </option>
              ))}
            </Select>
          )}
        />
        <p className="hint recording-format-hint">{t(FORMAT_HINT_KEYS[format])}</p>
        <FieldRow
          layout="inline"
          density="compact"
          htmlFor="recording-speed"
          label={t("editor.recording.speed")}
          control={(id) => (
            <Select
              id={id}
              value={String(selectedSpeed)}
              disabled={speedDisabled}
              onChange={(event) => setSpeed(event.currentTarget.value)}
            >
              {RECORDING_SPEEDS.map((value) => (
                <option key={value} value={String(value)}>
                  {value}×
                </option>
              ))}
            </Select>
          )}
        />
        <FieldRow
          layout="inline"
          density="compact"
          htmlFor="recording-ratio"
          label={t("editor.recording.aspectRatio")}
          control={(id) => (
            <Select
              id={id}
              value={ratio}
              disabled={videoDisabled}
              onChange={(event) => changeRatio(event.currentTarget.value as RecordingRatio)}
            >
              {RECORDING_RATIOS.map((value) => (
                <option key={value} value={value}>
                  {value === "custom" ? t("editor.recording.custom") : value}
                </option>
              ))}
            </Select>
          )}
        />
        {ratio === "custom" ? (
          <>
            <FieldRow
              layout="inline"
              density="compact"
              htmlFor="recording-width"
              label={t("editor.recording.width")}
              control={(id) => (
                <Input
                  id={id}
                  type="number"
                  min="2"
                  max="3840"
                  step="2"
                  value={customWidth}
                  disabled={videoDisabled}
                  onChange={(event) => setCustomWidth(event.currentTarget.value)}
                />
              )}
            />
            <FieldRow
              layout="inline"
              density="compact"
              htmlFor="recording-height"
              label={t("editor.recording.height")}
              control={(id) => (
                <Input
                  id={id}
                  type="number"
                  min="2"
                  max="2160"
                  step="2"
                  value={customHeight}
                  disabled={videoDisabled}
                  onChange={(event) => setCustomHeight(event.currentTarget.value)}
                />
              )}
            />
          </>
        ) : (
          <FieldRow
            layout="inline"
            density="compact"
            htmlFor="recording-resolution"
            label={t("editor.recording.resolution")}
            control={(id) => (
              <Select
                id={id}
                value={resolution}
                disabled={videoDisabled}
                onChange={(event) => setResolution(event.currentTarget.value)}
              >
                {RECORDING_RESOLUTIONS[ratio].map((value) => (
                  <option key={value} value={value}>
                    {value.replace("x", " × ")}
                  </option>
                ))}
              </Select>
            )}
          />
        )}
        <FieldRow
          layout="inline"
          density="compact"
          label={t("editor.recording.fps")}
          control={(id) => (
            <Select
              id={id}
              value={fps}
              disabled={videoDisabled}
              onChange={(event) => setFps(event.currentTarget.value)}
            >
              <option value="30">30</option>
              <option value="60">60</option>
              <option value="120">120</option>
            </Select>
          )}
        />
        <FieldRow
          layout="inline"
          density="compact"
          htmlFor="recording-auto-bitrate"
          label={t("editor.recording.autoBitrateLabel")}
          reset={
            <FieldReset
              field="auto-bitrate"
              label={t("editor.recording.autoBitrateLabel")}
              dirty={!autoBitrate}
              onReset={() => setAutoBitrate(true)}
            />
          }
          control={
            <Input
              id="recording-auto-bitrate"
              type="checkbox"
              checked={autoBitrate}
              disabled={bitrateDisabled}
              onChange={(event) => {
                const next = event.currentTarget.checked;
                if (!next && Number.isFinite(effectiveBitrate)) {
                  // Leaving auto keeps the value the user just saw, so the field
                  // becomes adjustable with that value already filled in.
                  setBitrate(String(effectiveBitrate));
                }
                setAutoBitrate(next);
              }}
            />
          }
        />
        <FieldRow
          layout="inline"
          density="compact"
          disabled={autoBitrate}
          label={t("editor.recording.bitrate")}
          control={(id) => (
            <Input
              id={id}
              type="number"
              min="1"
              max="100"
              step="1"
              value={displayedBitrate}
              disabled={bitrateDisabled || autoBitrate}
              onChange={(event) => setBitrate(event.currentTarget.value)}
            />
          )}
        />
        <FieldRow
          layout="inline"
          density="compact"
          label={t("editor.recording.rateControl")}
          control={(id) => (
            <Select
              id={id}
              value={rateControl}
              disabled={bitrateDisabled}
              onChange={(event) =>
                setRateControl(event.currentTarget.value as RecordingRateControl)
              }
            >
              <option value="standard">{t("editor.recording.rateControl.standard")}</option>
              <option value="vbr2">{t("editor.recording.rateControl.vbr2")}</option>
            </Select>
          )}
        />
        <FieldRow
          layout="inline"
          density="compact"
          htmlFor="recording-music-volume"
          label={t("editor.recording.musicVolume")}
          control={
            <SliderField
              id="recording-music-volume"
              min={0}
              max={100}
              step={1}
              unit="%"
              value={musicVolume}
              disabled={volumeDisabled}
              onChange={(event) => setMusicVolume(event.currentTarget.value)}
            />
          }
        />
        <FieldRow
          layout="inline"
          density="compact"
          htmlFor="recording-effects-volume"
          label={t("editor.recording.effectsVolume")}
          control={
            <SliderField
              id="recording-effects-volume"
              min={0}
              max={100}
              step={1}
              unit="%"
              value={effectsVolume}
              disabled={volumeDisabled}
              onChange={(event) => setEffectsVolume(event.currentTarget.value)}
            />
          }
        />
        <FieldRow
          layout="inline"
          density="compact"
          label={t("editor.recording.rangeInput")}
          control={
            <Segmented<RecordingRangeMode>
              className="recording-range-mode"
              ariaLabel={t("editor.recording.rangeInput")}
              value={rangeMode}
              disabled={busy}
              options={[
                { value: "beats", label: t("editor.recording.mode.beats") },
                { value: "time", label: t("editor.recording.mode.time") },
              ]}
              onChange={setRangeMode}
            />
          }
        />
        <FieldRow
          layout="inline"
          density="compact"
          label={t(
            rangeMode === "beats" ? "editor.recording.startBeat" : "editor.recording.startTime",
          )}
          control={(id) =>
            rangeMode === "beats" ? (
              <BeatField
                id={id}
                value={beatOf(start)}
                disabled={busy}
                dataField="recording-start"
                onCommit={commitStartBeat}
              />
            ) : (
              <RecordingTimeField
                id={id}
                value={startSeconds}
                max={endSeconds}
                disabled={busy}
                onCommit={commitStartSeconds}
              />
            )
          }
        />
        <FieldRow
          layout="inline"
          density="compact"
          label={t(rangeMode === "beats" ? "editor.recording.endBeat" : "editor.recording.endTime")}
          control={(id) =>
            rangeMode === "beats" ? (
              <BeatField
                id={id}
                value={beatOf(end)}
                disabled={busy}
                dataField="recording-end"
                onCommit={commitEndBeat}
              />
            ) : (
              <RecordingTimeField
                id={id}
                value={endSeconds}
                max={audioDuration}
                disabled={busy}
                onCommit={commitEndSeconds}
              />
            )
          }
        />
      </div>
      <div className="recording-estimate">
        <span>{t("editor.recording.estimatedSize")}</span>
        <span className="recording-estimate-size">
          {formatEstimatedSize(estimate.bytes)} ·{" "}
          {t("editor.recording.outputDuration", {
            seconds: formatOutputSeconds(estimate.outputSeconds),
          })}
        </span>
      </div>
      {error && <InlineAlert className="recording-error">{error}</InlineAlert>}
      <div className="recording-actions redux-footer-bar">
        <div className="redux-footer-actions">
          {busy ? (
            <Button variant="outlined" onClick={() => controller.current?.abort()}>
              {t("editor.recording.cancel")}
            </Button>
          ) : (
            <Button variant="solid" onClick={() => void run()}>
              {t("editor.recording.export")}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
