# FAQ

## Why are `document` and `window` unavailable?

An Extension runs in an opaque-origin iframe. It cannot access the host DOM, Tauri IPC, the network, or `window.redux`. Use declarative nodes for UI and `context.api` for host operations.

## Why must API calls be awaited?

The host bridge is asynchronous. Every request crosses the capability gate and returns a promise, including reads that are implemented synchronously in the host.

## Why does an API call return `ok: false`?

The document may be unavailable, the requested capability may be missing, or a request may be stale. Inspect `error.code` and show a recovery action rather than retrying blindly.

## Why did my panel not render?

The host accepts only the declarative tags, attributes, node count, depth, and style values listed in [Declarative UI](ui-reference.md). Invalid nodes are discarded at the boundary. Keep state in the package and publish a new tree through the UI registration handle.

## How do I share data between Extensions?

Use a versioned provider and consumer service for an owned integration, or use a namespaced public hook when the exchange is JSON data. Do not share host objects or DOM references.
