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

interface SandboxPersistentSurfaceHandle extends SandboxSurfaceHandle {
  setPlacement(placement: SandboxPlacement): void;
  setVisible(visible: boolean): void;
  close(): void;
}

interface SandboxUiContext {
  pickImage(options?: { maxBytes?: number }): Promise<SandboxPickedImage | null>;
  pickFile(options?: SandboxPickFileOptions): Promise<readonly SandboxPickedFile[] | null>;
  saveFile(options: SandboxSaveFileOptions): Promise<SandboxSavedFile | null>;
  registerPanel(definition: SandboxPanelDefinition): SandboxSurfaceHandle;
  registerOverlay(definition: SandboxOverlayDefinition): SandboxSurfaceHandle;
  registerSurface(definition: SandboxSurfaceDefinition): SandboxPersistentSurfaceHandle;
  openModalSurface(definition: SandboxModalSurfaceDefinition): Promise<SandboxSurfaceResult>;
  openAnchoredSurface(definition: SandboxAnchoredSurfaceDefinition): SandboxPersistentSurfaceHandle;
  registerSidebar(definition: SandboxSidebarDefinition): () => void;
}

type SandboxUiNode =
  SandboxElementNode | SandboxTextNode | SandboxMediaNode | SandboxButtonNode | SandboxGroupNode;

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

interface SandboxPlacement {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  unit?: "px" | "fraction" | "percent";
  anchor?:
    | "top-left"
    | "top-center"
    | "top-right"
    | "center-left"
    | "center"
    | "center-right"
    | "bottom-left"
    | "bottom-center"
    | "bottom-right";
  z?: number;
}

interface SandboxMediaNode {
  kind: "media";
  id?: string;
  media:
    | { kind: "image"; src: string }
    | {
        kind: "animation";
        frames: readonly { src: string; durationMs?: number }[];
        fps?: number;
        loop?: boolean;
      };
  placement?: SandboxPlacement;
  fit?: "contain" | "cover" | "fill";
  alt: string;
  pointerEvents?: "auto" | "none";
  draggable?: boolean;
}

interface SandboxButtonNode {
  kind: "button";
  id: string;
  label: string;
  icon?: string;
  placement?: SandboxPlacement;
  variant?: "solid" | "outlined" | "ghost" | "danger";
  disabled?: boolean;
}

interface SandboxGroupNode {
  kind: "group";
  id?: string;
  layout?: "flow" | "absolute";
  placement?: SandboxPlacement;
  children: readonly SandboxUiNode[];
}

interface SandboxUiEvent {
  nodeId: string;
  kind:
    | "click"
    | "input"
    | "change"
    | "file"
    | "pointerdown"
    | "pointermove"
    | "pointerup"
    | "hover-enter"
    | "hover-leave"
    | "keydown"
    | "drag-start"
    | "drag-move"
    | "drag-end";
  value?: string;
  checked?: boolean;
  file?: { name: string; type: string; dataUrl: string };
  x?: number;
  y?: number;
  button?: number;
  key?: string;
}
```

`placement.x` and `placement.y` are normalized 0-1; `placement.unit` applies to `width` and `height` (fraction, percent, or pixels).

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

### Media, animation, and free-positioned buttons

`media` accepts an inline image/GIF data URL or blob URL. GIFs play through the browser; frame sequences play through the host at `fps` (or per-frame `durationMs`) without one bridge update per frame. `button` is a first-class node with its own placement. Use `group` with `layout: "absolute"` as the positioned coordinate space:

```js
const sprite = {
  kind: "media",
  id: "sprite",
  media: {
    kind: "animation",
    frames: [
      { src: frameA, durationMs: 120 },
      { src: frameB, durationMs: 120 },
    ],
    loop: true,
  },
  placement: { x: 0.5, y: 0.5, width: 1, height: 1, unit: "fraction", anchor: "center" },
  alt: "sprite",
};

const tree = {
  kind: "group",
  layout: "absolute",
  children: [
    sprite,
    {
      kind: "button",
      id: "talk",
      label: "Talk",
      placement: { x: 0.85, y: 0.9, unit: "fraction", anchor: "center" },
    },
  ],
};
```

### Persistent, modal, and anchored surfaces

The same tree model drives three lifecycles. `registerSurface` keeps a surface mounted until `close()` or `dispose()`; it supports `setPlacement`, `setVisible`, `draggable`, and `clickThrough`. A desktop pet is one example, not a separate API.

```js
const surface = context.ui.registerSurface({
  id: "hud",
  width: 220,
  height: 220,
  placement: { x: 0.92, y: 0.92, unit: "fraction", anchor: "bottom-right" },
  draggable: true,
  tree,
  onEvent(event) {
    if (event.kind === "click" && event.nodeId === "talk") {
      surface.setVisible(false);
    }
  },
});
```

`openModalSurface` blocks the shell and resolves when a first-class `button` is clicked or the surface is dismissed. Every first-class button closes the modal with its id as `result.action`; use an `element` with `tag: "button"` if a button must stay inside the surface. `chrome: "none"` makes the tree the whole visual; `chrome: "host"` adds the standard frame and title. `openAnchoredSurface` is non-modal, stays next to a pointer, point, node, or surface, and returns the same live handle. Use `anchor: { kind: "pointer" }` for a bubble that follows the pointer.

```js
const result = await context.ui.openModalSurface({
  id: "confirm",
  chrome: "none",
  width: 360,
  height: 260,
  tree: {
    kind: "group",
    layout: "absolute",
    children: [
      sprite,
      {
        kind: "button",
        id: "yes",
        label: "Yes",
        placement: { x: 0.3, y: 0.85, unit: "fraction", anchor: "center" },
      },
      {
        kind: "button",
        id: "no",
        label: "No",
        placement: { x: 0.7, y: 0.85, unit: "fraction", anchor: "center" },
      },
    ],
  },
});
if (result.action === "yes") {
  // commit the confirmed action
}
```

### Files

`pickFile` returns copied bytes and display names, never filesystem paths. `saveFile` opens the host save dialog and returns only the chosen display name. Both are bounded and require `ui.dialog`; `pickImage` remains the image-specific convenience.

```js
const files = await context.ui.pickFile({ accept: ["image/*"], multiple: true });
if (files) {
  for (const file of files) upload(file.name, file.type, file.bytes);
}
await context.ui.saveFile({
  suggestedName: "notes.txt",
  mimeType: "text/plain",
  bytes: new TextEncoder().encode("hello"),
});
```

### Packaged assets

Media files ship with the package instead of being picked at runtime. Declare each file under `assets` in the manifest and read it through `context.assets`; the host returns bytes or a data URL, never a filesystem path.

```json
{
  "assets": {
    "idle": "assets/idle.svg",
    "wave": "assets/wave.svg"
  }
}
```

```js
const idle = await context.assets.url("idle");
const wave = await context.assets.url("wave");
const bytes = await context.assets.read("idle");
const info = await context.assets.info("idle"); // { name, type, bytes, width, height, atlas }
const names = context.assets.names();

const pet = context.ui.registerSurface({
  id: "pet",
  width: 160,
  height: 160,
  placement: { x: 0.92, y: 0.9, unit: "fraction", anchor: "bottom-right" },
  draggable: true,
  tree: {
    kind: "media",
    id: "pet",
    media: { kind: "animation", frames: [{ src: idle }, { src: wave }], fps: 6, loop: true },
    placement: { x: 0, y: 0, width: 1, height: 1, unit: "fraction" },
    alt: "Pet",
  },
});
```

Assets are restricted to relative media paths (PNG, JPEG, WebP, GIF, SVG, AVIF, BMP), at most 64 per package, 4 MB per file and 12 MB total. The package must declare `assets.read`. Bundled packages read from the application bundle; installed and portable packages read from their package folder.

Declare atlas geometry in the manifest when one image contains a frame grid:

```json
{
  "assets": { "sheet": "assets/sheet.png" },
  "assetMetadata": {
    "sheet": { "frameWidth": 32, "frameHeight": 32, "columns": 4, "rows": 2 }
  }
}
```

`context.assets.info("sheet")` returns `width`, `height`, and the same `atlas` object. Intrinsic dimensions are read from the media header; a header that cannot be parsed returns `null` rather than guessing.

## Permissions and limits

{{UI_LIMITS_TABLE}}

Panels and overlays require `ui.panel` and `ui.overlay`; sidebar entries require `ui.sidebar`; modal surfaces and file dialogs require `ui.dialog`. Persistent and anchored surfaces mount through the overlay host and require `ui.overlay`. The host applies the design system, theme tokens, focus, and accessibility semantics.

## Errors and recovery

Unsupported tags, attributes, styles, URLs, and oversized trees are rejected or trimmed at the sandbox boundary. Register a valid replacement tree and surface the failure through `ui.notice`.

## Related APIs

See `ui.registerPanel`, `ui.registerSidebar`, `ui.registerSurface`, `ui.openModalSurface`, `ui.openAnchoredSurface`, `ui.pickFile`, `ui.saveFile`, and [Design system](design-system.md).
