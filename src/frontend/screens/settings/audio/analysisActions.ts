/**
 * Binds the audio-analysis settings toggle to the live timeline analysis.
 *
 * The timeline opens the audio page through here, and the runtime applies the value
 * it finds there.
 */
import { openSettings } from "../settingsWindowController.ts";
import type { AudioAnalysis } from "../../editor/workspace/timeline/audioAnalysis/audioAnalysis.ts";
import { values } from "../../../../core/state/values.ts";

/** Live timeline analysis plus the callbacks its actions report through. */
interface AnalysisActions {
  audioAnalysis: AudioAnalysis;
  offsetSeconds(): number;
  reportError(error: unknown): void;
}
let current: AnalysisActions | null = null;
/** Bind the live analysis to the settings actions; returns the disposer. */
export function bindAnalysisActions(actions: AnalysisActions): () => void {
  current = actions;
  return () => {
    if (current === actions) {
      current = null;
    }
  };
}
/** Enable audio analysis, open its settings page, and draw the timeline strip. */
export function openAudioAnalysis(): void {
  const bound = current;
  if (!bound) {
    return;
  }
  // The toggle is the same settings row the audio page renders; the timeline
  // runtime subscribes to it and redraws the strip.
  if (values.byId.has("audio-analysis-enabled")) {
    values.byId.setUser("audio-analysis-enabled", true);
  }
  openSettings("playback");
  bound.audioAnalysis
    .ensureData()
    .then(() => bound.audioAnalysis.draw(bound.offsetSeconds()))
    .catch(bound.reportError);
  bound.audioAnalysis.draw(bound.offsetSeconds());
}
