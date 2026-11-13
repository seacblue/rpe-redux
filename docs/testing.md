# Testing

RPE Redux has one source gate, one unit suite, one desktop smoke suite, and a thin set of platform checks. This page says what each one covers, how to run a single case, and where a new test belongs.

For everyday behavior checks, use the browser loop (`npm run dev`) and let hot reload apply the change. The source gate is the reporting check; the desktop smoke suite validates the packaged window and belongs at final acceptance, after a debug build.

## Contents

- [Suites at a glance](#suites-at-a-glance)
- [Source gate](#source-gate)
- [Unit suite](#unit-suite)
- [Streaming chart pipeline](#streaming-chart-pipeline)
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
| Smoke suite | `npm run smoke` | Contract journeys and experience journeys against the packaged window | `npm run build -- --debug`; Windows |
| Go service | `npm run test:server` | `src/backend/**/*_test.go` | Go 1.25.3+ |
| Rust | `npm run check:native` | `cargo fmt --check` and `cargo check` | Rust stable |
| Docs site | `npm run build:docs` | Extension SDK site into `docs-site-dist/` | `npm ci` |
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
npm run test:server
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

### Streaming chart pipeline

`src/test/chart/streaming/` owns the streaming contract:

| File | Contract |
| --- | --- |
| `chartStreamCodec.test.mjs` | Length-prefixed frames survive arbitrary chunk boundaries; line batches preserve raw JSON. |
| `chartStreaming.test.mjs` | Scanner ranges, line summaries, paged loading, frame parsing, fingerprint equality, and serialization round trips. |
| `chartStreamingRenderEquivalence.test.mjs` | A paged scene matches the full scene for line state and visible notes, including static lines, judge-line events, and zero/low/negative note speeds. |
| `chartFiles.test.mjs` | A single JSON file reaches the document loader with a streaming document. |
| `chartLibraryStreaming.test.mjs` | Library summary + asset manifest + header/index frames become a paged document; line batches are fetched on demand. |
| `chartPagedSession.test.mjs` | Paged edits, line insertion/removal, undo/redo, and save stream round trips. |

The render-equivalence suite is the correctness gate for paging: it compares `SceneRuntime` sampling and `visibleNotes` against the full chart for deterministic tricky and randomized corpora. Do not replace it with a pixel snapshot; the scene data is the renderer's shared input.

`chartPagedSession.test.mjs` covers paged edits, line insertion/removal, undo/redo, and save-stream round trips. The editor enables the paged session above 10,000 lines, or for a chart whose indexed notes and events exceed 100,000 objects, only when no Extension, Code Cell, or collaboration session needs the synchronous full chart; those features keep the eager path. A dense chart skips the initial time-window preload, so startup materializes only the selected line and its ancestors.

Use the benchmark for scale comparisons, not as a unit test:

```powershell
npm run benchmark:streaming -- --lines 2000 --notes 20
npm run benchmark:streaming -- --lines 10000 --notes 20 --visible-time 1
```

`--visible-time` controls the note pre-roll window used by the generated corpus. A large value (the default) makes every line a conservative paging candidate; a bounded value demonstrates the time-window working set. Both runs are useful: the first measures conservative correctness, the second measures paged loading.

It reports whole-chart parse, scan/index, eager materialization, paged time-window loading, and chunked serialization with heap/RSS. The numbers are machine-specific; compare runs on the same host.

`npm run benchmark:crud` measures the edit path that pointer drags, keyboard edits, and inspector fields hit: note and event update, delete, and insert through the public transaction API, for a cold session and for an importer-seeded session. It reports median, p95, and max against the 3 ms per-edit ceiling (a 144 Hz frame is 6.94 ms, and an edit shares that frame with rendering) and never exits non-zero because a machine is slow. Pass `--chart-file path/to/chart.json` to measure a real chart, `--chart` to run one case, `--iters` for more samples, and `--json` for machine-readable output. The committed `chartEditBudget.test.mjs` guards the transaction work counters and the fingerprint round trip instead of wall-clock time, so it can run in the unit suite.

## Desktop smoke suite

`npm run smoke` launches the debug executable and runs the journeys from `src/test/e2e/journeyGroups.mjs`:

| Group | Journey |
| --- | --- |
| `api-contract` | `window.redux` API and Extension contract |
| `documents` | cold open, PEZ open with resources, PE package conversion, create, save round trip, replace policy |
| `settings` | settings pages and persistence |
| `session-restore` | restart with the same profile and restore the workspace |
| `experience-create` | home → Ctrl+N → pointer placement, selection, nudge, undo/redo, delete, hold placement, region toggle, playback |
| `experience-events` | event-field placement through the keyboard path and undo |
| `experience-settings` | settings window from the home button, rail navigation, a real toggle, and its persistence across close/reopen |

The first four groups are **contract journeys**: they keep the shared startup chart and call the public API, so they prove the document and Extension pipeline. The `experience-*` groups are **experience journeys**: they start on the home screen (`startsAtHome`), press real keys, move a real pointer over the timelines, and click real toolbar and settings controls, then assert the resulting document, selection, and DOM state. A mixed selection needs one process per group, which `npm run smoke` does.

```powershell
npm run build -- --debug            # prerequisite
npm run smoke                       # every group, one fresh profile per group
npm run smoke -- --list             # group names
npm run smoke -- --scenario=documents
npm run smoke -- --scenario=experience-create
```

The runner creates an isolated profile under `.scratch/e2e-smoke-quality/runs/` and writes screenshots and round-trip artifacts under `.scratch/e2e-smoke-quality/artifacts/`. It drives the real window through the WebView2 debugging protocol, so it runs on Windows only; Linux acceptance stays manual until an equivalent driver exists.

Treat the smoke suite as a final acceptance check, not an edit loop. It needs a fresh debug build, so run it after the browser checks and the source gate are green.

A journey is an async function that receives the runner. Use `runner.callApi` for product API calls, `runner.evaluate` for DOM probes, `runner.waitFor` instead of fixed sleeps, and `runner.assert` for checks. Contract journeys start with `startupPath`, experience journeys with `startAtHome`; a journey that drives window input marks itself with `startsAtHome = true`. Feature-specific journeys are not part of the default run: unit-test the extracted rule, and add a journey only for a P0 interaction that must be proven end to end.

Keep implementation-detail assertions out of the unit suite. A test that pins "this function reuses a buffer", "this value is cached", or "this call happens once" belongs to the change that introduced it, not to the repository: it fails on harmless refactors and proves nothing about the product. Assert the observable result instead — rendered output, parsed document, selection, or visible layout — and leave the fast path free to change.

## Quick audio check

```powershell
node --test src/test/editor/timeline/timeStretch.test.mjs
npm run dev:desktop
```

The unit suite checks that 1× preserves decoded samples through a transient. At slower rates it checks pitch, duration, stereo phase, and attack timing. In the desktop app, open a chart with clear drum attacks and a sustained sound. Set the four hit-sound levels to zero under **Settings → Audio**. At 1×, play the same five to ten seconds with **Keep pitch when changing speed** on and off at the same music level. Listen to the attacks and the sound between them. On v1.0.0 the two settings can produce different audio around attacks. With unity-rate passthrough they should sound alike once playback settles.

Enable pitch preservation and replay the section at 0.75×, 0.5×, and 0.25×. Listen for repeated attacks or wavering sustained tones. Switch back to 1× while playing, then seek and resume to check playhead alignment. Restore the hit-sound levels and replay the section to isolate artifacts that only occur when hit sounds are mixed in.

## Platform checks

- `npm run test:server` runs the Go service tests in `src/backend/`. The collaboration room tests bind ephemeral ports and clean up their data directory.
- `npm run check:native` checks Rust formatting and compilation. It does not run Rust unit tests; use `cargo test --manifest-path src-tauri/Cargo.toml` when a change adds one.
- `node scripts/checkExtensionMethods.mjs` (also `npm run check:extensions`) is the static gate for the Extension method registry; it runs in `npm run check`.
- `npm run build:docs` builds the Extension documentation site; its renderer, links, navigation, and generated API pages are exercised by `src/test/docs/site/docsSite.test.mjs` as part of `npm run test:unit`.

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
- **`npm run dev` reports its ports are already in use** — another loop is probably running in this worktree. Stop it; if the recorded set is truly stale, rotate it with `npm run dev -- --new-ports`. Do not copy another worktree's `.scratch/dev/ports.json`.
- **The two sidecar suites are skipped** — `npm run build:server` writes `src-tauri/resources/redux-service(.exe)`.
- **Smoke fails to start the window** — a previous run can hold the loopback port or the profile. The runner retries three times; if it still fails, close the leftover `rpe-redux` processes and retry.
- **`npm run check:docs` rejects a link or language** — links are relative to the document, and English documents cannot contain Han characters.
- **A drift or lost update after a quick successive run** — the collaboration suites compare revisions; rerun the single suite before assuming a source bug.

## Housekeeping

`.scratch/` is gitignored scratch space, not part of the tree. Test runs leave profiles, screenshots, and temporary databases there; delete the folder when it grows or when a run reports a stale lock. The tracked suites are the ones listed above — a `.mjs` under `src/test/` that no command reaches is a helper or dead weight, not a test. Keep that distinction when adding a file: runnable tests end in `.test.mjs`, shared harnesses do not.
