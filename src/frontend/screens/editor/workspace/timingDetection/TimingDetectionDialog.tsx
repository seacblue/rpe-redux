/**
 * The timing detector's body: the measured BPM/offset pair, a beat preview, and
 * the editable fields with whole-beat offset nudges.
 *
 * Detection either returns one precise answer or no answer at all, so the
 * dialog never shows a made-up fallback tempo. A missing pulse gets one short
 * "not found" message and a retry action.
 */
import { Button } from "../../../../../design/components/button/Button.tsx";
import { IconButton } from "../../../../../design/components/button/IconButton.tsx";
import { InlineAlert } from "../../../../../design/components/alert/InlineAlert.tsx";
import { FieldRow } from "../../../../../design/components/field/FieldRow.tsx";
import { Input } from "../../../../../design/components/input/Input.tsx";
import { Icon } from "../../../../../design/components/icon/Icon.tsx";
import { useTranslation } from "../../../../../i18n/react.ts";
import {
  roundMeasuredTiming,
  type BeatDetectionResult,
} from "../../../../../core/media/beatDetection.ts";
import { shiftOffsetByBeats } from "./timingDetectionModel.ts";

/** What the host knows before the first result exists. */
export type TimingDetectionStatus = "loading" | "ready" | "no-audio" | "not-found" | "error";

/** Format one measured value at the detector's three-decimal precision. */
function measuredText(value: number): string {
  return Number.isFinite(value) ? roundMeasuredTiming(value).toFixed(3) : "—";
}

/** Draw the waveform and the detected beat grid as a compact preview strip. */
function BeatPreview({ result }: { result: BeatDetectionResult }) {
  const { t } = useTranslation();
  const width = 960;
  const height = 72;
  const middle = height / 2;
  const amplitude = middle - 6;
  const peaks = result.waveform.peaks;
  const duration = result.duration;
  if (!peaks.length || !(duration > 0)) {
    return null;
  }
  const stride = Math.max(1, Math.ceil(peaks.length / 640));
  const top: string[] = [];
  const bottom: string[] = [];
  for (let index = 0; index < peaks.length; index += stride) {
    const x = (index / Math.max(1, peaks.length - 1)) * width;
    const value = Math.max(0, Math.min(1, peaks[index] ?? 0)) * amplitude;
    top.push(`${x.toFixed(1)} ${(middle - value).toFixed(1)}`);
    bottom.push(`${x.toFixed(1)} ${(middle + value).toFixed(1)}`);
  }
  const wave = `M${top.join(" L")} L${bottom.reverse().join(" L")} Z`;
  const beats = [...result.beatTimes];
  const visible = beats.filter((time) => time >= 0 && time <= duration);
  const beatStride = Math.max(1, Math.ceil(visible.length / 480));
  return (
    <div className="timing-detection-preview">
      <svg
        className="timing-detection-preview-canvas"
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={t("editorPanels.timingDetection.previewLabel")}
      >
        <path className="timing-detection-preview-wave" d={wave} />
        {visible.map((time, index) =>
          index % beatStride === 0 ? (
            <line
              key={`${time}-${index}`}
              className={`timing-detection-preview-beat${index % 4 === 0 ? " is-downbeat" : ""}`}
              x1={(time / duration) * width}
              y1={4}
              x2={(time / duration) * width}
              y2={height - 4}
            />
          ) : null,
        )}
      </svg>
      <span className="timing-detection-preview-label">
        {t("editorPanels.timingDetection.previewLabel")}
      </span>
    </div>
  );
}

/** The detector dialog body. */
export function TimingDetectionDialog({
  status,
  result,
  error,
  bpm,
  offset,
  onBpm,
  onOffset,
  onPickAudio,
  onRetry,
}: {
  status: TimingDetectionStatus;
  result: BeatDetectionResult | null;
  error: string;
  bpm: string;
  offset: string;
  onBpm(value: string): void;
  onOffset(value: string): void;
  onPickAudio(): void;
  onRetry(): void;
}) {
  const { t } = useTranslation();

  if (status === "loading") {
    return (
      <div className="timing-detection-loading" role="status">
        <Icon name="bpm" size={28} />
        <strong>{t("editorPanels.timingDetection.analyzing")}</strong>
        <span>{t("editorPanels.timingDetection.analyzingHint")}</span>
      </div>
    );
  }

  if (status === "no-audio") {
    return (
      <div className="timing-detection-empty">
        <InlineAlert tone="info" title={t("editorPanels.timingDetection.noAudioTitle")}>
          {t("editorPanels.timingDetection.noAudioBody")}
        </InlineAlert>
        <div className="timing-detection-empty-actions">
          <Button variant="outlined" onClick={onPickAudio}>
            <Icon name="music" size={16} />
            {t("editorPanels.timingDetection.pickAudio")}
          </Button>
        </div>
      </div>
    );
  }

  if (status === "not-found") {
    return (
      <div className="timing-detection-empty">
        <InlineAlert tone="warning">{t("editorPanels.timingDetection.notFound")}</InlineAlert>
        <div className="timing-detection-empty-actions">
          <Button variant="outlined" onClick={onRetry}>
            <Icon name="refresh" size={16} />
            {t("editorPanels.timingDetection.retry")}
          </Button>
        </div>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="timing-detection-empty">
        <InlineAlert tone="danger" title={t("editorPanels.timingDetection.errorTitle")}>
          {error || t("editorPanels.timingDetection.errorBody")}
        </InlineAlert>
        <div className="timing-detection-empty-actions">
          <Button variant="outlined" onClick={onRetry}>
            <Icon name="refresh" size={16} />
            {t("editorPanels.timingDetection.retry")}
          </Button>
        </div>
      </div>
    );
  }

  if (!result) {
    return null;
  }
  const numericBpm = Number(bpm);
  const numericOffset = Number(offset);
  const displayBpm = numericBpm > 0 && Number.isFinite(numericBpm) ? numericBpm : result.bpm;
  const displayOffset = Number.isFinite(numericOffset) ? numericOffset : result.offsetMs;
  const shift = (beats: number) => {
    const next = shiftOffsetByBeats(displayOffset, displayBpm, beats);
    if (next !== null) {
      onOffset(String(next));
    }
  };
  return (
    <div className="timing-detection">
      <div className="timing-detection-summary">
        <div className="timing-detection-summary-item">
          <span className="timing-detection-summary-label">
            {t("editorPanels.timingDetection.bpm")}
          </span>
          <strong className="timing-detection-summary-value">{measuredText(displayBpm)}</strong>
        </div>
        <div className="timing-detection-summary-item">
          <span className="timing-detection-summary-label">
            {t("editorPanels.timingDetection.offset")}
          </span>
          <strong className="timing-detection-summary-value">
            {measuredText(displayOffset)}
            <span className="timing-detection-summary-unit">ms</span>
          </strong>
        </div>
      </div>

      <BeatPreview result={result} />

      <div className="timing-detection-manual">
        <FieldRow
          layout="inline"
          density="compact"
          label={t("editorPanels.timingDetection.bpm")}
          control={(id) => (
            <div className="timing-detection-nudge">
              <IconButton
                icon="minus"
                size={14}
                label={t("editorPanels.timingDetection.bpmDown")}
                onClick={() => onBpm(String(roundMeasuredTiming(Math.max(1, displayBpm - 0.1))))}
              />
              <Input
                id={id}
                type="number"
                step="any"
                value={bpm}
                textAlign="center"
                onChange={(event) => onBpm(event.currentTarget.value)}
              />
              <IconButton
                icon="plus"
                size={14}
                label={t("editorPanels.timingDetection.bpmUp")}
                onClick={() => onBpm(String(roundMeasuredTiming(displayBpm + 0.1)))}
              />
            </div>
          )}
        />
        <FieldRow
          layout="inline"
          density="compact"
          className="timing-detection-offset-field"
          label={t("editorPanels.timingDetection.offset")}
          control={(id) => (
            <div className="timing-detection-offset">
              <div className="timing-detection-nudge">
                <IconButton
                  icon="minus"
                  size={14}
                  label={t("editorPanels.timingDetection.offsetDown")}
                  onClick={() => onOffset(String(roundMeasuredTiming(displayOffset - 1)))}
                />
                <Input
                  id={id}
                  type="number"
                  step="any"
                  value={offset}
                  textAlign="center"
                  onChange={(event) => onOffset(event.currentTarget.value)}
                />
                <IconButton
                  icon="plus"
                  size={14}
                  label={t("editorPanels.timingDetection.offsetUp")}
                  onClick={() => onOffset(String(roundMeasuredTiming(displayOffset + 1)))}
                />
              </div>
              <div className="timing-detection-beat-nudge">
                <Button
                  variant="outlined"
                  size="sm"
                  iconText
                  title={t("editorPanels.timingDetection.offsetBeatUp")}
                  onClick={() => shift(1)}
                >
                  <Icon name="plus" size={14} />
                  {t("editorPanels.timingDetection.offsetBeatUpShort")}
                </Button>
                <Button
                  variant="outlined"
                  size="sm"
                  iconText
                  title={t("editorPanels.timingDetection.offsetBeatDown")}
                  onClick={() => shift(-1)}
                >
                  <Icon name="minus" size={14} />
                  {t("editorPanels.timingDetection.offsetBeatDownShort")}
                </Button>
              </div>
            </div>
          )}
        />
      </div>

      {error && <InlineAlert tone="danger">{error}</InlineAlert>}
    </div>
  );
}
