# 面板与菜单

注册扩展自己的面板、侧栏入口、工具栏动作、右键菜单和覆盖层，并让后台动作打开对应面板。

## 用途

面板承载有状态的工具界面；侧栏入口提供常驻打开方式；工具栏和右键菜单放一次性命令；覆盖层显示 HUD、预览标记和非交互提示。所有注册都由宿主排版，包只提供描述符和回调。

## 签名

```ts
// 面板
context.ui.registerPanel(definition: {
  id: string;
  tree: SandboxUiNode;
  onEvent?(event: SandboxUiEvent): void;
}): { update(tree, options?): void; dispose(): void };

// 侧栏
context.ui.registerSidebar(definition:
  | { id: string; panelId: string; icon: { name: string; label: string; domId?: string }; order?: number }
  | { kind: "divider"; id: string; order?: number }
): () => void;

// 工具栏
context.api.toolbar.register(entry: ToolbarEntry): Promise<() => void>;
context.api.toolbar.unregister(id: string): Promise<boolean>;

// 右键菜单
context.api.contextMenu.register(entry: ContextMenuItem): Promise<() => void>;
context.api.contextMenu.update(entry: ContextMenuItem): Promise<boolean>;
context.api.contextMenu.unregister(id: string): Promise<boolean>;

// 覆盖层
context.ui.registerOverlay(definition: {
  id: string;
  tree: SandboxUiNode;
  scope?: "stage" | "window";
  order?: number;
  onEvent?(event: SandboxUiEvent): void;
}): { update(tree, options?): void; dispose(): void };
```

工具栏动作的关键字段：

| 字段                | 说明                                                            |
| ------------------- | --------------------------------------------------------------- |
| `kind`              | 固定为 `action`                                                 |
| `id`                | 包内本地 id，宿主加 `extension.<owner>.` 前缀                   |
| `row`               | `1` 或 `2`；省略时不绘制按钮，只保留菜单/快捷键入口             |
| `order`             | 同一区域内的排序                                                |
| `group`             | 工具栏分组                                                      |
| `label` / `tooltip` | 显示文字和提示                                                  |
| `icon`              | 设计系统图标名称                                                |
| `presentation`      | `icon`、`text` 或 `iconText`                                    |
| `cells`             | `1` 到 `32`；省略或 `"auto"` 时前端首次布局按本地化按钮宽度计算 |
| `run(target?)`      | 执行动作；可接收 `ContextMenuTarget`                            |

右键菜单的关键字段：

| 字段                      | 说明                        |
| ------------------------- | --------------------------- |
| `id`                      | 包内本地 id                 |
| `order`                   | 菜单行排序                  |
| `contexts`                | `notes`、`events`、`marker` |
| `label` / `tooltip`       | 显示文字                    |
| `icon` / `danger`         | 图标与危险色                |
| `visible()` / `enabled()` | 动态显示与禁用              |
| `run(target?)`            | 执行命令                    |

## 最小示例

注册面板和侧栏入口：

```js
const h = (tag, props = {}, children = []) => ({
  kind: "element",
  tag,
  ...props,
  children,
});

const state = { query: "" };
let panel;

function tree() {
  return h("div", { style: { display: "grid", gap: "var(--space-3)" } }, [
    h("h2", { text: "我的工具" }),
    h("input", {
      id: "query",
      style: { textAlign: "left" },
      attrs: { type: "search", value: state.query, placeholder: "搜索" },
    }),
    h("div", {
      class: "redux-list-row",
      style: { padding: "var(--space-2) var(--space-3)" },
      text: state.query || "全部项目",
    }),
  ]);
}

export default {
  activate(context) {
    panel = context.ui.registerPanel({
      id: "main",
      tree: tree(),
      onEvent(event) {
        if (event.kind === "input" && event.nodeId === "query") {
          state.query = event.value ?? "";
          panel.update(tree());
        }
      },
    });

    const sidebar = context.ui.registerSidebar({
      id: "open-main",
      panelId: "main",
      icon: { name: "sliders", label: "我的工具" },
      order: 900,
    });

    context.addCleanup(() => {
      sidebar();
      panel.dispose();
    });
  },
};
```

侧栏入口点击后，宿主按 `panelId` 打开面板。面板和侧栏 id 都会加 `extension.<owner>.` 前缀；包内继续使用本地 id。

## 进阶用法

### 从工具栏打开面板

后台动作调用已注册的侧栏入口，面板随 `panelId` 打开：

```js
const openTools = {
  kind: "action",
  id: "open-tools",
  row: 2,
  order: 920,
  group: "example",
  label: "我的工具",
  tooltip: "打开扩展面板",
  icon: "sliders",
  presentation: "iconText",
  async run() {
    panel.update(tree());
    await context.api.sidebar.open("open-main");
  },
};

// activate 可以是 async：所有 context.api 方法都返回 Promise。
const dispose = await context.api.toolbar.register(openTools);
context.addCleanup(dispose);
```

`api.sidebar.open(id)` / `close(id)` 接受当前包注册的侧栏项 id。这就是当前契约中的打开入口；`api.ui.panel.open/close` 和 `api.ui.sidebar.open/close` 不属于已发布 API。

### 右键菜单

```js
const dispose = await context.api.contextMenu.register({
  id: "inspect-selection",
  order: 900,
  contexts: ["notes", "events"],
  label: "检查选区",
  icon: "info",
  separatorBefore: true,
  run(target) {
    context.ui.notice(`surface=${target?.surface ?? "unknown"}`, {
      level: "info",
    });
  },
});
context.addCleanup(dispose);
```

`target.noteIds` 和 `target.refs` 需要 `selection.read`；`target.beat`、`chartSeconds` 需要 `chart.read`。扩展注册的 `shortcutId` 会被剥离，`shortcut` 只是显示文本。

### 覆盖层

```js
const overlay = context.ui.registerOverlay({
  id: "selection-hud",
  scope: "window",
  order: 30,
  tree: h("div", {
    class: "redux-card",
    style: {
      position: "absolute",
      right: "var(--space-4)",
      bottom: "var(--space-4)",
      padding: "var(--space-2) var(--space-3)",
      pointerEvents: "none",
    },
    text: "已选择 0 个对象",
  }),
});
context.addCleanup(() => overlay.dispose());
```

`scope: "stage"` 跟随编辑器舞台；`scope: "window"` 覆盖整个应用窗口。覆盖层默认不接收指针事件，需要交互时给最小子节点设置 `pointerEvents: "auto"`。

### 清理与顺序

```js
context.addCleanup(() => {
  action();
  sidebar();
  panel.dispose();
});
```

先注册面板，再注册侧栏和工具栏；清理顺序与注册顺序相反。`order` 只影响同一宿主区域内的相对顺序，建议留出间隔。

## 权限与上限

| 入口     | 能力             | 说明                           |
| -------- | ---------------- | ------------------------------ |
| 面板     | `ui.panel`       | 注册一个或多个面板             |
| 侧栏     | `ui.sidebar`     | 图标入口或分隔线               |
| 工具栏   | `ui.toolbar`     | 动作、控件、字段、分隔线、占位 |
| 右键菜单 | `ui.contextMenu` | 行注册、更新、删除             |
| 覆盖层   | `ui.overlay`     | 舞台或窗口层                   |

- 面板树受 256 节点、16 层和 512 KB 图片限制，详见[声明式 UI](ui-reference.md)。
- 工具栏动作最多影响自己的 id；不能注册宿主快捷键或 `shortcut:*`。
- 菜单行只能操作本包注册的 id；其他包的 id 会被拒绝。
- 侧栏图标名称来自[设计系统图标目录](design-system.md#图标)。

## 错误与恢复

| 错误/现象             | 原因                         | 恢复                               |
| --------------------- | ---------------------------- | ---------------------------------- |
| `capabilityDenied`    | 缺少对应 `ui.*` 能力         | 在清单声明能力并重新确认           |
| `methodNotRegistered` | 目标方法未登记               | 查方法表，改用已登记入口           |
| 侧栏点击无面板        | `panelId` 未注册或拼写不一致 | 先注册面板，再注册侧栏             |
| 面板打开后空白        | 树根非法或被预算截断         | 检查根标签、节点数和深度           |
| 菜单行不显示          | `contexts` 不匹配当前表面    | 添加 `notes` / `events` / `marker` |
| 注册重复              | 同一 id 注册了两次           | 每次重载先释放旧注册               |

## 相关接口

- [声明式 UI](ui-reference.md)：节点、属性、事件和预算。
- [设计系统](design-system.md)：按钮、列表、卡片、通知和图标。
- 左侧 **API** 树：`ui.panel`、`ui.sidebar`、`ui.toolbar`、`ui.contextMenu` 的方法页；每个方法页都包含自己的权限、返回值和错误处理。
