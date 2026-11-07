# Testing

RPE Redux has one source gate, one unit suite, one desktop smoke suite, and a thin set of platform checks. This page says what each one covers, how to run a single case, and where a new test belongs.

## Contents

- [Suites at a glance](#suites-at-a-glance)
- [Source gate](#source-gate)
- [Unit suite](#unit-suite)
- [Desktop smoke suite](#desktop-smoke-suite)
- [Quick audio check](#quick-audio-check)
- [Platform checks](#platform-checks)
- [Fixtures](#fixtures)
- [Adding a test](#adding-a-test)
- [Troubleshooting](#troubleshooting)
- [Housekeeping](#housekeeping)

## Suites at a glance

| Suite | Command | Covers | Needs |
| --- | --- | --- | --- |
| Source gate | `npm run check` | Types, lint, style rules, Less compile, docs links, icons, SDK, unit suite, Go tests | `npm ci` |
| Formatting gate | `npm run verify` | `check` plus Prettier over source and docs | `npm ci` |
| Unit suite | `npm run test:unit` | `src/test/**/*.test.mjs` | Node.js 22.18+ |
| Smoke suite | `npm run smoke` | Four P0 journeys against the packaged window | `npm run build -- --debug`; Windows |
| Go service | `npm run server:test` | `src/backend/**/*_test.go` | Go 1.25.3+ |
| Rust | `npm run check:native` | `cargo fmt --check` and `cargo check` | Rust stable |
| Docs site | `npm run docs:build` | Extension SDK site into `docs-site-dist/` | `npm ci` |
| Extension methods | `npm run check:extensions` | Method registry vs capability gate (part of `check`) | `npm ci` |

CI runs `npm run verify` on Windows and `npm run check` on Linux (`.github/workflows/check.yml`). When a change touches `src-tauri/**`, the same workflow also runs a conditional Linux Rust job with `cargo fmt --check` and `cargo check`. The desktop smoke suite stays local because it needs a built desktop executable. There is no tracked Git hook; run the gates yourself before reporting.

## Source gate

`npm run check` is the gate every change must pass:

```powershell
npm run check:types   # tsc --noEmit over src/
npm run check:lint    # eslint .
npm run check:style   # style rules + Less compile
npm run check:docs    # docs/ links and language rules
npm run check:icons   # theme icon coverage
npm run check:sdk     # tsc -p sdk/tsconfig.json
npm run check:extensions # Extension method registry vs capability gate
npm run test:unit
npm run server:test
```

`npm run verify` adds `prettier --check` over source, scripts, and all maintained Markdown, TypeScript, JavaScript, JSON, and HTML files. `npm run fix` applies ESLint and Prettier fixes to source, scripts, and maintained Markdown, TypeScript, JavaScript, JSON, and HTML files.

The style gate rejects raw colours, fonts, radii, and `!important`; take values from the design tokens. The docs gate rejects Han characters in English documents under `docs/` (only `*-zh.md` may contain Chinese), a missing local link target, and resurrecting `docs/agents/`. It scans `docs/` only: relative links in the root `README`, `AGENTS.md`, and `CONTRIBUTING` are not gated, and Prettier in `npm run verify` covers `docs/**/*.md`, not the root Markdown files.

## Unit suite

`npm run test:unit` runs `node --test "src/test/**/*.test.mjs"`. The files execute the TypeScript sources directly through Node's built-in type stripping, so there is no bundler step and no compiled test output.

```powershell
npm run test:unit                          # whole suite
node --test src/test/editor/transactions/transactionKernel.test.mjs
node --test --test-name-pattern="delete" "src/test/**/*.test.mjs"
```

Each file owns one contract and starts with a header comment naming it. Tests are grouped below `src/test/` by topic and subsystem, such as `chart/format/`, `editor/events/`, `rendering/preview/`, `extensions/sandbox/`, and `settings/registry/`. The files import production modules with explicit `.ts` extensions and use `node:test` with `node:assert/strict`. There are no per-directory fixtures for the unit suite; data lives in the test file unless several suites share it.

`src/test/` also holds non-test helpers:

| Helper | Purpose |
| --- | --- |
| `cdpHarness.mjs` | Launches the desktop executable and drives WebView2 over CDP. Used by the smoke suite only. |
| `extensionLifecycleHarness.mjs` | Shared Extension lifecycle fixture used by the Extension suites. |
| `makeFixtures.mjs` | Regenerates and verifies the shared binary fixtures (see [Fixtures](#fixtures)). |
| `e2eJourneySmoke.mjs` | The smoke command-line entry point; `scripts/smoke.mjs` drives it. |

Two suites need the packaged Go sidecar: `collaborationDesktop.test.mjs` and `codeCellTransport.test.mjs`. They skip when `src-tauri/resources/redux-service` is absent; build it with `npm run build:server` to include them. Both start the sidecar on ephemeral ports (`--port 0 --collab-port 0 --ai-port 0`), so they do not collide with a running desktop build. The rest of the unit suite does not touch the window or native APIs; the suites that start a room server use loopback sockets.

## Desktop smoke suite

`npm run smoke` launches the debug executable and runs the P0 journeys from `src/test/e2e/journeyGroups.mjs`:

| Group             | Journey                                                                     |
| ----------------- | --------------------------------------------------------------------------- |
| `api-contract`    | `window.redux` API and Extension contract                                   |
| `documents`       | cold open, PEZ open with resources, create, save round trip, replace policy |
| `settings`        | settings pages and persistence                                              |
| `session-restore` | restart with the same profile and restore the workspace                     |

```powershell
npm run build -- --debug            # prerequisite
npm run smoke                       # every group, one fresh profile per group
npm run smoke -- --list             # group names
npm run smoke -- --scenario=documents
```

The runner creates an isolated profile under `.scratch/e2e-smoke-quality/runs/` and writes screenshots and round-trip artifacts under `.scratch/e2e-smoke-quality/artifacts/`. It drives the real window through the WebView2 debugging protocol, so it runs on Windows only; Linux acceptance stays manual until an equivalent driver exists.

A journey is an async function that receives the runner. Use `runner.callApi` for product API calls, `runner.evaluate` for DOM probes, `runner.waitFor` instead of fixed sleeps, and `runner.assert` for checks. Feature-specific journeys are not part of the default run: unit-test the extracted rule, and add a journey only for a P0 path that must be proven end to end.

## Quick audio check

```powershell
node --test src/test/editor/timeline/timeStretch.test.mjs
npm run desktop
```

The unit suite checks that 1× preserves decoded samples through a transient. At slower rates it checks pitch, duration, stereo phase, and attack timing. In the desktop app, open a chart with clear drum attacks and a sustained sound. Set the four hit-sound levels to zero under **Settings → Audio**. At 1×, play the same five to ten seconds with **Keep pitch when changing speed** on and off at the same music level. Listen to the attacks and the sound between them. On v1.0.0 the two settings can produce different audio around attacks. With unity-rate passthrough they should sound alike once playback settles.

Enable pitch preservation and replay the section at 0.75×, 0.5×, and 0.25×. Listen for repeated attacks or wavering sustained tones. Switch back to 1× while playing, then seek and resume to check playhead alignment. Restore the hit-sound levels and replay the section to isolate artifacts that only occur when hit sounds are mixed in.

## Platform checks

- `npm run server:test` runs the Go service tests in `src/backend/`. The collaboration room tests bind ephemeral ports and clean up their data directory.
- `npm run check:native` checks Rust formatting and compilation. It does not run Rust unit tests; use `cargo test --manifest-path src-tauri/Cargo.toml` when a change adds one.
- `node scripts/checkExtensionMethods.mjs` (also `npm run check:extensions`) is the static gate for the Extension method registry; it runs in `npm run check`.
- `npm run docs:build` builds the Extension documentation site; its renderer, links, navigation, and generated API pages are exercised by `src/test/docs/site/docsSite.test.mjs` as part of `npm run test:unit`.

## Fixtures

`src/test/fixtures/` holds data shared by more than one suite:

| Path | Used by |
| --- | --- |
| `smoke.pez`, `smoke.json`, `smoke.official.json`, `smoke.pec.txt`, `smoke.png`, `smoke.wav` | chart format, PEZ, import, and smoke suites |
| `collab-contract.json` | the shared Go/TypeScript room contract vector |
| `fingerprint.json` and `corpus/` | the chart compatibility corpus |
| `signed-update/` | the Rust updater tests |

`makeFixtures.mjs` owns the generated fixtures and the semantic fingerprint:

```powershell
node src/test/makeFixtures.mjs           # rewrite, then verify
node src/test/makeFixtures.mjs --check   # verify without writing
```

Do not hand-edit a generated fixture. When a change intentionally alters one, run the generator and commit the regenerated file with the test change.

## Adding a test

1. Find the module that owns the rule. Extract a pure function there if the behavior is only reachable through the DOM; test the function.
2. Add `src/test/<topic>/<subsystem>/<subject>.test.mjs` with a one-line header comment stating the contract, then one `test(...)` per contract. Put the file beside related tests and name the behavior, not the function.
3. Import production modules with explicit `.ts` extensions. Assert on returned values and stable error codes instead of implementation detail.
4. For a P0 path that only exists in the packaged window, add a journey under `src/test/e2e/` and register it in `journeyGroups.mjs`.
5. Keep additive tests green in the same run: `npm run test:unit` and, when the change touches runtime wiring, the smoke group that covers it.

Tests should not write outside `.scratch/` or the OS temporary directory. Use `mkdtemp` for scratch directories, close every server and socket in `finally`, and tolerate the Windows delay before a SQLite file can be removed.

## Troubleshooting

- **`npm run smoke` reports a missing debug executable** — run `npm run build -- --debug` first; the smoke runner launches `src-tauri/target/debug/rpe-redux.exe`.
- **The two sidecar suites are skipped** — `npm run build:server` writes `src-tauri/resources/redux-service(.exe)`.
- **Smoke fails to start the window** — a previous run can hold the loopback port or the profile. The runner retries three times; if it still fails, close the leftover `rpe-redux` processes and retry.
- **`npm run check:docs` rejects a link or language** — links are relative to the document, and English documents cannot contain Han characters.
- **A drift or lost update after a quick successive run** — the collaboration suites compare revisions; rerun the single suite before assuming a source bug.

## Housekeeping

`.scratch/` is gitignored scratch space, not part of the tree. Test runs leave profiles, screenshots, and temporary databases there; delete the folder when it grows or when a run reports a stale lock. The tracked suites are the ones listed above — a `.mjs` under `src/test/` that no command reaches is a helper or dead weight, not a test. Keep that distinction when adding a file: runnable tests end in `.test.mjs`, shared harnesses do not.
