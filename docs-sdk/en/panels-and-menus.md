# Panels and menus

An Extension can register panels, sidebar entries, toolbar actions, context-menu rows, and overlays. The host lays out every contribution; the package supplies descriptors and callbacks.

## Purpose

Use panels for stateful tools, sidebars for persistent entry points, toolbar or context-menu rows for commands, and overlays for HUD or preview content.

## Signature

```js
context.api.ui.registerPanel({ id, label, tree });
context.api.ui.registerSidebar({ id, label, panelId });
context.api.toolbar.register({ id, label, run });
```

## Minimal example

```js
const disposePanel = context.ui.registerPanel({
  id: "example.panel",
  label: "Example",
  tree: { tag: "p", text: "Ready" },
});
const disposeAction = context.api.toolbar.register({
  id: "example.open",
  label: "Open example",
  presentation: "iconText",
  cells: "auto",
  run: () => context.api.ui.open("example.panel"),
});
```

## Advanced use

Give related contributions a stable namespace and dispose them during package deactivation. A toolbar action may request an explicit `cells` value from 1 to 32; omitted or `auto` measures its localized label once after layout.

## Permissions and limits

Panels, sidebars, overlays, toolbar actions, and context menus require their corresponding `ui.*` capability. The host owns ordering, focus, and surface geometry; a package cannot move another package's contribution.

## Errors and recovery

Duplicate ids, invalid descriptors, missing capabilities, and unavailable surfaces return structured errors. Keep the disposer and re-register only after correcting the descriptor.

## Related APIs

See [Declarative UI](ui-reference.md), [Layout](api:layout.anchors), [Toolbar](api:toolbar.register), and [Context menu](api:contextMenu.register).
