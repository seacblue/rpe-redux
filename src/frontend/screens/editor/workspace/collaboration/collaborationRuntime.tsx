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
import { serverOrigin } from "../../../../../core/global/library/client.ts";
import { getDrawerState, subscribeDrawer } from "../../../../chrome/drawer/drawerPanes.ts";
import { getWorkspaceModeState } from "../container/workspaceModes.ts";
import { preferences, PREFERENCE_SECTIONS } from "../../../../../core/state/preferences.ts";
import {
  CollaborationClient,
  type AssetTransferProgress,
  type CommittedMessage,
  type TransactionInput,
} from "../../../../../core/collaboration/client.ts";
import {
  collaborationAssetRevision,
  collaborationPendingAssets,
  collaborationPreparing,
  collaborationRoom,
  collaborationRoomDocument,
  EMPTY_COLLABORATION_STATE,
  roomExitClosesRoom,
} from "../../../../../core/collaboration/ui.ts";
import {
  collaborationProgress,
  EMPTY_COLLABORATION_PROGRESS,
  guestProgressReady,
  markAssetDone,
  markAssetError,
  markPresentAssetsDone,
  requiredRoomAssetRows,
  startRoomProgress,
  withAssetProgress,
} from "../../../../../core/collaboration/progress.ts";
import { openPane } from "../../inspector/controller.ts";
import { eventListAt, parseEventKey } from "../../../../../core/edit/events/eventTracks.ts";
import {
  applyChartChanges,
  diffCharts,
  parsePath,
  stableFingerprint,
  type ChartChange,
} from "../../../../../core/collaboration/changes.ts";
import { collaborationAccess } from "../../../../../core/collaboration/access.ts";
import { encodeChartJsonWire } from "../../../../../core/collaboration/chartWire.ts";
import { serializeChartJsonOffThread } from "../document/save/chartSerializeOffThread.ts";
import { canPerform, canPublishAsset } from "../../../../../core/collaboration/permissions.ts";
import {
  buildRoomInviteLink,
  buildWebRoomInviteLink,
  normalizeRoomServerUrl,
  parseRoomInviteLink,
  parseWebRoomInviteUrl,
} from "../../../../../core/collaboration/invite.ts";
import {
  chartAssetNames,
  chartChangesMayAffectAssets,
} from "../../../../../core/collaboration/assets.ts";
import { isDesktop } from "../../../../../core/platform/environment.ts";
import { getRuntimePorts } from "../../../../../core/platform/runtimePorts.ts";
import {
  getEditorRegionSnapshot,
  showsAuthoringRegion,
  subscribeToEditorRegions,
} from "../runtime/commands/viewControls.ts";
import { BUILD_APP_VERSION } from "../../../../../core/platform/buildInfo.ts";
import { changeLockKeys } from "../../../../../core/collaboration/changes.ts";
import { randomToken, sha256Hex } from "../../../../../core/collaboration/digest.ts";
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
import { takePendingDesktopInvite } from "../../../../platform/desktopDeepLink.ts";
import { inspectRoomInvite } from "./roomInvitePreview.ts";
import { requestRoomInviteConfirmation } from "./roomInvitePrompt.tsx";
import { bindCollaborationRoomExit } from "./roomExit.ts";
import {
  clearRoomSessions,
  readRoomSession,
  sameRoomSession,
  updateRoomSession,
  type StoredRoomSession,
  type StoredSessionRole,
} from "./sessionStore.ts";

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

/** The loopback room endpoint owned by this desktop process. */
function localRoomServerUrl(): string {
  return `ws://127.0.0.1:${getRuntimePorts().collabPort}`;
}

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

type StoredHostSession = StoredRoomSession;

/** Read one resumable role from the collaboration preference section. */
function readStoredSession(role: StoredSessionRole): StoredRoomSession | null {
  return readRoomSession(preferences.read(PREFERENCE_SECTIONS.collaboration, null), role);
}

/** Persist or clear one role without disturbing the visible settings. */
function writeStoredSession(role: StoredSessionRole, session: StoredRoomSession | null): void {
  preferences.write(
    PREFERENCE_SECTIONS.collaboration,
    updateRoomSession(preferences.read(PREFERENCE_SECTIONS.collaboration, null), role, session),
  );
}

/** Read the last host session, ignoring a truncated or user-edited record. */
function readHostSession(): StoredRoomSession | null {
  return readStoredSession("host");
}

/** Read the last joined guest session, ignoring a truncated record. */
function readGuestSession(): StoredRoomSession | null {
  return readStoredSession("guest");
}

/** Persist or clear the host session. */
function writeHostSession(session: StoredRoomSession | null): void {
  writeStoredSession("host", session);
}

/** Persist or clear the guest session. */
function writeGuestSession(session: StoredRoomSession | null): void {
  writeStoredSession("guest", session);
}

/** Forget both resumable roles after an explicit exit or a terminal rejection. */
function clearStoredSessions(): void {
  preferences.write(
    PREFERENCE_SECTIONS.collaboration,
    clearRoomSessions(preferences.read(PREFERENCE_SECTIONS.collaboration, null)),
  );
}

/** Localized names for the three room roles used by runtime notices. */
const ROLE_MESSAGE_KEYS = {
  host: "workspace.collaboration.role.host",
  editor: "workspace.collaboration.role.editor",
  viewer: "workspace.collaboration.role.viewer",
} as const;

/** Localized role label for runtime notices. */
function collaborationRoleLabel(role: CollaborationRole): string {
  return t(ROLE_MESSAGE_KEYS[role]);
}

/** How long a presence sample keeps another member's selection visible. */
const REMOTE_SELECTION_TTL_MS = 5000;

/** One field of fresh remote presence, excluding the local user. */
function remoteSelectionIds(
  presence: readonly MemberPresence[],
  memberId: string,
  now: number,
  select: (entry: MemberPresence) => readonly string[] | undefined,
): Set<string> {
  const ids = new Set<string>();
  for (const entry of presence) {
    if (entry.memberId === memberId || entry.area !== "edit") {
      continue;
    }
    if (now - entry.updatedAt > REMOTE_SELECTION_TTL_MS) {
      continue;
    }
    for (const id of select(entry) ?? []) {
      ids.add(id);
    }
  }
  return ids;
}

/** Union of note ids selected by fresh remote members. */
function remoteSelectedNoteIds(
  presence: readonly MemberPresence[],
  memberId: string,
  now: number,
): Set<string> {
  return remoteSelectionIds(presence, memberId, now, (entry) => entry.selectedNoteIds);
}

/** Union of event ids selected by fresh remote members. */
function remoteSelectedEventIds(
  presence: readonly MemberPresence[],
  memberId: string,
  now: number,
): Set<string> {
  return remoteSelectionIds(presence, memberId, now, (entry) => entry.selectedEventIds);
}

/** Stable ids of the local event selection across every visible event panel. */
function selectedEventIds(session: EditorSession): string[] {
  const keysByLine = new Map<number, Set<string>>();
  if (session.eventSelection.size) {
    keysByLine.set(session.lineIndex, new Set(session.eventSelection));
  }
  for (const [lineIndex, keys] of session.multiEventSelection ?? []) {
    if (!keys.size) {
      continue;
    }
    const bucket = keysByLine.get(lineIndex) ?? new Set<string>();
    for (const key of keys) {
      bucket.add(key);
    }
    keysByLine.set(lineIndex, bucket);
  }
  const ids: string[] = [];
  for (const [lineIndex, keys] of keysByLine) {
    for (const key of keys) {
      const parsed = parseEventKey(key);
      if (!parsed) {
        continue;
      }
      const event = eventListAt(session, lineIndex, parsed.type, session.eventLayer)[parsed.index];
      if (event?.id) {
        ids.push(event.id);
      }
      if (ids.length >= 128) {
        return ids;
      }
    }
  }
  return ids;
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
  /** Whether the editor has a document that can become the room chart. */
  readonly canHost: boolean;
  updateSettings(next: Partial<CollaborationSettings>): void;
  /** Stop an in-flight create/join, cancel transfers, and clear their buffers. */
  abortRoomProgress(): void;
  /** Hide a completed progress dialog without disturbing the room. */
  dismissRoomProgress(): void;
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

/**
 * Authored audio and background image a room must be able to share.
 *
 * RPE stores the picture in `META.background`; `META.illustration` is the
 * illustrator credit text and never names an asset.
 */
function missingRequiredRoomAssets(chart: Chart, assets: AssetMap, chartName: string): string[] {
  const meta = chart.META ?? {};
  const required = [meta.song, meta.background].filter(
    (name): name is string => typeof name === "string" && name.trim().length > 0,
  );
  return [...new Set(required)].filter((name) => !assetPath(assets, name, chartName));
}

/**
 * Materialize only the lines one remote batch addresses.
 *
 * A paged document keeps other lines as placeholders; loading the affected
 * lines first lets the shared change applier see their real objects without
 * forcing the whole chart into memory.
 */
async function ensureChangeLines(
  session: EditorSession,
  changes: readonly ChartChange[],
): Promise<void> {
  const document = session.chartDocument;
  if (!document) {
    return;
  }
  const lines = session.chart.judgeLineList ?? [];
  const indices = new Set<number>();
  for (const change of changes) {
    let tokens;
    try {
      tokens = parsePath(change.path);
    } catch {
      continue;
    }
    if (tokens[0]?.kind !== "key" || tokens[0].key !== "judgeLineList") {
      continue;
    }
    const token = tokens[1];
    if (!token) {
      await document.materializeAll();
      return;
    }
    if (token.kind === "index") {
      indices.add(token.index);
      continue;
    }
    if (token.kind === "id") {
      const index = lines.findIndex((line) => line?.id === token.id);
      if (index >= 0) {
        indices.add(index);
      }
    }
  }
  await Promise.all(
    [...indices]
      .filter((index) => !document.isLoaded(index))
      .map((index) => document.ensureLine(index)),
  );
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

/** Read one local-library blob by content hash, or null when it is absent. */
async function localLibraryAssetByHash(hash: string): Promise<Uint8Array | null> {
  try {
    const response = await fetch(`${serverOrigin()}/api/assets/${encodeURIComponent(hash)}`, {
      cache: "no-store",
    });
    if (!response.ok) {
      return null;
    }
    return new Uint8Array(await response.arrayBuffer());
  } catch {
    return null;
  }
}

/** Keep at most two resource streams active so one large asset cannot starve all others. */
const MAX_PARALLEL_ASSET_UPLOADS = 2;

/** Uploads changed chart resources the room does not have at the same hash. */
async function publishChartAssets(
  client: CollaborationClient | null,
  document: DocumentRuntime | null,
  uploading: Map<string, Promise<boolean>>,
  chart: unknown,
  allowReplace = false,
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
    // Joining or committing the chart only fills gaps; replacing a room
    // resource requires an explicit asset-library edit, so a stale local copy
    // cannot win a race against a remote replacement.
    if (existing && !allowReplace) {
      return true;
    }
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
    const expected = entry.plaintextHash ?? entry.hash;
    const bytes = await localAssetBytes(assets, name, chartName);
    if (bytes && (await sha256Hex(bytes)) === expected) {
      continue;
    }
    const libraryBytes = await localLibraryAssetByHash(expected);
    if (libraryBytes && (await sha256Hex(libraryBytes)) === expected) {
      document.adoptAsset(name, libraryBytes);
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
  assetProgress: (progress: AssetTransferProgress) => void;
  assetReady: (asset: RoomAsset, bytes: Uint8Array) => void;
  assetError: (message: string, assetName?: string) => void;
  memberLeft: (memberId: string) => void;
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
  const settingsRef = useRef(settings);
  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  /** Merge and persist settings; the ref keeps sequential callers in sync. */
  const updateSettings = (next: Partial<CollaborationSettings>) => {
    const merged = { ...settingsRef.current, ...next };
    settingsRef.current = merged;
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
  const [recovery, setRecovery] = useState<unknown | null>(null);
  const [unsent, setUnsent] = useState<readonly UnsentChange[]>([]);
  const [pendingAssets, setPendingAssets] = useState<readonly string[]>([]);
  const [startingRoom, setStartingRoom] = useState(false);
  const [joiningRoom, setJoiningRoom] = useState(false);
  const [storedSessionRevision, setStoredSessionRevision] = useState(0);
  const [pendingInviteLink, setPendingInviteLink] = useState("");
  useEffect(() => {
    collaborationPreparing.set(startingRoom || joiningRoom);
    return () => collaborationPreparing.set(false);
  }, [startingRoom, joiningRoom]);
  const uploading = useRef(new Map<string, Promise<boolean>>());
  const stateCell = collaborationRoom;
  const state = useSyncExternalStore(stateCell.subscribe, stateCell.get, stateCell.get);
  const assetRevision = useSyncExternalStore(
    collaborationAssetRevision.subscribe,
    collaborationAssetRevision.get,
    collaborationAssetRevision.get,
  );
  const publishedAssetRevision = useRef(collaborationAssetRevision.get());
  const visible = useSyncExternalStore(
    subscribeToEditorVisibility,
    getEditorVisibility,
    getEditorVisibility,
  );
  const clientRef = useRef<CollaborationClient | null>(null);
  const hostBusy = useRef(false);
  const joinBusy = useRef(false);
  const sessionClaimed = useRef(false);
  const resuming = useRef(false);
  const resumeAttempted = useRef(false);
  const roomJoinPending = useRef(false);
  const roomAttempt = useRef(0);
  const joinedRecoveryFingerprint = useRef<string | null>(null);
  const roomDocumentAdopted = useRef(false);
  const storedHostSession = useRef<StoredHostSession | null>(null);
  const storedGuestSession = useRef<StoredHostSession | null>(null);
  const guestResumeAttempted = useRef(false);
  const applied = useRef(new Set<string>());
  const appliedRevision = useRef(0);
  /** Serializes remote batches that may need to page in their target lines. */
  const remoteApply = useRef(Promise.resolve());
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
    assetProgress: () => {},
    assetReady: () => {},
    assetError: () => {},
    memberLeft: () => {},
    lockDenied: () => {},
    lockTimeout: () => {},
    transactionRejected: () => {},
  });

  // Remote presence selects notes and events as warning filters in the same
  // renderer paths as the local selection. The sets only touch the canvas; they
  // never become chart edits or history entries.
  useEffect(() => {
    const timeline = runtime?.timeline;
    if (!timeline) {
      return;
    }
    const sync = () => {
      const current = stateCell.get();
      const now = Date.now();
      timeline.setRemoteSelectedNoteIds(
        remoteSelectedNoteIds(current.presence, current.memberId, now),
      );
      timeline.setRemoteSelectedEventIds(
        remoteSelectedEventIds(current.presence, current.memberId, now),
      );
    };
    sync();
    const unsubscribe = stateCell.subscribe(sync);
    // Presence expires by age rather than by an explicit removal message.
    const timer = window.setInterval(sync, 1000);
    return () => {
      unsubscribe();
      window.clearInterval(timer);
      timeline.setRemoteSelectedNoteIds(new Set());
      timeline.setRemoteSelectedEventIds(new Set());
    };
  }, [runtime, stateCell]);

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

  /** Keep the current phase visible but stop auto-close and surface the reason. */
  const failProgress = (detail: string): void => {
    const current = collaborationProgress.get();
    if (!current.visible) {
      return;
    }
    collaborationProgress.set({ ...current, error: detail, ready: false });
  };

  /** Re-evaluate guest readiness after the chart or one asset settles. */
  const refreshGuestProgress = (): void => {
    const current = collaborationProgress.get();
    if (!current.visible || current.role !== "guest" || current.error) {
      return;
    }
    if (guestProgressReady(current)) {
      if (!current.ready || current.phase !== "ready") {
        collaborationProgress.set({ ...current, ready: true, phase: "ready" });
      }
      return;
    }
    if (current.chartReady && current.phase !== "assets") {
      collaborationProgress.set({ ...current, phase: "assets" });
    }
  };

  /** Record one verified guest asset and release the dialog when all arrived. */
  const markGuestAssetDone = (name: string): void => {
    const current = collaborationProgress.get();
    if (!current.visible || current.role !== "guest") {
      return;
    }
    collaborationProgress.set({
      ...current,
      assets: markAssetDone(current.assets, name),
    });
    refreshGuestProgress();
  };

  /** Keep a failed required asset visible so the dialog cannot auto-close. */
  const markGuestAssetError = (name: string | undefined, message: string): void => {
    const current = collaborationProgress.get();
    if (!current.visible || current.role !== "guest") {
      return;
    }
    collaborationProgress.set({
      ...current,
      ...(name ? { assets: markAssetError(current.assets, name) } : {}),
      error: message,
      ready: false,
    });
  };

  // A desktop second launch receives the invitation as a process argument; a
  // web page consumes the same invitation from its own URL.
  useEffect(() => {
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
        const identity = await requestRoomInviteConfirmation(preview, {
          name: settingsRef.current.displayName,
          color: settingsRef.current.color,
        });
        if (disposed || !identity) {
          return;
        }
        updateSettings({ displayName: identity.name, color: identity.color });
      }
      setPendingInviteLink(link);
      // The welcome page owns its own join modal; only the editor needs the
      // inspector pane opened for an invitation.
      if (!visible.atHome) {
        openPane("collaboration");
      }
    };
    if (!isDesktop()) {
      const webInvite = parseWebRoomInviteUrl(location.href);
      if (webInvite) {
        // Consume the one-shot query so a reload or a copied URL cannot reopen
        // the prompt after the invitation was already handled.
        const clean = new URL(location.href);
        for (const key of ["join", "server", "invite", "room"]) {
          clean.searchParams.delete(key);
        }
        history.replaceState(null, "", clean.toString());
        void openInvite(buildRoomInviteLink(webInvite));
      }
      return () => {
        disposed = true;
      };
    }
    const startupInvite = takePendingDesktopInvite();
    if (startupInvite) {
      void openInvite(startupInvite);
    }
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

  // The native tunnel reports resolve/start/wait/ready stages while the host
  // waits for its public URL. Only the visible host bridge step consumes them.
  useEffect(() => {
    if (!isDesktop()) {
      return;
    }
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listen<{ stage?: unknown }>("redux-collab-progress", (event) => {
      if (disposed) {
        return;
      }
      const stage = event.payload?.stage;
      const current = collaborationProgress.get();
      if (
        typeof stage !== "string" ||
        !current.visible ||
        current.role !== "host" ||
        current.phase !== "bridge"
      ) {
        return;
      }
      collaborationProgress.update({ detail: stage });
    }).then(
      (dispose) => {
        unlisten = dispose;
        if (disposed) {
          dispose();
        }
      },
      () => undefined,
    );
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

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
      onAssetProgress: (progress) => handlersRef.current.assetProgress(progress),
      onAssetReady: (asset, bytes) => handlersRef.current.assetReady(asset, bytes),
      onAssetError: (message, assetName) => handlersRef.current.assetError(message, assetName),
      onMemberLeft: (memberId) => handlersRef.current.memberLeft(memberId),
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
      const documents = runtime?.documents ?? currentDocumentStore();
      void documents?.discardDetachedRecovery();
      collaborationRoom.set(EMPTY_COLLABORATION_STATE);
      collaborationPendingAssets.set([]);
      collaborationRoomDocument.set(false);
    };
  }, [runtime, stateCell]);

  // A temporary room chart must not survive a crash or a previous run. Clear
  // the detached recovery family once the editor host is available.
  useEffect(() => {
    const documents = runtime?.documents ?? currentDocumentStore();
    void documents?.discardDetachedRecovery();
  }, [runtime]);

  // Preferences attach after the provider mounts, so the first render may not
  // see a stored room yet. Re-read the section when SQLite adopts it and when
  // the host/guest role writes a replacement token.
  useEffect(() => {
    let active = true;
    const refresh = () => {
      if (!active) {
        return;
      }
      const host = readHostSession();
      const guest = readGuestSession();
      if (
        sameRoomSession(storedHostSession.current, host) &&
        sameRoomSession(storedGuestSession.current, guest)
      ) {
        return;
      }
      storedHostSession.current = host;
      storedGuestSession.current = guest;
      setStoredSessionRevision((value) => value + 1);
    };
    const unsubscribe = preferences.subscribe(PREFERENCE_SECTIONS.collaboration, refresh);
    void preferences.ready().then(refresh, refresh);
    refresh();
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  // Resume the host's last room once a document is mounted. The room server
  // persists its members, so the token keeps the host role and authoritative
  // chart across an application restart. A stale session is cleared on the
  // terminal rejection rather than retried forever.
  useEffect(() => {
    const stored = storedHostSession.current;
    const client = clientRef.current;
    if (
      !stored ||
      !client ||
      resumeAttempted.current ||
      !visible.hasDocument ||
      stateCell.get().roomId ||
      collaborationPreparing.get()
    ) {
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
      const currentClient = clientRef.current;
      if (!resuming.current || !currentClient) {
        setStartingRoom(false);
        if (isDesktop()) {
          void invoke("stop_collab_tunnel").catch(() => undefined);
          void invoke("stop_lan_bridge").catch(() => undefined);
          sessionClaimed.current = false;
          void invoke("release_collab_session").catch(() => undefined);
        }
        return;
      }
      currentClient.resumeRoom(publicUrl, stored.roomId, stored.resumeToken, {
        socketUrl: isDesktop() ? localRoomServerUrl() : publicUrl,
      });
    })();
  }, [
    visible.hasDocument,
    sessionRuntime,
    ensureSession,
    settings.hostMode,
    settings.lanPort,
    storedSessionRevision,
    stateCell,
  ]);

  // Resume the last joined room from the welcome page. A guest has no local
  // document after a restart, so the welcome snapshot adopts the room chart and
  // its assets instead of replacing a library file.
  useEffect(() => {
    const stored = storedGuestSession.current;
    const client = clientRef.current;
    if (
      !stored ||
      !client ||
      storedHostSession.current ||
      guestResumeAttempted.current ||
      stateCell.get().roomId ||
      collaborationPreparing.get()
    ) {
      return;
    }
    guestResumeAttempted.current = true;
    void (async () => {
      if (!(await ensureSession())) {
        guestResumeAttempted.current = false;
        return;
      }
      const confirmed = await requestConfirm({
        title: t("workspace.collaboration.resumeGuestTitle"),
        description: t("workspace.collaboration.resumeGuestBody"),
        label: t("workspace.collaboration.resumeAction"),
      });
      if (!confirmed) {
        writeGuestSession(null);
        if (sessionClaimed.current) {
          sessionClaimed.current = false;
          if (isDesktop()) {
            void invoke("release_collab_session").catch(() => undefined);
          }
        }
        return;
      }
      collaborationProgress.set(startRoomProgress("guest", settings.hostMode));
      setJoiningRoom(true);
      roomJoinPending.current = true;
      roomDocumentAdopted.current = false;
      collaborationRoomDocument.set(true);
      // The provider may replace its client while the prompt is open; resume
      // on the current client instead of a disposed capture.
      clientRef.current?.resumeRoom(stored.serverUrl, stored.roomId, stored.resumeToken);
    })();
  }, [stateCell, ensureSession, settings.hostMode, storedSessionRevision]);

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
      const progress = collaborationProgress.get();
      if (next === "waiting" && progress.visible && progress.role === "guest") {
        collaborationProgress.update({ phase: "waiting", error: "" });
      }
      if ((next === "error" || next === "idle" || next === "offline") && roomJoinPending.current) {
        // A join that never produced a snapshot leaves the local document intact.
        roomJoinPending.current = false;
        joinedRecoveryFingerprint.current = null;
        collaborationRoomDocument.set(false);
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
  const requestMissing = (
    chart: unknown,
    onResolved?: (missing: readonly string[]) => void,
  ): void => {
    void requestChartAssets(clientRef.current, contextRef.current.documentRuntime, chart).then(
      (missing) => {
        setPendingAssets(missing);
        collaborationPendingAssets.set(missing);
        onResolved?.(missing);
      },
    );
  };

  /** Writes one displaced chart into the native recovery store, reporting failure. */
  const writeRecovery = async (chart: unknown): Promise<boolean> => {
    // A room chart is a temporary working copy. Keep conflict copies in the
    // panel for export, but never persist them into local recovery storage.
    if (roomDocumentAdopted.current) {
      return true;
    }
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
  const retainRecovery = (chart: unknown, chartDocument?: EditorSession["chartDocument"]): void => {
    if (chartDocument) {
      // A paged facade cannot be used as a recovery copy; persist the complete
      // chart once its remaining lines are materialized.
      void chartDocument.materializeAll().then(
        (full) => {
          setRecovery(full);
          void writeRecovery(full);
        },
        () => {
          setRecovery(chart);
          void writeRecovery(chart);
        },
      );
      return;
    }
    setRecovery(chart);
    void writeRecovery(chart);
  };

  /**
   * Replaces the joined guest's document with the room chart.
   *
   * The room chart gets a temporary title and no local file or library target.
   * It stays a room document until the guest leaves; saves are refused and any
   * recovery draft from the previous document remains owned by that document.
   */
  const adoptJoinedRoomChart = (chart: Chart): void => {
    const document = contextRef.current.documentRuntime;
    if (!document) {
      return;
    }
    const documents = contextRef.current.runtime?.documents ?? currentDocumentStore();
    collaborationRoomDocument.set(true);
    // Mark room assets that are about to download before the chart loads its
    // images. The media report can then wait for the room copy instead of
    // flashing a transient "missing asset" notice during normal joining.
    const roomAssets = clientRef.current?.state.get().assets ?? [];
    const localAssets = document.currentAssets();
    const chartName = document.currentChartName();
    const pending = chartAssetNames(chart).filter((name) => {
      if (!roomAssets.some((asset) => asset.name === name)) {
        return false;
      }
      const path = assetPath(localAssets, name, chartName);
      return !path || (!localAssets.get(path) && !localAssets.uri?.(path));
    });
    setPendingAssets(pending);
    collaborationPendingAssets.set(pending);
    const requiredAssets = requiredRoomAssetRows(chart, roomAssets);
    collaborationProgress.set({
      ...collaborationProgress.get(),
      visible: true,
      role: "guest",
      phase: "assets",
      chartReady: true,
      ready: false,
      error: "",
      assets: requiredAssets,
    });
    // A joined chart is a temporary document with no durable local identity.
    // A 32-byte random value gives it a 64-hex-character name no local chart
    // can collide with, even when the chart metadata or song name matches.
    document.adoptChart(chart, randomToken(32));
    roomDocumentAdopted.current = true;
    void requestMissing(chart, (missing) => {
      const current = collaborationProgress.get();
      if (!current.visible || current.role !== "guest" || current.error) {
        return;
      }
      collaborationProgress.set({
        ...current,
        assets: markPresentAssetsDone(current.assets, missing),
      });
      refreshGuestProgress();
    });
    // Future recovery writes belong to the pre-join draft, never the room copy.
    documents?.detachRecoveryTarget();
    if (documents?.current) {
      void documents.close().catch(() => {
        // The old path is still mounted, but the save guard stays active.
        showToast(t("workspace.collaboration.applyFailed"), "error");
      });
    }
  };

  /** Clears the local room presentation and releases host bridges. */
  const finishRoomExit = () => {
    resuming.current = false;
    roomJoinPending.current = false;
    joinedRecoveryFingerprint.current = null;
    const adopted = roomDocumentAdopted.current;
    roomDocumentAdopted.current = false;
    const documents = runtime?.documents ?? currentDocumentStore();
    collaborationRoomDocument.set(false);
    void documents?.discardDetachedRecovery();
    clearStoredSessions();
    setStartingRoom(false);
    setJoiningRoom(false);
    collaborationPreparing.set(false);
    setRecovery(null);
    setUnsent([]);
    applied.current.clear();
    appliedRevision.current = 0;
    uploading.current.clear();
    setPendingAssets([]);
    collaborationPendingAssets.set([]);
    sessionRuntime.current.setCollaborationAccess(false, false);
    // The adopted document is the guest's temporary room copy. Drop it so a
    // later local save cannot turn it into a permanent library chart.
    if (adopted) {
      contextRef.current.documentRuntime?.discardDocument();
    }
    if (isDesktop()) {
      void invoke("stop_collab_tunnel").catch(() => undefined);
      void invoke("stop_lan_bridge").catch(() => undefined);
      sessionClaimed.current = false;
      void invoke("release_collab_session").catch(() => undefined);
    }
  };

  /**
   * Ends the room for a return to the library.
   *
   * A host owns the room's lifetime, so the room closes and every member is
   * disconnected. A guest or a connection that has not completed simply leaves.
   */
  const exitRoomForLibrary = () => {
    const current = stateCell.get();
    if (roomExitClosesRoom(current)) {
      clientRef.current?.closeRoom();
    } else {
      clientRef.current?.leave();
    }
    finishRoomExit();
  };
  const exitRoomForLibraryRef = useRef(exitRoomForLibrary);
  // The provider republishes the latest closure after every render; the seam
  // itself binds once so workspace navigation can reach it before React state.
  useEffect(() => {
    exitRoomForLibraryRef.current = exitRoomForLibrary;
  });
  useEffect(
    () =>
      bindCollaborationRoomExit({
        exitForLibrary: () => exitRoomForLibraryRef.current(),
      }),
    [],
  );

  /** Abort the visible setup, stop transport, and release transfer buffers. */
  const abortRoomProgress = () => {
    if (!collaborationProgress.get().visible) {
      return;
    }
    hostBusy.current = false;
    clientRef.current?.abort();
    roomAttempt.current += 1;
    finishRoomExit();
    collaborationProgress.set(EMPTY_COLLABORATION_PROGRESS);
    showToast(t("workspace.collaboration.progress.aborted"), "info");
  };

  /** Hide a completed progress dialog without touching the live room. */
  const dismissRoomProgress = useCallback(() => {
    collaborationProgress.update({ visible: false });
  }, []);

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
        case "version_mismatch_client_newer":
          return t("workspace.collaboration.versionNewerThanHost");
        case "version_mismatch_client_older":
          return t("workspace.collaboration.versionOlderThanHost");
        case "version_mismatch_unknown":
          return t("workspace.collaboration.versionMismatch");
        case "host_must_close":
          return t("workspace.collaboration.hostMustClose");
        case "removed":
          return t("workspace.collaboration.removed");
        case "owner_rooms_full":
        case "rooms_full":
          return t("workspace.collaboration.roomLimit");
        case "room_full":
          return t("workspace.collaboration.roomFull");
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
        if (snapshot.resumeToken) {
          const stored = {
            roomId: snapshot.roomId,
            resumeToken: snapshot.resumeToken,
            serverUrl: client.state.get().serverUrl,
          };
          if (snapshot.role === "host") {
            writeHostSession(stored);
          } else {
            writeGuestSession(stored);
          }
        }
        const chart = snapshot.chart;
        const session = sessionRuntime.current;
        let parsed: Chart;
        try {
          assertChart(chart);
          parsed = normalizeChartObjectIds(chart);
        } catch (error) {
          const detail = error instanceof Error ? error.message : String(error);
          if (collaborationProgress.get().visible) {
            failProgress(
              t("workspace.collaboration.invalidSnapshot", {
                detail,
              }),
            );
          }
          showNotice(
            t("workspace.collaboration.invalidSnapshot", {
              detail,
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
          if (initial && session.history.dirty && joinedRecoveryFingerprint.current === null) {
            retainRecovery(session.chart, session.chartDocument);
          }
          joinedRecoveryFingerprint.current = null;
          roomJoinPending.current = false;
          const progress = collaborationProgress.get();
          if (progress.visible && progress.role === "guest") {
            collaborationProgress.update({ phase: "chart", error: "" });
          }
          adoptJoinedRoomChart(parsed);
          return;
        }
        if (!getEditorVisibility().hasDocument && document) {
          adoptJoinedRoomChart(parsed);
          return;
        }
        appliedRevision.current = client.state.get().revision;
        if (
          session.chartDocument &&
          snapshot.fingerprint &&
          snapshot.fingerprint === session.history.fingerprint()
        ) {
          return;
        }
        if (stableFingerprint(session.chart) === stableFingerprint(parsed)) {
          return;
        }
        if (initial && session.history.dirty && joinedRecoveryFingerprint.current === null) {
          // A reconnect snapshot is authoritative, but an unconfirmed local
          // edit still deserves a recovery copy before it is replaced.
          retainRecovery(session.chart, session.chartDocument);
        }
        if (!session.commitRemoteChart(t("workspace.collaboration.remoteSnapshot"), parsed)) {
          showNotice(t("workspace.collaboration.applyFailed"), "error");
          return;
        }
        void requestMissing(parsed);
        appliedRevision.current = client.state.get().revision;
      },
      committed: (message) => {
        remoteApply.current = remoteApply.current
          .then(async () => {
            const client = clientRef.current;
            if (!client) {
              return;
            }
            const session = sessionRuntime.current;
            await ensureChangeLines(session, message.changes);
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
              retainRecovery(session.chart, session.chartDocument);
              showNotice(t("workspace.collaboration.e2eOverwrite"), "warning");
            } else if (!encrypted && result.conflicts.length) {
              retainRecovery(session.chart, session.chartDocument);
              showNotice(t("workspace.collaboration.conflictNotice"), "error");
              client.requestSnapshot();
              return;
            }
            if (result.conflicts.length) {
              retainRecovery(session.chart, session.chartDocument);
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
              retainRecovery(session.chart, session.chartDocument);
              showNotice(t("workspace.collaboration.invalidRemoteChange"), "error");
              client.requestSnapshot();
            }
          })
          .catch(() => {
            clientRef.current?.requestSnapshot();
          });
      },
      conflict: () => {
        const client = clientRef.current;
        if (!client) {
          return;
        }
        retainRecovery(sessionRuntime.current.chart, sessionRuntime.current.chartDocument);
        showNotice(t("workspace.collaboration.conflictNotice"), "error");
        client.requestSnapshot();
      },
      role: (role, reason) => {
        const client = clientRef.current;
        if (!client) {
          return;
        }
        const current = client.state.get();
        const session = sessionRuntime.current;
        applyRole(session, current);
        if (current.roomId && client.resumeTokenValue) {
          const stored = {
            roomId: current.roomId,
            resumeToken: client.resumeTokenValue,
            serverUrl: current.serverUrl,
          };
          if (role === "host") {
            writeHostSession(stored);
          } else {
            writeGuestSession(stored);
          }
        }
        const roleLabel = collaborationRoleLabel(role);
        showToast(
          reason
            ? t("workspace.collaboration.roleChangedReason", { role: roleLabel, reason })
            : t("workspace.collaboration.roleChanged", { role: roleLabel }),
          role === "viewer" ? "warning" : "success",
        );
      },
      error: (message, code) => {
        const progress = collaborationProgress.get();
        if (progress.visible && !progress.ready) {
          failProgress(connectionErrorText(message, code));
        }
        if (code === "removed") {
          finishRoomExit();
          showNotice(connectionErrorText(message, code), "warning");
          return;
        }
        if (code === "room_closed") {
          finishRoomExit();
          showNotice(connectionErrorText(message, code), "warning");
          return;
        }
        if (
          code === "no_room" ||
          code === "bad_resume" ||
          code === "version_mismatch_client_newer" ||
          code === "version_mismatch_client_older" ||
          code === "version_mismatch_unknown" ||
          code === "room_closed" ||
          code === "bad_invite"
        ) {
          clearStoredSessions();
          if (roomJoinPending.current) {
            roomJoinPending.current = false;
            joinedRecoveryFingerprint.current = null;
            collaborationRoomDocument.set(false);
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
          retainRecovery(sessionRuntime.current.chart, sessionRuntime.current.chartDocument);
          clientRef.current?.requestSnapshot();
        }
        showNotice(connectionErrorText(message, code), "error");
      },
      assetProgress: (event) => {
        const current = collaborationProgress.get();
        if (
          !current.visible ||
          current.role !== "guest" ||
          !current.assets.some((asset) => asset.name === event.name)
        ) {
          return;
        }
        collaborationProgress.set({
          ...current,
          assets: withAssetProgress(current.assets, event),
        });
        refreshGuestProgress();
      },
      assetReady: (asset, bytes) => {
        contextRef.current.documentRuntime?.adoptAsset(asset.name, bytes);
        setPendingAssets((current) => {
          const next = current.filter((name) => name !== asset.name);
          collaborationPendingAssets.set(next);
          return next;
        });
        markGuestAssetDone(asset.name);
      },
      assetError: (message, assetName) => {
        markGuestAssetError(assetName, message);
        showNotice(message, "error");
      },
      memberLeft: (memberId) => {
        const member = clientRef.current?.state
          .get()
          .members.find((candidate) => candidate.id === memberId);
        showToast(
          t("workspace.collaboration.memberLeft", {
            name: member?.profile.name ?? t("workspace.collaboration.someone"),
          }),
          "info",
        );
      },
      lockDenied: (conflicts) => {
        const owners = lockOwners(conflicts, clientRef.current?.state.get().members ?? []);
        const objects = conflicts.map((lock) => lock.id).join(", ");
        const earliest = Math.min(...conflicts.map((lock) => lock.expiresAt));
        const seconds = Math.max(0, Math.ceil((earliest - Date.now()) / 1000));
        showNotice(
          seconds > 0
            ? t("workspace.collaboration.lockedUntil", {
                objects,
                owners: owners || t("workspace.collaboration.someone"),
                seconds,
              })
            : t("workspace.collaboration.locked", {
                objects,
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

  // Joining or reconnecting fills room asset gaps, but never overwrites an
  // existing room resource with a stale local copy.
  useEffect(() => {
    if (state.status !== "connected" || !state.roomId) {
      return;
    }
    {
      const progress = collaborationProgress.get();
      if (progress.visible && progress.role === "host" && !progress.ready) {
        collaborationProgress.update({ phase: "publishing", chartReady: true, error: "" });
      }
    }
    void publishChartAssets(
      clientRef.current,
      contextRef.current.documentRuntime,
      uploading.current,
      sessionRuntime.current.chart,
    ).then((ok) => {
      if (!ok) {
        showToast(t("workspace.collaboration.assetUploadFailed"), "error");
        const progress = collaborationProgress.get();
        if (progress.visible && progress.role === "host") {
          failProgress(t("workspace.collaboration.assetUploadFailed"));
        }
        return;
      }
      const progress = collaborationProgress.get();
      if (progress.visible && progress.role === "host" && !progress.ready) {
        collaborationProgress.set({
          ...progress,
          phase: "ready",
          chartReady: true,
          ready: true,
        });
      }
    });
  }, [sessionRuntime, state.role, state.roomId, state.status]);

  // A remote manifest change only requests missing bytes. Publishing here would
  // make one client's stale copy fight the replacement that just arrived.
  useEffect(() => {
    if (state.status !== "connected" || !state.roomId) {
      return;
    }
    void requestChartAssets(
      clientRef.current,
      contextRef.current.documentRuntime,
      sessionRuntime.current.chart,
    ).then((missing) => {
      setPendingAssets(missing);
      collaborationPendingAssets.set(missing);
    });
  }, [sessionRuntime, state.assets, state.role, state.roomId, state.status]);

  // A local asset-library edit is explicit: it may replace room bytes and is
  // pushed asynchronously so an in-progress chart edit is never blocked.
  useEffect(() => {
    const revision = collaborationAssetRevision.get();
    if (revision === publishedAssetRevision.current) {
      return;
    }
    publishedAssetRevision.current = revision;
    if (state.status !== "connected" || !state.roomId) {
      return;
    }
    const chart = sessionRuntime.current.chart;
    void publishChartAssets(
      clientRef.current,
      contextRef.current.documentRuntime,
      uploading.current,
      chart,
      true,
    ).then((ok) => {
      if (!ok) {
        showToast(t("workspace.collaboration.assetUploadFailed"), "error");
        return;
      }
      void requestChartAssets(clientRef.current, contextRef.current.documentRuntime, chart).then(
        (missing) => {
          setPendingAssets(missing);
          collaborationPendingAssets.set(missing);
        },
      );
    });
  }, [assetRevision, sessionRuntime, state.role, state.roomId, state.status]);

  // Presence sampling: pointer moves are throttled, while a low-rate timer keeps
  // the playhead and the current workspace visible even without pointer motion.
  useEffect(() => {
    if (!runtime) {
      return;
    }
    const notesCanvas = runtime.timeline.notesCanvas;
    const eventsCanvas = runtime.timeline.eventsCanvas;
    let lastSent = 0;
    let lastPointer: { area: "notes" | "events"; x: number; y: number } | null = null;
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
      const workspaceMode = getWorkspaceModeState().id;
      const activeSection = workspaceMode || (drawer.open ? drawer.pane : "");
      const timeline = showsAuthoringRegion(getEditorRegionSnapshot());
      const selectedNoteIds: string[] = [];
      for (const entry of session.selectedNoteEntries()) {
        if (entry.note.id) {
          selectedNoteIds.push(entry.note.id);
        }
        if (selectedNoteIds.length >= 128) {
          break;
        }
      }
      const selectedEventIdsHere = selectedEventIds(session);
      const base: MemberPresence = {
        memberId: roomState.memberId,
        area: "edit",
        updatedAt: now,
        playheadBeat: runtime.timeline.viewport.origin,
        timeline,
        ...(selectedNoteIds.length ? { selectedNoteIds } : {}),
        ...(selectedEventIdsHere.length ? { selectedEventIds: selectedEventIdsHere } : {}),
      };
      if (activeSection) {
        client.sendPresence({ ...base, section: activeSection });
        lastSent = now;
        return;
      }
      const point = lastPointer;
      if (!point || !timeline) {
        client.sendPresence(base);
        lastSent = now;
        return;
      }
      const canvas = point.area === "events" ? eventsCanvas : notesCanvas;
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      if (width <= 0 || height <= 0) {
        client.sendPresence(base);
        lastSent = now;
        return;
      }
      const cursorRatio = Math.min(1, Math.max(0, point.x / width));
      if (point.area === "events") {
        client.sendPresence({
          ...base,
          timelineArea: "events",
          beat: runtime.timeline.viewport.eventBeatAt(point.y, "moveX"),
          cursorRatio,
        });
        lastSent = now;
        return;
      }
      const lineIndex = runtime.timeline.viewport.lineIndexAt(point.x, width, "notes");
      const line = session.chart.judgeLineList?.[lineIndex];
      client.sendPresence({
        ...base,
        timelineArea: "notes",
        lineId: line?.id,
        beat: runtime.timeline.viewport.beatAt(point.y),
        positionX: runtime.timeline.viewport.notePositionAt(point.x, lineIndex),
        cursorRatio,
      });
      lastSent = now;
    };

    const trackPointer = (area: "notes" | "events") => (event: PointerEvent) => {
      const canvas = area === "events" ? eventsCanvas : notesCanvas;
      const bounds = canvas.getBoundingClientRect();
      if (bounds.width <= 0 || bounds.height <= 0) {
        return;
      }
      lastPointer = {
        area,
        x: ((event.clientX - bounds.left) * canvas.clientWidth) / bounds.width,
        y: ((event.clientY - bounds.top) * canvas.clientHeight) / bounds.height,
      };
      publish();
    };
    const onNotesMove = trackPointer("notes");
    const onEventsMove = trackPointer("events");
    const onPointerLeave = (event: PointerEvent) => {
      // Crossing between the two canvases keeps the last pointer until the
      // destination reports its own move.
      if (event.relatedTarget === notesCanvas || event.relatedTarget === eventsCanvas) {
        return;
      }
      lastPointer = null;
      publish(true);
    };
    notesCanvas.addEventListener("pointermove", onNotesMove);
    eventsCanvas.addEventListener("pointermove", onEventsMove);
    notesCanvas.addEventListener("pointerleave", onPointerLeave);
    eventsCanvas.addEventListener("pointerleave", onPointerLeave);
    const unsubscribeDrawer = subscribeDrawer(() => publish(true));
    const unsubscribeRegions = subscribeToEditorRegions(() => publish(true));
    timer = window.setInterval(() => publish(true), 1000);
    publish(true);
    return () => {
      notesCanvas.removeEventListener("pointermove", onNotesMove);
      eventsCanvas.removeEventListener("pointermove", onEventsMove);
      notesCanvas.removeEventListener("pointerleave", onPointerLeave);
      eventsCanvas.removeEventListener("pointerleave", onPointerLeave);
      unsubscribeDrawer();
      unsubscribeRegions();
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
    if (!getEditorVisibility().hasDocument) {
      return;
    }
    const document = contextRef.current.documentRuntime;
    const session = sessionRuntime.current;
    // A paged document serializes clean lines from its source without
    // materializing the object graph; the room still receives full JSON.
    const roomChart = session.chart;
    const missing = document
      ? missingRequiredRoomAssets(roomChart, document.currentAssets(), document.currentChartName())
      : [];
    if (missing.length) {
      showModalNotice({
        title: t("workspace.collaboration.assetsRequiredTitle"),
        description: t("workspace.collaboration.assetsRequiredBody", {
          names: missing.join(", "),
        }),
      });
      return;
    }
    hostBusy.current = true;
    if (!(await ensureSession())) {
      hostBusy.current = false;
      return;
    }
    roomJoinPending.current = false;
    joinedRecoveryFingerprint.current = null;
    roomDocumentAdopted.current = false;
    collaborationRoomDocument.set(false);
    setStartingRoom(true);
    const mode = override?.hostMode === "lan" ? "lan" : "tunnel";
    const attempt = ++roomAttempt.current;
    collaborationProgress.set(startRoomProgress("host", mode));
    try {
      let publicUrl = "";
      if (isDesktop()) {
        if (mode === "tunnel") {
          collaborationProgress.update({ phase: "bridge", detail: "resolve", error: "" });
          await invoke("stop_lan_bridge").catch(() => undefined);
          publicUrl = normalizeRoomServerUrl(await invoke<string>("start_collab_tunnel"));
          collaborationProgress.update({ detail: "ready" });
        } else {
          collaborationProgress.update({ phase: "bridge", detail: "lan", error: "" });
          await invoke("stop_collab_tunnel").catch(() => undefined);
          const requested = (
            override && "lanPort" in override ? (override.lanPort ?? "") : settings.lanPort
          ).trim();
          const lanPort = Number(requested || suggestedLanPort);
          publicUrl = await invoke<string>("start_lan_bridge", { port: lanPort });
          collaborationProgress.update({ detail: "lan" });
        }
      } else {
        publicUrl = normalizeRoomServerUrl(override?.serverUrl ?? settings.serverUrl);
      }
      if (!publicUrl) {
        throw new Error(t("workspace.collaboration.invalidServerUrl"));
      }
      if (roomAttempt.current !== attempt || !collaborationProgress.get().visible) {
        return;
      }
      collaborationProgress.update({ phase: "connecting" });
      const current = {
        ...settings,
        ...override,
        serverUrl: publicUrl,
      };
      const fingerprint = session.history.fingerprint();
      collaborationProgress.update({ phase: "preparing", detail: "compress" });
      const chartJson = await serializeChartJsonOffThread(roomChart);
      const encoded = await encodeChartJsonWire(chartJson);
      if (roomAttempt.current !== attempt || !collaborationProgress.get().visible) {
        return;
      }
      // The host stays on the local authoritative server; only invitees cross
      // the Tunnel or LAN bridge. This avoids waiting for public DNS first.
      client.connect(current.serverUrl, {
        socketUrl: isDesktop() ? localRoomServerUrl() : current.serverUrl,
      });
      client.createRoom(profile(current), encoded.chart, fingerprint, {
        chartEncoding: encoded.chartEncoding,
        autoApproveEditor: override?.autoApproveEditor === true,
        password: override?.password,
      });
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
      const detail = error instanceof Error ? error.message : String(error);
      if (attempt === roomAttempt.current && collaborationProgress.get().visible) {
        failProgress(t("workspace.collaboration.hostFailed", { detail }));
      } else {
        showToast(t("workspace.collaboration.hostFailed", { detail }), "error");
      }
    } finally {
      hostBusy.current = false;
    }
  };

  /** Joins a room from an invite link or explicit server and password. */
  const joinRoomInternal = async (
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
      const currentSession = sessionRuntime.current;
      const recoveryChart = currentSession.chartDocument
        ? await currentSession.chartDocument.materializeAll()
        : currentSession.chart;
      recoverySnapshot = structuredClone(recoveryChart);
    }
    if (!(await ensureSession())) {
      return;
    }
    const attempt = ++roomAttempt.current;
    collaborationProgress.set(startRoomProgress("guest", settings.hostMode));
    setJoiningRoom(true);
    clearStoredSessions();
    // The room chart replaces this document; guard saves before the snapshot
    // arrives, then persist the local edits so closing the app cannot lose them.
    roomJoinPending.current = true;
    roomDocumentAdopted.current = false;
    collaborationRoomDocument.set(true);
    if (recoverySnapshot) {
      setRecovery(recoverySnapshot);
      if (!(await writeRecovery(recoverySnapshot))) {
        // Joining would replace the only copy of these edits.
        roomJoinPending.current = false;
        joinedRecoveryFingerprint.current = null;
        collaborationRoomDocument.set(false);
        setJoiningRoom(false);
        showToast(t("workspace.collaboration.recoveryWriteFailed"), "error");
        failProgress(t("workspace.collaboration.recoveryWriteFailed"));
        return;
      }
      // The snapshot handler can then skip a second write for the same chart.
      joinedRecoveryFingerprint.current = stableFingerprint(recoverySnapshot);
    }
    if (roomAttempt.current !== attempt || !collaborationProgress.get().visible) {
      return;
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

  /** Serialize join attempts so a double click cannot open two sockets. */
  const joinRoom = async (
    input: string | { serverUrl: string; invite: string; roomId?: string },
    override?: Partial<CollaborationSettings>,
  ) => {
    if (joinBusy.current) {
      return;
    }
    joinBusy.current = true;
    try {
      await joinRoomInternal(input, override);
    } finally {
      joinBusy.current = false;
    }
  };

  /** Leaves the room and releases the host bridge and session claim. */
  const leaveRoom = () => {
    if (stateCell.get().role === "host") {
      showToast(t("workspace.collaboration.hostMustClose"), "warning");
      return;
    }
    clientRef.current?.leave();
    finishRoomExit();
    showToast(t("workspace.collaboration.left"), "info");
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
      // The lock-denied or lock-timeout handler explains which member and
      // object block the retry; a second generic toast would only duplicate it.
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
    if (!item || !session.editable) {
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
    if (!recovery || !session.editable) {
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
    const invite = {
      serverUrl: current.serverUrl,
      invite: current.invite,
      roomId: current.roomId,
    };
    const link = isDesktop()
      ? buildRoomInviteLink(invite)
      : buildWebRoomInviteLink(invite, document.baseURI);
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
    canHost: visible.hasDocument,
    updateSettings,
    abortRoomProgress,
    dismissRoomProgress,
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
