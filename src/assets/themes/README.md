# Theme packages

A theme package is data, not code. It supplies a palette of CSS custom properties, optional PNG glyph overrides, and an optional **chrome recipe** that selects surface and motion presets for the window frame. Window layout and measurements are host-owned; a theme cannot move or resize the inspector, rail, toolbar, transport, or status bar. `src/core/theme/packages.ts` owns the schema and validation, `src/core/theme/registry.ts` owns registration, `src/core/theme/applyTheme.ts` resolves the active package, and `src/frontend/app/themeChrome.less` renders the presets. The host only reads and writes documents; it never evaluates a package.

The bundled packages are build-time source folders; a distributable or dropped-in package is one JSON document. The Chinese guide is [README-zh.md](README-zh.md).

```text
dark/                  bundled reference package
  package.json
  icons/
    add.png
    folder_open.png
    settings.png
light/                bundled light reference package
  package.json
```

## Manifest

```json
{
  "schemaVersion": 2,
  "kind": "theme",
  "id": "example-theme",
  "name": { "en": "Example", "zh": "示例" },
  "version": "1.0.0",
  "appearance": "dark",
  "colors": { "--accent": "#a8c7fa" },
  "icons": {},
  "chrome": {
    "surface": {
      "shape": "round",
      "material": "glass",
      "backdropBlur": 16,
      "pattern": "none",
      "ambient": "aurora"
    },
    "motion": {
      "level": "expressive",
      "speed": "normal",
      "hover": "glow",
      "entrance": "rise"
    }
  }
}
```

| Field | Contract |
| --- | --- |
| `schemaVersion` | `2`. Schema `1` is still accepted for installed packages; omitted chrome members use the defaults. |
| `kind` | `"theme"`. Documents with `kind: "icons"` and no palette normalize to a dark theme package. |
| `id` | Stable id: lowercase letter or digit followed by lowercase letters, digits, `.`, `_`, or `-`. |
| `name` | A string or a language-to-string map; the current language, then English, then the first entry. |
| `version` | Optional version string; defaults to `1.0.0`. |
| `author` | Optional author string. |
| `appearance` | `dark` or `light`. A partial light package inherits the built-in light palette. |
| `actionForeground` | Optional map of `resting`, `hover`, `focus`, `pressed`, `disabled`, and `emphasized` to `normal` or `inverse`. |
| `colors` | The published colour-token vocabulary (`src/core/theme/colorTokens.ts`); values are hex, `rgb`/`hsl` forms, or `transparent`. |
| `icons` | Optional glyph-name-to-PNG map. Bundled source packages use relative `.png` paths; distributable documents use PNG data URLs. |
| `chrome` | Optional surface and motion recipe plus title-bar framing. Every member is a closed preset; omitted members use the defaults below. Retired `layout`, `metrics`, and `titlebar.density` blocks are ignored. |
| `ui` | Optional declarative slot/component trees. A tree uses host primitives and bound item fields; it carries no HTML, CSS, or code. |

Unspecified colours inherit from the built-in palette for the declared appearance, so a package that changes only an accent keeps the rest of the interface readable. Action foreground selection uses the declared normal or inverse ink and falls back to the readable candidate when contrast is below 4.5:1.

## Chrome recipe

The recipe controls presentation only. It selects host-owned surfaces and motion, and the caption/menu framing of the title row; window placement and measurements are not part of the package contract. It cannot supply markup, hide the title bar, menu, toolbar, or inspector, change window behaviour, or inject a stylesheet. The renderer maps every name onto host-authored CSS and host-owned React slots.

### Surface

| Field | Values | Default | Effect |
| --- | --- | --- | --- |
| `shape` | `square`, `soft`, `round` | `soft` | Panel and control radii. |
| `material` | `solid`, `raised`, `glass`, `flat` | `solid` | Panel paint and shadow; `glass` uses `backdropBlur`, `flat` removes the panel border and shadow. |
| `backdropBlur` | Integer `0`–`24` | `0` | Blur radius used by `glass`. |
| `pattern` | `none`, `grid`, `dots`, `scanlines` | `none` | A token-drawn backdrop pattern behind the workbench. |
| `ambient` | `none`, `aurora`, `pulse` | `none` | A decorative ambient layer drawn from the theme palette. |

### Motion

| Field | Values | Default | Effect |
| --- | --- | --- | --- |
| `level` | `none`, `subtle`, `expressive` | `subtle` | Motion budget. `none` removes theme transitions and animations; `expressive` lengthens entrances and selects the spring easing. |
| `speed` | `slow`, `normal`, `fast` | `normal` | Multiplies the shared duration tokens. |
| `hover` | `none`, `lift`, `glow` | `none` | Pointer feedback on action buttons. |
| `entrance` | `none`, `fade`, `rise`, `slide` | `fade` | Entrance animation for the workbench panels and settings pages. |

### Title bar

| Group | Values | Default | Effect |
| --- | --- | --- | --- |
| `titlebar.windowControls` | `system`, `compact`, `capsule` | `system` | Caption-button size and grouping; the host keeps minimize, maximize, and close. |
| `titlebar.menu` | `hamburger`, `expanded` | `expanded` | One application-menu trigger, or the section labels as a classic menu bar. Both keep the same commands. |

`titlebar.density` was a height rhythm control and is now ignored; the host owns the title-row height.

`prefers-reduced-motion: reduce` always wins: the shared duration tokens collapse and `reset.less` disables transitions and animations regardless of the recipe. A recipe with `level: "none"` applies the same suppression without requiring an OS preference.

## Declarative UI

A package may replace a published slot or component anatomy with a tree built from host primitives. The host owns the wrapper, accessibility, and actions; the theme owns the arrangement and content within it.

```json
"ui": {
  "slots": {
    "inspector.empty": {
      "kind": "surface",
      "variant": "glass",
      "shape": "round",
      "padding": "lg",
      "gap": "md",
      "children": [
        { "kind": "text", "text": { "en": "Panels", "zh": "面板" }, "size": "heading" },
        { "kind": "repeat", "items": "sidebarItems", "columns": 2, "gap": "sm",
          "template": { "kind": "action", "variant": "plain", "shape": "soft" } }
      ]
    }
  },
  "components": {
    "railItem": {
      "kind": "stack",
      "direction": "row",
      "gap": "sm",
      "align": "center",
      "children": [
        { "kind": "icon", "bind": "icon", "iconSize": "sm" },
        { "kind": "text", "bind": "label", "size": "caption", "when": "expanded" },
        { "kind": "dot", "tone": "accent", "when": "hasStatus" }
      ]
    }
  }
}
```

### Replaceable ids

| Id | Kind | Contract |
| --- | --- | --- |
| `inspector.empty` | slot | The inspector body while no pane is active. It may repeat the registered sidebar items. |
| `railItem` | component | The content anatomy of a rail button. The host keeps the button, action, label, and ARIA. |
| `menuTrigger` | component | The content anatomy of the application-menu trigger. The host keeps the menu, commands, and ARIA. |
| `windowControl` | component | The content anatomy of each caption button. The host keeps minimize, maximize, close, and the window action. |

`menuTrigger` and `windowControl` must keep an unconditional bound `label` or `icon`, so custom anatomy cannot leave critical chrome unreadable. A component tree cannot contain `action` or `repeat`; those belong to slot content only.

These ids are a host contract. A theme can create new arrangements, but it cannot invent a slot or component id the host has not published. Adding an id is a host change in the component that owns that surface.

### Primitives

| Kind | Purpose |
| --- | --- |
| `stack` | Row or column layout. `direction`, `gap`, `align`, `justify`, `columns`, `wrap`, `padding`. |
| `surface` | A token-painted surface. Adds `variant` (`plain`, `outlined`, `solid`, `raised`, `glass`) and `shape`. |
| `text` | A text role (`caption`, `label`, `body`, `heading`) with `tone` and `weight`. Literal text may be a language map. |
| `icon` | A design-system glyph, with `iconSize` (`sm`, `md`, `lg`). |
| `dot` | A small accent, muted, or danger status dot. |
| `divider` | A token hairline. |
| `spacer` | Flexible space inside a row or column. |
| `action` | A host button. In a repeat it reads the item's label, icon, and activation. |
| `repeat` | Repeats a template over `sidebarItems`; layout props apply to the wrapper. |

A node may bind `label`, `icon`, `statusDot`, or `active`, and may declare `when`: `always`, `active`, `inactive`, `expanded`, `collapsed`, `hasStatus`, or `noStatus`. `span` makes a grid child span 1–4 columns.

The parser bounds a tree to 128 nodes, depth 8, 16 children per container, and 32 languages per text value. Unknown ids, kinds, props, or bindings reject the package. The renderer never accepts a class, style, HTML tag, URL, or event handler from a package.

The renderer receives only the bound item's label, icon, status, expanded flag, and host activation. It never receives the SDK, the chart, the document, a file handle, a network client, or the host DOM. A theme cannot add a new slot or component id; those remain host contracts.

## Built-in packages

| Package | Purpose                                                     |
| ------- | ----------------------------------------------------------- |
| `dark`  | Reference dark palette, complete glyph set, default chrome. |
| `light` | Reference light palette and optically lighter glyph set.    |

Selecting `dark` is also the reset path for a package whose surface is awkward: the settings window stays reachable because the title bar, menu, toolbar, and layout are host-owned and cannot be hidden by a theme.

## Safety

A theme is deliberately less privileged than an Extension:

| Surface | Theme | Extension |
| --- | --- | --- |
| SDK, backend, document, files | No | Capability-gated |
| Network, host DOM, timers | No | Network no; host DOM no; timer capability |
| Executable entry | No | Sandboxed iframe |
| UI reach | Published frontend slots/components | Panels, overlays, sidebar, toolbar |
| Can create a new action | No; only re-present a registered sidebar item | Yes, through its gated API |

Theme packages follow the same untrusted-input rules as other package surfaces:

- **Data only, frontend only.** No JavaScript, CSS text, HTML, SVG, remote URLs, or file paths outside the package. There is no code entry point to sandbox, and a theme has no SDK, backend, database, network, filesystem, or host-DOM handle. It can only change frontend presentation.
- **No invented actions.** A declarative action is valid only inside a repeat of registered sidebar items. It reads the item's label, icon, and activation; a theme cannot create a button with its own callback or invoke an API. Component templates cannot contain actions or repeats at all.
- **Visible boundary.** Importing a package with a declarative UI lists the replaced surfaces and asks for confirmation. The picker marks it as `custom UI`.
- **Closed vocabulary.** Every active chrome value is an enum or a bounded integer. Unknown keys and invalid values reject the whole package; they are never coerced into a default. The retired `layout`, `metrics`, and `titlebar.density` keys are accepted only so an installed package keeps its palette, and their values are discarded.
- **Closed colour channel.** A palette may only set names in the published colour-token list. Layout, motion, radius, z-index, and component-local variables stay host-owned, so a colour value cannot be smuggled into a grid or a transition. `--on-accent-*` names are checked inputs to the action-ink resolver; the generated `--action-foreground-*` names are not accepted.
- **Bounded collections.** At most 512 colour tokens and 512 icon overrides; token names are at most 64 characters, values at most 240 characters, version and author strings at most 200 characters, each glyph source at most 512 KiB, and all glyph data at most 4 MiB. The desktop host also caps a package document at 4 MiB.
- **No arbitrary paint.** Palette values accept only hex, numeric `rgb`/`hsl` forms, or `transparent`. Glyphs accept only PNG data URLs or safe package-relative `.png` paths; remote URLs, SVG data, absolute paths, and traversal are rejected. Typography, icon geometry, and the semantic token vocabulary stay host-owned; a theme cannot load a font or add a CSS rule.
- **Critical chrome stays.** A theme cannot hide the title bar, application menu, toolbar, or inspector, move a panel, or change the meaning of an action.
- **Destinations do not move.** The inspector empty-state grid reuses the registered sidebar items and their labels; a theme cannot invent a button or relocate the rail, toolbar, or transport.
- **No free measurements.** Panel sizes, gaps, and title-row heights are host-owned; a theme cannot supply a selector, unit, or arbitrary length.
- **Accessibility wins.** The action-ink resolver enforces the 4.5:1 floor, and reduced-motion preferences override every theme animation.

## Light palette

Large surfaces stay in the mid-grey range rather than pure white. The raised surface is one step lighter than the page, the canvas and timeline keep a slightly cooler step, and active controls use the accent blue rather than a separate warm hue. Text and icon pairs are checked against WCAG contrast before the palette ships.

## Icons

Bundled theme icons are flat `icons/<snake_case>.png` files rendered at 192×192; nested folders, kebab-case names, SVG files, and unreferenced files are rejected by `npm run icons:check`. The checker decodes every PNG and verifies its signature, dimensions, alpha channel, and referenced-file coverage. The renderer uses each PNG alpha as a mask and paints it with the active theme ink. A distributable theme JSON carries the same glyphs as inline PNG data URLs. Remote URLs, SVG data, absolute paths, and path traversal are rejected. A data URL must be base64 with the PNG signature, so its payload cannot carry quotes or CSS text into the icon URL.

Absent glyph names keep the reference artwork for the theme's appearance, so a light package inherits the lighter optical weight. Add a glyph to the dark package and to `src/design/components/icon/iconAssets.ts`; `npm run build:icons` regenerates both bundles, and `npm run icons:export` writes a self-contained theme JSON with every glyph inlined.

## Discovery

The host scans only the managed `themes/` roots for external packages. The folder is polled while the app runs, so dropping a `<id>.json` document in place updates the picker without a restart. Importing a package writes the same `<id>.json` document there. The bundled packages under `src/assets/themes/` are compiled into the frontend and are never scanned, so an imported package cannot delete a shipped theme.

Theme packages must keep transparent PNG glyphs; opaque tiles become solid squares under the alpha mask.
