/**
 * Music loading restores the transport before starting waveform analysis, and
 * never waits for that analysis: the decoded track is audible while the
 * waveform is still being created, and a later waveform cannot move the
 * playhead.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { createMusicLoader } from "../../../frontend/screens/editor/workspace/document/open/musicLoader.ts";

/** One shared session object so the loader's identity check passes. */
const session = { chart: { META: {} }, commitChart: () => undefined };

test("music load restores the transport before starting unawaited analysis", async () => {
  const events = [];
  let finishAnalysis = () => {};
  const deps = {
    async loadAudio() {
      events.push("audio");
      return true;
    },
    pause: () => events.push("pause"),
    seek: (seconds) => events.push(["seek", seconds]),
    chartSeconds: () => 12,
    offsetSeconds: () => 0.5,
    getSession: () => session,
    setAnalysisSource: () => events.push("analysis-source"),
    analysisEnabled: () => true,
    ensureAnalysis: () => {
      events.push("analysis-start");
      return new Promise((resolve) => {
        finishAnalysis = resolve;
      });
    },
    reportError: () => undefined,
    setAsset: () => events.push("asset"),
    setProgressDuration: (duration) => events.push(["duration", duration]),
    duration: () => 100,
    queueSpectrum: () => events.push("spectrum"),
    renderTimelineMarkers: () => events.push("markers"),
    commitLabel: () => "label",
    onLoaded: () => events.push("loaded"),
  };

  const loadMusic = createMusicLoader(deps);
  await loadMusic(new Uint8Array([1, 2, 3]), "song.mp3", false);

  assert.deepEqual(events, [
    "pause",
    "audio",
    "asset",
    ["duration", 100],
    "markers",
    ["seek", 12.5],
    "loaded",
    "analysis-source",
    "analysis-start",
    "spectrum",
  ]);

  // Finishing the waveform only updates the overlay; it must not seek again.
  finishAnalysis();
  await Promise.resolve();
  assert.equal(events.filter((event) => Array.isArray(event) && event[0] === "seek").length, 1);
});
