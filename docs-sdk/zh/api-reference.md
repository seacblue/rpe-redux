# API 约定

扩展通过 `context.api` 调用宿主能力。本页说明异步签名、返回约定和错误处理；具体方法与属性在左侧 **API** 树中按 handle 浏览。

## 用途

`context.api` 是能力门控的异步宿主门面，覆盖谱面、事务、选区、文档、曲库、播放、工具栏、侧栏、菜单、设置、值、快捷键、诊断、主题、预览和布局。每个 handle 都有自己的总览页和成员页。

## 签名

```ts
type SandboxReduxApi = AsyncApi<SandboxHostApi>;

interface ApiResult<T> {
  ok: boolean;
  value?: T;
  error?: { code: string; message: string; details?: unknown };
}

interface ApiAvailability {
  status: "available" | "unavailable";
  error?: { code: string; message: string };
}

context.api.chart.state(): Promise<ApiResult<ChartReadState>>;
context.api.theme.tokens(): Promise<ExtensionThemeTokens>;
context.api.values.byId.get<T>(id: string): Promise<T>;
context.api.transaction.apply(request): Promise<ApiResult<ChartTransactionResult>>;

context.hooks.register(name, handler, schema, priority?): () => void;
context.hooks.invoke(name, payload, options?): Promise<PublicHookInvocationResult>;
```

上下文方法（如 `context.storage.getJSON`、`context.ui.notice`、`context.events.on`、`context.hooks.invoke`）不经过 handle 门禁，但仍有能力检查。

## 最小示例

读取主题 token 并显示一条通知：

```js
export default {
  async activate(context) {
    context.scripts.register({
      id: "theme-info",
      label: "查看主题",
      async run({ api, ui }) {
        const tokens = await api.theme.tokens();
        ui.notice(`主题 ${tokens.theme.name}（${tokens.theme.appearance}）`, { level: "info" });
      },
    });
  },
};
```

## 进阶用法

### 读取结果

```js
const result = await context.api.chart.state();
if (!result.ok) {
  context.ui.notice(result.error.message, { level: "error" });
  return;
}
const state = result.value;
```

`ok: true` 时读 `value`；`ok: false` 时读 `error.code`、`error.message`，需要时再读结构化细节。

### 读取整个集合

需要集合中的全部项目时，使用 `chart.readAll`。宿主在内部逐页读取并返回一个数组；调用方不需要处理游标、页偏移、`total` 或 `hasMore`：

```js
const result = await context.api.chart.readAll("notes");
if (result.ok) {
  for (const note of result.value) console.log(note.id);
}
```

`chart.readAll` 支持 `metadata`、`timing`、`lines`、`notes` 和 `events`。`timing` 是有序的速度表（`BpmEntry[]`），可以直接作为 `transaction.timing.bpmList` 的输入；其他集合把完整列表作为一个数组返回。在扩展包内它们会逐页组装，因此大谱面不会把单个超大结果一次送过桥。读取过程中谱面发生变化时，调用返回 `stale_read` 且不返回部分数组；请针对新修订重试。

`chart.read` 仍然保留给明确需要页边界、总数或可续读游标的调用方。传 `offset` 和 `limit` 可以直接跳到任意一页，也可以把上一页返回的 `nextCursor` 传回来顺序续读。不要在同一次请求里同时传 `cursor` 和 `offset`。

```js
const first = await context.api.chart.read("notes", { offset: 0, limit: 100 });
if (first.ok && first.value.status === "ok") {
  const second = await context.api.chart.read("notes", {
    offset: first.value.offset + first.value.items.length,
    limit: 100,
  });
  console.log(first.value.total, first.value.hasMore, second.value.items.length);
}
```

每个成功页都会回显实际生效的 `offset`、`limit`，并返回集合的 `total` 和 `hasMore`，调用方不需要靠「这一页不满」来猜是否读完。`limit` 默认 50，最大 100；非正数或非整数会返回 `invalid_request` 和 `reason: "invalid_limit"`，负数或非整数 `offset` 返回 `reason: "invalid_offset"`。

游标绑定读取时的谱面指纹和 generation，谱面一旦变化就返回 `stale_read`。因此一次分页遍历只在一个修订内保持一致，编辑后失败关闭。顺序就是谱面自身的顺序：`lines` 按线顺序，`notes` 按线再按数组顺序，`events` 按线、层、数组顺序。

`library.list` 和 `library.revisions` 也使用同样的 offset/limit 模型：前者返回 `{ projects, total }`，后者返回 `{ revisions, total, snapshotToken }`。两者都会限制页大小，并使用确定的次级排序键（项目用 id，修订用写入顺序）作为最终决胜，所以目录不变时重复请求会得到相同的分页边界。保存或编辑会让项目在排序中移动；对顺序敏感时应从第一页重新读取。

`library.revisions` 返回 `{ revisions, total, snapshotToken }`。后续分页带上 `snapshotToken`，即使两次请求之间新增或删除了修订，整个列表仍来自同一份快照。token 五分钟过期；过期后返回 `snapshot_expired`，调用方应从第一页重新读取。`library.current.revisionsAll` 会把同一个 token 带到每一页，按修订 id 去重，并在结果里返回该 `snapshotToken`。

### 配方计划

需要在写入前显示数量、受影响 id 或确认步骤时使用 `recipe.plan`。它复用 `transaction.apply` 的规划器，但不会修改任何状态。结果只包含短时有效的 `planId`、总数和受影响 id，不会返回分离的谱面。传入 `chartFingerprint` 可拒绝针对旧修订创建的计划。`recipe.apply(planId)` 提交一次并消费该计划；`recipe.cancel(planId)` 丢弃它。谱面变更、文档切换、owner 卸载、过期或第二次 apply 都会让计划失效。

### 播放时钟

`playback.subscribe(listener, { maxHz })` 按帧合并推送 `{ chartSeconds, beat, playing, rate, lineIndex }`。首个 tick 立即到达，后续默认 30 Hz，限制在 1-60 Hz。surface 关闭时调用返回的 disposer。一次性读取使用 `playback.state()`。

### 事务写入

```js
const applied = await context.api.transaction.apply({
  label: "Shift notes",
  notes: { update: [{ id: noteId, patch: { positionX: nextX } }] },
});
if (!applied.ok || applied.value.status !== "committed") return;
```

### 订阅

```js
const stopSelection = await context.api.selection.subscribe(() => {
  panel.update(tree());
});
const stopTheme = await context.api.theme.subscribe(() => {
  panel.update(tree());
});

context.addCleanup(() => {
  stopTheme();
  stopSelection();
});
```

## 权限与上限

- 每个方法只在对应能力授予后可用；能力清单见[能力与授权](capabilities.md)。
- API 树中的每个成员页都标注「需要能力」和「自 x 起」。
- 方法未登记返回 `methodNotRegistered`；能力未授予返回 `capabilityDenied`。
- 单次桥接上限：32 层、500,000 节点、16 MB。
- 沙箱内所有调用都返回 Promise；宿主同步方法也会被包装。

## 错误与恢复

方法页不再重复失败表；先检查 `result.ok`，失败时读 `error.code` 并按下表处理。类型说明见[类型与术语](types.md#apiresult)。

| 错误                   | 含义                   | 恢复                                   |
| ---------------------- | ---------------------- | -------------------------------------- |
| `capabilityDenied`     | 当前包没有该能力       | 在清单声明并重新确认                   |
| `methodNotRegistered`  | 方法未登记             | 查方法页，升级宿主或换用已登记方法     |
| `eventNotAllowed`      | 事件不在白名单         | 使用已发布事件名                       |
| `unavailable`          | 运行时未挂载           | 等待文档/播放就绪或查 `availability()` |
| `bridge.limit`         | 数据超过桥接上限       | 裁剪、分页或只传摘要                   |
| `stale_read`           | 事务期间文档或谱面变化 | 重新读取并重新预览                     |
| `conflict`             | 事务与当前谱面版本冲突 | 重新读取对象后再提交                   |
| `storageValueNotJson`  | 存储值不是纯 JSON 数据 | 只写入纯 JSON                          |
| `storageValueTooLarge` | 存储值超过 256 KB      | 裁剪内容或改用资产通道                 |

## 相关接口

- [能力与授权](capabilities.md)：能力、风险和同意流程。
- [数据持久化](persistence.md)：`storage`、`settings`、`values`。
- [面板与菜单](panels-and-menus.md)：`ui` 注册方法。
- [声明式 UI](ui-reference.md)：节点、事件和预算。
