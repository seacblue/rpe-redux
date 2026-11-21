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
const result = await context.api.transaction.apply({
  label: "Move a note",
  notes: { update: [{ id: "note-id", patch: { positionX: 100 } }] },
});
if (!result.ok) throw new Error(result.error.message);
if (result.value.status !== "committed") {
  throw new Error(result.value.issues[0]?.message ?? result.value.status);
}
```

## Advanced use

Reads expose stable snapshots and opaque cursors. A normal write is one `transaction.apply(request)` call, which plans and commits atomically. Use `preview` only when the user should confirm a diff, and apply only the preview that belongs to the current run.

### Reading a whole collection

Use `chart.readAll` when a script needs every item. The host drains pages internally and returns one array; the caller never handles a cursor, page offset, `total`, or `hasMore`:

```js
const result = await context.api.chart.readAll("notes");
if (result.ok) {
  for (const note of result.value) console.log(note.id);
}
```

`chart.readAll` supports `metadata`, `timing`, `lines`, `notes`, and `events`. The `timing` collection is the ordered tempo map (`BpmEntry[]`) that `transaction.timing.bpmList` accepts; every other collection returns its whole list as one array. Inside a package they are assembled page by page, so a large chart never sends one oversized result across the bridge. If the chart changes while the collection is being read, the call returns `stale_read` and no partial array; retry against the new revision.

`chart.read` remains available as the low-level paged read for callers that explicitly need page boundaries, totals, or resumable cursors. Pass `offset` and `limit` to jump directly to any page, or pass the returned `nextCursor` to continue in order. Do not combine `cursor` and `offset` in one request.

```js
const first = await context.api.chart.read("notes", { offset: 0, limit: 100 });
if (first.ok && first.value.status === "ok") {
  const second = await context.api.chart.read("notes", {
    offset: first.value.offset + first.value.items.length,
    limit: 100,
  });
  console.log(first.value.total, first.value.hasMore, second.value.items.length);
}
```

Every successful page echoes the applied `offset` and `limit` and reports the collection's `total` and `hasMore`, so a caller never has to guess whether a short page was the last one. `limit` defaults to 50 and is clamped to 100. A non-positive or non-integer `limit` is rejected with `invalid_request` and `reason: "invalid_limit"`; a negative or non-integer offset reports `reason: "invalid_offset"`.

A cursor pins the chart fingerprint and generation. Any chart edit invalidates it with `stale_read`, so a paged walk is consistent within one revision and fails closed after an edit. Ordering is the chart's own order: line order for `lines`, line-then-array order for `notes`, and line-then-layer-then-array order for `events`.

`library.list` and `library.revisions` use the same offset/limit model over the stored catalog. `library.list` returns `{ projects, total }`; `library.revisions` returns `{ revisions, total, snapshotToken }`. Both clamp their page size and break sort ties deterministically (project id, then revision insertion order), so repeated calls over an unchanged catalog return the same page boundaries. An edit or a save can move a project to a new position in the sorted list; re-read the first page when ordering matters.

`library.revisions` returns `{ revisions, total, snapshotToken }`. Pass `snapshotToken` on later pages to keep one consistent revision list even when revisions are added or deleted between requests. Tokens expire after five minutes; an expired token returns `snapshot_expired` and the caller should reload from the first page. `library.current.revisionsAll` carries that token through every page, deduplicates by revision id, and returns the same `snapshotToken` in its result.

### Recipe plans

Use `recipe.plan` when a script needs counts, affected ids, or a confirmation step before writing. It runs the same planner as `transaction.apply` but mutates nothing. The result carries a short-lived `planId`, totals, and affected ids, never the detached chart. Pass `chartFingerprint` to reject a plan made against an older revision. `recipe.apply(planId)` commits once and consumes the plan; `recipe.cancel(planId)` discards it. Any chart change, document switch, owner unload, expiry, or a second apply makes the plan unavailable.

### Playback clock

`playback.subscribe(listener, { maxHz })` delivers coalesced `{ chartSeconds, beat, playing, rate, lineIndex }` samples. The first tick is immediate; later ticks default to 30 Hz and clamp to 1-60 Hz. Dispose the returned function when the surface closes. Use `playback.state()` for a one-off read.

## Permissions and limits

{{METHOD_TABLES}}

{{CAPABILITY_TABLE}}

## Errors and recovery

Branch on `error.code`, not on error text. Re-read after `stale_read`, request the missing capability before retrying `capabilityDenied`, and treat an unavailable runtime as a lifecycle state rather than a permanent failure.

## Related APIs

See [Capabilities](capabilities.md), [Types](types.md), and the generated [API index](api:).
