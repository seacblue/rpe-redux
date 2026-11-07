# Complete examples

These examples combine the public Extension surfaces. Each registration should be disposed when the package is deactivated.

## Toolbar action and panel

```js
const disposePanel = context.ui.registerPanel({
  id: "example.panel",
  label: "Example",
  tree: { tag: "p", text: "Ready" },
});
const disposeToolbar = context.api.toolbar.register({
  id: "example.open",
  label: "Open example",
  run: () => context.api.ui.open("example.panel"),
});
```

## Settings and JSON storage

```js
const config = (await context.storage.getJSON("config")) ?? { enabled: true };
await context.storage.setJSON("config", config);
```

Use `values.define` when the setting must be observable by several package surfaces. Use package storage for private cached data.

## Transaction write

```js
const preview = await context.api.transaction.preview({
  label: "Move note",
  notes: { update: [{ id: "note-id", patch: { positionX: 100 } }] },
});
if (preview.ok) await context.api.transaction.apply(preview.value.previewId);
```

## Provider and consumer

For a versioned integration, publish a service or a public hook. A consumer must handle the provider disappearing and keep a local fallback.
