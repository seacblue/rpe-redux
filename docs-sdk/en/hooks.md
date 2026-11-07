# Hooks and lifecycle seams

The SDK has three related but different callback surfaces:

| Surface | Direction | Data contract | Available to a package |
| --- | --- | --- | --- |
| `context.hooks` | Extension ↔ extension | Namespaced JSON payloads | Yes, with `hooks` |
| `context.events` | Host → extension | Fixed, versioned event payloads | Yes, with `events` |
| `ExtensionHookPayloads` | Host lifecycle | Typed editor objects and mutable control fields | No; host integration only |

Do not use a public hook as a replacement for a chart transaction. Public hooks are for optional cooperation between packages. Chart writes go through `context.api.transaction`.

## Public hooks

`context.hooks` is a namespaced JSON extension point. It is not React, a DOM event bus, or a way to exchange host objects.

### Methods

| Method | Purpose | Returns |
| --- | --- | --- |
| `context.hooks.register(name, handler, schema, priority?)` | Publish a handler under the current package's namespace | `() => void` disposer |
| `context.hooks.invoke(name, payload, options?)` | Run the handlers published under a name | `Promise<PublicHookInvocationResult>` |

Both methods require the `hooks` capability. A package may register only names whose owner prefix is its own manifest id. It may invoke a hook published by another package. Registrations are disposed automatically when the package is disabled or unloaded.

### Register and invoke

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

The callback receives a frozen copy of the current payload. It may return a partial JSON object or `undefined`; returned fields are shallow-merged into the payload before the next handler runs. A handler can return `{ cancel: true }` to stop the remaining handlers, but `cancel` must be declared in the schema (or the schema must set `allowUnknown: true`). Handlers run by descending priority, then by registration order.

`priority` is finite and is clamped to `-1000..1000`. All handlers for one hook name must publish the same schema. A handler may be asynchronous; `invoke` waits for it within the invocation timeout.

### JSON boundary and limits

- Payloads and results must be plain, non-cyclic JSON objects.
- Numbers must be finite; maximum nesting depth is 32.
- Schema field types are `string`, `number`, `boolean`, `object`, `array`, and `null`.
- Unknown fields are rejected unless `allowUnknown: true` is present.
- A package may keep at most 128 event or hook subscriptions in one activation.
- The default invocation timeout is 5 seconds. The requested timeout is rounded and clamped to 1–30 seconds.
- `AbortSignal` cancellation and timeout abort the invocation and throw a `PublicHookError`; they do not return a partial result.

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

`handled` is `true` when at least one handler ran. Invoking an unregistered name throws `hookNotFound`; it does not return `{ handled: false }`.

### Error codes

| `PublicHookError.code` | Meaning |
| --- | --- |
| `hookNameInvalid` | The name is invalid or does not use the registering package's owner prefix |
| `hookPayloadInvalid` | The payload is not a non-cyclic JSON object or fails the schema |
| `hookSchemaInvalid` | The schema is malformed or conflicts with an existing registration |
| `hookNotFound` | No handler is registered under the name |
| `hookCancelled` | The caller's `AbortSignal` was aborted |
| `hookTimeout` | A handler exceeded the effective timeout |
| `hookHandlerFailed` | A handler threw or the handler limit was reached |
| `hookResultInvalid` | A handler returned a non-JSON object or a result that fails the schema |

## Host events

`context.events.on(name, callback, priority?)` subscribes to the fixed host event allowlist. It returns a disposer and requires the `events` capability. Event callbacks are notifications: they cannot cancel the host operation, and their return value is ignored. A callback must not return a promise that the host needs to await; rejected asynchronous work is reported as an extension callback failure.

The host projects payload fields according to the package capabilities. A document event includes `chart: null` without `chart.read`. The paste event omits its request and selection references without `selection.read`, and omits chart fingerprints without `chart.read`.

### Event catalog

| Event | Payload | When it fires |
| --- | --- | --- |
| `extension:callback-error` | `{ channel, name, owner?, error }` | A package event or host hook callback fails |
| `document:opened` | `DocumentLifecyclePayload` | An existing document finishes opening |
| `document:created` | `DocumentLifecyclePayload` | A new document finishes creation |
| `document:restored` | `DocumentLifecyclePayload` | A saved session document finishes restoring |
| `document:saved` | `DocumentLifecyclePayload` | A save completes successfully |
| `document:closed` | `DocumentLifecyclePayload` | The current document is cleared; `chart` is `null` |
| `selection:after-paste` | `SelectionAfterPastePayload` | A paste attempt completes, including a cancelled or unchanged attempt |

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

The projected paste payload keeps `changed` and `count` for every subscriber. `request` and `result.selection` require `selection.read`; the fingerprints require `chart.read`.

## Built-in lifecycle hooks

The following names are the complete current `ExtensionHookPayloads` map. They are synchronous, ordered host seams used by trusted host integrations. They are not registrations that a sandboxed package can make through `context.hooks`, and they are not names accepted by `context.events.on`.

When a future release makes one of these hooks package-visible, it must first define its bridge-safe payload and capability in the public SDK contract.

### Session and chart hooks

| Hook | Payload | Behavior |
| --- | --- | --- |
| `session:before-commit` | `{ label, chart, beforeSelection, metadata, cancel }` | Runs before a chart history entry is recorded. A host handler may replace the chart, selection, or metadata, or set `cancel = true`. |
| `session:after-commit` | `{ label, chart }` | Runs only after a chart commit is recorded. The chart is a detached snapshot for observers. |
| `selection:before-paste` | `{ request, cancel }` | Runs immediately before the clipboard is pasted. A host handler may edit the request or set `cancel = true`. |
| `chart:parse` | `{ text, chart }` | Runs before JSON parsing. A handler may replace `text` or provide a parsed `chart`; when `chart` is provided, the normal parse is skipped. |
| `chart:parsed` | `{ chart }` | Runs after parsing and before final normalization. A handler may replace the parsed chart; the result is validated afterward. |
| `chart:validate` | `{ chart, handled }` | Runs during chart validation. A host validator may replace `chart` or set `handled = true` after performing its own validation. |
| `chart:serialize` | `{ chart, compact, text }` | Runs before serialization. A handler may provide `text` to override the default serializer. |

`session:before-commit` is the chart-update interception point. It covers normal edits, paste, batch edits, and transaction commits that reach the editor session. The paste-specific hook runs earlier and can change or cancel only the paste request itself. A successful paste then emits the public `selection:after-paste` event.

### Document hooks

| Hook | Payload | Behavior |
| --- | --- | --- |
| `document:before-open` | `{ source, cancel }` | Runs before an existing or restored document is loaded. `source` is `"open"`, `"create"`, or `"restore"`; set `cancel = true` to refuse the load. |
| `document:before-create` | `{ cancel }` | Runs before a new document is created. Set `cancel = true` to refuse it. |
| `document:before-save` | `{ saveAs, cancel }` | Runs before saving. `saveAs` distinguishes Save As; set `cancel = true` to refuse the save. |
| `document:before-close` | `{ cancel }` | Runs before closing or clearing the current document. Set `cancel = true` to keep it open. |

These hooks are cancellation points, not notifications. The corresponding successful lifecycle notifications are `document:opened`, `document:created`, `document:restored`, `document:saved`, and `document:closed` in the host event catalog above.

## Choosing a surface

| Need | Use |
| --- | --- |
| Let another package decorate or calculate JSON data | `context.hooks` |
| Observe open, save, close, or paste completion | `context.events` |
| Change or reject a host lifecycle operation | Host lifecycle hook, if you are writing a trusted host integration |
| Change chart state from a package | `context.api.transaction.preview` → `context.api.transaction.apply` |

For package code, request `hooks` only for public hook cooperation and `events` only for host notifications. A package must not depend on the host-only hook names being present in the sandbox.

## Related interfaces

- [Extension context](context.md): where `api`, `events`, and `hooks` live.
- [Capabilities](capabilities.md): authorization for `hooks` and `events`.
- [API conventions](api-reference.md): async bridge, `ApiResult`, and error boundaries.
- [Types and terminology](types.md): chart and selection shapes used by the SDK.
