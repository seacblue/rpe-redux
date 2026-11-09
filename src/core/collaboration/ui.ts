/** Observable room presentation state shared by chrome and the editor surface. */
import { createValue, type ValueCell } from "../state/values.ts";
import type { CollaborationState } from "./types.ts";

/** Initial presentation state before any room is opened. */
export const EMPTY_COLLABORATION_STATE: CollaborationState = Object.freeze({
  status: "idle",
  roomId: "",
  invite: "",
  serverUrl: "",
  memberId: "",
  hostId: "",
  role: "viewer",
  revision: 0,
  maxMembers: 4,
  encrypted: false,
  roomKey: "",
  members: Object.freeze([]),
  presence: Object.freeze([]),
  assets: Object.freeze([]),
  locks: Object.freeze([]),
  pending: Object.freeze([]),
  queued: 0,
  error: "",
});

/** One room per application session; chrome reads it without importing a screen. */
export const collaborationRoom: ValueCell<CollaborationState> = createValue<CollaborationState>({
  initial: EMPTY_COLLABORATION_STATE,
});

/** A room is open locally, even while a guest is waiting for approval. */
export const collaborationActive: Pick<ValueCell<boolean>, "get" | "subscribe"> = {
  get: () => {
    const state = collaborationRoom.get();
    return Boolean(state.roomId) || state.status === "waiting";
  },
  subscribe: (listener) => collaborationRoom.subscribe(listener),
};

/** Resource names whose verified bytes have not arrived yet. */
export const collaborationPendingAssets: ValueCell<readonly string[]> = createValue<
  readonly string[]
>({ initial: Object.freeze([]) });

/** Whether the provider is preparing a room before a connection exists. */
export const collaborationPreparing: ValueCell<boolean> = createValue<boolean>({ initial: false });

/**
 * Whether the open document is a guest's temporary room copy.
 *
 * Room charts are never persisted to the local library: saves are refused,
 * recovery autosave stays off, and leaving the room discards the document.
 */
export const collaborationRoomDocument: ValueCell<boolean> = createValue<boolean>({
  initial: false,
});

/**
 * Bumped after a local asset-library mutation.
 *
 * Chart commits carry their own publish hook, but image/audio bytes live beside
 * the chart. This revision lets the room runtime publish a replaced asset
 * explicitly without treating a remote manifest change as a local edit.
 */
export const collaborationAssetRevision = createValue<number>({ initial: 0 });

/** Announce one local asset-library mutation to the room runtime. */
export function bumpCollaborationAssetRevision(): void {
  collaborationAssetRevision.set(collaborationAssetRevision.get() + 1);
}

/**
 * Whether ending the current session must close the room for every member.
 *
 * Only a host whose room exists owns the room's lifetime. A pending connection
 * or any guest exits by leaving instead of closing the room.
 */
export function roomExitClosesRoom(state: CollaborationState): boolean {
  return state.role === "host" && Boolean(state.roomId);
}

/** Returns whether exiting would interrupt a room or an in-progress connection. */
export function roomNeedsExitConfirmation(state: CollaborationState, preparing: boolean): boolean {
  return (
    preparing ||
    Boolean(state.roomId) ||
    ["connecting", "waiting", "connected", "reconnecting", "offline"].includes(state.status)
  );
}
