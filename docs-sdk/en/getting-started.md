# Getting started

This guide builds the smallest installable Extension. It assumes the desktop application is running and that the package is placed under the user Extension root.

## Create the package

Create `example.hello/` with a manifest and an entry module. The directory name must match the manifest id.

```json
{
  "kind": "extension",
  "id": "example.hello",
  "name": "Hello",
  "version": "1.0.0",
  "engines": { "rpe-redux": 1 },
  "entry": "index.js",
  "capabilities": ["scripts", "ui.notice"]
}
```

```js
export default {
  activate(context) {
    context.scripts.register({
      id: "hello",
      label: "Say hello",
      steps: [{ op: "notice", message: "Hello from my Extension!" }],
    });
  },
};
```

## Enable and run it

Open Extensions in Settings, enable the package, and run **Say hello** from the script surface. Code runs in an opaque-origin iframe; host operations cross the asynchronous capability-gated bridge.

## Continue

Read [Extension context](context.md), [Capabilities](capabilities.md), and [Declarative UI](ui-reference.md) next. The [API conventions](api-reference.md) page explains result envelopes and error handling.
