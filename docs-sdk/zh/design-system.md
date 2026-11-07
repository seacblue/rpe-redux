# 设计系统

扩展界面由声明式树和宿主设计原语组成。本页按“用途 + 参数 + 示例”列出常用组件和 token；完整节点约束见[声明式 UI](ui-reference.md)。

## 基础写法

```js
const h = (tag, props = {}, children = []) => ({
  kind: "element",
  tag,
  ...props,
  children,
});
```

节点字段：`tag`、`id`、`class`、`style`、`attrs`、`text`、`children`。`style` 处理布局；颜色、圆角、间距、字号和阴影使用 token。外观样式通过 `context.styles.add()` 添加，宿主会包进所有者作用域的 `@scope`。

## 设计 token

用途：在样式表和节点 `style` 中通过 `var(--token)` 引用，按用途选择而不是按数值大小选择。

参数：

{{DESIGN_TOKEN_TABLES}}

完整颜色集合是 `THEME_COLOR_TOKENS`（`src/core/theme/colorTokens.ts`）。`--canvas-*` 与 `--grid-*` 用于画布和时间轴。

```js
context.styles.add(`
  .hello-section {
    display: grid;
    gap: var(--space-2);
    padding: var(--space-3);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-control);
    background: var(--surface-muted);
    color: var(--foreground-muted);
    font-size: var(--type-caption);
  }
`);
```

## 按钮

用途：提交、取消、执行命令、打开面板。声明式 `<button>` 渲染为官方 `Button`，默认 `outlined`。

参数：`id` / `text` 是事件路由和按钮文字；`class` 可加 `redux-button-solid` 表示主操作；`attrs.disabled` 禁用；点击事件读取 `event.nodeId`。

```js
h("div", { style: { display: "flex", gap: "var(--space-2)" } }, [
  h("button", { id: "cancel", text: "取消" }),
  h("button", { id: "apply", class: "redux-button-solid", text: "应用" }),
]);
```

## 输入框

用途：接收文本、搜索词、数字、URL 或颜色值。声明式 `<input>` 渲染为官方 `Input`。

参数：`attrs.type` 支持 `text`、`search`、`number`、`range`、`checkbox`、`color`、`url`；`value` / `placeholder` 是初始值和占位；`min` / `max` / `step` 是数字边界；`style.textAlign` 控制对齐；`input` 事件读取 `event.value`。

```js
h("input", {
  id: "name",
  style: { textAlign: "left" },
  attrs: { type: "text", value: state.name, placeholder: "未命名项目" },
});

h("input", {
  id: "count",
  attrs: { type: "number", min: 1, max: 64, step: 1, value: state.count },
});
```

## 下拉选择

用途：从固定选项中选择一个值。`<select>` 渲染为官方 `Select`，选项使用 `<option>`。

参数：`attrs.value` 是当前选中值；`option.attrs.value` / `option.text` 是选项值和显示文字；`change` 事件读取 `event.value`；`attrs.disabled` 禁用。

```js
h("select", { id: "format", attrs: { value: state.format } }, [
  h("option", { attrs: { value: "pez" }, text: "PEZ" }),
  h("option", { attrs: { value: "json" }, text: "官方 JSON" }),
  h("option", { attrs: { value: "pec" }, text: "PEC" }),
]);
```

## 开关（复选框）

用途：表示启用、显示、覆盖等布尔状态。

参数：`attrs.type` 固定为 `checkbox`；`attrs.checked` 是初始勾选状态；`attrs.disabled` 禁用；`change` 事件读取 `event.checked`。

```js
h("label", { style: { display: "inline-flex", alignItems: "center", gap: "var(--space-2)" } }, [
  h("input", { id: "enabled", attrs: { type: "checkbox", checked: state.enabled } }),
  h("span", { text: "启用快速导出" }),
]);
```

## 滑杆

用途：在连续或离散范围内调整数值。`<input type="range">` 渲染为官方 `Slider`。

参数：`attrs.min` / `max` 是范围边界；`attrs.step` 是步长；`attrs.value` 是初始值；`input` 事件读取 `event.value`。

```js
h("div", { style: { display: "grid", gap: "var(--space-1)" } }, [
  h("span", { text: `导出质量 ${state.quality}%` }),
  h("input", {
    id: "quality",
    attrs: { type: "range", min: 1, max: 100, step: 1, value: state.quality },
  }),
]);
```

## 列表行

用途：展示可选择的行、最近项目、搜索结果和资源列表。

参数：`class` 使用 `redux-list-row`；`attrs.role` 容器用 `listbox`、行用 `option`；`attrs.aria-selected` 标记当前项；`style.padding` 使用 spacing token。

```js
h(
  "div",
  { attrs: { role: "listbox", "aria-label": "最近项目" } },
  state.items.map((item, index) =>
    h("div", {
      id: `item-${index}`,
      class: "redux-list-row",
      style: { padding: "var(--space-2) var(--space-3)" },
      attrs: { role: "option", "aria-selected": index === state.selected },
      text: item.name,
    }),
  ),
);
```

## 卡片

用途：把相关字段或列表包成一个有边界的表面。

参数：`class` 使用 `redux-card`；`style` 外层用 `display: grid` 和 `gap`；子节点放标题、字段和按钮。

```js
h("section", { class: "redux-card", style: { display: "grid", gap: "var(--space-3)" } }, [
  h("h3", { text: "导出选项" }),
  h("button", { id: "export", text: "开始导出" }),
]);
```

## 空态

用途：列表为空、搜索无结果或项目尚未创建时说明当前状态。

参数：`class` 使用 `redux-empty-state`，紧凑场景加 `redux-empty-state-inline`；`attrs.role` 为 `status`；`strong` / `p` 放标题和说明。

```js
h("div", { class: "redux-empty-state", attrs: { role: "status" } }, [
  h("strong", { text: "还没有可导出的内容" }),
  h("p", { text: "先在谱面里添加至少一条判定线。" }),
]);
```

## 通知与进度

用途：显示信息、成功、警告、错误和长任务进度。

参数：`message` 是文本或 i18n 文本；`level` 为 `info` / `success` / `warning` / `error`；`timeoutMs` 自动关闭；`step` / `totalSteps` 显示分步；`ui.progress(title, totalSteps)` 返回 `update` / `close`。

```js
context.ui.notice("导入完成", { level: "success" });

const progress = context.ui.progress("导入资源", 3);
progress.update("读取清单");
progress.update("复制图片");
progress.close();
```

## 对话框

用途：确认操作、收集文本、选择选项、运行分步引导。

参数：`ui.confirm(message)` 返回 `Promise<boolean>`；`ui.input(options)` 接受 `title`、`description`、`defaultValue`、`placeholder`、`multiline`；`ui.select(options)` 接受 `title`、`options`、`defaultValue`；`ui.guide(options)` 接受 `title`、`steps` 和按钮文案。

```js
const confirmed = await context.ui.confirm("覆盖现有文件？");
if (!confirmed) return;

const name = await context.ui.input({
  title: "新文件名",
  description: "不需要扩展名。",
  placeholder: "my-chart",
  confirmLabel: "继续",
  cancelLabel: "取消",
});

const format = await context.ui.select({
  title: "选择格式",
  options: [
    { value: "pez", label: "PEZ" },
    { value: "json", label: "官方 JSON" },
  ],
  defaultValue: "pez",
});
```

## 图标

用途：脚本、侧栏、设置导航、工具栏和右键菜单通过名称引用设计系统图标；未知名称回退到 `help`。

参数：脚本 `icon`、侧栏 `icon.name` / `icon.label`、设置导航、工具栏和菜单的 `icon` 都接受图标名称字符串。

{{ICON_NAMES}}

声明式面板没有图标节点；面板内使用文本标签或官方按钮文字。

## 布局

用途：用 `style` 处理布局，用 token 处理节奏。

参数：`display`、`grid-template-columns`、`gap`、`padding`、`position`、`overflow`、`align-items` 等布局属性。

```js
h(
  "div",
  {
    style: {
      display: "grid",
      gridTemplateColumns: "1fr auto",
      alignItems: "center",
      gap: "var(--space-2)",
      padding: "var(--space-3)",
    },
  },
  [
    h("span", { text: "目标线" }),
    h("input", { id: "line", attrs: { type: "number", min: 0, max: 99, value: state.line } }),
  ],
);
```

样式作用域、节点预算和事件规则见[声明式 UI](ui-reference.md)。
