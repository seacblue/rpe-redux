/**
 * Sidebar audio console for the existing music and hitsound settings.
 *
 * The trigger stays in the compact rail while the expanded controls render in
 * the shared floating host, so the rail can keep its narrow layout and clipping
 * contract without hiding the panel.
 */
import { createPortal } from "react-dom";
import { useRef, useState, useSyncExternalStore } from "react";
import { IconButton } from "../../../design/components/button/IconButton.tsx";
import { Slider } from "../../../design/components/slider/Slider.tsx";
import { useAnchoredPopover } from "../../../design/patterns/useAnchoredPopover.ts";
import {
  AUDIO_VOLUME_METERS,
  audioMixer,
  type AudioVolumeMeter,
} from "../../../core/media/audioMixer.ts";
import { useTranslation } from "../../../i18n/react.ts";
import { readFloatingHost } from "../../overlays/floatingHost.ts";

const PANEL_GAP = 6;

/** Expandable controls for the audio settings already used by playback. */
export function AudioVolumeConsole() {
  const { t, tRaw } = useTranslation();
  const snapshot = useSyncExternalStore(
    audioMixer.subscribe,
    audioMixer.snapshot,
    audioMixer.snapshot,
  );
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLElement>(null);
  const [open, setOpen] = useState(false);
  const popover = useAnchoredPopover({
    open,
    anchor: trigger,
    panel,
    onClose: () => setOpen(false),
    align: "end",
    gap: PANEL_GAP,
    toggle: trigger,
  });

  return (
    <div className="sidebar-audio-volume">
      <IconButton
        ref={trigger}
        icon="volume"
        size="md"
        label={t("chrome.audioVolume.title")}
        className="sidebar-audio-volume-trigger"
        active={open}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      />
      {createPortal(
        <section
          ref={panel}
          className={`audio-volume-console${open ? " is-open" : ""}`}
          role="dialog"
          aria-label={t("chrome.audioVolume.title")}
          aria-hidden={!open}
          inert={!open}
          data-placement={popover.side}
          style={popover.style}
        >
          <header className="audio-volume-console-header">
            <strong>{t("chrome.audioVolume.title")}</strong>
          </header>
          <div className="audio-volume-console-list">
            {AUDIO_VOLUME_METERS.map((meter) => (
              <AudioVolumeRow
                key={meter}
                meter={meter}
                value={snapshot.values[meter]}
                label={tRaw(`chrome.audioVolume.${meter}`)}
              />
            ))}
          </div>
        </section>,
        readFloatingHost() ?? document.body,
      )}
    </div>
  );
}

/** Render one existing audio setting as a labelled slider row. */
function AudioVolumeRow({
  meter,
  value,
  label,
}: {
  meter: AudioVolumeMeter;
  value: number;
  label: string;
}) {
  return (
    <label className="audio-volume-console-row">
      <span className="audio-volume-console-row-label">{label}</span>
      <output className="audio-volume-console-row-value">{Math.round(value * 100)}%</output>
      <Slider
        data-slider="range"
        min={0}
        max={1}
        step={0.01}
        value={value}
        aria-label={label}
        onChange={(event) => audioMixer.set(meter, Number(event.currentTarget.value))}
      />
    </label>
  );
}
