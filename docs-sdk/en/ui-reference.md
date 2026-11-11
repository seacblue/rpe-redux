# Declarative UI

Declarative nodes let an Extension register panels, overlays, and sidebar surfaces without touching the host DOM. The host owns rendering, focus, accessibility, and event dispatch.

## Purpose

Use a node tree for compact tools, inspectors, HUDs, previews, and lightweight settings. Nodes are plain data that can cross the sandbox bridge. The host maps supported tags to design-system primitives.

## Signature

```ts
interface SandboxPanelDefinition {
  id: string;
  tree: SandboxUiNode;
  onEvent?(event: SandboxUiEvent): void;
}

interface SandboxSurfaceHandle {
  update(tree: SandboxUiNode, options?: { replace?: boolean }): void;
  dispose(): void;
}

interface SandboxUiContext {
  registerPanel(definition: SandboxPanelDefinition): SandboxSurfaceHandle;
  registerOverlay(definition: SandboxOverlayDefinition): SandboxSurfaceHandle;
  registerSidebar(definition: SandboxSidebarDefinition): () => void;
}

type SandboxUiNode = SandboxElementNode | SandboxTextNode;

interface SandboxElementNode {
  kind: "element";
  tag: string;
  id?: string;
  class?: string;
  style?: Record<string, string | number>;
  attrs?: Record<string, string | number | boolean>;
  text?: string;
  children?: readonly SandboxUiNode[];
}

interface SandboxTextNode {
  kind: "text";
  text: string;
}

interface SandboxUiEvent {
  nodeId: string;
  kind: "click" | "input" | "change" | "file";
  value?: string;
  checked?: boolean;
  file?: { name: string; type: string; dataUrl: string };
}
```

Supported tags:

{{UI_TAGS_TABLE}}

Supported `input` types:

{{UI_INPUT_TYPES_TABLE}}

Supported attributes:

{{UI_ATTRS_TABLE}}

## Minimal example

Register a panel that updates its heading when the user types:

```js
const state = { query: "" };
let panel;

function tree() {
  return {
    kind: "element",
    tag: "section",
    children: [
      { kind: "element", tag: "h2", text: state.query || "Search" },
      {
        kind: "element",
        tag: "input",
        id: "query",
        attrs: { type: "search", value: state.query, placeholder: "Type here" },
      },
      { kind: "text", text: `Current value: ${state.query || "(empty)"}` },
    ],
  };
}

panel = context.ui.registerPanel({
  id: "example.panel",
  tree: tree(),
  onEvent(event) {
    if (event.kind === "input" && event.nodeId === "query") {
      state.query = event.value ?? "";
      panel.update(tree());
    }
  },
});
```

## Advanced use

Keep stable ids for controls that return events. Update the tree from package state instead of querying the DOM. Use `update(tree, { replace: true })` when an input must be remounted with a new model value. Use a `SandboxTextNode` for plain text; do not put raw HTML into `text`.

## Permissions and limits

{{UI_LIMITS_TABLE}}

Panels and overlays require `ui.panel` and `ui.overlay`; sidebar entries require `ui.sidebar`. The host applies the design system, theme tokens, focus, and accessibility semantics.

## Errors and recovery

Unsupported tags, attributes, styles, URLs, and oversized trees are rejected or trimmed at the sandbox boundary. Register a valid replacement tree and surface the failure through `ui.notice`.

## Related APIs

See `ui.registerPanel`, `ui.registerSidebar`, `ui.registerOverlay`, `layout.anchors`, and [Design system](design-system.md).
