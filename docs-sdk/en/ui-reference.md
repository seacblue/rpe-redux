# Declarative UI

Declarative nodes let an Extension register panels, overlays, and sidebar surfaces without touching the host DOM. The host owns rendering, focus, accessibility, and event dispatch.

## Purpose

Use a node tree for compact tools, inspectors, HUDs, previews, and lightweight settings. Nodes are plain data that can cross the sandbox bridge.

## Signature

```js
const surface = {
  title: "Example",
  tree: { tag: "section", children: [{ tag: "p", text: "Hello" }] },
};
```

## Minimal example

```js
context.ui.registerPanel({
  id: "example.panel",
  label: "Example",
  tree: {
    tag: "section",
    children: [{ tag: "p", text: "Rendered by the host" }],
  },
});
```

## Advanced use

Use `button`, `input`, and `select` nodes with the documented attributes. Keep stable ids for controls, update the tree from package state, and use the event payload returned by the host rather than querying the DOM.

## Permissions and limits

{{UI_TAGS_TABLE}}

{{UI_INPUT_TYPES_TABLE}}

{{UI_ATTRS_TABLE}}

{{UI_LIMITS_TABLE}}

## Errors and recovery

Unsupported tags, attributes, styles, URLs, and oversized trees are rejected or trimmed at the sandbox boundary. Register a valid replacement tree and surface the failure through `ui.notice`.

## Related APIs

See `ui.registerPanel`, `ui.registerSidebar`, `ui.registerOverlay`, `layout.anchors`, and [Design system](design-system.md).
