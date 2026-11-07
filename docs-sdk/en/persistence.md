# Persistence

Extensions have separate storage surfaces for package-private settings, JSON data, and user-visible Settings rows. Choose the narrowest surface that matches the data.

## Purpose

Use `context.settings` for simple package-local strings, `context.storage` for structured JSON, and `context.api.values` when a value should be observable or bound to a Settings control.

## Signature

```js
const raw = await context.settings.get("quality");
const config = await context.storage.getJSON("config");
await context.storage.setJSON("config", { version: 1, quality: 80 });
```

## Minimal example

```js
const config = (await context.storage.getJSON("config")) ?? { version: 1 };
config.quality ??= 80;
await context.storage.setJSON("config", config);
```

## Advanced use

Include a schema version in JSON values. Migrate one version at a time, write the migrated value only after validation, and keep package storage separate from chart transactions.

## Permissions and limits

Package storage is owner-scoped and cannot read another package's keys. Values are capability-gated and reject attempts to claim host preference keys.

## Errors and recovery

Handle quota, malformed JSON, unavailable storage, and permission errors as separate cases. Keep a valid default in memory and retry only after correcting the input or waiting for the host to become available.

## Related APIs

See `context.storage.getJSON`, `context.storage.setJSON`, `context.api.values.define`, and [Types](types.md).
