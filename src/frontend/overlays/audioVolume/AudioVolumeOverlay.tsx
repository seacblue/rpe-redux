/**
 * The transient left-side audio mixer. It renders only the state published by
 * the core mixer, while pointer gestures are translated back into mixer calls.
 */
import { createPortal } from "react-dom";
import { useRef, useSyncExternalStore, type PointerEvent, type WheelEvent } from "react";
import { Button } from "../../../design/components/button/Button.tsx";
import { useTranslation } from "../../../i18n/react.ts";
import {
  AUDIO_VOLUME_METERS,
  audioMixer,
  type AudioVolumeMeter,
} from "../../../core/media/audioMixer.ts";
import { readFloatingHost } from "../floatingHost.ts";

/** Reads a meter's value from a pointer position inside its vertical track. */
function valueFromPointer(event: PointerEvent<HTMLButtonElement>): number {
  const box = event.currentTarget.getBoundingClientRect();
  if (box.height <= 0) {
    return 0;
  }
  return 1 - (event.clientY - box.top) / box.height;
}

/** Renders the osu!lazer-style transient audio meter strip. */
export function AudioVolumeOverlay() {
  const { tRaw } = useTranslation();
  const snapshot = useSyncExternalStore(
    audioMixer.subscribe,
    audioMixer.snapshot,
    audioMixer.snapshot,
  );
  const dragging = useRef<{ meter: AudioVolumeMeter; pointerId: number } | null>(null);
  if (!snapshot.visible) {
    return null;
  }
  const panel = (
    <aside
      className="redux-audio-volume-overlay"
      data-testid="audio-volume-overlay"
      aria-label={tRaw("chrome.audioVolume.title")}
    >
      <div className="redux-audio-volume-meters">
        {AUDIO_VOLUME_METERS.map((meter) => {
          const value = snapshot.values[meter];
          const selected = snapshot.selected === meter;
          return (
            <Button
              key={meter}
              type="button"
              variant="plain"
              className={`redux-audio-volume-meter${selected ? " is-selected" : ""}`}
              data-meter={meter}
              aria-label={tRaw(`chrome.audioVolume.${meter}`)}
              aria-pressed={selected}
              onClick={() => audioMixer.selectMeter(meter)}
              onPointerDown={(event) => {
                if (event.button !== 0) {
                  return;
                }
                dragging.current = { meter, pointerId: event.pointerId };
                event.currentTarget.setPointerCapture(event.pointerId);
                audioMixer.selectMeter(meter);
                audioMixer.set(meter, valueFromPointer(event));
              }}
              onPointerMove={(event) => {
                if (dragging.current?.pointerId !== event.pointerId) {
                  return;
                }
                event.preventDefault();
                audioMixer.set(meter, valueFromPointer(event));
              }}
              onPointerUp={(event) => {
                if (dragging.current?.pointerId !== event.pointerId) {
                  return;
                }
                dragging.current = null;
                event.currentTarget.releasePointerCapture(event.pointerId);
              }}
              onPointerCancel={(event) => {
                if (dragging.current?.pointerId === event.pointerId) {
                  dragging.current = null;
                }
              }}
              onWheel={(event: WheelEvent<HTMLButtonElement>) => {
                event.preventDefault();
                event.stopPropagation();
                audioMixer.adjust(meter, event.deltaY < 0 ? 1 : -1, event.deltaMode === 0);
              }}
            >
              <span className="redux-audio-volume-meter-track" aria-hidden="true">
                <span
                  className="redux-audio-volume-meter-fill"
                  style={{ height: `${value * 100}%` }}
                />
              </span>
              <span className="redux-audio-volume-meter-label">
                {tRaw(`chrome.audioVolume.${meter}`)}
              </span>
              <span className="redux-audio-volume-meter-value">{Math.round(value * 100)}%</span>
            </Button>
          );
        })}
      </div>
      <div className="redux-audio-volume-status" aria-live="polite">
        {snapshot.muted ? tRaw("chrome.audioVolume.muted") : tRaw("chrome.audioVolume.adjust")}
      </div>
    </aside>
  );
  return createPortal(panel, readFloatingHost() ?? document.body);
}
