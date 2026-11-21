# 声明式 UI

用声明式节点树注册扩展面板、覆盖层和侧栏入口；宿主负责渲染、焦点和事件回传，包只维护状态与数据。

## 用途

声明式 UI 适合工具面板、检查器、HUD、预览标记和轻量设置界面。节点是纯数据，可以跨沙箱桥传输；宿主用设计系统原语渲染，包代码不接触宿主 DOM。

## 签名

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

`placement.x` 和 `placement.y` 是 0-1 的归一化坐标；`placement.unit` 只作用于 `width` 和 `height`（fraction、percent 或 px）。

允许的标签：

{{UI_TAGS_TABLE}}

允许的 `input` 类型：

{{UI_INPUT_TYPES_TABLE}}

允许的属性：

{{UI_ATTRS_TABLE}}

## 最小示例

注册一个面板，输入名称后立即更新标题：

```js
const h = (tag, props = {}, children = []) => ({
  kind: "element",
  tag,
  ...props,
  children,
});

const state = { name: "" };
let panel;

function tree() {
  return h("div", { style: { display: "grid", gap: "var(--space-3)" } }, [
    h("h2", { text: state.name || "未命名工具" }),
    h("label", { style: { display: "grid", gap: "var(--space-1)" } }, [
      h("span", { text: "名称" }),
      h("input", {
        id: "name",
        style: { textAlign: "left" },
        attrs: { type: "text", value: state.name, placeholder: "输入名称" },
      }),
    ]),
  ]);
}

export default {
  activate(context) {
    panel = context.ui.registerPanel({
      id: "main",
      tree: tree(),
      onEvent(event) {
        if (event.kind === "input" && event.nodeId === "name") {
          state.name = event.value ?? "";
          panel.update(tree());
        }
      },
    });
    context.addCleanup(() => panel.dispose());
  },
};
```

## 进阶用法

### 表单与选择

```js
h("select", { id: "format", attrs: { value: state.format } }, [
  h("option", { attrs: { value: "pez" }, text: "PEZ" }),
  h("option", { attrs: { value: "json" }, text: "官方 JSON" }),
]);

h("input", {
  id: "enabled",
  attrs: { type: "checkbox", checked: state.enabled },
});

h("input", {
  id: "quality",
  attrs: { type: "range", min: 1, max: 100, step: 1, value: state.quality },
});
```

### 列表与空态

```js
h(
  "div",
  { attrs: { role: "listbox", "aria-label": "最近项目" } },
  state.items.length
    ? state.items.map((item, index) =>
        h("div", {
          id: `item-${index}`,
          class: "redux-list-row",
          style: { padding: "var(--space-2) var(--space-3)" },
          attrs: { role: "option", "aria-selected": index === state.selected },
          text: item.name,
        }),
      )
    : [
        h("div", { class: "redux-empty-state", attrs: { role: "status" } }, [
          h("strong", { text: "还没有项目" }),
          h("p", { text: "打开一个谱面后会显示最近记录。" }),
        ]),
      ],
);
```

### 图片选择

```js
h("button", {
  id: "pick",
  text: "选择图片",
  attrs: { action: "pick-image", maxBytes: 512000 },
});

// onEvent:
if (event.kind === "file" && event.nodeId === "pick") {
  const image = event.file;
  context.ui.notice(`已选择 ${image?.name ?? "图片"}`, { level: "success" });
}
```

图片源只接受 `data:image/...` 或 `blob:`；远程 URL、`file:`、`javascript:` 和相对路径会被拒绝。

### 更新树

```js
panel.update(tree());
panel.update(tree(), { replace: true }); // 重新挂载输入，恢复模型值
```

### 覆盖层

```js
const overlay = context.ui.registerOverlay({
  id: "hud",
  scope: "stage",
  order: 20,
  tree: h("div", {
    style: {
      position: "absolute",
      left: "var(--space-4)",
      top: "var(--space-4)",
      pointerEvents: "none",
    },
    attrs: { "aria-hidden": "true" },
    text: "预览 HUD",
  }),
});
context.addCleanup(() => overlay.dispose());
```

### 图像、动画与任意位置按钮

`media` 接受内联图片/GIF 的 data URL 或 blob URL；GIF 由浏览器播放，帧序列由宿主按 `fps` 或每帧 `durationMs` 播放，不需要每帧走桥。`button` 是一等节点，自带 `placement`；用 `layout: "absolute"` 的 `group` 作为定位坐标系：

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
      label: "对话",
      placement: { x: 0.85, y: 0.9, unit: "fraction", anchor: "center" },
    },
  ],
};
```

### 持久、模态与锚定 surface

同一棵树可以挂到三种生命周期。`registerSurface` 保持挂载直到 `close()`/`dispose()`，支持 `setPlacement`、`setVisible`、`draggable`、`clickThrough`；桌宠只是它的一个例子，不是单独的 API。

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

`openModalSurface` 阻塞外壳，点击一等 `button` 或关闭时返回结果；每个一等按钮都会以其 id 作为 `result.action` 关闭模态，若按钮需要留在 surface 内，请使用 `tag: "button"` 的 `element`。`chrome: "none"` 让树成为全部视觉，`chrome: "host"` 加标准外框。`openAnchoredSurface` 非模态，跟随指针、点、节点或另一个 surface，并返回同一个可更新 handle。用 `anchor: { kind: "pointer" }` 做跟随指针的气泡。

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
        label: "是",
        placement: { x: 0.3, y: 0.85, unit: "fraction", anchor: "center" },
      },
      {
        kind: "button",
        id: "no",
        label: "否",
        placement: { x: 0.7, y: 0.85, unit: "fraction", anchor: "center" },
      },
    ],
  },
});
if (result.action === "yes") {
  // 提交确认后的动作
}
```

### 文件

`pickFile` 返回复制后的字节和显示名，永远不返回文件路径；`saveFile` 打开宿主保存对话框，只返回显示名。两者都受大小限制并需要 `ui.dialog`；`pickImage` 保留为图片专用便捷方法。

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

### 包内资源

媒体文件随扩展包分发，而不是运行时再让用户选择。在 manifest 的 `assets` 中声明文件，通过 `context.assets` 读取；宿主只返回字节或 data URL，不暴露文件系统路径。

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
    alt: "桌宠",
  },
});
```

资源只接受相对媒体路径（PNG、JPEG、WebP、GIF、SVG、AVIF、BMP），每个包最多 64 个，单文件 4 MB、总计 12 MB。包需要声明 `assets.read`。内置包从应用包读取，安装包和便携包从扩展目录读取。`builtin.pet` 是一个可直接启用的完整示例。

如果一张图包含帧网格，可以在 manifest 中声明 atlas：

```json
{
  "assets": { "sheet": "assets/sheet.png" },
  "assetMetadata": {
    "sheet": { "frameWidth": 32, "frameHeight": 32, "columns": 4, "rows": 2 }
  }
}
```

`context.assets.info("sheet")` 会返回 `width`、`height` 和同一个 `atlas` 对象。宽高从媒体头读取；无法解析时返回 `null`，而不是猜测。

## 权限与上限

| 能力         | 授予的表面                                                             |
| ------------ | ---------------------------------------------------------------------- |
| `ui.panel`   | `context.ui.registerPanel`                                             |
| `ui.overlay` | `context.ui.registerOverlay`、`registerSurface`、`openAnchoredSurface` |
| `ui.sidebar` | `context.ui.registerSidebar`                                           |
| `ui.dialog`  | `openModalSurface`、`pickFile`、`saveFile`、`pickImage`                |

{{UI_LIMITS_TABLE}}

- 根节点必须是合法元素；未知标签、属性和样式项会被丢弃。
- 节点 `id` 用于事件路由，最长 128 字符；`class` 最长 256 字符。
- 图片通过 `ui.pickImage()` 或 `action: "pick-image"` 选择，默认上限 512 KB。
- 文件通过 `ui.pickFile()`/`ui.saveFile()` 读写，默认上限 8 MB；文件名会被清洗，包永远拿不到路径。
- `media` 帧序列最多 120 帧；位置、尺寸、z-index 和媒体 URL 都在桥边界校验。

## 错误与恢复

| 错误/现象 | 原因 | 恢复 |
| --- | --- | --- |
| `Extension UI tree is invalid or too large` | 根节点非法或超出预算 | 检查根标签、节点数和深度 |
| 后半棵树没有渲染 | 超过 256 节点或 16 层 | 拆分面板或减少包装层 |
| `capabilityDenied` | 没有 `ui.panel` / `ui.overlay` / `ui.sidebar` / `ui.dialog` | 在清单声明能力并重新确认 |
| `methodNotRegistered` | 宿主门面没有登记该 UI 方法 | 升级宿主或换用已登记方法 |
| 输入值不更新 | 受控输入保留了本地草稿 | 使用 `update(tree, { replace: true })` |
| 事件没有触发 | 交互节点缺少 `id` | 给每个可交互节点稳定 `id` |

树校验失败会抛错并计入扩展失败预算；溢出预算会静默截断，不抛错。

## 相关接口

- [面板与菜单](panels-and-menus.md)：注册面板、侧栏、工具栏和覆盖层。
- [设计系统](design-system.md)：组件参数、token 和图标目录。
- `ui.registerSurface`、`ui.openModalSurface`、`ui.openAnchoredSurface`、`ui.pickFile`、`ui.saveFile`：图像/动画 surface 与文件对话框。
- 左侧 **API** 树：确认 `ui.*` 方法是否已登记；异步约定见[API 约定](api-reference.md)。
