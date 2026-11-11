/**
 * Shares the selected asset's audio player with the asset tree.
 *
 * The tree row that owns keyboard focus and the player that owns playback live
 * in different columns of the drawer, so a Space press on the selected row has
 * to reach the player through one feature-local handle instead of a second
 * audio element or a global transport command.
 */
import { createContext, useContext, useMemo, useRef, type ReactNode, type RefObject } from "react";
import type { AudioPlayerHandle } from "../../../../../design/components/audio/AudioPlayer.tsx";

/** The handle published to every surface inside one asset drawer. */
export interface AssetAudioPreview {
  /** Ref the details face attaches to its player. */
  readonly player: RefObject<AudioPlayerHandle | null>;
  /** Start or pause the attached player; a no-op before it mounts. */
  toggle(): void;
}

const AssetAudioPreviewContext = createContext<AssetAudioPreview | null>(null);

/** Publishes one player handle to the asset tree and its details face. */
export function AssetAudioPreviewProvider({ children }: { children: ReactNode }) {
  const player = useRef<AudioPlayerHandle | null>(null);
  const value = useMemo<AssetAudioPreview>(
    () => ({
      player,
      toggle: () => player.current?.toggle(),
    }),
    [],
  );
  return (
    <AssetAudioPreviewContext.Provider value={value}>{children}</AssetAudioPreviewContext.Provider>
  );
}

/** The drawer's audio preview, or null when the view is mounted on its own. */
export function useAssetAudioPreview(): AssetAudioPreview | null {
  return useContext(AssetAudioPreviewContext);
}
