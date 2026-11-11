/**
 * Decodes and analyses one selected asset for its static spectrum heatmap.
 *
 * The result is cached by object URL, so switching back to an already selected
 * asset reuses one analysis. The player still owns playback; this module only
 * supplies the overview grid the preview paints.
 */
import {
  analyzeAudioBuffer,
  type AudioAnalysisData,
} from "../../../../../core/media/audioAnalysis.ts";

const CACHE_LIMIT = 8;

const ANALYSIS_OPTIONS = {
  waveformSize: 256,
  bands: 32,
  spectrumFrames: 384,
} as const;

const analyses = new Map<string, Promise<AudioAnalysisData | null>>();

let decodeContext: AudioContext | null = null;

/** One shared decode context; creating one per selection exhausts the browser limit. */
function audioContext(): AudioContext | null {
  if (typeof AudioContext === "undefined") {
    return null;
  }
  if (!decodeContext) {
    try {
      decodeContext = new AudioContext();
    } catch {
      return null;
    }
  }
  return decodeContext;
}

/** Fetch and decode one asset URL, returning null for unsupported or unreadable audio. */
async function decode(src: string): Promise<AudioBuffer | null> {
  const context = audioContext();
  if (!context) {
    return null;
  }
  try {
    const response = await fetch(src);
    if (!response.ok) {
      return null;
    }
    return await context.decodeAudioData(await response.arrayBuffer());
  } catch {
    return null;
  }
}

/**
 * Analyse one asset URL into the spectrum grid the heatmap needs.
 *
 * Rejections are converted to `null` because a preview failure should leave the
 * player usable; the cache keeps both successful and failed answers by URL.
 */
export function analyzeAssetAudio(src: string): Promise<AudioAnalysisData | null> {
  const cached = analyses.get(src);
  if (cached) {
    return cached;
  }
  const pending = decode(src)
    .then((buffer) => (buffer ? analyzeAudioBuffer(buffer, ANALYSIS_OPTIONS) : null))
    .catch(() => null);
  analyses.set(src, pending);
  if (analyses.size > CACHE_LIMIT) {
    const oldest = analyses.keys().next().value;
    if (oldest !== undefined) {
      analyses.delete(oldest);
    }
  }
  return pending;
}
