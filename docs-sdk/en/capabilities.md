# Capabilities

Capabilities are the package's permission requests. A manifest declares the capabilities it needs, and the user must consent before the host exposes the corresponding handle.

## Purpose

Request the smallest set of capabilities that covers the package. The bridge checks every call again, so a manifest is a request rather than a bypass.

## Signature

```json
{ "capabilities": ["scripts", "chart.read", "ui.notice"] }
```

## Minimal example

```js
const available = await context.api.availability();
if (available.status !== "available") {
  context.ui.notice("The editor is not ready", { level: "warning" });
}
```

## Advanced use

Separate read and write features in the package. Explain sensitive permissions in the manifest and degrade to a read-only view when consent is withheld.

## Permissions and limits

{{CAPABILITY_TABLE}}

## Errors and recovery

`capabilityDenied` is stable and should not be retried until the user changes consent. `unavailable` means the host surface is not mounted; wait for the document lifecycle or show a local fallback.

## Related APIs

See [API conventions](api-reference.md), [Security model](security.md), and [Extension context](context.md).
