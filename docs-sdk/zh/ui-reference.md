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

## 权限与上限

| 能力         | 授予的表面                   |
| ------------ | ---------------------------- |
| `ui.panel`   | `context.ui.registerPanel`   |
| `ui.overlay` | `context.ui.registerOverlay` |
| `ui.sidebar` | `context.ui.registerSidebar` |

{{UI_LIMITS_TABLE}}

- 根节点必须是合法元素；未知标签、属性和样式项会被丢弃。
- 节点 `id` 用于事件路由，最长 128 字符；`class` 最长 256 字符。
- 图片通过 `ui.pickImage()` 或 `action: "pick-image"` 选择，默认上限 512 KB。

## 错误与恢复

| 错误/现象 | 原因 | 恢复 |
| --- | --- | --- |
| `Extension UI tree is invalid or too large` | 根节点非法或超出预算 | 检查根标签、节点数和深度 |
| 后半棵树没有渲染 | 超过 256 节点或 16 层 | 拆分面板或减少包装层 |
| `capabilityDenied` | 没有 `ui.panel` / `ui.overlay` / `ui.sidebar` | 在清单声明能力并重新确认 |
| `methodNotRegistered` | 宿主门面没有登记该 UI 方法 | 升级宿主或换用已登记方法 |
| 输入值不更新 | 受控输入保留了本地草稿 | 使用 `update(tree, { replace: true })` |
| 事件没有触发 | 交互节点缺少 `id` | 给每个可交互节点稳定 `id` |

树校验失败会抛错并计入扩展失败预算；溢出预算会静默截断，不抛错。

## 相关接口

- [面板与菜单](panels-and-menus.md)：注册面板、侧栏、工具栏和覆盖层。
- [设计系统](design-system.md)：组件参数、token 和图标目录。
- 左侧 **API** 树：确认 `ui.*` 方法是否已登记；异步约定见[API 约定](api-reference.md)。
