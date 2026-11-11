# Complete examples

These examples combine the public Extension surfaces. Each registration should be disposed when the package is deactivated.

## Toolbar action and panel

```js
const disposePanel = context.ui.registerPanel({
  id: "example.panel",
  label: "Example",
  tree: { tag: "p", text: "Ready" },
});
const disposeSidebar = context.ui.registerSidebar({
  id: "open-example",
  panelId: "example.panel",
  icon: { name: "sliders", label: "Example" },
  order: 900,
});
const disposeToolbar = await context.api.toolbar.register({
  kind: "action",
  id: "example.open",
  row: 2,
  order: 920,
  group: "example",
  label: "Open example",
  tooltip: "Open the example panel",
  icon: "sliders",
  run: () => context.api.sidebar.open("open-example"),
});
```

This package requests `scripts`, `ui.panel`, `ui.sidebar`, `ui.toolbar`, and `ui.notice`.

## Settings and JSON storage

```js
const config = (await context.storage.getJSON("config")) ?? { enabled: true };
await context.storage.setJSON("config", config);
```

Use `values.define` when the setting must be observable by several package surfaces. Use package storage for private cached data.

## Chart operation plugin

This package shifts the selected notes by a number the user enters. The manifest requests scripts, chart read/write, selection read, and notices:

```json
{
  "kind": "extension",
  "id": "example.shift",
  "name": "Shift Notes",
  "version": "1.0.0",
  "engines": { "rpe-redux": 1 },
  "entry": "index.js",
  "capabilities": ["scripts", "chart.read", "selection.read", "chart.write", "ui.notice"]
}
```

```js
export default {
  activate(context) {
    context.scripts.register({
      id: "shift-right",
      label: "Shift selection right",
      parameters: {
        parameters: {
          delta: {
            kind: "number",
            default: 10,
            min: -675,
            max: 675,
            step: 1,
            label: "Distance",
          },
        },
        order: ["delta"],
      },

      async run({ api, params, ui }) {
        const selection = await api.selection.state();
        if (!selection.ok) {
          ui.notice(selection.error.message, { level: "error" });
          return;
        }
        if (selection.value.notes.length === 0) {
          ui.notice("Select some notes first.", { level: "warning" });
          return;
        }

        const lines = await api.chart.lines();
        if (!lines.ok) {
          ui.notice(lines.error.message, { level: "error" });
          return;
        }

        const delta = Number(params.delta) || 0;
        const updates = [];
        for (const reference of selection.value.notes) {
          const note = lines.value[reference.lineIndex]?.notes?.[reference.index];
          if (!note?.id || !Number.isFinite(note.positionX)) continue;
          updates.push({ id: note.id, patch: { positionX: note.positionX + delta } });
        }
        if (updates.length === 0) return;

        const preview = await api.transaction.preview({
          label: "Shift notes",
          notes: { update: updates },
        });
        if (!preview.ok || preview.value.status !== "previewed" || !preview.value.previewId) {
          ui.notice("Preview failed.", { level: "error" });
          return;
        }

        const applied = await api.transaction.apply(preview.value.previewId);
        if (applied.ok && applied.value.status === "committed") {
          ui.notice(`Moved ${updates.length} notes.`, { level: "success" });
        }
      },
    });
  },
};
```

A chart write uses `transaction.preview` then `apply`. A chart that changed before the commit returns `conflict`; a paged `chart.read` with an old cursor returns `stale_read`.

## Provider and consumer

For a versioned integration, publish a service or a public hook. A consumer must handle the provider disappearing and keep a local fallback.
