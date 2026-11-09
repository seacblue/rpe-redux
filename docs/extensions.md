# Extensions

Extensions are sandboxed JavaScript packages that contribute scripts, toolbar and sidebar entries, declarative panels and overlays, notices, settings, and shortcuts. The runtime, manifest validation, capability gate, script host, parameters, and steps live in `src/core/extensions/`; `sandbox.ts` defines the package-facing types and `capabilityGate.ts` builds the API a package may call. Built-in packages live in `src/assets/extensions/`, and `sdk/index.d.ts` is the types-only author surface. The Extensions settings page can install a package from a GitHub repository or browse a JSON marketplace catalog; the Help page opens the generated Extension development docs site. A Chinese translation is available in [the Chinese extension platform guide](extensions-zh.md).

Start with the [minimal extension guide](extensions-quickstart.md), then use this page as the reference for each capability.

## Package layout

```text
<extension>/
  manifest.json     required
  i18n.json         optional translation catalog
  index.js          required only when the manifest declares `entry`
```

Each directory is one package, and its directory name must equal the manifest `id`. A manifest with an `entry` is a code package; a manifest without one must declare a `scripts` array and is data-only. A package may register any number of scripts. Paths inside a package stay relative, and every declared file must exist. Built-ins are compiled from `src/assets/extensions/`; packaged and portable packages are discovered from the host's `extensions/` roots, where a portable package cannot shadow a shipped root or claim a `builtin.*` id. GitHub and marketplace installs are written to `user-data/extensions/` and reported as the `installed` source; removing one deletes that folder.

## Manifest

| Field | Contract |
| --- | --- |
| `id` | Lowercase letter followed by lowercase letters, digits, `.`, `_`, or `-`; 2–64 characters; matches the folder. |
| `name` | Display name, or the English name supplied by the translation catalog. |
| `version` | Non-empty package version string. |
| `kind` | Optional. `"extension"` and the deprecated `"mod"` alias accept either package shape; `"data-only"` requires `scripts` and no `entry`; `"script"` requires an `entry`. |
| `engines` | `{ "rpe-redux": <major> }` for the legacy major check, or a semver range string over the full host version. |
| `entry` | Optional package-relative JavaScript file. Its absence makes the package data-only. |
| `i18n` | Optional package-relative JSON catalog; `i18n.json` is read when present and undeclared. |
| `capabilities` | Optional capability names; unknown names and duplicates are rejected. |
| `collaboration` | Optional scope: `local` (default), `chart` for changes carried by normal chart transactions, or `shared-service` when peers using the feature must install the same package. The room never transfers or executes Extension code. |
| `scripts` | Data-only recipe array; each entry needs a unique local `id` and at least one step. |
| `dependencies` | Optional package ids that must be enabled first. |
| `conflicts` | Optional package ids that may not be enabled at the same time. |
| `author`, `license`, `sourceUrl`, `homepage`, `repository` | Provenance metadata; shape is validated and trust is never granted. |

The host validates the manifest before registration and reports a structured `ExtensionOperationResult` failure for a bad id, missing name/version, an incompatible or malformed host version declaration, malformed capabilities, invalid translations, self-dependency, self-conflict, an unknown `kind` (`invalidKind`), or a `kind` that does not match the package shape (`kindMismatch`). A translation catalog, when present, must contain an `en` entry and bare keys. Data-only packages cannot declare `ui.*` or `shortcuts` capabilities. A data-only manifest that omits `scripts` keeps loading: the host adds the implicit grant and writes a deprecation warning, because the runtime always required it at activation.

### Collaboration scope

Extensions are local packages. The `collaboration` field documents whether a package's local behaviour has a room-level consequence:

- `local` is the default. The package may render UI, register shortcuts, or use local services; a peer does not need the package.
- `chart` is for features whose result is ordinary chart state or chart assets. The result reaches peers through the existing transaction and room-asset protocols; peers do not need the package to observe the result.
- `shared-service` is for a feature that needs the package's service contract on each client. Every client using that feature must install and enable the same package and version. The service registry remains process-local, and the room does not distribute package files or run package code on the server.

The existing chunked upload path is intentionally limited to validated chart assets. Extension installation keeps its separate source, fingerprint, consent, and sandbox checks. This field is a package contract; the current room join path does not auto-install packages or reject a client solely from this declaration.

`engines["rpe-redux"]` accepts the legacy integer major or a semver range over the full host version. Ranges support exact and partial versions, `x`/`*` wildcards, `^`, `~`, comparison operators, hyphen ranges, whitespace AND, and `||` OR:

```json
{ "engines": { "rpe-redux": ">=1.0.0-a1 <2.0.0" } }
```

A range is checked before registration. An invalid range reports `invalidHostVersionRange`; a valid range the host does not satisfy reports `incompatibleHostVersion` with both the declared range and the running version.

## Installing from GitHub

The Extensions settings page accepts a repository URL, a raw link, or `owner/repo` shorthand. A `/tree/<ref>/<path>` link selects one package inside a monorepo. A repository link with one manifest is resolved at its default branch; several manifests produce a `manifestMultiple` failure that lists the candidates.

Inspecting a link downloads only `manifest.json`, the declared `entry`, and the declared or conventional `i18n.json`. The review dialog shows the package name, author, description, version, engine range, capabilities, source commit, and files. Confirming writes those exact bytes to `user-data/extensions/<id>` and enables the package without a restart. A failed install reports a stable code and the phase that failed (`input`, `marketplace`, `resolve`, `download`, `validate`, `persist`, `load`, or `enable`), plus the request URL, HTTP status, detail, cause, and recovery hint. Inspection and installation are desktop-only; the browser preview cannot read a repository or write the managed root.

## Marketplace catalog

Set **Extensions → Marketplace catalog URL** to a raw HTTPS JSON document. The page loads it on open and lists matching packages; installing an entry opens the same GitHub review as a pasted link. The catalog is data only: it cannot execute code, and the manifest still determines compatibility and capabilities.

```json
{
  "schemaVersion": 1,
  "name": "Example marketplace",
  "updatedAt": "2026-11-02",
  "extensions": [
    {
      "id": "example.distribute",
      "name": "Distribute",
      "author": "Example author",
      "description": "Distribute selected notes across lines.",
      "source": "https://github.com/owner/repo/tree/main/extensions/distribute",
      "version": "1.2.0",
      "ref": "main",
      "path": "extensions/distribute",
      "homepage": "https://example.com/distribute",
      "license": "MIT",
      "tags": ["notes", "distribution"]
    }
  ]
}
```

`source` (or `repository`/`repo`) is a GitHub link or `owner/repo`; `ref` and `path` override its selection. `id`, `name`, and `description` are required, ids are unique, and at most 500 entries are accepted. Invalid catalogs report `marketplaceInvalid`, `marketplaceSchema`, or `marketplaceEntry` with the offending JSON path.

## Capabilities

A manifest declaration is a request. The runtime grants only these names, and every bridge entry checks the grant before delegating:

| Area | Capabilities |
| --- | --- |
| Scripts | `scripts` |
| Chart | `chart.read`, `chart.write` |
| Selection | `selection.read`, `selection.write` |
| Document | `document.read`, `document.write` |
| Library | `library.read`, `library.write`, `assets.write` |
| Playback | `playback.read`, `playback.control` |
| UI | `ui.notice`, `ui.dialog`, `ui.panel`, `ui.sidebar`, `ui.overlay`, `ui.toolbar`, `ui.contextMenu` |
| Host services | `shortcuts`, `shortcuts.read`, `settings`, `hooks`, `values`, `storage`, `events`, `services`, `styles`, `timers`, `diagnostics` |
| Preview and layout | `preview.read` |
| Host-only gate | `host.patch` (deprecated; grants nothing) |

The vocabulary has 32 names, of which 31 are grantable. The consent catalog in `src/core/extensions/capabilityCatalog.ts` covers all 32, while `CAPABILITY_CONSENT_ROWS` omits `host.patch` because it never reaches an install dialog.

Runtime-backed handles expose `availability()`; a missing capability or runtime is returned as an unavailable result or a `capabilityDenied` error. The sandbox has an opaque origin and cannot reach the host DOM, Tauri IPC, `window.redux`, network, workers, or child frames. Its only channel is a transferred `MessagePort`, and every result is plain cloned data.

### Capability and payload rules

- `values.byId.snapshot()` and `subscribeAll()` are owner-scoped: they return or notify only values the calling package declared. Reading a known value by id through `get`/`subscribe` stays available, but a write to a host value or another package's value is refused with `capabilityDenied`. Enumerating the registry is not a way to discover host or sibling state.
- `events` delivers lifecycle facts from a fixed allowlist: `extension:callback-error`, `document:opened`, `document:created`, `document:restored`, `document:saved`, `document:closed`, and `selection:after-paste`. Any other name is refused with the stable `eventNotAllowed` code before a subscriber is registered, so a new host event stays invisible until it is added to `EXTENSION_EVENT_NAMES` and documented. `document:*` payloads carry `chart: null` unless the subscriber also declares `chart.read`. `selection:after-paste` omits its request/selection references without `selection.read`, and its chart fingerprints without `chart.read`.
- `ui.contextMenu` and `ui.toolbar` action runners receive a projected `ContextMenuTarget`. `noteIds` and event `refs` require `selection.read`; `beat`, `chartSeconds`, and a notes target's `lineIndex` require `chart.read`. Without either grant the runner still receives `surface` so the action can run.
- `ui.toolbar.bindings(action)` and `shortcutText(action)` answer only for ids owned by the calling package. Host ids additionally require `shortcuts.read`; another package's `extension.<owner>.*` ids are never readable.
- A script's `defaultShortcuts` requires the `shortcuts` capability. Without it the bindings are ignored and the host writes a warning instead of silently registering a global shortcut.
- `host.patch` is a deprecated host-only gate name kept for installed manifests. The host strips it while materializing the manifest, so it declares no handle and grants nothing.
- `shortcuts.read` is an additive capability used only by the toolbar shortcut helpers; it does not grant `api.shortcuts` by itself.

These rules affect the payload and enumeration surfaces only. Existing registrations, menu rows, toolbar actions, and UI rendering keep their current behavior. The host keeps a per-owner capability ledger exposed to tests and audits as `extensionCapabilityUsage()` in `src/core/extensions/extensionApi.ts`; it is not part of the package API.

`document.save` always uses the host save flow. The capability gate drops a caller-supplied `path`, so a package cannot create or overwrite a file in a directory it chooses; the host saves to the library or to its own current/native target. There is no Extension export-to-path operation. Development and automation through `window.redux`, and the internal document API, keep the explicit target.

## Method registry

Every method reachable through `context.api` is listed in `src/core/extensions/methodRegistry.ts` with its granting capability, consent risk tier, and whether it writes host state. The sandbox resolves an `api.call` path to a facade handle and member, then looks the pair up before invoking it. An unregistered path is rejected with the stable `methodNotRegistered` code and the dotted path; it is separate from `capabilityDenied`, so a host registration gap is not charged to the package's failure budget. `context.*` methods such as `ui.notice` and `events.on` do not pass through this check; their runner keeps the capability check.

`npm run check:extensions` (also part of `npm run check`) verifies that the registry's handle set matches the handles `capabilityGate.ts` allows. The consent catalog reads the same table for its method examples.

## Settings and values

`settings.registerSetting` and `settings.registerNavigation` take package-local keys. An owner registration is stored as `extension.<owner>.<key>`, and an already qualified key in that namespace is accepted unchanged. Another `extension.*` or `mod.*` key is rejected, so a package cannot claim a host or another package's setting. Register a navigation page for package settings with `settings.registerNavigation`; a row may also point at an existing host page such as `help` by naming that registered navigation key.

`values.define` accepts only `{ id, initial }` on the package surface. Package values always persist in the `values` preference section; `persist`, `storageKey`, and `legacyStorageKey` are ignored. A package therefore cannot select a preference section, adopt a host value, or migrate or delete a host preference key. Use `context.storage` or a settings row for package configuration.

`values.byId` and `values.getHandle` accept either the owner-qualified id or the package-local id. A local id resolves to `extension.<owner>.<id>` when that value is registered, and otherwise keeps the original id: reads of published host values stay available while writes to host or sibling values remain `capabilityDenied`. `byId.snapshot` and `byId.subscribeAll` stay owner-scoped.

## Toolbar entries

A toolbar registration is a structural descriptor. `kind` must be `action`, `control`, `field`, `divider`, or `spacer`; a `field` needs a non-empty `value` id, and a `control` must name a host-rendered control id (`playback`, `audition`, `extensions`, or `noiseRendering`). A malformed entry is rejected with `invalid_request` before it enters the registry, so it cannot fail the toolbar renderer or displace another contribution.

## Scripts and context

A code package registers scripts from its `activate(context)` entry. A data-only package declares the same script shape in the manifest. `activate` receives `manifest`, `signal`, the gated `api`, `i18n`, `ui`, `events`, `scripts`, `settings`, `storage`, `timers`, `styles`, and `addCleanup`.

A script provides either `run(context)` or a declarative `steps` array, never both. A script `run` context contains `api`, `params`, `i18n`, `ui`, `signal`, and `manifest`. Every sandbox API call is asynchronous and returns a promise. Snippets below use `api` for that gated facade. Package event subscriptions are read-only host events; mutating hooks and host DOM listeners are not part of the sandbox contract. The context never exposes the editor session, timeline, canvas, React state, or file handles.

Runtime limits: 2 MB entry source; 64 active scripts; 32 stylesheets of 100 KB each; 128 event subscriptions (theme listeners share this budget); 64 live timers with a 16 ms minimum interval; 128-character store keys and 256 KB store values, including JSON-encoded storage entries.

`context.timers` is the only timer surface inside the sandbox. Global `setTimeout`, `setInterval`, `setImmediate`, and animation-frame helpers are blocked whether or not the package holds `timers`; granted handles cross the bridge to the host timer wrapper, which owns the 64-handle budget and clamps every interval to at least 16 ms. Timer calls still return their synchronous local handle.

### `context.services`

Extensions with the `services` capability can publish a namespaced, versioned service or consume one from another Extension. A service exposes JSON-safe operation arguments and results through the asynchronous bridge.

```ts
const stop = context.services.provide({
  id: "example.summary",
  version: "1.0.0",
  methods: { summarize: (value) => ({ value }) },
});

const available = await context.services.resolve("example.summary", "1.0.0");
const result = await context.services.call("example.summary", "summarize", [42]);
const off = context.services.onChange("example.summary", (next) => {
  console.log(next?.provider ?? "unavailable");
});
```

Service ids are lowercase namespaced identifiers. Only the provider Extension may replace its registration; disabling or unloading it makes consumers observe an unavailable state and releases every registered callback.

### Provider-backed data and epochs

Use `provideData` when the value itself is the contract between packages. The provider owns the snapshot and advances its epoch whenever the value changes:

```ts
const stop = context.services.provideData({
  id: "example.summary",
  version: "1.0.0",
  initial: { count: 0 },
});

await context.services.updateData("example.summary", { count: 1 });
```

A consumer reads the latest bounded JSON snapshot and can subscribe to the same stream:

```ts
const current = await context.services.readData<{ count: number }>("example.summary", "1.0.0");
const off = context.services.onDataChange("example.summary", (next) => {
  if (!next) return; // The provider is unavailable.
  console.log(next.epoch, next.value.count);
});
```

The first snapshot starts at epoch `0`; every update increments it. Replacing, disabling, unloading, or reloading a provider advances the epoch and sends `null` to subscribers until a compatible provider becomes available. Consumers should discard a computation when its captured epoch differs from the latest snapshot. Values are JSON-cloned and stay within the bridge's depth, node, and byte limits.

`context.api.values.define` and `getHandle` return bridged handles. Every handle method returns a promise, `subscribe` resolves to a disposer, and `subscribeKey` is an alias for `subscribe`. `define` takes the public `{ id, initial }` shape; `persist`, `storageKey`, and `legacyStorageKey` are ignored, and `validate`, `merge`, and `equals` cannot cross the asynchronous bridge and must be omitted from a definition. A package still writes only its own declared values, and a local id resolves to its owner-qualified value when that value is registered.

### Public hooks

Packages that declare the `hooks` capability can publish and invoke namespaced hooks through `context.hooks`:

```ts
context.hooks.register(
  "example.provider:decorate",
  (payload) => ({ label: `${payload.label} ✓` }),
  { fields: { label: { type: "string", required: true } } },
  10,
);

const result = await context.hooks.invoke("example.provider:decorate", { label: "Note" });
```

Hook names use the provider package id as their namespace. Each hook publishes a field schema; required fields and primitive types are checked before invocation and after every handler result. Handlers run from highest priority to lowest, then registration order. Each handler may return a JSON object whose fields are shallow-merged into the payload; returning `{ cancel: true }` stops the remaining handlers and sets `result.cancelled`. Unknown names, invalid JSON payloads, cancellation, timeout, and handler failures use stable `PublicHookError` codes. Registrations belong to the activation scope and disappear when the package is disabled or unloaded.

## Parameters and shortcuts

A script may declare an `ExtensionParameterSchema` with these parameter kinds: `number`, `boolean`, `text`, `select`, `color`, `beat`, `judgeLine`, and `expression`. The shared parameter dialog renders the schema before a parameterized script runs.

A `judgeLine` parameter passes an integer line index, or an ordered array when `count` is greater than one or `multiple` is set. `count` fixes the expected number of lines; `multiple` without `count` accepts an exact list of any length. When the count is known, the field offers exact, range, and global modes: exact keeps the written lines and order, range draws the required count from the written candidates, and global draws from every line in the chart. An unbounded list offers exact only. Lists use the toolbar syntax (`1,3:5`). The free-line action reuses a line with no notes, events, child lines, or parent, and appends a scratch line only when every candidate is occupied. A scratch line is removed when the dialog is cancelled and reused by later dialogs while it stays empty.

Scripts may declare default shortcuts. Registering them requires the `shortcuts` capability; a script that omits it keeps running but its default bindings are ignored with a host warning. A script's default shortcut registers as `extension.<owner>.script.<local>`; explicit `api.shortcuts` registrations and package values use `extension.<owner>.<local>`. Bindings stored under the former `mod.<owner>.script.*` id migrate to the Extension id on first load. `shortcutScope` is `app`, `instrument`, `workspace`, or `editor`, and defaults to `editor`. The scripts pane and the shortcut editor are the listing surfaces.

## Declarative steps

Data-only packages and script definitions may use these step operations:

| Operation     | Contract                                                                 |
| ------------- | ------------------------------------------------------------------------ |
| `batch`       | Runs a multi-edit over `notes` or `events` with the declared parameters. |
| `transaction` | Applies one `ChartTransactionRequest` through the transaction owner.     |
| `select`      | Selects the `original` or `changed` objects from the preceding steps.    |
| `notice`      | Emits one localized notice.                                              |

A step value may be a literal, a validated parameter reference (`{ "parameter": "name" }` or `{ "expression": "..." }`), an array, or a record. There is no arbitrary code step.

## Panels, overlays, and sidebar entries

`ui.registerPanel` and `ui.registerOverlay` take a declarative element/text tree and return `{ update(tree, options?), dispose() }`. The host renders the tree; nodes never receive host DOM, React components, or file handles. Interactive nodes carry stable ids and report click, input, change, or file events through the bridge.

Stage overlays are the default: they sit above the authoring canvases and below shell notices. `scope: "window"` fills the application window and can cover the toolbar or inspector; window overlays render below modal scrims. The host layer ignores pointer input, so set `pointer-events: auto` in the tree when an overlay needs direct interaction.

Sidebar separators are independent entries: register a divider and the adjacent icon with separate `ui.registerSidebar` calls. Every registration returns a disposer and is removed when the package unloads.

## Design tokens, sidebar navigation, and JSON storage

These interfaces form the Extension design kit: a package reads the active design system, then reuses the host navigation and storage paths from menus, toolbar actions, and panels.

### `api.theme.tokens()` and `api.theme.subscribe(listener)`

Read the design tokens the host currently applies, and receive a callback when the theme or density changes.

```ts
api.theme.tokens(): Promise<ExtensionThemeTokens>;
api.theme.subscribe(listener: () => void): Promise<void>;
```

```js
// Read the active tokens once, then build the tree from them.
const tokens = await api.theme.tokens();
const card = context.ui.registerPanel({
  id: "theme-card",
  tree: {
    kind: "element",
    tag: "div",
    style: {
      color: tokens.colors.foreground,
      background: tokens.colors.panel,
      border: `1px solid ${tokens.colors.border}`,
      borderRadius: tokens.radii.control,
      padding: tokens.spacing["3"],
      fontFamily: tokens.fonts.family,
    },
    text: `${tokens.theme.name}, ${tokens.theme.appearance}, ${tokens.theme.density}`,
  },
});

// Re-read tokens after a theme or density change and redraw once.
context.api.theme.subscribe(() => {
  void context.api.theme.tokens().then((next) => {
    card.update({
      kind: "element",
      tag: "div",
      style: { color: next.colors.foreground, padding: next.spacing["2"] },
      text: `${next.theme.name}, ${next.theme.density}`,
    });
  });
});
```

The snapshot contains `theme` (`id`, `name`, `appearance`, `density`), semantic `colors` (`foreground`, `background`, `panel`, `border`, `accent`, `danger`, `warning`, `success`, `muted`), `radii`, `spacing`, `fonts` (`family`, `monoFamily`, `sizes`), `shadows`, and `motion` (`durations`, `easings`). Every leaf is a string read from the document's applied tokens. Use these fields for extension-owned trees and styles so the surface follows the active theme.

**Permission and limits:** `styles`, shared with `context.styles`. Theme listeners share the 128 event-subscription budget and are released with the activation; `subscribe` has no cancellation hook. A listener that throws is charged to the package failure budget and does not interrupt other listeners.

**Failures:** accessing `api.theme` without `styles` throws `capabilityDenied`. `tokens()` rejects when the host token surface is unavailable. There is no separate theme error code.

**Related:** `context.styles.add`, declarative panel and overlay trees, `ui.registerPanel` / `ui.registerOverlay`.

### `api.sidebar.open(id)` and `api.sidebar.close(id)`

Open or close one sidebar route owned by this package.

```ts
api.sidebar.open(id: string): Promise<boolean>;
api.sidebar.close(id: string): Promise<boolean>;
```

```js
// The route was registered earlier:
// context.ui.registerSidebar({ id: "inspector", panelId: "panel", icon: {...} });
const opened = await api.sidebar.open("inspector");
if (!opened) {
  context.ui.notice({ key: "notice.sidebarMissing" }, { level: "warning" });
}

// Closing is a no-op when another panel is active.
const closed = await api.sidebar.close("inspector");
```

A bare local id resolves to this package's `api.sidebar` registration or its `context.ui.registerSidebar` route. Both methods return `false` for a missing item or a separator. `open` runs the route's normal activation path; `close` asks the mounted inspector to close only while that route's panel is the active pane.

**Permission and limits:** `ui.sidebar`, with an owner check. An id registered by another package or a host entry is refused with `capabilityDenied`; opening or closing another route never changes that route's state.

**Failures:** `capabilityDenied` for another owner; `false` for an unknown id or a non-item entry.

**Related:** `api.sidebar.register`, `context.ui.registerSidebar`, `api.contextMenu` and `api.toolbar` action runners.

### `context.storage.getJSON(key)` and `context.storage.setJSON(key, value)`

Store and read plain JSON through the package's owner-scoped storage entries.

```ts
context.storage.getJSON<T = unknown>(key: string): Promise<T | null>;
context.storage.setJSON(key: string, value: unknown): Promise<void>;
```

```js
// Missing or unparseable entries read as null, so a default keeps working.
const previous = (await context.storage.getJSON("recent-opens")) ?? [];
await context.storage.setJSON(
  "recent-opens",
  [Date.now(), ...(Array.isArray(previous) ? previous : [])].slice(0, 10),
);

const history = await context.storage.getJSON("recent-opens");
console.log(history);
```

`setJSON` accepts objects, arrays, strings, finite numbers, booleans, and null. It serializes once and writes the same owner-scoped string entry used by `context.storage.set`; `getJSON` parses that entry.

**Permission and limits:** `storage`; keys are 1-128 characters and the encoded value is limited to 256,000 bytes. The key is scoped to the calling package, so another package's entry is not addressable. Disabling or unloading preserves these entries; uninstalling the package removes them.

**Failures:** `getJSON` returns `null` for a missing key, malformed JSON, or an entry over the size bound. `setJSON` with a non-JSON value throws `storageValueNotJson`; an encoded value over 256,000 bytes throws `storageValueTooLarge`. The owner-scoped string entry is unchanged when either check fails.

**Related:** `context.storage.get`, `set`, `delete`, and `clear`.

## Right-click menu rows

`ui.contextMenu` adds rows to a surface's right-click menu. A row names the surfaces it belongs to, its label, and a runner; `shortcut` is display text, while `shortcutId` borrows a registered shortcut's live binding. The host strips `shortcutId` from package registrations, so a package cannot claim a host binding. Ids are owner-qualified as `extension.<owner>.<local>`, and `get` and `entry` return only this package's rows. `update` replaces a row in place and `unregister` removes it; both accept the local id or the owner-qualified id and reject an id owned by another package.

```js
const row = {
  id: "trim",
  order: 100,
  contexts: ["notes", "events"],
  label: "Trim selection",
  shortcut: "Ctrl+T",
  run: (target) => console.log(target?.surface),
};
const dispose = await api.contextMenu.register(row);
await api.contextMenu.update({ ...row, label: "Trim notes" });
const rows = await api.contextMenu.get();
const stop = await api.contextMenu.subscribe(() => {});
await api.contextMenu.unregister("trim");
stop();
dispose();
```

A row's `contexts` names the menu surfaces that draw it. The timeline renders `notes` and `events`; the remaining names are reserved for the menu sites that own them. Every sandbox call is asynchronous, so the handle returns promises even when the host operation itself is synchronous.

Extension UI owns its own panels, overlays, sidebar routes, and toolbar entries. It cannot replace the host title bar, application menu, toolbar frame, inspector frame, or window controls; those are theme-only presentation contracts. A package that needs a full window skin ships a data-only theme package, which the user installs separately through Appearance and confirms before its custom UI applies. The `styles` capability is scoped to the package's own panel and overlay mounts; selectors cannot reach host chrome. A style sheet is wrapped in an owner-scoped `@scope` against the mount attribute, so a rule such as `.redux-titlebar` matches nothing outside that package's surfaces. Document-global at-rules (`@keyframes`, `@font-face`, `@property`, `@counter-style`, and `@page`) are rejected because their names are not scoped to the mount; `@import`, `@namespace`, and nested `@scope` are rejected as well.

## Versioned design components

The sandbox exposes a host-owned design catalog through `context.ui`. The catalog lists supported slots and versioned primitives; the first export contains `text`, `button`, and `stack` for the `inspector.panel` and `editor.drawer` slots.

```ts
const catalog = await context.ui.designCatalog();
const dispose = context.ui.registerDesignPanel({
  id: "summary",
  slot: "inspector.panel",
  component: {
    type: "button",
    version: 1,
    props: { id: "refresh", label: "Refresh", variant: "solid" },
  },
  onEvent(event) {
    if (event.nodeId === "refresh" && event.kind === "click") {
      // Refresh the Extension's own state.
    }
  },
});
```

The host validates the slot, component version, closed props schema, tree depth, child count, and node count before rendering. Components resolve to host-owned design primitives; package code cannot pass React elements, DOM nodes, CSS, URLs, or product-domain objects through this contract. A returned disposer removes the registration, and the activation scope removes it again when the package is disabled or unloaded.

The complete provider/consumer, hook, and design-slot example is in [`sdk/examples/composition.ts`](../sdk/examples/composition.ts). It is type-checked with the published SDK surface.

## Transactions

Chart writes go through `api.transaction` and require `chart.write`. A request may update chart `metadata`, judge-line fields under `lines.update`, and individual notes or events under `notes` and `events`. The transaction is validated, applied once, and recorded in undo history.

`preview(request)` returns a preview id when the result is `previewed`; pass that id to `apply(previewId)` or discard it with `cancel(previewId)`. `apply` status is `committed`, `unchanged`, `rejected`, `conflict`, or `unavailable`, with issues, affected object ids, and history metadata inside `value`. Do not mutate chart objects directly.

## Trust

`author`, `license`, and provenance URLs are metadata. Trust is host-computed from the package bytes and a user confirmation bound to the current fingerprint. The states are `builtin`, `local-trusted`, `external-pending`, and `blocked`; consent is `none`, `current`, or `stale`. Changed bytes require confirmation again.

Only a package whose id, version, manifest, translations, and entry bytes match the canonical digest of the shipped package is marked built-in. An unverified package cannot claim a `builtin.*` id, and a portable package never shadows a shipped root. Built-in entries use a deferred loader and are not evaluated until enabled. The first-launch default set is `builtin.distribute-scale-stagger` and `builtin.mirror-notes`; a persisted enable or disable choice wins.

Mutation hooks (`session:before-commit`, `chart:parse`, `chart:parsed`, `chart:validate`, `chart:serialize`, and document lifecycle hooks) are not available in the sandbox. Use an explicit transaction or the public document and chart APIs. Owner-scoped ids keep package resources separate: script-default shortcuts use `extension.<owner>.script.*`, while explicit shortcut, toolbar, and value registrations use `extension.<owner>.*`; a package may write only its own declared values. Legacy `mod.<owner>.script.*` bindings are migrated once.

## Safe mode

Safe mode skips all Extension code for one launch. The host still registers manifests and reads package text, but it never evaluates an entry or enables a default built-in, so Settings → Extensions remains available for disabling or removing the package that broke the previous launch.

Safe mode is entered when the launch URL sets `extensions=off` (or the legacy `mods=off`), when the desktop host starts with `--extensions-off` or its watchdog marks the previous activation pass as unfinished, or when the user chooses **Start in safe mode** on the startup failure screen. That last request is stored once and cleared as soon as the next launch consumes it, so the following normal start loads Extensions again.

## Preview geometry

`api.preview` reads the objects visible in the last painted live-preview frame: notes, holds, and judgement lines. `snapshot()` reads the current frame once; `frame(request)` renders an offscreen frame selected by chart seconds or beat and resolves to an encoded data URL; `subscribe(listener)` follows painted frames and resolves to a disposer. A listener receives `null` when the document is cleared or the preview is hidden. Frame rendering never seeks playback or changes the live preview; each edge defaults to a 960×540 frame, accepts 16–1920 pixels, and the total area is capped at 1,000,000 pixels. Supported encodings are `png`, `jpeg`, and `webp`.

```js
const result = await api.preview.snapshot();
if (result.ok) {
  const { bounds, viewport, objects } = result.value;
  for (const object of objects) console.log(object.id, object.client.head);
}
const stop = await api.preview.subscribe((snapshot) => {
  if (snapshot) drawFromSnapshot(snapshot);
});
```

Each object carries a stable chart id (or an index fallback) and two coordinate spaces: `client` is relative to the application viewport and `surface` is relative to the preview canvas's top-left corner. `bounds` is the canvas in client space, `viewport` is the painted frame inside it, and `rotation` is clockwise degrees. Use `api.hitTest.geometry()` for the collision geometry used by picking. A consumer that animates runs its own clock through `timers` and reuses the latest snapshot between paints.

## Layout anchors

`api.layout.anchors()` returns the visible host regions (`workspace`, `toolbar`, `inspector`, `sidebar`) and visible form controls. Each entry has an id, kind, host label, and client-space rectangle. Values, input text, and DOM nodes are never exposed. Sample it on demand from the consumer's own animation loop.

```js
const layout = await api.layout.anchors();
if (layout.ok) {
  for (const anchor of layout.value) console.log(anchor.kind, anchor.label, anchor.client);
}
```

## SDK

`sdk/index.d.ts` is the types-only author surface. It forwards the curated `src/core/api/sdk.ts` barrel, which re-exports manifest, context, script, parameter, step, i18n, and trust types from the runtime modules. `npm run check` type-checks the entry and examples. The SDK has no runtime.
