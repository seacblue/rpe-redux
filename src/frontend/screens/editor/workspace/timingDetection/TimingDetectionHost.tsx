/**
 * Hosts the automatic timing dialog for the whole editor.
 *
 * The timing drawer, a new chart waiting for audio, and a fresh music load all
 * ask for the same surface through `timingDetectionState`. This host resolves
 * the current song, runs the worker analysis, and commits the measured fixed
 * BPM, or shows the detector's "not found" answer when no pulse is clear.
 */
import { useEffect, useState, useSyncExternalStore } from "react";
import { Modal } from "../../../../../design/components/modal/Modal.tsx";
import { Button } from "../../../../../design/components/button/Button.tsx";
import { useTranslation } from "../../../../../i18n/react.ts";
import type { Chart } from "../../../../../core/global/chart/chart.ts";
import {
  assetBytes,
  assetPath,
  resourceReferences,
} from "../../../../../core/global/document/resources.ts";
import type { BeatDetectionResult } from "../../../../../core/media/beatDetection.ts";
import { useEditorRuntime } from "../runtime/composition/EditorRuntime.tsx";
import type { EditorRuntime } from "../runtime/composition/EditorRuntime.tsx";
import { documents } from "../document/lifecycle/service.ts";
import { analyzeTiming } from "./timingDetectionAnalysis.ts";
import { TimingDetectionDialog, type TimingDetectionStatus } from "./TimingDetectionDialog.tsx";
import {
  applyDetectedTiming,
  applyTimingLabelKey,
  parseTimingDraft,
} from "./timingDetectionModel.ts";
import {
  clearTimingDetectionPending,
  closeTimingDetection,
  getTimingDetectionAudioRevision,
  getTimingDetectionRequest,
  subscribeTimingDetectionAudio,
  subscribeTimingDetectionRequest,
} from "./timingDetectionState.ts";

/** Resolve the song bytes/URL the open chart names, if the editor has them. */
async function chartAudio(runtime: EditorRuntime, chart: Chart): Promise<AudioBuffer | null> {
  if (!chart.META.song) {
    return null;
  }
  if (runtime.audio.buffer) {
    return runtime.audio.buffer;
  }
  const assets = runtime.providers.document.currentAssets();
  const chartName = runtime.providers.document.currentChartName();
  const reference = resourceReferences(chart, assets, chartName).song;
  const bytes = assetBytes(assets, reference, chartName);
  const path = assetPath(assets, reference, chartName);
  const uri = path ? assets.uri?.(path) : undefined;
  const source = bytes ?? uri;
  return source ? runtime.audio.decodeForAnalysis(source) : null;
}

/** The application-level detector modal. */
export function TimingDetectionHost() {
  const { t: translate } = useTranslation();
  const runtime = useEditorRuntime();
  const request = useSyncExternalStore(
    subscribeTimingDetectionRequest,
    getTimingDetectionRequest,
    getTimingDetectionRequest,
  );
  const audioRevision = useSyncExternalStore(
    subscribeTimingDetectionAudio,
    getTimingDetectionAudioRevision,
    getTimingDetectionAudioRevision,
  );
  const [status, setStatus] = useState<TimingDetectionStatus>("loading");
  const [result, setResult] = useState<BeatDetectionResult | null>(null);
  const [error, setError] = useState("");
  const [chart, setChart] = useState<Chart | null>(null);
  const [bpm, setBpm] = useState("");
  const [offset, setOffset] = useState("");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!request || !runtime) {
      return;
    }
    const session = runtime.getSession();
    const current = session.chart;
    // Opening the surface is the author acknowledging the queued request; it
    // must not auto-open a second time after they close it.
    clearTimingDetectionPending(session);
    const controller = new AbortController();
    let active = true;
    // Reset the previous request's view after this effect returns; a new open
    // can reuse the host between animation frames.
    queueMicrotask(() => {
      if (!active) {
        return;
      }
      setChart(current);
      setResult(null);
      setError("");
      setBpm("");
      setOffset("");
      setStatus("loading");
    });
    void (async () => {
      try {
        const buffer = await chartAudio(runtime, current);
        if (!active) {
          return;
        }
        if (!buffer || buffer.length === 0) {
          setStatus("no-audio");
          return;
        }
        const detected = await analyzeTiming(buffer, controller.signal);
        if (!active) {
          return;
        }
        if (!detected) {
          // Analysis returns null when the track has no clear pulse; the
          // dialog reports one short "not found" message instead of a guess.
          setStatus("not-found");
          return;
        }
        setResult(detected);
        setBpm(String(detected.bpm));
        setOffset(String(detected.offsetMs));
        setStatus("ready");
      } catch (failure) {
        if (active) {
          setError(failure instanceof Error ? failure.message : String(failure));
          setStatus("error");
        }
      }
    })();
    return () => {
      active = false;
      controller.abort();
    };
  }, [audioRevision, attempt, request, runtime]);

  if (!request) {
    return null;
  }
  const canApply = status === "ready" && parseTimingDraft(bpm, offset) !== null;
  const apply = () => {
    if (!runtime) {
      return;
    }
    try {
      const session = runtime.getSession();
      const applied = applyDetectedTiming(session.chart, bpm, offset);
      if (!applied) {
        setError(translate("editorPanels.timingDetection.invalidValues"));
        return;
      }
      const committed = session.commitChart(
        translate("editorPanels.timingDetection.commit"),
        applied.chart,
        session.selectionState(),
        undefined,
        { normalized: true },
      );
      if (!committed) {
        setError(translate("editorPanels.sampling.readOnly"));
        return;
      }
      runtime.audio.pause();
      runtime.providers.playback.playback.seek(Math.max(0, applied.seekMs / 1000), true);
      closeTimingDetection();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    }
  };
  return (
    <Modal
      open
      label={translate("editorPanels.timingDetection.title")}
      className="timing-detection-dialog"
      instanceKey={String(request.id)}
      onClose={closeTimingDetection}
      onClosed={closeTimingDetection}
      actions={
        <>
          <Button variant="outlined" onClick={closeTimingDetection}>
            {translate("editorPanels.timingDetection.cancel")}
          </Button>
          <Button variant="solid" disabled={!canApply} onClick={apply}>
            {translate(applyTimingLabelKey(chart))}
          </Button>
        </>
      }
    >
      <TimingDetectionDialog
        status={status}
        result={result}
        error={error}
        bpm={bpm}
        offset={offset}
        onBpm={setBpm}
        onOffset={setOffset}
        onPickAudio={() => void documents.pickMusic()}
        onRetry={() => setAttempt((value) => value + 1)}
      />
    </Modal>
  );
}
