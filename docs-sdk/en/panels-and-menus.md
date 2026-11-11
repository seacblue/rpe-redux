# Panels and menus

An Extension can register panels, sidebar entries, toolbar actions, context-menu rows, and overlays. The host lays out every contribution; the package supplies descriptors and callbacks.

## Purpose

Use panels for stateful tools, sidebar entries for persistent entry points, toolbar or context-menu rows for commands, and overlays for HUD or preview content. All registrations belong to the package activation and are released when it is disabled or unloaded.

## Signature

```ts
// Panel
context.ui.registerPanel(definition: {
  id: string;
  tree: SandboxUiNode;
  onEvent?(event: SandboxUiEvent): void;
}): { update(tree, options?): void; dispose(): void };

// Sidebar
context.ui.registerSidebar(definition:
  | { id: string; panelId: string; icon: { name: string; label: string; domId?: string }; order?: number }
  | { kind: "divider"; id: string; order?: number }
): () => void;

// Toolbar
context.api.toolbar.register(entry: ToolbarEntry): Promise<() => void>;
context.api.toolbar.unregister(id: string): Promise<boolean>;

// Context menu
context.api.contextMenu.register(entry: ContextMenuItem): Promise<() => void>;
context.api.contextMenu.update(entry: ContextMenuItem): Promise<boolean>;
context.api.contextMenu.unregister(id: string): Promise<boolean>;

// Overlay
context.ui.registerOverlay(definition: {
  id: string;
  tree: SandboxUiNode;
  scope?: "stage" | "window";
  order?: number;
  onEvent?(event: SandboxUiEvent): void;
}): { update(tree, options?): void; dispose(): void };
```

Toolbar action fields:

| Field               | Meaning                                                           |
| ------------------- | ----------------------------------------------------------------- |
| `kind`              | Fixed to `action`.                                                |
| `id`                | Package-local id; the host prefixes `extension.<owner>.`.         |
| `row`               | `1` or `2`; omit for a menu/shortcut-only command with no button. |
| `order`             | Sort order inside its group.                                      |
| `group`             | Toolbar grouping key.                                             |
| `label` / `tooltip` | Display text and hint.                                            |
| `icon`              | Design-system icon name.                                          |
| `presentation`      | `icon`, `text`, or `iconText`.                                    |
| `cells`             | `1`–`32`, or `"auto"` to measure the localized button once.       |
| `run(target?)`      | Executes the command; may receive a `ContextMenuTarget`.          |

Context-menu row fields:

| Field                     | Meaning                               |
| ------------------------- | ------------------------------------- |
| `id`                      | Package-local id.                     |
| `order`                   | Menu row order.                       |
| `contexts`                | `notes`, `events`, and/or `marker`.   |
| `label` / `tooltip`       | Display text.                         |
| `icon` / `danger`         | Icon name and destructive styling.    |
| `visible()` / `enabled()` | Dynamic visibility and enabled state. |
| `run(target?)`            | Executes the command.                 |

## Minimal example

Register a panel, a sidebar entry that opens it, and a toolbar action that opens the same entry:

```js
const disposePanel = context.ui.registerPanel({
  id: "example.panel",
  tree: {
    kind: "element",
    tag: "section",
    children: [
      { kind: "element", tag: "h2", text: "Example" },
      { kind: "text", text: "Rendered by the host." },
    ],
  },
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
  label: "Example",
  tooltip: "Open the example panel",
  icon: "sliders",
  run: () => context.api.sidebar.open("open-example"),
});
```

The package needs `ui.panel`, `ui.sidebar`, and `ui.toolbar` for these three registrations.

## Advanced use

Keep related contributions in one stable namespace and dispose them during package deactivation. A toolbar action may set explicit `cells`; omitted or `"auto"` measures its localized label once after layout. A context-menu action can read the projected target without receiving DOM nodes or host objects.

## Permissions and limits

Panels, sidebars, overlays, toolbar actions, and context menus require their corresponding `ui.*` capability. The host owns ordering, focus, and surface geometry; a package cannot move another package's contribution. A panel or overlay tree is bounded by the declarative UI limits.

## Errors and recovery

Duplicate ids, invalid descriptors, missing capabilities, and unavailable surfaces return structured errors. Keep the disposer and re-register only after correcting the descriptor.

## Related APIs

See [Declarative UI](ui-reference.md), [Layout](api:layout.anchors), [Toolbar](api:toolbar.register), [Sidebar](api:sidebar.register), and [Context menu](api:contextMenu.register).
