# AGENTS.md

RPE Redux is a Windows desktop chart editor. The product UI is React and TypeScript in `src/`, hosted by Tauri in `src-tauri/`, with a local Go/SQLite service in `src/backend/`. `npm run desktop` is the supported product entry point.

## Read first

| Decision | Read |
| --- | --- |
| Installing, first chart, workspace tour, data locations | [Getting started](docs/getting-started.md) |
| Layers, runtime direction, registries, commands, menus, shortcuts | [Architecture](docs/architecture.md) |
| UI surfaces, core ownership, workspace composition, inspector registration | [Architecture](docs/architecture.md), [Development](docs/development.md) |
| Values, preferences, settings schemas | [Architecture](docs/architecture.md) |
| Test suites, fixtures, smoke groups, where a new test belongs | [Testing](docs/testing.md) |
| Host, packaging, updates, portable deployment | [Desktop runtime](docs/desktop.md), [Compatibility](docs/compatibility.md) |
| Chart format and bundled resources | [Compatibility](docs/compatibility.md) |
| Keyboard defaults and the left-hand layout | [Keyboard](docs/keyboard.md) |
| Extensions and the public SDK | [Extensions](docs/extensions.md), [SDK](sdk/README.md) |
| Contribution workflow, release notes, and review expectations | [Contributing](CONTRIBUTING.md) |

## Ownership

- `core/` stays host-independent: it imports core modules only and leaves `frontend/` and `design/` to the host layer.
- `design/` contains reusable visual and interaction primitives. It does not import product domain types from chart, editor, document, or media modules; use a local structural type when a primitive needs only a few fields.
- `frontend/` owns visible product surfaces and may import core implementation modules directly. `core/api/` assembles the host facade; packages receive a capability-gated view, and `window.redux` is only installed for development and automation.
- `core/global/chart/` contains chart rules and calculations only. It does not import React, Tauri, storage, or the network.
- React owns the DOM and feature-local surfaces. A component renders each host and passes it to the imperative engine through a local surface handle. The engine does not create a React root, manufacture shell nodes, or search for another component's node.
- Add a feature to the module that owns its surface or domain rule, then register it through the existing contribution registry. New categories, panels, fields, and commands arrive as registered contributions beside their owner.
- Put a rule beside the data it governs, a visual fact beside its surface, and a host operation behind a platform adapter.

## Verification

Run from the repository root before reporting work complete:

```powershell
npm run check
npm run verify
npm run build
npm run build -- --debug
npm run smoke
```

`npm run check` runs TypeScript, ESLint, style rules, documentation links, icon checks, the SDK type-check, the Extension method registry check, the TypeScript unit suite, and the Go tests. `npm run verify` adds formatting. The stable interaction suite is the P0 smoke suite under `src/test/e2e/`: API and Extension contract, document open/create/save, settings pages, session restore, workspace surfaces, and judge-line folders. Feature-specific regression suites are not part of the default run. It launches the debug executable, so build that first. The repository has no tracked Git hook. [Testing](docs/testing.md) lists each suite, its command, and where a new test belongs.

Run `npm run build -- --debug` when a change touches runtime wiring, the Go service, Tauri integration, or behavior only visible in the packaged application. Compiler, unit, and lint checks verify source; inspect the running desktop app for behavior that affects input, rendering, playback, or native dialogs.

One-off probes, migration snapshots, and temporary tools stay outside the checkout. Build outputs belong in `dist/`, `src-tauri/target/`, or `release/` according to the npm scripts.

## Conventions

- Use explicit `.ts` and `.tsx` extensions for local core, frontend, and design imports.
- Send every user-visible string through `src/i18n/`; add English and Chinese keys together and keep catalog parity. Thrown errors, backend responses, and other diagnostic messages stay in English; translate them only at the UI boundary when they are shown to a person.
- Keep code comments in English. Chinese documentation uses `*-zh.md`; English documentation omits that suffix.
- Resolve cascade conflicts with the owning selector, source order, or a more specific component selector; the style gate enforces this by rejecting `!important`.
- Source colours, font families, surface radii, and common spacing steps from the design tokens and the active theme. `npm run check` rejects raw values; the colour picker's hue model and the colour field's computed contrast value are the documented raw-colour exceptions.
- Every source file starts with a concise English header comment that states what the file owns and why it exists. Document every exported function, class, and method, plus non-obvious parameters and invariants, next to its declaration.
- Comments state the current contract: purpose, inputs, outputs, and invariants. History, workarounds, and pitfalls stay in the issue tracker or the task record, not in the source tree.
- Preserve `LICENSE`, `NOTICE`, resource manifests, and compatibility-sensitive chart serialization when reorganizing files.
- Inspect `git status --short` first. Preserve unrelated work in this shared tree, edit only the ownership area required by the task, and use targeted edits.
- Update the relevant README or ownership document when the tree or a public contract changes.

## Documentation

Documentation states what an area is for, which contract it owns, and where its implementation lives. Write the current rule or schema; leave history, troubleshooting, and decisions in the issue tracker or the task record. Keep documents short enough to scan and link to the owning code when a reader needs specifics. Record user-visible changes in the release notes when publishing, and keep the English and Chinese guides aligned when both exist.
