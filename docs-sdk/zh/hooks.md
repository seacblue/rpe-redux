# Hooks 与生命周期接口

SDK 里有三类相关但不同的回调面：

| 面 | 方向 | 数据契约 | 扩展包是否可用 |
| --- | --- | --- | --- |
| `context.hooks` | 扩展 ↔ 扩展 | 带命名空间的 JSON payload | 可以，需要 `hooks` |
| `context.events` | 宿主 → 扩展 | 固定、版本化的事件 payload | 可以，需要 `events` |
| `ExtensionHookPayloads` | 宿主生命周期 | 强类型编辑器对象和可修改控制字段 | 不可以，仅供宿主集成使用 |

不要用公开 Hook 代替谱面事务。公开 Hook 适合扩展之间的可选协作；谱面写入仍然应该通过 `context.api.transaction` 完成。

## 公开 Hooks

`context.hooks` 是带命名空间的 JSON 扩展点。它不是 React、DOM 事件总线，也不能用来交换宿主对象。

### 方法

| 方法 | 用途 | 返回 |
| --- | --- | --- |
| `context.hooks.register(name, handler, schema, priority?)` | 在当前扩展的命名空间下发布 handler | `() => void` 停用函数 |
| `context.hooks.invoke(name, payload, options?)` | 运行某个名称下已发布的 handlers | `Promise<PublicHookInvocationResult>` |

两种方法都需要 `hooks` capability。扩展只能注册 owner 前缀等于自身 manifest id 的名称，但可以调用其他扩展发布的 Hook。扩展停用或卸载时，注册会自动释放。

### 注册与调用

```js
const dispose = context.hooks.register(
  "example.chart-tools:decorate-summary",
  (payload) => ({
    ...payload,
    badge: "chart-tools",
  }),
  {
    fields: {
      label: { type: "string", required: true },
      badge: { type: "string" },
    },
  },
  10,
);

const result = await context.hooks.invoke(
  "example.chart-tools:decorate-summary",
  { label: "Notes" },
  { timeoutMs: 1200, signal: context.signal },
);

if (!result.cancelled) {
  console.log(result.payload);
}
```

handler 收到的是当前 payload 的冻结副本。它可以返回部分 JSON 对象或 `undefined`；返回的字段会浅合并到 payload，再交给下一个 handler。handler 可以返回 `{ cancel: true }` 来停止剩余 handlers，但 `cancel` 必须在 schema 中声明，或者 schema 必须设置 `allowUnknown: true`。handlers 按优先级从高到低、再按注册顺序运行。

`priority` 必须是有限数字，最终会限制在 `-1000..1000`。同一个 Hook 名称下的所有 handlers 必须发布完全相同的 schema。handler 可以是异步函数；`invoke` 会在调用超时时间内等待它。

### JSON 边界与限制

- payload 和结果必须是普通的、无循环的 JSON 对象。
- 数字必须是有限值；最大嵌套深度为 32。
- schema 字段类型为 `string`、`number`、`boolean`、`object`、`array` 和 `null`。
- 默认拒绝未知字段；只有设置 `allowUnknown: true` 才会放行。
- 一个扩展在一次激活中最多保留 128 个事件或 Hook 订阅。
- 默认调用超时为 5 秒；指定的超时时间会取整并限制在 1–30 秒。
- `AbortSignal` 取消或超时会抛出 `PublicHookError`，不会返回部分结果。

```ts
interface PublicHookInvocationResult {
  payload: Record<string, unknown>;
  handled: boolean;
  cancelled: boolean;
}

interface PublicHookInvokeOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}
```

`handled` 表示至少有一个 handler 运行。调用尚未注册的名称会抛出 `hookNotFound`，不会返回 `{ handled: false }`。

### 错误码

| `PublicHookError.code` | 含义                                              |
| ---------------------- | ------------------------------------------------- |
| `hookNameInvalid`      | 名称无效，或注册名称没有使用当前扩展的 owner 前缀 |
| `hookPayloadInvalid`   | payload 不是无循环 JSON 对象，或不符合 schema     |
| `hookSchemaInvalid`    | schema 格式错误，或与已有注册冲突                 |
| `hookNotFound`         | 当前没有任何 handler 注册该名称                   |
| `hookCancelled`        | 调用方的 `AbortSignal` 被中止                     |
| `hookTimeout`          | handler 超过有效超时时间                          |
| `hookHandlerFailed`    | handler 抛出异常，或达到 handler 数量上限         |
| `hookResultInvalid`    | handler 返回了非 JSON 对象，或结果不符合 schema   |

## 宿主事件

`context.events.on(name, callback, priority?)` 订阅固定的宿主事件白名单。它返回停用函数，需要 `events` capability。事件回调是通知，不能取消宿主操作，返回值也会被忽略。不要让宿主需要等待的 Promise 从回调中返回；异步工作的拒绝会被报告为扩展回调失败。

宿主会按照扩展声明的 capability 投影 payload。没有 `chart.read` 时，文档事件的 `chart` 为 `null`；没有 `selection.read` 时，粘贴事件会省略 request 和选择引用；没有 `chart.read` 时会省略谱面 fingerprint。

### 事件清单

| 事件 | Payload | 触发时机 |
| --- | --- | --- |
| `extension:callback-error` | `{ channel, name, owner?, error }` | 扩展事件或宿主 Hook 回调失败 |
| `document:opened` | `DocumentLifecyclePayload` | 已有文档完成打开 |
| `document:created` | `DocumentLifecyclePayload` | 新文档完成创建 |
| `document:restored` | `DocumentLifecyclePayload` | 会话保存的文档完成恢复 |
| `document:saved` | `DocumentLifecyclePayload` | 保存成功完成 |
| `document:closed` | `DocumentLifecyclePayload` | 当前文档被清空；`chart` 为 `null` |
| `selection:after-paste` | `SelectionAfterPastePayload` | 一次粘贴尝试完成，包括被取消或没有产生变化的情况 |

```ts
interface DocumentLifecyclePayload {
  name: string;
  path: string | null;
  chart: Chart | null;
}

interface SelectionAfterPastePayload {
  request: SelectionPasteRequest;
  result: SelectionOperationResult;
}

interface SelectionOperationResult {
  changed: boolean;
  count: number;
  beforeFingerprint: string;
  afterFingerprint: string;
  selection: SelectionApiSnapshot;
}
```

投影后的粘贴 payload 对所有订阅者保留 `changed` 和 `count`。`request` 和 `result.selection` 需要 `selection.read`；fingerprint 需要 `chart.read`。

## 内置生命周期 Hooks

下面是当前完整的 `ExtensionHookPayloads` 清单。这些名称是同步、有序的宿主生命周期接口，只供受信任的宿主集成使用。沙箱扩展不能通过 `context.hooks` 注册它们，`context.events.on` 也不接受这些名称。

如果未来要把其中一个 Hook 暴露给扩展，必须先在公开 SDK 契约中定义可跨 bridge 传输的 payload 和对应 capability。

### Session 与谱面 Hooks

| Hook | Payload | 行为 |
| --- | --- | --- |
| `session:before-commit` | `{ label, chart, beforeSelection, metadata, cancel }` | 记录谱面历史项之前运行。宿主 handler 可以替换 chart、selection 或 metadata，也可以设置 `cancel = true`。 |
| `session:after-commit` | `{ label, chart }` | 谱面提交成功记录后运行；chart 是供观察者使用的脱离快照。 |
| `selection:before-paste` | `{ request, cancel }` | 剪贴板粘贴前立即运行。宿主 handler 可以修改 request，或设置 `cancel = true`。 |
| `chart:parse` | `{ text, chart }` | JSON 解析前运行。handler 可以替换 `text` 或提供解析后的 `chart`；提供 `chart` 时会跳过普通解析。 |
| `chart:parsed` | `{ chart }` | 解析完成、最终规范化之前运行。handler 可以替换解析结果；之后仍会验证结果。 |
| `chart:validate` | `{ chart, handled }` | 谱面验证过程中运行。宿主 validator 可以替换 chart，或完成自己的验证后设置 `handled = true`。 |
| `chart:serialize` | `{ chart, compact, text }` | 序列化前运行。handler 可以提供 `text` 来覆盖默认序列化器。 |

`session:before-commit` 是谱面更新的拦截点。普通编辑、粘贴、批量编辑以及到达编辑器 Session 的事务提交都会经过它。粘贴专用 Hook 更早运行，只能修改或取消这次粘贴请求；粘贴成功后会发出上面事件清单中的公开 `selection:after-paste` 事件。

### 文档 Hooks

| Hook | Payload | 行为 |
| --- | --- | --- |
| `document:before-open` | `{ source, cancel }` | 已有文档或会话恢复文档加载前运行。`source` 为 `"open"`、`"create"` 或 `"restore"`；设置 `cancel = true` 可拒绝加载。 |
| `document:before-create` | `{ cancel }` | 新文档创建前运行。设置 `cancel = true` 可拒绝创建。 |
| `document:before-save` | `{ saveAs, cancel }` | 保存前运行。`saveAs` 区分另存为；设置 `cancel = true` 可拒绝保存。 |
| `document:before-close` | `{ cancel }` | 关闭或清空当前文档前运行。设置 `cancel = true` 可保持打开。 |

这些 Hook 是取消点，不是通知。对应的成功生命周期通知是上面事件清单中的 `document:opened`、`document:created`、`document:restored`、`document:saved` 和 `document:closed`。

## 如何选择

| 需求 | 使用 |
| --- | --- |
| 让其他扩展装饰或计算 JSON 数据 | `context.hooks` |
| 观察打开、保存、关闭或粘贴完成 | `context.events` |
| 修改或拒绝宿主生命周期操作 | 宿主生命周期 Hook，仅限受信任的宿主集成 |
| 从扩展修改谱面状态 | `context.api.transaction.preview` → `context.api.transaction.apply` |

扩展包只应为公开 Hook 协作申请 `hooks`，只应为宿主通知申请 `events`。不要让沙箱中的扩展依赖宿主专用 Hook 名称存在。

## 相关接口

- [扩展上下文](context.md)：`api`、`events` 和 `hooks` 的位置。
- [能力清单](capabilities.md)：`hooks` 与 `events` 的授权。
- [API 约定](api-reference.md)：异步 bridge、`ApiResult` 与错误边界。
- [类型与术语](types.md)：SDK 使用的谱面和选择结构。
