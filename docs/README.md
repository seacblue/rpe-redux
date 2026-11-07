# Internal documentation

This directory contains the small set of current engineering contracts that are useful while changing the repository. It is not a release note archive, issue tracker, or copy of the public Extension documentation.

The generated public documentation is sourced from [`docs-sdk/`](../docs-sdk/) and is intentionally outside this audit.

## Using the product

- [Getting started](getting-started.md) — install, first chart, workspace tour, save/export, and where the application keeps its data.

## Engineering contracts

- [Architecture](architecture.md) — ownership, runtime direction, and module boundaries.
- [Development](development.md) — local workflow, commands, repository tour, and runtime contracts.
- [Testing](testing.md) — test suites, commands, fixtures, and where a new test belongs.
- [Desktop runtime](desktop.md) — Tauri packaging, sidecars, updates, and deployment.
- [Compatibility](compatibility.md) — chart formats, PEZ packages, and bundled resources.
- [Keyboard](keyboard.md) — default bindings and editing behavior.

## Extension implementation

- [Extensions](extensions.md) — package model, capabilities, and host boundary.
- [Extension quickstart](extensions-quickstart.md) — the smallest installable package.

The Chinese extension references are the only translated documents retained in this directory: [Chinese extension platform guide](extensions-zh.md) and [Chinese extension quickstart](extensions-quickstart-zh.md). All other internal documents use English only.

## Repository-level guidance

- [AGENTS.md](../AGENTS.md) — repository rules for coding agents and maintainers.
- [Contributing](../CONTRIBUTING.md) — contribution workflow.

The SDK type surface and its authoring guide live in [`sdk/`](../sdk/). The public Extension pages live in [`docs-sdk/`](../docs-sdk/). Avoid adding a second copy of either contract under this directory.
