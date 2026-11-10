/* eslint-disable max-lines -- connection, E2E crypto, assets, locks, and undo share one wire state machine. */
/**
 * Room client for the authoritative collaboration server.
 *
 * The client owns connection state, room membership, reconnect backoff, and
 * pending transaction retries. It never applies chart data itself: the editor
 * integration receives snapshots and accepted change batches through callbacks,
 * which keeps chart validation and history in the editor's own modules.
 */
import { createValue, type ValueCell } from "../state/values.ts";
import { Backoff } from "../runtime/backoff.ts";
import { Heartbeat } from "../runtime/heartbeat.ts";
import { applyChartChanges, type ChartChange } from "./changes.ts";
import { MAX_ASSET_BYTES, matchesAssetMagic, mimeForAsset } from "./assets.ts";
import {
  AssetAssembler,
  assetChunkRanges,
  decodeBinaryAssetFrame,
  encodeBinaryAssetFrame,
} from "./transfer.ts";
import { Outbox } from "./outbox.ts";
import { base64ToBytes, bytesToBase64, randomToken, sha256Hex } from "./digest.ts";
import {
  CHANGES_GZIP_THRESHOLD_BYTES,
  decodeChartWire,
  decodeGzipJson,
  encodeGzipJson,
  gzipBytes,
  gunzipBytes,
  type ChartWireEncoding,
} from "./chartWire.ts";
import { yieldToHost } from "../utils/yieldToHost.ts";
import {
  createRoomKey,
  decryptBytes,
  decryptEnvelopeBytes,
  decryptJson,
  encryptBytes,
  encryptEnvelopeBytes,
  encryptJson,
  importRoomKey,
  isEncryptedPayload,
  normalizeRoomKey,
  type EncryptedPayload,
} from "./e2e.ts";
import { EMPTY_COLLABORATION_STATE } from "./ui.ts";
import { versionMismatchCode, versionMismatchMessage } from "./version.ts";
import {
  type ClientMessage,
  type CollaborationProfile,
  type CollaborationRole,
  type CollaborationSocket,
  type CollaborationSocketFactory,
  type CollaborationState,
  type EncryptedTransaction,
  type MemberPresence,
  type RoomAsset,
  type RoomLock,
  type RoomSnapshot,
  type ServerMessage,
} from "./types.ts";

/** A committed wire message after any encrypted payload has been decrypted. */
export type CommittedMessage = Omit<Extract<ServerMessage, { type: "committed" }>, "changes"> & {
  readonly changes: readonly ChartChange[];
};

/** One upload or download milestone, used by the room progress dialog. */
export interface AssetTransferProgress {
  readonly name: string;
  readonly direction: "upload" | "download";
  /** `begin` and `progress` keep the row active; `done` releases it. */
  readonly state: "begin" | "progress" | "done";
  readonly received: number;
  readonly total: number;
}

/** Options for a collaboration client. */
export interface CollaborationClientOptions {
  readonly socketFactory?: CollaborationSocketFactory;
  readonly reconnect?: boolean;
  /** Product version sent during room creation, join, and resume handshakes. */
  readonly appVersion?: string;
  /** Shared observable state, when the React shell already owns the cell. */
  readonly state?: ValueCell<CollaborationState>;
  readonly onSnapshot?: (snapshot: RoomSnapshot, initial: boolean) => void;
  readonly onCommitted?: (message: CommittedMessage) => void;
  readonly onConflict?: (message: Extract<ServerMessage, { type: "conflict" }>) => void;
  readonly onRole?: (role: CollaborationRole, reason?: string) => void;
  readonly onError?: (message: string, code?: string) => void;
  readonly onAssetReady?: (asset: RoomAsset, bytes: Uint8Array) => void;
  readonly onAssetProgress?: (progress: AssetTransferProgress) => void;
  readonly onAssetError?: (message: string, assetName?: string) => void;
  readonly onMemberLeft?: (memberId: string) => void;
  readonly onLockDenied?: (conflicts: readonly RoomLock[]) => void;
  /** A lock request received no answer before its client-side deadline. */
  readonly onLockTimeout?: () => void;
  /**
   * A queued batch could not be sent or was rejected before commit, such as a
   * full outbox or a denied lease. The shell keeps the local edit visible and
   * offers retry or discard; the client has already dropped the wire copy.
   */
  readonly onTransactionRejected?: (
    transaction: TransactionInput & { readonly transactionId: string },
    message: string,
    code: string,
  ) => void;
}

/** One local change batch awaiting acknowledgement, optionally pre-encrypted. */
export interface TransactionInput {
  readonly label: string;
  readonly changes: readonly ChartChange[];
  readonly affectedObjectIds: readonly string[];
  /** Reuse the history entry's stable request id across reconnects. */
  readonly transactionId?: string;
  /** Reference to the original transaction when this batch compensates it. */
  readonly undoOf?: string;
  /** Leases held for this batch; released when it settles. */
  readonly lockIds?: readonly string[];
}

interface PendingTransaction extends TransactionInput {
  readonly transactionId: string;
  /** Prepared wire payload; plaintext rooms keep an array or a gzip string. */
  wireChanges?: readonly ChartChange[] | EncryptedPayload | string;
  /** Set when the prepared wire payload is gzip-encoded. */
  wireEncoding?: "gzip";
  /** True while an async encryption or compression step is still running. */
  preparing: boolean;
  /** Whether the lease set was granted in this connection generation. */
  locksHeld: boolean;
  /** A lease request is already in flight for this batch. */
  locksPending: boolean;
}

interface PendingUpload {
  readonly requestId: string;
  readonly name: string;
  readonly hash: string;
  readonly size: number;
  readonly mime: string;
  readonly plaintextHash: string;
}

interface PendingDownload {
  readonly requestId: string;
  readonly asset: RoomAsset;
  readonly assembler: AssetAssembler;
}

const initialState: CollaborationState = EMPTY_COLLABORATION_STATE;

/** A socket that never reaches `open` is reported as a timeout. */
const CONNECT_TIMEOUT_MS = 10_000;
/** A socket that opens but never answers create/join/resume is also a timeout. */
const HANDSHAKE_TIMEOUT_MS = 15_000;
/** Keep Cloudflare and other proxies from treating an idle room as dead. */
const HEARTBEAT_MS = 20_000;
const HEARTBEAT_TIMEOUT_MS = 10_000;
/** A large asset may take minutes on a LAN, but a lost acknowledgement must not hang a save. */
const ASSET_ACK_TIMEOUT_MS = 300_000;

/** Whether a parsed value looks like a tagged server message. */
function isMessage(value: unknown): value is ServerMessage {
  return (
    value !== null &&
    typeof value === "object" &&
    typeof (value as { type?: unknown }).type === "string"
  );
}

/** Normalize a server entry to a `ws://` or `wss://` socket URL. */
function normalizeUrl(value: string): string {
  const trimmed = value.trim();
  if (/^wss?:\/\//i.test(trimmed)) {
    return trimmed;
  }
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed.replace(/^http/i, "ws");
  }
  return `ws://${trimmed}`;
}

/** Unique transaction or request id with a non-crypto fallback. */
function randomId(): string {
  const crypto = globalThis.crypto;
  if (crypto && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `tx-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

/** Bounded estimate of one transaction's wire size for the outgoing queue. */
function transactionBytes(input: TransactionInput): number {
  let bytes = input.label.length + input.affectedObjectIds.length * 24;
  for (const change of input.changes) {
    bytes += change.path.length + 96;
  }
  return bytes;
}

/** Create the observable room state used by the UI and editor integration. */
export function createCollaborationState(): ValueCell<CollaborationState> {
  return createValue<CollaborationState>({ initial: initialState });
}

/**
 * WebSocket client for one collaboration room.
 *
 * Owns connection state, membership, reconnect backoff, encrypted asset
 * transfer, and pending transaction retries. Chart data is passed to the editor
 * through callbacks; this class never applies it to the local document.
 */
export class CollaborationClient {
  readonly state: ValueCell<CollaborationState>;
  private readonly options: CollaborationClientOptions;
  private readonly socketFactory: CollaborationSocketFactory;
  private readonly appVersion: string;
  private socket: CollaborationSocket | null = null;
  private socketOpen = false;
  private binaryChunks = false;
  private assetAdopt = false;
  private serverUrl = "";
  private socketUrl = "";
  private resumeToken = "";
  /** Revision and fingerprint this client has actually applied to its document. */
  private appliedRevision = -1;
  private appliedFingerprint = "";
  /** Room and token supplied before the first socket open, for restart recovery. */
  private resumeTarget: { readonly roomId: string; readonly token: string } | null = null;
  private profile: CollaborationProfile = { name: "", color: "#77b7ff" };
  private hostChart: {
    chart: unknown;
    fingerprint: string;
    chartEncoding?: ChartWireEncoding;
  } | null = null;
  private invitedRoom: { roomId: string; invite: string } | null = null;
  private encrypted = false;
  private roomKey = "";
  private autoApproveEditor = false;
  private roomInvite = "";
  private encryptionKey: CryptoKey | null = null;
  private encryptedCommitQueue: Promise<void> = Promise.resolve();
  /** Queues server messages behind an in-flight gzip payload decode. */
  private decoding = false;
  private queuedData: unknown[] = [];
  private chartTransfer: {
    message: ServerMessage;
    id: string;
    size: number;
    count: number;
    bytes: Uint8Array;
    seen: Uint8Array;
    received: number;
  } | null = null;
  private roomGeneration = 0;
  private readonly outbox = new Outbox<PendingTransaction>({
    maxEntries: 512,
    maxBytes: 8 * 1024 * 1024,
    now: () => Date.now(),
  });
  private uploads = new Map<string, PendingUpload>();
  private readonly beginWaiters = new Map<
    string,
    {
      resolve(adopted: boolean): void;
      reject(error: Error): void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  private readonly uploadWaiters = new Map<
    string,
    {
      resolve(hash: string): void;
      reject(error: Error): void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  private downloads = new Map<string, PendingDownload>();
  private requestedHashes = new Set<string>();
  private lockRequests = new Map<
    string,
    { resolve: (granted: boolean) => void; timer: ReturnType<typeof setTimeout> }
  >();
  private readonly reconnectBackoff = new Backoff();
  /** Serializes lease acquisition and retry order for queued batches. */
  private deliveryQueue: Promise<void> = Promise.resolve();
  private readonly heartbeat = new Heartbeat({
    intervalMs: HEARTBEAT_MS,
    timeoutMs: HEARTBEAT_TIMEOUT_MS,
    onPing: () => this.send({ type: "ping" }),
    onTimeout: () =>
      this.handleSocketFailure(
        new Error("The collaboration connection stopped answering."),
        "heartbeat_timeout",
      ),
  });
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private connectTimer: ReturnType<typeof setTimeout> | null = null;
  private handshakeTimer: ReturnType<typeof setTimeout> | null = null;
  private lastReportedError = "";
  private manualClose = false;
  private reconnectWanted = false;
  private disposed = false;

  /** Create an idle client; `state` is shared when the shell already owns a cell. */
  constructor(options: CollaborationClientOptions = {}) {
    this.options = options;
    this.appVersion = options.appVersion?.trim() ?? "";
    this.state = options.state ?? createCollaborationState();
    this.socketFactory =
      options.socketFactory ??
      (() => {
        throw new Error("No collaboration socket factory was provided");
      });
  }

  /**
   * Open a connection; the payload is sent once the socket is ready.
   *
   * `serverUrl` is the public endpoint carried by invitations. A host connects
   * over loopback while exposing that public endpoint through the tunnel, so
   * `socketUrl` may differ from the address guests use.
   */
  connect(serverUrl: string, options: { readonly socketUrl?: string } = {}): void {
    this.serverUrl = normalizeUrl(serverUrl);
    this.socketUrl = normalizeUrl(options.socketUrl ?? serverUrl);
    this.manualClose = false;
    this.reconnectWanted = true;
    this.socketOpen = false;
    this.lastReportedError = "";
    this.clearConnectTimer();
    this.clearHandshakeTimer();
    this.heartbeat.stop();
    this.setState({ status: "connecting", error: "", serverUrl: this.serverUrl });
    this.openSocket();
  }

  /**
   * Reattach to a persisted host session before a document is opened.
   *
   * The resume token belongs to the member record on the room server, so the
   * host keeps its role and the authoritative chart after an application
   * restart. A missing or expired room is reported as a terminal rejection and
   * the stored session is cleared by the caller.
   */
  resumeRoom(
    serverUrl: string,
    roomId: string,
    token: string,
    options: { readonly socketUrl?: string } = {},
  ): void {
    this.clearRoom();
    this.resumeTarget = { roomId, token };
    this.resumeToken = token;
    this.connect(serverUrl, options);
    this.setState({ roomId });
  }

  /** Send an action now when the socket is open, otherwise on the next open. */
  private sendWhenOpen(action: () => void): void {
    if (!this.socketUrl) {
      this.setState({ status: "error", error: "No collaboration server configured" });
      return;
    }
    if (this.socket && this.socketOpen) {
      action();
      return;
    }
    this.pendingOpenAction = action;
    if (!this.socket) {
      this.openSocket();
    }
  }

  /** Host a room with the current chart as the initial authoritative snapshot. */
  createRoom(
    profile: CollaborationProfile,
    chart: unknown,
    fingerprint: string,
    options: {
      readonly encrypted?: boolean;
      readonly roomKey?: string;
      readonly autoApproveEditor?: boolean;
      /** Set when the caller already gzip-encoded the chart for the wire. */
      readonly chartEncoding?: ChartWireEncoding;
      /** User-visible room password; empty lets the server generate one. */
      readonly password?: string;
    } = {},
  ): void {
    this.clearRoom();
    this.profile = profile;
    this.encrypted = options.encrypted === true;
    this.autoApproveEditor = options.autoApproveEditor === true;
    this.roomInvite = options.password?.trim() ?? "";
    if (this.roomInvite && ([...this.roomInvite].length < 8 || [...this.roomInvite].length > 64)) {
      this.setState({
        status: "error",
        error: "Room password must be 8 to 64 characters",
      });
      return;
    }
    this.hostChart = null;
    this.resumeToken = "";
    this.invitedRoom = null;
    const encrypted = this.encrypted;
    const suppliedKey = options.roomKey?.trim() ? normalizeRoomKey(options.roomKey) : null;
    if (options.roomKey?.trim() && !suppliedKey) {
      this.setState({ status: "error", error: "Room key is not valid" });
      return;
    }
    this.roomKey = encrypted ? (suppliedKey ?? createRoomKey()) : "";
    this.setState({
      status: "connecting",
      error: "",
      // clearRoom resets presentation fields; the endpoint still belongs to
      // the connection that is about to create the room.
      serverUrl: this.serverUrl,
      encrypted,
      roomKey: this.roomKey,
    });
    if (!encrypted) {
      this.hostChart = { chart, fingerprint, chartEncoding: options.chartEncoding };
      this.sendWhenOpen(() => {
        this.send({
          type: "create",
          profile,
          chart,
          fingerprint,
          ...(options.chartEncoding ? { chartEncoding: options.chartEncoding } : {}),
          ...this.appVersionFields(),
          ...this.transportFields(),
          autoApproveEditor: this.autoApproveEditor,
          ...(this.roomInvite ? { invite: this.roomInvite } : {}),
        });
      });
      return;
    }
    void this.prepareEncryptedCreate(profile, chart, this.roomKey).catch((error) => {
      this.handleSocketFailure(error);
    });
  }

  /** Encrypt and send the initial chart for an encrypted room. */
  private async prepareEncryptedCreate(
    profile: CollaborationProfile,
    chart: unknown,
    roomKey: string,
  ): Promise<void> {
    const key = await importRoomKey(roomKey);
    const payload = await encryptJson(key, chart);
    if (this.state.get().roomKey !== roomKey || !this.encrypted) {
      return;
    }
    this.encryptionKey = key;
    this.hostChart = { chart: payload, fingerprint: "" };
    this.sendWhenOpen(() => {
      this.send({
        type: "create",
        profile,
        chart: payload,
        fingerprint: "",
        encrypted: true,
        ...this.appVersionFields(),
        ...this.transportFields(),
        autoApproveEditor: this.autoApproveEditor,
        ...(this.roomInvite ? { invite: this.roomInvite } : {}),
      });
    });
  }

  /** Ask to join an existing room; the host still has to approve the request. */
  join(roomId: string, invite: string, profile: CollaborationProfile, roomKey = ""): void {
    this.clearRoom();
    this.profile = profile;
    this.invitedRoom = null;
    this.hostChart = null;
    this.resumeToken = "";
    const normalized = roomKey.trim() ? normalizeRoomKey(roomKey) : null;
    if (roomKey.trim() && !normalized) {
      this.setState({ status: "error", error: "Room key is not valid" });
      return;
    }
    this.roomKey = normalized ?? "";
    this.setState({
      status: "connecting",
      roomId,
      invite,
      error: "",
      serverUrl: this.serverUrl,
      roomKey: this.roomKey,
    });
    const sendJoin = () => {
      this.invitedRoom = { roomId, invite };
      this.send({
        type: "join",
        roomId,
        invite,
        profile,
        ...this.appVersionFields(),
        ...this.transportFields(),
      });
    };
    if (!normalized) {
      this.sendWhenOpen(sendJoin);
      return;
    }
    void importRoomKey(normalized)
      .then((key) => {
        if (this.state.get().roomKey !== normalized) {
          return;
        }
        this.encryptionKey = key;
        this.sendWhenOpen(sendJoin);
      })
      .catch((error) => this.handleSocketFailure(error));
  }

  /** Approve or decline one pending join. */
  approve(requestId: string, allow: boolean, role: CollaborationRole = "editor"): void {
    this.send({ type: "approve", requestId, allow, role });
  }

  /** Ask the host to change one member's role. */
  setRole(memberId: string, role: Exclude<CollaborationRole, "host">): void {
    this.send({ type: "set-role", memberId, role });
  }

  /** Ask the host to change the online-member limit when this client is the host. */
  setMaxMembers(maxMembers: number): void {
    if (this.state.get().role !== "host") {
      return;
    }
    this.send({ type: "max-members", maxMembers });
  }

  /** Ask the host to replace the room password and invitation token. */
  setPassword(invite: string): void {
    if (this.state.get().role !== "host") {
      return;
    }
    this.send({ type: "set-password", invite: invite.trim() });
  }

  /** Ask the host to remove one member. */
  removeMember(memberId: string): void {
    this.send({ type: "remove-member", memberId });
  }

  /** Ask the server for a fresh authoritative snapshot. */
  requestSnapshot(): void {
    this.send({ type: "snapshot-request" });
  }

  /** Leave the room, stop reconnecting, and reset presentation state. */
  leave(): void {
    // A host owns the room lifetime and may only close it, never leave it.
    if (this.state.get().role === "host") {
      return;
    }
    this.send({ type: "leave" });
    this.shutdownRoom();
  }

  /**
   * Abort an in-flight create, join, or asset transfer and release its memory.
   *
   * The best-effort wire instruction releases the member slot or closes a room
   * this client already owns. Timers, socket, outbox, uploads, downloads, and
   * their buffers are cleared before the observable state returns to idle, so a
   * cancelled join cannot keep writing into the editor document.
   */
  abort(): void {
    if (this.socket && this.socketOpen) {
      const state = this.state.get();
      const type = state.role === "host" && state.roomId ? "close-room" : "leave";
      try {
        this.socket.send(JSON.stringify({ type }));
      } catch {
        // The socket may already be closing; local cleanup still proceeds.
      }
    }
    this.manualClose = true;
    this.reconnectWanted = false;
    this.socketOpen = false;
    this.clearReconnect();
    this.clearConnectTimer();
    this.clearHandshakeTimer();
    this.heartbeat.stop();
    this.pendingOpenAction = null;
    const socket = this.socket;
    this.socket = null;
    socket?.close(1000, "abort");
    this.resetTransportState();
    this.clearRoom();
    this.setState({ status: "idle", error: "" });
  }

  /** Host-only close: delete the room for every member and stop reconnecting. */
  closeRoom(): void {
    if (this.state.get().role !== "host") {
      return;
    }
    this.send({ type: "close-room" });
    this.shutdownRoom();
  }

  /** Stop transport work and drop room-scoped presentation state. */
  private shutdownRoom(): void {
    this.manualClose = true;
    this.reconnectWanted = false;
    this.clearReconnect();
    this.clearConnectTimer();
    this.clearHandshakeTimer();
    this.heartbeat.stop();
    this.clearRoom();
    this.socket?.close(1000, "leave");
    this.socket = null;
    this.setState({ status: "idle", error: "" });
  }

  /** Send one committed local change batch; offline batches are retried. */
  sendTransaction(input: TransactionInput, options: { readonly locksHeld?: boolean } = {}): string {
    const transactionId = input.transactionId ?? randomId();
    if (this.outbox.has(transactionId)) {
      return transactionId;
    }
    const serialized = JSON.stringify(input.changes);
    const large = new TextEncoder().encode(serialized).byteLength > CHANGES_GZIP_THRESHOLD_BYTES;
    const pending: PendingTransaction = {
      ...input,
      transactionId,
      preparing: this.encrypted || large,
      locksHeld: options.locksHeld === true,
      locksPending: false,
      ...(this.encrypted || large ? {} : { wireChanges: input.changes }),
    };
    const queued = this.outbox.put(transactionId, pending, {
      priority: input.undoOf ? "critical" : "high",
      bytes: transactionBytes(input),
    });
    if (!queued.ok) {
      this.options.onTransactionRejected?.(
        { ...input, transactionId },
        "The outgoing change queue is full. Save your work and reconnect before retrying.",
        "queue_full",
      );
      this.options.onError?.(
        "The outgoing change queue is full. Save your work and reconnect before retrying.",
        "queue_full",
      );
      return transactionId;
    }
    this.setState({ queued: this.outbox.size });
    if (this.encrypted) {
      void this.prepareEncryptedTransaction(pending, serialized);
    } else if (large) {
      void this.preparePlainTransaction(pending, serialized);
    } else {
      this.flushTransaction(pending);
    }
    return transactionId;
  }

  /** Drop one batch that could not be prepared and report why. */
  private rejectPreparedTransaction(
    pending: PendingTransaction,
    message: string,
    code: string,
  ): void {
    this.outbox.delete(pending.transactionId);
    this.releaseLocks(pending.lockIds ?? []);
    this.setState({ queued: this.outbox.size });
    this.options.onTransactionRejected?.(pending, message, code);
    this.options.onError?.(message);
  }

  /** Gzip one large plaintext batch, then flush it if it is still current. */
  private async preparePlainTransaction(
    pending: PendingTransaction,
    serialized: string,
  ): Promise<void> {
    try {
      pending.wireChanges = await encodeGzipJson(serialized);
      pending.wireEncoding = "gzip";
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.rejectPreparedTransaction(pending, message, "compression_failed");
      return;
    }
    pending.preparing = false;
    if (this.outbox.value(pending.transactionId) === pending) {
      this.flushTransaction(pending);
    }
  }

  /** Encrypt one queued batch, compressing large plaintext before encryption. */
  private async prepareEncryptedTransaction(
    pending: PendingTransaction,
    serialized: string,
  ): Promise<void> {
    if (!this.encryptionKey) {
      this.rejectPreparedTransaction(pending, "Room key is unavailable", "room_key_required");
      return;
    }
    try {
      const key = this.encryptionKey;
      const bytes = new TextEncoder().encode(serialized);
      if (bytes.byteLength > CHANGES_GZIP_THRESHOLD_BYTES) {
        pending.wireChanges = await encryptEnvelopeBytes(key, await gzipBytes(bytes));
        pending.wireEncoding = "gzip";
      } else {
        pending.wireChanges = await encryptJson(key, pending.changes);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.rejectPreparedTransaction(pending, message, "encryption_failed");
      return;
    }
    pending.preparing = false;
    if (this.outbox.value(pending.transactionId) === pending) {
      this.flushTransaction(pending);
    }
  }

  /** Publish this member's cursor and workspace location while connected. */
  sendPresence(presence: MemberPresence): void {
    if (this.state.get().status !== "connected") {
      return;
    }
    this.send({ type: "presence", presence });
  }

  /** Upload one immutable blob; encrypted rooms store only ciphertext. */
  async uploadAsset(name: string, bytes: Uint8Array): Promise<string | null> {
    if (this.state.get().status !== "connected") {
      return null;
    }
    if (bytes.byteLength > MAX_ASSET_BYTES) {
      this.options.onAssetError?.(`${name} exceeds the room asset size limit`);
      return null;
    }
    const plaintextHash = await sha256Hex(bytes);
    let payload = bytes;
    if (this.encrypted) {
      if (!this.encryptionKey) {
        this.options.onAssetError?.("Room key is unavailable");
        return null;
      }
      payload = await encryptBytes(this.encryptionKey, bytes);
      if (payload.byteLength > MAX_ASSET_BYTES) {
        this.options.onAssetError?.(`${name} is too large after encryption`);
        return null;
      }
    }
    const hash = await sha256Hex(payload);
    if (
      this.state
        .get()
        .assets.some(
          (asset) =>
            asset.name === name &&
            (asset.plaintextHash ?? asset.hash) === plaintextHash &&
            (this.encrypted ? true : asset.hash === hash),
        )
    ) {
      return hash;
    }
    const requestId = randomToken();
    const mime = mimeForAsset(name);
    this.uploads.set(requestId, {
      requestId,
      name,
      hash,
      size: payload.byteLength,
      mime,
      plaintextHash,
    });
    this.send({
      type: "asset-begin",
      requestId,
      name,
      hash,
      size: payload.byteLength,
      mime,
      plaintextHash,
      ...(this.assetAdopt ? { adopt: true } : {}),
    });
    this.reportAssetProgress(name, "upload", "begin", 0, payload.byteLength);
    if (this.assetAdopt && (await this.waitForAssetBegin(requestId))) {
      if (this.uploads.delete(requestId)) {
        this.reportAssetProgress(name, "upload", "done", payload.byteLength, payload.byteLength);
      }
      return hash;
    }
    if (!this.uploads.has(requestId)) {
      return null;
    }
    let sentBytes = 0;
    for (const range of assetChunkRanges(payload.byteLength)) {
      const chunk = payload.subarray(range.offset, range.offset + range.length);
      if (this.binaryChunks) {
        this.sendBinary({ type: "asset-chunk", requestId, index: range.index }, chunk);
      } else {
        this.send({
          type: "asset-chunk",
          requestId,
          index: range.index,
          data: bytesToBase64(chunk),
        });
      }
      sentBytes += range.length;
      this.reportAssetProgress(name, "upload", "progress", sentBytes, payload.byteLength);
      await yieldToHost();
    }
    this.send({ type: "asset-commit", requestId });
    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.uploadWaiters.delete(requestId);
        this.uploads.delete(requestId);
        reject(new Error(`${name} upload timed out`));
      }, ASSET_ACK_TIMEOUT_MS);
      this.uploadWaiters.set(requestId, { resolve, reject, timer });
    });
  }

  /** Wait for the server's adoption decision before streaming more chunks. */
  private waitForAssetBegin(requestId: string): Promise<boolean> {
    return new Promise<boolean>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.beginWaiters.delete(requestId);
        resolve(false);
      }, 10_000);
      this.beginWaiters.set(requestId, { resolve, reject, timer });
    });
  }

  /** Reject one pending asset acknowledgement. */
  private rejectUpload(requestId: string, message: string): void {
    const waiter = this.uploadWaiters.get(requestId);
    if (!waiter) {
      return;
    }
    clearTimeout(waiter.timer);
    this.uploadWaiters.delete(requestId);
    waiter.reject(new Error(message));
  }

  /** Publish one transfer milestone without making the progress UI poll. */
  private reportAssetProgress(
    name: string,
    direction: "upload" | "download",
    state: "begin" | "progress" | "done",
    received: number,
    total: number,
  ): void {
    this.options.onAssetProgress?.({ name, direction, state, received, total });
  }

  /** Acquire an all-or-nothing lease set before a transaction. */
  acquireLocks(ids: readonly string[]): Promise<boolean> {
    if (ids.length === 0) {
      return Promise.resolve(true);
    }
    if (this.state.get().status !== "connected") {
      return Promise.resolve(false);
    }
    const requestId = randomToken();
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.lockRequests.delete(requestId);
        this.options.onLockTimeout?.();
        resolve(false);
      }, 5_000);
      this.lockRequests.set(requestId, { resolve, timer });
      this.send({ type: "lock-request", requestId, ids, ttlMs: 15_000 });
    });
  }

  /** Release leases this client acquired; other members' leases are untouched. */
  releaseLocks(ids: readonly string[]): void {
    if (ids.length === 0 || this.state.get().status !== "connected") {
      return;
    }
    this.send({ type: "lock-release", ids });
  }

  /** Request a blob once; repeated requests for the same hash are folded. */
  requestAsset(hash: string, name?: string): void {
    const key = `${name ?? ""}\n${hash}`;
    if (this.state.get().status !== "connected" || this.requestedHashes.has(key)) {
      return;
    }
    this.requestedHashes.add(key);
    this.send({ type: "asset-request", requestId: randomToken(), hash, name });
  }

  /** Close the socket and disable every reconnect path. */
  dispose(): void {
    this.disposed = true;
    this.manualClose = true;
    this.reconnectWanted = false;
    this.socketOpen = false;
    this.clearReconnect();
    this.clearConnectTimer();
    this.clearHandshakeTimer();
    this.heartbeat.stop();
    this.resetTransportState();
    this.socket?.close(1000, "dispose");
    this.socket = null;
  }

  /** Reconnect attempts since the last accepted welcome, for diagnostics and tests. */
  get reconnectAttempts(): number {
    return this.reconnectBackoff.attempts;
  }

  /** Current membership token, used to persist host or guest resume state. */
  get resumeTokenValue(): string {
    return this.resumeToken;
  }

  private pendingOpenAction: (() => void) | null = null;

  /** Create a socket, arm the connect timeout, and route its events. */
  private openSocket(): void {
    if (this.disposed || !this.socketUrl) {
      return;
    }
    this.clearReconnect();
    this.manualClose = false;
    this.socketOpen = false;
    this.socket?.close(1000, "reconnect");
    let socket: CollaborationSocket;
    try {
      socket = this.socketFactory(this.socketUrl);
    } catch (error) {
      this.handleSocketFailure(error);
      return;
    }
    this.socket = socket;
    if ("binaryType" in socket) {
      socket.binaryType = "arraybuffer";
    }
    this.setState({
      status: this.state.get().status === "reconnecting" ? "reconnecting" : "connecting",
      error: "",
    });
    this.armConnectTimer(socket);
    const isCurrent = () => this.socket === socket;
    socket.addEventListener("open", () => {
      if (isCurrent()) {
        this.handleOpen();
      }
    });
    socket.addEventListener("message", (event) => {
      if (isCurrent()) {
        this.enqueueData((event as MessageEvent).data);
      }
    });
    socket.addEventListener("close", () => {
      if (isCurrent()) {
        this.handleClose();
      }
    });
    socket.addEventListener("error", () => {
      if (isCurrent()) {
        this.handleSocketFailure(new Error("Collaboration socket error"));
      }
    });
  }

  /** Replay the queued intent, resume, join, or create once the socket opens. */
  private handleOpen(): void {
    this.clearConnectTimer();
    this.socketOpen = true;
    const action = this.pendingOpenAction;
    this.pendingOpenAction = null;
    if (action) {
      action();
      this.armHandshakeTimer();
      return;
    }
    const resume = this.resumeTarget;
    if (resume) {
      this.send({
        type: "resume",
        roomId: resume.roomId,
        token: resume.token,
        ...this.appVersionFields(),
        ...this.transportFields(),
        ...this.resumeChartFields(),
      });
      this.armHandshakeTimer();
      return;
    }
    if (this.resumeToken && this.state.get().roomId) {
      this.send({
        type: "resume",
        roomId: this.state.get().roomId,
        token: this.resumeToken,
        ...this.appVersionFields(),
        ...this.transportFields(),
        ...this.resumeChartFields(),
      });
      this.armHandshakeTimer();
      return;
    }
    if (this.invitedRoom) {
      this.send({
        type: "join",
        roomId: this.invitedRoom.roomId,
        invite: this.invitedRoom.invite,
        profile: this.profile,
        ...this.appVersionFields(),
        ...this.transportFields(),
      });
      this.armHandshakeTimer();
      return;
    }
    if (this.hostChart) {
      this.send({
        type: "create",
        profile: this.profile,
        chart: this.hostChart.chart,
        fingerprint: this.hostChart.fingerprint,
        ...(this.hostChart.chartEncoding ? { chartEncoding: this.hostChart.chartEncoding } : {}),
        ...this.appVersionFields(),
        ...this.transportFields(),
        ...(this.encrypted ? { encrypted: true } : {}),
        autoApproveEditor: this.autoApproveEditor,
        ...(this.roomInvite ? { invite: this.roomInvite } : {}),
      });
      this.armHandshakeTimer();
    }
  }

  /** Reset transport state and schedule a reconnect or report a terminal close. */
  private handleClose(): void {
    this.socket = null;
    this.socketOpen = false;
    this.clearConnectTimer();
    this.clearHandshakeTimer();
    this.heartbeat.stop();
    this.resetTransportState();
    if (this.disposed || this.manualClose) {
      return;
    }
    const hasRoom = Boolean(this.state.get().roomId);
    if (hasRoom && this.reconnectWanted && this.options.reconnect !== false) {
      this.setState({ status: "reconnecting", error: "" });
      this.scheduleReconnect();
      return;
    }
    // A create/join can lose its socket before the first welcome. Retry the
    // retained create/join intent a few times instead of failing the whole
    // operation on one transient close.
    if (
      !hasRoom &&
      this.reconnectWanted &&
      this.options.reconnect !== false &&
      this.reconnectBackoff.attempts < 3
    ) {
      this.setState({ status: "connecting", error: "" });
      this.scheduleReconnect();
      return;
    }
    this.failInitial(
      "The collaboration connection closed before the room was ready.",
      "connection_closed",
    );
  }

  /** Handle a transport error, reconnecting an established room or failing an initial join. */
  private handleSocketFailure(error: unknown, code = "socket_error"): void {
    this.socketOpen = false;
    this.clearConnectTimer();
    this.clearHandshakeTimer();
    this.heartbeat.stop();
    if (this.disposed || this.manualClose) {
      return;
    }
    const message = error instanceof Error ? error.message : String(error);
    const hasRoom = Boolean(this.state.get().roomId);
    const socket = this.socket;
    this.socket = null;
    socket?.close(1000, "failure");
    this.resetTransportState();
    if (hasRoom && this.reconnectWanted && this.options.reconnect !== false) {
      // The status transition supplies the single "connection lost" notice;
      // repeating the raw transport error here would stack two toasts.
      this.setState({ status: "reconnecting", error: "" });
      this.scheduleReconnect();
      return;
    }
    this.reportError(message, code);
    this.failInitial(message, code);
  }

  /** Settle a failed create/join so it cannot reconnect forever. */
  private failInitial(message: string, code: string): void {
    if (this.disposed) {
      return;
    }
    this.manualClose = true;
    this.reconnectWanted = false;
    this.clearConnectTimer();
    this.clearHandshakeTimer();
    this.heartbeat.stop();
    this.pendingOpenAction = null;
    const socket = this.socket;
    this.socket = null;
    this.socketOpen = false;
    socket?.close(1000, "failed");
    this.clearRoom();
    this.setState({ status: "error", error: message });
    this.reportError(message, code);
  }

  /** Collapse repeated transport failures into one toast per outage. */
  private reportError(message: string, code?: string): void {
    const key = `${code ?? ""}\n${message}`;
    if (key === this.lastReportedError) {
      return;
    }
    this.lastReportedError = key;
    this.options.onError?.(message, code);
  }

  /** Drop pending uploads, downloads, and lock waiters for the closed transport. */
  private resetTransportState(): void {
    this.binaryChunks = false;
    this.assetAdopt = false;
    this.chartTransfer = null;
    for (const [requestId, waiter] of this.beginWaiters) {
      clearTimeout(waiter.timer);
      waiter.reject(
        new Error("The collaboration connection closed before the asset transfer began."),
      );
      this.beginWaiters.delete(requestId);
    }
    for (const [requestId, waiter] of this.uploadWaiters) {
      clearTimeout(waiter.timer);
      waiter.reject(
        new Error("The collaboration connection closed before the asset was accepted."),
      );
      this.uploadWaiters.delete(requestId);
    }
    this.uploads.clear();
    this.downloads.clear();
    this.requestedHashes.clear();
    for (const pending of this.outbox.values()) {
      // Leases belong to a connection generation. A queued batch must ask for
      // them again after resume, including encrypted batches queued offline.
      pending.value.locksHeld = false;
    }
    for (const request of this.lockRequests.values()) {
      clearTimeout(request.timer);
      request.resolve(false);
    }
    this.lockRequests.clear();
  }

  /** Queue an open attempt with exponential backoff capped at 15 seconds. */
  private scheduleReconnect(): void {
    if (this.reconnectTimer || this.disposed) {
      return;
    }
    const delay = this.reconnectBackoff.next();
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.openSocket();
    }, delay);
  }

  /** Cancel a queued reconnect attempt. */
  private clearReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  /** Fail the connection when this socket has not opened in time. */
  private armConnectTimer(socket: CollaborationSocket): void {
    this.clearConnectTimer();
    this.connectTimer = setTimeout(() => {
      if (this.socket !== socket || this.socketOpen) {
        return;
      }
      this.handleSocketFailure(
        new Error("The collaboration server did not respond in time."),
        "connect_timeout",
      );
    }, CONNECT_TIMEOUT_MS);
  }

  /** Cancel the connect timeout. */
  private clearConnectTimer(): void {
    if (this.connectTimer) {
      clearTimeout(this.connectTimer);
      this.connectTimer = null;
    }
  }

  /** Fail the connection when create/join/resume gets no answer in time. */
  private armHandshakeTimer(): void {
    this.clearHandshakeTimer();
    if (this.manualClose || !this.socketOpen) {
      return;
    }
    this.handshakeTimer = setTimeout(() => {
      this.handleSocketFailure(
        new Error("The collaboration server accepted the connection but did not answer in time."),
        "handshake_timeout",
      );
    }, HANDSHAKE_TIMEOUT_MS);
  }

  /** Cancel the handshake timeout. */
  private clearHandshakeTimer(): void {
    if (this.handshakeTimer) {
      clearTimeout(this.handshakeTimer);
      this.handshakeTimer = null;
    }
  }

  /** Queue one server message behind any payload decode already in flight. */
  private enqueueData(raw: unknown): void {
    if (this.decoding && (typeof raw === "string" || !this.chartTransfer)) {
      this.queuedData.push(raw);
      return;
    }
    this.processData(raw);
  }

  /** Dispatch queued messages until another async decode takes over. */
  private drainQueuedData(): void {
    while (!this.decoding) {
      const next = this.queuedData.shift();
      if (next === undefined) {
        return;
      }
      this.processData(next);
    }
  }

  /** Parse one message and start an async decode only for a gzip payload. */
  private processData(raw: unknown): void {
    if (this.disposed) {
      return;
    }
    if (typeof raw !== "string") {
      this.processBinary(raw);
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }
    if (!isMessage(parsed)) {
      return;
    }
    this.heartbeat.touch();
    if ((parsed.type === "welcome" || parsed.type === "snapshot") && parsed.chartChunks === true) {
      this.startChartTransfer(parsed);
      return;
    }
    if (
      (parsed.type === "welcome" || parsed.type === "snapshot") &&
      parsed.chartEncoding === "gzip"
    ) {
      this.decodeChartMessage(parsed);
      return;
    }
    if (
      parsed.type === "committed" &&
      parsed.changesEncoding === "gzip" &&
      !this.encrypted &&
      typeof parsed.changes === "string"
    ) {
      this.decodeCommittedMessage(parsed);
      return;
    }
    this.dispatchMessage(parsed);
  }

  /** Decode one binary asset chunk delivered by a capable server. */
  private processBinary(raw: unknown): void {
    let frame: ArrayBuffer;
    if (raw instanceof ArrayBuffer) {
      frame = raw;
    } else if (ArrayBuffer.isView(raw)) {
      frame = new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength).slice().buffer;
    } else {
      return;
    }
    let decoded: ReturnType<typeof decodeBinaryAssetFrame>;
    try {
      decoded = decodeBinaryAssetFrame(frame);
    } catch {
      this.options.onAssetError?.("The room sent an invalid asset chunk");
      return;
    }
    this.heartbeat.touch();
    const { header, body } = decoded;
    if (header.type === "chart-chunk") {
      this.acceptChartChunk(header, body);
      return;
    }
    if (header.type !== "asset-download-chunk") {
      return;
    }
    const requestId = typeof header.requestId === "string" ? header.requestId : "";
    const index = typeof header.index === "number" ? header.index : Number.NaN;
    this.acceptDownloadChunk(requestId, index, body);
  }

  /** Start assembling one chunked welcome or snapshot chart. */
  private startChartTransfer(
    message: Extract<ServerMessage, { type: "welcome" | "snapshot" }>,
  ): void {
    const id = typeof message.chartTransfer === "string" ? message.chartTransfer : "";
    const size = message.chartSize;
    const count = message.chartChunkCount;
    if (
      !id ||
      !Number.isSafeInteger(size) ||
      (size ?? 0) <= 0 ||
      !Number.isSafeInteger(count) ||
      (count ?? 0) <= 0
    ) {
      this.failInitial("The room chart transfer is malformed.", "invalid_chart");
      return;
    }
    this.chartTransfer = {
      message,
      id,
      size: size as number,
      count: count as number,
      bytes: new Uint8Array(size as number),
      seen: new Uint8Array(count as number),
      received: 0,
    };
    this.decoding = true;
  }

  /** Accept one binary chart chunk and finish the transfer when complete. */
  private acceptChartChunk(header: Record<string, unknown>, body: Uint8Array): void {
    const transfer = this.chartTransfer;
    if (!transfer) {
      return;
    }
    const id = typeof header.transferId === "string" ? header.transferId : "";
    const index = typeof header.index === "number" ? header.index : Number.NaN;
    const count = typeof header.count === "number" ? header.count : Number.NaN;
    const size = typeof header.size === "number" ? header.size : Number.NaN;
    const offset = typeof header.offset === "number" ? header.offset : Number.NaN;
    if (
      id !== transfer.id ||
      count !== transfer.count ||
      size !== transfer.size ||
      !Number.isInteger(index) ||
      index < 0 ||
      index >= transfer.count ||
      !Number.isInteger(offset) ||
      offset < 0 ||
      offset + body.byteLength > transfer.size
    ) {
      this.chartTransfer = null;
      this.decoding = false;
      this.failInitial("The room chart transfer is malformed.", "invalid_chart");
      return;
    }
    if (transfer.seen[index]) {
      return;
    }
    transfer.seen[index] = 1;
    transfer.bytes.set(body, offset);
    transfer.received += 1;
    if (transfer.received === transfer.count) {
      this.finishChartTransfer();
    }
  }

  /** Decode the assembled gzip chart and dispatch its welcome or snapshot. */
  private finishChartTransfer(): void {
    const transfer = this.chartTransfer;
    if (!transfer) {
      return;
    }
    this.chartTransfer = null;
    void (async () => {
      try {
        const json = new TextDecoder().decode(await gunzipBytes(transfer.bytes));
        const chart = JSON.parse(json) as unknown;
        const message = {
          ...transfer.message,
          chart,
          chartChunks: undefined,
          chartTransfer: undefined,
          chartSize: undefined,
          chartChunkCount: undefined,
        } as ServerMessage;
        this.decoding = false;
        this.dispatchMessage(message, chart);
        this.drainQueuedData();
      } catch {
        this.decoding = false;
        this.failInitial("The room chart could not be decoded.", "invalid_chart");
        this.drainQueuedData();
      }
    })();
  }

  /** Decode one gzipped plaintext commit, dispatch it, then resume queued messages. */
  private decodeCommittedMessage(message: Extract<ServerMessage, { type: "committed" }>): void {
    this.decoding = true;
    void (async () => {
      try {
        const changes = await decodeGzipJson(message.changes as string);
        if (!this.disposed) {
          this.dispatchMessage({ ...message, changes: changes as ChartChange[] });
        }
      } catch {
        if (!this.disposed) {
          this.options.onError?.("The room sent an invalid change batch", "invalid_changes");
        }
      } finally {
        this.decoding = false;
        if (!this.disposed) {
          this.drainQueuedData();
        }
      }
    })();
  }

  /** Decode one gzip chart, dispatch it, then resume queued messages. */
  private decodeChartMessage(
    message: Extract<ServerMessage, { type: "welcome" | "snapshot" }>,
  ): void {
    this.decoding = true;
    void (async () => {
      try {
        const chart = await decodeChartWire(message.chart, message.chartEncoding);
        if (!this.disposed) {
          this.dispatchMessage(message as ServerMessage, chart);
        }
      } catch (error) {
        if (!this.disposed) {
          const text =
            error instanceof Error ? error.message : "The room chart could not be decoded.";
          this.failInitial(text, "invalid_chart");
        }
      } finally {
        this.decoding = false;
        if (!this.disposed) {
          this.drainQueuedData();
        }
      }
    })();
  }

  /** Handle one already parsed server message. */
  private dispatchMessage(message: ServerMessage, decodedChart?: unknown): void {
    if (this.disposed) {
      return;
    }
    if (
      message.type === "welcome" ||
      message.type === "waiting" ||
      message.type === "rejected" ||
      message.type === "room-closed" ||
      message.type === "error"
    ) {
      this.clearHandshakeTimer();
    }
    switch (message.type) {
      case "welcome": {
        const roomVersion = message.appVersion?.trim() ?? "";
        if (roomVersion !== this.appVersion) {
          this.failInitial(
            versionMismatchMessage(roomVersion, this.appVersion),
            versionMismatchCode(roomVersion, this.appVersion),
          );
          return;
        }
        this.resumeToken = message.resumeToken;
        this.resumeTarget = null;
        this.reconnectBackoff.reset();
        this.binaryChunks = message.binaryChunks === true;
        this.assetAdopt = message.assetAdopt === true;
        this.encrypted = message.encrypted === true;
        if (this.encrypted && !this.encryptionKey) {
          this.setState({
            status: "error",
            error: "This room is end-to-end encrypted. Enter its room key to join.",
            encrypted: true,
          });
          this.reportError("Room key is required", "room_key_required");
          return;
        }
        const chart = decodedChart ?? message.chart;
        if (!this.encrypted && (chart !== undefined || this.hostChart)) {
          this.appliedRevision = message.revision;
          this.appliedFingerprint = message.fingerprint;
        }
        this.lastReportedError = "";
        this.heartbeat.start();
        this.setState({
          status: "connected",
          error: "",
          roomId: message.roomId,
          invite: message.invite,
          memberId: message.memberId,
          hostId: message.hostId,
          role: message.role,
          revision: message.revision,
          maxMembers: message.maxMembers ?? 4,
          members: message.members,
          presence: message.presence,
          assets: message.assets ?? [],
          locks: message.locks ?? [],
          pending: [],
          queued: this.outbox.size,
          encrypted: this.encrypted,
          roomKey: this.roomKey,
        });
        if (chart !== undefined) {
          if (this.encrypted) {
            const generation = this.roomGeneration;
            this.enqueueEncrypted(() =>
              this.applyEncryptedSnapshot(
                chart,
                message.transactions ?? [],
                message,
                true,
                message.revision,
                message.fingerprint,
                generation,
              ),
            );
          } else {
            this.emitSnapshotFromWelcome(message, chart, true);
          }
        }
        this.retryPending();
        return;
      }
      case "pending": {
        const current = this.state.get().pending;
        if (current.some((request) => request.requestId === message.requestId)) {
          return;
        }
        this.setState({
          pending: [...current, { requestId: message.requestId, profile: message.profile }],
        });
        return;
      }
      case "pending-cleared": {
        this.setState({
          pending: this.state
            .get()
            .pending.filter((request) => request.requestId !== message.requestId),
        });
        return;
      }
      case "waiting": {
        this.heartbeat.start();
        this.setState({ status: "waiting", roomId: message.roomId });
        return;
      }
      case "rejected": {
        const terminal = [
          "removed",
          "declined",
          "bad_resume",
          "no_room",
          "bad_invite",
          "version_mismatch_client_newer",
          "version_mismatch_client_older",
          "version_mismatch_unknown",
        ].includes(message.reason);
        if (terminal) {
          this.manualClose = true;
          this.reconnectWanted = false;
          this.clearConnectTimer();
          this.clearHandshakeTimer();
          this.heartbeat.stop();
          const socket = this.socket;
          this.socket = null;
          this.socketOpen = false;
          socket?.close(1000, "rejected");
          this.clearRoom();
          this.setState({ status: "idle", error: message.message ?? message.reason });
        } else {
          this.setState({
            status: this.state.get().roomId ? "connected" : "idle",
            error: message.message ?? message.reason,
          });
        }
        this.reportError(message.message ?? message.reason, message.reason);
        return;
      }
      case "room-closed": {
        const messageText = message.message ?? "The host closed the room";
        this.manualClose = true;
        this.reconnectWanted = false;
        this.clearConnectTimer();
        this.clearHandshakeTimer();
        this.heartbeat.stop();
        const socket = this.socket;
        this.socket = null;
        this.socketOpen = false;
        socket?.close(1000, "room-closed");
        this.clearRoom();
        this.setState({ status: "idle", error: messageText });
        this.reportError(messageText, "room_closed");
        return;
      }
      case "members": {
        this.setState({ members: message.members });
        return;
      }
      case "member-left": {
        this.options.onMemberLeft?.(message.memberId);
        return;
      }
      case "room-settings": {
        this.setState({
          maxMembers: message.maxMembers,
          ...(message.invite ? { invite: message.invite } : {}),
        });
        return;
      }
      case "permission": {
        this.setState({ role: message.role });
        this.options.onRole?.(message.role, message.reason);
        return;
      }
      case "presence": {
        this.mergePresence(message.presence);
        return;
      }
      case "locks": {
        this.setState({ locks: message.locks });
        return;
      }
      case "lock-result": {
        const request = this.lockRequests.get(message.requestId);
        if (request) {
          clearTimeout(request.timer);
          this.lockRequests.delete(message.requestId);
          if (!message.granted) {
            this.options.onLockDenied?.(message.conflicts ?? []);
          }
          request.resolve(message.granted);
        }
        return;
      }
      case "committed": {
        const mine = message.actorId === this.state.get().memberId;
        const pending = mine ? this.outbox.value(message.transactionId) : undefined;
        if (mine) {
          this.outbox.delete(message.transactionId);
        }
        this.releaseLocks(pending?.lockIds ?? []);
        if (!this.encrypted) {
          this.appliedRevision = message.revision;
          this.appliedFingerprint = message.fingerprint;
        }
        this.setState({ revision: message.revision, error: "", queued: this.outbox.size });
        if (this.encrypted) {
          const generation = this.roomGeneration;
          this.enqueueEncrypted(() => this.deliverEncryptedCommitted(message, generation));
        } else {
          this.options.onCommitted?.(message as CommittedMessage);
        }
        return;
      }
      case "conflict": {
        const pending = this.outbox.value(message.transactionId);
        this.outbox.delete(message.transactionId);
        this.releaseLocks(pending?.lockIds ?? []);
        this.setState({ revision: message.revision, queued: this.outbox.size });
        if (pending) {
          this.options.onTransactionRejected?.(
            pending,
            message.message ?? "The room rejected this transaction as conflicting.",
            "conflict",
          );
        }
        this.options.onConflict?.(message);
        return;
      }
      case "snapshot": {
        const chart = decodedChart ?? message.chart;
        if (!this.encrypted) {
          this.appliedRevision = message.revision;
          this.appliedFingerprint = message.fingerprint;
        }
        this.setState({ revision: message.revision });
        if (this.encrypted) {
          const generation = this.roomGeneration;
          this.enqueueEncrypted(() =>
            this.applyEncryptedSnapshot(
              chart,
              message.transactions ?? [],
              undefined,
              false,
              message.revision,
              message.fingerprint,
              generation,
            ),
          );
        } else {
          this.emitSnapshotFromState(chart, message.revision, message.fingerprint, false);
        }
        return;
      }
      case "asset-begin-result": {
        const waiter = this.beginWaiters.get(message.requestId);
        if (waiter) {
          clearTimeout(waiter.timer);
          this.beginWaiters.delete(message.requestId);
          waiter.resolve(message.adopted);
        }
        return;
      }
      case "asset-manifest": {
        this.setState({ assets: message.assets });
        return;
      }
      case "asset-accepted": {
        const assets = this.state.get().assets.filter((asset) => asset.name !== message.asset.name);
        assets.push(message.asset);
        for (const [requestId, upload] of this.uploads) {
          if (upload.hash === message.asset.hash && upload.name === message.asset.name) {
            this.uploads.delete(requestId);
            this.reportAssetProgress(upload.name, "upload", "done", upload.size, upload.size);
            const waiter = this.uploadWaiters.get(requestId);
            if (waiter) {
              clearTimeout(waiter.timer);
              this.uploadWaiters.delete(requestId);
              waiter.resolve(message.asset.hash);
            }
          }
        }
        this.setState({ assets });
        return;
      }
      case "asset-download-begin": {
        this.downloads.set(message.requestId, {
          requestId: message.requestId,
          asset: message.asset,
          assembler: new AssetAssembler(message.asset.size, message.chunkSize),
        });
        this.reportAssetProgress(message.asset.name, "download", "begin", 0, message.asset.size);
        return;
      }
      case "asset-download-chunk": {
        let chunk: Uint8Array;
        try {
          chunk = base64ToBytes(message.data);
        } catch {
          const download = this.downloads.get(message.requestId);
          if (download) {
            this.downloads.delete(message.requestId);
            this.options.onAssetError?.(
              `Invalid chunk for ${download.asset.name}`,
              download.asset.name,
            );
          }
          return;
        }
        this.acceptDownloadChunk(message.requestId, message.index, chunk);
        return;
      }
      case "asset-download-end": {
        const download = this.downloads.get(message.requestId);
        this.downloads.delete(message.requestId);
        if (!download) {
          return;
        }
        if (!download.assembler.complete) {
          this.requestedHashes.delete(`${download.asset.name}\n${download.asset.hash}`);
          this.options.onAssetError?.(
            `${download.asset.name} transfer was incomplete`,
            download.asset.name,
          );
          return;
        }
        const bytes = download.assembler.result();
        void (async () => {
          const hash = await sha256Hex(bytes);
          if (hash !== download.asset.hash) {
            this.requestedHashes.delete(`${download.asset.name}\n${download.asset.hash}`);
            this.options.onAssetError?.(
              `${download.asset.name} failed its integrity check`,
              download.asset.name,
            );
            return;
          }
          let verified = bytes;
          if (this.encrypted) {
            if (!this.encryptionKey) {
              this.options.onAssetError?.("Room key is unavailable", download.asset.name);
              return;
            }
            try {
              verified = await decryptBytes(this.encryptionKey, bytes);
            } catch {
              this.options.onAssetError?.(
                `${download.asset.name} could not be decrypted`,
                download.asset.name,
              );
              return;
            }
            if (!matchesAssetMagic(download.asset.mime, verified)) {
              this.options.onAssetError?.(
                `${download.asset.name} has an invalid file type`,
                download.asset.name,
              );
              return;
            }
          }
          this.reportAssetProgress(
            download.asset.name,
            "download",
            "done",
            download.asset.size,
            download.asset.size,
          );
          this.options.onAssetReady?.(download.asset, verified);
        })();
        return;
      }
      case "asset-rejected": {
        if (message.requestId) {
          const begin = this.beginWaiters.get(message.requestId);
          if (begin) {
            clearTimeout(begin.timer);
            this.beginWaiters.delete(message.requestId);
            begin.reject(new Error(message.message));
          }
          this.uploads.delete(message.requestId);
          this.downloads.delete(message.requestId);
          this.rejectUpload(message.requestId, message.message);
        } else if (message.hash) {
          for (const [requestId, upload] of this.uploads) {
            if (upload.hash === message.hash && (!message.name || upload.name === message.name)) {
              this.uploads.delete(requestId);
              this.rejectUpload(requestId, message.message);
            }
          }
        }
        if (message.hash) {
          for (const key of this.requestedHashes) {
            if (key.endsWith(`\n${message.hash}`)) {
              this.requestedHashes.delete(key);
            }
          }
        }
        this.options.onAssetError?.(message.message, message.name);
        return;
      }
      case "error": {
        if (message.transactionId) {
          const pending = this.outbox.value(message.transactionId);
          this.outbox.delete(message.transactionId);
          this.releaseLocks(pending?.lockIds ?? []);
          if (pending) {
            this.options.onTransactionRejected?.(pending, message.message, message.code ?? "error");
          }
        }
        if (!this.state.get().roomId) {
          this.failInitial(message.message, message.code);
          return;
        }
        this.setState({ error: message.message, queued: this.outbox.size });
        this.reportError(message.message, message.code);
        return;
      }
      case "pong":
        this.heartbeat.touch();
        return;
      default:
        return;
    }
  }

  /** Accept one decoded download chunk from the text or binary transport. */
  private acceptDownloadChunk(requestId: string, index: number, chunk: Uint8Array): void {
    const download = this.downloads.get(requestId);
    if (!download) {
      return;
    }
    const accepted = download.assembler.write(index, chunk);
    if (!accepted.ok) {
      this.downloads.delete(requestId);
      this.options.onAssetError?.(`Invalid chunk for ${download.asset.name}`, download.asset.name);
      return;
    }
    this.reportAssetProgress(
      download.asset.name,
      "download",
      "progress",
      download.assembler.receivedBytes,
      download.asset.size,
    );
  }

  /** Build a snapshot callback from the current collaboration state. */
  private emitSnapshotFromState(
    chart: unknown,
    revision: number,
    fingerprint: string,
    initial: boolean,
  ): void {
    const state = this.state.get();
    this.options.onSnapshot?.(
      {
        roomId: state.roomId,
        invite: state.invite,
        hostId: state.hostId,
        memberId: state.memberId,
        role: state.role,
        revision,
        chart,
        fingerprint,
        members: state.members,
        presence: state.presence,
        resumeToken: this.resumeToken,
      },
      initial,
    );
  }

  /** Build a snapshot callback from a welcome message and its chart. */
  private emitSnapshotFromWelcome(
    message: Extract<ServerMessage, { type: "welcome" }>,
    chart: unknown,
    initial: boolean,
  ): void {
    this.options.onSnapshot?.(
      {
        roomId: message.roomId,
        invite: message.invite,
        hostId: message.hostId,
        memberId: message.memberId,
        role: message.role,
        revision: message.revision,
        chart,
        fingerprint: message.fingerprint,
        members: message.members,
        presence: message.presence,
        resumeToken: message.resumeToken,
      },
      initial,
    );
  }

  /** Decrypt a snapshot and replay its ordered transactions with forced application. */
  private async decryptEncryptedState(
    rawChart: unknown,
    transactions: readonly EncryptedTransaction[],
  ): Promise<unknown> {
    if (!this.encryptionKey) {
      throw new Error("Room key is unavailable");
    }
    if (!isEncryptedPayload(rawChart)) {
      throw new Error("Encrypted room snapshot is malformed");
    }
    let chart = await decryptJson(this.encryptionKey, rawChart);
    const ordered = [...transactions].sort((left, right) => left.revision - right.revision);
    for (const transaction of ordered) {
      const changes = await this.decodeEncryptedChanges(
        transaction.changes,
        transaction.changesEncoding,
      );
      chart = applyChartChanges(chart, changes, { force: true }).chart;
    }
    return chart;
  }

  /** Decrypt one committed change envelope, expanding it when gzip-tagged. */
  private async decodeEncryptedChanges(
    payload: EncryptedPayload,
    encoding?: string,
  ): Promise<readonly ChartChange[]> {
    if (!this.encryptionKey) {
      throw new Error("Room key is unavailable");
    }
    const bytes = await decryptEnvelopeBytes(this.encryptionKey, payload);
    const plaintext = encoding === "gzip" ? await gunzipBytes(bytes) : bytes;
    const changes: unknown = JSON.parse(new TextDecoder().decode(plaintext));
    if (!Array.isArray(changes)) {
      throw new Error("Encrypted transaction does not contain changes");
    }
    return changes as ChartChange[];
  }

  /** Serialize decryption work so encrypted messages deliver in order. */
  private enqueueEncrypted(task: () => Promise<void>): void {
    this.encryptedCommitQueue = this.encryptedCommitQueue
      .then(task)
      .catch((error) => this.handleDecryptFailure(error));
  }

  /** Decrypt and emit a snapshot unless the room changed while decrypting. */
  private async applyEncryptedSnapshot(
    rawChart: unknown,
    transactions: readonly EncryptedTransaction[],
    welcome: Extract<ServerMessage, { type: "welcome" }> | undefined,
    initial: boolean,
    revision: number,
    fingerprint: string,
    generation: number,
  ): Promise<void> {
    try {
      const chart = await this.decryptEncryptedState(rawChart, transactions);
      if (generation !== this.roomGeneration) {
        return;
      }
      this.appliedRevision = revision;
      this.appliedFingerprint = fingerprint;
      if (welcome) {
        this.emitSnapshotFromWelcome(welcome, chart, initial);
      } else {
        this.emitSnapshotFromState(chart, revision, fingerprint, initial);
      }
    } catch (error) {
      this.handleDecryptFailure(error);
    }
  }

  /** Decrypt one committed batch and deliver it when still current. */
  private async deliverEncryptedCommitted(
    message: Extract<ServerMessage, { type: "committed" }>,
    generation: number,
  ): Promise<void> {
    if (!isEncryptedPayload(message.changes)) {
      throw new Error("Encrypted commit is malformed");
    }
    const changes = await this.decodeEncryptedChanges(message.changes, message.changesEncoding);
    if (generation !== this.roomGeneration) {
      return;
    }
    this.appliedRevision = message.revision;
    this.appliedFingerprint = message.fingerprint;
    this.options.onCommitted?.({
      ...message,
      changes,
    } as CommittedMessage);
  }

  /** Surface a decryption failure and mark the room as errored. */
  private handleDecryptFailure(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    this.setState({ status: "error", error: message });
    this.options.onError?.(message);
  }

  /** Merge one member's presence, stamping it with the local receive time. */
  private mergePresence(presence: MemberPresence): void {
    const current = this.state.get().presence;
    const next = current.filter((entry) => entry.memberId !== presence.memberId);
    if (presence.updatedAt > 0) {
      // Presence expiry is a local observation, so the receiving clock owns
      // the timestamp rather than the sender's.
      next.push({ ...presence, updatedAt: Date.now() });
    }
    this.setState({ presence: next });
  }

  /** Re-send every queued transaction after a reconnect, reacquiring leases first. */
  private retryPending(): void {
    for (const entry of this.outbox.values()) {
      this.flushTransaction(entry.value);
    }
  }

  /** Send one queued transaction when connected and its wire form is ready. */
  private flushTransaction(pending: PendingTransaction): void {
    if (this.disposed || this.state.get().status !== "connected") {
      return;
    }
    if (pending.preparing || pending.wireChanges === undefined) {
      return;
    }
    // A reconnect invalidates every lease this connection held. Acquire the
    // set again, in queue order, before the first byte of the batch is sent.
    if (pending.lockIds?.length && !pending.locksHeld) {
      this.enqueueDelivery(pending);
      return;
    }
    this.sendPending(pending);
  }

  /** Serialize lease acquisition for queued batches so transaction order holds. */
  private enqueueDelivery(pending: PendingTransaction): void {
    if (pending.locksPending) {
      return;
    }
    pending.locksPending = true;
    this.deliveryQueue = this.deliveryQueue
      .then(async () => {
        if (this.disposed || this.outbox.value(pending.transactionId) !== pending) {
          return;
        }
        if (this.state.get().status !== "connected") {
          return;
        }
        const granted = await this.acquireLocks(pending.lockIds ?? []);
        if (!granted) {
          // A disconnect already resolved the request; keep the batch for the
          // next welcome instead of treating transport loss as a denial.
          if (this.state.get().status !== "connected") {
            return;
          }
          if (this.outbox.value(pending.transactionId) === pending) {
            this.outbox.delete(pending.transactionId);
            this.setState({ queued: this.outbox.size });
            this.options.onTransactionRejected?.(
              pending,
              "The room could not reserve the objects in this edit.",
              "locked",
            );
          }
          return;
        }
        pending.locksHeld = true;
        if (this.outbox.value(pending.transactionId) === pending) {
          this.sendPending(pending);
        }
      })
      .catch((error) => {
        this.options.onError?.(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        pending.locksPending = false;
        if (
          this.outbox.value(pending.transactionId) === pending &&
          !pending.locksHeld &&
          this.state.get().status === "connected"
        ) {
          queueMicrotask(() => this.flushTransaction(pending));
        }
      });
  }

  /** Write one prepared batch to the socket and record the attempt. */
  private sendPending(pending: PendingTransaction): void {
    this.outbox.markAttempt(pending.transactionId);
    const changes = pending.wireChanges ?? pending.changes;
    this.send({
      type: "transaction",
      transactionId: pending.transactionId,
      label: pending.label,
      changes,
      ...(pending.wireEncoding ? { changesEncoding: pending.wireEncoding } : {}),
      affectedObjectIds: pending.affectedObjectIds,
      ...(pending.lockIds?.length ? { lockIds: pending.lockIds } : {}),
      ...(pending.undoOf ? { undoOf: pending.undoOf } : {}),
    });
  }

  /** Include product metadata when this host has a bundled build version. */
  private appVersionFields(): { readonly appVersion?: string } {
    return this.appVersion ? { appVersion: this.appVersion } : {};
  }

  /** Advertise transport capabilities during create, join, and resume. */
  private transportFields(): { readonly binaryChunks: boolean; readonly chartChunks: boolean } {
    return { binaryChunks: true, chartChunks: true };
  }

  /** Tell a resuming server which chart revision this client already applied. */
  private resumeChartFields(): {
    readonly hasChart?: boolean;
    readonly revision?: number;
    readonly fingerprint?: string;
  } {
    if (this.appliedRevision < 0 || !this.appliedFingerprint) {
      return {};
    }
    return {
      hasChart: true,
      revision: this.appliedRevision,
      fingerprint: this.appliedFingerprint,
    };
  }

  /** Serialize and send one client message when the socket is open. */
  private send(message: ClientMessage): void {
    if (!this.socket || !this.socketOpen) {
      return;
    }
    try {
      this.socket.send(JSON.stringify(message));
    } catch (error) {
      this.handleSocketFailure(error);
    }
  }

  /** Send one binary asset chunk when the socket is open. */
  private sendBinary(header: Record<string, unknown>, body: Uint8Array): void {
    if (!this.socket || !this.socketOpen) {
      return;
    }
    try {
      this.socket.send(encodeBinaryAssetFrame(header, body));
    } catch (error) {
      this.handleSocketFailure(error);
    }
  }

  /** Reset every room-scoped field and invalidate in-flight decryptions. */
  private clearRoom(): void {
    this.roomGeneration += 1;
    this.binaryChunks = false;
    this.assetAdopt = false;
    this.appliedRevision = -1;
    this.appliedFingerprint = "";
    this.resumeToken = "";
    this.resumeTarget = null;
    this.invitedRoom = null;
    this.hostChart = null;
    this.encrypted = false;
    this.roomKey = "";
    this.autoApproveEditor = false;
    this.roomInvite = "";
    this.encryptionKey = null;
    this.encryptedCommitQueue = Promise.resolve();
    this.pendingOpenAction = null;
    this.outbox.clear();
    for (const [requestId, waiter] of this.beginWaiters) {
      clearTimeout(waiter.timer);
      waiter.reject(
        new Error("The collaboration room was closed before the asset transfer began."),
      );
      this.beginWaiters.delete(requestId);
    }
    for (const [requestId, waiter] of this.uploadWaiters) {
      clearTimeout(waiter.timer);
      waiter.reject(new Error("The collaboration room was closed before the asset was accepted."));
      this.uploadWaiters.delete(requestId);
    }
    this.uploads.clear();
    this.downloads.clear();
    this.requestedHashes.clear();
    for (const request of this.lockRequests.values()) {
      clearTimeout(request.timer);
      request.resolve(false);
    }
    this.lockRequests.clear();
    this.setState({
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
      members: [],
      presence: [],
      assets: [],
      locks: [],
      pending: [],
      queued: 0,
    });
  }

  /** Merge a partial state update into the observable cell. */
  private setState(partial: Partial<CollaborationState>): void {
    this.state.update(partial);
  }
}
