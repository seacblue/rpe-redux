/* eslint-disable max-lines -- the v2 schema, row mapping, and SQL operations share one worker transaction surface. */
/**
 * Browser chart-library worker.
 *
 * SQLite WASM runs in a dedicated worker because the OPFS SyncAccessHandle VFS
 * is worker-only. The worker owns one connection, applies the same v2 schema as
 * the Go sidecar, and exposes the library operations the frontend calls.
 */
import sqlite3InitModule, { type Sqlite3Static } from "@sqlite.org/sqlite-wasm";
import sqliteWasmUrl from "@sqlite.org/sqlite-wasm/sqlite3.wasm?url";
import type {
  LibraryAssetSummary,
  LibraryCommitInput,
  LibraryProjectSummary,
  LibraryRevision,
  LibraryRevisionSummary,
} from "../../../global/library/client.ts";

const DB_PATH = "/redux.db";
const POOL_DIR = "/rpe-redux-pool";
const POOL_NAME = "rpe-redux-browser";
const LIBRARY_APPLICATION_ID = 1380992338;
const LIBRARY_SCHEMA_VERSION = 2;

const BACKUP_DIR = "library-history";
const BACKUP_OBJECT_MAGIC = "RPEB";
const BACKUP_OBJECT_VERSION = 1;
const BACKUP_COMMIT_FORMAT = "rpe-redux-library-commit";
const BACKUP_TREE_FORMAT = "rpe-redux-library-tree";
const BACKUP_PROJECT_FORMAT = "rpe-redux-library-project";
const BACKUP_REVISIONS_FORMAT = "rpe-redux-library-revisions";
const BACKUP_PREFERENCES_FORMAT = "rpe-redux-library-preferences";
const BACKUP_REF_FORMAT = "rpe-redux-library-ref";
const BACKUP_PREFERENCE_POLICY = "portable-v1";
const BACKUP_SCHEMA_VERSION = 2;
const BACKUP_HEADER_BYTES = 16;
const BACKUP_KIND_ASSET = 0;
const BACKUP_KIND_CHART = 1;
const BACKUP_KIND_COMMIT = 2;
const BACKUP_KIND_PROJECT = 3;
const BACKUP_KIND_REVISIONS = 4;
const BACKUP_KIND_PREFERENCES = 5;
const BACKUP_KIND_TREE = 6;

const BACKUP_PORTABLE_SECTIONS = new Set([
  "shortcuts",
  "settings",
  "values",
  "appearance",
  "icons",
  "noteSkin",
  "language",
  "trajectory",
  "multiEdit",
  "lineSelection",
  "sampler",
  "welcome",
  "onboarding",
  "rpe",
]);

// Consent switches, host-scoped rows, and application-data references must be
// chosen again on the destination host.
const BACKUP_EXCLUDED_SETTINGS = new Set([
  "code-execution-enabled",
  "extensions-disclaimer-accepted",
  "window-display-mode",
  "window-resolution",
  "frontend-port",
  "backend-port",
  "ai-port",
  "custom-background",
  "autosave-enabled",
  "autosave-seconds",
  "autosave-limit",
  "session-restore",
  "update-auto-check",
  "update-download-policy",
  "update-prereleases",
  "update-verify",
  "help-docs",
  "open-data-folder",
  "library-backup-auto",
  "library-backup-interval-seconds",
]);

const BACKUP_POLICY = {
  auto: true,
  pollMs: 5_000,
  debounceMs: 20_000,
  maxDelayMs: 120_000,
  keepCommits: 50,
  maxCommits: 100,
};

interface BackupObjectRef {
  hash: string;
  encoding: "raw" | "gzip";
  size: number;
  storedSize?: number;
}

interface BackupAssetRef extends BackupObjectRef {
  name: string;
}

interface BackupProjectManifest {
  format: string;
  version: number;
  id: string;
  name: string;
  group: string;
  archived: boolean;
  charter: string;
  composer: string;
  level: string;
  background: string;
  song: string;
  noteCount: number;
  revision: number;
  viewState: unknown;
  assetFolders: unknown;
  createdAt: string;
  updatedAt: string;
  chart: BackupObjectRef;
  assets: BackupAssetRef[];
  revisions: BackupObjectRef;
}

interface BackupRevisionRecord {
  id: string;
  label: string;
  createdAt: string;
  size: number;
  chart: BackupObjectRef;
  assets: BackupAssetRef[];
}

interface BackupCommit {
  format: string;
  version: number;
  parent?: string;
  reason: string;
  createdAt: string;
  schemaVersion: number;
  appVersion: string;
  sourceHost: string;
  databaseId: string;
  preferencePolicy: string;
  tree: BackupObjectRef;
  preferences: BackupObjectRef;
  stats: {
    projects: number;
    assets: number;
    revisions: number;
    objects: number;
    rawBytes: number;
  };
}

interface BackupRef {
  format: string;
  version: number;
  generation: number;
  commitId: string;
  checksum: string;
  createdAt: string;
}

interface BackupSummary {
  id: string;
  parent?: string;
  reason: string;
  createdAt: string;
  stats: BackupCommit["stats"];
  sourceHost: string;
}

const PROJECT_COLUMNS = `id, name, grp, archived, charter, composer, level, background, song,
  note_count, revision, view_state, asset_folders, created_at, updated_at, size`;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS projects (
    id            TEXT PRIMARY KEY,
    name          TEXT NOT NULL,
    grp           TEXT NOT NULL DEFAULT '',
    archived      INTEGER NOT NULL DEFAULT 0,
    charter       TEXT NOT NULL DEFAULT '',
    composer      TEXT NOT NULL DEFAULT '',
    level         TEXT NOT NULL DEFAULT '',
    note_count    INTEGER NOT NULL DEFAULT 0,
    chart         TEXT NOT NULL DEFAULT '{}',
    size          INTEGER NOT NULL DEFAULT 0,
    revision      INTEGER NOT NULL DEFAULT 1,
    chart_hash    TEXT NOT NULL DEFAULT '',
    view_state    TEXT NOT NULL DEFAULT '{}',
    asset_folders TEXT NOT NULL DEFAULT '[]',
    background    TEXT NOT NULL DEFAULT '',
    song          TEXT NOT NULL DEFAULT '',
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_projects_updated_at ON projects(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_projects_archived   ON projects(archived);

CREATE TABLE IF NOT EXISTS revisions (
    id         TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    label      TEXT NOT NULL DEFAULT '',
    chart      TEXT NOT NULL DEFAULT '{}',
    size       INTEGER NOT NULL DEFAULT 0,
    chart_hash TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_revisions_project ON revisions(project_id, created_at DESC);

CREATE TABLE IF NOT EXISTS preferences (
    id         INTEGER PRIMARY KEY CHECK (id = 1),
    data       TEXT NOT NULL DEFAULT '{}',
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS library_meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS app_packages (
    kind        TEXT NOT NULL,
    id          TEXT NOT NULL,
    name        TEXT NOT NULL DEFAULT '',
    fingerprint TEXT NOT NULL DEFAULT '',
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL,
    PRIMARY KEY(kind, id)
);
CREATE INDEX IF NOT EXISTS idx_app_packages_kind ON app_packages(kind, name);

CREATE TABLE IF NOT EXISTS app_package_files (
    kind  TEXT NOT NULL,
    id    TEXT NOT NULL,
    name  TEXT NOT NULL,
    bytes BLOB NOT NULL,
    PRIMARY KEY(kind, id, name)
);

CREATE TABLE IF NOT EXISTS assets (
    hash       TEXT PRIMARY KEY,
    size       INTEGER NOT NULL,
    bytes      BLOB NOT NULL,
    created_at TEXT NOT NULL,
    staged_at  TEXT NOT NULL DEFAULT '',
    staged_by  TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS project_assets (
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    hash       TEXT NOT NULL REFERENCES assets(hash),
    updated_at TEXT NOT NULL,
    PRIMARY KEY(project_id, name)
);
CREATE INDEX IF NOT EXISTS idx_project_assets_hash ON project_assets(hash);

CREATE TABLE IF NOT EXISTS revision_assets (
    revision_id TEXT NOT NULL REFERENCES revisions(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    hash        TEXT NOT NULL REFERENCES assets(hash),
    PRIMARY KEY(revision_id, name)
);
CREATE INDEX IF NOT EXISTS idx_revision_assets_hash ON revision_assets(hash);
`;

interface Db {
  close(): void;
  exec(sql: string): unknown;
  exec(options: { sql: string; bind?: readonly unknown[] }): unknown;
  selectObject(sql: string, bind?: readonly unknown[]): Record<string, unknown> | undefined;
  selectObjects(sql: string, bind?: readonly unknown[]): Record<string, unknown>[];
  selectValue(sql: string, bind?: readonly unknown[]): unknown;
  dbVfsName(): string;
}

interface Pool {
  OpfsSAHPoolDb: new (name: string) => unknown;
  exportFile(name: string): Uint8Array;
  importDb(name: string, bytes: Uint8Array): number;
  unlink(name: string): boolean;
}

interface Request {
  id: number;
  method: string;
  params?: Record<string, unknown>;
}

/** The dedicated-worker surface this module uses without pulling in webworker lib types. */
interface WorkerScope {
  onmessage: ((event: MessageEvent<Request>) => void) | null;
  postMessage(message: unknown, transfer?: Transferable[]): void;
}

const scope = self as unknown as WorkerScope;

interface ChartMeta {
  charter: string;
  composer: string;
  level: string;
  background: string;
  song: string;
  noteCount: number;
}

class DbError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "DbError";
    this.code = code;
  }
}

let sqlite3: Sqlite3Static | null = null;
let pool: Pool | null = null;
let db: Db | null = null;

function nowString(): string {
  return new Date().toISOString();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function metaString(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return Number.isInteger(value) ? String(value) : String(value);
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  return "";
}

function metaInt(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value.trim());
    return Number.isFinite(parsed) ? Math.trunc(parsed) : 0;
  }
  return 0;
}

function extractMeta(chart: unknown): ChartMeta {
  const meta: ChartMeta = {
    charter: "",
    composer: "",
    level: "",
    background: "",
    song: "",
    noteCount: 0,
  };
  if (!isRecord(chart)) {
    return meta;
  }
  const metaObject = isRecord(chart.META) ? chart.META : {};
  const lines = Array.isArray(chart.judgeLineList) ? chart.judgeLineList : null;
  if (lines) {
    let count = 0;
    for (const line of lines) {
      if (isRecord(line) && Array.isArray(line.notes)) {
        count += line.notes.length;
      }
    }
    meta.noteCount = count;
  } else if (metaObject.numOfNotes !== undefined) {
    meta.noteCount = metaInt(metaObject.numOfNotes);
  }
  meta.charter = metaString(metaObject.charter);
  meta.composer = metaString(metaObject.composer);
  meta.level = metaString(metaObject.level);
  meta.background = metaString(metaObject.background);
  meta.song = metaString(metaObject.song);
  return meta;
}

const IMAGE_ASSET = /\.(?:png|jpe?g|webp|gif|bmp|avif)$/iu;
const AUDIO_ASSET = /\.(?:mp3|ogg|wav|m4a|flac|aac|opus|weba|webm)$/iu;

function chartBackground(meta: ChartMeta, assets: readonly { name: string }[]): string {
  if (meta.background) {
    return meta.background;
  }
  return assets.find((asset) => IMAGE_ASSET.test(asset.name))?.name ?? "";
}

function chartSong(meta: ChartMeta, assets: readonly { name: string }[]): string {
  if (meta.song) {
    return meta.song;
  }
  return assets.find((asset) => AUDIO_ASSET.test(asset.name))?.name ?? "";
}

function cleanAssetName(name: unknown): string {
  if (typeof name !== "string") {
    throw new DbError("invalid_asset_name", "asset name must be a string");
  }
  const clean = name.trim().replaceAll("\\", "/");
  if (!clean || clean.length > 512) {
    throw new DbError("invalid_asset_name", "asset name must be 1..512 characters");
  }
  if (clean.startsWith("/")) {
    throw new DbError("invalid_asset_name", "asset name must be relative");
  }
  for (const part of clean.split("/")) {
    if (!part || part === "." || part === "..") {
      throw new DbError(
        "invalid_asset_name",
        "asset name must not contain empty, . or .. segments",
      );
    }
    for (const character of part) {
      const code = character.codePointAt(0) ?? 0;
      if (code < 0x20 || code === 0x7f) {
        throw new DbError("invalid_asset_name", "asset name must not contain control characters");
      }
    }
  }
  return clean;
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sha256HexBytes(bytes: Uint8Array): Promise<string> {
  const source = new Uint8Array(bytes).buffer;
  const digest = await crypto.subtle.digest("SHA-256", source);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function requireDb(): Db {
  if (!db) {
    throw new DbError("not_ready", "the browser library is not open");
  }
  return db;
}

function summary(row: Record<string, unknown>): LibraryProjectSummary {
  const viewState = parseJson(row.view_state, undefined);
  const assetFolders = parseJson(row.asset_folders, undefined);
  return {
    id: String(row.id),
    name: String(row.name),
    group: String(row.grp ?? ""),
    archived: Number(row.archived) !== 0,
    charter: String(row.charter ?? ""),
    composer: String(row.composer ?? ""),
    level: String(row.level ?? ""),
    ...(String(row.background ?? "") ? { background: String(row.background) } : {}),
    ...(String(row.song ?? "") ? { song: String(row.song) } : {}),
    noteCount: Number(row.note_count ?? 0),
    revision: Number(row.revision ?? 1),
    createdAt: String(row.created_at ?? ""),
    updatedAt: String(row.updated_at ?? ""),
    size: Number(row.size ?? 0),
    ...(isRecord(viewState) ? { viewState } : {}),
    ...(Array.isArray(assetFolders) &&
    assetFolders.every((entry): entry is string => typeof entry === "string")
      ? { assetFolders }
      : {}),
  };
}

function parseJson(value: unknown, fallback: unknown): unknown {
  if (typeof value !== "string") {
    return fallback;
  }
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return fallback;
  }
}

function projectRow(id: string): Record<string, unknown> {
  const row = requireDb().selectObject(
    `SELECT ${PROJECT_COLUMNS}, chart FROM projects WHERE id = ?`,
    [id],
  );
  if (!row) {
    throw new DbError("not_found", "project not found");
  }
  return row;
}

function projectSummary(id: string): LibraryProjectSummary {
  return summary(projectRow(id));
}

function run(sql: string, bind?: readonly unknown[]): void {
  if (bind) {
    requireDb().exec({ sql, bind });
    return;
  }
  requireDb().exec(sql);
}

/** Add one additive column when an older library lacks it. */
function ensureColumn(table: string, name: string, ddl: string): void {
  const count = Number(
    requireDb().selectValue(`SELECT COUNT(*) FROM pragma_table_info('${table}') WHERE name = ?`, [
      name,
    ]),
  );
  if (!count) {
    run(ddl);
  }
}

/** Keep the newest pre-migration copies and remove older ones. */
async function prunePreMigrationCopies(
  directory: FileSystemDirectoryHandle,
  keep: number,
): Promise<void> {
  const names: string[] = [];
  for await (const [name] of directory.entries()) {
    if (name.startsWith("pre-migration-v") && name.endsWith(".sqlite")) {
      names.push(name);
    }
  }
  names.sort();
  for (const name of names.slice(0, Math.max(0, names.length - keep))) {
    await directory.removeEntry(name);
  }
}

/**
 * Copy a pre-v2 library to OPFS before any additive migration runs.
 *
 * The copy is a standalone SQLite file outside the database pool, so a failed
 * migration cannot damage the only rollback copy.
 */
async function copyBeforeMigration(version: number): Promise<void> {
  if (version >= LIBRARY_SCHEMA_VERSION) {
    return;
  }
  const hasProjects = Number(
    requireDb().selectValue(
      "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'projects'",
    ),
  );
  if (!hasProjects) {
    return;
  }
  if (!pool) {
    throw new DbError("not_ready", "the browser library is not open");
  }
  const stamp = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  const poolName = `/pre-migration-v${version}-${stamp}.db`;
  const fileName = `pre-migration-v${version}-${stamp}.sqlite`;
  try {
    run(`VACUUM INTO '${poolName}'`);
    const bytes = pool.exportFile(poolName);
    const root = await navigator.storage.getDirectory();
    const history = await root.getDirectoryHandle("library-history", { create: true });
    const directory = await history.getDirectoryHandle("pre-migration", { create: true });
    const file = await directory.getFileHandle(fileName, { create: true });
    const writable = await file.createWritable();
    await writable.write(new Uint8Array(bytes).buffer as ArrayBuffer);
    await writable.close();
    await prunePreMigrationCopies(directory, 3);
  } catch (error) {
    throw new DbError(
      "pre_migration_backup_failed",
      error instanceof Error ? error.message : String(error),
    );
  } finally {
    pool.unlink(poolName);
  }
}

/**
 * Create the current schema and migrate a v0/v1 browser library additively.
 *
 * The application id is the file-level ownership marker; a foreign or newer
 * database is rejected before any table is changed.
 */
async function migrateSchema(): Promise<void> {
  const application = Number(requireDb().selectValue("PRAGMA application_id")) || 0;
  if (application !== 0 && application !== LIBRARY_APPLICATION_ID) {
    throw new DbError("library_not_recognized", "the database is not an RPE Redux library");
  }
  const version = Number(requireDb().selectValue("PRAGMA user_version")) || 0;
  if (version > LIBRARY_SCHEMA_VERSION) {
    throw new DbError(
      "library_schema_too_new",
      `library schema ${version} is newer than supported ${LIBRARY_SCHEMA_VERSION}`,
    );
  }
  await copyBeforeMigration(version);
  run(SCHEMA);
  ensureColumn(
    "revisions",
    "chart_hash",
    "ALTER TABLE revisions ADD COLUMN chart_hash TEXT NOT NULL DEFAULT ''",
  );
  const now = nowString();
  run(`INSERT OR IGNORE INTO library_meta (key, value) VALUES ('database_id', ?)`, [
    crypto.randomUUID(),
  ]);
  run(`INSERT OR IGNORE INTO library_meta (key, value) VALUES ('created_at', ?)`, [now]);
  run(`INSERT OR IGNORE INTO library_meta (key, value) VALUES ('schema_origin', 'browser')`);
  run(`PRAGMA application_id = ${LIBRARY_APPLICATION_ID}`);
  run(`PRAGMA user_version = ${LIBRARY_SCHEMA_VERSION}`);
}

// --------------------------------------------------------------- backup store
// The browser uses the same object/commit/ref format as the Go service. OPFS
// holds immutable objects; the live SQLite database remains the source of truth.

let backupRoot: FileSystemDirectoryHandle | null = null;
let backupDirty = false;
let backupDirtySince = 0;
let backupLastChange = 0;
let backupRunning = false;
let backupLastError = "";
let backupTimer: ReturnType<typeof setInterval> | null = null;
let recoveryError = "";
let operationTail: Promise<unknown> = Promise.resolve();

/** Serialize worker operations, including the automatic snapshot loop. */
function runExclusive<T>(task: () => T | Promise<T>): Promise<T> {
  const next = operationTail.then(task, task);
  operationTail = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

async function getBackupRoot(): Promise<FileSystemDirectoryHandle> {
  if (backupRoot) {
    return backupRoot;
  }
  const root = await navigator.storage.getDirectory();
  const history = await root.getDirectoryHandle(BACKUP_DIR, { create: true });
  await history.getDirectoryHandle("objects", { create: true });
  await history.getDirectoryHandle("commits", { create: true });
  await history.getDirectoryHandle("refs", { create: true });
  backupRoot = history;
  return history;
}

async function backupDirectory(name: string, create = true): Promise<FileSystemDirectoryHandle> {
  const history = await getBackupRoot();
  return history.getDirectoryHandle(name, { create });
}

async function writeBackupFile(directory: string, name: string, bytes: Uint8Array): Promise<void> {
  const dir = await backupDirectory(directory);
  const file = await dir.getFileHandle(name, { create: true });
  const writable = await file.createWritable();
  await writable.write(new Uint8Array(bytes).buffer as ArrayBuffer);
  await writable.close();
}

async function writeBackupRootFile(name: string, bytes: Uint8Array): Promise<void> {
  const root = await getBackupRoot();
  const file = await root.getFileHandle(name, { create: true });
  const writable = await file.createWritable();
  await writable.write(new Uint8Array(bytes).buffer as ArrayBuffer);
  await writable.close();
}

async function deleteBackupRootFile(name: string): Promise<void> {
  try {
    const root = await getBackupRoot();
    await root.removeEntry(name);
  } catch {
    /* absent */
  }
}

async function backupDirtyExists(): Promise<boolean> {
  try {
    const root = await getBackupRoot();
    await root.getFileHandle("dirty.json");
    return true;
  } catch {
    return false;
  }
}

async function readBackupFile(directory: string, name: string): Promise<Uint8Array> {
  const dir = await backupDirectory(directory);
  const file = await (await dir.getFileHandle(name)).getFile();
  return new Uint8Array(await file.arrayBuffer());
}

async function listBackupFiles(directory: string): Promise<string[]> {
  const dir = await backupDirectory(directory);
  const names: string[] = [];
  for await (const [name] of dir.entries()) {
    names.push(name);
  }
  names.sort();
  return names;
}

async function deleteBackupFile(directory: string, name: string): Promise<void> {
  try {
    const dir = await backupDirectory(directory);
    await dir.removeEntry(name);
  } catch {
    /* absent */
  }
}

async function gzipBackupBytes(bytes: Uint8Array): Promise<Uint8Array | null> {
  if (typeof CompressionStream === "undefined") {
    return null;
  }
  try {
    const stream = new Blob([new Uint8Array(bytes).buffer as ArrayBuffer])
      .stream()
      .pipeThrough(new CompressionStream("gzip"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch {
    return null;
  }
}

async function gunzipBackupBytes(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([new Uint8Array(bytes).buffer as ArrayBuffer])
    .stream()
    .pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function backupObjectDirectory(kind: number): string {
  return kind === BACKUP_KIND_COMMIT ? "commits" : "objects";
}

function encodeBackupHeader(kind: number, encoding: 0 | 1, rawSize: number): Uint8Array {
  const header = new Uint8Array(BACKUP_HEADER_BYTES);
  header.set([0x52, 0x50, 0x45, 0x42], 0);
  header[4] = BACKUP_OBJECT_VERSION;
  header[5] = encoding;
  header[6] = kind;
  new DataView(header.buffer).setBigUint64(8, BigInt(rawSize));
  return header;
}

function decodeBackupHeader(bytes: Uint8Array): {
  encoding: "raw" | "gzip";
  kind: number;
  rawSize: number;
} {
  if (bytes.byteLength < BACKUP_HEADER_BYTES) {
    throw new DbError("backup_object_corrupt", "backup object header is truncated");
  }
  if (String.fromCharCode(...bytes.slice(0, 4)) !== BACKUP_OBJECT_MAGIC) {
    throw new DbError("backup_object_corrupt", "backup object header is invalid");
  }
  if (bytes[4] !== BACKUP_OBJECT_VERSION || (bytes[5] !== 0 && bytes[5] !== 1)) {
    throw new DbError("backup_object_corrupt", "backup object version is unsupported");
  }
  const rawSize = Number(
    new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getBigUint64(8),
  );
  return {
    encoding: bytes[5] === 1 ? "gzip" : "raw",
    kind: bytes[6],
    rawSize,
  };
}

async function backupObjectMeta(directory: string, hash: string): Promise<BackupObjectRef | null> {
  try {
    const dir = await backupDirectory(directory);
    const file = await (await dir.getFileHandle(hash)).getFile();
    if (file.size < BACKUP_HEADER_BYTES) {
      return null;
    }
    const header = new Uint8Array(await file.slice(0, BACKUP_HEADER_BYTES).arrayBuffer());
    const decoded = decodeBackupHeader(header);
    return {
      hash,
      encoding: decoded.encoding,
      size: decoded.rawSize,
      storedSize: file.size,
    };
  } catch {
    return null;
  }
}

async function writeBackupObject(kind: number, raw: Uint8Array): Promise<BackupObjectRef> {
  const hash = await sha256HexBytes(raw);
  const directory = backupObjectDirectory(kind);
  const existing = await backupObjectMeta(directory, hash);
  if (existing) {
    return existing;
  }
  const compressed = await gzipBackupBytes(raw);
  const useGzip = compressed !== null && compressed.byteLength < raw.byteLength;
  const payload = useGzip && compressed ? compressed : raw;
  const header = encodeBackupHeader(kind, useGzip ? 1 : 0, raw.byteLength);
  const object = new Uint8Array(header.byteLength + payload.byteLength);
  object.set(header, 0);
  object.set(payload, header.byteLength);
  await writeBackupFile(directory, hash, object);
  return {
    hash,
    encoding: useGzip ? "gzip" : "raw",
    size: raw.byteLength,
    storedSize: object.byteLength,
  };
}

async function readBackupObject(kind: number, ref: BackupObjectRef): Promise<Uint8Array> {
  const directory = backupObjectDirectory(kind);
  const object = await readBackupFile(directory, ref.hash);
  const header = decodeBackupHeader(object.slice(0, BACKUP_HEADER_BYTES));
  const payload = object.slice(BACKUP_HEADER_BYTES);
  const raw = header.encoding === "gzip" ? await gunzipBackupBytes(payload) : payload;
  if (raw.byteLength !== header.rawSize || raw.byteLength !== ref.size) {
    throw new DbError("backup_object_corrupt", `backup object ${ref.hash} has the wrong size`);
  }
  if ((await sha256HexBytes(raw)) !== ref.hash) {
    throw new DbError("backup_object_corrupt", `backup object ${ref.hash} failed its hash`);
  }
  return raw;
}

async function writeBackupJSON(kind: number, value: unknown): Promise<BackupObjectRef> {
  const raw = new TextEncoder().encode(JSON.stringify(value));
  return writeBackupObject(kind, raw);
}

function backupExcludedPreferenceKey(key: string): boolean {
  return (
    BACKUP_EXCLUDED_SETTINGS.has(key) || key.startsWith("extension.") || key.startsWith("mod.")
  );
}

function backupPortablePreferences(raw: unknown): Record<string, unknown> {
  const document = isRecord(raw) ? raw : {};
  const sections: Record<string, unknown> = {};
  for (const section of BACKUP_PORTABLE_SECTIONS) {
    const value = document[section];
    if (value === undefined) {
      continue;
    }
    if (section === "settings" || section === "values") {
      const map = isRecord(value) ? value : {};
      const filtered: Record<string, unknown> = {};
      for (const [key, entry] of Object.entries(map)) {
        if (!backupExcludedPreferenceKey(key)) {
          filtered[key] = entry;
        }
      }
      sections[section] = filtered;
    } else {
      sections[section] = value;
    }
  }
  return {
    format: BACKUP_PREFERENCES_FORMAT,
    version: 1,
    policy: BACKUP_PREFERENCE_POLICY,
    sections,
  };
}

function backupMergePreferences(current: unknown, snapshot: unknown): Record<string, unknown> {
  const host = isRecord(current) ? { ...current } : {};
  const portable = isRecord(snapshot) ? snapshot : {};
  const sections = isRecord(portable.sections) ? portable.sections : {};
  for (const [section, value] of Object.entries(sections)) {
    if (!BACKUP_PORTABLE_SECTIONS.has(section)) {
      continue;
    }
    if (section === "settings" || section === "values") {
      const existing = isRecord(host[section])
        ? { ...(host[section] as Record<string, unknown>) }
        : {};
      const incoming = isRecord(value) ? value : {};
      for (const [key, entry] of Object.entries(incoming)) {
        if (!backupExcludedPreferenceKey(key)) {
          existing[key] = entry;
        }
      }
      host[section] = existing;
    } else {
      host[section] = value;
    }
  }
  return host;
}

async function backupRefChecksum(
  generation: number,
  commitId: string,
  createdAt: string,
): Promise<string> {
  return sha256Hex(`${BACKUP_REF_FORMAT}\n1\n${generation}\n${commitId}\n${createdAt}`);
}

async function writeBackupRef(commitId: string): Promise<BackupRef> {
  const refs = await readBackupRefs();
  const generation = refs.reduce((max, ref) => Math.max(max, ref.generation), 0) + 1;
  const createdAt = new Date().toISOString();
  const ref: BackupRef = {
    format: BACKUP_REF_FORMAT,
    version: 1,
    generation,
    commitId,
    checksum: await backupRefChecksum(generation, commitId, createdAt),
    createdAt,
  };
  await writeBackupFile(
    "refs",
    `${String(generation).padStart(12, "0")}.json`,
    new TextEncoder().encode(JSON.stringify(ref)),
  );
  return ref;
}

async function readBackupRefs(): Promise<BackupRef[]> {
  const names = await listBackupFiles("refs");
  const refs: BackupRef[] = [];
  for (const name of names) {
    if (!name.endsWith(".json")) {
      continue;
    }
    try {
      const parsed = JSON.parse(
        new TextDecoder().decode(await readBackupFile("refs", name)),
      ) as BackupRef;
      if (parsed?.format === BACKUP_REF_FORMAT && parsed.version === 1) {
        refs.push(parsed);
      }
    } catch {
      /* partial or foreign ref */
    }
  }
  return refs;
}

async function readBackupCommit(commitId: string): Promise<BackupCommit> {
  if (!/^[0-9a-f]{64}$/u.test(commitId)) {
    throw new DbError("backup_commit_missing", `invalid commit id ${commitId}`);
  }
  const object = await readBackupFile("commits", commitId);
  const header = decodeBackupHeader(object.slice(0, BACKUP_HEADER_BYTES));
  const payload = object.slice(BACKUP_HEADER_BYTES);
  const raw = header.encoding === "gzip" ? await gunzipBackupBytes(payload) : payload;
  if (raw.byteLength !== header.rawSize || (await sha256HexBytes(raw)) !== commitId) {
    throw new DbError("backup_commit_corrupt", `commit ${commitId} failed its hash`);
  }
  const commit = JSON.parse(new TextDecoder().decode(raw)) as BackupCommit;
  if (commit.format !== BACKUP_COMMIT_FORMAT || commit.version > 1) {
    throw new DbError("backup_commit_corrupt", `commit ${commitId} has an unsupported format`);
  }
  return commit;
}

async function backupHead(): Promise<{ id: string; commit: BackupCommit } | null> {
  const refs = await readBackupRefs();
  refs.sort((left, right) => right.generation - left.generation);
  for (const ref of refs) {
    if (ref.format !== BACKUP_REF_FORMAT || ref.version !== 1) {
      continue;
    }
    if ((await backupRefChecksum(ref.generation, ref.commitId, ref.createdAt)) !== ref.checksum) {
      continue;
    }
    try {
      return { id: ref.commitId, commit: await readBackupCommit(ref.commitId) };
    } catch {
      continue;
    }
  }
  return null;
}

function backupSummary(id: string, commit: BackupCommit): BackupSummary {
  return {
    id,
    ...(commit.parent ? { parent: commit.parent } : {}),
    reason: commit.reason,
    createdAt: commit.createdAt,
    stats: commit.stats,
    sourceHost: commit.sourceHost,
  };
}

async function backupChartRef(
  hash: unknown,
  table: "projects" | "revisions",
  id: string,
): Promise<BackupObjectRef> {
  if (typeof hash === "string" && /^[0-9a-f]{64}$/u.test(hash)) {
    const existing = await backupObjectMeta("objects", hash);
    if (existing) {
      return existing;
    }
  }
  const row = requireDb().selectObject(`SELECT chart FROM ${table} WHERE id = ?`, [id]);
  const chart = typeof row?.chart === "string" ? row.chart : "{}";
  return writeBackupObject(BACKUP_KIND_CHART, new TextEncoder().encode(chart));
}

async function backupAssetRef(hash: string): Promise<BackupObjectRef> {
  const existing = await backupObjectMeta("objects", hash);
  if (existing) {
    return existing;
  }
  const row = requireDb().selectObject(`SELECT bytes FROM assets WHERE hash = ?`, [hash]);
  const bytes = row?.bytes;
  if (!(bytes instanceof Uint8Array)) {
    throw new DbError("backup_asset_missing", `asset ${hash} is missing from the live library`);
  }
  return writeBackupObject(BACKUP_KIND_ASSET, bytes);
}

async function markBackupDirty(): Promise<void> {
  try {
    await writeBackupRootFile(
      "dirty.json",
      new TextEncoder().encode(JSON.stringify({ changedAt: new Date().toISOString() })),
    );
  } catch (error) {
    backupLastError = error instanceof Error ? error.message : String(error);
  }
}

async function clearBackupDirty(): Promise<void> {
  await deleteBackupRootFile("dirty.json");
}

async function backupSnapshot(reason: string): Promise<BackupSummary> {
  if (!db) {
    throw new DbError("not_ready", "the browser library is not open");
  }
  const data = requireDb();
  const projectRows = data.selectObjects(`
    SELECT id, name, grp, archived, charter, composer, level, background, song,
           note_count, revision, view_state, asset_folders, created_at, updated_at,
           chart_hash
      FROM projects ORDER BY id`);
  const projectAssets = data.selectObjects(
    `SELECT project_id, name, hash FROM project_assets ORDER BY project_id, name`,
  );
  const revisionRows = data.selectObjects(`
    SELECT id, project_id, label, chart_hash, size, created_at
      FROM revisions ORDER BY project_id, created_at, id`);
  const revisionAssets = data.selectObjects(
    `SELECT revision_id, name, hash FROM revision_assets ORDER BY revision_id, name`,
  );
  const preferenceRow = data.selectObject(`SELECT data FROM preferences WHERE id = 1`);
  const databaseRow = data.selectObject(`SELECT value FROM library_meta WHERE key = 'database_id'`);

  const projectAssetMap = new Map<string, Record<string, unknown>[]>();
  for (const row of projectAssets) {
    const projectID = String(row.project_id);
    const entries = projectAssetMap.get(projectID) ?? [];
    entries.push(row);
    projectAssetMap.set(projectID, entries);
  }
  const revisionAssetMap = new Map<string, Record<string, unknown>[]>();
  for (const row of revisionAssets) {
    const revisionID = String(row.revision_id);
    const entries = revisionAssetMap.get(revisionID) ?? [];
    entries.push(row);
    revisionAssetMap.set(revisionID, entries);
  }

  const seen = new Set<string>();
  const stats = { projects: 0, assets: 0, revisions: 0, objects: 0, rawBytes: 0 };
  const add = (ref: BackupObjectRef) => {
    if (seen.has(ref.hash)) {
      return;
    }
    seen.add(ref.hash);
    stats.objects += 1;
    stats.rawBytes += ref.size;
  };

  const preferences = backupPortablePreferences(preferenceRow?.data);
  const preferencesRef = await writeBackupJSON(BACKUP_KIND_PREFERENCES, preferences);
  add(preferencesRef);

  const revisionsByProject = new Map<string, BackupRevisionRecord[]>();
  for (const row of revisionRows) {
    const revisionID = String(row.id);
    const projectID = String(row.project_id);
    const chart = await backupChartRef(row.chart_hash, "revisions", revisionID);
    add(chart);
    const assets: BackupRevisionRecord["assets"] = [];
    for (const asset of revisionAssetMap.get(revisionID) ?? []) {
      const ref = await backupAssetRef(String(asset.hash));
      add(ref);
      assets.push({
        name: String(asset.name),
        hash: ref.hash,
        encoding: ref.encoding,
        size: ref.size,
      });
    }
    const list = revisionsByProject.get(projectID) ?? [];
    list.push({
      id: revisionID,
      label: String(row.label ?? ""),
      createdAt: String(row.created_at ?? ""),
      size: Number(row.size ?? 0),
      chart,
      assets,
    });
    revisionsByProject.set(projectID, list);
    stats.revisions += 1;
  }

  const tree: {
    format: string;
    version: number;
    projects: { id: string; manifest: BackupObjectRef }[];
  } = {
    format: BACKUP_TREE_FORMAT,
    version: 1,
    projects: [],
  };
  for (const row of projectRows) {
    const projectID = String(row.id);
    const chart = await backupChartRef(row.chart_hash, "projects", projectID);
    add(chart);
    const assets: BackupAssetRef[] = [];
    for (const asset of projectAssetMap.get(projectID) ?? []) {
      const ref = await backupAssetRef(String(asset.hash));
      add(ref);
      assets.push({
        name: String(asset.name),
        hash: ref.hash,
        encoding: ref.encoding,
        size: ref.size,
      });
      stats.assets += 1;
    }
    const revisionsRef = await writeBackupJSON(BACKUP_KIND_REVISIONS, {
      format: BACKUP_REVISIONS_FORMAT,
      version: 1,
      projectId: projectID,
      revisions: revisionsByProject.get(projectID) ?? [],
    });
    add(revisionsRef);
    const manifest: BackupProjectManifest = {
      format: BACKUP_PROJECT_FORMAT,
      version: 1,
      id: projectID,
      name: String(row.name ?? ""),
      group: String(row.grp ?? ""),
      archived: Number(row.archived ?? 0) !== 0,
      charter: String(row.charter ?? ""),
      composer: String(row.composer ?? ""),
      level: String(row.level ?? ""),
      background: String(row.background ?? ""),
      song: String(row.song ?? ""),
      noteCount: Number(row.note_count ?? 0),
      revision: Number(row.revision ?? 1),
      viewState: parseJson(row.view_state, {}),
      assetFolders: parseJson(row.asset_folders, []),
      createdAt: String(row.created_at ?? ""),
      updatedAt: String(row.updated_at ?? ""),
      chart,
      assets,
      revisions: revisionsRef,
    };
    const manifestRef = await writeBackupJSON(BACKUP_KIND_PROJECT, manifest);
    add(manifestRef);
    tree.projects.push({ id: projectID, manifest: manifestRef });
  }
  tree.projects.sort((left, right) => left.id.localeCompare(right.id));
  const treeRef = await writeBackupJSON(BACKUP_KIND_TREE, tree);
  add(treeRef);

  const head = await backupHead();
  const commit: BackupCommit = {
    format: BACKUP_COMMIT_FORMAT,
    version: 1,
    ...(head ? { parent: head.id } : {}),
    reason,
    createdAt: new Date().toISOString(),
    schemaVersion: BACKUP_SCHEMA_VERSION,
    appVersion: "browser",
    sourceHost: "web",
    databaseId: typeof databaseRow?.value === "string" ? databaseRow.value : "",
    preferencePolicy: BACKUP_PREFERENCE_POLICY,
    tree: treeRef,
    preferences: preferencesRef,
    stats: { ...stats, projects: projectRows.length },
  };
  const commitRef = await writeBackupJSON(BACKUP_KIND_COMMIT, commit);
  await writeBackupRef(commitRef.hash);
  await clearBackupDirty();
  return backupSummary(commitRef.hash, commit);
}

async function backupStatus(): Promise<Record<string, unknown>> {
  const head = await backupHead();
  const objectNames = await listBackupFiles("objects");
  const commitNames = await listBackupFiles("commits");
  let bytes = 0;
  for (const [directory, names] of [
    ["objects", objectNames],
    ["commits", commitNames],
  ] as const) {
    for (const name of names) {
      try {
        const dir = await backupDirectory(directory);
        const file = await (await dir.getFileHandle(name)).getFile();
        bytes += file.size;
      } catch {
        /* deleted during scan */
      }
    }
  }
  const pageCount = db ? Number(requireDb().selectValue("PRAGMA page_count")) : 0;
  const pageSize = db ? Number(requireDb().selectValue("PRAGMA page_size")) : 0;
  return {
    enabled: true,
    head: head?.id ?? null,
    healthy: head !== null,
    commits: commitNames.length,
    objects: objectNames.length,
    bytes,
    liveBytes: pageCount * pageSize,
    lastBackupAt: head?.commit.createdAt ?? null,
    lastError: backupLastError || null,
    policy: {
      auto: BACKUP_POLICY.auto,
      pollSeconds: BACKUP_POLICY.pollMs / 1000,
      debounceSeconds: BACKUP_POLICY.debounceMs / 1000,
      maxDelaySeconds: BACKUP_POLICY.maxDelayMs / 1000,
      keepCommits: BACKUP_POLICY.keepCommits,
    },
  };
}

async function backupHistory(limit = 50): Promise<BackupSummary[]> {
  const head = await backupHead();
  if (!head) {
    return [];
  }
  const out: BackupSummary[] = [];
  let current: { id: string; commit: BackupCommit } | null = head;
  while (current && out.length < limit) {
    out.push(backupSummary(current.id, current.commit));
    if (!current.commit.parent) {
      break;
    }
    try {
      current = {
        id: current.commit.parent,
        commit: await readBackupCommit(current.commit.parent),
      };
    } catch {
      break;
    }
  }
  return out;
}

async function backupVerify(commitId = ""): Promise<Record<string, unknown>> {
  const head = commitId
    ? { id: commitId, commit: await readBackupCommit(commitId) }
    : await backupHead();
  if (!head) {
    throw new DbError("backup_commit_missing", "no backup snapshot is available");
  }
  const missing: string[] = [];
  const corrupt: string[] = [];
  let checked = 0;
  const check = async (kind: number, ref: BackupObjectRef): Promise<boolean> => {
    try {
      await readBackupObject(kind, ref);
      checked += 1;
      return true;
    } catch (error) {
      if (error instanceof DbError && error.code === "backup_object_corrupt") {
        corrupt.push(ref.hash);
      } else {
        missing.push(ref.hash);
      }
      return false;
    }
  };
  await check(BACKUP_KIND_PREFERENCES, head.commit.preferences);
  if (await check(BACKUP_KIND_TREE, head.commit.tree)) {
    const tree = JSON.parse(
      new TextDecoder().decode(await readBackupObject(BACKUP_KIND_TREE, head.commit.tree)),
    ) as { projects: { manifest: BackupObjectRef }[] };
    for (const item of tree.projects) {
      if (!(await check(BACKUP_KIND_PROJECT, item.manifest))) {
        continue;
      }
      const manifest = JSON.parse(
        new TextDecoder().decode(await readBackupObject(BACKUP_KIND_PROJECT, item.manifest)),
      ) as BackupProjectManifest;
      await check(BACKUP_KIND_CHART, manifest.chart);
      for (const asset of manifest.assets) {
        await check(BACKUP_KIND_ASSET, asset);
      }
      if (await check(BACKUP_KIND_REVISIONS, manifest.revisions)) {
        const revisions = JSON.parse(
          new TextDecoder().decode(
            await readBackupObject(BACKUP_KIND_REVISIONS, manifest.revisions),
          ),
        ) as { revisions: BackupRevisionRecord[] };
        for (const revision of revisions.revisions) {
          await check(BACKUP_KIND_CHART, revision.chart);
          for (const asset of revision.assets) {
            await check(BACKUP_KIND_ASSET, asset as BackupObjectRef);
          }
        }
      }
    }
  }
  return { checkedCommits: 1, checkedObjects: checked, missing, corrupt };
}

async function backupCompact(keep = BACKUP_POLICY.keepCommits): Promise<Record<string, unknown>> {
  const head = await backupHead();
  if (!head) {
    return { beforeCommits: 0, afterCommits: 0, deletedCommits: 0, deletedObjects: 0 };
  }
  const keepIDs = new Set<string>();
  const commits = new Map<string, BackupCommit>();
  let current: { id: string; commit: BackupCommit } | null = head;
  while (current && keepIDs.size < Math.max(1, keep)) {
    keepIDs.add(current.id);
    commits.set(current.id, current.commit);
    if (!current.commit.parent) {
      break;
    }
    try {
      current = {
        id: current.commit.parent,
        commit: await readBackupCommit(current.commit.parent),
      };
    } catch {
      break;
    }
  }
  const reachable = new Set<string>();
  for (const commit of commits.values()) {
    await collectBackupObjects(commit, reachable);
  }
  const beforeCommits = (await listBackupFiles("commits")).length;
  for (const name of await listBackupFiles("commits")) {
    if (!keepIDs.has(name)) {
      await deleteBackupFile("commits", name);
    }
  }
  let deletedObjects = 0;
  for (const name of await listBackupFiles("objects")) {
    if (!reachable.has(name)) {
      await deleteBackupFile("objects", name);
      deletedObjects += 1;
    }
  }
  for (const ref of await readBackupRefs()) {
    if (!keepIDs.has(ref.commitId)) {
      await deleteBackupFile("refs", `${String(ref.generation).padStart(12, "0")}.json`);
    }
  }
  return {
    beforeCommits,
    afterCommits: keepIDs.size,
    deletedCommits: beforeCommits - keepIDs.size,
    deletedObjects,
  };
}

async function collectBackupObjects(commit: BackupCommit, reachable: Set<string>): Promise<void> {
  const add = (ref: BackupObjectRef) => reachable.add(ref.hash);
  add(commit.preferences);
  add(commit.tree);
  const tree = JSON.parse(
    new TextDecoder().decode(await readBackupObject(BACKUP_KIND_TREE, commit.tree)),
  ) as { projects: { manifest: BackupObjectRef }[] };
  for (const item of tree.projects) {
    add(item.manifest);
    const manifest = JSON.parse(
      new TextDecoder().decode(await readBackupObject(BACKUP_KIND_PROJECT, item.manifest)),
    ) as BackupProjectManifest;
    add(manifest.chart);
    for (const asset of manifest.assets) {
      add(asset);
    }
    add(manifest.revisions);
    const revisions = JSON.parse(
      new TextDecoder().decode(await readBackupObject(BACKUP_KIND_REVISIONS, manifest.revisions)),
    ) as { revisions: BackupRevisionRecord[] };
    for (const revision of revisions.revisions) {
      add(revision.chart);
      for (const asset of revision.assets) {
        reachable.add(asset.hash);
      }
    }
  }
}

async function backupRestoreLatest(): Promise<BackupSummary> {
  const head = await backupHead();
  if (!head) {
    throw new DbError("backup_commit_missing", "no backup snapshot is available");
  }
  if (db) {
    await backupSnapshot("pre-restore");
  }
  await backupRestoreCommit(head);
  const restored = await backupSnapshot("restore");
  return restored;
}

async function backupRestore(commitId: string): Promise<BackupSummary> {
  if (!commitId) {
    return backupRestoreLatest();
  }
  const commit = await readBackupCommit(commitId);
  if (db) {
    await backupSnapshot("pre-restore");
  }
  await backupRestoreCommit({ id: commitId, commit });
  return backupSnapshot("restore");
}

async function backupRestoreCommit(target: { id: string; commit: BackupCommit }): Promise<void> {
  if (!pool) {
    throw new DbError("not_ready", "the browser library is not open");
  }
  const restoreName = `/restore-${Date.now()}.db`;
  const restoreDb = new pool.OpfsSAHPoolDb(restoreName) as unknown as Db;
  try {
    restoreDb.exec(SCHEMA);
    restoreDb.exec("PRAGMA foreign_keys = ON");
    restoreDb.exec(`PRAGMA application_id = ${LIBRARY_APPLICATION_ID}`);
    restoreDb.exec(`PRAGMA user_version = ${LIBRARY_SCHEMA_VERSION}`);
    const tree = JSON.parse(
      new TextDecoder().decode(await readBackupObject(BACKUP_KIND_TREE, target.commit.tree)),
    ) as { projects: { manifest: BackupObjectRef }[] };
    for (const item of tree.projects) {
      const manifest = JSON.parse(
        new TextDecoder().decode(await readBackupObject(BACKUP_KIND_PROJECT, item.manifest)),
      ) as BackupProjectManifest;
      const chart = new TextDecoder().decode(
        await readBackupObject(BACKUP_KIND_CHART, manifest.chart),
      );
      restoreDb.exec({
        sql: `INSERT INTO projects
          (id, name, grp, archived, charter, composer, level, note_count, chart, size,
           revision, chart_hash, view_state, asset_folders, background, song,
           created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        bind: [
          manifest.id,
          manifest.name,
          manifest.group,
          manifest.archived ? 1 : 0,
          manifest.charter,
          manifest.composer,
          manifest.level,
          manifest.noteCount,
          chart,
          chart.length,
          manifest.revision,
          manifest.chart.hash,
          JSON.stringify(manifest.viewState ?? {}),
          JSON.stringify(manifest.assetFolders ?? []),
          manifest.background,
          manifest.song,
          manifest.createdAt,
          manifest.updatedAt,
        ],
      });
      for (const asset of manifest.assets) {
        const bytes = await readBackupObject(BACKUP_KIND_ASSET, asset);
        restoreDb.exec({
          sql: `INSERT OR IGNORE INTO assets (hash, size, bytes, created_at, staged_at, staged_by)
            VALUES (?, ?, ?, ?, '', '')`,
          bind: [asset.hash, bytes.byteLength, bytes, manifest.updatedAt],
        });
        restoreDb.exec({
          sql: `INSERT INTO project_assets (project_id, name, hash, updated_at) VALUES (?, ?, ?, ?)`,
          bind: [manifest.id, asset.name, asset.hash, manifest.updatedAt],
        });
      }
      const revisions = JSON.parse(
        new TextDecoder().decode(await readBackupObject(BACKUP_KIND_REVISIONS, manifest.revisions)),
      ) as { revisions: BackupRevisionRecord[] };
      for (const revision of revisions.revisions) {
        const revisionChart = new TextDecoder().decode(
          await readBackupObject(BACKUP_KIND_CHART, revision.chart),
        );
        restoreDb.exec({
          sql: `INSERT INTO revisions (id, project_id, label, chart, size, chart_hash, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
          bind: [
            revision.id,
            manifest.id,
            revision.label,
            revisionChart,
            revisionChart.length,
            revision.chart.hash,
            revision.createdAt,
          ],
        });
        for (const asset of revision.assets) {
          const bytes = await readBackupObject(BACKUP_KIND_ASSET, asset as BackupObjectRef);
          restoreDb.exec({
            sql: `INSERT OR IGNORE INTO assets (hash, size, bytes, created_at, staged_at, staged_by)
              VALUES (?, ?, ?, ?, '', '')`,
            bind: [asset.hash, bytes.byteLength, bytes, revision.createdAt],
          });
          restoreDb.exec({
            sql: `INSERT INTO revision_assets (revision_id, name, hash) VALUES (?, ?, ?)`,
            bind: [revision.id, asset.name, asset.hash],
          });
        }
      }
    }
    const currentRow = db
      ? requireDb().selectObject(`SELECT data FROM preferences WHERE id = 1`)
      : undefined;
    // Installed packages are app-level state, not chart history. Keep the live
    // set across a library restore so rolling back a chart cannot uninstall a
    // skin or theme the user installed afterwards.
    if (db) {
      for (const entry of requireDb().selectObjects(
        `SELECT kind, id, name, fingerprint, created_at, updated_at FROM app_packages`,
      )) {
        restoreDb.exec({
          sql: `INSERT OR REPLACE INTO app_packages
            (kind, id, name, fingerprint, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)`,
          bind: [
            entry.kind,
            entry.id,
            entry.name,
            entry.fingerprint,
            entry.created_at,
            entry.updated_at,
          ],
        });
      }
      for (const entry of requireDb().selectObjects(
        `SELECT kind, id, name, bytes FROM app_package_files`,
      )) {
        restoreDb.exec({
          sql: `INSERT OR REPLACE INTO app_package_files (kind, id, name, bytes)
            VALUES (?, ?, ?, ?)`,
          bind: [entry.kind, entry.id, entry.name, entry.bytes],
        });
      }
    }
    const snapshotPreferences = JSON.parse(
      new TextDecoder().decode(
        await readBackupObject(BACKUP_KIND_PREFERENCES, target.commit.preferences),
      ),
    ) as unknown;
    const merged = backupMergePreferences(parseJson(currentRow?.data, {}), snapshotPreferences);
    restoreDb.exec({
      sql: `INSERT INTO preferences (id, data, updated_at) VALUES (1, ?, ?)
        ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
      bind: [JSON.stringify(merged), target.commit.createdAt],
    });
    restoreDb.exec({
      sql: `INSERT OR REPLACE INTO library_meta (key, value) VALUES ('database_id', ?)`,
      bind: [target.commit.databaseId],
    });
    restoreDb.exec({
      sql: `INSERT OR REPLACE INTO library_meta (key, value) VALUES ('schema_origin', 'browser')`,
    });
    restoreDb.close();
    const bytes = pool.exportFile(restoreName);
    pool.unlink(restoreName);
    await importDb({ bytes });
  } catch (error) {
    try {
      restoreDb.close();
    } catch {
      /* already closed */
    }
    pool.unlink(restoreName);
    throw error;
  }
}

/** Mark the library dirty and let the interval apply debounce and max delay. */
function notifyBackup(): void {
  if (!backupDirty) {
    backupDirtySince = Date.now();
  }
  backupDirty = true;
  backupLastChange = Date.now();
  void markBackupDirty();
}

async function maybeRunBackup(): Promise<void> {
  if (!db || !BACKUP_POLICY.auto || backupRunning || !backupDirty) {
    return;
  }
  const now = Date.now();
  const ready =
    now - backupLastChange >= BACKUP_POLICY.debounceMs ||
    now - backupDirtySince >= BACKUP_POLICY.maxDelayMs;
  if (!ready) {
    return;
  }
  backupRunning = true;
  try {
    await runExclusive(() => backupSnapshot("auto"));
    backupDirty = false;
    backupLastError = "";
    const commits = (await listBackupFiles("commits")).length;
    if (commits > BACKUP_POLICY.maxCommits) {
      await runExclusive(() => backupCompact(BACKUP_POLICY.keepCommits));
    }
  } catch (error) {
    backupLastError = error instanceof Error ? error.message : String(error);
  } finally {
    backupRunning = false;
  }
}

/**
 * Read the two settings-backed snapshot controls. Missing values keep the
 * defaults; the interval is clamped to a sane range.
 */
async function refreshBackupPolicy(startTimer = true): Promise<void> {
  if (!db) {
    return;
  }
  const row = requireDb().selectObject("SELECT data FROM preferences WHERE id = 1");
  const document = parseJson(row?.data, {});
  const settings = isRecord(document) && isRecord(document.settings) ? document.settings : {};
  const auto = settings["library-backup-auto"] !== false;
  const rawInterval = Number(settings["library-backup-interval-seconds"]);
  const interval =
    Number.isFinite(rawInterval) && rawInterval > 0
      ? Math.min(3600, Math.max(30, Math.trunc(rawInterval)))
      : 120;
  BACKUP_POLICY.auto = auto;
  BACKUP_POLICY.maxDelayMs = interval * 1000;
  BACKUP_POLICY.debounceMs = Math.min(20, interval) * 1000;
  if (!auto) {
    if (backupTimer !== null) {
      clearInterval(backupTimer);
      backupTimer = null;
    }
    return;
  }
  if (startTimer && backupTimer === null) {
    await startBackupLoop();
  }
}

async function startBackupLoop(): Promise<void> {
  if (backupTimer !== null || !db || !BACKUP_POLICY.auto) {
    return;
  }
  try {
    const head = await backupHead();
    const hasData = Number(requireDb().selectValue("SELECT COUNT(*) FROM projects")) > 0;
    const markedDirty = await backupDirtyExists();
    if (
      markedDirty ||
      (hasData && (!head || Date.now() - Date.parse(head.commit.createdAt) > 24 * 60 * 60 * 1000))
    ) {
      backupDirty = true;
      backupDirtySince = Date.now() - BACKUP_POLICY.maxDelayMs;
      backupLastChange = Date.now();
    }
    backupTimer = setInterval(() => {
      void maybeRunBackup();
    }, BACKUP_POLICY.pollMs);
  } catch (error) {
    backupTimer = null;
    throw error;
  }
}

async function init(): Promise<Record<string, unknown>> {
  const initModule = sqlite3InitModule as unknown as (options: {
    locateFile: (path: string) => string;
  }) => Promise<Sqlite3Static>;
  sqlite3 = await initModule({ locateFile: () => sqliteWasmUrl });
  pool = (await sqlite3.installOpfsSAHPoolVfs({
    name: POOL_NAME,
    directory: POOL_DIR,
    initialCapacity: 10,
  })) as unknown as Pool;
  try {
    db = new pool.OpfsSAHPoolDb(DB_PATH) as unknown as Db;
    run("PRAGMA foreign_keys = ON");
    run("PRAGMA synchronous = FULL");
    await migrateSchema();
    try {
      await refreshBackupPolicy(false);
      await startBackupLoop();
    } catch (error) {
      backupLastError = error instanceof Error ? error.message : String(error);
    }
  } catch (error) {
    // Keep the worker alive in recovery mode: the existing settings restore
    // button can replace a corrupt live database with a .sqlite file.
    try {
      db?.close();
    } catch {
      /* already closed */
    }
    db = null;
    recoveryError = error instanceof Error ? error.message : String(error);
  }
  return {
    sqliteVersion: sqlite3.version.libVersion,
    applicationId: db ? requireDb().selectValue("PRAGMA application_id") : null,
    userVersion: db ? requireDb().selectValue("PRAGMA user_version") : null,
    vfs: db ? requireDb().dbVfsName() : null,
    path: DB_PATH,
    recovery: db === null,
    error: recoveryError,
  };
}

async function list(params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const query = isRecord(params.query) ? params.query : params;
  const rows = requireDb().selectObjects(`SELECT ${PROJECT_COLUMNS} FROM projects`);
  let projects = rows.map(summary);
  const search = typeof query.search === "string" ? query.search.trim().toLowerCase() : "";
  if (search) {
    projects = projects.filter((project) =>
      [project.name, project.charter, project.composer, project.level].some((value) =>
        value.toLowerCase().includes(search),
      ),
    );
  }
  if (typeof query.group === "string" && query.group.trim()) {
    projects = projects.filter((project) => project.group === query.group);
  }
  if (query.archived === true || query.archived === "true") {
    projects = projects.filter((project) => project.archived);
  } else if (query.archived === false || query.archived === "false") {
    projects = projects.filter((project) => !project.archived);
  }
  const sort = typeof query.sort === "string" ? query.sort : "updated";
  const direction = query.direction === "asc" ? 1 : -1;
  const field =
    sort === "name"
      ? (project: LibraryProjectSummary) => project.name
      : sort === "composer"
        ? (project: LibraryProjectSummary) => project.composer
        : sort === "charter"
          ? (project: LibraryProjectSummary) => project.charter
          : sort === "created"
            ? (project: LibraryProjectSummary) => project.createdAt
            : (project: LibraryProjectSummary) => project.updatedAt;
  projects.sort((left, right) => field(left).localeCompare(field(right)) * direction);
  const total = projects.length;
  const limit = typeof query.limit === "number" && query.limit > 0 ? query.limit : 500;
  const offset = typeof query.offset === "number" && query.offset > 0 ? query.offset : 0;
  return { projects: projects.slice(offset, offset + limit), total };
}

function get(params: Record<string, unknown>): Record<string, unknown> {
  const id = stringParam(params, "id");
  const row = projectRow(id);
  return {
    project: {
      ...summary(row),
      chart: parseJson(row.chart, {}),
    },
  };
}

async function create(params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const name = stringParam(params, "name").trim();
  if (!name) {
    throw new DbError("invalid_request", "name must not be blank");
  }
  const group = typeof params.group === "string" ? params.group : "";
  const chartJson =
    typeof params.chartJson === "string" ? params.chartJson : JSON.stringify(params.chart ?? {});
  const chart = parseJson(chartJson, null);
  if (chart === null) {
    throw new DbError("invalid_request", "chart must be valid JSON");
  }
  const meta = extractMeta(chart);
  const id = crypto.randomUUID();
  const now = nowString();
  const hash = await sha256Hex(chartJson);
  run(
    `INSERT INTO projects
      (id, name, grp, archived, charter, composer, level, background, song, note_count, chart,
       size, revision, chart_hash, view_state, asset_folders, created_at, updated_at)
      VALUES (?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, '{}', '[]', ?, ?)`,
    [
      id,
      name,
      group,
      meta.charter,
      meta.composer,
      meta.level,
      meta.background,
      meta.song,
      meta.noteCount,
      chartJson,
      chartJson.length,
      hash,
      now,
      now,
    ],
  );
  return { project: projectSummary(id) };
}

async function update(params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const id = stringParam(params, "id");
  const patch = isRecord(params.patch) ? params.patch : {};
  projectRow(id);
  const sets: string[] = [];
  const bind: unknown[] = [];
  if (typeof patch.name === "string") {
    const name = patch.name.trim();
    if (!name) {
      throw new DbError("invalid_request", "name must not be blank");
    }
    sets.push("name = ?");
    bind.push(name);
  }
  if (typeof patch.group === "string") {
    sets.push("grp = ?");
    bind.push(patch.group);
  }
  if (typeof patch.archived === "boolean") {
    sets.push("archived = ?");
    bind.push(patch.archived ? 1 : 0);
  }
  if (patch.chart !== undefined) {
    const chartJson = JSON.stringify(patch.chart);
    const meta = extractMeta(patch.chart);
    sets.push(
      "chart = ?",
      "size = ?",
      "charter = ?",
      "composer = ?",
      "level = ?",
      "background = ?",
      "song = ?",
      "note_count = ?",
      "chart_hash = ?",
      "revision = revision + 1",
    );
    bind.push(
      chartJson,
      chartJson.length,
      meta.charter,
      meta.composer,
      meta.level,
      meta.background,
      meta.song,
      meta.noteCount,
      await sha256Hex(chartJson),
    );
  }
  if (sets.length === 0) {
    throw new DbError("invalid_request", "no fields to update");
  }
  sets.push("updated_at = ?");
  bind.push(nowString(), id);
  run(`UPDATE projects SET ${sets.join(", ")} WHERE id = ?`, bind);
  return { project: projectSummary(id) };
}

function remove(params: Record<string, unknown>): Record<string, unknown> {
  const id = stringParam(params, "id");
  projectRow(id);
  run("DELETE FROM projects WHERE id = ?", [id]);
  return { deleted: true };
}

function duplicate(params: Record<string, unknown>): Record<string, unknown> {
  const id = stringParam(params, "id");
  const name = stringParam(params, "name").trim();
  if (!name) {
    throw new DbError("invalid_request", "name must not be blank");
  }
  projectRow(id);
  const target = crypto.randomUUID();
  const now = nowString();
  run(
    `INSERT INTO projects
      (id, name, grp, archived, charter, composer, level, background, song, note_count, chart,
       size, revision, chart_hash, view_state, asset_folders, created_at, updated_at)
      SELECT ?, ?, grp, archived, charter, composer, level, background, song, note_count, chart,
             size, 1, chart_hash, view_state, asset_folders, ?, ?
        FROM projects WHERE id = ?`,
    [target, name, now, now, id],
  );
  run(
    `INSERT INTO project_assets (project_id, name, hash, updated_at)
      SELECT ?, name, hash, ? FROM project_assets WHERE project_id = ?`,
    [target, now, id],
  );
  return { project: projectSummary(target) };
}

function assets(params: Record<string, unknown>): Record<string, unknown> {
  const id = stringParam(params, "id");
  const rows = requireDb().selectObjects(
    `SELECT pa.name, a.hash, a.size
       FROM project_assets pa
       JOIN assets a ON a.hash = pa.hash
      WHERE pa.project_id = ?
      ORDER BY pa.name`,
    [id],
  );
  const manifest: LibraryAssetSummary[] = rows.map((row) => ({
    name: String(row.name),
    hash: String(row.hash),
    size: Number(row.size),
  }));
  return { assets: manifest };
}

// ------------------------------------------------------ application packages
// Web-only storage for skins, themes, and Extensions. They share the browser
// SQLite file so exports carry them; the desktop host keeps the same packages in
// external app-data folders instead of these tables.

/** Read a package kind, which is a short stable namespace such as `skin`. */
function packageKind(params: Record<string, unknown>): string {
  const kind = stringParam(params, "kind");
  if (!/^[a-z][a-z0-9_-]{0,31}$/.test(kind)) {
    throw new DbError("invalid_request", "invalid package kind");
  }
  return kind;
}

/** Read a package id, which is a non-empty opaque key. */
function packageId(params: Record<string, unknown>): string {
  const id = stringParam(params, "id").trim();
  if (!id || id.length > 200) {
    throw new DbError("invalid_request", "invalid package id");
  }
  return id;
}

/** Reject relative paths that could escape a package root. */
function packageFileName(value: unknown): string {
  if (
    typeof value !== "string" ||
    !value ||
    value.startsWith("/") ||
    value.includes("\\") ||
    value.includes("\0") ||
    value.split("/").some((part) => !part || part === "." || part === "..")
  ) {
    throw new DbError("invalid_request", "invalid package file name");
  }
  return value;
}

/** Decode one file entry and reject empty or ambiguous names. */
function packageFiles(value: unknown): Array<{ name: string; bytes: Uint8Array }> {
  if (!Array.isArray(value) || value.length === 0) {
    throw new DbError("invalid_request", "package requires files");
  }
  const names = new Set<string>();
  return value.map((entry) => {
    if (!isRecord(entry)) {
      throw new DbError("invalid_request", "package file must be an object");
    }
    const name = packageFileName(entry.name);
    if (names.has(name)) {
      throw new DbError("invalid_request", `duplicate package file: ${name}`);
    }
    names.add(name);
    const bytes =
      entry.bytes instanceof Uint8Array
        ? entry.bytes
        : entry.bytes instanceof ArrayBuffer
          ? new Uint8Array(entry.bytes)
          : null;
    if (!bytes) {
      throw new DbError("invalid_request", `package file has no bytes: ${name}`);
    }
    return { name, bytes };
  });
}

/** List installed packages of one kind. */
function packageList(params: Record<string, unknown>): Record<string, unknown> {
  const kind = packageKind(params);
  const rows = requireDb().selectObjects(
    `SELECT id, name, fingerprint, updated_at
       FROM app_packages
      WHERE kind = ?
      ORDER BY name, id`,
    [kind],
  );
  return {
    packages: rows.map((row) => ({
      id: String(row.id),
      name: String(row.name ?? ""),
      fingerprint: String(row.fingerprint ?? ""),
      updatedAt: String(row.updated_at ?? ""),
    })),
  };
}

/** Read one package and all of its file bytes. */
function packageRead(params: Record<string, unknown>): Record<string, unknown> {
  const kind = packageKind(params);
  const id = packageId(params);
  const row = requireDb().selectObject(
    `SELECT id, name, fingerprint, updated_at FROM app_packages WHERE kind = ? AND id = ?`,
    [kind, id],
  );
  if (!row) {
    throw new DbError("not_found", "package not found");
  }
  const files = requireDb().selectObjects(
    `SELECT name, bytes FROM app_package_files WHERE kind = ? AND id = ? ORDER BY name`,
    [kind, id],
  );
  return {
    package: {
      id: String(row.id),
      name: String(row.name ?? ""),
      fingerprint: String(row.fingerprint ?? ""),
      updatedAt: String(row.updated_at ?? ""),
      files: files.map((file) => ({ name: String(file.name), bytes: file.bytes })),
    },
  };
}

/** Replace one package and its file set in a single transaction. */
function packageInstall(params: Record<string, unknown>): Record<string, unknown> {
  const kind = packageKind(params);
  const id = packageId(params);
  const name = stringParam(params, "name");
  const fingerprint = stringParam(params, "fingerprint");
  const files = packageFiles(params.files);
  const now = nowString();
  run("BEGIN IMMEDIATE");
  try {
    run(
      `INSERT INTO app_packages (kind, id, name, fingerprint, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(kind, id) DO UPDATE SET
         name = excluded.name,
         fingerprint = excluded.fingerprint,
         updated_at = excluded.updated_at`,
      [kind, id, name, fingerprint, now, now],
    );
    run(`DELETE FROM app_package_files WHERE kind = ? AND id = ?`, [kind, id]);
    for (const file of files) {
      run(`INSERT INTO app_package_files (kind, id, name, bytes) VALUES (?, ?, ?, ?)`, [
        kind,
        id,
        file.name,
        file.bytes,
      ]);
    }
    run("COMMIT");
  } catch (error) {
    run("ROLLBACK");
    throw error;
  }
  return { ok: true, id };
}

/** Delete one package and every file it owns. */
function packageRemove(params: Record<string, unknown>): Record<string, unknown> {
  const kind = packageKind(params);
  const id = packageId(params);
  const row = requireDb().selectObject(`SELECT id FROM app_packages WHERE kind = ? AND id = ?`, [
    kind,
    id,
  ]);
  run("BEGIN IMMEDIATE");
  try {
    run(`DELETE FROM app_package_files WHERE kind = ? AND id = ?`, [kind, id]);
    run(`DELETE FROM app_packages WHERE kind = ? AND id = ?`, [kind, id]);
    run("COMMIT");
  } catch (error) {
    run("ROLLBACK");
    throw error;
  }
  return { removed: Boolean(row) };
}

async function stageAsset(params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const id = stringParam(params, "id");
  const name = cleanAssetName(params.name);
  const bytes = bytesParam(params, "bytes");
  if (!bytes.byteLength) {
    throw new DbError("invalid_request", "asset must not be empty");
  }
  projectRow(id);
  const hash = await sha256HexBytes(bytes);
  const now = nowString();
  run(
    `INSERT OR IGNORE INTO assets (hash, size, bytes, created_at, staged_at, staged_by)
      VALUES (?, ?, ?, ?, ?, ?)`,
    [hash, bytes.byteLength, bytes, now, now, id],
  );
  run(`UPDATE assets SET staged_at = ?, staged_by = ? WHERE hash = ?`, [now, id, hash]);
  return { asset: { name, hash, size: bytes.byteLength }, staged: true };
}

function asset(params: Record<string, unknown>): Uint8Array {
  const id = stringParam(params, "id");
  const name = cleanAssetName(params.name);
  const row = requireDb().selectObject(
    `SELECT a.bytes
       FROM project_assets pa
       JOIN assets a ON a.hash = pa.hash
      WHERE pa.project_id = ? AND pa.name = ?`,
    [id, name],
  );
  if (!row || !(row.bytes instanceof Uint8Array)) {
    throw new DbError("not_found", "asset not found");
  }
  return row.bytes;
}

async function commit(params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const id = stringParam(params, "id");
  const input = params.input as LibraryCommitInput | undefined;
  if (!input || typeof input.chartJson !== "string") {
    throw new DbError("invalid_request", "commit requires chartJson");
  }
  const current = projectRow(id);
  const currentRevision = Number(current.revision ?? 1);
  if (input.baseRevision !== undefined && input.baseRevision !== currentRevision) {
    throw new DbError("revision_conflict", "the project revision changed");
  }
  const chart = parseJson(input.chartJson, null);
  if (chart === null) {
    throw new DbError("invalid_request", "chart must be valid JSON");
  }
  const meta = extractMeta(chart);
  const hash = await sha256Hex(input.chartJson);
  const nextName =
    typeof input.name === "string" && input.name.trim() ? input.name.trim() : String(current.name);
  const nextView = input.viewState ? JSON.stringify(input.viewState) : String(current.view_state);
  const nextFolders = input.assetFolders
    ? JSON.stringify(input.assetFolders)
    : String(current.asset_folders);
  const nextBackground =
    meta.background ||
    (input.assets ? chartBackground(meta, input.assets) : String(current.background ?? ""));
  const nextSong =
    meta.song || (input.assets ? chartSong(meta, input.assets) : String(current.song ?? ""));

  if (input.assets) {
    const currentManifest = assets({ id }) as { assets: LibraryAssetSummary[] };
    const changed =
      currentManifest.assets.length !== input.assets.length ||
      input.assets.some(
        (entry) =>
          !currentManifest.assets.some(
            (currentEntry) => currentEntry.name === entry.name && currentEntry.hash === entry.hash,
          ),
      );
    if (
      !changed &&
      input.chartJson === String(current.chart) &&
      nextName === String(current.name) &&
      nextView === String(current.view_state) &&
      nextFolders === String(current.asset_folders)
    ) {
      return { project: projectSummary(id) };
    }
  }

  run("BEGIN IMMEDIATE");
  try {
    if (input.assets) {
      run("DELETE FROM project_assets WHERE project_id = ?", [id]);
      for (const entry of input.assets) {
        const name = cleanAssetName(entry.name);
        const exists = requireDb().selectValue("SELECT COUNT(*) FROM assets WHERE hash = ?", [
          entry.hash,
        ]);
        if (!exists) {
          throw new DbError("invalid_request", `asset ${name} references an unknown blob`);
        }
        run(
          `INSERT INTO project_assets (project_id, name, hash, updated_at)
           VALUES (?, ?, ?, ?)`,
          [id, name, entry.hash, nowString()],
        );
      }
    }
    run(
      `UPDATE projects
          SET name = ?, chart = ?, size = ?, charter = ?, composer = ?, level = ?,
              background = ?, song = ?, note_count = ?, chart_hash = ?, revision = ?,
              view_state = ?, asset_folders = ?, updated_at = ?
        WHERE id = ?`,
      [
        nextName,
        input.chartJson,
        input.chartJson.length,
        meta.charter,
        meta.composer,
        meta.level,
        nextBackground,
        nextSong,
        meta.noteCount,
        hash,
        currentRevision + 1,
        nextView,
        nextFolders,
        nowString(),
        id,
      ],
    );
    if (input.snapshot) {
      const revisionId = crypto.randomUUID();
      const label = input.label?.trim() || "revision";
      run(
        `INSERT INTO revisions (id, project_id, label, chart, size, chart_hash, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [revisionId, id, label, input.chartJson, input.chartJson.length, hash, nowString()],
      );
      if (input.assets) {
        for (const entry of input.assets) {
          run(`INSERT INTO revision_assets (revision_id, name, hash) VALUES (?, ?, ?)`, [
            revisionId,
            cleanAssetName(entry.name),
            entry.hash,
          ]);
        }
      }
    }
    run("COMMIT");
  } catch (error) {
    try {
      run("ROLLBACK");
    } catch {
      /* the transaction may already be gone */
    }
    throw error;
  }
  return { project: projectSummary(id) };
}

function revisions(params: Record<string, unknown>): Record<string, unknown> {
  const id = stringParam(params, "id");
  const limit = typeof params.limit === "number" && params.limit > 0 ? params.limit : 100;
  const rows = requireDb().selectObjects(
    `SELECT id, project_id, label, size, created_at
       FROM revisions
      WHERE project_id = ?
      ORDER BY created_at DESC
      LIMIT ?`,
    [id, limit],
  );
  const result: LibraryRevisionSummary[] = rows.map((row) => ({
    id: String(row.id),
    projectId: String(row.project_id),
    label: String(row.label ?? ""),
    createdAt: String(row.created_at ?? ""),
    size: Number(row.size ?? 0),
  }));
  return { revisions: result };
}

async function createRevision(params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const id = stringParam(params, "id");
  const label = typeof params.label === "string" ? params.label : "";
  const chart = params.chart ?? {};
  const chartJson = JSON.stringify(chart);
  const chartHash = await sha256Hex(chartJson);
  const revisionId = crypto.randomUUID();
  const now = nowString();
  projectRow(id);
  run(
    `INSERT INTO revisions (id, project_id, label, chart, size, chart_hash, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [revisionId, id, label, chartJson, chartJson.length, chartHash, now],
  );
  const manifest = assets({ id }) as { assets: LibraryAssetSummary[] };
  for (const entry of manifest.assets) {
    run(`INSERT INTO revision_assets (revision_id, name, hash) VALUES (?, ?, ?)`, [
      revisionId,
      entry.name,
      entry.hash,
    ]);
  }
  return {
    revision: {
      id: revisionId,
      projectId: id,
      label,
      createdAt: now,
      size: chartJson.length,
      chart,
    },
  };
}

function revision(params: Record<string, unknown>): Record<string, unknown> {
  const id = stringParam(params, "id");
  const row = requireDb().selectObject(
    `SELECT id, project_id, label, size, created_at, chart FROM revisions WHERE id = ?`,
    [id],
  );
  if (!row) {
    throw new DbError("not_found", "revision not found");
  }
  const result: LibraryRevision = {
    id: String(row.id),
    projectId: String(row.project_id),
    label: String(row.label ?? ""),
    createdAt: String(row.created_at ?? ""),
    size: Number(row.size ?? 0),
    chart: parseJson(row.chart, {}),
  };
  return { revision: result };
}

function removeRevision(params: Record<string, unknown>): Record<string, unknown> {
  const id = stringParam(params, "id");
  const exists = requireDb().selectValue("SELECT COUNT(*) FROM revisions WHERE id = ?", [id]);
  if (!exists) {
    throw new DbError("not_found", "revision not found");
  }
  run("DELETE FROM revisions WHERE id = ?", [id]);
  return { deleted: true };
}

function preferences(): Record<string, unknown> {
  const row = requireDb().selectObject("SELECT data FROM preferences WHERE id = 1");
  return { values: row ? parseJson(row.data, {}) : {} };
}

async function savePreferences(params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const values = isRecord(params.values) ? params.values : {};
  run(
    `INSERT INTO preferences (id, data, updated_at) VALUES (1, ?, ?)
     ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
    [JSON.stringify(values), nowString()],
  );
  await refreshBackupPolicy(true);
  return { values };
}

function checkpoint(): Record<string, unknown> {
  return { ok: true };
}

function stats(): Record<string, unknown> {
  return {
    integrity: requireDb().selectValue("PRAGMA integrity_check"),
    applicationId: requireDb().selectValue("PRAGMA application_id"),
    userVersion: requireDb().selectValue("PRAGMA user_version"),
    projects: requireDb().selectValue("SELECT COUNT(*) FROM projects"),
    revisions: requireDb().selectValue("SELECT COUNT(*) FROM revisions"),
    assets: requireDb().selectValue("SELECT COUNT(*) FROM assets"),
    pageCount: requireDb().selectValue("PRAGMA page_count"),
    pageSize: requireDb().selectValue("PRAGMA page_size"),
    vfs: requireDb().dbVfsName(),
    path: DB_PATH,
  };
}

function exportDb(): Uint8Array {
  if (!pool) {
    throw new DbError("not_ready", "the browser library is not open");
  }
  const backup = `/backup-${Date.now()}.db`;
  run(`VACUUM INTO '${backup}'`);
  const bytes = pool.exportFile(backup);
  pool.unlink(backup);
  return bytes.slice();
}

async function importDb(params: Record<string, unknown>): Promise<Record<string, unknown>> {
  if (!pool) {
    throw new DbError("not_ready", "the browser library is not open");
  }
  const bytes = bytesParam(params, "bytes");
  const backupName = `/restore-${Date.now()}.db`;
  let previous: Uint8Array | null = null;
  if (db) {
    run(`VACUUM INTO '${backupName}'`);
    previous = pool.exportFile(backupName);
    db.close();
    db = null;
  }
  try {
    pool.importDb(DB_PATH, bytes);
    db = new pool.OpfsSAHPoolDb(DB_PATH) as unknown as Db;
    run("PRAGMA foreign_keys = ON");
    run("PRAGMA synchronous = FULL");
    if (requireDb().selectValue("PRAGMA integrity_check") !== "ok") {
      throw new DbError("invalid_backup", "backup failed the SQLite integrity check");
    }
    const hasProjects = requireDb().selectValue(
      "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'projects'",
    );
    if (!hasProjects) {
      throw new DbError("invalid_backup", "backup is not an RPE Redux library");
    }
    await migrateSchema();
    recoveryError = "";
    try {
      await refreshBackupPolicy(false);
      await startBackupLoop();
    } catch (error) {
      backupLastError = error instanceof Error ? error.message : String(error);
    }
  } catch (error) {
    if (db) {
      db.close();
      db = null;
    }
    if (previous) {
      try {
        pool.importDb(DB_PATH, previous);
        db = new pool.OpfsSAHPoolDb(DB_PATH) as unknown as Db;
        run("PRAGMA foreign_keys = ON");
        run("PRAGMA synchronous = FULL");
        recoveryError = "";
      } catch {
        db = null;
      }
    }
    if (db === null) {
      recoveryError = error instanceof Error ? error.message : String(error);
    }
    pool.unlink(backupName);
    throw error;
  }
  pool.unlink(backupName);
  return { ok: true };
}

function stringParam(params: Record<string, unknown>, key: string): string {
  const value = params[key];
  if (typeof value !== "string") {
    throw new DbError("invalid_request", `${key} must be a string`);
  }
  return value;
}

function bytesParam(params: Record<string, unknown>, key: string): Uint8Array {
  const value = params[key];
  if (value instanceof Uint8Array) {
    return value;
  }
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }
  throw new DbError("invalid_request", `${key} must be bytes`);
}

type Handler = (
  params: Record<string, unknown>,
) => Record<string, unknown> | Uint8Array | Promise<Record<string, unknown>>;

const handlers = new Map<string, Handler>([
  ["init", () => init()],
  ["list", list],
  ["get", get],
  ["create", create],
  ["update", update],
  ["remove", remove],
  ["duplicate", duplicate],
  ["assets", assets],
  ["stageAsset", stageAsset],
  ["asset", asset],
  ["packageList", packageList],
  ["packageRead", packageRead],
  ["packageInstall", packageInstall],
  ["packageRemove", packageRemove],
  ["commit", commit],
  ["revisions", revisions],
  ["createRevision", createRevision],
  ["revision", revision],
  ["removeRevision", removeRevision],
  ["preferences", preferences],
  ["savePreferences", savePreferences],
  ["checkpoint", checkpoint],
  ["stats", stats],
  ["export", exportDb],
  ["import", importDb],
  ["backupStatus", () => backupStatus()],
  [
    "backupSnapshot",
    async (params) => ({
      ...(await backupSnapshot(typeof params.reason === "string" ? params.reason : "manual")),
    }),
  ],
  [
    "backupHistory",
    async (params) => ({
      commits: await backupHistory(typeof params.limit === "number" ? params.limit : 50),
    }),
  ],
  [
    "backupRestore",
    async (params) => ({
      ...(await backupRestore(typeof params.commitId === "string" ? params.commitId : "")),
    }),
  ],
  ["backupRestoreLatest", async () => ({ ...(await backupRestoreLatest()) })],
  [
    "backupVerify",
    (params) => backupVerify(typeof params.commitId === "string" ? params.commitId : ""),
  ],
  [
    "backupCompact",
    (params) =>
      backupCompact(typeof params.keep === "number" ? params.keep : BACKUP_POLICY.keepCommits),
  ],
]);

const MUTATING_METHODS = new Set([
  "create",
  "update",
  "remove",
  "duplicate",
  "commit",
  "createRevision",
  "removeRevision",
  "savePreferences",
  "packageInstall",
  "packageRemove",
  "import",
]);

scope.onmessage = async (event: MessageEvent<Request>) => {
  const request = event.data;
  try {
    const handler = handlers.get(request.method);
    if (!handler) {
      throw new DbError("unsupported", `unknown method: ${request.method}`);
    }
    const result = await runExclusive(() => handler(request.params ?? {}));
    if (MUTATING_METHODS.has(request.method)) {
      notifyBackup();
    }
    if (request.method === "asset") {
      const bytes = result as Uint8Array;
      const buffer = new Uint8Array(bytes).buffer as ArrayBuffer;
      scope.postMessage({ id: request.id, ok: true, bytes: buffer }, [buffer]);
      return;
    }
    if (request.method === "export") {
      const bytes = result as Uint8Array;
      const buffer = new Uint8Array(bytes).buffer as ArrayBuffer;
      scope.postMessage(
        {
          id: request.id,
          ok: true,
          result: { size: bytes.byteLength },
          bytes: buffer,
        },
        [buffer],
      );
      return;
    }
    scope.postMessage({ id: request.id, ok: true, result });
  } catch (error) {
    const code = error instanceof DbError ? error.code : "browser_library_error";
    const message = error instanceof Error ? error.message : String(error);
    scope.postMessage({ id: request.id, ok: false, error: { code, message } });
  }
};
