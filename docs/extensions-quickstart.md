# Your first Extension

Create a folder named `example.hello` in an Extension root with these two files. The folder name must match the manifest id.

`manifest.json`:

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

`index.js`:

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

Open Extensions in settings, enable the package, and run **Say hello** from the script surface. The manifest grants only the two capabilities used here. Code runs in an isolated iframe; host operations use the asynchronous context bridge. Disable or remove the Extension from settings when finished.

For package roots, installation, permissions, script steps, storage, and the full context contract, see the [Extension reference](extensions.md). The [SDK examples](../sdk/examples/) show TypeScript and data-only packages. The [composition example](../sdk/examples/composition.ts) shows a provider, consumer, hook, and design slot working together.

When a provider disappears, the consumer keeps its own activation and handles the unavailable callback; it does not need to stop the whole dependency graph.
