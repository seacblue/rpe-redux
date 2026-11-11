# 谱面操作

谱面写入统一叫**事务（transaction）**。先读当前谱面，再组装一个请求，最后通过 `context.api.transaction` 提交。宿主会校验请求、只应用一次，并写入撤销历史。

本页是任务指南。返回值和错误模型见 [API 约定](api-reference.md)；每个方法的精确签名以左侧自动生成的 API 树为准。

## 清单

脚本入口需要 `scripts`，读谱面需要 `chart.read`，写谱面需要 `chart.write`，反馈提示需要 `ui.notice`：

```json
{
  "kind": "extension",
  "id": "example.chart-ops",
  "name": "Chart Ops",
  "version": "1.0.0",
  "engines": { "rpe-redux": 1 },
  "entry": "index.js",
  "capabilities": ["scripts", "chart.read", "chart.write", "ui.notice"]
}
```

用户会在安装确认框里看到这些能力。只读插件不要申请 `chart.write`。

## 先读，再写

`chart` 返回的是 detached 快照，不能直接改。读取 id、索引和位置，用它们组装事务。

```js
const lines = await api.chart.lines();
if (!lines.ok) {
  ui.notice(lines.error.message, { level: "error" });
  return;
}

const firstLine = lines.value[0];
if (!firstLine) {
  ui.notice("这张谱面还没有判定线。", { level: "warning" });
  return;
}
```

常用读取：

| 调用                | 返回                                     |
| ------------------- | ---------------------------------------- |
| `chart.state()`     | 当前谱面指纹和修订代数。                 |
| `chart.lines()`     | 所有判定线，以及每条线的音符和事件层。   |
| `chart.notes()`     | 所有音符引用，带所属判定线 id 和索引。   |
| `chart.events()`    | 所有事件引用，带判定线、轨道、层和索引。 |
| `chart.snapshot()`  | 整张谱面的冻结副本。                     |
| `selection.state()` | 当前选中的音符和事件引用。               |

## 放一个音符

最短的完整插件：在第一条判定线第 0 拍插入一个 Tap。

```js
export default {
  activate(context) {
    context.scripts.register({
      id: "add-tap",
      label: "在第 0 拍放一个 Tap",
      description: "在第一条判定线插入一个单点音符。",
      icon: "plus",

      async run({ api, ui }) {
        const lines = await api.chart.lines();
        if (!lines.ok) {
          ui.notice(`读取失败：${lines.error.code}`, { level: "error" });
          return;
        }
        if (lines.value.length === 0) {
          ui.notice("这张谱面还没有判定线。", { level: "warning" });
          return;
        }

        const result = await api.transaction.apply({
          label: "在第 0 拍放一个 Tap",
          notes: {
            insert: [
              {
                lineIndex: 0,
                note: {
                  type: 1,
                  startTime: [0, 0, 1],
                  endTime: [0, 0, 1],
                  positionX: 0,
                  above: 1,
                },
              },
            ],
          },
        });

        if (!result.ok) {
          ui.notice(`事务失败：${result.error.code}`, { level: "error" });
          return;
        }
        if (result.value.status === "committed") {
          ui.notice("Tap 已插入。", { level: "success" });
        } else {
          ui.notice(`事务状态：${result.value.status}`, { level: "warning" });
        }
      },
    });
  },
};
```

`startTime` 和 `endTime` 是**约分后的拍三元组**，不是秒。`[0, 1, 2]` 表示 `0.5` 拍，`[3, 0, 1]` 表示 `3` 拍。插入时不要自己造 `id`，宿主会分配。

## 请求结构

```js
{
  label: "显示在撤销历史里的名字",

  metadata: { name: "曲名", charter: "谱师", offset: 0 },

  timing: {
    bpmList: [{ bpm: 180, startTime: [0, 0, 1] }]
  },

  lines: {
    insert: [{ line: { Name: "主线" } }],
    update: [{ id: "<line-id>", patch: { Name: "改名" } }]
  },

  notes: {
    insert: [{
      lineIndex: 0,
      note: { type: 1, startTime: [0, 0, 1], endTime: [0, 0, 1], positionX: 0, above: 1 }
    }],
    update: [{ id: "<note-id>", patch: { positionX: 120 } }],
    delete: ["<note-id>"]
  },

  events: {
    insert: [{
      lineIndex: 0,
      eventType: "moveXEvents",
      event: { startTime: [0, 0, 1], endTime: [1, 0, 1], start: 0, end: 200, easingType: 1 }
    }],
    update: [{ id: "<event-id>", patch: { end: 300 } }],
    delete: ["<event-id>"]
  }
}
```

| 分组 | 能改什么 |
| --- | --- |
| `metadata` | 谱面元数据，例如 `name`、`song`、`composer`、`charter`、`level`、`offset`。 |
| `timing` | 通过 `bpmList` 替换整张速度表。 |
| `lines.insert` | 追加判定线；宿主分配 id 和默认事件层。 |
| `lines.update` | 按 id 修改可编辑的判定线字段。 |
| `notes.insert` | 通过 `lineIndex` 或 `lineId` 在已有判定线上插入音符。 |
| `notes.update` / `notes.delete` | 按 id 修改或删除音符。 |
| `events.insert` | 在已有判定线上按轨道和层插入事件。 |
| `events.update` / `events.delete` | 按 id 修改或删除事件。 |

需要记住的限制：

- `timing.bpmList` 会替换整张速度表，至少需要一个条目。
- `lines` 没有删除操作。
- 同一次请求里新插入的判定线，用 `lineIndex` 指向时，索引等于旧判定线数量加上插入位置。
- 事件支持基础轨道（`moveXEvents`、`moveYEvents`、`rotateEvents`、`alphaEvents`、`speedEvents`）和扩展轨道（`scaleXEvents`、`scaleYEvents`、`colorEvents`、`paintEvents`、`textEvents`、`inclineEvents`、`gifEvents`）。

## 更新选中音符

`selection.state()` 返回的是引用，不是音符对象。用 `chart.lines()` 把引用解析成当前音符 id。

```js
async run({ api, ui }) {
  const selection = await api.selection.state();
  if (!selection.ok || selection.value.notes.length === 0) {
    ui.notice("先选中一些音符。", { level: "warning" });
    return;
  }

  const lines = await api.chart.lines();
  if (!lines.ok) return;

  const updates = selection.value.notes
    .map((ref) => {
      const note = lines.value[ref.lineIndex]?.notes?.[ref.index];
      return note?.id
        ? { id: note.id, patch: { positionX: -(note.positionX ?? 0) } }
        : null;
    })
    .filter(Boolean);

  const result = await api.transaction.apply({
    label: "镜像选中音符",
    notes: { update: updates },
  });

  if (result.ok && result.value.status === "committed") {
    ui.notice(`已更新 ${updates.length} 个音符。`, { level: "success" });
  }
}
```

这个例子除了 `chart.read` 和 `chart.write`，还需要 `selection.read`。

## 预览、应用和结果状态

请求复杂、或需要先让用户确认影响范围时，用 `preview`；简单且已经确认的动作可以直接 `apply`。

```js
const preview = await api.transaction.preview(request);
if (!preview.ok) {
  ui.notice(preview.error.message, { level: "error" });
  return;
}
if (preview.value.status !== "previewed" || !preview.value.previewId) {
  ui.notice(`没有可应用的内容：${preview.value.status}`, { level: "warning" });
  return;
}

const applied = await api.transaction.apply(preview.value.previewId);
```

`preview` 的状态：`previewed`、`unchanged`、`rejected`、`unavailable`。

`apply` 的状态：

| 状态          | 含义                         |
| ------------- | ---------------------------- |
| `committed`   | 谱面已改变，并写入撤销历史。 |
| `unchanged`   | 请求没有产生实际变化。       |
| `rejected`    | 校验或编辑规则拒绝了请求。   |
| `conflict`    | 提交前谱面已经变化。         |
| `unavailable` | 没有连接编辑器会话。         |

`apply` 返回 `rejected` 或 `conflict` 时，给出简短提示即可，不要盲目重试。`value.issues` 里有路径和错误码，`value.history` 是本次提交的撤销记录。

## 常见错误

- **直接修改读取结果。** `chart.lines()` 和 `chart.notes()` 返回冻结的 detached 副本；要用它们的 id 和值组装事务。
- **自己造 id。** id 从 `chart.lines()`、`chart.notes()` 或 `chart.events()` 读取；插入时省略 `id`。
- **把秒当成拍。** 音符和事件时间都是约分后的拍三元组，例如 `[4, 1, 2]`。
- **把 `apply` 当成同步调用。** 它是异步的，返回 `ApiResult`，里面再包一层领域状态。
- **只申请 `chart.read`。** 事务需要 `chart.write`；读选区还需要 `selection.read`。

## 接下来

- [快速开始](getting-started.md)：从最小可安装扩展开始。
- [扩展上下文](context.md)：理解 `context`、`context.api` 和脚本生命周期。
- [能力与授权](capabilities.md)：查看完整能力词汇表。
- 左侧 API 树：`chart`、`selection`、`transaction` 的方法页。
