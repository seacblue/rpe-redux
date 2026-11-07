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
context.api.transaction.apply(request): Promise<ApiResult<TransactionResult>>;

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

### 分页读取

```js
const page = await context.api.chart.read("notes", { limit: 100 });
if (page.ok) {
  for (const item of page.value.items) {
    console.log(item.id, item.kind);
  }
}
```

### 事务写入

```js
const preview = await context.api.transaction.preview({
  label: "Shift notes",
  notes: { update: [{ id: noteId, patch: { positionX: nextX } }] },
});
if (!preview.ok || preview.value.status !== "previewed") return;
const applied = await context.api.transaction.apply(preview.value.previewId);
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
