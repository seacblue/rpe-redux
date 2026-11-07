# 类型与术语

API 页面里会出现一些类型名。本页解释最常见的几个；阅读方法页时卡住，可以先回到这里。

## Handle 与 context

- `context.api.chart` 这样的对象叫 **handle**：它是一组宿主能力的入口，调用是异步的。
- `context` 是扩展自己的运行时上下文：`context.scripts`、`context.ui`、`context.storage` 等不是 API handle。
- `context.api.layout` 和 `context.api.theme` 是只读快照 handle；`context.ui` 是界面辅助，不是 `context.api.ui`。

## ApiResult

大多数宿主读取和写入返回 `ApiResult<T>`：

```ts
interface ApiResult<T> {
  ok: boolean;
  value?: T;
  error?: { code: string; message: string; details?: unknown };
}
```

先看 `ok`，成功读 `value`，失败读 `error`。沙箱中所有调用都是异步的，因此实际拿到的是 `Promise<ApiResult<T>>`。

## ApiAvailability

`availability` 方法返回它，用来判断对应运行时是否已经挂载：

```ts
interface ApiAvailability {
  status: "available" | "unavailable";
  error?: { code: string; message: string };
}
```

## ActionResult

放置音符、事件和事务提交会返回 `ActionResult<T>`。`status` 有四种：

| status        | 含义                   |
| ------------- | ---------------------- |
| `committed`   | 已写入                 |
| `unchanged`   | 没有需要写入的内容     |
| `rejected`    | 输入不合法或被规则拒绝 |
| `unavailable` | 运行时未连接           |

## ChartObjectId

判定线、音符和事件的稳定字符串 id。读取方法通常用它查找对象。

## ChartReadCollection

`chart.read` 接受的集合名：`metadata`、`lines`、`notes` 或 `events`。

## ChartReadPage

分页读取结果携带 `items` 和不透明的 `nextCursor`。游标绑定读取时的谱面指纹，谱面变化后必须从头读取。

## ChartReadItem

分页集合中的对象联合类型，实际值由 collection 决定：元数据、判定线、音符或事件。

## ChartReadMeta

谱面 `META` 的安全只读投影，常用字段包括 `name`、`song`、`composer`、`charter`、`level` 和 `offset`。

## ChartTarget

`chart.placeNote` 的放置目标：

| 字段        | 必填 | 说明                             |
| ----------- | ---- | -------------------------------- |
| `lineIndex` | 是   | 判定线索引，从 0 开始            |
| `from`      | 是   | 音符头坐标 `{ beat, positionX }` |
| `to`        | 否   | Hold 尾部坐标                    |
| `layer`     | 否   | 事件层编号                       |
| `eventType` | 否   | 事件驱动的放置类型               |

`beat` 是拍位置，`positionX` 是横向谱面坐标；0 表示判定线中心。

## ChartTargetPoint

`ChartTarget.from` 和 `ChartTarget.to` 的坐标形状：`{ beat: number, positionX: number }`。

## ChartNoteType

`chart.placeNote` 的第一个参数，只有四个值：

| 值  | 类型  |
| --- | ----- |
| `1` | Tap   |
| `2` | Hold  |
| `3` | Flick |
| `4` | Drag  |

## ChartReadLine

一条判定线的只读快照，包含 id、音符、事件层和基础几何信息。完整字段以类型定义为准。

## ChartReadNote

一个音符的只读快照。放置成功后，`chart.placeNote` 的 `value.value` 就是它。

## ChartReadEvent

一个事件的只读快照，包含所属线、事件轨道、层和起止拍。

## ChartReadSnapshot

整张谱面的冻结副本；比逐个调用读取更适合做一次性分析。

## ChartReadState

谱面指纹和修订代数。事务预览或应用前可以用它判断谱面是否已经变化。

## ExtensionThemeTokens

当前主题实际应用的设计 token：主题身份、颜色、圆角、间距、字体、阴影和动效。

## SettingDefinition

设置页一行的 schema：key、标签、控件类型、默认值和范围。注册方法见 `context.api.settings`。

## 下一步

- 想放第一个音符：[放一个音符](place-note.md)
- 想知道 `ui`、`storage`、`scripts` 放在哪：[扩展上下文](context.md)
- 想读完整方法列表：[API 总览](api:)
