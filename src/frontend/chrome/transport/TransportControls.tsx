/**
 * Shared transport controls for the editor surface.
 *
 * The play button owns RPE's playback layout as well as the transport: playing
 * hides the note and event regions, and pausing shows them again at the current
 * position. Space stays the plain transport toggle and never changes the layout.
 * Holding the audition button focuses the preview and plays from the current
 * position until release. Both controls are shell chrome rather than
 * editor-only, so every document keeps the same transport affordances.
 */
import { useSyncExternalStore } from "react";
import { Button } from "../../../design/components/button/Button.tsx";
import { IconButton } from "../../../design/components/button/IconButton.tsx";
import { Icon } from "../../../design/components/icon/Icon.tsx";
import { t } from "../../../i18n/index.ts";
import type { ToolbarControl } from "../../../core/shell/registries/toolbar.ts";
import { editorAuditioning, editorPlaying } from "../../../core/edit/state/publishedValues.ts";
import { editorChromeCommands } from "../../contracts/editorCommands.ts";

/** The play/pause button, which also hides and restores the editing regions. */
export function PlaybackButton() {
  const playing = useSyncExternalStore(
    editorPlaying.subscribe,
    editorPlaying.get,
    editorPlaying.get,
  );
  const auditioning = useSyncExternalStore(
    editorAuditioning.subscribe,
    editorAuditioning.get,
    editorAuditioning.get,
  );
  // Audition owns the transport: the button stays in its play state and refuses
  // a second command until the hold ends.
  const active = playing && !auditioning;
  return (
    <Button
      id="play"
      className="toolbar-playback-button"
      data-playing={active}
      title={t(active ? "editor.app.transport.pause" : "editor.app.transport.play")}
      data-tip-title={t("chrome.playback.playPause")}
      aria-disabled={auditioning || undefined}
      onPointerDown={(event) => {
        if (auditioning) {
          event.preventDefault();
        }
      }}
      onClick={(event) => {
        if (auditioning) {
          event.preventDefault();
          return;
        }
        editorChromeCommands()?.transport.togglePlaybackPreview();
      }}
    >
      <span className="redux-visually-hidden">{t("chrome.playback.playPause")}</span>
      <Icon name="playbackPlay" size={20} className="redux-icon-play redux-icon-playback-play" />
      <Icon name="playbackPause" size={20} className="redux-icon-pause redux-icon-playback-pause" />
    </Button>
  );
}

/**
 * The hold-to-audition button; it focuses the preview while playing and
 * releasing restores the layout and starting position.
 */
export function AuditionButton() {
  const auditioning = useSyncExternalStore(
    editorAuditioning.subscribe,
    editorAuditioning.get,
    editorAuditioning.get,
  );
  return (
    <IconButton
      id="audition"
      icon="headphones"
      label={t("chrome.playback.audition")}
      className="toolbar-audition-button"
      active={auditioning}
      data-tip-title={t("chrome.playback.audition")}
      data-tip-desc={t("chrome.playback.auditionHint")}
      data-tip-key="T"
      onPointerDown={(event) => {
        event.preventDefault();
        event.currentTarget.setPointerCapture?.(event.pointerId);
        editorChromeCommands()?.transport.beginAudition({ previewOnly: true });
      }}
      onPointerUp={() => editorChromeCommands()?.transport.endAudition()}
      onPointerCancel={() => editorChromeCommands()?.transport.endAudition()}
      onPointerLeave={(event) => {
        if (event.buttons !== 0) {
          editorChromeCommands()?.transport.endAudition();
        }
      }}
      onLostPointerCapture={() => editorChromeCommands()?.transport.endAudition()}
    />
  );
}

/** Renders a shared transport control, or null when the id belongs elsewhere. */
export function transportControlNode(entry: ToolbarControl) {
  switch (entry.controlId) {
    case "playback":
      return <PlaybackButton />;
    case "audition":
      return <AuditionButton />;
    default:
      return null;
  }
}
