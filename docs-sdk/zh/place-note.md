# 放一个音符

如果你现在只想“在当前判定线上放一个 Tap”，不需要先学完整棵 API 树。最短路径只有三步：

1. 在清单里请求 `scripts`、`chart.write`、`ui.notice`。
2. 注册一个脚本动作。
3. 调用 `context.api.chart.placeNote(...)`。

## 最小示例

`manifest.json`：

```json
{
  "id": "example.place-note",
  "name": "Place Note",
  "version": "1.0.0",
  "engines": { "rpe-redux": ">=1.0.0-a1 <2.0.0" },
  "entry": "index.js",
  "capabilities": ["scripts", "chart.write", "ui.notice"]
}
```

`index.js`：

```js
export default {
  activate(context) {
    context.scripts.register({
      id: "place-tap",
      label: "放一个 Tap",
      async run({ api, ui }) {
        const result = await api.chart.placeNote(1, {
          lineIndex: 0,
          from: { beat: 0, positionX: 0 },
        });

        if (!result.ok) {
          ui.notice(result.error.message, { level: "error" });
          return;
        }

        if (result.value.status === "committed") {
          ui.notice("已放置 Tap", { level: "success" });
        }
      },
    });
  },
};
```

然后在 **设置 → 扩展** 里启用扩展，在脚本面板运行“放一个 Tap”。

## 音符类型为什么是 1 到 4

`placeNote` 的第一个参数是数字，不是名字：

| 值  | 类型  | 说明                              |
| --- | ----- | --------------------------------- |
| `1` | Tap   | 单点音符                          |
| `2` | Hold  | 长按；需要同时提供 `from` 和 `to` |
| `3` | Flick | 滑动音符                          |
| `4` | Drag  | 拖动音符                          |

## ChartTarget 是什么

第二个参数告诉宿主“放在哪条线、什么位置”：

| 字段        | 必填 | 说明                                                 |
| ----------- | ---- | ---------------------------------------------------- |
| `lineIndex` | 是   | 判定线索引，从 0 开始；先用 `chart.lines()` 读取数量 |
| `from`      | 是   | 音符头：`{ beat, positionX }`                        |
| `to`        | 否   | Hold 的尾部位置                                      |
| `layer`     | 否   | 事件层编号                                           |
| `eventType` | 否   | 事件驱动的放置目标                                   |

完整定义见[类型与术语](types.md#charttarget)。

## 返回值怎么看

沙箱中的调用都是异步的，结果先看 `ok`：

- `ok: false`：读取 `result.error.message`。
- `ok: true`：读取 `result.value`。
- `result.value.status === "committed"`：音符已经写入。
- `unchanged` / `rejected` / `unavailable`：没有写入。

## 接下来

- 想批量修改或移动已有对象：读[事务](api:transaction)总览。
- 想先读谱面：读[chart](api:chart)总览。
- 不确定某个类型是什么：查[类型与术语](types.md)。
