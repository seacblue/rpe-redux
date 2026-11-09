/** Wire and view types shared by the collaboration client, server, and UI. */
import type { ChartChange } from "./changes.ts";
import type { EncryptedPayload } from "./e2e.ts";

/** Display identity a member chooses for a room. */
export interface CollaborationProfile {
  readonly name: string;
  readonly color: string;
}

/** Authority a member holds in a room. */
export type CollaborationRole = "host" | "editor" | "viewer";

/** One room member and its current authority. */
export interface RoomMember {
  readonly id: string;
  readonly profile: CollaborationProfile;
  readonly role: CollaborationRole;
  readonly online: boolean;
}

/** One immutable room resource entry. */
export interface RoomAsset {
  readonly name: string;
  readonly hash: string;
  readonly size: number;
  readonly mime: string;
  /** Plaintext digest for local asset deduplication in encrypted rooms. */
  readonly plaintextHash?: string;
}

/** One cooperative lease over chart, line, or object scope. */
export interface RoomLock {
  readonly id: string;
  readonly ownerId: string;
  readonly scope: "chart" | "line" | "object";
  readonly expiresAt: number;
}
/** Ephemeral cursor and workspace location a member publishes. */
export interface MemberPresence {
  readonly memberId: string;
  /** The workspace the member is currently using. */
  readonly area: "global" | "edit" | "design";
  /** Global section id, or the stable judge-line id while editing. */
  readonly section?: string;
  readonly lineId?: string;
  readonly beat?: number;
  readonly positionX?: number;
  /** Pointer position across the timeline canvas, from 0 (left) to 1 (right). */
  readonly cursorRatio?: number;
  /** Whether this member currently shows an authoring timeline. */
  readonly timeline?: boolean;
  /** The timeline surface the pointer is over. */
  readonly timelineArea?: "notes" | "events";
  readonly playheadBeat?: number;
  readonly updatedAt: number;
}

/** Complete room state returned on a welcome or snapshot. */
export interface RoomSnapshot {
  readonly roomId: string;
  readonly invite: string;
  readonly hostId: string;
  readonly memberId: string;
  readonly role: CollaborationRole;
  readonly revision: number;
  readonly chart: unknown;
  readonly fingerprint: string;
  readonly members: readonly RoomMember[];
  readonly presence: readonly MemberPresence[];
  /** Host resume token; guests receive one too but only hosts persist it. */
  readonly resumeToken?: string;
}

/** A guest waiting for host approval. */
export interface RoomPendingRequest {
  readonly requestId: string;
  readonly profile: CollaborationProfile;
}

/** Messages the client sends over the room socket. */
export type ClientMessage =
  | {
      readonly type: "create";
      readonly profile: CollaborationProfile;
      readonly chart: unknown;
      readonly fingerprint: string;
      /** Product version used to create the room, when the client reports it. */
      readonly appVersion?: string;
      /** Encrypted rooms send an opaque chart envelope. */
      readonly encrypted?: boolean;
      /** Joining members skip host approval and become editors. */
      readonly autoApproveEditor?: boolean;
      /** User-visible room password; omitted lets the server generate one. */
      readonly invite?: string;
    }
  | {
      readonly type: "join";
      readonly roomId: string;
      readonly invite: string;
      readonly profile: CollaborationProfile;
      /** Product version used by the joining client, when available. */
      readonly appVersion?: string;
    }
  | {
      readonly type: "inspect-room";
      readonly roomId: string;
      readonly invite: string;
      readonly appVersion?: string;
    }
  | {
      readonly type: "resume";
      readonly roomId: string;
      readonly token: string;
      /** Product version used by the reconnecting client, when available. */
      readonly appVersion?: string;
    }
  | {
      readonly type: "approve";
      readonly requestId: string;
      readonly allow: boolean;
      readonly role?: CollaborationRole;
    }
  | {
      readonly type: "set-role";
      readonly memberId: string;
      readonly role: Exclude<CollaborationRole, "host">;
    }
  | { readonly type: "max-members"; readonly maxMembers: number }
  | { readonly type: "set-password"; readonly invite: string }
  | { readonly type: "remove-member"; readonly memberId: string }
  | { readonly type: "close-room" }
  | { readonly type: "leave" }
  | {
      readonly type: "transaction";
      readonly transactionId: string;
      readonly label: string;
      readonly changes: readonly ChartChange[] | EncryptedPayload;
      readonly affectedObjectIds: readonly string[];
      /** Leases the client holds; encrypted rooms cannot derive paths. */
      readonly lockIds?: readonly string[];
      /** The original room transaction this batch compensates. */
      readonly undoOf?: string;
    }
  | { readonly type: "presence"; readonly presence: MemberPresence }
  | {
      readonly type: "lock-request";
      readonly requestId: string;
      readonly ids: readonly string[];
      readonly ttlMs?: number;
    }
  | { readonly type: "lock-release"; readonly ids: readonly string[] }
  | { readonly type: "snapshot-request" }
  | {
      readonly type: "asset-begin";
      readonly requestId: string;
      readonly name: string;
      readonly hash: string;
      readonly size: number;
      readonly mime: string;
      /** Plaintext digest; the stored hash is over ciphertext in encrypted rooms. */
      readonly plaintextHash?: string;
    }
  | {
      readonly type: "asset-chunk";
      readonly requestId: string;
      readonly index: number;
      readonly data: string;
    }
  | { readonly type: "asset-commit"; readonly requestId: string }
  | {
      readonly type: "asset-request";
      readonly requestId: string;
      readonly hash: string;
      readonly name?: string;
    }
  | { readonly type: "ping" };

/** One accepted opaque transaction replayed to a joining encrypted client. */
export interface EncryptedTransaction {
  readonly revision: number;
  readonly transactionId: string;
  readonly actorId: string;
  readonly label: string;
  readonly changes: EncryptedPayload;
  readonly undoOf?: string;
  readonly fingerprint: string;
}

/** One local chart batch the room did not accept and the editor kept visible. */
export interface UnsentChange {
  readonly transactionId: string;
  readonly label: string;
  readonly changes: readonly ChartChange[];
  readonly affectedObjectIds: readonly string[];
  readonly undoOf?: string;
  readonly lockIds?: readonly string[];
  /** Server or transport explanation shown beside the retry action. */
  readonly message: string;
  readonly code: string;
}

/** Messages the room server sends to a client. */
export type ServerMessage =
  | {
      readonly type: "welcome";
      readonly roomId: string;
      readonly invite: string;
      readonly memberId: string;
      readonly hostId: string;
      readonly role: CollaborationRole;
      readonly revision: number;
      /** Product version advertised by this room, when available. */
      readonly appVersion?: string;
      readonly chart?: unknown;
      readonly fingerprint: string;
      readonly maxMembers?: number;
      readonly members: readonly RoomMember[];
      readonly presence: readonly MemberPresence[];
      readonly assets: readonly RoomAsset[];
      readonly locks: readonly RoomLock[];
      readonly encrypted?: boolean;
      /** Present in encrypted rooms; chart is encrypted and the log is replayed. */
      readonly transactions?: readonly EncryptedTransaction[];
      readonly resumeToken: string;
    }
  | { readonly type: "pending"; readonly requestId: string; readonly profile: CollaborationProfile }
  | { readonly type: "pending-cleared"; readonly requestId: string }
  | { readonly type: "waiting"; readonly roomId: string }
  | {
      readonly type: "room-info";
      readonly roomId: string;
      readonly maxMembers: number;
      readonly members: readonly RoomMember[];
    }
  | {
      readonly type: "rejected";
      readonly reason: string;
      readonly message?: string;
    }
  | { readonly type: "room-closed"; readonly reason: string; readonly message?: string }
  | { readonly type: "members"; readonly members: readonly RoomMember[] }
  | { readonly type: "room-settings"; readonly maxMembers: number; readonly invite?: string }
  | {
      readonly type: "permission";
      readonly role: CollaborationRole;
      readonly reason?: string;
    }
  | { readonly type: "presence"; readonly presence: MemberPresence }
  | { readonly type: "locks"; readonly locks: readonly RoomLock[] }
  | {
      readonly type: "lock-result";
      readonly requestId: string;
      readonly granted: boolean;
      readonly conflicts?: readonly RoomLock[];
    }
  | {
      readonly type: "committed";
      readonly revision: number;
      readonly transactionId: string;
      readonly actorId: string;
      readonly label: string;
      readonly changes: readonly ChartChange[] | EncryptedPayload;
      readonly undoOf?: string;
      readonly fingerprint: string;
    }
  | {
      readonly type: "conflict";
      readonly revision: number;
      readonly transactionId: string;
      readonly paths: readonly string[];
      readonly message?: string;
    }
  | {
      readonly type: "snapshot";
      readonly revision: number;
      readonly chart: unknown;
      readonly fingerprint: string;
      readonly encrypted?: boolean;
      readonly transactions?: readonly EncryptedTransaction[];
    }
  | { readonly type: "asset-manifest"; readonly assets: readonly RoomAsset[] }
  | { readonly type: "asset-accepted"; readonly asset: RoomAsset }
  | {
      readonly type: "asset-download-begin";
      readonly requestId: string;
      readonly asset: RoomAsset;
      readonly totalChunks: number;
      readonly chunkSize: number;
    }
  | {
      readonly type: "asset-download-chunk";
      readonly requestId: string;
      readonly index: number;
      readonly data: string;
    }
  | { readonly type: "asset-download-end"; readonly requestId: string; readonly hash: string }
  | {
      readonly type: "asset-rejected";
      readonly requestId?: string;
      readonly hash?: string;
      readonly name?: string;
      readonly message: string;
    }
  | {
      readonly type: "error";
      readonly code: string;
      readonly message: string;
      readonly transactionId?: string;
    }
  | { readonly type: "pong" };

/** Connection lifecycle shown by the room panel. */
export type RoomStatus =
  "idle" | "connecting" | "waiting" | "connected" | "reconnecting" | "offline" | "error";

/** Presentation state the chrome and editor read for the active room. */
export interface CollaborationState {
  readonly status: RoomStatus;
  readonly roomId: string;
  readonly invite: string;
  /** Normalized WebSocket URL used to build clickable invitations. */
  readonly serverUrl: string;
  readonly memberId: string;
  readonly hostId: string;
  readonly role: CollaborationRole;
  readonly revision: number;
  /** Host-adjustable online-member limit, including the host. */
  readonly maxMembers: number;
  /** The room relays only ciphertext; the key never leaves this client. */
  readonly encrypted: boolean;
  /** Present only while this client is in an encrypted room. */
  readonly roomKey: string;
  readonly members: readonly RoomMember[];
  readonly presence: readonly MemberPresence[];
  readonly assets: readonly RoomAsset[];
  readonly locks: readonly RoomLock[];
  readonly pending: readonly RoomPendingRequest[];
  /** Local changes waiting for an acknowledgement or a reconnect. */
  readonly queued: number;
  readonly error: string;
}

/** Structural socket surface; the browser WebSocket satisfies it. */
export interface CollaborationSocket {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  addEventListener(type: string, listener: (event: Event) => void): void;
  removeEventListener?(type: string, listener: (event: Event) => void): void;
}

/** Creates a socket for a normalized room URL. */
export type CollaborationSocketFactory = (url: string) => CollaborationSocket;
