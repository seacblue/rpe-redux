/**
 * Paints the selected asset's whole-track spectrum as a static heatmap.
 *
 * The canvas holds the overview; the player owns the moving playhead, so this
 * component only repaints when the analysis, progress, theme, or layout changes.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { paintSpectrogramPixels } from "../../../../../core/media/spectrumPixels.ts";
import { clamp01 } from "../../../../../core/utils/numbers.ts";
import { resolveCanvasColor } from "../../../../../design/components/media/canvasColor.ts";
import { analyzeAssetAudio } from "./assetAudioHeatmap.ts";
import type { AudioAnalysisData } from "../../../../../core/media/audioAnalysis.ts";

const MAX_SCALE = 2;

/** A selected audio asset's full-clip heatmap with a playhead line. */
export function AssetAudioHeatmap({ src, progress }: { src: string; progress: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [analysis, setAnalysis] = useState<{
    src: string;
    data: AudioAnalysisData | null;
  } | null>(null);
  const data = analysis?.src === src ? analysis.data : null;
  const drawRef = useRef<() => void>(() => {});

  useEffect(() => {
    let active = true;
    void analyzeAssetAudio(src).then((result) => {
      if (active) {
        setAnalysis({ src, data: result });
      }
    });
    return () => {
      active = false;
    };
  }, [src]);

  const draw = useCallback(() => {
    const target = canvas.current;
    if (!target) {
      return;
    }
    const scale = Math.min(MAX_SCALE, Math.max(1, globalThis.devicePixelRatio || 1));
    const width = Math.max(2, Math.round(target.clientWidth * scale));
    const height = Math.max(2, Math.round(target.clientHeight * scale));
    if (target.width !== width || target.height !== height) {
      target.width = width;
      target.height = height;
    }
    const context = target.getContext("2d");
    if (!context) {
      return;
    }
    const style = getComputedStyle(target);
    const low = resolveCanvasColor(style.getPropertyValue("--accent").trim(), [90, 169, 255]);
    const high = resolveCanvasColor(style.getPropertyValue("--foreground").trim(), [255, 255, 255]);
    context.clearRect(0, 0, width, height);
    if (data && data.spectrum.length > 0) {
      const image = context.createImageData(width, height);
      paintSpectrogramPixels(image.data, width, height, data, {
        low,
        high,
        curve: 1.5,
        alpha: 0.92,
      });
      context.putImageData(image, 0, 0);
    }
    const x = Math.round(clamp01(progress) * (width - 1));
    context.fillStyle = `rgb(${high[0]} ${high[1]} ${high[2]})`;
    context.fillRect(x, 0, Math.max(1, Math.round(scale)), height);
  }, [data, progress]);

  useEffect(() => {
    drawRef.current = draw;
    draw();
  }, [draw]);

  useEffect(() => {
    const target = canvas.current;
    if (!target) {
      return;
    }
    const redraw = () => drawRef.current();
    const observer = new ResizeObserver(redraw);
    observer.observe(target);
    window.addEventListener("redux-theme", redraw);
    return () => {
      observer.disconnect();
      window.removeEventListener("redux-theme", redraw);
    };
  }, []);

  return <canvas ref={canvas} className="asset-audio-heatmap" aria-hidden="true" />;
}
