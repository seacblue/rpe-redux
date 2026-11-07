# Types and terminology

API pages use a small set of stable public types. These names describe cloned data at the sandbox boundary; they are not host object references.

## Handles and context

An API **handle** is a grouped entry such as `context.api.chart`. `context` is the package runtime and also contains `scripts`, `ui`, `storage`, `events`, `hooks`, `timers`, and `styles`.

## Results

`ApiResult<T>` is either `{ ok: true, value: T }` or `{ ok: false, error }`. `ActionResult<T>` describes the domain status of an operation such as note placement. Test both layers when an API returns an action result inside an API result.

## Chart targets

- `ChartTarget` identifies a line and one or two beat positions.
- `ChartTargetPoint` contains `beat` and `positionX`.
- `ChartNoteType` uses `1` Tap, `2` Hold, `3` Flick, and `4` Drag.
- `ChartObjectId` is a stable string id read from the chart.

## Read snapshots

The `ChartRead*` types are immutable snapshots used for inspection and for id-addressed transaction planning. `ChartReadPage<T>` carries an opaque cursor; do not construct or reuse a cursor across chart fingerprints.

## Theme and settings

`ExtensionThemeTokens` is the current theme snapshot. `SettingDefinition` is a Settings-page row schema; values are owned by the values handle.
