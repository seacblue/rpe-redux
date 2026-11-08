# Design system

`src/design/` contains shared visual and interaction primitives: tokens, buttons, inputs, selects, sliders, modal surfaces, labelled field rows, menus, rail navigation, anchored popovers, toasts, keyboard hints, tooltips, and the PNG icon catalog. Styles enter through `src/design/styles/index.less` and the feature style manifests. The design system owns visual rules; product layout and product text stay in `src/frontend/`.

## Tokens and styles

- `src/design/styles/tokens.less` owns colours, font families, spacing, surface radii, line heights, and type roles.
- `src/design/styles/tokens.less` also owns the ordered `--z-*` paint ladder. A floating surface names its rung; only children inside one component's own stacking context may use a local integer in -1…9. The style gate rejects any other raw z-index value, undefined `--z-*` names, and inline `zIndex` styles.
- `scripts/checkStyleRules.mjs` rejects raw colours, raw font families, raw surface radii, common raw spacing steps, and raw CSS font sizes. The colour picker's hue model and the colour field's computed contrast ink are the documented raw-colour exceptions.
- Use a token for every surface, border, focus ring, warning state, and text role. A component may keep a local layout value when no token owns it.
- Maintain dark and light appearances only.
- A theme package may choose layout, surface, and motion presets from the closed `chrome` vocabulary; it cannot supply CSS or free-form values. The preset styles are authored in `src/frontend/app/themeChrome.less`; placement slots that move the rail, toolbar, or transport are owned by `Workbench`, `Sidebar`, and `TransportHost`. Declarative theme UI uses the host primitives rendered by `frontend/platform/themeUi.tsx`; a package tree cannot supply classes, styles, tags, or handlers. `prefers-reduced-motion` always overrides the motion presets.
- Resolve cascade conflicts with the owning selector, source order, or a more specific component selector. The style gate rejects `!important`.

## Typography

Pick the role by what the text does, not by how large it looks.

| Role             | Size | Used for                                               |
| ---------------- | ---- | ------------------------------------------------------ |
| `--type-micro`   | 11   | Keycaps, counts, axis ticks, chrome eyebrows.          |
| `--type-caption` | 13   | Hints, metadata, descriptions, code, status lines.     |
| `--type-label`   | 13   | Control and field labels, menu rows, dense list names. |
| `--type-body`    | 14   | Default copy, inputs, primary list rows.               |
| `--type-heading` | 16   | Section heading inside a surface.                      |
| `--type-title`   | 20   | Panel, dialog, and welcome-section title.              |
| `--type-hero`    | 28   | Settings page title.                                   |
| `--type-display` | 34   | Startup splash.                                        |

`--type-caption` and `--type-label` share one size; colour and weight separate them. `--line-body` (1.5) and `--line-label` (1.25) are the shared line heights; a fixed-height control may keep its own. Text glyphs standing in for icons use `--glyph-size-sm` (20) or `--glyph-size-lg` (40), not a type role.

Canvas surfaces resolve the same roles through `canvasFont(role)` and `canvasTypePx(role)` in `src/frontend/screens/editor/canvas/text.ts`. Chart text that scales with the preview, and text that shrinks to fit a narrow column, stays a drawing parameter instead of a role.

## Fields and navigation

- `FieldRow` is the one label/description/control/reset row. Settings, script parameters, inspector forms, and prompt fields use its `inline` or `split` layout instead of rebuilding the grid. A function `control` receives the control id and the generated description id.
- `FieldRow` exposes its row geometry through `--field-row-*` variables. The inspector sets one default for every pane in `inspectorDesign.less`; a pane may choose a layout but must not redeclare the padding, gap, min-height, or margin. `check:style` rejects a feature-sheet declaration.
- `SchemaControl` dispatches the shared value kinds: text, number, range, toggle, select, colour, and beat. `CheckboxChip` is the compact labelled checkbox for one on/off companion permission. `Textarea` owns the multiline field surface; do not open-code `redux-input redux-field-textarea`.
- `Input` and `FieldRow` map `tipDescription` to `data-tip-desc` for content-only guidance; `title` maps to the short `data-tip-title` label.
- `SearchField` owns the search shell, the leading glyph, the clear action, and the native search-cancel suppression.
- `Disclosure` owns the native `<details>/<summary>` pattern; features supply the summary content and an `onOpenChange` callback.
- `MenuSurface` / `MenuItem` own menu row anatomy; `RailNavItem` owns the right-hand navigation row. Feature menus and rails supply actions only.
- `useAnchoredPopover` owns placement, outside dismissal, Escape, focus return, and resize/scroll tracking for pickers and floating panels. Its `align: "start" | "center" | "end"` field defines the horizontal baseline: `end` puts the measured panel's right edge on the anchor's right edge. Menus that share the context-menu popup accept the same field on their anchor snapshot instead of a caller-computed left offset.
- A floating surface acquires `useHoldFloatingSurface` while it is open. `floatingSurface.ts` publishes that activity for chrome that opts into it; the document drawer deliberately follows only pointer dwells, so leaving it collapses the list even when one of its pickers is still open.
- `TreeFolder` owns the folder header, reorder grip slot, disclosure, icon, name slot, count, hover actions, drop-target states, and grid-row fold animation. The asset tree and judge-line tree pass data and row content only.
- `ListRow` owns hover, selected, current, dragging, and focus feedback for list, tree, and picker rows; `useListbox` adds roving focus, arrow/Home/End movement, and `aria-activedescendant` to a single-select listbox.
- `InlineAlert` is the one inline error/warning/note surface; `Section` and `SectionHeading` own the titled-section rhythm and divider; `Card` owns the shared card border, radius, fill, and padding.
- `EmptyState` has a `full` and an `inline` variant. A blank workspace uses the full surface; an empty folder, search result, or picker uses the inline one. Full states may also provide an action row for the next recovery step. Center full states in the available content area and use a restrained icon. Let the title name the state and the description explain the next step or what will appear, without repeating the title. Inline states stay compact. An optional illustration replaces the full variant's icon.

## Toasts

There is one notice host, mounted as a document-level peer of the app shell so modal scrims cannot blur or disable it. `showToast` handles ordinary notices; `showStickyToast` returns a handle for long tasks, Mod notices, and progress rows. A notice may carry `source`, `step`, and `actions`, and its producer can release state through `onDismiss`.

`showToast` accepts an object when a notice needs a compact still or muted clip:

```ts
showToast({ message, media: { kind: "image", src, alt } });
showToast({ message, media: { kind: "video", src, label } });
```

The media column is fixed at 56×36 CSS pixels; clips loop, stay muted, and use no native controls. A failed source leaves an empty placeholder so rows keep their height.

## Images

`AsyncImage` owns the shared decode handshake: the skeleton while a source loads, the fallback when it is missing or fails, and the loaded class. Callers keep the sized surface around it.

`redux-image-skeleton` shimmers while a decode is pending. An empty image slot that is not loading uses `redux-image-skeleton is-plain`, which keeps the same footprint without the loading animation.

## Media

`VideoPlayer` and `AudioPlayer` share one transport: the play button, seek rail, time readout, drag state, and keyboard stepping live in `components/media/mediaTransport.less` and the `mediaTime` helpers. `VideoPlayer` is deliberately silent; `AudioPlayer` is audible and previews an asset. Neither renders native media controls.

## Progress

`Progress` is the one bar for chart loading, long tasks, and update downloads. `value` and `max` draw a determinate fill; omitting `value` draws the indeterminate animation. Callers supply the accessible label and may supply a visible `valueText`.

## Tooltips

`TooltipHost` installs one document-level capture layer and reads `data-tip-title` / `data-tip-desc` / `data-tip-video` / `data-tip-key` from the hovered control. It allows tips inside the topmost open dialog and refuses anchors outside it. Canvas surfaces publish a label under the pointer through `setTransientTooltip` instead of setting a native `title` attribute.

A tooltip title is a short label with no trailing punctuation. Content is optional: omit it when the title already says everything, never repeat the title, and keep one short line (at most 35 Chinese characters or roughly 20 English words). A visible label that is already clear gets no tooltip; an ambiguous text label may use `data-tip-desc` alone. Every icon-only control carries a title, except sidebar rail items, which reveal their labels instead. Keep requirements, consequences, and input formats visible as field descriptions or validation messages, and associate them with their controls. Tooltip-only details must also be reachable from keyboard focus; tooltips do not replace visible instructions or accessible names.

Tips inside a dialog stay in the browser top layer above the modal stack. The modal stack broadcasts `MODAL_STACK_EVENT`, so a layer change dismisses the tip that belonged to the previous surface; anchors inside an inert subtree cannot publish a tip at all.

## Accessibility

- A meaningful canvas carries `aria-label` (with `role="region"` when it is an editing surface or `role="img"` when it is a preview); a rendering-only canvas carries `aria-hidden="true"`.
- An action with a registered binding exposes `aria-keyshortcuts` in the ARIA grammar (`Control+Shift+S`, `Space`), not the visible chip spelling.
- The home page, workspace, and global workspace are `main` landmarks; the inspector is a named complementary landmark.
- Pointer-only drag handles may stay out of sequential tab order, but still need an accessible name and a keyboard path elsewhere on the same surface.

## Buttons and action rows

`Button` variants are semantic, not decorative:

- `solid` is the single primary action on a surface and comes last in its row.
- `outlined` is a standalone secondary, cancel, back, or recovery action with a visible resting border.
- `danger` marks a destructive answer before the pointer arrives.
- `ghost` is for dense toolbar and row actions; it is borderless at rest by design. A standalone action in page content must not use the bare default.
- `plain` is a transparent reset for menu, list, card, and window-chrome rows that paint their own hover surface. It is not a footer link or a page action.
- `link` is the true text action: accent ink, no surface, and an underline on hover/focus. Use it for release links and inline help.
- `size="sm" | "md"`, `density="compact"`, `block`, and `iconText` own the common height, padding, width, and icon-gap overrides. A page should not restyle a button to fit a card or toolbar cell when one of these presets already says it.
- `IconButton` owns icon-only controls; `compact` is the in-field 18px box, and the string sizes are `small` 24, `md` 32, and `caption` 46 (window chrome).
- Product code renders actions through `Button` or `IconButton`. `check:style` rejects a raw `<button>` under `src/frontend/`; a new control belongs in the design system first.
- A page or section primary action belongs in the section footer or a list toolbar, never in the heading row. Destructive actions use `danger` and ask for confirmation unless the same surface offers a reliable undo.

## Prompts

- `requestSelect` asks a "which one" question: the `ChoiceList` is the content control, choosing an item is the answer, and the footer only offers Cancel.
- `requestChoice` asks a short decision: the answer buttons live in the footer, and the content explains the consequence.
- Do not mix the two placements inside one prompt; the answer location is part of the prompt contract.

Action rows live at the bottom of their surface. Modal footers use `.modal-actions` (through `Modal.actions`); panel footers use `.redux-footer-bar` with a `.redux-footer-actions` group. Both align to the end. The order is cancel/back (`outlined`), then destructive (`danger`), then the primary (`solid`) last. Do not place a page or dialog primary in its heading.

Narrow list columns use the compact variant: `.redux-footer-bar` plus `.redux-footer-bar-compact`. The primary action (`solid`, `block`) fills the first row, and the secondary and destructive actions share the second row as equal grid columns; a single remaining action fills that row. The variant also owns the tighter footer label size and inline inset; the base strip keeps its top border and padding. Button labels stay on one line and ellipsize; keep the tooltip that carries the full label.

## Modal capture

`Modal` owns ordinary dialog chrome and focus containment. Dialogs portal into the app-root host registered by the entry point, so a dialog opened from another dialog is a peer of that window rather than a child of its stacking context. `KeyboardCaptureModal` is the recording variant: it keeps the dialog, scrim, and stacking from `Modal`, but focuses a capture body and keeps Escape available as a bindable key.

`Modal.requestClose` hands the close paths to the surface: the header button, Escape, and a native window close ask the callback instead of closing, and scrim dismissal is disabled. The surface shows its own prompt, saves or discards, and hides itself; the dialog then runs its normal exit animation.

## Icons

- `src/design/components/icon/iconAssets.ts` is the published name catalog. An icon resolves from that catalog; a contributed action with an unknown name draws the fallback `help` glyph. A theme supplies PNG alpha masks only, so there is no SVG fallback.
- Choose one icon family and one weight per surface; the catalog uses Lucide-compatible 24×24 outline geometry (ISC License), with local geometry glyphs vendored under `scripts/icon-sources/`. Window caption glyphs use Microsoft Fluent UI System Icons (MIT License).
- Theme packages carry monochrome alpha masks. The icon primitive paints each mask with the active surface token, so light and dark differ by optical stroke (2.0 vs 1.75) and surface colour rather than by a second colour drawing.
- Use 20 for transport and icon buttons, 18 for category and toolbar glyphs, 16 for compact controls, and 14 for disclosure chevrons and keycap affordances. Window caption glyphs use 14 because their source viewBox reserves padding. Callers use these sizes; the icon primitive defaults to 18.
- One glyph names one meaning. Playback controls use `playbackPlay`; audio settings use `volume`; a plus does not stand in for a file, a line, and an extension.
- Add a glyph to the dark package and to `iconAssets.ts`, then regenerate both packages with `npm run icons:build` and update `scripts/iconSources.mjs` alongside the catalog. `npm run icons:check` verifies the pair.
- `npm run icons:export` writes a self-contained theme JSON with every glyph inlined as a PNG data URL.

See [Architecture](../../docs/architecture.md) for module ownership before adding a shared component or another visual seam.
