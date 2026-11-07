# Extension SDK

`sdk/` is the types-only author surface for Extensions. `sdk/index.d.ts` re-exports the curated `src/core/api/sdk.ts` barrel and has no runtime, validator, test host, or npm package. The host contract it describes lives in `src/core/api/`, `src/core/extensions/`, and the owning editor modules.

## Use

Map the SDK entry and import types by name:

```json
{
  "compilerOptions": {
    "strict": true,
    "noEmit": true,
    "moduleResolution": "Bundler",
    "baseUrl": ".",
    "paths": {
      "@rpe-redux/extension-sdk": ["./sdk/index.d.ts"]
    }
  },
  "include": ["sdk/index.d.ts", "sdk/examples/**/*"]
}
```

```ts
import type { TrustedExtensionContext, TrustedExtensionDefinition } from "@rpe-redux/extension-sdk";
```

`sdk/examples/` contains a TypeScript package, a JSDoc JavaScript package, a data-only package, a code-cell example, and `composition.ts`, which type-checks provider/consumer, hook, and design-slot composition against the same public surface. A package registers as many scripts as it needs; data-only packages list them under `scripts` in the manifest.

## Themes and note skins

Themes and note skins are data packages, not Extension code. Use the reference guides in [`src/assets/themes/README.md`](../src/assets/themes/README.md) and [`src/assets/skins/README.md`](../src/assets/skins/README.md) when packaging visual assets:

- A theme is one `package.json` with a palette, optional PNG glyph overrides, and bounded chrome/UI recipes. The shipped reference packages are `dark` and `light`; use `npm run icons:check` to validate every referenced 192×192 PNG.
- A skin is one folder with `manifest.json` and required note textures. Keep audio and particle files package-relative, and validate PNG dimensions, alpha, and manifest paths before copying the package into `skins/`.
- Both surfaces are data-only. They cannot load JavaScript, CSS, HTML, remote URLs, fonts, or arbitrary filesystem paths; the host owns rendering and applies the active theme tokens to every image mask.

## Types

The surface is grouped by handle and contract:

- `ReduxApi`, availability, error, and result types. `ReduxApi` is the asynchronous sandbox facade; the host-only `workspace` and `extensions` handles are intentionally absent from it. The capability-gated `help` handle can open the integrated guide and register step-based tutorials.
- Every fallible runtime operation returns `ApiResult<T>`; chart and transaction domain status stays inside `value`. Subscriptions are the documented exception: every `subscribe` method returns a disposer directly, so the function can cross the sandbox bridge as a handle. A missing runtime yields a no-op disposer; call `availability()` when the caller needs the reason.
- Request/result types for document, chart, selection, playback, hit test, library, toolbar, sidebar, context menu, shortcuts, settings, values, and transaction. Named chart reads (`ChartReadState`, `ChartReadCollection`, `ChartReadItem`), transaction outcomes (`TransactionConflict`, `TransactionPreviewStatus`), revision snapshots (`DocumentRevisions`), and Extension event payloads (`ExtensionEventPayloads`, `ExtensionHookPayloads`) are published alongside the signatures that mention them.
- Extension manifest, capability, context, definition, trust, and provenance types.
- Script, parameter, step, i18n, declarative surface (`SandboxPanelDefinition`, `SandboxOverlayDefinition`, `SandboxSidebarDefinition`), preview snapshot, and layout anchor types.

Add a name in `src/core/api/sdk.ts` to publish it; the entry re-exports that one barrel, so there is no second list to keep in sync. `sdk/type-tests/publicSurface.ts` imports the names that public signatures mention, so `npm run check:sdk` fails when a host type exists but was never published.

## Runtime boundary

An Extension runs in an opaque-origin iframe. Its `context.api` is an asynchronous, capability-gated view of the host handles; every call returns a promise and every result is plain cloned data. `context.api.values.define` and `getHandle` return bridged handles: `get`, `set`, `update`, `subscribe`, and `subscribeKey` cross the bridge, and `subscribe` resolves to a disposer. Each bridged request or result is capped at 32 levels, 500,000 nodes, and 16 MB; an over-limit call rejects with `code: "bridge.limit"`. `context.timers` is the only timer surface; global timer functions are blocked, and the host enforces 64 live handles with a 16 ms interval floor. The sandbox has no host DOM, Tauri IPC, network, worker, child-frame, or `window.redux` access, and the host-only `workspace`, `help`, and `extensions` handles are not part of `context.api`. `context.api` is the package contract; the full host facade used by the development server and automation is an internal implementation surface, not part of the Extension SDK.

Right-click menu rows use `context.api.contextMenu` and require the `ui.contextMenu` capability. The gated handle keeps ids under `extension.<owner>.`, returns only the package's own rows, and strips `shortcutId` so a package can display a key hint without claiming a host binding.

## Code cells

`sdk/llm-guide.md` is the runtime guide served at `GET /api/cell/guide`. It describes the write-capable cell profile, chart shapes, beat triples, limits, the transaction grammar, and asset handling. The served copy omits passages that the user has disabled for AI in **Editor → Advanced editing**; the source file keeps the complete reference. `POST /api/cell/run` executes a cell. `sdk/examples/code-cell.ts` mirrors the same shape and is type-checked with the SDK.

A cell receives `redux`, `input`, and `console`, and returns one JSON value. It can read the open document, apply chart transactions, and add or remove project assets. It cannot save, open, close, create, or delete a document, delete a project, or access the network or host DOM.

## Check

```sh
npm run check                 # type-checks the application, entry, examples, and guard
npx tsc -p sdk/tsconfig.json  # SDK-only check while iterating
```

## Limits

The only manifest validator is `validateManifest` in `src/core/extensions/extensionRuntimeSupport.ts`. Chart and editor internals are not part of the SDK; use `ReduxApi`. The entry re-exports host source types, so type-check an extension inside the RPE Redux checkout (or ship the `src/` type modules alongside `sdk/`). The SDK is types-only; the host runs packages in the sandbox described by the runtime boundary.
