/**
 * The timeline's vertical stretch control under the transport scrubber.
 *
 * It shows the scale the editor publishes and writes through the chrome command
 * contract. The rail is drawn here while the native range input stays on top for
 * pointer, keyboard, and accessibility, so the circular thumb shares the rail's
 * exact edges.
 */
import { useState, useSyncExternalStore, type CSSProperties } from "react";
import { SliderField } from "../../../design/components/slider/SliderField.tsx";
import { editorScale } from "../../../core/edit/state/publishedValues.ts";
import { useTranslation } from "../../../i18n/react.ts";
import { editorChromeCommands } from "../../contracts/editorCommands.ts";
import { useSetting } from "../../screens/settings/useSetting.ts";
import {
  STRETCH_BAR_MAX,
  STRETCH_BAR_STEP,
  stretchBarPercent,
  stretchBarRatio,
  stretchBarScale,
} from "./stretchBar.ts";

/** Whether the vertical stretch bar is enabled in settings. */
function useStretchBarEnabled(): boolean {
  return useSetting<boolean>("timeline-stretch-bar-enabled", true);
}

/**
 * Draws the vertical stretch rail, its circular thumb, and the caption below it.
 *
 * Dragging applies the mapped scale immediately; releasing or leaving the rail
 * commits the value so only the finished gesture reaches preferences.
 */
export function TimelineStretchBar() {
  const { t } = useTranslation();
  const enabled = useStretchBarEnabled();
  const stored = useSyncExternalStore(editorScale.subscribe, editorScale.get, editorScale.get);
  // While a gesture is running the rail keeps its own value: the editor applies
  // the scale immediately, but publishing every pointer step would repaint the
  // whole toolbar and fight the smooth draft.
  const [draft, setDraft] = useState<number | null>(null);
  if (!enabled) {
    return null;
  }
  const scale = Number(stored);
  const ratio = draft ?? stretchBarRatio(scale);
  const shownScale = draft === null ? scale : stretchBarScale(draft);
  const percent = stretchBarPercent(shownScale);
  const label = t("chrome.transport.stretch");
  const apply = (value: number) => {
    const next = Number(value);
    setDraft(next);
    editorChromeCommands()?.view.setTimelineScale(stretchBarScale(next));
  };
  const commit = () => {
    editorChromeCommands()?.view.commitTimelineScale();
    setDraft(null);
  };
  return (
    <div className="transport-stretch">
      <div
        className="transport-stretch-rail"
        style={{ "--stretch-ratio": `${ratio}%` } as CSSProperties}
      >
        <span className="transport-stretch-track" aria-hidden="true" />
        <span className="transport-stretch-thumb" aria-hidden="true" />
        <SliderField
          id="timeline-stretch"
          className="transport-stretch-input"
          data-slider="range"
          min={0}
          max={STRETCH_BAR_MAX}
          step={STRETCH_BAR_STEP}
          value={ratio}
          aria-label={label}
          aria-valuetext={`${percent}%`}
          data-tip-title={label}
          data-tip-desc={t("chrome.transport.stretchHint")}
          // The native input emits `input` for every pointer step and one final
          // `change`; the draft follows `input` alone so the trailing change
          // cannot resurrect it after the commit.
          onInput={(event) => apply(Number(event.currentTarget.value))}
          onChange={(event) => {
            editorChromeCommands()?.view.setTimelineScale(
              stretchBarScale(Number(event.currentTarget.value)),
            );
            // A pointer released outside the captured control still ends the
            // drag through the shared pointer-up fallback, which dispatches the
            // final `change` without a React pointer-up event.
            if (event.nativeEvent.type === "change") {
              commit();
            }
          }}
          onCommit={commit}
        />
      </div>
      <span className="transport-stretch-label">{label}</span>
    </div>
  );
}
