/* eslint-disable max-lines -- room ordering, roles, locks, assets, undo, and persistence share one authority. */
/**
 * Authoritative room state for the collaboration server.
 *
 * The room orders transactions, enforces roles, deduplicates retries, and keeps
 * the last accepted chart. Transport lives in the server entry point; this module
 * stays deterministic so the protocol rules can be tested without sockets.
 */
import {
  applyChartChanges,
  changeLockKeys,
  stableFingerprint,
  type ChartChange,
} from "./changes.ts";
import {
  ASSET_HASH,
  MAX_ASSET_BYTES,
  MAX_ROOM_ASSETS,
  MAX_ROOM_ASSET_BYTES,
  isAllowedAssetMime,
  sanitizeAssetName,
} from "./assets.ts";
import { ByteBudget } from "../io/budget.ts";
import { isEncryptedPayload, type EncryptedPayload } from "./e2e.ts";
import {
  acquireLeases,
  activeLeases,
  foreignLeases,
  missingLeases,
  releaseLeases,
  releaseOwnerLeases,
  sweepExpiredLeases,
} from "./leases.ts";
import { canPerform } from "./permissions.ts";
import { deleteUndo, recordUndo, validateUndo } from "./undoLedger.ts";
import type {
  CollaborationProfile,
  CollaborationRole,
  MemberPresence,
  RoomAsset,
  RoomLock,
  RoomMember,
} from "./types.ts";

/** Maximum live rooms retained by one server. */
export const MAX_ROOMS = 32;
/** Maximum live rooms created by one client identity. */
export const MAX_ROOMS_PER_OWNER = 4;
/** Maximum retained transactions per plaintext room. */
export const MAX_TX_LOG = 5000;
/** Maximum retained transaction payload bytes per room. */
export const MAX_TX_LOG_BYTES = 8 * 1024 * 1024;
/** Maximum retained encrypted transactions; they cannot be evicted safely. */
export const MAX_ENCRYPTED_TX_LOG = 5000;
/** Maximum retained encrypted transaction bytes per room. */
export const MAX_ENCRYPTED_TX_LOG_BYTES = 8 * 1024 * 1024;
/** Online-member limit for a new room and for an unusable persisted value. */
export const DEFAULT_MAX_MEMBERS = 4;
/** Largest allowed online-member limit. */
export const MAX_MEMBERS = 32;

/**
 * Normalize a persisted member limit: an integer in 2..32 stays, anything else
 * falls back to the default. Both room implementations apply the same rule, so
 * a legacy zero and every out-of-range value restore identically.
 */
export function normalizeMaxMembers(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 2 && value <= MAX_MEMBERS
    ? value
    : DEFAULT_MAX_MEMBERS;
}

/** Server-side member record, including the token used to resume a session. */
export interface RoomMemberRecord {
  readonly id: string;
  readonly token: string;
  readonly profile: CollaborationProfile;
  role: CollaborationRole;
  online: boolean;
  presence?: MemberPresence;
}

/** A guest awaiting host approval. */
export interface PendingJoin {
  readonly requestId: string;
  readonly profile: CollaborationProfile;
}

/** Authoritative state of one room. */
export interface RoomRecord {
  readonly id: string;
  invite: string;
  hostId: string;
  /** Rate-limit identity of the creating connection. */
  owner: string;
  chart: unknown;
  fingerprint: string;
  /** Product version used by the host, for diagnostics and compatibility warnings. */
  appVersion: string;
  revision: number;
  /** The chart is an opaque AES-GCM envelope and the log is client-applied. */
  encrypted: boolean;
  /** Joins become editors immediately without host approval. */
  autoApproveEditor: boolean;
  /** Host-adjustable online-member limit, including the host. */
  maxMembers: number;
  readonly createdAt: number;
  readonly members: Map<string, RoomMemberRecord>;
  readonly pending: Map<string, PendingJoin>;
  /** Retry records keyed by actor id plus transaction id. */
  readonly transactions: Map<string, CommittedTransaction>;
  /** Content digests matched when a transaction id is retried. */
  readonly transactionHashes: Map<string, string>;
  /** Estimated payload bytes retained in `transactions`. */
  transactionBytes: number;
  /** Compact transaction/undo ledger retained across restarts. */
  readonly undoLedger: Map<
    string,
    { readonly actorId: string; readonly transactionId: string; readonly undoOf?: string }
  >;
  readonly assets: Map<string, RoomAsset>;
  readonly locks: Map<string, RoomLock>;
}

/** One accepted transaction retained for replay and retry deduplication. */
export interface CommittedTransaction {
  readonly revision: number;
  readonly transactionId: string;
  readonly actorId: string;
  readonly label: string;
  readonly changes: readonly ChartChange[] | EncryptedPayload;
  readonly undoOf?: string;
  readonly fingerprint: string;
  /** A deduplicated retry that must not be broadcast again. */
  readonly replayed?: boolean;
}

/** Success value or a stable failure code with a diagnostic message. */
export type RoomResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly code: string; readonly message: string };

/** Random room code using the unambiguous alphabet. */
function token(size = 6): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let value = "";
  const crypto = globalThis.crypto;
  const bytes = new Uint8Array(size);
  crypto.getRandomValues(bytes);
  for (const byte of bytes) {
    value += alphabet[byte % alphabet.length];
  }
  return value;
}

/** Unique member or request id, falling back when `randomUUID` is absent. */
function id(): string {
  const crypto = globalThis.crypto;
  if (typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

/** Deduplication key that binds a client transaction id to one actor. */
function transactionKey(actorId: string, transactionId: string): string {
  return `${actorId}\u0000${transactionId}`;
}

/** Content digest used to reject reuse of one transaction id for other content. */
function transactionHash(
  changes: readonly ChartChange[] | EncryptedPayload,
  undoOf?: string,
): string {
  return stableFingerprint({ changes, undoOf: undoOf ?? "" });
}

/** Estimated retained payload bytes for one transaction. */
function transactionBytes(changes: readonly ChartChange[] | EncryptedPayload): number {
  return new TextEncoder().encode(JSON.stringify(changes)).length;
}

/** Whether a value is a plain object with named fields. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Clamp a display profile to the room's name and colour contract. */
function cleanProfile(profile: CollaborationProfile): CollaborationProfile {
  const name = profile.name.trim().slice(0, 40) || "Member";
  const color = /^#[0-9a-f]{6}$/i.test(profile.color) ? profile.color.toLowerCase() : "#77b7ff";
  return { name, color };
}

/** Reject payloads that cannot be a chart before they become room state. */
export function isChartLike(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }
  if (
    !isRecord(value.META) ||
    !Array.isArray(value.BPMList) ||
    !Array.isArray(value.judgeLineList)
  ) {
    return false;
  }
  return value.judgeLineList.every(
    (line) => isRecord(line) && Array.isArray(line.notes) && Array.isArray(line.eventLayers),
  );
}

/**
 * Server-side room authority: ordering, roles, locks, assets, and persistence.
 *
 * Mutations return a `RoomResult` or the affected room; a rejected batch leaves
 * the room unchanged. The class is transport-free so the protocol rules can be
 * tested without sockets.
 */
export class CollaborationRooms {
  private readonly rooms = new Map<string, RoomRecord>();
  private readonly assetBlobs = new Map<string, Uint8Array>();

  /**
   * Create a room and its host membership.
   *
   * Rejects an invite outside 8-64 characters, a chart or envelope that fails
   * the matching shape check, and a caller that already owns the maximum number
   * of rooms. Persisted rooms and invitation links created before the minimum
   * length changed remain joinable because this check only runs on create.
   */
  create(
    profile: CollaborationProfile,
    chart: unknown,
    fingerprint: string,
    encrypted = false,
    autoApproveEditor = false,
    customInvite = "",
    owner = "",
    appVersion = "",
  ): RoomResult<{ room: RoomRecord; member: RoomMemberRecord }> {
    const invite = customInvite.trim();
    if (invite && [...invite].length < 8) {
      return {
        ok: false,
        code: "bad_invite",
        message: "Room password must be 8 to 64 characters",
      };
    }
    if ([...invite].length > 64) {
      return {
        ok: false,
        code: "bad_invite",
        message: "Room password must be 8 to 64 characters",
      };
    }
    if (this.rooms.size >= MAX_ROOMS) {
      return {
        ok: false,
        code: "rooms_full",
        message: "The server has reached its room limit; close a room and retry",
      };
    }
    if (
      owner &&
      [...this.rooms.values()].filter((room) => room.owner === owner).length >= MAX_ROOMS_PER_OWNER
    ) {
      return {
        ok: false,
        code: "owner_rooms_full",
        message: "This client has reached its room limit; close a room and retry",
      };
    }
    if (encrypted ? !isEncryptedPayload(chart) : !isChartLike(chart)) {
      return {
        ok: false,
        code: encrypted ? "invalid_encrypted_chart" : "invalid_chart",
        message: "The room chart is not a valid chart",
      };
    }
    const room: RoomRecord = {
      id: token(8),
      invite: invite || token(10),
      hostId: "",
      owner,
      chart: structuredClone(chart),
      fingerprint: fingerprint || stableFingerprint(chart),
      appVersion: appVersion.trim(),
      revision: 0,
      encrypted,
      autoApproveEditor,
      maxMembers: DEFAULT_MAX_MEMBERS,
      createdAt: Date.now(),
      members: new Map(),
      pending: new Map(),
      transactions: new Map(),
      transactionHashes: new Map(),
      transactionBytes: 0,
      undoLedger: new Map(),
      assets: new Map(),
      locks: new Map(),
    };
    const host: RoomMemberRecord = {
      id: id(),
      token: token(24),
      profile: cleanProfile(profile),
      role: "host",
      online: true,
    };
    room.hostId = host.id;
    room.members.set(host.id, host);
    this.rooms.set(room.id, room);
    return { ok: true, value: { room, member: host } };
  }

  /**
   * Resolve a join by room code or invite, checking the password and capacity.
   *
   * Returns a pending request unless the room auto-approves editors.
   */
  requestJoin(
    roomId: string,
    invite: string,
    profile: CollaborationProfile,
    appVersion = "",
  ): RoomResult<{
    room: RoomRecord;
    request?: PendingJoin;
    member?: RoomMemberRecord;
  }> {
    // The endpoint is the room identity. A client that joins by address and
    // password sends no code; the password selects the room on that endpoint.
    const code = roomId.trim();
    const rooms = [...this.rooms.values()].sort((left, right) => right.createdAt - left.createdAt);
    const room =
      code.length > 0
        ? this.rooms.get(code.toUpperCase())
        : (rooms.find((candidate) => candidate.invite === invite.trim()) ?? rooms[0]);
    if (!room) {
      return { ok: false, code: "no_room", message: "Room not found" };
    }
    if (room.invite !== invite.trim()) {
      return { ok: false, code: "bad_invite", message: "Room password is incorrect" };
    }
    if ([...room.members.values()].filter((member) => member.online).length >= room.maxMembers) {
      return { ok: false, code: "room_full", message: "Room is full" };
    }
    const clean = cleanProfile(profile);
    if (room.autoApproveEditor) {
      const member: RoomMemberRecord = {
        id: id(),
        token: token(24),
        profile: clean,
        role: "editor",
        online: true,
      };
      room.members.set(member.id, member);
      return { ok: true, value: { room, member } };
    }
    const request: PendingJoin = { requestId: id(), profile: clean };
    room.pending.set(request.requestId, request);
    return { ok: true, value: { room, request } };
  }

  /** Host-only decision for one pending join; an approved guest gets the given role. */
  approve(
    actorId: string,
    requestId: string,
    allow: boolean,
    role: CollaborationRole = "editor",
  ): RoomResult<{ room: RoomRecord; request: PendingJoin; member?: RoomMemberRecord }> {
    const room = this.roomForMember(actorId);
    if (!room) {
      return { ok: false, code: "no_room", message: "Not in a room" };
    }
    const actor = room.members.get(actorId);
    if (!actor || !canPerform(actor.role, "approve-member")) {
      return { ok: false, code: "forbidden", message: "Only the host can approve members" };
    }
    const request = room.pending.get(requestId);
    if (!request) {
      return { ok: false, code: "no_request", message: "Join request expired" };
    }
    if (!allow) {
      room.pending.delete(requestId);
      return { ok: true, value: { room, request } };
    }
    // A pending request can outlive a host limit change or wait while other
    // approvals fill the room. Recheck capacity before consuming it so the
    // host can retry after a slot opens.
    if ([...room.members.values()].filter((member) => member.online).length >= room.maxMembers) {
      return { ok: false, code: "room_full", message: "Room is full" };
    }
    room.pending.delete(requestId);
    const member: RoomMemberRecord = {
      id: id(),
      token: token(24),
      profile: { ...request.profile },
      role: role === "viewer" ? "viewer" : "editor",
      online: true,
    };
    room.members.set(member.id, member);
    return { ok: true, value: { room, request, member } };
  }

  /** Reattach a member after a reconnect using its stored resume token. */
  resume(
    roomId: string,
    resumeToken: string,
    appVersion = "",
  ): RoomResult<{ room: RoomRecord; member: RoomMemberRecord }> {
    const room = this.rooms.get(roomId.trim().toUpperCase());
    if (!room) {
      return { ok: false, code: "no_room", message: "Room not found" };
    }
    const member = [...room.members.values()].find((candidate) => candidate.token === resumeToken);
    if (!member) {
      return { ok: false, code: "bad_resume", message: "Room session expired" };
    }
    // A reconnect must not add an online member beyond the cap. A member whose
    // previous socket is still marked online keeps its existing slot; an
    // offline member needs a free one.
    if (
      !member.online &&
      [...room.members.values()].filter((candidate) => candidate.online).length >= room.maxMembers
    ) {
      return { ok: false, code: "room_full", message: "Room is full" };
    }
    member.online = true;
    return { ok: true, value: { room, member } };
  }

  /** Host-only change to the online-member limit, bounded to 2-32. */
  setMaxMembers(actorId: string, value: number): RoomResult<{ room: RoomRecord }> {
    if (!Number.isInteger(value) || value < 2 || value > MAX_MEMBERS) {
      return {
        ok: false,
        code: "bad_max_members",
        message: "Maximum members must be between 2 and 32",
      };
    }
    const room = this.roomForMember(actorId);
    if (!room) {
      return { ok: false, code: "no_room", message: "Not in a room" };
    }
    const actor = room.members.get(actorId);
    if (!actor || !canPerform(actor.role, "manage-room")) {
      return { ok: false, code: "forbidden", message: "Only the host can change the limit" };
    }
    // Lowering the cap below the current online count would put the room over
    // its own limit immediately, including when members later resume.
    if ([...room.members.values()].filter((member) => member.online).length > value) {
      return {
        ok: false,
        code: "bad_max_members",
        message: "Maximum members cannot be lower than the current online member count",
      };
    }
    room.maxMembers = value;
    return { ok: true, value: { room } };
  }

  /** Host-only password rotation for deterministic protocol tests and servers. */
  setPassword(actorId: string, value: string): RoomResult<{ room: RoomRecord }> {
    const invite = value.trim();
    if ([...invite].length < 8 || [...invite].length > 64) {
      return {
        ok: false,
        code: "bad_invite",
        message: "Room password must be 8 to 64 characters",
      };
    }
    const room = this.roomForMember(actorId);
    if (!room) {
      return { ok: false, code: "no_room", message: "Not in a room" };
    }
    const actor = room.members.get(actorId);
    if (!actor || !canPerform(actor.role, "manage-room")) {
      return {
        ok: false,
        code: "forbidden",
        message: "Only the host can change the room password",
      };
    }
    room.invite = invite;
    return { ok: true, value: { room } };
  }

  /** Host-only role change; demoting to viewer releases the member's leases. */
  setRole(
    actorId: string,
    memberId: string,
    role: Exclude<CollaborationRole, "host">,
  ): RoomResult<{ room: RoomRecord; member: RoomMemberRecord }> {
    const room = this.roomForMember(actorId);
    if (!room) {
      return { ok: false, code: "no_room", message: "Not in a room" };
    }
    const actor = room.members.get(actorId);
    if (!actor || !canPerform(actor.role, "change-role")) {
      return { ok: false, code: "forbidden", message: "Only the host can change roles" };
    }
    const member = room.members.get(memberId);
    if (!member || member.role === "host") {
      return { ok: false, code: "no_member", message: "Member cannot be changed" };
    }
    member.role = role === "viewer" ? "viewer" : "editor";
    if (!canPerform(member.role, "edit-chart")) {
      releaseOwnerLeases(room.locks, memberId);
    }
    return { ok: true, value: { room, member } };
  }

  /** Host-only removal; also clears the member's leases and pending requests. */
  removeMember(
    actorId: string,
    memberId: string,
  ): RoomResult<{ room: RoomRecord; member: RoomMemberRecord }> {
    const room = this.roomForMember(actorId);
    if (!room) {
      return { ok: false, code: "no_room", message: "Not in a room" };
    }
    const actor = room.members.get(actorId);
    if (!actor || !canPerform(actor.role, "remove-member")) {
      return { ok: false, code: "forbidden", message: "Only the host can remove members" };
    }
    const member = room.members.get(memberId);
    if (!member || member.role === "host") {
      return { ok: false, code: "no_member", message: "Member cannot be removed" };
    }
    member.online = false;
    room.members.delete(memberId);
    releaseOwnerLeases(room.locks, memberId);
    room.pending.forEach((request, requestId) => {
      if (request.profile.name === member.profile.name) {
        room.pending.delete(requestId);
      }
    });
    return { ok: true, value: { room, member } };
  }

  /** Host-only deletion; every member is disconnected and persistence drops the room. */
  closeRoom(actorId: string): RoomResult<{ room: RoomRecord; memberIds: readonly string[] }> {
    const room = this.roomForMember(actorId);
    if (!room) {
      return { ok: false, code: "no_room", message: "Not in a room" };
    }
    const actor = room.members.get(actorId);
    if (!actor || !canPerform(actor.role, "manage-room")) {
      return { ok: false, code: "forbidden", message: "Only the host can close the room" };
    }
    const memberIds = [...room.members.keys()];
    this.rooms.delete(room.id);
    return { ok: true, value: { room, memberIds } };
  }

  /** Mark a member offline, clear its presence, and release its leases. */
  leave(memberId: string): RoomRecord | null {
    const room = this.roomForMember(memberId);
    if (!room) {
      return null;
    }
    const member = room.members.get(memberId);
    if (member) {
      member.online = false;
      member.presence = undefined;
    }
    releaseOwnerLeases(room.locks, memberId);
    return room;
  }

  /** Treat a dropped socket as leaving the room. */
  disconnect(memberId: string): RoomRecord | null {
    return this.leave(memberId);
  }

  /** Publish a member's cursor and stamp it with the server time. */
  updatePresence(memberId: string, presence: MemberPresence): RoomRecord | null {
    const room = this.roomForMember(memberId);
    if (!room) {
      return null;
    }
    const member = room.members.get(memberId);
    if (!member) {
      return null;
    }
    member.presence = Object.freeze({ ...presence, memberId, updatedAt: Date.now() });
    return room;
  }

  /**
   * Apply a client batch. Every change is checked against the current room chart
   * and the whole batch is rejected on the first stale base.
   *
   * Deduplication is keyed by actor plus transaction id. An exact retry returns
   * the stored result with `replayed` set; reusing that id for different content
   * is rejected so one member cannot shadow another edit.
   */
  commit(
    actorId: string,
    transactionId: string,
    label: string,
    changes: readonly ChartChange[] | EncryptedPayload,
    undoOf?: string,
    lockIds: readonly string[] = [],
  ): RoomResult<CommittedTransaction> {
    const room = this.roomForMember(actorId);
    if (!room) {
      return { ok: false, code: "no_room", message: "Not in a room" };
    }
    const actor = room.members.get(actorId);
    if (!actor) {
      return { ok: false, code: "no_member", message: "Member is no longer in the room" };
    }
    if (!canPerform(actor.role, "edit-chart")) {
      return { ok: false, code: "read_only", message: "This member has read-only access" };
    }
    if (room.encrypted) {
      if (!isEncryptedPayload(changes)) {
        return {
          ok: false,
          code: "invalid_change",
          message: "Encrypted change envelope is invalid",
        };
      }
    } else if (!Array.isArray(changes) || changes.length === 0) {
      return { ok: false, code: "invalid_change", message: "Transaction has no changes" };
    }
    const key = transactionKey(actorId, transactionId);
    const contentHash = transactionHash(changes, undoOf);
    const previous = room.transactions.get(key);
    if (previous) {
      if (room.transactionHashes.get(key) !== contentHash) {
        return {
          ok: false,
          code: "transaction_reused",
          message: "That transaction id was already used with different content",
        };
      }
      return { ok: true, value: { ...previous, replayed: true } };
    }
    const entryBytes = transactionBytes(changes);
    if (entryBytes > MAX_TX_LOG_BYTES) {
      return {
        ok: false,
        code: "log_full",
        message: "That transaction is larger than the room log limit",
      };
    }
    if (
      room.encrypted &&
      (room.transactions.size >= MAX_ENCRYPTED_TX_LOG ||
        room.transactionBytes + entryBytes > MAX_ENCRYPTED_TX_LOG_BYTES)
    ) {
      return {
        ok: false,
        code: "log_full",
        message: "The encrypted room log is full; create a new room to continue",
      };
    }
    if (room.encrypted) {
      const lockCheck = this.checkEncryptedLocks(actorId, lockIds);
      if (!lockCheck.ok) {
        return lockCheck;
      }
    } else {
      const lockCheck = this.checkLocks(actorId, changes as readonly ChartChange[]);
      if (!lockCheck.ok) {
        return lockCheck;
      }
    }
    if (undoOf) {
      const decision = validateUndo(room.undoLedger, actorId, undoOf);
      if (!decision.ok) {
        return { ok: false, code: decision.code, message: decision.message };
      }
    }
    if (room.encrypted) {
      room.revision += 1;
      room.fingerprint = stableFingerprint({ chart: room.chart, revision: room.revision });
    } else {
      const applied = applyChartChanges(room.chart, changes as readonly ChartChange[]);
      if (applied.conflicts.length) {
        return {
          ok: false,
          code: "conflict",
          message: `Conflicting paths: ${applied.conflicts.join(", ")}`,
        };
      }
      if (!isChartLike(applied.chart)) {
        return {
          ok: false,
          code: "invalid_chart",
          message: "Transaction produced an invalid chart",
        };
      }
      room.chart = applied.chart;
      room.revision += 1;
      room.fingerprint = stableFingerprint(room.chart);
    }
    const committed: CommittedTransaction = Object.freeze({
      revision: room.revision,
      transactionId,
      actorId,
      label,
      changes,
      ...(undoOf ? { undoOf } : {}),
      fingerprint: room.fingerprint,
    });
    room.transactions.set(key, committed);
    room.transactionHashes.set(key, contentHash);
    room.transactionBytes += entryBytes;
    recordUndo(room.undoLedger, key, actorId, undoOf, transactionId);
    if (!room.encrypted) {
      // Retries only need a bounded window; an unbounded map would grow for the
      // lifetime of a long editing session. The newest entry is retained and
      // an entry larger than the whole budget was rejected above.
      while (
        room.transactions.size > 1 &&
        (room.transactions.size > MAX_TX_LOG || room.transactionBytes > MAX_TX_LOG_BYTES)
      ) {
        this.evictOldestTransaction(room);
      }
    }
    return { ok: true, value: committed };
  }

  /** Drop the oldest retained transaction and its undo entry. */
  private evictOldestTransaction(room: RoomRecord): void {
    const oldest = room.transactions.keys().next().value;
    if (oldest === undefined) {
      return;
    }
    const entry = room.transactions.get(oldest);
    room.transactions.delete(oldest);
    room.transactionHashes.delete(oldest);
    if (entry) {
      room.transactionBytes = Math.max(0, room.transactionBytes - transactionBytes(entry.changes));
    }
    deleteUndo(room.undoLedger, oldest);
  }

  /** Read one room by code; the caller already holds its authority. */
  snapshot(roomId: string): RoomResult<RoomRecord> {
    const room = this.rooms.get(roomId);
    return room
      ? { ok: true, value: room }
      : { ok: false, code: "no_room", message: "Room not found" };
  }

  /** Ordered opaque log replayed by clients joining an encrypted room. */
  encryptedTransactions(room: RoomRecord): readonly CommittedTransaction[] {
    return room.encrypted ? [...room.transactions.values()] : [];
  }

  /**
   * Validate and register one content-addressed asset after the transport has
   * verified its hash. Adding a new name follows upload permission; replacing an
   * existing name is host-only.
   */
  acceptAsset(
    memberId: string,
    name: string,
    hash: string,
    size: number,
    mime: string,
    bytes: Uint8Array,
    plaintextHash?: string,
  ): RoomResult<RoomAsset> {
    const room = this.roomForMember(memberId);
    if (!room) {
      return { ok: false, code: "no_room", message: "Not in a room" };
    }
    const member = room.members.get(memberId);
    if (!member) {
      return { ok: false, code: "no_member", message: "Member is no longer in the room" };
    }
    if (!canPerform(member.role, "upload-asset")) {
      return { ok: false, code: "read_only", message: "This member has read-only access" };
    }
    const safeName = sanitizeAssetName(name);
    if (!safeName) {
      return { ok: false, code: "invalid_name", message: "Asset name is not safe" };
    }
    const existing = room.assets.get(safeName);
    if (existing && !canPerform(member.role, "replace-asset")) {
      return {
        ok: false,
        code: "forbidden",
        message: "Only the host can replace an existing asset",
      };
    }
    if (!ASSET_HASH.test(hash) || !isAllowedAssetMime(mime)) {
      return { ok: false, code: "invalid_asset", message: "Asset hash or type is invalid" };
    }
    if (plaintextHash !== undefined && !ASSET_HASH.test(plaintextHash)) {
      return { ok: false, code: "invalid_asset", message: "Asset plaintext hash is invalid" };
    }
    if (!Number.isSafeInteger(size) || size <= 0 || size > MAX_ASSET_BYTES) {
      return { ok: false, code: "invalid_size", message: "Asset size is outside the room limit" };
    }
    if (bytes.byteLength !== size) {
      return { ok: false, code: "invalid_size", message: "Asset size does not match its bytes" };
    }
    const retained = [...room.assets.values()]
      .filter((entry) => entry.name !== safeName)
      .reduce((sum, entry) => sum + entry.size, 0);
    if (!existing && room.assets.size >= MAX_ROOM_ASSETS) {
      return { ok: false, code: "room_assets_full", message: "Room asset limit reached" };
    }
    const budget = new ByteBudget({ limit: MAX_ROOM_ASSET_BYTES, used: retained });
    if (!budget.canFit(size)) {
      return { ok: false, code: "room_assets_full", message: "Room asset size limit reached" };
    }
    const asset: RoomAsset = Object.freeze({
      name: safeName,
      hash,
      size,
      mime,
      ...(plaintextHash ? { plaintextHash } : {}),
    });
    this.assetBlobs.set(hash, bytes);
    room.assets.set(safeName, asset);
    return { ok: true, value: asset };
  }

  /** Frozen copy of the room's asset manifest for a welcome message. */
  assetManifest(room: RoomRecord): readonly RoomAsset[] {
    return Object.freeze([...room.assets.values()].map((asset) => Object.freeze({ ...asset })));
  }

  /** Resolve a blob only for a current member of the room that references it. */
  assetForMember(
    memberId: string,
    hash: string,
    name?: string,
  ): RoomResult<{ asset: RoomAsset; bytes: Uint8Array }> {
    const room = this.roomForMember(memberId);
    if (!room || !room.members.has(memberId)) {
      return { ok: false, code: "no_member", message: "Member is no longer in the room" };
    }
    const asset = [...room.assets.values()].find(
      (entry) => entry.hash === hash && (name === undefined || entry.name === name),
    );
    const bytes = this.assetBlobs.get(hash);
    if (!asset || !bytes) {
      return { ok: false, code: "no_asset", message: "Asset is not available in this room" };
    }
    return { ok: true, value: { asset, bytes } };
  }

  /** Serialize enough room state to recover after a server restart. */
  exportState(): {
    readonly rooms: readonly {
      readonly id: string;
      readonly invite: string;
      readonly hostId: string;
      readonly host: {
        readonly id: string;
        readonly token: string;
        readonly profile: CollaborationProfile;
      };
      readonly chart: unknown;
      readonly fingerprint: string;
      readonly appVersion: string;
      readonly revision: number;
      readonly encrypted: boolean;
      readonly autoApproveEditor: boolean;
      readonly maxMembers?: number;
      readonly owner?: string;
      readonly createdAt: number;
      readonly assets: readonly RoomAsset[];
      readonly log?: readonly CommittedTransaction[];
      readonly undo: readonly {
        readonly id: string;
        readonly actorId: string;
        readonly undoOf?: string;
      }[];
    }[];
    readonly assetHashes: readonly string[];
  } {
    return {
      rooms: [...this.rooms.values()].flatMap((room) => {
        const host = room.members.get(room.hostId);
        if (!host) {
          return [];
        }
        return [
          {
            id: room.id,
            invite: room.invite,
            hostId: room.hostId,
            host: { id: host.id, token: host.token, profile: { ...host.profile } },
            chart: room.chart,
            fingerprint: room.fingerprint,
            appVersion: room.appVersion,
            revision: room.revision,
            encrypted: room.encrypted,
            autoApproveEditor: room.autoApproveEditor,
            maxMembers: room.maxMembers,
            ...(room.owner ? { owner: room.owner } : {}),
            createdAt: room.createdAt,
            assets: this.assetManifest(room),
            ...(room.encrypted ? { log: [...room.transactions.values()] } : {}),
            undo: [...room.undoLedger.values()].map((entry) => ({
              id: entry.transactionId,
              actorId: entry.actorId,
              ...(entry.undoOf ? { undoOf: entry.undoOf } : {}),
            })),
          },
        ];
      }),
      assetHashes: [...this.assetBlobs.keys()],
    };
  }

  /** Restore persisted rooms; guests rejoin and blobs must be supplied separately. */
  importState(
    state: ReturnType<CollaborationRooms["exportState"]>,
    blobs: ReadonlyMap<string, Uint8Array>,
  ): void {
    this.rooms.clear();
    this.assetBlobs.clear();
    for (const [hash, bytes] of blobs) {
      this.assetBlobs.set(hash, bytes);
    }
    for (const record of state.rooms) {
      if (this.rooms.size >= MAX_ROOMS) {
        break;
      }
      if (record.encrypted ? !isEncryptedPayload(record.chart) : !isChartLike(record.chart)) {
        continue;
      }
      const host: RoomMemberRecord = {
        id: record.host.id,
        token: record.host.token,
        profile: cleanProfile(record.host.profile),
        role: "host",
        online: false,
      };
      const assets = new Map<string, RoomAsset>();
      for (const asset of record.assets) {
        if (this.assetBlobs.has(asset.hash)) {
          assets.set(asset.name, Object.freeze({ ...asset }));
        }
      }
      const transactions = new Map<string, CommittedTransaction>();
      const transactionHashes = new Map<string, string>();
      let transactionBytesTotal = 0;
      for (const entry of record.log ?? []) {
        const key = transactionKey(entry.actorId, entry.transactionId);
        if (transactions.has(key)) {
          continue;
        }
        transactions.set(key, entry);
        transactionHashes.set(key, transactionHash(entry.changes, entry.undoOf));
        transactionBytesTotal += transactionBytes(entry.changes);
      }
      const undoLedger = new Map<
        string,
        { readonly actorId: string; readonly transactionId: string; readonly undoOf?: string }
      >();
      for (const entry of record.undo ?? []) {
        undoLedger.set(transactionKey(entry.actorId, entry.id), {
          actorId: entry.actorId,
          transactionId: entry.id,
          ...(entry.undoOf ? { undoOf: entry.undoOf } : {}),
        });
      }
      this.rooms.set(record.id, {
        id: record.id,
        invite: record.invite,
        hostId: record.hostId,
        owner: typeof record.owner === "string" ? record.owner : "",
        chart: record.chart,
        fingerprint: record.fingerprint,
        appVersion: typeof record.appVersion === "string" ? record.appVersion.trim() : "",
        revision: record.revision,
        encrypted: record.encrypted === true,
        autoApproveEditor: record.autoApproveEditor === true,
        maxMembers: normalizeMaxMembers(record.maxMembers),
        createdAt: record.createdAt,
        members: new Map([[host.id, host]]),
        pending: new Map(),
        transactions,
        transactionHashes,
        transactionBytes: transactionBytesTotal,
        undoLedger,
        assets,
        locks: new Map(),
      });
    }
  }

  /** Read a stored asset blob by content hash, or undefined when absent. */
  blob(hash: string): Uint8Array | undefined {
    return this.assetBlobs.get(hash);
  }

  /** Acquire an all-or-nothing lease set; expired leases are ignored. */
  acquireLocks(
    memberId: string,
    requested: readonly string[],
    ttlMs = 15_000,
  ): RoomResult<readonly RoomLock[]> {
    const room = this.roomForMember(memberId);
    if (!room) {
      return { ok: false, code: "no_room", message: "Not in a room" };
    }
    const member = room.members.get(memberId);
    if (!member) {
      return { ok: false, code: "no_member", message: "Member is no longer in the room" };
    }
    if (!canPerform(member.role, "edit-chart")) {
      return { ok: false, code: "read_only", message: "This member has read-only access" };
    }
    const now = Date.now();
    this.sweepLocks(now);
    const acquired = acquireLeases(room.locks, memberId, requested, { ttlMs, now });
    if (!acquired.ok) {
      if (acquired.reason === "empty") {
        return { ok: false, code: "invalid_lock", message: "No lock targets were requested" };
      }
      return {
        ok: false,
        code: "locked",
        message: `Locked: ${acquired.conflicts.map((lock) => lock.id).join(", ")}`,
      };
    }
    return { ok: true, value: acquired.leases };
  }

  /** Release leases the member owns; other owners' leases are untouched. */
  releaseLocks(memberId: string, ids: readonly string[]): RoomRecord | null {
    const room = this.roomForMember(memberId);
    if (!room) {
      return null;
    }
    releaseLeases(room.locks, memberId, ids);
    return room;
  }

  /** Release every lease the member owns. */
  releaseMemberLocks(memberId: string): RoomRecord | null {
    const room = this.roomForMember(memberId);
    if (!room) {
      return null;
    }
    releaseOwnerLeases(room.locks, memberId);
    return room;
  }

  /** Frozen leases still active in the room after sweeping expired ones. */
  roomLocks(room: RoomRecord, now = Date.now()): readonly RoomLock[] {
    this.sweepLocks(now);
    return activeLeases(room.locks, now);
  }

  /** Delete every lease whose expiry passed; returns whether anything changed. */
  sweepLocks(now = Date.now()): boolean {
    let changed = false;
    for (const room of this.rooms.values()) {
      changed = sweepExpiredLeases(room.locks, now) > 0 || changed;
    }
    return changed;
  }

  /**
   * Encrypted rooms cannot derive paths server-side. The client presents the
   * leases it acquired; the server verifies ownership and requires at least one.
   */
  checkEncryptedLocks(actorId: string, lockIds: readonly string[]): RoomResult<null> {
    const room = this.roomForMember(actorId);
    if (!room) {
      return { ok: false, code: "no_room", message: "Not in a room" };
    }
    if (!lockIds.length) {
      return { ok: false, code: "missing_lock", message: "Encrypted transactions require leases" };
    }
    const missing = missingLeases(room.locks, actorId, lockIds);
    if (missing.length > 0) {
      return { ok: false, code: "locked", message: `Lease is not held: ${missing[0]}` };
    }
    return { ok: true, value: null };
  }

  /** Transactions may only touch objects not leased by another member. */
  checkLocks(actorId: string, changes: readonly ChartChange[]): RoomResult<null> {
    const room = this.roomForMember(actorId);
    if (!room) {
      return { ok: false, code: "no_room", message: "Not in a room" };
    }
    const keys = changeLockKeys(changes);
    // A chart lease blocks every change, not only chart-wide ones.
    const ids = new Set<string>(["chart"]);
    for (const id of keys.lines) {
      ids.add(id);
    }
    for (const id of keys.objects) {
      ids.add(id);
    }
    this.sweepLocks();
    const conflicts = foreignLeases(room.locks, actorId, [...ids]);
    if (conflicts.length > 0) {
      return {
        ok: false,
        code: "locked",
        message: `Object is locked by another member: ${conflicts[0].id}`,
      };
    }
    return { ok: true, value: null };
  }

  /** Drop blobs no room manifest references. */
  collectAssets(): void {
    const referenced = new Set<string>();
    for (const room of this.rooms.values()) {
      for (const asset of room.assets.values()) {
        referenced.add(asset.hash);
      }
    }
    for (const hash of this.assetBlobs.keys()) {
      if (!referenced.has(hash)) {
        this.assetBlobs.delete(hash);
      }
    }
  }

  /** Number of rooms currently retained. */
  roomCount(): number {
    return this.rooms.size;
  }

  /** Remove one pending join wherever it lives; returns its room and host. */
  discardPending(requestId: string): { room: RoomRecord; hostId: string } | null {
    for (const room of this.rooms.values()) {
      if (room.pending.delete(requestId)) {
        return { room, hostId: room.hostId };
      }
    }
    return null;
  }

  /** Find the room that contains a member. */
  roomForMember(memberId: string): RoomRecord | null {
    for (const room of this.rooms.values()) {
      if (room.members.has(memberId)) {
        return room;
      }
    }
    return null;
  }

  /** Public member list with copied profiles. */
  members(room: RoomRecord): RoomMember[] {
    return [...room.members.values()].map((member) => ({
      id: member.id,
      profile: { ...member.profile },
      role: member.role,
      online: member.online,
    }));
  }

  /** Presence records of members that have published one. */
  presence(room: RoomRecord): MemberPresence[] {
    return [...room.members.values()]
      .map((member) => member.presence)
      .filter((presence): presence is MemberPresence => Boolean(presence));
  }

  /** Remove empty rooms after their host and members have all left. */
  prune(now = Date.now()): void {
    for (const [roomId, room] of this.rooms) {
      const online = [...room.members.values()].some((member) => member.online);
      if (!online && now - room.createdAt > 24 * 60 * 60 * 1000) {
        this.rooms.delete(roomId);
      }
    }
  }
}
