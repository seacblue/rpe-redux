/**
 * Imperative room-exit seam for surfaces outside the collaboration provider.
 *
 * The title bar and workspace navigation end a room when the editor returns to
 * the library. They cannot read the provider's React context, so the provider
 * publishes one stable exit operation here while it is mounted.
 */
import { createLateBound } from "../../../../../core/utils/lateBound.ts";

/** The exit operation the mounted collaboration provider publishes. */
export interface CollaborationRoomExit {
  /** Leaves the room, or closes it when the current member is the host. */
  exitForLibrary(): void;
}

const binding = createLateBound<CollaborationRoomExit>();

/** Publishes the mounted provider's exit operation; returns its disposer. */
export function bindCollaborationRoomExit(next: CollaborationRoomExit): () => void {
  return binding.bind(next);
}

/** Ends any active or connecting room on behalf of a library trip. */
export const collaborationRoomExit = Object.freeze({
  exit(): void {
    binding.value()?.exitForLibrary();
  },
});
