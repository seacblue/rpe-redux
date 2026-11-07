# Security model

Extensions are untrusted packages. The host exposes only an asynchronous, capability-gated bridge from an opaque-origin iframe.

## Runtime boundary

The sandbox cannot access the host DOM, Tauri IPC, arbitrary filesystem paths, network APIs, nested frames, or host globals. Results and arguments are cloned, bounded, and validated before crossing the bridge.

## Capabilities

Manifest capabilities are consent groups. The host checks ownership and grants on every request. A package cannot read another package's settings, registry entries, storage, or surface ids.

## Declarative UI

UI is data, not executable markup. The host accepts a closed tag and attribute set, rejects remote or script-capable image sources, scopes package CSS, and limits nodes, depth, ids, classes, images, and style values.

## Trust and recovery

Trust controls package installation and execution; it does not expand the host API beyond declared capabilities. Disable a package when it misbehaves, and treat `capabilityDenied`, `bridge.limit`, and `stale_read` as structured recovery states rather than reasons to probe hidden host surfaces.
