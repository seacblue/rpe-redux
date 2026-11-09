/** Reads room membership for an invitation without joining or creating a request. */
import type { RoomMember } from "../../../../../core/collaboration/types.ts";
import { BUILD_APP_VERSION } from "../../../../../core/platform/buildInfo.ts";
import {
  normalizeRoomServerUrl,
  type RoomInvite,
} from "../../../../../core/collaboration/invite.ts";

export interface RoomInvitePreview {
  readonly roomId: string;
  readonly maxMembers: number;
  readonly members: readonly RoomMember[];
}

/** Ask the room endpoint for its current members using the invitation password. */
export function inspectRoomInvite(invite: RoomInvite): Promise<RoomInvitePreview> {
  return new Promise((resolve, reject) => {
    if (typeof WebSocket === "undefined") {
      reject(new Error("WebSocket is unavailable"));
      return;
    }
    const url = normalizeRoomServerUrl(invite.serverUrl);
    if (!url) {
      reject(new Error("The room server address is invalid"));
      return;
    }
    const socket = new WebSocket(url);
    let settled = false;
    const timeout = window.setTimeout(() => finish(new Error("Room preview timed out")), 5000);
    const cleanup = () => {
      window.clearTimeout(timeout);
      socket.removeEventListener("open", onOpen);
      socket.removeEventListener("message", onMessage);
      socket.removeEventListener("error", onError);
      socket.removeEventListener("close", onClose);
    };
    const finish = (error: Error | null, value?: RoomInvitePreview) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      socket.close();
      if (error) {
        reject(error);
      } else if (value) {
        resolve(value);
      }
    };
    const onOpen = () => {
      socket.send(
        JSON.stringify({
          type: "inspect-room",
          roomId: invite.roomId ?? "",
          invite: invite.invite,
          appVersion: BUILD_APP_VERSION,
        }),
      );
    };
    const onMessage = (event: Event) => {
      const data = (event as MessageEvent<string>).data;
      let message: unknown;
      try {
        message = JSON.parse(data);
      } catch {
        return;
      }
      if (!message || typeof message !== "object") {
        return;
      }
      const record = message as {
        type?: unknown;
        roomId?: unknown;
        maxMembers?: unknown;
        members?: unknown;
        message?: unknown;
      };
      if (record.type === "room-info" && typeof record.roomId === "string") {
        finish(null, {
          roomId: record.roomId,
          maxMembers: typeof record.maxMembers === "number" ? record.maxMembers : 0,
          members: Array.isArray(record.members) ? (record.members as RoomMember[]) : [],
        });
      } else if (record.type === "rejected" || record.type === "error") {
        finish(new Error(typeof record.message === "string" ? record.message : "Room unavailable"));
      }
    };
    const onError = () => finish(new Error("The room server could not be reached"));
    const onClose = () => finish(new Error("The room server closed the preview connection"));
    socket.addEventListener("open", onOpen);
    socket.addEventListener("message", onMessage);
    socket.addEventListener("error", onError);
    socket.addEventListener("close", onClose);
  });
}
