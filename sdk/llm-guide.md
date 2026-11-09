# RPE Redux code-cell guide

This is the runtime guide for one-shot code cells. A cell is an async JavaScript function body that reads the open document, can apply atomic chart transactions, and returns one JSON value. The runtime and profiles are part of the desktop application, while the HTTP routes live in the local service. Read this guide once, then write short cells instead of a long sequence of transport calls.

## Before you start

- The RPE Redux desktop application must be running.
- A chart must already be open. Cells can edit the open chart, but they cannot create, open, save, close, or delete a document or project. If the user wants a new chart, ask them to create it in the application first.
- Use `{ "profile": "read" }` when the task only inspects the document or chart. The default is `write`; read cells cannot reach transactions or any write handle.
- Enable **Settings → General → AI-assisted development → Allow AI code cells**. The guide stays readable when that setting is off, but `POST /api/cell/run` returns `403` until it is enabled.
- Asset writes update the stored library copy. Ask the user to save the open document before changing assets, then patch any metadata or texture path that points at them.

## HTTP access

The local service exposes the cell API over HTTP:

- `GET {base}/api/cell/guide` returns this document.
- `POST {base}/api/cell/run` accepts `{ "source": "...", "profile": "read" | "write", "args": {...}, "expected": {...}, "timeoutMs": 10000 }` with `Content-Type: application/json`; `profile` defaults to `write`.
- `POST {base}/api/cell/frame` accepts a frame request (`seconds` or `beat`, optional `width`, `height`, `format`, `quality`) and returns the encoded image. Add `Accept: application/json` to receive the same image as a data URL instead of raw bytes.

`{base}` is the origin of the guide URL you fetched. The routes require the service to be bound to a loopback address and the peer to be loopback. Post to `/api/cell/run` or `/api/cell/frame` directly; the server root `/` is the library API and rejects a bare POST with `403 client_header_required`.

```sh
curl "{base}/api/cell/guide"
curl -X POST "{base}/api/cell/run" \
  -H "Content-Type: application/json" \
  -d '{"source":"const s = await redux.document.state(); return { name: s.name };"}'
curl -X POST "{base}/api/cell/frame" \
  -H "Content-Type: application/json" \
  -d '{"beat":[32,0,1],"width":960,"height":540}' \
  --output frame-32.png
```

On Windows PowerShell:

```powershell
$base = "http://127.0.0.1:47821"
$body = @{ source = 'return (await redux.document.state()).name;' } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri "$base/api/cell/run" `
  -ContentType 'application/json' -Body $body
```

HTTP status `200` means the cell finished; inspect `ok` inside the result. `400` is an invalid request, `403` means code cells are disabled, the service is not loopback-only, or the request carries a foreign browser `Origin`, `409` means `expected` is stale, `503` means no editor is connected, and `500` is an internal failure. The adapter promotes `disabled`, `invalid_request`, and `stale_read` to those HTTP errors; other cell error codes arrive inside a `200` result with `ok: false`. `POST /api/cell/frame` uses the same status mapping and returns the encoded image on success, or `{ "ok": true, "value": { ... } }` when the request asks for JSON.

`expected` may pin `chartFingerprint`, `diskSnapshot`, or `generation`; a mismatch returns `stale_read`. The same start snapshot is checked again before every `transaction.preview` and `transaction.apply`: if the user edits the chart, switches documents, or the disk snapshot changes during the run, the write returns `rejected` with issue `stale_read` and is not committed. The request may also set `timeoutMs` within the limit below.

## What a cell is

```js
// receives: redux, input, console
// returns: one JSON value
const state = await redux.document.state();
return { summary: state.name || "untitled" };
```

- `redux` is the asynchronous editor facade. Every call crosses the sandbox bridge and returns a promise; always `await` it, even for synchronous host methods such as `redux.document.state()`.
- `input` is the request's `args` value (normally an object or array), or `undefined` when omitted. The HTTP adapter accepts `null` and objects; primitives are rejected with `invalid_request`.
- `console.log/info/warn/error` is captured and returned in `logs` (bounded); `console.debug` is captured at level `log`. `atMs` is milliseconds since the cell started.
- `return` a JSON-safe value. `BigInt` becomes a string with an `n` suffix (`1n` becomes `"1n"`); `Uint8Array` becomes a number array; functions and symbols are omitted.
- The request `profile` is `"write"` by default or `"read"`; any other value is rejected before the sandbox starts. `read` can only read the document, chart, and selection; it cannot reach transactions, library, playback, or any write handle.
- `await redux.capabilities()` returns the exact capability list for the run. The same list is in `result.capabilities`. Use it instead of probing write methods to discover permissions.
- The default `write` profile can apply atomic chart transactions and add or remove project assets. It cannot save, open, close, create, or delete documents, use the network, access the host DOM, start nested workers, or read the host window.
- Do not use `import`, `require`, `fetch`, `XMLHttpRequest`, `WebSocket`, `Worker`, `document`, `window`, `localStorage`, `setTimeout`, or `setInterval`; they are outside the cell profile or blocked by the sandbox policy.

## Execution model and timeout

Each cell runs in a fresh dedicated Web Worker owned by the opaque-origin sandbox iframe. The iframe never executes submitted code; it only relays bridge calls to the capability-gated host facade and enforces the deadline. The worker has no host DOM, Tauri IPC, or network. The submitted body is wrapped as an async function and receives the gated `redux` facade, `input`, and the captured `console`.

`timeoutMs` is `1000`–`20000` milliseconds and defaults to `10000`. At the deadline the iframe calls `worker.terminate()`. The run resolves as a normal `ok: false` result, not a transport error:

```json
{
  "id": "a1b2c3d4e5f60789",
  "ok": false,
  "logs": [{ "level": "log", "text": "before-hang", "atMs": 2 }],
  "error": {
    "code": "timeout",
    "name": "TimeoutError",
    "message": "Code cell execution timed out after 10000 ms"
  },
  "durationMs": 10000,
  "truncated": true
}
```

Termination is real: an infinite loop, an endless microtask chain, or a cell that never resolves cannot continue after the deadline. The same shape applies to every budget; with `timeoutMs: 20000` the message ends in `20000 ms` and `durationMs` is `20000`. Logs are streamed back as they are written, so entries emitted before termination are included in `logs`. A log produced after termination begins may be lost; write the final state you need into the returned value, or finish before the budget. After every run the host disposes the sandbox, so the next cell starts with a fresh iframe and worker.

Inside the worker, cell code cannot use `window`, `document`, `Worker`, `SharedWorker`, `importScripts`, `postMessage`, `setTimeout`, `setInterval`, `requestAnimationFrame`, `fetch`, `XMLHttpRequest`, or `WebSocket`. Use `redux` for editor reads and writes and `console` for logs. The loop back into the editor is asynchronous: `redux` values are promises and no host object is exposed directly.

Only one cell runs at a time. A second request while a cell is running returns `error.code: "busy"` immediately; it is not queued. Wait for the first result before submitting another cell.

## Result envelope

A successful HTTP run returns the cell result:

```json
{
  "id": "a1b2c3d4e5f60789",
  "ok": true,
  "value": { "status": "committed", "issues": [] },
  "logs": [],
  "durationMs": 12,
  "startRevisions": { "chartFingerprint": "…", "diskSnapshot": null, "generation": 1 },
  "endRevisions": { "chartFingerprint": "…", "diskSnapshot": null, "generation": 2 },
  "capabilities": [
    "document.read",
    "chart.read",
    "selection.read",
    "chart.write",
    "library.read",
    "assets.write"
  ],
  "truncated": false
}
```

`id` is present when the cell reached the sandbox and returned an outcome, including code errors and timeouts. Preflight failures may omit it. On success `value` is the returned JSON value; a cell that returns `undefined` produces `value: null` (the worker encodes it as `null`), not an omitted field.

A failed cell has this shape:

```json
{
  "id": "a1b2c3d4e5f60789",
  "ok": false,
  "logs": [],
  "error": {
    "code": "capabilityDenied",
    "name": "Error",
    "message": "Extension capability is not granted: chart.write (transaction.undo)",
    "stack": "…",
    "line": 4,
    "column": 9
  },
  "durationMs": 3,
  "startRevisions": { "chartFingerprint": "…", "diskSnapshot": null, "generation": 1 },
  "endRevisions": { "chartFingerprint": "…", "diskSnapshot": null, "generation": 1 },
  "capabilities": ["document.read", "chart.read", "selection.read"],
  "truncated": false
}
```

`ok: false` means the cell itself failed; read `error.code`, `error.message`, and `logs`. This is different from a transaction that ran but was rejected: that still has cell `ok: true`, and its `value.status` is `rejected`, `conflict`, or `unchanged`.

Use `unwrap` for the `ApiResult` handles returned by chart, transaction, selection, and library calls:

```js
const unwrap = (result) => {
  if (!result || typeof result !== "object" || !("ok" in result)) return result;
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.value;
};
```

`ApiResult<T>` is exactly one of:

```ts
{ ok: true; value: T } | { ok: false; error: ApiError }

interface ApiError {
  code:
    | "unavailable"
    | "invalid_request"
    | "unsupported"
    | "unchanged"
    | "rejected"
    | "conflict"
    | "unsaved_changes"
    | "multiple_candidates"
    | "save_conflict"
    | "failed";
  message?: string;
  issues?: readonly string[];
}
```

`ok: true` only means the call completed. For `chart.read` and transaction calls, also inspect `value.status`. `redux.document.state()`, `redux.document.snapshot()`, `redux.document.fingerprint()`, and `redux.capabilities()` resolve to their values directly through the bridge.

The request and result types are exported by the SDK as `CodeCellRequest`, `CodeCellResult`, `CodeCellError`, `CodeCellErrorCode`, `CodeCellLog`, `CodeCellProfile`, and `CodeCellRevisions`:

```ts
type CodeCellProfile = "read" | "write";

interface CodeCellRequest {
  readonly source: string;
  readonly profile?: CodeCellProfile; // default: "write"
  readonly args?: unknown; // exposed as input
  readonly expected?: Partial<CodeCellRevisions>; // checked before the cell starts
  readonly timeoutMs?: number; // default 10000; runtime clamps to 1000..20000
}

interface CodeCellRevisions {
  readonly chartFingerprint: string | null;
  readonly diskSnapshot: string | null;
  readonly generation: number;
}

interface CodeCellLog {
  readonly level: "log" | "info" | "warn" | "error";
  readonly text: string;
  readonly atMs: number;
}

type CodeCellErrorCode =
  | "disabled"
  | "busy"
  | "stale_read"
  | "invalid_request"
  | "timeout"
  | "cancelled"
  | "syntax"
  | "exception"
  | "capabilityDenied"
  | "runtime";

interface CodeCellError {
  readonly code: CodeCellErrorCode;
  readonly name?: string;
  readonly message: string;
  readonly stack?: string;
  readonly line?: number;
  readonly column?: number;
}

interface CodeCellResult {
  readonly id?: string;
  readonly ok: boolean;
  readonly value?: unknown;
  readonly logs: readonly CodeCellLog[];
  readonly error?: CodeCellError;
  readonly durationMs: number;
  readonly startRevisions: CodeCellRevisions;
  readonly endRevisions: CodeCellRevisions;
  readonly capabilities: readonly ExtensionCapability[];
  readonly truncated: boolean;
}
```

`id` is present once the cell reached the sandbox and returned an outcome, including code errors and timeouts. Preflight failures may omit it.

## Profiles, capabilities, and exact handles

`redux.version` is always available as a synchronous string. `await redux.capabilities()` returns the exact grant list for the run. It works on every profile, does not read or change the chart, and returns the same array as `result.capabilities`. Do not discover permissions by calling write methods and catching errors.

| profile | exact capabilities |
| --- | --- |
| `read` | `document.read`, `chart.read`, `selection.read`, `preview.read` |
| `write` (default) | `document.read`, `chart.read`, `selection.read`, `preview.read`, `chart.write`, `library.read`, `assets.write` |

`read` can call:

- `redux.document.availability/state/snapshot/fingerprint`
- `redux.chart.availability/state/read/snapshot/metadata/resources/lines/line/parentId/notes/note/events/event`
- `redux.selection.availability/state/subscribe`
- `redux.preview.availability/snapshot/frame`
- `redux.capabilities()`

`read` cannot call or even access `redux.transaction`, `redux.library`, `redux.playback`, `redux.layout`, `redux.settings`, `redux.values`, `redux.toolbar`, `redux.sidebar`, `redux.workspace`, `redux.help`, `redux.extensions`, `redux.chart.placeNote`, or any document write method. Those accesses return `capabilityDenied` and never partially write.

`write` adds:

- `redux.transaction.availability/preview/apply/cancel/history`
- `redux.library.availability/list/get/assets/asset/revisions/revision`
- `redux.library.addAsset/removeAsset` (`assets.write`)

`write` still cannot use `redux.chart.placeNote`, `redux.transaction.undo`, `redux.transaction.redo`, document writes, `redux.library.create/createRaw/ update/remove/duplicate/createRevision/removeRevision`, playback, layout, settings, values, toolbar, sidebar, workspace, help, or extensions. Use `redux.transaction.apply` for every chart edit.

The types below describe the full chart and transaction format. They do not grant permission: a field present in a type can still be rejected with `ai.feature.restricted` when its AI switch is off. The rejecting transaction returns `status: "rejected"`, `issues[].code: "ai.feature.restricted"`, and `issues[].path` naming the field.

A capability denial is a normal cell error:

```json
{
  "code": "capabilityDenied",
  "name": "Error",
  "message": "Extension capability is not granted: chart.write (transaction.undo)"
}
```

The host raises `ExtensionCapabilityError`, but the cell result usually reports `name: "Error"` because the bridge carries the message and code rather than the host class. A bridged call can also prefix the message with its path, for example `document.save: Extension capability is not granted: document.write (document.save)`. Always test `error.code === "capabilityDenied"`; never match the full message or the name.

The source receives exactly `redux`, `input`, and `console`. There is no `ui`, `timers`, `values`, `settings`, `storage`, `events`, `scripts`, `styles`, `context`, `window`, or `document`. `redux.values`, `redux.settings`, `redux.toolbar`, `redux.sidebar`, `redux.playback`, `redux.layout`, `redux.hitTest`, `redux.diagnostics`, `redux.workspace`, `redux.help`, and `redux.extensions` throw `capabilityDenied` on property access in both profiles. `redux.preview` is available because both profiles hold `preview.read`; use it to inspect visible objects or render a frame.

### Exact signatures

All methods cross the asynchronous bridge, so `await` every call except the synchronous `redux.version` string. `capabilities()` is cell-only; the SDK exports the `CodeCellApi` type, and the host implementation is the restricted Code Cell host implementation.

Chart object ids are `ChartObjectId` (`string & { readonly __chartObjectId: unique symbol }`) in the SDK; runtime values are UUID-shaped strings. Read ids from `chart.lines()`, `chart.notes()`, and `chart.events()` and pass them back; do not synthesize them. `redux.chart.snapshot()` returns a recursively frozen detached chart. `redux.chart.read()` pages and the `redux.chart.lines()/notes()/events()` arrays are detached read-only views; do not mutate them. `redux.document.snapshot()` returns a detached mutable copy.

```ts
redux.version: string; // synchronous, not a promise
redux.capabilities(): Promise<readonly ExtensionCapability[]>;

// Document reads.
redux.document.availability(): Promise<ApiAvailability>;
redux.document.state(): Promise<DocumentState>;
redux.document.snapshot(): Promise<Chart | null>;
redux.document.fingerprint(): Promise<string | null>;

interface DocumentState {
  status: "empty" | "open";
  path: string | null;
  name: string;
  format: "memory" | "json" | "pez";
  dirty: boolean;
  fingerprint: string | null;
}

interface ApiAvailability {
  status: "available" | "unavailable";
  error?: ApiError;
}

// Chart reads.
type ChartReadCollection = "metadata" | "lines" | "notes" | "events";
type ChartReadItem<C extends ChartReadCollection> = C extends "metadata"
  ? ChartMeta
  : C extends "lines"
    ? JudgeLine
    : C extends "notes"
      ? ChartNoteReadRef
      : ChartEventReadRef;

redux.chart.availability(): Promise<ApiAvailability>;
redux.chart.state(): Promise<ApiResult<{ chartFingerprint: string | null; generation: number }>>;
redux.chart.read<C extends ChartReadCollection>(
  collection: C,
  options?: {
    chartFingerprint?: string | null;
    cursor?: string | null;
    limit?: number; // default 50, maximum 100; non-positive/non-integer uses 50
  },
): Promise<ApiResult<ChartReadPage<ChartReadItem<C>>>>;
redux.chart.snapshot(): Promise<ApiResult<Chart | null>>;
redux.chart.metadata(): Promise<ApiResult<ChartMeta | null>>;
redux.chart.resources(): Promise<ApiResult<readonly ChartResourceReference[]>>;
redux.chart.lines(): Promise<ApiResult<readonly JudgeLine[]>>;
redux.chart.line(id: string): Promise<ApiResult<JudgeLine | null>>;
redux.chart.parentId(id: string): Promise<ApiResult<string | null>>;
redux.chart.notes(): Promise<ApiResult<readonly ChartNoteReadRef[]>>;
redux.chart.note(id: string): Promise<ApiResult<ChartNoteReadRef | null>>;
redux.chart.events(): Promise<ApiResult<readonly ChartEventReadRef[]>>;
redux.chart.event(id: string): Promise<ApiResult<ChartEventReadRef | null>>;

type ChartReadPage<T> =
  | {
      status: "ok";
      chartFingerprint: string | null;
      generation: number;
      items: readonly T[];
      nextCursor: string | null;
    }
  | {
      status: "stale_read";
      requestedFingerprint: string | null;
      currentFingerprint: string | null;
      requestedGeneration: number | null;
      currentGeneration: number;
    }
  | { status: "invalid_request"; reason: "invalid_cursor" };

interface ChartNoteReadRef {
  id: string;
  lineId: string;
  lineIndex: number;
  index: number;
  note: JudgeLineNote;
}

interface ChartEventReadRef {
  id: string;
  lineId: string;
  lineIndex: number;
  eventType: string;
  layer: number | "extended";
  index: number;
  event: JudgeLineEvent;
}

interface ChartResourceReference {
  kind: "song" | "background" | "lineTexture" | "attachUI";
  name: string;
}

// Selection reads.
redux.selection.availability(): Promise<ApiAvailability>;
redux.selection.state(): Promise<ApiResult<SelectionApiSnapshot>>;
redux.selection.subscribe(
  listener: (snapshot: SelectionApiSnapshot) => void,
): Promise<() => void>;

interface SelectionApiSnapshot {
  lineIndex: number;
  eventLayer: number;
  focus: "notes" | "events";
  notes: readonly { lineIndex: number; index: number }[];
  events: readonly {
    lineIndex: number;
    eventType: string;
    layer: number | "extended";
    index: number;
  }[];
}

// Preview reads and frame images (both profiles).
redux.preview.availability(): Promise<ApiAvailability>;
redux.preview.snapshot(): Promise<ApiResult<PreviewSnapshot>>;
redux.preview.frame(
  request: {
    seconds?: number;
    beat?: number | readonly number[];
    width?: number;
    height?: number;
    format?: "png" | "jpeg" | "webp";
    quality?: number;
  },
): Promise<ApiResult<PreviewFrameImage>>;

interface PreviewFrameImage {
  seconds: number;
  beat: readonly [number, number, number];
  beatValue: number;
  width: number;
  height: number;
  format: "png" | "jpeg" | "webp";
  mimeType: string;
  quality: number;
  dataUrl: string;
  byteLength: number;
  chartFingerprint: string;
}

// Transactions (write profile only).
redux.transaction.availability(): Promise<ApiAvailability>;
redux.transaction.preview(
  request: ChartTransactionRequest,
): Promise<ApiResult<ChartTransactionPreviewResult>>;
redux.transaction.apply(
  requestOrPreviewId?: ChartTransactionRequest | string,
  previewId?: string,
): Promise<ApiResult<ChartTransactionResult>>;
redux.transaction.cancel(previewId: string): Promise<ApiResult<boolean>>;
redux.transaction.history(): Promise<ApiResult<TransactionHistoryState>>;

// Library reads and assets (write profile only).
type RequestOptions = { timeoutMs?: number };

redux.library.availability(): Promise<ApiAvailability>;
redux.library.list(
  query?: {
    search?: string;
    group?: string;
    archived?: boolean | string;
    sort?: "created" | "updated" | "name" | "composer" | "charter";
    direction?: "asc" | "desc";
    limit?: number;
    offset?: number;
  },
  options?: RequestOptions,
): Promise<ApiResult<{ projects: LibraryProjectSummary[]; total: number }>>;
redux.library.get(
  id: string,
  options?: RequestOptions,
): Promise<ApiResult<{ project: LibraryProject }>>;
redux.library.assets(
  id: string,
  options?: RequestOptions,
): Promise<ApiResult<{ assets: LibraryAssetSummary[] }>>;
redux.library.asset(
  id: string,
  name: string,
  options?: RequestOptions,
): Promise<ApiResult<Uint8Array>>;
redux.library.addAsset(
  id: string,
  name: string,
  bytes: Uint8Array,
  options?: RequestOptions,
): Promise<ApiResult<{ asset: LibraryAssetSummary; project: LibraryProjectSummary }>>;
redux.library.removeAsset(
  id: string,
  name: string,
  options?: RequestOptions,
): Promise<ApiResult<{ removed: boolean; project: LibraryProjectSummary }>>;
redux.library.revisions(
  id: string,
  query?: { limit?: number },
  options?: RequestOptions,
): Promise<ApiResult<{ revisions: LibraryRevisionSummary[] }>>;
redux.library.revision(
  id: string,
  options?: RequestOptions,
): Promise<ApiResult<{ revision: LibraryRevision }>>;
```

The stable library shapes are:

```ts
interface LibraryAssetSummary {
  name: string;
  hash: string;
  size: number;
}

interface LibraryProjectSummary {
  id: string;
  name: string;
  group: string;
  archived: boolean;
  charter: string;
  composer: string;
  level: string;
  background?: string;
  song?: string;
  noteCount: number;
  revision: number;
  createdAt: string;
  updatedAt: string;
  size: number;
  viewState?: unknown;
  assetFolders?: string[];
}

interface LibraryProject extends LibraryProjectSummary {
  chart: unknown;
}

interface LibraryRevisionSummary {
  id: number;
  projectId: string;
  label: string;
  createdAt: string;
  size: number;
}

interface LibraryRevision extends LibraryRevisionSummary {
  chart: unknown;
}
```

### Quick self-check

Run this before a nontrivial cell when you need to confirm the profile, the open document, and the SDK version. `redux.version` is a synchronous string; the two handle calls are promises.

```js
const [capabilities, state] = await Promise.all([redux.capabilities(), redux.document.state()]);
return {
  version: redux.version,
  capabilities,
  open: state.status === "open",
  name: state.name,
  fingerprint: state.fingerprint,
};
```

### Minimal read-profile cell

This completes without touching any write handle. The result also echoes the same `capabilities` array outside the cell.

```js
// request: { "profile": "read", "source": "..." }
const capabilities = await redux.capabilities();
const state = await redux.document.state();
if (!state.fingerprint) {
  return { capabilities, summary: "no chart is open" };
}
const lines = unwrap(await redux.chart.lines());
return {
  capabilities,
  summary: `${lines.length} lines`,
  name: state.name,
  fingerprint: state.fingerprint,
};
```

`read` cannot access `redux.transaction` at all. Do not probe it with `try/catch`; call `redux.capabilities()` or read the profile table above.

## Reading the chart

`redux.document.state()` returns the document descriptor, including `name`, `path`, `format`, `dirty`, and `fingerprint`. Use the fingerprint when you want a read or a later write to be checked against the exact revision you inspected.

`redux.chart.snapshot()` resolves to a detached chart:

```js
const chart = unwrap(await redux.chart.snapshot());
// chart.META              header fields: name, song, offset, ...
// chart.BPMList           [{ bpm, startTime }]
// chart.judgeLineList     [{ id, Name, notes, eventLayers, extended, ... }]
```

`META` fields use the file format's lower-case names (`name`, `song`, `offset`, `composer`, `charter`, `level`, `background`, `illustration`). Judge-line fields keep their RPE spelling, notably `Name` and `Texture`.

<!-- ai-block:lineBpmFactor -->

`bpmfactor` is a line's local time scale.
<!-- /ai-block:lineBpmFactor -->

<!-- ai-block:lineExtended -->

`zOrder`, `isCover`, and `attachUI` are extended line fields.
<!-- /ai-block:lineExtended -->

`redux.chart.lines()` resolves to an `ApiResult` whose value is the judge lines. `redux.chart.notes()` resolves to refs:

```js
// { id, lineId, lineIndex, index, note }
const notes = unwrap(await redux.chart.notes());
```

`redux.chart.events()` resolves to refs:

```js
// { id, lineId, lineIndex, eventType, layer, index, event }
const events = unwrap(await redux.chart.events());
```

For a large chart, page with `redux.chart.read` instead of copying the whole chart:

```js
let cursor;
let count = 0;
do {
  const page = unwrap(await redux.chart.read("notes", { cursor, limit: 100 }));
  if (page.status === "stale_read") throw new Error("chart changed; read again");
  if (page.status !== "ok") throw new Error(`chart read: ${page.status}`);
  count += page.items.length;
  cursor = page.nextCursor;
} while (cursor);
return { summary: `${count} notes` };
```

The readable collections are `metadata`, `lines`, `notes`, and `events`. `limit` defaults to `50` and is clamped to `100`; a non-positive or non-integer value uses the default. A chart cursor pins the fingerprint and generation, so an edit invalidates it. When the result must match an earlier read, pass `chartFingerprint` and treat a `stale_read` result as a request to read the chart again.

The `cursor` is an opaque token. Only pass back a `nextCursor` you received; never parse, construct, or reuse it across fingerprints. If a cursor is malformed, the page status is `invalid_request` with `reason: "invalid_cursor"`.

`redux.chart.resources()` lists resource names referenced by the chart. Use it before replacing a song, background, line texture, or attached UI. `META.illustration` is the illustrator credit text, not an asset name.

### Chart shapes

The authoritative TypeScript definitions live in the public chart and transaction types. The stable cell-facing shape is:

```ts
type Beat = [number, number, number]; // [whole, numerator, denominator]

interface Chart {
  META: ChartMeta;
  BPMList: BpmEntry[];
  judgeLineGroup?: string[];
  judgeLineList?: JudgeLine[];
  blockAreaList?: unknown[];
  [extra: string]: unknown;
}

interface ChartMeta {
  RPEVersion?: number;
  ReduxVersion?: string;
  id?: string;
  name?: string;
  composer?: string;
  charter?: string;
  illustration?: string;
  level?: string;
  song?: string;
  background?: string;
  offset?: number;
  numOfNotes?: number;
  [extra: string]: unknown;
}

interface BpmEntry {
  bpm: number;
  startTime: Beat;
  [extra: string]: unknown;
}

interface JudgeLine {
  id?: string;
  Name?: string;
  Group?: number | string;
  Texture?: string;
  bpmfactor?: number;
  father?: number | string | null;
  rotateWithFather?: boolean;
  isCover?: number;
  zOrder?: number;
  anchor?: number[];
  isGif?: boolean;
  attachUI?: string;
  eventLayers?: (LineEventLayer | null)[];
  extended?: LineEventLayer;
  notes?: JudgeLineNote[];
  numOfNotes?: number;
  alphaControl?: ControlPoint[];
  posControl?: ControlPoint[];
  sizeControl?: ControlPoint[];
  skewControl?: ControlPoint[];
  yControl?: ControlPoint[];
  [extra: string]: unknown;
}

interface JudgeLineNote {
  id?: string;
  type: number; // 1 tap, 2 hold, 3 flick, 4 drag
  startTime: Beat;
  endTime: Beat;
  positionX?: number;
  above?: number | string | null;
  isFake?: number;
  speed?: number;
  size?: number;
  yOffset?: number;
  visibleTime?: number;
  alpha?: number;
  color?: number[];
  [extra: string]: unknown;
}

interface JudgeLineEvent {
  id?: string;
  startTime: Beat;
  endTime: Beat;
  start: number | number[] | string | null;
  end: number | number[] | string | null;
  easingType?: number;
  easingLeft?: number;
  easingRight?: number;
  bezier?: number | boolean;
  bezierPoints?: number[];
  linkgroup?: number;
  font?: string;
  [extra: string]: unknown;
}
```

`paintEvents` values are shader-defined opaque objects. Reuse existing values instead of constructing an unknown paint payload.

## Authoring workflow

1. Call `redux.document.state()` and check that a chart is open. Save the fingerprint for the revision you are about to inspect.
2. Read `BPMList` and `META.offset` from a snapshot. Read the lines and any notes/events you plan to update. Reuse their exact beat triples when possible.
3. Build one transaction that expresses the whole change. Prefer one transaction per cell; it commits atomically and appears as one undo entry.
4. Call `redux.transaction.apply(request)` and inspect `value.status`, `value.issues`, and `value.affectedObjectIds`.
5. Read the changed line/notes/events back and summarize the result. If the status is `conflict`, read the document again and rebuild the request; do not retry the same stale write.

## Beats, tempo, and time

Beats are reduced `[whole, numerator, denominator]` triples, not floats:

- `[3, 1, 2]` is 3.5
- `[4, 0, 1]` is 4
- `[0, 1, 4]` is 0.25

Copy existing triples when possible. For a new position, write the exact fraction; the editor reduces it. Notes and events are always authored in beats, never seconds.

`timing.bpmList` replaces the complete tempo map. It must contain at least one entry, and each entry is `{ "bpm": 180, "startTime": [0, 0, 1] }`. The editor sorts entries by `startTime`. For a constant-tempo chart one entry is enough; the first point normally starts at beat zero. `META.offset` is the audio offset in milliseconds.

<!-- ai-block:lineBpmFactor -->

A line's `bpmfactor` scales time on that line; keep it at `1` unless the chart intentionally needs a per-line speed.
<!-- /ai-block:lineBpmFactor -->

For a constant tempo, `seconds = beat * 60 / bpm`. If you start from a target audio time, convert it to beats that way and then write the reduced triple. Do not put BPM values in `metadata`; use `timing.bpmList`. Changing the tempo re-times every beat-based note and event but does not move its beat position, so set the tempo and offset before authoring the detailed note placement.

## Notes

A note requires `type`, `startTime`, `endTime`, and `positionX`. Note types are:

- `1` tap
- `2` hold
- `3` flick
- `4` drag

`positionX` spans `-675..675`, where 0 is centre. `above` is `1` above the line and `0` or `2` below. Hold notes use `startTime` and `endTime`; set `endTime` later than `startTime`. Other note types normally keep them equal.

Useful optional fields:

| Field         | Meaning                                                                      |
| ------------- | ---------------------------------------------------------------------------- |
| `isFake`      | `1` keeps the note unjudged. <!-- ai-line:fakeNotes -->                      |
| `speed`       | Note speed factor; `0` makes a static note. <!-- ai-line:noteSpeed -->       |
| `size`        | Note size factor. <!-- ai-line:noteSize -->                                  |
| `yOffset`     | Vertical offset of an active hold head. <!-- ai-line:noteYOffset -->         |
| `visibleTime` | Seconds the note stays visible. <!-- ai-line:noteVisibleTime -->             |
| `alpha`       | Opacity, `0..255`. <!-- ai-line:noteAlpha -->                                |
| `color`       | RGB blend triple, for example `[255, 120, 200]`. <!-- ai-line:noteColor -->  |
| `hitSound`    | Custom hit-sound name; empty uses the default. <!-- ai-line:noteHitSound --> |

Write the fields the chart needs. Omitted optional fields fall back to the editor defaults.

## Events

An event requires `startTime` and `endTime`; insert entries also require `eventType`. Base tracks live in `eventLayers[0]` by default.

<!-- ai-block:eventLayers -->

Values across base layers are summed, so leave `layer` at `0` unless you are intentionally building a multi-layer effect.
<!-- /ai-block:eventLayers -->

<!-- ai-block:extendedEvents -->

Extended tracks use `layer: "extended"`.
<!-- /ai-block:extendedEvents -->

| Track | Value shape | Meaning |
| --- | --- | --- |
| `moveXEvents` | number | Absolute horizontal offset in chart units; positive is right. |
| `moveYEvents` | number | Absolute vertical offset in chart units; positive is up. |
| `rotateEvents` | number | Rotation in degrees. |
| `alphaEvents` | number | Line opacity, `0..255`. |
| `speedEvents` | number | Scroll speed; the default line uses `10`. `0` freezes its notes. |
| `scaleXEvents` | number | Horizontal scale factor. <!-- ai-line:extendedEvents --> |
| `scaleYEvents` | number | Vertical scale factor. <!-- ai-line:extendedEvents --> |
| `colorEvents` | `[r, g, b]` | Line colour, channels `0..255`. <!-- ai-line:extendedEvents --> |
| `textEvents` | string | Text event value; can carry `font`. <!-- ai-line:extendedEvents --> |
| `inclineEvents` | number | Incline angle in degrees. <!-- ai-line:extendedEvents --> |
| `paintEvents` | object | Shader paint payload. <!-- ai-line:extendedEvents --> |
| `gifEvents` | number | GIF frame value stored by the format. <!-- ai-line:extendedEvents --> |

<!-- ai-block:linkgroup -->

Events on the same line can share a non-zero `linkgroup`. The editor uses it to select and edit related events together; leave it at `0` or omit it otherwise.
<!-- /ai-block:linkgroup -->

A track interpolates from the active event's `start` to `end` over its beat range, then holds the final value until the next event. Keep events on one track in time order and avoid overlapping ranges when the intent is a keyframe sequence. `easingType: 1` is linear. Common easing ids are `2` sine-out, `3` sine-in, `4` quadratic-out, `5` quadratic-in, `6` sine-in-out, `7` quadratic-in-out, `8` cubic-out, `9` cubic-in, `16` exponential-out, `17` exponential-in, `20` back-out, `21` back-in, `24` elastic-out, `25` elastic-in, `26` bounce-out, `27` bounce-in, and `29` elastic-in-out.

<!-- ai-block:bezier -->

Set `bezier: true` and `bezierPoints: [x1, y1, x2, y2]` to use a Bézier instead of an easing id.
<!-- /ai-block:bezier -->

<!-- ai-block:easingRange -->

`easingLeft` and `easingRight` select a sub-range of the easing curve, normally `0` and `1`.
<!-- /ai-block:easingRange -->

Line control curves are separate from events. `alphaControl`, `posControl`, `sizeControl`, `skewControl`, and `yControl` are arrays of `{ x, alpha|pos| size|skew|y, easing }` points. They sample by note distance from the line, not by time. Leave them out unless the effect needs them.

## Frame images

`redux.preview.frame(request)` renders the chart at one position and returns an encoded image. Use it when a numeric chart read is not enough and you need to see the stage, judge-line layout, note placement, or a shader result. The renderer uses its own offscreen preview: it does not seek playback, change the live preview, or modify the chart.

Select the frame with exactly one of:

| field     | meaning                                                              |
| --------- | -------------------------------------------------------------------- |
| `seconds` | Chart seconds on the tempo map.                                      |
| `beat`    | A beat number or a reduced `[whole, numerator, denominator]` triple. |

Optional fields:

| field | meaning |
| --- | --- |
| `width`, `height` | Pixel output. Defaults to `960 × 540`; naming one edge derives the other at 16:9. Each edge is 16–1920 and the area must not exceed 1,000,000 pixels. |
| `format` | `"png"` (default), `"jpeg"`, or `"webp"`. PNG preserves transparency; JPEG and WebP are smaller for visual checks. |
| `quality` | Lossy encoder quality from `0` to `1`; defaults to `0.92`. Ignored for PNG. |

The result carries `seconds`, the reduced `beat` triple, `beatValue`, `width`, `height`, `format`, `mimeType`, `dataUrl`, `byteLength`, and `chartFingerprint`. The `dataUrl` is a standard `data:image/...;base64,...` URL.

```js
const frame = unwrap(await redux.preview.frame({ beat: [32, 0, 1], width: 960, height: 540 }));
return {
  beat: frame.beat,
  seconds: frame.seconds,
  bytes: frame.byteLength,
  image: frame.dataUrl,
};
```

The cell result is capped at 1,000,000 bytes, so a large PNG can fail the whole result. For visual checks prefer a smaller frame such as `640 × 360`, or use `jpeg`/`webp`. When the caller needs a full-size image or a saved file, use the `POST /api/cell/frame` HTTP route instead: it returns the encoded bytes directly and adds `X-Redux-Frame-Seconds`, `X-Redux-Frame-Beat`, `X-Redux-Frame-Width`, `X-Redux-Frame-Height`, `X-Redux-Frame-Format`, and `X-Redux-Chart-Fingerprint` headers.

## Transactions

`redux.transaction.apply(request)` commits one transaction to the open chart. `redux.transaction.preview(request)` validates it without committing and returns a preview id; pass that id to `apply(previewId)` when the same plan should be committed. A preview id belongs to the cell that created it; a later cell cannot apply or cancel it.

`redux.transaction.undo` and `redux.transaction.redo` are withheld; accessing either property returns `capabilityDenied`. `redux.chart.placeNote` is also unavailable. Every write must go through `preview`/`apply`.

The exact result contracts are:

```ts
interface TransactionIssue {
  code: string; // e.g. ai.feature.restricted, note.insert.note.required
  path?: string; // e.g. notes.insert[0].note.speed
  objectId?: string;
  message?: string;
}

interface ChartTransactionPreviewResult {
  status: "previewed" | "unchanged" | "rejected" | "unavailable";
  affectedObjectIds: readonly string[];
  issues: readonly TransactionIssue[];
  previewId: string | null; // non-null for previewed and unchanged; null otherwise
}

interface ChartTransactionResult {
  status: "committed" | "unchanged" | "rejected" | "conflict" | "unavailable";
  beforeFingerprint: string | null;
  afterFingerprint: string | null;
  affectedObjectIds: readonly string[];
  issues: readonly TransactionIssue[];
  history: TransactionHistorySummary | null;
  conflict: {
    code: "chartFingerprint";
    expectedFingerprint: string;
    currentFingerprint: string;
  } | null;
}

interface TransactionHistorySummary {
  label: string;
  beforeFingerprint: string;
  afterFingerprint: string;
  affectedObjectIds: readonly string[];
  issues: readonly TransactionIssue[];
  origin: {
    kind: string;
    clientId?: string;
    requestId?: string;
    undoOf?: string;
  } | null;
}

interface TransactionHistoryState {
  canUndo: boolean;
  canRedo: boolean;
  undoLabel?: string;
  redoLabel?: string;
}
```

A committed cell transaction records `origin: { kind: "code-cell", requestId: result.id }`; the runtime stamps it and the cell cannot supply a different origin. `cancel(previewId)` returns `{ ok: true, value: boolean }`; an unknown or other-cell id returns `value: false`. Any preview left unconsumed is cancelled when the cell ends, times out, or is cancelled.

Preview lifecycle:

- `preview(request)` returns `status: "previewed"` with an id when the request changes the chart, and `status: "unchanged"` with an id when it does not. `rejected` and `unavailable` return `previewId: null`.
- The editor keeps at most one unused preview per editor session. A newer `preview` replaces the older one; applying the older id then returns `status: "rejected"` with `preview.notFound` (it was still created by this cell, so it is not `ai.preview.unknown`). `cancel` on the replaced id returns `{ ok: true, value: false }`.
- A preview id is valid only inside the cell that created it and only for that run. It is not persisted and cannot be sent from a later cell.
- `preview` and `apply` both compare the document with the revision snapshot captured when the cell started. After a user edit, document switch, or disk change, the preview is invalid: `apply` returns `rejected` with `stale_read` and does not write, and a new `preview` is rejected the same way.
- `apply(previewId)` consumes the preview exactly once. A second apply of the same id from the same cell returns `rejected` with `ai.preview.unknown` because the cell no longer owns an unconsumed preview. If the chart changed before the first apply, the result is `rejected` with `preview.stale`.
- Use either `apply(request)` or `apply(previewId)`, not both. The implementation treats the first argument as an id when it is a string; a second `previewId` argument has no effect.
- `apply()` with no argument is rejected with `ai.preview.unknown`; it does not apply the most recent preview implicitly.
- `preview` checks the AI field policy before planning. `apply(previewId)` re-checks the current policy before committing; if a field was disabled since the preview, the preview is cancelled and the result is `rejected` with `ai.feature.restricted`.
- In a read-only document, planning returns `rejected` with `editor.readOnly`. A collaboration viewer can plan a preview but the commit is rejected with `commit.rejected` because the room role blocks the history commit.

Common issue codes (not exhaustive; new validation codes may be added):

| issue code | meaning |
| --- | --- |
| `ai.feature.restricted` | a field disabled in the user's AI settings; inspect `path` |
| `ai.preview.unknown` | apply used an id this cell does not currently own (another cell, consumed, or never created) |
| `stale_read` | the start revision changed (user edit, document switch, or disk snapshot); no write occurs |
| `editor.readOnly` | the open document is read-only |
| `preview.notFound` / `preview.stale` | the preview was replaced/cleared, or the chart changed |
| `request.object.required` / `request.unserializable` | the request is not a JSON object |
| `object.id.invalid` / `object.id.duplicate` | an object id is invalid or repeated |
| `object.operation.conflict` | the same object is changed by conflicting operations |
| `line.target.required` / `line.target.mismatch` | a note/event target line is missing or mismatched |
| `line.index.invalid` / `line.id.invalid` | a line index or id is invalid |
| `event.type.required` / `event.type.unsupported` / `event.layer.invalid` | an event type or layer is invalid |
| `timing.*` / `notes.*` / `events.*` / `lines.*` | that section failed shape validation |
| `commit.rejected` / `history.record.missing` | a commit hook rejected the write or history was not recorded |

The request shape is:

```ts
interface ChartTransactionRequest {
  label?: string;
  metadata?: Partial<ChartMeta> & Record<string, unknown>;
  timing?: { bpmList: readonly BpmEntry[] };
  lines?: {
    insert?: readonly { line: Partial<JudgeLine> & { id?: string } }[];
    update?: readonly { id: string; patch: JudgeLinePatch }[];
  };
  notes?: {
    insert?: readonly {
      lineId?: string;
      lineIndex?: number;
      note: Partial<JudgeLineNote> &
        Pick<JudgeLineNote, "type" | "startTime" | "endTime" | "positionX">;
    }[];
    update?: readonly { id: string; patch: Partial<JudgeLineNote> & Record<string, unknown> }[];
    delete?: readonly string[];
  };
  events?: {
    insert?: readonly {
      lineId?: string;
      lineIndex?: number;
      eventType: string;
      layer?: number | "extended";
      event: Partial<JudgeLineEvent> & Pick<JudgeLineEvent, "startTime" | "endTime">;
    }[];
    update?: readonly { id: string; patch: Partial<JudgeLineEvent> & Record<string, unknown> }[];
    delete?: readonly string[];
  };
}

type JudgeLinePatch = Partial<
  Pick<
    JudgeLine,
    | "Name"
    | "Group"
    | "Texture"
    | "bpmfactor"
    | "father"
    | "rotateWithFather"
    | "isCover"
    | "zOrder"
    | "anchor"
    | "isGif"
    | "attachUI"
    | "alphaControl"
    | "posControl"
    | "sizeControl"
    | "skewControl"
    | "yControl"
  >
> & {
  parentId?: string | null;
} & Record<string, unknown>;
```

```json
{
  "label": "write the opening section",
  "timing": {
    "bpmList": [{ "bpm": 180, "startTime": [0, 0, 1] }]
  },
  "metadata": {
    "name": "Opening",
    "charter": "AI",
    "offset": 0
  },
  "lines": {
    "insert": [{ "line": { "Name": "Main" } }],
    "update": [{ "id": "<line-id>", "patch": { "Name": "Main line" } }]
  },
  "notes": {
    "insert": [
      {
        "lineIndex": 1,
        "note": {
          "type": 1,
          "startTime": [0, 1, 1],
          "endTime": [0, 1, 1],
          "positionX": 0,
          "above": 1
        }
      }
    ],
    "update": [{ "id": "<note-id>", "patch": { "positionX": 100 } }],
    "delete": ["<note-id>"]
  },
  "events": {
    "insert": [
      {
        "lineId": "<line-id>",
        "eventType": "moveXEvents",
        "layer": 0,
        "event": {
          "startTime": [0, 0, 1],
          "endTime": [0, 2, 1],
          "start": 0,
          "end": 200,
          "easingType": 1
        }
      }
    ],
    "update": [{ "id": "<event-id>", "patch": { "end": 300 } }],
    "delete": ["<event-id>"]
  }
}
```

Read, preview, then apply one plan. `preview` is the cell-side validation step; it returns `issues` without writing when the plan is invalid.

```js
const state = await redux.document.state();
if (!state.fingerprint) return { summary: "open a chart first" };
const lines = unwrap(await redux.chart.lines());
const line = lines[0];
if (!line?.id) return { summary: "no judge line" };

const preview = unwrap(
  await redux.transaction.preview({
    label: "preview then apply",
    notes: {
      insert: [
        {
          lineId: line.id,
          note: {
            type: 1,
            startTime: [0, 0, 1],
            endTime: [0, 0, 1],
            positionX: 0,
            above: 1,
          },
        },
      ],
    },
  }),
);
if (preview.status === "rejected" || preview.status === "unavailable" || !preview.previewId) {
  return { summary: preview.status, issues: preview.issues };
}
const applied = unwrap(await redux.transaction.apply(preview.previewId));
return { summary: applied.status, status: applied.status, issues: applied.issues };
```

Preview a metadata-only plan:

```js
const preview = unwrap(
  await redux.transaction.preview({
    label: "rename chart",
    metadata: { name: input?.name ?? "Untitled" },
  }),
);
if (preview.status !== "previewed" || !preview.previewId) {
  return { summary: preview.status, issues: preview.issues };
}
const applied = unwrap(await redux.transaction.apply(preview.previewId));
return { summary: applied.status, issues: applied.issues };
```

Cancel a preview you do not want to commit:

```js
const preview = unwrap(await redux.transaction.preview(request));
if (preview.previewId) {
  const cancelled = unwrap(await redux.transaction.cancel(preview.previewId));
  return { summary: cancelled ? "cancelled" : "not found" };
}
return { summary: preview.status, issues: preview.issues };
```

Rules:

- Every section is optional; omitted sections leave the chart unchanged.
- `metadata` is a partial `META` patch. It accepts `name`, `composer`, `charter`, `illustration`, `level`, `song`, `background`, `offset`, `RPEVersion`, `ReduxVersion`, and extra format fields. Do not use `BPMList` here; use `timing`.
- `timing.bpmList` replaces the whole tempo map. It must be non-empty; entries are sorted by `startTime` on apply.
- `lines.insert` appends a judge line. `line` accepts the same editable fields as `lines.update`; the editor assigns the id and a default event layer. The new line's index is the previous line count plus its position in `insert`, so later notes/events in the same transaction can target it with `lineIndex`. `lines.delete` is not available. Line patches accept `Name`, `Group`, `Texture`, and the `alphaControl`, `posControl`, `sizeControl`, `skewControl`, and `yControl` point arrays.
  <!-- ai-block:lineBpmFactor -->
  Add `bpmfactor` to change a line's local time scale.
  <!-- /ai-block:lineBpmFactor -->
  <!-- ai-block:parentLines -->
  Add `father` / `parentId` and `rotateWithFather` for a parent-child relation. Prefer `parentId` over the format's numeric `father`; do not send both.
  <!-- /ai-block:parentLines -->
  <!-- ai-block:lineExtended -->
  Add `zOrder`, `isCover`, `isGif`, or `attachUI` for extended line rendering.
  <!-- /ai-block:lineExtended -->
  <!-- ai-block:lineAnchor -->
  Add `anchor` as an `[x, y]` pair for a custom line pivot.
  <!-- /ai-block:lineAnchor -->
  `id`, `notes`, `eventLayers`, `extended`, and `numOfNotes` are structural and cannot be patched.
- `notes.insert` targets an existing line with `lineId` or `lineIndex`. Omit `id` to let the editor assign one. `notes.update` and `notes.delete` address existing notes by id; a note's id is immutable.
- `events.insert` targets an existing line with `lineId` or `lineIndex`. `eventType` is one of `moveXEvents`, `moveYEvents`, `rotateEvents`, `alphaEvents`, or `speedEvents`.
  <!-- ai-block:extendedEvents -->
  The extended tracks are `scaleXEvents`, `scaleYEvents`, `colorEvents`, `paintEvents`, `textEvents`, `inclineEvents`, and `gifEvents`.
  <!-- /ai-block:extendedEvents -->
  Base tracks default to `layer: 0`.
  <!-- ai-block:eventLayers -->
  Base layers are `0..4`; set `layer` to author another layer.
  <!-- /ai-block:eventLayers -->
  <!-- ai-block:extendedEvents -->
  Extended tracks use `layer: "extended"`.
  <!-- /ai-block:extendedEvents -->
  `events.update` and `events.delete` address existing events by id; the id, owning line, `eventType`, and layer are immutable on an update.
- A transaction request is a patch, not a replacement. Every operation is applied to a copy of the current chart; unknown fields are preserved, and unknown top-level sections are ignored. A request containing only unknown keys can report `unchanged`; always inspect `status` and `issues`. Chart-wide fields outside `metadata` and `timing` (`judgeLineGroup`, `blockAreaList`, `effects`, and `shaderEvents`) are not editable through this grammar; ask the user to edit those in the application.
- `numOfNotes` is derived from the note list and excludes Holds (type `2`), so it is not the length of the notes array. Do not try to patch it.
- `redux.transaction.preview(request)` validates without committing. `redux.transaction.apply(request)` commits; `apply(previewId)` commits a previewed plan. Both return `{ ok, value }`; check `value.status` and `value.issues`. `value.status` is `committed`, `unchanged`, `rejected`, `conflict`, or `unavailable`. A committed result also has `value.history` with the cell audit origin; the runtime owns that field.
- A `conflict` means the chart changed after the request was planned. Read the document again and rebuild the request. A `rejected` result is not a conflict; inspect `issues` and correct the request.

## Source-free AI authoring audit

结论：**外部 AI 不需要读取 RPE Redux 源代码，就可以在一个已经打开的谱面文档里完成从节拍、判定线、音符到事件的批量编写；它不需要设计 React、插件 UI 或宿主 DOM。**本指南、`/api/cell/guide` 返回的同一份内容和 `chart`/`transaction` 的公开类型就是执行契约。

边界也要说清楚：Code Cell 不能创建、打开、保存或关闭文档；用户必须先在应用中准备一个目标文档。它也不会替 AI 决定音乐意图、BPM、音符密度或谱面风格——这些是输入规格，不是编辑器 API 能凭空推断的设计。对于“已有音乐规格，快速生成结构化谱面”，下面的固定协议足够；对于“只给一首歌，让 AI 自己判断怎么谱”，仍然需要外部音频分析或人工确认。

无源代码编写协议：

1. `GET /api/cell/guide`，读取本指南和当前能力/字段约束。
2. 用 `redux.document.state()` 确认有打开文档，用 `redux.chart.lines()` 确认已有判定线；按需用 `redux.chart.read` 分页，而不是猜 id。
3. 将输入规格规范成 JSON：BPM、`META`、判定线列表、`[whole, numerator, denominator]` 拍坐标、音符类型和事件轨道。
4. 一次构造 `transaction` 请求；新线放在 `lines.insert`，音符和事件用同一事务里的 `lineIndex` 或已有 `lineId`。
5. 先 `transaction.preview(request)`，检查 `status` 和 `issues`；只有 `previewId` 有效时才 `transaction.apply(previewId)`。
6. 返回提交状态、受影响对象数量和下一步；遇到 `stale_read` 或 `conflict`，重新读取并重建请求，不重放旧 id。

这使“写谱面”成为一个无 UI 的 JSON 规划问题。可直接把用户输入映射成下面的最小模板，AI 只需要替换 `input`，不需要重新设计调用方式：

```js
const unwrap = (result) => {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.value;
};
const state = await redux.document.state();
if (!state.fingerprint) return { status: "no-document" };
const request = {
  label: input.label ?? "AI chart composition",
  timing: { bpmList: input.bpmList },
  metadata: input.metadata ?? {},
  lines: { insert: (input.lines ?? []).map((line) => ({ line })) },
  notes: { insert: (input.notes ?? []).map((note) => ({ ...note })) },
  events: { insert: (input.events ?? []).map((event) => ({ ...event })) },
};
const preview = unwrap(await redux.transaction.preview(request));
if (!preview.previewId || !["previewed", "unchanged"].includes(preview.status)) {
  return { status: preview.status, issues: preview.issues };
}
const applied = unwrap(await redux.transaction.apply(preview.previewId));
return {
  status: applied.status,
  affectedObjectIds: applied.affectedObjectIds,
  issues: applied.issues,
};
```

模板仍然要求 `input.notes` 和 `input.events` 使用本指南定义的目标字段；它不会替 AI 猜测事件轨道或绕过 chart policy。这样既保证外部 AI 能快速执行，也把“数据规格”和“宿主安全写入”分在了两个可审计的层次。

## Worked example: write a short opening section

This assumes a chart is already open. It replaces the tempo map, sets the header, adds a line, and puts four taps and a moving line on it.

```js
const state = await redux.document.state();
if (!state.fingerprint) return { summary: "open a chart first" };

const result = unwrap(
  await redux.transaction.apply({
    label: "write the opening section",
    timing: { bpmList: [{ bpm: 180, startTime: [0, 0, 1] }] },
    metadata: { name: "Opening", charter: "AI", offset: 0 },
    lines: { insert: [{ line: { Name: "Main" } }] },
    notes: {
      insert: [
        {
          lineIndex: 1,
          note: { type: 1, startTime: [0, 0, 1], endTime: [0, 0, 1], positionX: -300, above: 1 },
        },
        {
          lineIndex: 1,
          note: { type: 1, startTime: [0, 1, 2], endTime: [0, 1, 2], positionX: -100, above: 1 },
        },
        {
          lineIndex: 1,
          note: { type: 1, startTime: [0, 1, 1], endTime: [0, 1, 1], positionX: 100, above: 1 },
        },
        {
          lineIndex: 1,
          note: { type: 1, startTime: [0, 3, 2], endTime: [0, 3, 2], positionX: 300, above: 1 },
        },
      ],
    },
    events: {
      insert: [
        {
          lineIndex: 1,
          eventType: "moveXEvents",
          layer: 0,
          event: { startTime: [2, 0, 1], endTime: [4, 0, 1], start: -200, end: 200, easingType: 6 },
        },
      ],
    },
  }),
);
return { summary: result.status, status: result.status, issues: result.issues };
```

`lineIndex: 1` targets the newly inserted line because the existing chart in this example had one line at index 0. In a real chart, read `redux.chart.lines()` first and use the actual index, or insert the line and then read its id.

## Worked example: add notes from input

Pass the note list as `args`; the cell keeps the request small:

```js
const state = await redux.document.state();
if (!state.fingerprint) return { summary: "open a chart first" };
const lines = unwrap(await redux.chart.lines());
const line = lines[input?.lineIndex ?? 0];
if (!line?.id) return { summary: "line not found" };

const notes = (input?.notes ?? []).map((note) => ({
  lineId: line.id,
  note: {
    type: note.type ?? 1,
    startTime: note.startTime,
    endTime: note.endTime ?? note.startTime,
    positionX: note.positionX ?? 0,
    above: note.above ?? 1,
  },
}));
const result = unwrap(
  await redux.transaction.apply({ label: "add notes", notes: { insert: notes } }),
);
return { summary: result.status, status: result.status, issues: result.issues };
```

Run it with:

```json
{
  "source": "...",
  "args": {
    "lineIndex": 0,
    "notes": [
      { "startTime": [0, 0, 1], "positionX": -200 },
      { "startTime": [0, 1, 2], "positionX": 200 }
    ]
  }
}
```

## Assets

Asset bytes live in the local library, not in the transaction. Find the project id with `redux.library.list`, then upload or remove one named asset:

```js
const listed = unwrap(await redux.library.list({ search: input?.project ?? "" }));
const project = listed.projects[0];
if (!project) return { summary: "project not found" };
const bytes = new TextEncoder().encode(input?.text ?? "");
const added = unwrap(await redux.library.addAsset(project.id, "notes.txt", bytes));
const removed = unwrap(await redux.library.removeAsset(project.id, "old.png"));
return { summary: "assets updated", added: added.asset.name, removed };
```

`addAsset` and `removeAsset` commit the project's stored library copy. Ask the user to save open editor changes before using them, and update metadata or line texture references with a transaction when an asset is renamed or removed. To attach a song, background, or line texture, upload the asset and then patch `metadata.song`, `metadata.background`, or the line's `Texture` to the exact asset name. Patch `metadata.illustration` only to change the illustrator credit. Project deletion is not available to cells.

## Limits and errors

### Limits

| item | exact value | notes |
| --- | --- | --- |
| source | 100,000 UTF-8 bytes | empty or non-string returns `invalid_request`; the HTTP body limit is 4 MiB |
| result | 1,000,000 bytes/chars | see the serialization rules below |
| logs | 200 entries, 64 KiB total, 4,096 chars each | exceeding any cap sets `truncated: true` |
| timeout | 10,000 ms default, 1,000 min, 20,000 max | at the deadline the iframe terminates the worker; host guard is +1 s, max 20 s |
| concurrency | 1 active cell | a concurrent request returns `busy` and is not queued |
| preview | owned by the creating cell | leftover previews are cancelled when the cell ends |
| iframe + worker | new per run | global state is not reused; timeout terminates the worker |
| network / child frames | blocked by CSP | `connect-src 'none'`, `child-src 'none'`, `frame-src 'none'` |
| nested workers | blocked inside the cell worker | `Worker`, `SharedWorker`, `importScripts`, and `postMessage` throw |
| persistence | none | results and logs live only in memory |

### Result serialization

- `BigInt` becomes a string with an `n` suffix (`1n` becomes `"1n"`); `Uint8Array` becomes a number array; functions and symbols are dropped by the replacer (object keys disappear, array entries become `null` per `JSON.stringify`).
- If `JSON.stringify` returns `undefined`, `value` is `null` and `truncated: false`.
- If the worker serialization exceeds 1,000,000 characters, `value` is `null` and `truncated: true`. The host also checks UTF-8 bytes and returns `error.code: "runtime"` if the encoded value still exceeds 1,000,000 bytes.
- Logs stop at 200 entries or 64 KiB; a single entry longer than 4,096 chars is cut and suffixed with `…`.

### Cell error codes

| `error.code` | when | message example |
| --- | --- | --- |
| `disabled` | code execution is off, or the Code Cell host is absent | `Code execution is disabled` |
| `busy` | another cell is running; not queued | `A code cell is already running` |
| `stale_read` | an `expected` field no longer matches the start revision, or preview/apply ran after the start snapshot moved on | `Code cell base revision is stale: chartFingerprint` |
| `invalid_request` | source empty/whitespace/non-string or over 100,000 UTF-8 bytes; unknown profile; invalid args/timeout at the adapter | `Unknown code cell profile: admin` |
| `timeout` | execution budget exceeded; the worker is terminated | `Code cell execution timed out after 10000 ms` |
| `cancelled` | user cancel or sandbox disposal | `Code cell was cancelled` / `Code cell sandbox was disposed` |
| `syntax` | module parse failure | `Unexpected token ...` |
| `exception` | cell code threw | the thrown message |
| `capabilityDenied` | handle or method outside the profile | `Extension capability is not granted: chart.write (transaction.undo)` |
| `runtime` | no mounted document, no sandbox factory, bridge result channel missing, or the host UTF-8 result check failed | `Code cell sandbox is unavailable` |

`error.name` is the name carried by the thrown error. Syntax, timeout, and abort paths keep `SyntaxError`, `TimeoutError`, and `AbortError`; a normal cell exception keeps its own name. A capability denial raised on the host is an `ExtensionCapabilityError`, but after crossing the bridge the cell result usually reports `name: "Error"`. Branch on `error.code`, not `error.name`. `error.line` and `error.column` are adjusted to the submitted source, and `error.stack` names the source as `redux-cell.js`. `id` is present once the cell reached the sandbox and returned an outcome, including code errors and timeouts; preflight failures may omit it.

`capabilityDenied` means the cell called a handle outside its profile. Do not retry it; inspect `redux.capabilities()` or the profile table. `stale_read` means the document changed after your pin; re-read and rebuild. `disabled` means the user has not enabled code cells; do not retry until they do. `timeout` and `cancelled` dispose that sandbox; a timed-out worker is terminated, so it cannot keep running in the background. Wait for the result before submitting another cell. Never retry in a loop against `busy`.

A cell can return its own failure value instead of letting the run fail:

```js
try {
  const result = unwrap(await redux.transaction.apply(request));
  return { ok: true, status: result.status, issues: result.issues };
} catch (error) {
  return {
    ok: false,
    message: error instanceof Error ? error.message : String(error),
    code: error && typeof error === "object" && "code" in error ? error.code : "exception",
  };
}
```

### Format-defined or opaque behavior

- `chart.read` cursors are opaque. Only pass back a `nextCursor`; never parse, construct, or reuse it across fingerprints. Re-read `chart.state()` for a new cursor.
- `paintEvents`, shader events, and unknown extension fields are defined by the chart format. This guide guarantees they are preserved, not that their payload is constructible. Reuse an existing value or ask the user to edit it in the application.
- Transaction `issues[].code` is an open set. Inspect `status`, `issues[].path`, and `issues[].message`; do not enumerate a fixed list.
- Full chart and library objects can gain fields. The stable fields and TypeScript types are defined in this guide and the public SDK declarations.
- `redux.capabilities()` and `result.capabilities` are the only dynamic capability source. Do not test permissions by calling write methods.
- Only one unused preview exists per editor session. A second `preview` replaces the first; applying the replaced id returns `preview.notFound` rather than `ai.preview.unknown`. Keep one preview at a time or apply the request directly.
- `apply()` with no argument is rejected with `ai.preview.unknown`; it never applies the most recent preview implicitly.
- `preview` can return `status: "unchanged"` with a non-null `previewId`. `previewId` being non-null does not guarantee a write; inspect `status`.
- A capability denial usually carries `name: "Error"` after the bridge. Only `error.code` is stable; do not branch on the name.
- A collaboration viewer can plan a preview but its commit is rejected with `commit.rejected`, not `editor.readOnly`. Check the room role before treating a successful preview as permission to apply.
- A timeout returns the logs streamed before termination and `truncated: true`; the returned value is unavailable. A log produced after termination begins may be lost. Put anything you must keep in the returned value, or finish before the budget.

## Authoring checklist

- A chart is open; `redux.document.state()` has a non-null `fingerprint`.
- BPM is set through `timing.bpmList`, not `metadata`.
- Metadata keys are lower-case; line fields use `Name` and `Texture`.

<!-- ai-block:lineBpmFactor -->

- A line's `bpmfactor` scales its local time.

<!-- /ai-block:lineBpmFactor -->

- Every note has `type`, `startTime`, `endTime`, and `positionX`; holds have a later `endTime`.
- Every event has `startTime`, `endTime`, `start`, and `end`; value shapes match the track.
- Inserts omit `id`; updates and deletes use ids read from the chart.
- A new line inserted earlier in the same transaction is targeted by `lineIndex` equal to the old line count plus its insert position.
- Inspect `status`, `issues`, and the changed objects before reporting success.
