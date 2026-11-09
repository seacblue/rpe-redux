/* eslint-disable max-lines -- the provider owns the room, asset, lock, presence, and undo lifecycle. */
/**
 * React seam for a collaboration room.
 *
 * The provider owns the room client, translates local history entries into
 * object-addressed transactions, applies accepted remote batches through the
 * session's remote-commit path, and samples the local pointer for presence. The
 * server remains authoritative; this file never invents ordering or conflict
 * rules of its own.
 */
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import {
  normalizeChartObjectIds,
  assertChart,
  type Chart,
} from "../../../../../core/global/chart/chart.ts";
import {
  getEditorVisibility,
  subscribeToEditorVisibility,
} from "../../../../../core/edit/state/visibility.ts";
import { assetPath, resourceReferences } from "../../../../../core/global/document/resources.ts";
import type { AssetMap } from "../../../../../core/global/document/types.ts";
import { getDrawerState, subscribeDrawer } from "../../../../chrome/drawer/drawerPanes.ts";
import { preferences, PREFERENCE_SECTIONS } from "../../../../../core/state/preferences.ts";
import {
  CollaborationClient,
  type CommittedMessage,
  type TransactionInput,
} from "../../../../../core/collaboration/client.ts";
import {
  collaborationPendingAssets,
  collaborationPreparing,
  collaborationRoom,
  EMPTY_COLLABORATION_STATE,
} from "../../../../../core/collaboration/ui.ts";
import { openPane } from "../../inspector/controller.ts";
import {
  applyChartChanges,
  diffCharts,
  stableFingerprint,
} from "../../../../../core/collaboration/changes.ts";
import { collaborationAccess } from "../../../../../core/collaboration/access.ts";
import { canPerform, canPublishAsset } from "../../../../../core/collaboration/permissions.ts";
import {
  buildRoomInviteLink,
  normalizeRoomServerUrl,
  parseRoomInviteLink,
} from "../../../../../core/collaboration/invite.ts";
import {
  chartAssetNames,
  chartChangesMayAffectAssets,
} from "../../../../../core/collaboration/assets.ts";
import { isDesktop } from "../../../../../core/platform/environment.ts";
import { getRuntimePorts } from "../../../../../core/platform/runtimePorts.ts";
import { BUILD_APP_VERSION } from "../../../../../core/platform/buildInfo.ts";
import { changeLockKeys } from "../../../../../core/collaboration/changes.ts";
import { sha256Hex } from "../../../../../core/collaboration/digest.ts";
import type {
  CollaborationProfile,
  CollaborationRole,
  CollaborationSocket,
  CollaborationState,
  MemberPresence,
  RoomAsset,
  RoomLock,
  RoomMember,
  RoomSnapshot,
  ServerMessage,
  UnsentChange,
} from "../../../../../core/collaboration/types.ts";
import { showToast } from "../../../../../design/patterns/ToastHost.tsx";
import {
  requestConfirm,
  showNotice as showModalNotice,
} from "../../../../overlays/modals/prompts.ts";
import { t } from "../../../../../i18n/index.ts";
import { useEditorRuntime, type EditorRuntime } from "../runtime/composition/EditorRuntime.tsx";
import {
  useDocumentRuntime,
  type DocumentRuntime,
} from "../runtime/providers/DocumentProvider.tsx";
import { useEditorSession } from "../runtime/providers/SessionProvider.tsx";
import type { EditorSession } from "../../../../../core/edit/session/session.ts";
import { currentDocumentStore } from "../../../../platform/documentStoreHandle.ts";
import { setJoinedRoomDocument } from "../document/save/saver.ts";
import { inspectRoomInvite } from "./roomInvitePreview.ts";
import { requestRoomInviteConfirmation } from "./roomInvitePrompt.tsx";

/** How a host exposes its room to invitees. */
export type CollaborationHostMode = "tunnel" | "lan";

/** Locally stored identity and host preferences for collaboration. */
export interface CollaborationSettings {
  readonly serverUrl: string;
  readonly displayName: string;
  readonly color: string;
  readonly hostMode: CollaborationHostMode;
  /** User-chosen LAN bridge port; empty when unset. */
  readonly lanPort: string;
}

const DEFAULT_SETTINGS: CollaborationSettings = Object.freeze({
  serverUrl: `ws://127.0.0.1:${getRuntimePorts().collabPort}`,
  displayName: "",
  color: "#77b7ff",
  hostMode: "tunnel",
  lanPort: "",
});

/**
 * A fresh LAN port suggestion for this app launch; never written on its own.
 *
 * Stay below the Windows ephemeral range (49152-65535) so an outgoing socket
 * cannot occupy the suggested port before the bridge binds it. The reserved
 * 47821/47830 ports are excluded as well.
 */
export const suggestedLanPort = (() => {
  const bytes = new Uint32Array(1);
  globalThis.crypto.getRandomValues(bytes);
  return String(41000 + (bytes[0] % (47820 - 41000 + 1)));
})();

const PROFILE_COLORS = [
  "#77b7ff",
  "#6ee7b7",
  "#ffd166",
  "#ff8fa3",
  "#b79cff",
  "#67d8ec",
  "#f5a97f",
  "#9ad96b",
] as const;

/** Generates a unique display name for a first-run profile. */
function defaultName(): string {
  const suffix = Math.floor(Math.random() * 9000 + 1000);
  return `${t("workspace.collaboration.defaultName")} ${suffix}`;
}

/** First-run identity: a different name and pointer colour per machine. */
function defaultProfile(): { name: string; color: string } {
  return {
    name: defaultName(),
    color: PROFILE_COLORS[Math.floor(Math.random() * PROFILE_COLORS.length)],
  };
}

/** Reads stored collaboration settings, filling missing fields from the profile. */
function readSettings(): CollaborationSettings {
  const raw = preferences.read(PREFERENCE_SECTIONS.collaboration, null);
  const fallback = defaultProfile();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {
      ...DEFAULT_SETTINGS,
      displayName: fallback.name,
      color: fallback.color,
    };
  }
  const record = raw as Record<string, unknown>;
  return {
    serverUrl:
      typeof record.serverUrl === "string" && record.serverUrl.trim()
        ? record.serverUrl
        : DEFAULT_SETTINGS.serverUrl,
    displayName:
      typeof record.displayName === "string" && record.displayName.trim()
        ? record.displayName
        : fallback.name,
    color:
      typeof record.color === "string" && /^#[0-9a-f]{6}$/i.test(record.color)
        ? record.color
        : fallback.color,
    hostMode: record.hostMode === "lan" ? "lan" : "tunnel",
    lanPort:
      typeof record.lanPort === "string" && /^\d{4,5}$/.test(record.lanPort) ? record.lanPort : "",
  };
}

/** Host credentials kept across an application restart, separate from user settings. */
interface StoredHostSession {
  readonly roomId: string;
  readonly resumeToken: string;
  readonly serverUrl: string;
}

/** Read the last host session, ignoring a truncated or user-edited record. */
function readHostSession(): StoredHostSession | null {
  const raw = preferences.read(PREFERENCE_SECTIONS.collaboration, null);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  const value = (raw as Record<string, unknown>).hostSession;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (
    typeof record.roomId !== "string" ||
    !record.roomId.trim() ||
    typeof record.resumeToken !== "string" ||
    !record.resumeToken.trim() ||
    typeof record.serverUrl !== "string" ||
    !record.serverUrl.trim()
  ) {
    return null;
  }
  return {
    roomId: record.roomId,
    resumeToken: record.resumeToken,
    serverUrl: record.serverUrl,
  };
}

/** Persist or clear the host session without disturbing the visible settings. */
function writeHostSession(session: StoredHostSession | null): void {
  const raw = preferences.read(PREFERENCE_SECTIONS.collaboration, null);
  const next =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? { ...(raw as Record<string, unknown>) }
      : {};
  if (session) {
    next.hostSession = session;
  } else {
    delete next.hostSession;
  }
  preferences.write(PREFERENCE_SECTIONS.collaboration, next);
}

/** The room state and commands the inspector pane consumes. */
export interface CollaborationApi {
  readonly state: CollaborationState;
  readonly settings: CollaborationSettings;
  readonly recovery: unknown | null;
  readonly unsent: readonly UnsentChange[];
  readonly pendingAssets: readonly string[];
  readonly startingRoom: boolean;
  readonly joiningRoom: boolean;
  readonly pendingInviteLink: string;
  updateSettings(next: Partial<CollaborationSettings>): void;
  createRoom(
    override?: Partial<CollaborationSettings> & {
      readonly autoApproveEditor?: boolean;
      readonly password?: string;
    },
  ): Promise<void>;
  joinRoom(
    input: string | { serverUrl: string; invite: string },
    override?: Partial<CollaborationSettings>,
  ): Promise<void>;
  leaveRoom(): void;
  /** Host-only: delete the room for every member. */
  closeRoom(): void;
  approve(requestId: string, allow: boolean, role?: CollaborationRole): void;
  setRole(memberId: string, role: Exclude<CollaborationRole, "host">): void;
  setMaxMembers(maxMembers: number): void;
  removeMember(memberId: string): void;
  copyInvite(): Promise<void>;
  /** Update the host's password and publish a fresh invitation link. */
  updateRoomPassword(password: string): void;
  clearRecovery(): void;
  applyRecovery(): void;
  retryUnsent(transactionId: string): Promise<void>;
  rebaseUnsent(transactionId: string): void;
  discardUnsent(transactionId: string): void;
}

const CollaborationContext = createContext<CollaborationApi | null>(null);

/** The newest committed history entry, used as the outgoing-diff baseline. */
function baselineId(session: EditorSession): number {
  return session.history.undoStack.at(-1)?.id ?? 0;
}

/** Stable transaction id for a history entry published to a room. */
function historyTransactionId(entry: {
  readonly origin?: { readonly requestId?: string };
}): string {
  if (entry.origin?.requestId) {
    return entry.origin.requestId;
  }
  const crypto = globalThis.crypto;
  return typeof crypto?.randomUUID === "function"
    ? crypto.randomUUID()
    : `edit-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

/** Applies room membership and role to the session's write permissions. */
function applyRole(session: EditorSession, state: CollaborationState): void {
  const access = collaborationAccess(state.roomId, state.role);
  session.setCollaborationAccess(access.active, access.readOnly);
  session.setCollaborationActor(access.active ? state.memberId : "");
}

/** Joins the display names of the members holding conflicting locks. */
function lockOwners(conflicts: readonly RoomLock[], members: readonly RoomMember[]): string {
  const names = conflicts.map(
    (lock) => members.find((member) => member.id === lock.ownerId)?.profile.name ?? lock.ownerId,
  );
  return [...new Set(names)].filter(Boolean).join(", ");
}

/** Reads one asset's bytes from memory or the document's byte source. */
async function localAssetBytes(
  assets: AssetMap,
  name: string,
  chartName: string,
): Promise<Uint8Array | null> {
  const path = assetPath(assets, name, chartName);
  if (!path) {
    return null;
  }
  const loaded = assets.get(path);
  if (loaded) {
    return loaded;
  }
  return (await assets.read?.(path)) ?? null;
}

/** Keep at most two resource streams active so one large asset cannot starve all others. */
const MAX_PARALLEL_ASSET_UPLOADS = 2;

/** Uploads changed chart resources the room does not have at the same hash. */
async function publishChartAssets(
  client: CollaborationClient | null,
  document: DocumentRuntime | null,
  uploading: Map<string, Promise<boolean>>,
  chart: unknown,
): Promise<boolean> {
  if (!client || !document) {
    return true;
  }
  const stateNow = client.state.get();
  if (
    stateNow.status !== "connected" ||
    !stateNow.roomId ||
    !canPerform(stateNow.role, "upload-asset")
  ) {
    return true;
  }
  const assets = document.currentAssets();
  const chartName = document.currentChartName();
  const names = new Set(chartAssetNames(chart));
  const references = resourceReferences(chart as Chart, assets, chartName);
  if (references.song) {
    names.add(references.song);
  }
  if (references.background) {
    names.add(references.background);
  }
  const uploadOne = async (name: string): Promise<boolean> => {
    const inFlight = uploading.get(name);
    if (inFlight) {
      return inFlight;
    }
    const bytes = await localAssetBytes(assets, name, chartName);
    if (!bytes) {
      return true;
    }
    const hash = await sha256Hex(bytes);
    const existing = stateNow.assets.find((asset) => asset.name === name);
    if (existing && (existing.plaintextHash ?? existing.hash) === hash) {
      return true;
    }
    // An editor may contribute a new resource, but only the host may replace an
    // existing room resource with different bytes.
    if (!canPublishAsset(stateNow.role, existing !== undefined)) {
      return true;
    }
    const task = (async () => {
      try {
        await client.uploadAsset(name, bytes);
        return true;
      } catch {
        return false;
      } finally {
        uploading.delete(name);
      }
    })();
    uploading.set(name, task);
    return task;
  };
  const namesList = [...names];
  let nextIndex = 0;
  const worker = async (): Promise<boolean> => {
    let ok = true;
    while (nextIndex < namesList.length) {
      const name = namesList[nextIndex++];
      if (!(await uploadOne(name))) {
        ok = false;
      }
    }
    return ok;
  };
  const workerCount = Math.min(MAX_PARALLEL_ASSET_UPLOADS, namesList.length);
  return (await Promise.all(Array.from({ length: workerCount }, worker))).every(Boolean);
}

/** Requests room assets whose bytes differ from the local copy. */
async function requestChartAssets(
  client: CollaborationClient | null,
  document: DocumentRuntime | null,
  chart: unknown,
): Promise<string[]> {
  if (!client || !document) {
    return [];
  }
  const stateNow = client.state.get();
  if (stateNow.status !== "connected" || !stateNow.roomId) {
    return [];
  }
  const assets = document.currentAssets();
  const chartName = document.currentChartName();
  const names = new Set(chartAssetNames(chart));
  const references = resourceReferences(chart as Chart, assets, chartName);
  if (references.song) {
    names.add(references.song);
  }
  if (references.background) {
    names.add(references.background);
  }
  const missing: string[] = [];
  for (const name of names) {
    const entry = stateNow.assets.find((asset) => asset.name === name);
    if (!entry) {
      continue;
    }
    const bytes = await localAssetBytes(assets, name, chartName);
    if (bytes && (await sha256Hex(bytes)) === (entry.plaintextHash ?? entry.hash)) {
      continue;
    }
    missing.push(name);
    client.requestAsset(entry.hash, name);
  }
  return missing;
}

/** Socket callbacks the client dispatches into the latest React closures. */
interface HandlerSet {
  snapshot: (snapshot: RoomSnapshot, initial: boolean) => void;
  committed: (message: CommittedMessage) => void;
  conflict: (conflict: Extract<ServerMessage, { type: "conflict" }>) => void;
  role: (role: CollaborationRole, reason?: string) => void;
  error: (message: string, code?: string) => void;
  warning: (message: string, code?: string) => void;
  assetReady: (asset: RoomAsset, bytes: Uint8Array) => void;
  assetError: (message: string) => void;
  lockDenied: (conflicts: readonly RoomLock[]) => void;
  lockTimeout: () => void;
  transactionRejected: (
    transaction: TransactionInput & { readonly transactionId: string },
    message: string,
    code: string,
  ) => void;
}

/** Owns the room client and publishes its state and commands to the editor. */
export function CollaborationProvider({ children }: { children: ReactNode }) {
  const sessionRuntime = useEditorSession();
  const runtime = useEditorRuntime();
  const documentRuntime = useDocumentRuntime();
  const [settings, setSettings] = useState<CollaborationSettings>(readSettings);
  const [recovery, setRecovery] = useState<unknown | null>(null);
  const [unsent, setUnsent] = useState<readonly UnsentChange[]>([]);
  const [pendingAssets, setPendingAssets] = useState<readonly string[]>([]);
  const [startingRoom, setStartingRoom] = useState(false);
  const [joiningRoom, setJoiningRoom] = useState(false);
  const [pendingInviteLink, setPendingInviteLink] = useState("");
  useEffect(() => {
    collaborationPreparing.set(startingRoom || joiningRoom);
    return () => collaborationPreparing.set(false);
  }, [startingRoom, joiningRoom]);
  const uploading = useRef(new Map<string, Promise<boolean>>());
  const stateCell = collaborationRoom;
  const state = useSyncExternalStore(stateCell.subscribe, stateCell.get, stateCell.get);
  const visible = useSyncExternalStore(
    subscribeToEditorVisibility,
    getEditorVisibility,
    getEditorVisibility,
  );
  const clientRef = useRef<CollaborationClient | null>(null);
  const hostBusy = useRef(false);
  const sessionClaimed = useRef(false);
  const resuming = useRef(false);
  const resumeAttempted = useRef(false);
  const roomJoinPending = useRef(false);
  const joinedRecoveryFingerprint = useRef<string | null>(null);
  const roomDocumentAdopted = useRef(false);
  const storedHostSession = useRef<StoredHostSession | null>(readHostSession());
  const applied = useRef(new Set<string>());
  const appliedRevision = useRef(0);
  const contextRef = useRef<{
    runtime: EditorRuntime | null;
    documentRuntime: DocumentRuntime | null;
  }>({ runtime, documentRuntime });
  const handlersRef = useRef<HandlerSet>({
    snapshot: () => {},
    committed: () => {},
    conflict: () => {},
    role: () => {},
    error: () => {},
    warning: () => {},
    assetReady: () => {},
    assetError: () => {},
    lockDenied: () => {},
    lockTimeout: () => {},
    transactionRejected: () => {},
  });

  /** Keep a rejected batch visible so the user can retry or force it later. */
  const rememberUnsent = useCallback(
    (
      pending: TransactionInput & { readonly transactionId: string },
      message: string,
      code: string,
    ) => {
      setUnsent((current) =>
        current.some((item) => item.transactionId === pending.transactionId)
          ? current
          : [
              ...current,
              {
                transactionId: pending.transactionId,
                label: pending.label,
                changes: pending.changes,
                affectedObjectIds: pending.affectedObjectIds,
                ...(pending.undoOf ? { undoOf: pending.undoOf } : {}),
                ...(pending.lockIds?.length ? { lockIds: pending.lockIds } : {}),
                message,
                code,
              },
            ],
      );
    },
    [],
  );

  /** Claims the desktop collaboration session, reporting why when it fails. */
  const ensureSession = useCallback(async (): Promise<boolean> => {
    if (!isDesktop()) {
      return true;
    }
    try {
      const claimed = await invoke<boolean>("claim_collab_session");
      if (!claimed) {
        showModalNotice({
          title: t("workspace.collaboration.sessionBusyTitle"),
          description: t("workspace.collaboration.sessionBusyBody"),
        });
        return false;
      }
      sessionClaimed.current = true;
      return true;
    } catch {
      showModalNotice({
        title: t("workspace.collaboration.sessionBusyTitle"),
        description: t("workspace.collaboration.sessionClaimFailed"),
      });
      return false;
    }
  }, []);

  useEffect(() => {
    contextRef.current = { runtime, documentRuntime };
  }, [runtime, documentRuntime]);

  // A second launch receives the invitation as a process argument; the first
  // launch reads the pending value once the provider mounts.
  useEffect(() => {
    if (!isDesktop()) {
      return;
    }
    let disposed = false;
    let unlisten: (() => void) | undefined;
    const openInvite = async (link: string) => {
      if (disposed) {
        return;
      }
      const parsed = parseRoomInviteLink(link);
      if (!parsed) {
        showToast(t("workspace.collaboration.invalidInviteLink"), "error");
        return;
      }
      if (visible.atHome) {
        const preview = await inspectRoomInvite(parsed).catch(() => null);
        if (disposed || !(await requestRoomInviteConfirmation(preview))) {
          return;
        }
      }
      setPendingInviteLink(link);
      openPane("collaboration");
    };
    void invoke<string | null>("take_collab_invite").then((link) => {
      if (link) {
        void openInvite(link);
      }
    });
    void listen<string>("redux-collab-invite", (event) => void openInvite(event.payload)).then(
      (dispose) => {
        unlisten = dispose;
        if (disposed) {
          dispose();
        }
      },
    );
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [visible.atHome]);

  // The client is an external subscription, not render state. It is created
  // once and teardown is scoped to this provider.
  useEffect(() => {
    const client = new CollaborationClient({
      appVersion: BUILD_APP_VERSION,
      state: stateCell,
      socketFactory: (url) => new WebSocket(url) as unknown as CollaborationSocket,
      onSnapshot: (snapshot, initial) => handlersRef.current.snapshot(snapshot, initial),
      onCommitted: (message) => handlersRef.current.committed(message),
      onConflict: (conflict) => handlersRef.current.conflict(conflict),
      onRole: (role, reason) => handlersRef.current.role(role, reason),
      onError: (message, code) => handlersRef.current.error(message, code),
      onWarning: (message, code) => handlersRef.current.warning(message, code),
      onAssetReady: (asset, bytes) => handlersRef.current.assetReady(asset, bytes),
      onAssetError: (message) => handlersRef.current.assetError(message),
      onLockDenied: (conflicts) => handlersRef.current.lockDenied(conflicts),
      onLockTimeout: () => handlersRef.current.lockTimeout(),
      onTransactionRejected: (transaction, message, code) =>
        handlersRef.current.transactionRejected(transaction, message, code),
    });
    clientRef.current = client;
    return () => {
      clientRef.current = null;
      client.dispose();
      if (sessionClaimed.current && isDesktop()) {
        sessionClaimed.current = false;
        void invoke("release_collab_session").catch(() => undefined);
      }
      collaborationRoom.set(EMPTY_COLLABORATION_STATE);
      collaborationPendingAssets.set([]);
    };
  }, [stateCell]);

  // Resume the host's last room once a document is mounted. The room server
  // persists its members, so the token keeps the host role and authoritative
  // chart across an application restart. A stale session is cleared on the
  // terminal rejection rather than retried forever.
  useEffect(() => {
    const stored = storedHostSession.current;
    const client = clientRef.current;
    if (!stored || !client || resumeAttempted.current || !visible.hasDocument) {
      return;
    }
    resumeAttempted.current = true;
    resuming.current = true;
    setStartingRoom(true);
    void (async () => {
      if (!(await ensureSession())) {
        resuming.current = false;
        setStartingRoom(false);
        return;
      }
      const confirmed = await requestConfirm({
        title: t("workspace.collaboration.resumeTitle"),
        description: t("workspace.collaboration.resumeBody"),
        label: t("workspace.collaboration.resumeAction"),
      });
      if (!confirmed) {
        resuming.current = false;
        setStartingRoom(false);
        writeHostSession(null);
        sessionClaimed.current = false;
        if (isDesktop()) {
          void invoke("release_collab_session").catch(() => undefined);
        }
        return;
      }
      // A host restart also restarts the public bridge; otherwise guests keep
      // reconnecting to a tunnel or LAN proxy that no longer exists.
      let publicUrl = stored.serverUrl;
      if (isDesktop()) {
        try {
          if (settings.hostMode === "lan") {
            const requested = settings.lanPort.trim();
            publicUrl = normalizeRoomServerUrl(
              await invoke<string>("start_lan_bridge", {
                port: Number(requested || suggestedLanPort),
              }),
            );
          } else {
            publicUrl = normalizeRoomServerUrl(await invoke<string>("start_collab_tunnel"));
          }
        } catch (error) {
          showToast(
            t("workspace.collaboration.hostFailed", {
              detail: error instanceof Error ? error.message : String(error),
            }),
            "error",
          );
        }
      }
      if (!resuming.current || clientRef.current !== client) {
        setStartingRoom(false);
        if (isDesktop()) {
          void invoke("stop_collab_tunnel").catch(() => undefined);
          void invoke("stop_lan_bridge").catch(() => undefined);
          sessionClaimed.current = false;
          void invoke("release_collab_session").catch(() => undefined);
        }
        return;
      }
      client.resumeRoom(publicUrl, stored.roomId, stored.resumeToken, {
        socketUrl: isDesktop() ? DEFAULT_SETTINGS.serverUrl : publicUrl,
      });
    })();
  }, [visible.hasDocument, sessionRuntime, ensureSession, settings.hostMode, settings.lanPort]);

  // Announce the transitions the panel cannot show in a compact row: the room
  // becoming ready, a guest waiting for approval, and an existing room losing
  // its connection. The client reports transport errors separately.
  useEffect(() => {
    let previous = stateCell.get().status;
    return stateCell.subscribe(() => {
      const next = stateCell.get().status;
      if (next === previous) {
        return;
      }
      const before = previous;
      previous = next;
      if (next === "connected" || next === "waiting" || next === "error" || next === "idle") {
        setStartingRoom(false);
        setJoiningRoom(false);
      }
      if ((next === "error" || next === "idle" || next === "offline") && roomJoinPending.current) {
        // A join that never produced a snapshot leaves the local document intact.
        roomJoinPending.current = false;
        joinedRecoveryFingerprint.current = null;
        setJoinedRoomDocument(false);
      }
      if (next === "connected") {
        showToast(
          t(
            before === "reconnecting" || before === "offline"
              ? "workspace.collaboration.reconnected"
              : "workspace.collaboration.joined",
          ),
          "success",
        );
      } else if (next === "waiting" && before !== "waiting") {
        showToast(t("workspace.collaboration.waitingApproval"), "info");
      } else if (next === "reconnecting" && before === "connected") {
        showToast(t("workspace.collaboration.reconnecting"), "warning");
      } else if (next === "offline" && before === "connected") {
        showToast(t("workspace.collaboration.connectionLost"), "warning");
      }
    });
  }, [stateCell]);

  /** Requests assets for the newly applied chart and publishes the pending list. */
  const requestMissing = (chart: unknown): void => {
    void requestChartAssets(clientRef.current, contextRef.current.documentRuntime, chart).then(
      (missing) => {
        setPendingAssets(missing);
        collaborationPendingAssets.set(missing);
      },
    );
  };

  /** Writes one displaced chart into the native recovery store, reporting failure. */
  const writeRecovery = async (chart: unknown): Promise<boolean> => {
    const documents = runtime?.documents ?? currentDocumentStore();
    if (!documents) {
      return false;
    }
    const document = contextRef.current.documentRuntime;
    const assets = document ? new Map(document.currentAssets()) : new Map();
    try {
      await documents.recover(chart, assets, {
        lineIndex: sessionRuntime.current.lineIndex,
      });
      return true;
    } catch (error) {
      showToast(
        t("editor.app.notice.backupFailed", {
          message: error instanceof Error ? error.message : String(error),
        }),
        "warning",
      );
      return false;
    }
  };

  /** Keeps a displaced chart in the panel and in the crash-recovery store. */
  const retainRecovery = (chart: unknown): void => {
    setRecovery(chart);
    void writeRecovery(chart);
  };

  /**
   * Replaces the joined guest's document with the room chart.
   *
   * The room chart has no local file or library target. Save isolation stays set
   * until the old native document is detached; if detaching fails, it remains as
   * the fallback that keeps Ctrl+S from overwriting the guest's original file.
   */
  const adoptJoinedRoomChart = (chart: Chart): void => {
    const document = contextRef.current.documentRuntime;
    if (!document) {
      return;
    }
    const documents = contextRef.current.runtime?.documents ?? currentDocumentStore();
    setJoinedRoomDocument(true);
    document.replaceChart(chart, t("workspace.collaboration.roomChart"));
    roomDocumentAdopted.current = true;
    void requestMissing(chart);
    // Future autosaves belong to the room document, not the pre-join draft.
    documents?.detachRecoveryTarget();
    if (!documents?.current) {
      setJoinedRoomDocument(false);
      return;
    }
    void documents
      .close()
      .then(() => {
        setJoinedRoomDocument(false);
      })
      .catch(() => {
        // The old path is still mounted, so keep the save guard active.
        showToast(t("workspace.collaboration.applyFailed"), "error");
      });
  };

  /** Clears the local room presentation and releases host bridges. */
  const finishRoomExit = () => {
    resuming.current = false;
    roomJoinPending.current = false;
    joinedRecoveryFingerprint.current = null;
    const adopted = roomDocumentAdopted.current;
    roomDocumentAdopted.current = false;
    const documents = runtime?.documents ?? currentDocumentStore();
    if (adopted && documents?.current) {
      // The earlier detach failed; retry before dropping the save guard.
      void documents
        .close()
        .then(() => setJoinedRoomDocument(false))
        .catch(() => undefined);
    } else {
      setJoinedRoomDocument(false);
    }
    writeHostSession(null);
    setStartingRoom(false);
    setJoiningRoom(false);
    setRecovery(null);
    setUnsent([]);
    applied.current.clear();
    appliedRevision.current = 0;
    uploading.current.clear();
    setPendingAssets([]);
    collaborationPendingAssets.set([]);
    sessionRuntime.current.setCollaborationAccess(false, false);
    if (isDesktop()) {
      void invoke("stop_collab_tunnel").catch(() => undefined);
      void invoke("stop_lan_bridge").catch(() => undefined);
      sessionClaimed.current = false;
      void invoke("release_collab_session").catch(() => undefined);
    }
  };

  // Callbacks read the latest editor closures; installing them after each
  // commit keeps the client independent of React's render cycle.
  useEffect(() => {
    const showNotice = (description: string, level = "warning") => {
      showToast(description, level);
    };
    const connectionErrorText = (message: string, code?: string): string => {
      switch (code) {
        case "connect_timeout":
          return t("workspace.collaboration.connectionTimeout");
        case "handshake_timeout":
          return t("workspace.collaboration.handshakeTimeout");
        case "connection_closed":
          return t("workspace.collaboration.connectionClosed");
        case "heartbeat_timeout":
          return t("workspace.collaboration.heartbeatTimeout");
        case "socket_error":
          return t("workspace.collaboration.connectionFailed");
        case "queue_full":
          return t("workspace.collaboration.queueFull");
        case "room_closed":
          return t("workspace.collaboration.roomClosed");
        case "version_mismatch":
          return t("workspace.collaboration.compatibilityMismatch");
        default:
          return message;
      }
    };
    handlersRef.current = {
      snapshot: (snapshot, initial) => {
        const client = clientRef.current;
        if (!client) {
          return;
        }
        resuming.current = false;
        setStartingRoom(false);
        if (initial) {
          applied.current.clear();
        }
        if (snapshot.role === "host" && snapshot.resumeToken) {
          writeHostSession({
            roomId: snapshot.roomId,
            resumeToken: snapshot.resumeToken,
            serverUrl: client.state.get().serverUrl,
          });
        }
        const chart = snapshot.chart;
        const session = sessionRuntime.current;
        let parsed: Chart;
        try {
          assertChart(chart);
          parsed = normalizeChartObjectIds(chart);
        } catch (error) {
          showNotice(
            t("workspace.collaboration.invalidSnapshot", {
              detail: error instanceof Error ? error.message : String(error),
            }),
            "error",
          );
          client.requestSnapshot();
          return;
        }
        const document = contextRef.current.documentRuntime;
        if (roomJoinPending.current && document) {
          // The first authoritative snapshot of a join replaces the guest's
          // document; merging it into the old history would keep the old target.
          appliedRevision.current = client.state.get().revision;
          if (
            initial &&
            session.history.dirty &&
            stableFingerprint(session.chart) !== joinedRecoveryFingerprint.current
          ) {
            retainRecovery(session.chart);
          }
          joinedRecoveryFingerprint.current = null;
          roomJoinPending.current = false;
          adoptJoinedRoomChart(parsed);
          return;
        }
        if (!getEditorVisibility().hasDocument && document) {
          document.replaceChart(parsed, t("workspace.collaboration.roomChart"));
          void requestMissing(parsed);
          return;
        }
        appliedRevision.current = client.state.get().revision;
        if (stableFingerprint(session.chart) === stableFingerprint(parsed)) {
          return;
        }
        if (initial && session.history.dirty) {
          // A reconnect snapshot is authoritative, but an unconfirmed local
          // edit still deserves a recovery copy before it is replaced.
          retainRecovery(session.chart);
        }
        if (!session.commitRemoteChart(t("workspace.collaboration.remoteSnapshot"), parsed)) {
          showNotice(t("workspace.collaboration.applyFailed"), "error");
          return;
        }
        void requestMissing(parsed);
        appliedRevision.current = client.state.get().revision;
      },
      committed: (message) => {
        const client = clientRef.current;
        if (!client) {
          return;
        }
        const session = sessionRuntime.current;
        const encrypted = client.state.get().encrypted;
        if (message.actorId === client.state.get().memberId && !encrypted) {
          // Own plaintext commits were already applied locally. Advancing the
          // watermark keeps a replayed/duplicate broadcast from being applied
          // a second time without retaining an unbounded id set.
          appliedRevision.current = message.revision;
          return;
        }
        if (
          applied.current.has(`${message.actorId}\u0000${message.transactionId}`) ||
          message.revision <= appliedRevision.current
        ) {
          return;
        }
        applied.current.add(`${message.actorId}\u0000${message.transactionId}`);
        if (applied.current.size > 2048) {
          for (const id of applied.current) {
            if (applied.current.size <= 2048) {
              break;
            }
            applied.current.delete(id);
          }
        }
        const strict = encrypted ? applyChartChanges(session.chart, message.changes) : null;
        const result =
          encrypted && strict?.conflicts.length
            ? applyChartChanges(session.chart, message.changes, { force: true })
            : (strict ?? applyChartChanges(session.chart, message.changes));
        if (
          encrypted &&
          message.actorId === client.state.get().memberId &&
          stableFingerprint(result.chart) === stableFingerprint(session.chart)
        ) {
          appliedRevision.current = message.revision;
          return;
        }
        if (encrypted && strict?.conflicts.length) {
          // Encrypted rooms cannot compare plaintext server-side; the ordered
          // batch is last-writer-wins and the displaced local state is retained.
          retainRecovery(session.chart);
          showNotice(t("workspace.collaboration.e2eOverwrite"), "warning");
        } else if (!encrypted && result.conflicts.length) {
          retainRecovery(session.chart);
          showNotice(t("workspace.collaboration.conflictNotice"), "error");
          client.requestSnapshot();
          return;
        }
        if (result.conflicts.length) {
          retainRecovery(session.chart);
          showNotice(t("workspace.collaboration.applyFailed"), "error");
          client.requestSnapshot();
          return;
        }
        try {
          assertChart(result.chart);
          const parsed = result.chart as Chart;
          if (
            !session.commitRemoteChart(message.label, parsed, {
              clientId: message.actorId,
              requestId: message.transactionId,
              ...(message.undoOf ? { undoOf: message.undoOf } : {}),
            })
          ) {
            showNotice(t("workspace.collaboration.applyFailed"), "error");
            client.requestSnapshot();
          }
          if (chartChangesMayAffectAssets(message.changes)) {
            void requestMissing(parsed);
          }
          appliedRevision.current = message.revision;
        } catch {
          retainRecovery(session.chart);
          showNotice(t("workspace.collaboration.invalidRemoteChange"), "error");
          client.requestSnapshot();
        }
      },
      conflict: () => {
        const client = clientRef.current;
        if (!client) {
          return;
        }
        retainRecovery(sessionRuntime.current.chart);
        showNotice(t("workspace.collaboration.conflictNotice"), "error");
        client.requestSnapshot();
      },
      role: (role, reason) => {
        const client = clientRef.current;
        if (!client) {
          return;
        }
        applyRole(sessionRuntime.current, client.state.get());
        showToast(
          reason
            ? t("workspace.collaboration.roleChangedReason", { role, reason })
            : t("workspace.collaboration.roleChanged", { role }),
          role === "viewer" ? "warning" : "success",
        );
      },
      error: (message, code) => {
        if (code === "room_closed") {
          finishRoomExit();
          showNotice(connectionErrorText(message, code), "warning");
          return;
        }
        if (
          code === "no_room" ||
          code === "bad_resume" ||
          code === "protocol_mismatch" ||
          code === "version_mismatch" ||
          code === "removed" ||
          code === "room_closed" ||
          code === "bad_invite"
        ) {
          writeHostSession(null);
          if (roomJoinPending.current) {
            roomJoinPending.current = false;
            joinedRecoveryFingerprint.current = null;
            setJoinedRoomDocument(false);
          }
          if (resuming.current) {
            resuming.current = false;
            setStartingRoom(false);
            if (isDesktop()) {
              void invoke("stop_collab_tunnel").catch(() => undefined);
              void invoke("stop_lan_bridge").catch(() => undefined);
              sessionClaimed.current = false;
              void invoke("release_collab_session").catch(() => undefined);
            }
            return;
          }
        }
        if (
          code === "read_only" ||
          code === "invalid_chart" ||
          code === "conflict" ||
          code === "unknown_transaction" ||
          code === "undo_forbidden" ||
          code === "already_undone" ||
          code === "locked" ||
          code === "missing_lock" ||
          code === "invalid_change"
        ) {
          retainRecovery(sessionRuntime.current.chart);
          clientRef.current?.requestSnapshot();
        }
        showNotice(connectionErrorText(message, code), "error");
      },
      warning: () => {
        showNotice(t("workspace.collaboration.versionDifferenceWarning"), "warning");
      },
      assetReady: (asset, bytes) => {
        contextRef.current.documentRuntime?.adoptAsset(asset.name, bytes);
        setPendingAssets((current) => {
          const next = current.filter((name) => name !== asset.name);
          collaborationPendingAssets.set(next);
          return next;
        });
      },
      assetError: (message) => {
        showNotice(message, "error");
      },
      lockDenied: (conflicts) => {
        const owners = lockOwners(conflicts, clientRef.current?.state.get().members ?? []);
        showNotice(
          t("workspace.collaboration.locked", {
            objects: conflicts.map((lock) => lock.id).join(", "),
            owners: owners || t("workspace.collaboration.someone"),
          }),
          "warning",
        );
      },
      lockTimeout: () => {
        showNotice(t("workspace.collaboration.lockTimeout"), "warning");
      },
      transactionRejected: (transaction, message, code) => {
        rememberUnsent(transaction, message, code);
      },
    };
  });

  // Rebinding follows document replacement; the first entry after binding is
  // the baseline, so opening a chart never becomes an outgoing transaction.
  useEffect(() => {
    let session = sessionRuntime.current;
    let lastId = baselineId(session);
    const onHistory = () => {
      const client = clientRef.current;
      if (!client) {
        return;
      }
      const stateNow = client.state.get();
      for (const entry of session.history.undoStack) {
        if (entry.id <= lastId) {
          continue;
        }
        lastId = entry.id;
        if (entry.origin?.kind === "collaboration-remote" || !stateNow.roomId) {
          continue;
        }
        const changes = diffCharts(entry.before, entry.after);
        if (!changes.length) {
          continue;
        }
        const input: TransactionInput = {
          label: entry.label,
          changes,
          affectedObjectIds: entry.affectedObjectIds.map((id) => String(id)),
          transactionId: historyTransactionId(entry),
          ...(entry.origin?.undoOf ? { undoOf: entry.origin.undoOf } : {}),
        };
        const publish = chartChangesMayAffectAssets(changes)
          ? publishChartAssets(
              client,
              contextRef.current.documentRuntime,
              uploading.current,
              entry.after,
            )
          : Promise.resolve(true);
        void publish.then(async (ok) => {
          if (!ok) {
            rememberUnsent(
              input as TransactionInput & { readonly transactionId: string },
              t("workspace.collaboration.assetUploadFailed"),
              "asset_upload_failed",
            );
            showToast(t("workspace.collaboration.assetUploadFailed"), "error");
            return;
          }
          const keys = changeLockKeys(changes);
          const lockIds = [...(keys.chart ? ["chart"] : []), ...keys.lines, ...keys.objects];
          if (client.state.get().status !== "connected") {
            // Queue the batch with its lease intent. The client reacquires the
            // set after the next welcome, before writing the transaction.
            client.sendTransaction({ ...input, lockIds }, { locksHeld: false });
            return;
          }
          if (!(await client.acquireLocks(lockIds))) {
            rememberUnsent(
              input as TransactionInput & { readonly transactionId: string },
              t("workspace.collaboration.lockDeniedRetry"),
              "locked",
            );
            return;
          }
          client.sendTransaction({ ...input, lockIds }, { locksHeld: true });
        });
      }
    };
    let unsubscribeHistory = session.history.subscribe(onHistory);
    const unsubscribeSession = sessionRuntime.subscribe(() => {
      unsubscribeHistory();
      session = sessionRuntime.current;
      lastId = baselineId(session);
      unsubscribeHistory = session.history.subscribe(onHistory);
      applyRole(session, clientRef.current?.state.get() ?? stateCell.get());
    });
    applyRole(session, stateCell.get());
    return () => {
      unsubscribeHistory();
      unsubscribeSession();
    };
  }, [sessionRuntime, stateCell, rememberUnsent]);

  useEffect(() => {
    applyRole(sessionRuntime.current, stateCell.get());
  }, [sessionRuntime, stateCell, state.role, state.roomId]);

  useEffect(() => {
    if (state.status !== "connected" || !state.roomId) {
      return;
    }
    const chart = sessionRuntime.current.chart;
    void publishChartAssets(
      clientRef.current,
      contextRef.current.documentRuntime,
      uploading.current,
      chart,
    )
      .then(() => requestChartAssets(clientRef.current, contextRef.current.documentRuntime, chart))
      .then((missing) => {
        setPendingAssets(missing);
        collaborationPendingAssets.set(missing);
      });
  }, [sessionRuntime, state.assets, state.role, state.roomId, state.status]);

  // Presence sampling: pointer moves are throttled, while a low-rate timer keeps
  // the playhead and the current workspace visible even without pointer motion.
  useEffect(() => {
    if (!runtime) {
      return;
    }
    const canvas = runtime.timeline.notesCanvas;
    let lastSent = 0;
    let lastPointer: { x: number; y: number } | null = null;
    let timer: number | null = null;

    const publish = (force = false) => {
      const client = clientRef.current;
      if (!client) {
        return;
      }
      const now = Date.now();
      if (!force && now - lastSent < 120) {
        return;
      }
      const roomState = client.state.get();
      if (roomState.status !== "connected") {
        return;
      }
      const session = runtime.getSession();
      const drawer = getDrawerState();
      const base: MemberPresence = {
        memberId: roomState.memberId,
        area: "edit",
        updatedAt: now,
        playheadBeat: runtime.timeline.viewport.origin,
      };
      if (drawer.open) {
        client.sendPresence({ ...base, section: drawer.pane });
        lastSent = now;
        return;
      }
      const point = lastPointer;
      if (!point) {
        client.sendPresence(base);
        lastSent = now;
        return;
      }
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      if (width <= 0 || height <= 0) {
        return;
      }
      const lineIndex = runtime.timeline.viewport.lineIndexAt(point.x, width, "notes");
      const line = session.chart.judgeLineList?.[lineIndex];
      client.sendPresence({
        ...base,
        lineId: line?.id,
        beat: runtime.timeline.viewport.beatAt(point.y),
        positionX: runtime.timeline.viewport.notePositionAt(point.x, lineIndex),
      });
      lastSent = now;
    };

    const onPointerMove = (event: PointerEvent) => {
      const bounds = canvas.getBoundingClientRect();
      if (bounds.width <= 0 || bounds.height <= 0) {
        return;
      }
      lastPointer = {
        x: ((event.clientX - bounds.left) * canvas.clientWidth) / bounds.width,
        y: ((event.clientY - bounds.top) * canvas.clientHeight) / bounds.height,
      };
      publish();
    };
    const onPointerLeave = () => {
      lastPointer = null;
      publish(true);
    };
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerleave", onPointerLeave);
    const unsubscribeDrawer = subscribeDrawer(() => publish(true));
    timer = window.setInterval(() => publish(true), 1000);
    publish(true);
    return () => {
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerleave", onPointerLeave);
      unsubscribeDrawer();
      if (timer !== null) {
        window.clearInterval(timer);
      }
      clientRef.current?.sendPresence({
        memberId: stateCell.get().memberId,
        area: "edit",
        updatedAt: 0,
      });
    };
  }, [runtime, stateCell]);

  /** Merges and persists settings, omitting an unset LAN port. */
  const updateSettings = (next: Partial<CollaborationSettings>) => {
    const merged = { ...settings, ...next };
    setSettings(merged);
    // An empty port means "use this launch's suggestion"; it is not a stored
    // choice, so leave it out of the preference document.
    const persisted: Record<string, unknown> = { ...merged };
    if (!merged.lanPort.trim()) {
      delete persisted.lanPort;
    }
    const raw = preferences.read(PREFERENCE_SECTIONS.collaboration, null);
    const stored =
      raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
    preferences.write(PREFERENCE_SECTIONS.collaboration, { ...stored, ...persisted });
  };

  /** Builds the profile sent with room requests, falling back to a fresh name. */
  const profile = (source: CollaborationSettings): CollaborationProfile => ({
    name: source.displayName.trim() || defaultName(),
    color: source.color,
  });

  useEffect(() => {
    if (!sessionClaimed.current) {
      return;
    }
    if (state.status === "idle" || state.status === "error") {
      sessionClaimed.current = false;
      if (isDesktop()) {
        void invoke("release_collab_session").catch(() => undefined);
      }
    }
  }, [state.status]);

  /** Starts the host bridge and opens a room with the current chart. */
  const createRoom = async (
    override?: Partial<CollaborationSettings> & {
      readonly autoApproveEditor?: boolean;
      readonly password?: string;
    },
  ) => {
    const client = clientRef.current;
    if (!client || hostBusy.current || resuming.current) {
      return;
    }
    if (!(await ensureSession())) {
      return;
    }
    roomJoinPending.current = false;
    joinedRecoveryFingerprint.current = null;
    roomDocumentAdopted.current = false;
    setJoinedRoomDocument(false);
    hostBusy.current = true;
    setStartingRoom(true);
    try {
      const mode = override?.hostMode === "lan" ? "lan" : "tunnel";
      let publicUrl = "";
      if (isDesktop()) {
        if (mode === "tunnel") {
          await invoke("stop_lan_bridge").catch(() => undefined);
          publicUrl = normalizeRoomServerUrl(await invoke<string>("start_collab_tunnel"));
        } else {
          await invoke("stop_collab_tunnel").catch(() => undefined);
          const requested = (
            override && "lanPort" in override ? (override.lanPort ?? "") : settings.lanPort
          ).trim();
          const lanPort = Number(requested || suggestedLanPort);
          publicUrl = await invoke<string>("start_lan_bridge", { port: lanPort });
        }
      } else {
        publicUrl = normalizeRoomServerUrl(settings.serverUrl);
      }
      if (!publicUrl) {
        throw new Error(t("workspace.collaboration.invalidServerUrl"));
      }
      const current = {
        ...settings,
        ...override,
        serverUrl: publicUrl,
      };
      const session = sessionRuntime.current;
      // The host stays on the local authoritative server; only invitees cross
      // the Tunnel or LAN bridge. This avoids waiting for public DNS first.
      client.connect(current.serverUrl, {
        socketUrl: isDesktop() ? DEFAULT_SETTINGS.serverUrl : current.serverUrl,
      });
      client.createRoom(
        profile(current),
        structuredClone(session.chart),
        session.history.fingerprint(),
        {
          autoApproveEditor: override?.autoApproveEditor === true,
          password: override?.password,
        },
      );
      applied.current.clear();
      appliedRevision.current = 0;
      uploading.current.clear();
      setRecovery(null);
      setUnsent([]);
      setPendingAssets([]);
      collaborationPendingAssets.set([]);
    } catch (error) {
      if (isDesktop()) {
        void invoke("stop_collab_tunnel").catch(() => undefined);
        void invoke("stop_lan_bridge").catch(() => undefined);
        sessionClaimed.current = false;
        void invoke("release_collab_session").catch(() => undefined);
      }
      setStartingRoom(false);
      showToast(
        t("workspace.collaboration.hostFailed", {
          detail: error instanceof Error ? error.message : String(error),
        }),
        "error",
      );
    } finally {
      hostBusy.current = false;
    }
  };

  /** Joins a room from an invite link or explicit server and password. */
  const joinRoom = async (
    input: string | { serverUrl: string; invite: string; roomId?: string },
    override?: Partial<CollaborationSettings>,
  ) => {
    const client = clientRef.current;
    if (!client || resuming.current) {
      return;
    }
    const parsed =
      typeof input === "string"
        ? parseRoomInviteLink(input)
        : {
            serverUrl: normalizeRoomServerUrl(input.serverUrl),
            invite: input.invite.trim(),
            ...(input.roomId?.trim() ? { roomId: input.roomId.trim() } : {}),
          };
    if (!parsed || !parsed.serverUrl || !parsed.invite) {
      showToast(
        t(
          typeof input === "string"
            ? "workspace.collaboration.invalidInviteLink"
            : "workspace.collaboration.invalidRoomDetails",
        ),
        "error",
      );
      return;
    }
    let recoverySnapshot: Chart | null = null;
    if (sessionRuntime.current.history.dirty) {
      const confirmed = await requestConfirm({
        title: t("workspace.collaboration.replaceDirtyTitle"),
        description: t("workspace.collaboration.replaceDirtyBody"),
        label: t("workspace.collaboration.continue"),
        destructive: true,
      });
      if (!confirmed) {
        return;
      }
      recoverySnapshot = structuredClone(sessionRuntime.current.chart);
    }
    if (!(await ensureSession())) {
      return;
    }
    setJoiningRoom(true);
    writeHostSession(null);
    // The room chart replaces this document; guard saves before the snapshot
    // arrives, then persist the local edits so closing the app cannot lose them.
    roomJoinPending.current = true;
    roomDocumentAdopted.current = false;
    setJoinedRoomDocument(true);
    if (recoverySnapshot) {
      setRecovery(recoverySnapshot);
      if (!(await writeRecovery(recoverySnapshot))) {
        // Joining would replace the only copy of these edits.
        roomJoinPending.current = false;
        joinedRecoveryFingerprint.current = null;
        setJoinedRoomDocument(false);
        setJoiningRoom(false);
        showToast(t("workspace.collaboration.recoveryWriteFailed"), "error");
        return;
      }
      // The snapshot handler can then skip a second write for the same chart.
      joinedRecoveryFingerprint.current = stableFingerprint(recoverySnapshot);
    }
    const current = { ...settings, ...override, serverUrl: parsed.serverUrl };
    client.connect(current.serverUrl);
    client.join(parsed.roomId ?? "", parsed.invite, profile(current));
    applied.current.clear();
    appliedRevision.current = 0;
    uploading.current.clear();
    setUnsent([]);
    setPendingAssets([]);
    collaborationPendingAssets.set([]);
    openPane("collaboration");
  };

  /** Leaves the room and releases the host bridge and session claim. */
  const leaveRoom = () => {
    clientRef.current?.leave();
    finishRoomExit();
  };

  /** Host-only room deletion; guests receive the server's close notice. */
  const closeRoom = () => {
    if (stateCell.get().role !== "host") {
      return;
    }
    clientRef.current?.closeRoom();
    finishRoomExit();
  };

  /** Updates the room password without dropping the current session. */
  const updateRoomPassword = (password: string) => {
    clientRef.current?.setPassword(password);
  };

  /** Resend one rejected batch; the server still decides through per-path CAS. */
  const retryUnsent = async (transactionId: string) => {
    const client = clientRef.current;
    const item = unsent.find((candidate) => candidate.transactionId === transactionId);
    if (!client || !item) {
      return;
    }
    const lockIds = item.lockIds ?? [];
    const connected = client.state.get().status === "connected";
    if (connected && !(await client.acquireLocks(lockIds))) {
      showToast(t("workspace.collaboration.lockDeniedRetry"), "warning");
      return;
    }
    setUnsent((current) =>
      current.filter((candidate) => candidate.transactionId !== transactionId),
    );
    client.sendTransaction(
      {
        label: item.label,
        changes: item.changes,
        affectedObjectIds: item.affectedObjectIds,
        transactionId: item.transactionId,
        ...(item.undoOf ? { undoOf: item.undoOf } : {}),
        ...(lockIds.length ? { lockIds } : {}),
      },
      { locksHeld: connected },
    );
  };

  /** Reapply a rejected difference onto the current room chart, overwriting conflicts. */
  const rebaseUnsent = (transactionId: string) => {
    const session = sessionRuntime.current;
    const item = unsent.find((candidate) => candidate.transactionId === transactionId);
    if (!item || session.readOnly) {
      return;
    }
    const applied = applyChartChanges(session.chart, item.changes, { force: true });
    try {
      assertChart(applied.chart);
    } catch (error) {
      showToast(
        t("workspace.collaboration.invalidRemoteChange", {
          detail: error instanceof Error ? error.message : String(error),
        }),
        "error",
      );
      return;
    }
    const chart = normalizeChartObjectIds(applied.chart);
    if (
      !session.commitChart(
        t("workspace.collaboration.rebaseLabel", { label: item.label }),
        chart,
        session.selectionState(),
      )
    ) {
      showToast(t("workspace.collaboration.applyFailed"), "error");
      return;
    }
    setUnsent((current) =>
      current.filter((candidate) => candidate.transactionId !== transactionId),
    );
  };

  /** Drop a rejected batch and take the authoritative room chart instead. */
  const discardUnsent = (transactionId: string) => {
    setUnsent((current) =>
      current.filter((candidate) => candidate.transactionId !== transactionId),
    );
    clientRef.current?.requestSnapshot();
  };

  /** Reapply the retained pre-conflict chart as a new local edit. */
  const applyRecovery = () => {
    const session = sessionRuntime.current;
    if (!recovery || session.readOnly) {
      return;
    }
    // A conflict retains the copy before the authoritative snapshot arrives;
    // wait for that replacement instead of committing a no-op over local state.
    if (stableFingerprint(recovery) === stableFingerprint(session.chart)) {
      return;
    }
    try {
      assertChart(recovery);
    } catch {
      showToast(t("workspace.collaboration.invalidRemoteChange", { detail: "" }), "error");
      return;
    }
    if (
      session.commitChart(
        t("workspace.collaboration.reapplyMine"),
        normalizeChartObjectIds(recovery),
        session.selectionState(),
      )
    ) {
      setRecovery(null);
    }
  };

  /** Copies the room's invite link and reports the outcome. */
  const copyInvite = async () => {
    const current = stateCell.get();
    if (!current.roomId || !current.invite || !current.serverUrl) {
      return;
    }
    const link = buildRoomInviteLink({
      serverUrl: current.serverUrl,
      invite: current.invite,
      roomId: current.roomId,
    });
    try {
      await navigator.clipboard.writeText(link);
      showToast(t("workspace.collaboration.inviteLinkCopied"), "success");
    } catch {
      showToast(t("workspace.collaboration.copyFailed"), "error");
    }
  };

  const api: CollaborationApi = {
    state,
    settings,
    recovery,
    unsent,
    pendingAssets,
    startingRoom,
    joiningRoom,
    pendingInviteLink,
    updateSettings,
    createRoom,
    joinRoom,
    leaveRoom,
    closeRoom,
    approve: (requestId, allow, role) => clientRef.current?.approve(requestId, allow, role),
    setRole: (memberId, role) => clientRef.current?.setRole(memberId, role),
    setMaxMembers: (maxMembers) => clientRef.current?.setMaxMembers(maxMembers),
    removeMember: (memberId) => clientRef.current?.removeMember(memberId),
    copyInvite,
    updateRoomPassword,
    clearRecovery: () => setRecovery(null),
    applyRecovery,
    retryUnsent,
    rebaseUnsent,
    discardUnsent,
  };

  return <CollaborationContext.Provider value={api}>{children}</CollaborationContext.Provider>;
}

/** Reads the collaboration API; throws outside the provider. */
export function useCollaboration(): CollaborationApi {
  const value = useContext(CollaborationContext);
  if (!value) {
    throw new Error("useCollaboration must be used inside CollaborationProvider");
  }
  return value;
}

/** Exposed for cursors and member rows without reimplementing colour selection. */
export function memberColor(member: Pick<RoomMember, "profile">): string {
  return member.profile.color;
}
