/**
 * The progress card's jump dialog.
 *
 * The dialog seeks the transport to a chart position entered either as chart
 * seconds or as a beat in the active judge line's tempo factor. Its open state
 * lives in `markerDialogs` because the progress menu, not the dialog, starts it.
 */
import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { InlineAlert } from "../../../design/components/alert/InlineAlert.tsx";
import { Button } from "../../../design/components/button/Button.tsx";
import { FieldRow } from "../../../design/components/field/FieldRow.tsx";
import { BeatInput } from "../../../design/components/input/BeatInput.tsx";
import { Input } from "../../../design/components/input/Input.tsx";
import { Modal } from "../../../design/components/modal/Modal.tsx";
import { Segmented } from "../../../design/components/segmented/Segmented.tsx";
import { beatValue, parseBeat } from "../../../core/global/chart/timing/beat.ts";
import { TempoMap } from "../../../core/global/chart/timing/tempo.ts";
import { useTranslation } from "../../../i18n/react.ts";
import { useEditorHostRuntime } from "../../contracts/editorHostReact.tsx";
import type { EditorHostRuntime } from "../../contracts/editorHost.ts";
import { seekProgress } from "./chartProgressState.ts";
import { closeMarkerDialog, getMarkerDialog, subscribeMarkerDialog } from "./markerDialogs.ts";

/** Which position representation the dialog reads. */
type JumpMode = "time" | "beat";

/** Audio-clock seconds that separate chart time zero from the media start. */
function chartOffset(runtime: EditorHostRuntime): number {
  return Number(runtime.getSession().chart.META.offset ?? 0) / 1000;
}

/** The active judge line's tempo factor, defaulting to normal speed. */
function lineFactor(runtime: EditorHostRuntime): number {
  const session = runtime.getSession();
  return session.chart.judgeLineList?.[session.lineIndex]?.bpmfactor ?? 1;
}

/** The transport's current position in chart seconds. */
function currentChartSeconds(runtime: EditorHostRuntime): number {
  return runtime.audio.time - chartOffset(runtime);
}

/** Prefills one mode from the transport's current position, at three decimals. */
function prefillValue(runtime: EditorHostRuntime | null, mode: JumpMode): string {
  if (!runtime) {
    return "0.000";
  }
  const seconds = currentChartSeconds(runtime);
  if (mode === "time") {
    return seconds.toFixed(3);
  }
  const session = runtime.getSession();
  return new TempoMap(session.chart.BPMList).beat(seconds, lineFactor(runtime)).toFixed(3);
}

/** The progress card's jump-to-time dialog, mounted only while it is open. */
export function JumpToTimeDialog() {
  const dialog = useSyncExternalStore(subscribeMarkerDialog, getMarkerDialog, getMarkerDialog);
  return dialog === "jump" ? <JumpDialog onClose={closeMarkerDialog} /> : null;
}

/** The open dialog's editable state and submit path. */
function JumpDialog({ onClose }: { onClose(): void }) {
  const { t } = useTranslation();
  const runtime = useEditorHostRuntime();
  const fieldId = useId();
  const field = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<JumpMode>("time");
  const [value, setValue] = useState(() => prefillValue(runtime, "time"));
  const [error, setError] = useState("");

  // The modal claims focus for its first button when it opens, so the value
  // field takes focus after that policy has run.
  useEffect(() => {
    field.current?.focus();
  }, []);

  /** Switches the input representation and re-prefills from the playhead. */
  const changeMode = (next: JumpMode) => {
    setMode(next);
    setValue(prefillValue(runtime, next));
    setError("");
  };

  /** Validates the current mode and seeks, or reports why it cannot. */
  const submit = () => {
    if (!runtime) {
      return;
    }
    const offset = chartOffset(runtime);
    let audioSeconds: number;
    if (mode === "time") {
      const text = value.trim();
      const seconds = Number(text);
      if (text === "" || !Number.isFinite(seconds) || seconds < 0) {
        setError(t("chrome.transport.jump.invalidTime"));
        return;
      }
      audioSeconds = seconds + offset;
    } else {
      try {
        const beat = beatValue(parseBeat(value));
        const session = runtime.getSession();
        audioSeconds =
          new TempoMap(session.chart.BPMList).seconds(beat, lineFactor(runtime)) + offset;
      } catch {
        setError(t("chrome.transport.jump.invalidBeat"));
        return;
      }
    }
    setError("");
    seekProgress(runtime.ui.progress, audioSeconds);
    onClose();
  };

  return (
    <Modal
      open
      onClose={onClose}
      label={t("chrome.transport.jump.title")}
      className="redux-jump-dialog"
      actions={
        <>
          <Button type="button" variant="outlined" onClick={onClose}>
            {t("common.action.cancel")}
          </Button>
          <Button type="button" variant="solid" onClick={submit}>
            {t("chrome.transport.jump.submit")}
          </Button>
        </>
      }
    >
      <Segmented
        label={t("chrome.transport.jump.mode")}
        value={mode}
        options={[
          { value: "time", label: t("chrome.transport.jump.mode.time") },
          { value: "beat", label: t("chrome.transport.jump.mode.beat") },
        ]}
        onChange={changeMode}
      />
      <FieldRow
        layout="inline"
        htmlFor={fieldId}
        label={mode === "time" ? t("chrome.transport.jump.time") : t("chrome.transport.jump.beat")}
        control={
          mode === "beat" ? (
            <BeatInput
              id={fieldId}
              ref={field}
              autoFocus
              value={value}
              onChange={(event) => {
                setValue(event.currentTarget.value);
                setError("");
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  submit();
                }
              }}
            />
          ) : (
            <Input
              id={fieldId}
              ref={field}
              type="text"
              inputMode="decimal"
              autoFocus
              value={value}
              onChange={(event) => {
                setValue(event.currentTarget.value);
                setError("");
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  submit();
                }
              }}
            />
          )
        }
      />
      {error && <InlineAlert>{error}</InlineAlert>}
    </Modal>
  );
}
