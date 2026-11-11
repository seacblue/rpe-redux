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

## ChartTransactionRequest

谱面写入请求，传给 `transaction.preview` 或 `transaction.apply`：

```ts
interface ChartTransactionRequest {
  label?: string;
  metadata?: Partial<ChartMeta>;
  timing?: { bpmList: BpmEntry[] };
  lines?: { insert?: LineInsert[]; update?: LineUpdate[] };
  notes?: { insert?: NoteInsert[]; update?: NoteUpdate[]; delete?: ChartObjectId[] };
  events?: { insert?: EventInsert[]; update?: EventUpdate[]; delete?: ChartObjectId[] };
}
```

## ChartTransactionResult

`ChartTransactionResult` 包含 `status`、`affectedObjectIds`、`issues`、`history` 和 `conflict`。`TransactionIssue` 用 `code` 和可选的 `path` 描述校验问题。

## ChartObjectId

判定线、音符和事件的稳定字符串 id。读取方法通常用它查找对象；插入新对象时不要自己生成 id。

## Beat

`Beat` 是约分后的拍三元组 `[whole, numerator, denominator]`，例如 `[0, 1, 2]` 表示 `0.5` 拍。音符和事件都使用这种表示，而不是秒。

## 音符字段

`JudgeLineNote` 的关键字段：

| 字段                    | 说明                                                   |
| ----------------------- | ------------------------------------------------------ |
| `type`                  | `1` Tap、`2` Hold、`3` Flick、`4` Drag。               |
| `startTime` / `endTime` | 起止拍三元组；Hold 的 `endTime` 必须晚于 `startTime`。 |
| `positionX`             | 横向谱面坐标，`0` 表示判定线中心。                     |
| `above`                 | `1` 在线上方，`0` 或 `2` 在线下方。                    |
| `isFake`                | `1` 为假音符，`0` 为真实音符。                         |

## ChartReadCollection

`chart.read` 接受的集合名：`metadata`、`lines`、`notes` 或 `events`。

## ChartReadPage

分页读取结果携带 `items` 和不透明的 `nextCursor`。游标绑定读取时的谱面指纹，谱面变化后必须从头读取。

## ChartReadItem

分页集合中的对象联合类型，实际值由 collection 决定：元数据、判定线、音符或事件。

## ChartReadMeta

谱面 `META` 的安全只读投影，常用字段包括 `name`、`song`、`composer`、`charter`、`level` 和 `offset`。

## ChartReadLine

一条判定线的只读快照，包含 id、音符、事件层和基础几何信息。完整字段以类型定义为准。

## ChartReadNote

一个音符的只读快照。要修改它，先读 `note.id`，再走 `notes.update`。

## ChartReadEvent

一个事件的只读快照，包含所属线、事件轨道、层和起止拍。

## ChartReadSnapshot

整张谱面的冻结副本；比逐个调用读取更适合做一次性分析。

## ChartReadState

谱面指纹和修订代数。可以用它判断谱面是否已经变化；事务本身会在提交时校验当前谱面。

## ExtensionThemeTokens

当前主题实际应用的设计 token：主题身份、颜色、圆角、间距、字体、阴影和动效。

## SettingDefinition

设置页一行的 schema：key、标签、控件类型、默认值和范围。注册方法见 `context.api.settings`。

## 下一步

- 想改谱面：[谱面操作](place-note.md)
- 想知道 `ui`、`storage`、`scripts` 放在哪：[扩展上下文](context.md)
- 想读完整方法列表：[API 总览](api:)
