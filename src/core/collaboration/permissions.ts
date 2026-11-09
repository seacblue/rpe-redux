/**
 * Role-to-capability rules for a collaboration room.
 *
 * A role is a user-facing label; a capability is the actual write boundary. The
 * server checks capabilities, the client hides controls from the same table,
 * and a future fine-grained role can add entries without editing every call
 * site. Client-side checks are presentation only; the server remains
 * authoritative.
 */
import type { CollaborationRole } from "./types.ts";

/** One operation a room member may attempt. */
export type RoomCapability =
  | "read"
  | "edit-chart"
  | "edit-metadata"
  | "upload-asset"
  | "replace-asset"
  | "manage-room"
  | "approve-member"
  | "change-role"
  | "remove-member"
  | "undo-own";

/** Capabilities grouped for UI controls. */
export interface RoomPermissions {
  readonly read: boolean;
  readonly editChart: boolean;
  readonly editMetadata: boolean;
  readonly uploadAsset: boolean;
  readonly replaceAsset: boolean;
  readonly manageRoom: boolean;
  readonly approveMember: boolean;
  readonly changeRole: boolean;
  readonly removeMember: boolean;
  readonly undoOwn: boolean;
}

const ALL_CAPABILITIES: readonly RoomCapability[] = Object.freeze([
  "read",
  "edit-chart",
  "edit-metadata",
  "upload-asset",
  "replace-asset",
  "manage-room",
  "approve-member",
  "change-role",
  "remove-member",
  "undo-own",
]);

const EDITOR_CAPABILITIES: readonly RoomCapability[] = Object.freeze([
  "read",
  "edit-chart",
  "edit-metadata",
  "upload-asset",
  "replace-asset",
  "undo-own",
]);

const VIEWER_CAPABILITIES: readonly RoomCapability[] = Object.freeze(["read"]);

const CAPABILITIES: Readonly<Record<CollaborationRole, ReadonlySet<RoomCapability>>> =
  Object.freeze({
    host: new Set(ALL_CAPABILITIES),
    editor: new Set(EDITOR_CAPABILITIES),
    viewer: new Set(VIEWER_CAPABILITIES),
  });

/** Whether a role may attempt one operation. */
export function canPerform(role: CollaborationRole, capability: RoomCapability): boolean {
  return CAPABILITIES[role].has(capability);
}

/** All capability flags for a role, for controls that need several at once. */
export function roomPermissions(role: CollaborationRole): RoomPermissions {
  return Object.freeze({
    read: canPerform(role, "read"),
    editChart: canPerform(role, "edit-chart"),
    editMetadata: canPerform(role, "edit-metadata"),
    uploadAsset: canPerform(role, "upload-asset"),
    replaceAsset: canPerform(role, "replace-asset"),
    manageRoom: canPerform(role, "manage-room"),
    approveMember: canPerform(role, "approve-member"),
    changeRole: canPerform(role, "change-role"),
    removeMember: canPerform(role, "remove-member"),
    undoOwn: canPerform(role, "undo-own"),
  });
}

/**
 * Whether a role may publish bytes under one asset name.
 *
 * Editors may add or replace a room resource; viewers may never upload. The
 * room remains authoritative and broadcasts the accepted bytes to every member.
 */
export function canPublishAsset(role: CollaborationRole, replacesExisting: boolean): boolean {
  return canPerform(role, replacesExisting ? "replace-asset" : "upload-asset");
}
