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
| `lines`    | `insert` and `update`; no delete.                             |
| `notes`    | `insert`, `update`, and `delete`.                             |
| `events`   | `insert`, `update`, and `delete`, grouped by track and layer. |

## ChartTransactionResult

`ChartTransactionResult` carries `status`, `affectedObjectIds`, `issues`, `history`, and `conflict`. `TransactionIssue` names a validation problem with a `code` and optional `path`.

## Read snapshots

The `ChartRead*` types are immutable snapshots used for inspection and for id-addressed transaction planning. `ChartReadPage<T>` carries an opaque cursor; do not construct or reuse a cursor across chart fingerprints.

## Theme and settings

`ExtensionThemeTokens` is the current theme snapshot. `SettingDefinition` is a Settings-page row schema; values are owned by the values handle.
