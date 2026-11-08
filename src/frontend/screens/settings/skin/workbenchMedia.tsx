/**
 * Shared media widgets for the skin workbench: object-URL lifetime, asset
 * thumbnails, and hit-sound audition. They stay outside the workbench state so
 * the slot, reuse, and cutter surfaces render the same asset the same way.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { IconButton } from "../../../../design/components/button/IconButton.tsx";
import { AsyncImage } from "../../../../design/components/image/AsyncImage.tsx";
import { Icon } from "../../../../design/components/icon/Icon.tsx";
import { mediaType } from "../../../../core/media/mime.ts";
import type { PhiraWorkbenchAsset } from "../../../../core/media/phiraSkinDraft.ts";
import { toBlobPart } from "../../../../core/utils/bytes.ts";
import type { WorkbenchSlotKind } from "./skinWorkbenchSlots.ts";

/** Create one object URL per byte array and revoke it when the source changes. */
export function useObjectUrl(bytes: Uint8Array | null, mime: string): string | null {
  const url = useMemo(
    () => (bytes ? URL.createObjectURL(new Blob([toBlobPart(bytes)], { type: mime })) : null),
    [bytes, mime],
  );
  useEffect(
    () => () => {
      if (url) {
        URL.revokeObjectURL(url);
      }
    },
    [url],
  );
  return url;
}

/** One visual sample of a workbench slot. */
export function AssetPreview({
  asset,
  kind,
  className = "",
}: {
  asset: PhiraWorkbenchAsset;
  kind: WorkbenchSlotKind;
  className?: string;
}) {
  const url = useObjectUrl(kind === "sound" ? null : asset.bytes, "image/png");
  if (kind === "sound") {
    return (
      <span className={`redux-skin-workbench-audio-glyph ${className}`.trim()}>
        <Icon name="music" size={24} />
      </span>
    );
  }
  return (
    <AsyncImage
      src={url ?? undefined}
      alt=""
      className={`redux-skin-workbench-preview ${className}`.trim()}
      decoding="async"
      fallback={
        <span className="redux-skin-workbench-audio-glyph">
          <Icon name="image" size={24} />
        </span>
      }
    />
  );
}

/** A play/pause control for one auditionable hit sound. */
export function SoundToggle({
  asset,
  playLabel,
  pauseLabel,
}: {
  asset: PhiraWorkbenchAsset;
  playLabel: string;
  pauseLabel: string;
}) {
  const url = useObjectUrl(asset.bytes, mediaType(asset.fileName));
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  return (
    <>
      <audio
        ref={audio}
        src={url ?? undefined}
        preload="metadata"
        onEnded={() => setPlaying(false)}
      />
      <IconButton
        icon={playing ? "previewPause" : "playbackPlay"}
        label={playing ? pauseLabel : playLabel}
        size="small"
        disabled={!url}
        onClick={() => {
          const element = audio.current;
          if (!element) {
            return;
          }
          if (element.paused) {
            void element
              .play()
              .then(() => setPlaying(true))
              .catch(() => setPlaying(false));
          } else {
            element.pause();
            element.currentTime = 0;
            setPlaying(false);
          }
        }}
      />
    </>
  );
}
