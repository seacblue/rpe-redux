/* eslint-disable max-lines -- the v1 schema, row mapping, and SQL operations share one worker transaction surface. */
/**
 * Browser chart-library worker.
 *
 * SQLite WASM runs in a dedicated worker because the OPFS SyncAccessHandle VFS
 * is worker-only. The worker owns one connection, applies the same v1 schema as
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
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_revisions_project ON revisions(project_id, created_at DESC);

CREATE TABLE IF NOT EXISTS preferences (
    id         INTEGER PRIMARY KEY CHECK (id = 1),
    data       TEXT NOT NULL DEFAULT '{}',
    updated_at TEXT NOT NULL
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
  db = new pool.OpfsSAHPoolDb(DB_PATH) as unknown as Db;
  run("PRAGMA foreign_keys = ON");
  run("PRAGMA synchronous = FULL");
  run(SCHEMA);
  if (requireDb().selectValue("PRAGMA user_version") === 0) {
    run("PRAGMA user_version = 1");
  }
  return {
    sqliteVersion: sqlite3.version.libVersion,
    userVersion: requireDb().selectValue("PRAGMA user_version"),
    vfs: requireDb().dbVfsName(),
    path: DB_PATH,
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
        `INSERT INTO revisions (id, project_id, label, chart, size, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [revisionId, id, label, input.chartJson, input.chartJson.length, nowString()],
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

function createRevision(params: Record<string, unknown>): Record<string, unknown> {
  const id = stringParam(params, "id");
  const label = typeof params.label === "string" ? params.label : "";
  const chart = params.chart ?? {};
  const chartJson = JSON.stringify(chart);
  const revisionId = crypto.randomUUID();
  const now = nowString();
  projectRow(id);
  run(
    `INSERT INTO revisions (id, project_id, label, chart, size, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [revisionId, id, label, chartJson, chartJson.length, now],
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

function savePreferences(params: Record<string, unknown>): Record<string, unknown> {
  const values = isRecord(params.values) ? params.values : {};
  run(
    `INSERT INTO preferences (id, data, updated_at) VALUES (1, ?, ?)
     ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
    [JSON.stringify(values), nowString()],
  );
  return { values };
}

function checkpoint(): Record<string, unknown> {
  return { ok: true };
}

function stats(): Record<string, unknown> {
  return {
    integrity: requireDb().selectValue("PRAGMA integrity_check"),
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

function importDb(params: Record<string, unknown>): Record<string, unknown> {
  if (!pool || !db) {
    throw new DbError("not_ready", "the browser library is not open");
  }
  const bytes = bytesParam(params, "bytes");
  const backup = `/restore-${Date.now()}.db`;
  run(`VACUUM INTO '${backup}'`);
  const previous = pool.exportFile(backup);
  db.close();
  db = null;
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
    if (requireDb().selectValue("PRAGMA user_version") === 0) {
      run("PRAGMA user_version = 1");
    }
  } catch (error) {
    if (db) {
      db.close();
      db = null;
    }
    try {
      pool.importDb(DB_PATH, previous);
      db = new pool.OpfsSAHPoolDb(DB_PATH) as unknown as Db;
      run("PRAGMA foreign_keys = ON");
      run("PRAGMA synchronous = FULL");
    } catch {
      db = null;
    }
    pool.unlink(backup);
    throw error;
  }
  pool.unlink(backup);
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

const handlers: Record<
  string,
  (
    params: Record<string, unknown>,
  ) => Record<string, unknown> | Uint8Array | Promise<Record<string, unknown>>
> = {
  init: () => init(),
  list,
  get,
  create,
  update,
  remove,
  duplicate,
  assets,
  stageAsset,
  asset,
  commit,
  revisions,
  createRevision,
  revision,
  removeRevision,
  preferences,
  savePreferences,
  checkpoint,
  stats,
  export: exportDb,
  import: importDb,
};

scope.onmessage = async (event: MessageEvent<Request>) => {
  const request = event.data;
  try {
    const handler = handlers[request.method];
    if (!handler) {
      throw new DbError("unsupported", `unknown method: ${request.method}`);
    }
    const result = await handler(request.params ?? {});
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
