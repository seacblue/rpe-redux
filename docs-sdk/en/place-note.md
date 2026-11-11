# Chart operations

A chart write is a **transaction**. Read the current chart, build one request, then submit it through `context.api.transaction`. The host validates the request, applies it once, and records it in undo history.

This page is a task guide. For the full result envelope and error model, read [API conventions](api-reference.md); for every method, use the generated API tree.

## Manifest

Request `scripts` for the script entry point, `chart.read` to read the chart, `chart.write` for the transaction, and `ui.notice` for feedback:

```json
{
  "kind": "extension",
  "id": "example.chart-ops",
  "name": "Chart Ops",
  "version": "1.0.0",
  "engines": { "rpe-redux": 1 },
  "entry": "index.js",
  "capabilities": ["scripts", "chart.read", "chart.write", "ui.notice"]
}
```

The user sees these capabilities in the install dialog. Do not request `chart.write` for a package that only reads.

## Read before you write

The chart handle returns detached snapshots. Do not mutate them; use their ids and positions to build a transaction.

```js
const lines = await api.chart.lines();
if (!lines.ok) {
  ui.notice(lines.error.message, { level: "error" });
  return;
}

const firstLine = lines.value[0];
if (!firstLine) {
  ui.notice("This chart has no judge line.", { level: "warning" });
  return;
}
```

Useful reads:

| Call                | Returns                                                 |
| ------------------- | ------------------------------------------------------- |
| `chart.state()`     | Current chart fingerprint and generation.               |
| `chart.lines()`     | Every judge line, with notes and event layers.          |
| `chart.notes()`     | Every note ref with its owning line id and index.       |
| `chart.events()`    | Every event ref with its line, track, layer, and index. |
| `chart.snapshot()`  | One frozen copy of the whole chart.                     |
| `selection.state()` | Selected note and event refs.                           |

## Add a note

The shortest complete plugin: insert one Tap at beat 0 on the first judge line.

```js
export default {
  activate(context) {
    context.scripts.register({
      id: "add-tap",
      label: "Add tap at beat 0",
      description: "Insert one tap note on the first judge line.",
      icon: "plus",

      async run({ api, ui }) {
        const lines = await api.chart.lines();
        if (!lines.ok) {
          ui.notice(`Read failed: ${lines.error.code}`, { level: "error" });
          return;
        }
        if (lines.value.length === 0) {
          ui.notice("This chart has no judge line.", { level: "warning" });
          return;
        }

        const result = await api.transaction.apply({
          label: "Add tap at beat 0",
          notes: {
            insert: [
              {
                lineIndex: 0,
                note: {
                  type: 1,
                  startTime: [0, 0, 1],
                  endTime: [0, 0, 1],
                  positionX: 0,
                  above: 1,
                },
              },
            ],
          },
        });

        if (!result.ok) {
          ui.notice(`Transaction failed: ${result.error.code}`, { level: "error" });
          return;
        }
        if (result.value.status === "committed") {
          ui.notice("Tap inserted.", { level: "success" });
        } else {
          ui.notice(`Transaction status: ${result.value.status}`, { level: "warning" });
        }
      },
    });
  },
};
```

`startTime` and `endTime` are **beat triples**, not seconds. `[0, 1, 2]` is beat `0.5`; `[3, 0, 1]` is beat `3`. Omit `id` on inserts; the editor assigns one.

## Request shape

```js
{
  label: "Undo label shown to the user",

  metadata: { name: "Song", charter: "Me", offset: 0 },

  timing: {
    bpmList: [{ bpm: 180, startTime: [0, 0, 1] }]
  },

  lines: {
    insert: [{ line: { Name: "Main" } }],
    update: [{ id: "<line-id>", patch: { Name: "Renamed" } }]
  },

  notes: {
    insert: [{
      lineIndex: 0,
      note: { type: 1, startTime: [0, 0, 1], endTime: [0, 0, 1], positionX: 0, above: 1 }
    }],
    update: [{ id: "<note-id>", patch: { positionX: 120 } }],
    delete: ["<note-id>"]
  },

  events: {
    insert: [{
      lineIndex: 0,
      eventType: "moveXEvents",
      event: { startTime: [0, 0, 1], endTime: [1, 0, 1], start: 0, end: 200, easingType: 1 }
    }],
    update: [{ id: "<event-id>", patch: { end: 300 } }],
    delete: ["<event-id>"]
  }
}
```

| Group | Can change |
| --- | --- |
| `metadata` | Chart metadata fields such as `name`, `song`, `composer`, `charter`, `level`, `offset`. |
| `timing` | Replace the complete tempo map through `bpmList`. |
| `lines.insert` | Append a judge line; the host assigns its id and default event layer. |
| `lines.update` | Patch editable line fields by id. |
| `notes.insert` | Insert notes on an existing line by `lineIndex` or `lineId`. |
| `notes.update` / `notes.delete` | Update or delete notes by id. |
| `events.insert` | Insert events on an existing line by track and layer. |
| `events.update` / `events.delete` | Update or delete events by id. |

Limits that matter:

- `timing.bpmList` replaces the whole tempo map and must contain at least one entry.
- `lines` has no delete operation.
- A new line inserted in the same request is addressed by `lineIndex` equal to the old line count plus its insert position.
- Events support the base tracks (`moveXEvents`, `moveYEvents`, `rotateEvents`, `alphaEvents`, `speedEvents`) and the extended tracks (`scaleXEvents`, `scaleYEvents`, `colorEvents`, `paintEvents`, `textEvents`, `inclineEvents`, `gifEvents`).

## Update selected notes

`selection.state()` returns references, not note objects. Use `chart.lines()` to resolve each reference to its current note id.

```js
async run({ api, ui }) {
  const selection = await api.selection.state();
  if (!selection.ok || selection.value.notes.length === 0) {
    ui.notice("Select some notes first.", { level: "warning" });
    return;
  }

  const lines = await api.chart.lines();
  if (!lines.ok) return;

  const updates = selection.value.notes
    .map((ref) => {
      const note = lines.value[ref.lineIndex]?.notes?.[ref.index];
      return note?.id
        ? { id: note.id, patch: { positionX: -(note.positionX ?? 0) } }
        : null;
    })
    .filter(Boolean);

  const result = await api.transaction.apply({
    label: "Mirror selected notes",
    notes: { update: updates },
  });

  if (result.ok && result.value.status === "committed") {
    ui.notice(`Updated ${updates.length} notes.`, { level: "success" });
  }
}
```

This example needs `selection.read` in addition to `chart.read` and `chart.write`.

## Preview, apply, and result status

Use `preview` when the request is complex or the user should confirm a count before writing. Use `apply` directly for a simple, already-confirmed action.

```js
const preview = await api.transaction.preview(request);
if (!preview.ok) {
  ui.notice(preview.error.message, { level: "error" });
  return;
}
if (preview.value.status !== "previewed" || !preview.value.previewId) {
  ui.notice(`Nothing to apply: ${preview.value.status}`, { level: "warning" });
  return;
}

const applied = await api.transaction.apply(preview.value.previewId);
```

`preview` status: `previewed`, `unchanged`, `rejected`, `unavailable`.

`apply` status:

| Status        | Meaning                                            |
| ------------- | -------------------------------------------------- |
| `committed`   | The chart changed and the edit is in undo history. |
| `unchanged`   | The request produced no change.                    |
| `rejected`    | Validation or an edit rule refused the request.    |
| `conflict`    | The chart changed before the commit could apply.   |
| `unavailable` | No editor session is connected.                    |

When `apply` returns `rejected` or `conflict`, show a concise message rather than retrying blindly. Read `value.issues` for paths and codes; `value.history` names the committed undo entry.

## Common mistakes

- **Mutating a read result.** `chart.lines()` and `chart.notes()` return frozen detached copies. Build a transaction from their ids and values.
- **Inventing ids.** Read ids from `chart.lines()`, `chart.notes()`, or `chart.events()`. Inserts omit `id`.
- **Using seconds instead of beats.** Note and event times are reduced beat triples, for example `[4, 1, 2]`.
- **Treating `apply` as fire-and-forget.** It is asynchronous and returns an `ApiResult` around a domain status.
- **Requesting only `chart.read`.** A transaction needs `chart.write`; reading selected notes also needs `selection.read`.

## Continue

- [Getting started](getting-started.md) creates the smallest installable package.
- [Extension context](context.md) explains `context`, `context.api`, and the script lifecycle.
- [Capabilities](capabilities.md) lists the consent vocabulary.
- Use the generated API tree for `chart`, `selection`, and `transaction` method pages.
