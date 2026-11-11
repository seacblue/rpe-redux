# Extension context

`context` is the package-owned runtime object. `context.api` is the asynchronous facade for host data and actions; the other members provide package surfaces.

## Two entry points

| Entry         | Responsibility                                                      |
| ------------- | ------------------------------------------------------------------- |
| `context.api` | Capability-gated chart, document, UI, and registry operations.      |
| `context`     | Scripts, notifications, storage, events, hooks, timers, and styles. |

## Lifecycle

The host calls `activate(context)` once the package is loaded. Keep disposers for every registration and release them in the package's deactivation path. The host may deactivate a package while a request is pending.

## Context helpers

The generated context method table is available below.

{{CONTEXT_METHODS_TABLE}}

## Chart writes

Read the open chart through `context.api.chart` and `context.api.selection`. Chart changes go through one `context.api.transaction` request; do not mutate read snapshots. See [Chart operations](place-note.md).

## Isolation

The context contains no host DOM, Tauri object, network client, or raw chart object. Data crossing the bridge is cloned and bounded. Use [Public hooks](hooks.md) or a versioned service for cross-Extension communication.
