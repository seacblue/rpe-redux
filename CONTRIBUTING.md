# Contributing to RPE Redux

RPE Redux is a desktop chart editor for Windows and Linux, built from React,
TypeScript, Tauri, and a local Go/SQLite service. Contributions are welcome when
they keep the product focused and preserve chart compatibility.

[简体中文](CONTRIBUTING-zh.md) · English

## Before you start

Read these documents first:

- [AGENTS.md](AGENTS.md) for ownership, verification, and conventions.
- [Architecture](docs/architecture.md) for layers, runtime composition, and
  feature ownership.
- [Development](docs/development.md) for the local workflow and commands.
- [Testing](docs/testing.md) for the suites, fixtures, and test placement.
- [Compatibility](docs/compatibility.md) before changing chart serialization or
  bundled resources.

## Set up

Requirements: Windows 10/11 with the WebView2 runtime, or Linux with WebKitGTK
4.1; Node.js 22.18+, Go 1.25.3+, Rust stable with the platform C++ toolchain
(MSVC on Windows, `build-essential` on Linux).

```powershell
npm ci
npm run desktop
```

`npm run desktop` stages the native helpers and launches the product window.
`npm run dev` starts only the Vite server.

## Workflow

1. Create a focused branch from `main`.
2. Change the module that owns the behavior, then register the feature through
   the existing contribution registry.
3. Add English and Chinese strings together under `src/i18n/`.
4. Add or update tests beside the behavior they cover; [Testing](docs/testing.md)
   says which suite a change belongs to.
5. Run the source gate and the desktop checks before opening a pull request.
6. Record user-visible changes in the release notes when publishing.

Use a conventional commit subject such as `feat(editor): add curve handles` or
`fix(desktop): restore window geometry`. Keep the subject imperative and the
body limited to the contract and verification.

## Verification

Run from the repository root:

```powershell
npm run check
npm run verify
npm run build
npm run build -- --debug
npm run smoke
```

`npm run check` covers TypeScript, ESLint, style rules, documentation links, icon
checks, the SDK type-check, the Extension method registry check, the TypeScript
unit suite, and the Go tests. `npm run verify` adds formatting.
`npm run build -- --debug` produces the executable used by `npm run smoke`; the
smoke suite covers the P0 desktop journeys. See [Testing](docs/testing.md) for
the individual suites and single-test commands.

Run `npm run check:native` when a change touches Rust. Run `npm run server:test`
when a change touches the Go service or collaboration rooms.

## What belongs where

| Area                                          | Owner                                                   |
| --------------------------------------------- | ------------------------------------------------------- |
| Chart rules, timing, serialization, resources | `src/core/global/chart/`                                |
| Editing session, operations, transactions     | `src/core/edit/`                                        |
| Document lifecycle and library                | `src/core/global/document/`, `src/core/global/library/` |
| Shared visual primitives and tokens           | `src/design/`                                           |
| Visible product surfaces                      | `src/frontend/screens/`                                 |
| Host bridges and platform adapters            | `src/core/platform/`, `src/frontend/platform/`          |
| Desktop window, files, updates                | `src-tauri/`                                            |
| Local HTTP service and SQLite store           | `src/backend/`                                          |
| Extension author contract                     | `sdk/`, `src/core/api/sdk.ts`                           |

`core/` stays host-independent. `design/` does not import product domain types.
`frontend/` may import core implementation modules directly. Chart rules do not
import React, Tauri, storage, or the network.

## Code and documentation

- Every source file starts with a short English header comment that states what
  the file owns and why it exists.
- Document exported functions, classes, methods, and non-obvious invariants next
  to their declarations. One concise sentence is enough when the signature is
  self-explanatory.
- Comments describe the current contract: purpose, parameters, return value,
  and invariants. Historical decisions and open issues belong in the issue
  tracker, not in the source tree.
- User-visible strings go through `src/i18n/`; diagnostic messages stay in
  English and are translated only at the UI boundary.
- Documentation states what an area is for and how it works today. English
  documents use a plain name; Chinese documents use the `-zh.md` suffix.
- Update the relevant README or ownership document when a directory or public
  contract changes.

## Assets, licensing, and compatibility

- Preserve `LICENSE`, `NOTICE`, resource manifests, and compatibility-sensitive
  chart serialization.
- New third-party assets need a compatible license and a notice entry.
- Chart and PEZ round trips must preserve unknown fields, array order, untouched
  beat strings, and resource references.
- Do not commit build outputs under `dist/`, `src-tauri/target/`, or `release/`.

## Pull requests

Every pull request is squash-merged: one pull request becomes exactly one commit
on `main`, and the pull request title becomes that commit's subject. Merge
commits and rebase merges are disabled at the repository level, so write the title
as an imperative conventional-commit subject such as
`feat(editor): add curve handles`, and put the contract and verification details
in the body.

A pull request should answer:

- What user-visible behavior or public contract changed?
- Which module owns the change, and which registry registers it?
- Which checks were run?
- Does the change alter chart serialization, resources, licensing, or
  compatibility?

Keep the diff focused. Do not include unrelated formatting, generated files, or
local experiments. For UI changes, include a screenshot or a short recording of
the affected surface.

## License

RPE Redux is distributed under the
[PolyForm Noncommercial License 1.0.0](LICENSE). By submitting a contribution,
you agree that it may be distributed under the same license. Commercial use
requires separate permission from the copyright holder.
