# Types and terminology

API pages use a small set of stable public types. These names describe cloned data at the sandbox boundary; they are not host object references.

## Handles and context

An API **handle** is a grouped entry such as `context.api.chart`. `context` is the package runtime and also contains `scripts`, `ui`, `storage`, `events`, `hooks`, `timers`, and `styles`.

## Results

`ApiResult<T>` is either `{ ok: true, value: T }` or `{ ok: false, error }`. Test `ok` before reading `value`. A transaction returns `ApiResult<ChartTransactionResult>`; the domain status is inside `value.status`.

## ChartTransactionRequest

`ChartTransactionRequest` is the request accepted by `transaction.preview` and `transaction.apply`.

- `ChartObjectId` is a stable string id read from the chart.
- `Beat` is a reduced triple `[whole, numerator, denominator]`; `[0, 1, 2]` is beat `0.5`.

Transaction groups:

| Group      | Shape                                                         |
| ---------- | ------------------------------------------------------------- |
| `metadata` | Partial chart metadata.                                       |
| `timing`   | `{ bpmList }`; replaces the complete tempo map.               |
| `lines`    | `insert`, `update`, and `delete` by id.                       |
| `notes`    | `insert`, `update`, and `delete`.                             |
| `events`   | `insert`, `update`, and `delete`, grouped by track and layer. |

Deleting a line removes its notes and events, re-parents child lines to the root, and remaps shader line references. At least one line must remain. Deletion runs before `insert` and `update`, so any `lineIndex` in the same request refers to the post-delete order.

## Selection references

`selection.state()` returns note refs with a stable `id`, `lineIndex`, and `index`, and event refs with a stable `id`, `lineIndex`, `eventType`, `layer`, and `index`. Pass the id to `chart.note`/`chart.event` or to a transaction update/delete.

## ChartTransactionResult

`ChartTransactionResult` carries `status`, `affectedObjectIds`, `issues`, `history`, and `conflict`. `TransactionIssue` names a validation problem with a `code` and optional `path`.

## Read snapshots

The `ChartRead*` types are immutable snapshots used for inspection and for id-addressed transaction planning.

A page carries `items`, the applied `offset` and `limit`, the collection's `total`, `hasMore`, and an opaque `nextCursor`. Either pass `offset` and `limit` to address a page directly or pass `cursor` to continue; the two forms cannot be combined. A cursor pins the chart fingerprint and generation, so do not construct or reuse a cursor across chart fingerprints.

`invalid_request` reports one of `invalid_cursor`, `invalid_limit`, `invalid_offset`, or `conflicting_paging` in `reason`.

## Whole-collection reads

`chart.readAll` returns `ApiResult<readonly ChartReadItem<Collection>[]>`. Its `ChartReadAllOptions` accepts `limit` (the internal page size) and `chartFingerprint` (pin one revision). Pages are drained by the host, so the result has no cursor, offset, or `hasMore` field.

## Timing

`chart.readAll("timing")` returns the ordered tempo map as `readonly ChartReadTiming[]`. Each item is a `BpmEntry` with `bpm` and `startTime`; pass the array to `transaction.timing.bpmList` to replace the map. `chart.read("timing")` pages it like any other collection.

## Theme and settings

`ExtensionThemeTokens` is the current theme snapshot. `SettingDefinition` is a Settings-page row schema; values are owned by the values handle.
