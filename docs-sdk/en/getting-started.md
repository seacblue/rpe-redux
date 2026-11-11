# Getting started

This guide builds the smallest installable Extension. It assumes the desktop application is running and that the package is placed under the user Extension root, `user-data/extensions/`.

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

| Field          | Contract                                                      |
| -------------- | ------------------------------------------------------------- |
| `id`           | Lowercase package identity; must match the folder name.       |
| `name`         | Display name, optionally supplied by `i18n.json`.             |
| `version`      | Non-empty package version string.                             |
| `engines`      | Host major, or a semver range over the full host version.     |
| `entry`        | Package-relative entry file. Omit it for a data-only package. |
| `capabilities` | Requested capabilities; the user grants them during install.  |

```js
export default {
  activate(context) {
    const disposeScript = context.scripts.register({
      id: "hello",
      label: "Say hello",
      description: "Show one notice; change no chart data.",
      icon: "info",
      run({ ui }) {
        ui.notice("Hello from RPE Redux", { level: "success" });
      },
    });

    context.addCleanup(disposeScript);
  },
};
```

`activate(context)` runs once when the package is enabled. The context contains:

| Member                 | Purpose                                                                 |
| ---------------------- | ----------------------------------------------------------------------- |
| `manifest`             | Materialized package identity, version, and capabilities.               |
| `signal`               | Aborted when the package is disabled or reloaded.                       |
| `api`                  | Asynchronous, capability-gated host facade. Every call must be awaited. |
| `ui`                   | Notices, dialogs, inputs, panels, sidebars, and overlays.               |
| `events`               | Subscriptions to the fixed host event allowlist.                        |
| `scripts`              | Registers package scripts.                                              |
| `settings` / `storage` | Owner-scoped string and JSON storage.                                   |
| `timers`               | Host timers; global timer functions are blocked.                        |
| `styles`               | Owner-scoped stylesheet registration.                                   |
| `addCleanup`           | Registers a function that runs on deactivation.                         |

## Enable and run it

1. Open **Settings → Extensions**.
2. Enable `Hello`.
3. Run **Say hello** from the script surface.
4. After editing `index.js`, use the reload action on the Extension card.

Use `ui.notice(JSON.stringify(value))` for small debugging values, and `context.api.diagnostics.snapshot()` to check whether the host runtime is ready. The Extension card shows recent errors; five callback failures inside 30 seconds trip the failure budget and disable the package. Keep `activate` to registration only and run heavier work from a user action.

## Limits

| Item                | Limit                                   |
| ------------------- | --------------------------------------- |
| Entry source        | 2 MB                                    |
| Active scripts      | 64                                      |
| Event subscriptions | 128                                     |
| Timers              | 64, with a 16 ms minimum interval       |
| Style sheets        | 32, 100 KB each                         |
| Storage             | 128-character keys, 256 KB UTF-8 values |

## Continue

- Change the chart: read [Chart operations](place-note.md) for the read → transaction → result loop, with a complete note-insert example.
- Learn the runtime object: read [Extension context](context.md).
- Check what you can request: read [Capabilities](capabilities.md).
- Build a surface: read [Declarative UI](ui-reference.md).
- Understand results and errors: read [API conventions](api-reference.md).
