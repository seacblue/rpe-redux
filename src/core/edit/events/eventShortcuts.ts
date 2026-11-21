/**
 * Event-layer and placement shortcut definitions.
 *
 * Keeping the declarations beside the event commands gives the shortcut
 * catalog one import for the editor's default bindings while leaving the
 * command module focused on chart mutation.
 */
import type { EditorShortcutDefinition } from "../shortcuts/declarations.ts";

/** Ctrl+Q/W/E/R/T switch the active event layer without touching note keys. */
export const eventLayerShortcuts: readonly EditorShortcutDefinition[] = [
  {
    id: "event.layer.0",
    category: "editor.editing",
    title: "shortcuts.editor.eventLayer0",
    scope: "editor",
    defaults: [{ key: "Q", modifiers: ["CTRL"] }],
  },
  {
    id: "event.layer.1",
    category: "editor.editing",
    title: "shortcuts.editor.eventLayer1",
    scope: "editor",
    defaults: [{ key: "W", modifiers: ["CTRL"] }],
  },
  {
    id: "event.layer.2",
    category: "editor.editing",
    title: "shortcuts.editor.eventLayer2",
    scope: "editor",
    defaults: [{ key: "E", modifiers: ["CTRL"] }],
  },
  {
    id: "event.layer.3",
    category: "editor.editing",
    title: "shortcuts.editor.eventLayer3",
    scope: "editor",
    defaults: [{ key: "R", modifiers: ["CTRL"] }],
  },
  {
    id: "event.layer.4",
    category: "editor.editing",
    title: "shortcuts.editor.eventLayerExtended",
    scope: "editor",
    defaults: [{ key: "T", modifiers: ["CTRL"] }],
    // The editor layer shortcut only takes precedence while the event area owns
    // the pointer.
    enabledFor: (context) => context.area === "events",
  },
];

/**
 * Placing a note or an event.
 *
 * R is two commands, not one: it places a Hold over the notes timeline and an
 * event over the event area, which is what `enabledFor` decides here. Q places a
 * Tap over the notes timeline and an anchor event over the event area, so it is
 * available in both areas. The other note types stay note-only and never place
 * through the event timeline.
 */
export const eventShortcuts: readonly EditorShortcutDefinition[] = [
  {
    id: "note.place.tap",
    category: "editor.notes",
    title: "shortcuts.editor.addTap",
    scope: "editor",
    defaults: [{ key: "Q" }],
  },
  {
    id: "note.place.drag",
    shared: true,
    category: "editor.notes",
    title: "shortcuts.editor.addDrag",
    scope: "editor",
    defaults: [{ key: "W" }],
    enabledFor: (context) => context.area !== "events",
  },
  {
    id: "note.place.flick",
    shared: true,
    category: "editor.notes",
    title: "shortcuts.editor.addFlick",
    scope: "editor",
    defaults: [{ key: "E" }],
    enabledFor: (context) => context.area !== "events",
  },
  {
    id: "note.place.hold",
    shared: true,
    category: "editor.notes",
    title: "shortcuts.editor.addHold",
    scope: "editor",
    defaults: [{ key: "R" }],
    enabledFor: (context) => context.area !== "events",
  },
  {
    id: "event.place",
    shared: true,
    category: "editor.notes",
    title: "shortcuts.editor.addEvent",
    scope: "editor",
    defaults: [{ key: "R" }],
    enabledFor: (context) => context.area === "events",
  },
];
