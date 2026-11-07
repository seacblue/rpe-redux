# Place a note

The shortest safe path for placing one note is to request `scripts`, `chart.write`, and `ui.notice`, register a script, and call `context.api.chart.placeNote`.

## Read the target

Use a line index and beat coordinates. Do not invent object ids for an insert.

```js
const result = await context.api.chart.placeNote(1, {
  lineIndex: 0,
  from: { beat: 0, positionX: 0 },
});
```

The stable note types are `1` Tap, `2` Hold, `3` Flick, and `4` Drag. A Hold uses `to` for its ending point. The host validates the target against the live chart before committing it.

## Check the result

Every fallible API call returns an `ApiResult`. Test `ok` before reading `value`; a committed action reports its domain status inside that value.

```js
if (!result.ok) {
  context.ui.notice(result.error.message, { level: "error" });
} else if (result.value.status === "committed") {
  context.ui.notice("Placed", { level: "success" });
}
```

For multiple edits, use `transaction.preview` and `transaction.apply` instead.
