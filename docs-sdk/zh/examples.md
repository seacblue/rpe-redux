# 完整示例

本页给出三个可以直接运行的组合示例：工具栏打开面板、设置行与 JSON 存储、事务写入谱面。每个示例都包含清单、入口和注释。

## 示例一：工具栏打开工具面板

清单：

```json
{
  "id": "example.tools",
  "name": "Example Tools",
  "version": "1.0.0",
  "engines": { "rpe-redux": ">=1.0.0-a1 <2.0.0" },
  "entry": "index.js",
  "capabilities": ["scripts", "ui.panel", "ui.sidebar", "ui.toolbar", "ui.notice"]
}
```

入口：

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
    h("h2", { text: "示例工具" }),
    h("input", {
      id: "query",
      style: { textAlign: "left" },
      attrs: { type: "search", value: state.query, placeholder: "输入关键字" },
    }),
    h("div", {
      class: "redux-list-row",
      style: { padding: "var(--space-2) var(--space-3)" },
      text: state.query ? `搜索：${state.query}` : "全部项目",
    }),
  ]);
}

export default {
  async activate(context) {
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
      icon: { name: "sliders", label: "示例工具" },
      order: 900,
    });

    const action = await context.api.toolbar.register({
      kind: "action",
      id: "open-tools",
      row: 2,
      order: 920,
      group: "example",
      label: "示例工具",
      tooltip: "打开示例工具面板",
      icon: "sliders",
      presentation: "iconText",
      async run() {
        panel.update(tree());
        await context.api.sidebar.open("open-main");
      },
    });

    context.addCleanup(() => {
      action();
      sidebar();
      panel.dispose();
    });
  },
};
```

侧栏入口负责常驻打开，工具栏动作复用同一个入口；面板状态保存在包内，由 `panel.update` 重绘。

## 示例二：设置行与 JSON 存储

清单与示例一相同，把 id 改为 `example.settings`，能力改为 `["scripts", "settings", "values", "storage", "ui.notice"]`。

入口：

```js
const CONFIG_KEY = "config";
const CONFIG_VERSION = 1;

export default {
  async activate(context) {
    const navigation = await context.api.settings.registerNavigation({
      key: "tools",
      label: context.i18n.key({ key: "settings.page" }),
      icon: "sliders",
      order: 920,
    });

    const rows = await context.api.settings.registerSetting({
      key: "quality",
      navigation: "tools",
      group: context.i18n.key({ key: "settings.group" }),
      label: { key: "settings.quality.label" },
      description: { key: "settings.quality.description" },
      control: "range",
      default: 80,
      min: 1,
      max: 100,
      step: 1,
      unit: "%",
    });

    context.scripts.register({
      id: "save",
      label: "保存当前配置",
      async run({ ui }) {
        const quality = await context.api.values.byId.get("quality");
        await context.storage.setJSON(CONFIG_KEY, {
          version: CONFIG_VERSION,
          data: { quality },
        });
        ui.notice("配置已保存", { level: "success" });
      },
    });

    context.scripts.register({
      id: "load",
      label: "载入上次配置",
      async run({ ui }) {
        const stored = await context.storage.getJSON(CONFIG_KEY);
        if (!stored || stored.version !== CONFIG_VERSION) {
          ui.notice("没有可载入的配置", { level: "info" });
          return;
        }
        await context.api.values.byId.set("quality", stored.data.quality);
        ui.notice(`已载入质量 ${stored.data.quality}%`, { level: "success" });
      },
    });

    context.addCleanup(() => {
      rows();
      navigation();
    });
  },
};
```

设置行负责用户可见的配置，`api.values.byId` 读写同一个值；`getJSON` 缺失或损坏时返回 `null`，版本字段用于以后迁移。

## 示例三：事务写入谱面

清单与示例一相同，把 id 改为 `example.shift`，能力改为 `["scripts", "chart.read", "selection.read", "chart.write", "ui.notice"]`。

入口：

```js
export default {
  activate(context) {
    context.scripts.register({
      id: "shift-right",
      label: "选区右移 10",
      parameters: {
        parameters: {
          delta: {
            kind: "number",
            default: 10,
            min: -675,
            max: 675,
            step: 1,
            label: { key: "parameter.delta.label" },
          },
        },
        order: ["delta"],
      },
      async run({ api, params, ui }) {
        const selection = await api.selection.state();
        if (!selection.ok) {
          ui.notice(selection.error.message, { level: "error" });
          return;
        }
        if (selection.value.notes.length === 0) {
          ui.notice("请先选择音符", { level: "warning" });
          return;
        }

        const lines = await api.chart.lines();
        if (!lines.ok) {
          ui.notice(lines.error.message, { level: "error" });
          return;
        }

        const delta = Number(params.delta) || 0;
        const updates = [];
        for (const reference of selection.value.notes) {
          const note = lines.value[reference.lineIndex]?.notes?.[reference.index];
          if (!note?.id || !Number.isFinite(note.positionX)) continue;
          updates.push({
            id: note.id,
            patch: { positionX: note.positionX + delta },
          });
        }

        if (updates.length === 0) return;

        const preview = await api.transaction.preview({
          label: "Shift notes",
          notes: { update: updates },
        });
        if (!preview.ok || preview.value.status !== "previewed") {
          ui.notice("预览失败", { level: "error" });
          return;
        }

        const applied = await api.transaction.apply(preview.value.previewId);
        if (!applied.ok || applied.value.status !== "committed") return;

        ui.notice(`已移动 ${updates.length} 个音符`, { level: "success" });
      },
    });
  },
};
```

谱面写入使用 `transaction.preview` → `apply`；文档变化会返回 `stale_read` 或 `conflict`。相关接口见左侧 **API** 树与[数据持久化](persistence.md)。
