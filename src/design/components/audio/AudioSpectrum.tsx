/** Paints a small analyser-backed spectrum for an audible media element. */
import { useEffect, useRef } from "react";

interface AudioSpectrumProps {
  media: HTMLAudioElement | null;
  active: boolean;
}

/** Draws live frequency bars while the supplied media element is playing. */
export function AudioSpectrum({ media, active }: AudioSpectrumProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const graph = useRef<{
    context: AudioContext;
    analyser: AnalyserNode;
  } | null>(null);

  useEffect(() => {
    if (!media || typeof AudioContext === "undefined") {
      return;
    }
    let context: AudioContext | null = null;
    let analyser: AnalyserNode | null = null;
    try {
      context = new AudioContext();
      analyser = context.createAnalyser();
      analyser.fftSize = 64;
      context.createMediaElementSource(media).connect(analyser).connect(context.destination);
      graph.current = { context, analyser };
    } catch {
      void context?.close();
      return;
    }
    return () => {
      analyser?.disconnect();
      graph.current = null;
      void context?.close();
    };
  }, [media]);

  useEffect(() => {
    const current = graph.current;
    if (!current || !active) {
      return;
    }
    void current.context.resume().catch(() => undefined);
    const values = new Uint8Array(current.analyser.frequencyBinCount);
    let frame = 0;
    const paint = () => {
      const target = canvas.current;
      if (!target) {
        return;
      }
      const ratio = window.devicePixelRatio || 1;
      const width = Math.max(1, Math.floor(target.clientWidth * ratio));
      const height = Math.max(1, Math.floor(target.clientHeight * ratio));
      if (target.width !== width || target.height !== height) {
        target.width = width;
        target.height = height;
      }
      const context2d = target.getContext("2d");
      if (!context2d) {
        return;
      }
      current.analyser.getByteFrequencyData(values);
      context2d.clearRect(0, 0, width, height);
      context2d.fillStyle = getComputedStyle(target).color;
      const gap = Math.max(1, width / values.length / 3);
      const bar = Math.max(1, width / values.length - gap);
      values.forEach((value, index) => {
        const barHeight = (value / 255) * height;
        context2d.fillRect(index * (bar + gap), height - barHeight, bar, barHeight);
      });
      frame = requestAnimationFrame(paint);
    };
    frame = requestAnimationFrame(paint);
    return () => cancelAnimationFrame(frame);
  }, [active, media]);

  return <canvas ref={canvas} className="redux-audio-spectrum" aria-hidden="true" />;
}
