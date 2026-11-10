/** Window-level host for remote cursors; room controls live in the inspector. */
import "./register.ts";
import { RemoteCursors } from "./RemoteCursors.tsx";
import { RemotePlayheads } from "./RemotePlayheads.tsx";
import { RoomProgressDialog } from "./RoomProgressDialog.tsx";

/** Mounts the presence cursor, playhead, and room setup layers beside the editor. */
export function CollaborationHosts() {
  return (
    <>
      <RemoteCursors />
      <RemotePlayheads />
      <RoomProgressDialog />
    </>
  );
}
