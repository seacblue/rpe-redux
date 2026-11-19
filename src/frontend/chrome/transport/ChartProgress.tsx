/**
 * The shared transport card under the toolbar.
 *
 * It appears whenever a document is open. The scrubber, spectrum, timeline markers,
 * their menu, and the vertical stretch rail are attached to the transport surface
 * this component renders.
 */
import { memo, useSyncExternalStore, type CSSProperties } from "react";
import { useEditorHostRuntime, useEditorHostValue } from "../../contracts/editorHostReact.tsx";
import { SliderField } from "../../../design/components/slider/SliderField.tsx";
import { useTranslation } from "../../../i18n/react.ts";
import { useTransportSurface } from "./TransportDomSurface.tsx";
import { editorLoopRange } from "../../../core/edit/state/publishedValues.ts";
import {
  getEditorVisibility,
  subscribeToEditorVisibility,
} from "../../../core/edit/state/visibility.ts";
import { TimelineMarkersView } from "./TimelineMarkers.tsx";
import { TimelineStretchBar } from "./TimelineStretchBar.tsx";
import { seekProgress } from "./chartProgressState.ts";
import { JumpToTimeDialog } from "./JumpToTimeDialog.tsx";
import { ProgressContextMenu, useProgressContextMenu } from "./ProgressContextMenu.tsx";

const MemoizedTimelineMarkers = memo(TimelineMarkersView);

type ProgressLoopRange = { readonly start: number; readonly end: number };

/**
 * Projects a valid A-B range onto the full progress track without changing the
 * track's seek domain. Invalid or empty ranges do not render a decoration.
 */
function scrubberLoopStyle(
  range: ProgressLoopRange | null,
  duration: number,
): CSSProperties | undefined {
  if (
    !range ||
    !Number.isFinite(duration) ||
    duration <= 0 ||
    !Number.isFinite(range.start) ||
    !Number.isFinite(range.end)
  ) {
    return undefined;
  }
  const start = Math.min(duration, Math.max(0, range.start));
  const end = Math.min(duration, Math.max(0, range.end));
  if (end <= start) {
    return undefined;
  }
  return {
    "--scrubber-ab-left": `${((start / duration) * 100).toFixed(4)}%`,
    "--scrubber-ab-width": `${(((end - start) / duration) * 100).toFixed(4)}%`,
  } as CSSProperties;
}

/** Shared transport card: scrubber, spectrum, markers, and time readouts. */
export function ChartProgress() {
  const { t } = useTranslation();
  const runtime = useEditorHostRuntime();
  const progressMenu = useProgressContextMenu();
  const { scrubberWrap, timelineMarkers, scrubber, scrubberSpectrum } =
    useTransportSurface().attach;
  const editorVisibility = useSyncExternalStore(
    subscribeToEditorVisibility,
    getEditorVisibility,
    getEditorVisibility,
  );
  const progress = useEditorHostValue((editor) => editor.ui.progress.snapshot, {
    time: 0,
    duration: 600,
    chartTime: "0.000 s",
    beat: t("chrome.transport.beat", { value: "0.000" }),
    bpm: t("chrome.transport.bpm", { value: "120.00" }),
  });
  const markers = useEditorHostValue((editor) => editor.ui.timelineMarkers.snapshot, null);
  const loopRange = useSyncExternalStore(
    editorLoopRange.subscribe,
    editorLoopRange.get,
    editorLoopRange.get,
  );
  const loop =
    loopRange && loopRange.end > loopRange.start && progress.duration > 0 ? loopRange : null;
  const progressTime = Math.min(progress.duration, Math.max(0, progress.time));
  const loopStyle = scrubberLoopStyle(loop, progress.duration);
  return (
    <div className="redux-status-card" hidden={editorVisibility.atHome}>
      <div className="scrubber-wrap" ref={scrubberWrap} onContextMenuCapture={progressMenu.open}>
        <div id="timeline-markers" className="timeline-markers" ref={timelineMarkers}>
          {markers && <MemoizedTimelineMarkers {...markers} />}
        </div>
        {/* The scrubber is the playhead: the level bar's fill and printed value
            are removed by `chartProgress.less`, which draws the position as a rule
            from the ratio `Input` measures. The level mode is what gives the bar
            its full-height hit area without a native thumb. */}
        <SliderField
          id="scrubber"
          className="transport-scrubber"
          inputRef={scrubber}
          min={0}
          max={progress.duration}
          step={0.001}
          value={progressTime}
          aria-label={t("chrome.transport.scrubber")}
          onChange={(event) =>
            runtime && seekProgress(runtime.ui.progress, Number(event.currentTarget.value))
          }
        />
        {/* The spectrum is a sibling after the input because the range paints an
            opaque track of its own. The A-B range is a separate decoration, so
            the scrubber itself always keeps the full-track seek domain. */}
        <span className="scrubber-spectrum-window" aria-hidden="true">
          <canvas
            className="transport-scrubber-spectrum"
            ref={scrubberSpectrum}
            aria-hidden="true"
          />
        </span>
        {loopStyle && <span className="scrubber-ab-range" style={loopStyle} aria-hidden="true" />}
      </div>
      <ProgressContextMenu store={progressMenu.store} />
      <JumpToTimeDialog />
      <div className="redux-status-line">
        <span>{progress.beat}</span>
        <span className="transport-bpm">{progress.bpm}</span>
        <span className="transport-clock">{progress.chartTime}</span>
      </div>
      <TimelineStretchBar />
    </div>
  );
}
