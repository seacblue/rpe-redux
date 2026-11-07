# Design system

Extensions use host design primitives through declarative nodes and theme tokens. The host owns typography, colors, spacing, radii, focus rings, and motion so packages remain consistent with the active theme.

## Tokens

Read the actual values instead of copying a palette into the package:

```js
const tokens = await context.api.theme.tokens();
const stop = context.api.theme.subscribe((next) => {
  console.log(next.colors, next.spacing);
});
```

{{DESIGN_TOKEN_TABLES}}

## Components

Use the documented declarative tags and input types. Buttons, selects, ranges, color fields, and file inputs are rendered by the host and receive the same keyboard and accessibility behavior as built-in controls.

## Icons

The published icon names are:

{{ICON_NAMES}}

Do not load remote fonts, CSS, HTML, or URLs from a package. Keep custom styling owner-scoped through `context.styles`.
