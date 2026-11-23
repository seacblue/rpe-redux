# AGENTS.md

RPE Redux is a Windows desktop chart editor. The product UI is React and TypeScript in `src/`, hosted by Tauri in `src-tauri/`, with a local Go/SQLite service in `src/backend/`. `npm run dev` is the default development loop: it starts the Go service and Vite together and serves the editor in the browser with hot reload. `npm run dev:desktop` opens the Tauri window when a change needs the native host.

## Read first

| Decision | Read |
| --- | --- |
| Installing, first chart, workspace tour, data locations | [Getting started](docs/getting-started.md) |
| Layers, runtime direction, registries, commands, menus, shortcuts | [Architecture](docs/architecture.md) |
| UI surfaces, core ownership, workspace composition, inspector registration | [Architecture](docs/architecture.md), [Development](docs/development.md) |
| Local workflow, browser loop, worktree ports | [Development](docs/development.md) |
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

## Development loop

Use the browser loop for everyday work. Start `npm run dev` once per worktree and leave it running while you edit: Vite reloads interface, editor, settings, and library changes in place. From automation, pass `--no-open` and read the app URL from the console. Do not rebuild the desktop app to check a change that hot reload already applies.

Each checkout owns one fixed, randomly chosen port set in `.scratch/dev/ports.json`. The first `npm run dev` or `npm run dev:desktop` invocation chooses free ports below the Windows ephemeral range; later runs reuse them. This keeps parallel checkouts and concurrent AI sessions from sharing a backend address or database.

- Do not edit, copy, or commit `.scratch/dev/ports.json`, and do not reuse another worktree's ports.
- Run one loop per worktree. If a recorded port is held by an unrelated process, stop that process or rotate the set with `npm run dev -- --new-ports`; do not start a second loop on a fresh set.
- Use `npm run dev:web` for UI shell work that needs no service, and `npm run dev:desktop` only when the change needs native dialogs, OS file drops, the updater, Extension installation, or the collaboration tunnel.

## Verification

Verify in the browser loop while you edit. Run the focused unit test beside the change, then the source gate before reporting:

```powershell
npm run dev                              # hot reload while editing
node --test src/test/<topic>/<subject>.test.mjs
npm run check
npm run verify
```

`npm run check` runs TypeScript, ESLint, style rules, documentation links, icon checks, the SDK type-check, the Extension method registry check, the TypeScript unit suite, and the Go tests. `npm run verify` adds formatting. The stable interaction suite is the smoke suite under `src/test/e2e/`: contract journeys for the API and Extension pipeline, document open/create/save, settings pages, and startup isolation, plus experience journeys that start on the home screen and create, edit, play, and configure through real keyboard and pointer input. Feature-specific regression suites are not part of the default run. The repository has no tracked Git hook. [Testing](docs/testing.md) lists each suite, its command, and where a new test belongs.

Build only for packaged runtime behavior or final acceptance. `npm run build -- --debug` and `npm run smoke` cover runtime wiring, the Go service, Tauri integration, and behavior that only exists in the packaged application; build the debug executable first. Run `npm run check:native` when a change touches Rust. Inspect the running desktop app for input, rendering, playback, native dialogs, and other behavior that the browser loop cannot reach. `npm run build` is the full release build and belongs at the end of the task, not in the edit loop.

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

<!-- aoci:begin -->

## AOCI Repository Cognition

AOCI maintains a stable, versioned, incrementally updatable repository-level cognition layer so models can reuse their understanding of this system across tasks.

`aoci.txt` is a structured cognition index for models. It assigns one independent Entry to every managed file, database table, or other managed object. Symbolic tags and F/R/A/S semantics describe the object's core responsibility, important relationships, external contracts, and non-obvious constraints or design decisions needed to understand or modify the system.

The Header, directory sections, and all Entries form the complete repository index. They can cover frontend, backend, configuration, database structures, and other managed content. When managed content changes, normally only the affected cognition Entries need maintenance; the complete index does not need to be regenerated.

AOCI provides a high-density view of system architecture, object responsibilities, important relationships, external contracts, and key constraints.

### How it works

AOCI uses a model-generated, model-read cognition loop.

Header, Entry, and Curation semantics follow only the current machine-issued Plan and live Guide. The Host model independently authors them from the current bound evidence.

Entry semantics must come from the model's understanding of actual evidence. Never derive, prefill, assemble, or rewrite index semantics solely from paths, filenames, extensions, an AST, symbol lists, dependency scans, regular expressions, fixed templates, or rule engines.

For a Fresh Bootstrap, follow only the current machine-issued Plan and live Guide. When they require authoring, the Host model authors Root, Meta, tags, and F/R/A/S, supplies its authoring-run declaration, and binds it to the Plan, Evidence, and complete Candidate. Never ask AOCI to set `origin=host_model`, manufacture a receipt, or turn a generated framework into semantics. Do not reconstruct the Onboarding progression here. Internal batches are not user decisions; stop only at an existing approval boundary or a real safety, drift, CAS, or Recovery condition.

### Minimal entry points

- `aoci_rules`: obtain the session-level runtime contract for the current AOCI version.
- `aoci_overview`: establish or restore complete cognition for this repository.
- `aoci_maintain`: after managed objects reach their final stable state, check whether cognition needs maintenance.
- `aoci_update_entry`: submit a complete semantic update batch bound to current evidence and source digests.
- `aoci_report`: when the current layout and tool state support it, record follow-up work if evidence is insufficient to generate semantics reliably; do not guess.

For other MCP tools, CLI commands, parameters, and specialized workflows, follow current tool descriptions, Guide, and `--help` output. This file does not duplicate the full manual.

This managed block defines only repository integration, cognition use, and task-closing principles. `aoci_rules` carries the current session contract. Live Guide output carries the execution order and stop conditions of the current Plan. Tool Schema, Spec, and Validator carry machine structures and criteria. Prompt, Description, README, and static documentation cannot override those machine facts.

### Establishing, generating, and restoring cognition

1. At the beginning of every new Agent Run, first determine:

   - whether this repository already has a usable complete AOCI index; and
   - whether current context already contains complete repository cognition that matches this repository root, current index version, and current AOCI service, and that the model can still use reliably.

2. When the repository has a usable complete index but the current Run lacks reliable complete cognition, call `aoci_rules` first and then `aoci_overview`.

   Reuse complete cognition directly while it remains reliable. Local uncertainty does not by itself require mechanically rereading the system-wide view. Once reliable cognition is established, use it as the repository-level system context by default and read only the source, tests, configuration, and contracts the current task directly needs, widening that evidence only when a specific missing fact could change the answer or the verification; AOCI never replaces direct source evidence for the objects being changed or the behavior being verified.

   A Run that resumes from a known Host context compaction, including a Host-injected compaction summary, must treat prior model cognition as unreliable. The compacted handoff must not retain or summarize the formal Whole-Index or any Overview Header, Entry, Chunk, Challenge, or Attestation body; it may retain only receipt identity, unfinished write or Recovery state needed for safe continuation, and an instruction to reload immediately. Whole-Index semantics or a receipt copied into that handoff cannot prove that the resumed model's current cognition is reliable. If the runtime contract is no longer reliably present, call `aoci_rules` first. Before continuing the business task, make an ordinary complete Whole-Index `aoci_overview` request (`check_only` absent or false) with `refresh_reasons=["context_compaction"]` and a fresh `refresh_event_id`; do not use `check_only` or a cognition probe. Follow every exact `next_cursor` through `completed=true`, confirm delivery, and submit one Attestation based only on the newly delivered body. After that fresh complete transport, a partial or failed Attestation consumes the generation and permits the existing source-bound continuation without another automatic Overview. If that request answers `delivery_mode=capacity_stop`, the Whole-Index does not fit this Host's context: do not retry or lower `chunk_tokens`; the stop consumes the generation, and the task continues source-bound without an unqualified complete-system claim.

   AOCI can report checkpoint and cognition-status facts for `context_compaction`, the machine `semantic_threshold` under the project `cognition_refresh_threshold`, or a major `phase_transition`. Use `check_only=true` when only those compact facts are needed. They advise the Agent but do not decide whether the model needs the system-wide view.

   When the Agent explicitly calls ordinary `aoci_overview` (`check_only` absent or false), AOCI must deliver the complete requested scope whenever a coherent CognitionSet can be formed. It must not suppress that body because a receipt already exists, a threshold was not reached, or no refresh reason is pending; the one exception is that capacity stop of a pending compaction refresh. Dirty or stale formal cognition is still delivered but is marked unreliable. Pending recovery or an incoherent snapshot fails closed without a mixed body.

   When an ordinary Overview reports `continuation_required=true`, submit its exact `next_cursor` automatically until `completed=true`. Do not ask the user to continue, begin the business task, or state a partial system conclusion. Request each Chunk in its own tool call; never fetch several in one script or merge their output. Stop the cognition chain on a missing, duplicate, or reordered Chunk, cursor failure, Index change, or `chunk_tokens` change. Until Attestation completes, never use Memory, source, Spec, `aoci.txt`, historical sessions, scope, search, or Entry reads to repair or supplement Whole-Index cognition. A challenge ordinal is the 1-based position in the formal Entry sequence; Header content, comments, blank lines, Section/Overview/Chunk markers, receipts, and Metadata are excluded, and Chunk Receipt ordinals use that same sequence. The Attestation must echo the Challenge's exact current `index_sha256`, `entry_sequence_sha256`, and `entry_count`; a prior Index, Entry sequence, count, or Attestation is invalid. After the complete chain, submit the existing model cognition Attestation once. One same-response JSON Schema or field-format error may be corrected once without changing semantic answers; a result short of pass (fewer than 80 percent of the ordinals fully correct, or more than one object identity miss) records an uncertain receipt, with no semantic retry or information bypass. During initial cognition it also blocks Root/Meta, Migration, layout-wide, or other unbound system decisions. During a context-compaction refresh with complete transport, unchanged cognition identity, aligned governance, and no Recovery or third-party conflict, the attempt consumes that refresh generation even when Attestation is partial or failed; continue the existing task without another automatic Overview. `system_mastery_percent` self-assesses only the system framework—architecture, responsibilities, strong relationships, stable external contracts, and high-entropy safety and maintenance constraints—not complete implementation or runtime knowledge. Keep machine Index coverage separate, and normally give the user only the prescribed single success or failure sentence derived from actual coverage, Challenge, Chunk, token, and mastery results. If the Host truncates a Chunk, request the same cursor once more and check its `chunk_sha256`; the server returns the identical bytes. Only if it is truncated again, stop and ask the user to set `overview_delivery.chunk_tokens` to a smaller valid value and restart; do not change it automatically.

   Interpret the additive cognition level independently from strict proof fields. `delivery_verified` means the Index was loaded and Host delivery was confirmed while complete cognition verification is still unfinished; describe that state as loaded and delivery-verified, never as no cognition or failure to understand the system. `cognition_verified` requires a passing Attestation (at least 80 percent of Challenge ordinals fully correct with at most one object identity miss), and `cognition_governed` additionally requires governance alignment. A generic complete-read failure sentence is reserved for an actual delivery fault.

   When an Overview response contains the optional `cognition-state/v2` projection, use its dimensions independently. Its Level ends at `model_cognition_usable`; `strict_attestation_verified`, `governance_aligned`, and `current_system_cognition_reliable` are independent states and never participate in that Level. An ordinal, object identity, Tag, or core F mismatch can make strict Attestation fail while model cognition remains usable; do not report that mismatch alone as proof that the model did not understand the system. Only `current_system_cognition_reliable=true` permits an unqualified current complete-system cognition claim. When the projection is absent, keep using the legacy interpretation above.

   An ordinary read-only audit, analysis, or check, a request not to modify code, or a request not to commit or push does not automatically mean strictly zero writes and does not alter the cognition-validity decision above. Codex Memory and historical Skills may only help recover experience, user preferences, and investigation directions. They cannot replace a current cognition receipt matching the repository root, index digest, AOCI service identity, and cognition scope. Project AGENTS and current AOCI identity take precedence over historical Memory for AOCI state.

   Treat a task as strictly zero-write only when the user explicitly prohibits Ledger, metadata, `.aoci` runtime assets, and every filesystem write. If necessary cognition establishment conflicts with that boundary, report the conflict and ask the user to decide or recommend an isolated copy. Never silently substitute Memory for current repository cognition.

3. If the repository has no usable complete index, or has only a minimal skeleton, an incomplete Header, unfinished Entries, or undecided required Curation, obtain `aoci_rules` and enter the current AOCI Guide when a formal complete AOCI index is required. Let Guide choose the next phase from actual repository state and complete the required safety steps.

   `aoci_maintain` does not replace the index-establishment workflow.

   Do not reconstruct or hard-code the full-index generation state machine in this file.

4. During a long-running task, the model is responsible for preserving the current cognition receipt and using the refresh gate correctly:

   - when the Host reports context compaction or the model knows the system-wide view was lost, follow the mandatory `context_compaction` reload rule above; AOCI cannot infer the Host event;
   - when entering a genuinely major phase, declare `phase_transition`, not a function, test run, or small step;
   - at a plausible stable checkpoint, use `check_only=true` to obtain the machine semantic count when that fact is useful;
   - except for the mandatory known-compaction reload, decide whether the current task needs another explicit scoped or complete Overview; and
   - keep the Dirty or Stale reliability state reported by AOCI until maintenance and alignment complete.

### Task closing and cognition maintenance

5. A purely read-only question, analysis, version check, or task that changes no AOCI-managed object does not require a maintenance-tool call. The AOCI version in use is `cognition_receipt.mcp_service_version` in any `aoci_overview` check_only or `aoci_maintain` response; the binary path is the `command` in the project's `.mcp.json`, and the CLI need not be on PATH.

6. When AOCI-managed objects change, call `aoci_maintain` once after they reach the task's final stable state. Do not maintain files individually after each intermediate edit.

7. If maintenance returns actual semantic candidates, the Host model must independently author the complete tag and F/R/A/S updates from each candidate's bound object and necessary evidence. Submit the complete candidate set for that current machine-issued batch in one `aoci_update_entry` call while preserving each path and the domain batch identity; `source_sha256` and `candidate_id` may be omitted, since the server takes them from the issued batch. `max_entries` limits one request and atomic transaction, not the logical plan, Whole-Index, or Managed Scope. When `remaining` is nonzero, call Maintain again after the successful Apply and continue from the new preimage; never shrink Index coverage or slice a returned batch to satisfy transport limits.

   When evidence is insufficient and the current layout supports `aoci_report`, use it instead of guessing, applying a template, or generating unsupported cognition merely to eliminate follow-up work.

8. Obey structured tool states and safety boundaries:

   - `repair_required`: repair only the explicitly identified candidates, then resubmit the complete current machine-issued batch;
   - `stopped`: end that write attempt and inspect `failed_step`, error, formal-write evidence, and Recovery. In auto mode, a proven zero-write closure is followed by a fresh Plan; a complete Intent with provable postimage is resumed; a policy-selected Rollback with exact preimage is completed and replanned. Stop the user task only when proof is unavailable, third-party bytes conflict, approval or external action is required, or another real safety boundary applies;
   - never ignore conflicts, approvals, human decisions, permissions, or safety signals; and
   - after alignment, do not repeat maintenance or writes; `refresh_ready_for_overview` is a checkpoint fact, and the Agent decides whether to request an ordinary complete Overview for its next phase.

   If any managed object changes after maintenance completes, the previous result is invalid. Complete closing again from the new final stable state.

9. When the user limits only business-file scope and does not explicitly forbid repository-managed assets, AOCI-managed assets may be updated during closing to preserve cognition consistency. Distinguish them from business files in audits and commits.

   When the user explicitly forbids changes to `aoci.txt`, `.aoci`, metadata, or any additional file, obey that restriction, do not write, and report any remaining inconsistency accurately.

### Specialized workflows

Initialization, complete-index generation, Header generation, Entries generation, database-structure indexing, Curation, human review, and failure recovery must follow only the instructions, commands, and safety stops returned by the current AOCI Guide or tool at the corresponding stage.

Do not preload, guess, or reconstruct these specialized workflows. The relevant Guide, tool descriptions, model Prompt, and CLI help provide platform invocation, request format, batch limits, approval rules, index-format details, and recovery steps as needed.
<!-- aoci:end -->
