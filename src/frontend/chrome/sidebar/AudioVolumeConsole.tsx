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
import { KnobField } from "../../../design/components/knob/KnobField.tsx";
import { useAnchoredPopover } from "../../../design/patterns/useAnchoredPopover.ts";
import { audioMixer } from "../../../core/media/audioMixer.ts";
import { HIT_SOUND_KINDS } from "../../../core/media/hitsounds.ts";
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
  const effects =
    HIT_SOUND_KINDS.reduce((total, meter) => total + snapshot.values[meter], 0) /
    HIT_SOUND_KINDS.length;

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
          <div className="audio-volume-console-fields">
            <AudioVolumeColumn
              label={tRaw("chrome.audioVolume.music")}
              value={snapshot.values.music}
              onChange={(value) => audioMixer.set("music", value)}
            />
            <AudioVolumeColumn
              label={tRaw("chrome.audioVolume.effects")}
              value={effects}
              onChange={(value) => audioMixer.setEffects(value)}
            />
          </div>
        </section>,
        readFloatingHost() ?? document.body,
      )}
    </div>
  );
}

/** Render one volume group as a single-line labelled knob field. */
function AudioVolumeColumn({
  value,
  label,
  onChange,
}: {
  value: number;
  label: string;
  onChange(value: number): void;
}) {
  return (
    <KnobField
      label={label}
      min={0}
      max={1}
      step={0.01}
      value={value}
      percentage
      onChange={onChange}
    />
  );
}
