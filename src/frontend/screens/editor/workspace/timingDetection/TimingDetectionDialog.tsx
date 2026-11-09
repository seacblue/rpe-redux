/**
 * The timing detector's body: the editable BPM/offset pair with tempo scaling
 * and whole-beat offset nudges.
 *
 * Detection either returns one precise answer or no answer at all, so the
 * dialog never shows a made-up fallback tempo. A missing pulse gets one short
 * "not found" message and a retry action.
 */
import { Button } from "../../../../../design/components/button/Button.tsx";
import { InlineAlert } from "../../../../../design/components/alert/InlineAlert.tsx";
import { FieldRow } from "../../../../../design/components/field/FieldRow.tsx";
import { Input } from "../../../../../design/components/input/Input.tsx";
import { Icon } from "../../../../../design/components/icon/Icon.tsx";
import { useTranslation } from "../../../../../i18n/react.ts";
import type { BeatDetectionResult } from "../../../../../core/media/beatDetection.ts";
import { scaleMeasuredBpm, shiftOffsetByBeats } from "./timingDetectionModel.ts";

/** What the host knows before the first result exists. */
export type TimingDetectionStatus = "loading" | "ready" | "no-audio" | "not-found" | "error";

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
  const rescale = (factor: number) => {
    const next = scaleMeasuredBpm(displayBpm, factor);
    if (next !== null) {
      onBpm(String(next));
    }
  };
  return (
    <div className="timing-detection">
      <p className="timing-detection-intro">{t("editorPanels.timingDetection.intro")}</p>

      <div className="timing-detection-manual">
        <FieldRow
          layout="inline"
          density="compact"
          label={t("editorPanels.timingDetection.bpm")}
          control={(id) => (
            <Input
              id={id}
              type="number"
              step="any"
              value={bpm}
              textAlign="center"
              onChange={(event) => onBpm(event.currentTarget.value)}
            />
          )}
          footer={
            <div className="timing-detection-field-actions">
              <Button variant="outlined" size="sm" onClick={() => rescale(0.5)}>
                {t("editorPanels.timingDetection.bpmHalf")}
              </Button>
              <Button variant="outlined" size="sm" onClick={() => rescale(2)}>
                {t("editorPanels.timingDetection.bpmDouble")}
              </Button>
            </div>
          }
        />
        <FieldRow
          layout="inline"
          density="compact"
          label={t("editorPanels.timingDetection.offset")}
          control={(id) => (
            <Input
              id={id}
              type="number"
              step="any"
              value={offset}
              textAlign="center"
              onChange={(event) => onOffset(event.currentTarget.value)}
            />
          )}
          footer={
            <div className="timing-detection-field-actions">
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
            </div>
          }
        />
      </div>

      {error && <InlineAlert tone="danger">{error}</InlineAlert>}
    </div>
  );
}
