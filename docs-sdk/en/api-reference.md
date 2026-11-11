# API conventions

The Extension API is an asynchronous, capability-gated host facade. Every request is checked at the bridge and returns cloned data.

## Purpose

Use this page to understand signatures, result envelopes, error codes, and stale-read handling before browsing a specific handle.

## Signature

```js
const result = await context.api.chart.state();
if (result.ok) console.log(result.value);
```

## Minimal example

```js
const result = await context.api.transaction.preview({
  label: "Move a note",
  notes: { update: [{ id: "note-id", patch: { positionX: 100 } }] },
});
if (!result.ok) throw new Error(result.error.message);
if (result.value.status !== "previewed" || !result.value.previewId) {
  throw new Error(`Nothing to apply: ${result.value.status}`);
}
const committed = await context.api.transaction.apply(result.value.previewId);
```

## Advanced use

Reads expose stable snapshots and opaque cursors. Pin a chart fingerprint before a write, use `preview` for user-visible changes, and apply only the preview that belongs to the current run.

## Permissions and limits

{{METHOD_TABLES}}

{{CAPABILITY_TABLE}}

## Errors and recovery

Branch on `error.code`, not on error text. Re-read after `stale_read`, request the missing capability before retrying `capabilityDenied`, and treat an unavailable runtime as a lifecycle state rather than a permanent failure.

## Related APIs

See [Capabilities](capabilities.md), [Types](types.md), and the generated [API index](api:).
