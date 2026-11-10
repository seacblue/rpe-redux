# Keyboard

RPE Redux keeps the placement loop under the left hand. Q/W/E/R place notes and events, movement commands use the left half or the thumb, and the arrow keys remain familiar alternatives. Every binding is editable in **Settings → Shortcuts**. The declarations live beside their actions in `src/core/edit/shortcuts/` and the implementing modules; the shell dispatcher is `src/frontend/platform/shortcuts/editorKeyboard.ts`.

## Placement and editing

| Action                                  | Default                        |
| --------------------------------------- | ------------------------------ |
| Place Tap / anchor event                | `Q`                            |
| Place Drag                              | `W`                            |
| Place Flick                             | `E`                            |
| Place Hold / place event                | `R`                            |
| Cancel placement / clear selection      | `Esc`                          |
| Delete selected objects / curve segment | `D`                            |
| Undo                                    | `Ctrl+Z`                       |
| Redo                                    | `Ctrl+Shift+Z` / `Ctrl+Y`      |
| Copy / cut / paste                      | `Ctrl+C` / `Ctrl+X` / `Ctrl+V` |
| Copy all event layers in the span       | `Ctrl+Shift+C`                 |
| Paste keeping time                      | `Ctrl+Shift+V`                 |
| Jump to clipboard start / end           | Unbound (set in Settings)      |
| Clear clipboard                         | `Ctrl+Shift+Delete`            |
| Select all                              | `Ctrl+A`                       |
| Save chart                              | `Ctrl+S`                       |

`R` places a Hold over the note area and an event over the event area. A second click finishes the placement; an endpoint before the start swaps the two anchors. `Esc` cancels a started but unfinished placement, and clears the selection when nothing is pending. `D` deletes the selected curve segment while the curve stage is open and selected objects otherwise. Clipboard start and end jumps have no default key; assign them in **Settings → Shortcuts** when needed. Clearing the clipboard keeps the remembered clipboard-history entries.

## Event layers and relative paste

| Action                        | Default                                   |
| ----------------------------- | ----------------------------------------- |
| Event layers 0 / 1 / 2 / 3    | `Ctrl+Q` / `Ctrl+W` / `Ctrl+E` / `Ctrl+R` |
| Extended event layer          | `Ctrl+T` (event area)                     |
| Copy all event layers in span | `Ctrl+Shift+C`                            |

`Ctrl+Shift+C` copies every base layer of the selected event types whose start falls inside the selection's time span. Paste is relative: the earliest copied object becomes the time anchor, line offsets are kept from the lowest selected line, and layer offsets are kept from the lowest copied layer. Pasting on layer 1 a block copied from layers 0-2 therefore lands on layers 1-3. A layer that would pass layer 3 is dropped silently rather than being written into the extended layer. `Ctrl+T` selects the extended layer only while the event area owns the pointer; elsewhere it still opens the note-skin settings page.

## Sampling

| Action                              | Default         |
| ----------------------------------- | --------------- |
| Sample selected event start / end   | `V` / `Shift+V` |
| Sample the event field being edited | `Alt+V`         |
| Apply the sample / cancel sampling  | `F` / `Esc`     |

`V` opens the workspace sampler for the selected event; the sampler then reads the pointer in the preview. `Alt+V` starts from the exact field that has focus, so editing an end anchor does not require leaving the keyboard. `F` applies a locked sample, and `Enter` does the same while the preview has focus. Sampling works on one selected event at a time. The guide-hide and apply keys are ordinary rebindable shortcuts under **Sampling**; `Esc` stays the fixed cancel key.

## Movement and multi-line

| Action                           | Default                                                 |
| -------------------------------- | ------------------------------------------------------- |
| Previous / next line             | `Z` / `X` (or `←` / `→`)                                |
| Jump to a judge line             | Hold `Ctrl`, type a 0-based line number, release `Ctrl` |
| Nudge selection left / right     | `Z` / `X` (or `←` / `→`)                                |
| Nudge selection earlier / later  | `B` / `G` (or `↓` / `↑`)                                |
| Open multi-line editing          | `J`                                                     |
| Switch multi-line notes / events | `K`                                                     |

`Z`/`X` step between lines when nothing is selected and nudge the selection when something is selected. Multi-line shortcuts apply while the editor workspace has an open document.

Hold `Ctrl`, type a judge-line number, and release `Ctrl` to jump to that line and switch the timeline to a single-line selection. Line numbers are 0-based. An existing `Ctrl+number` command takes precedence over the gesture; an unavailable line number leaves the current line unchanged and shows a warning.

The stage drag handles remain; the same transforms are also available from the keyboard:

| Action | Default |
| --- | --- |
| Scale selected notes narrower / wider | `Alt+Z` / `Alt+X` (or `Alt+←` / `Alt+→`) |
| Move selection to previous / next line | `Alt+Shift+Z` / `Alt+Shift+X` (or `Alt+↑` / `Alt+↓`) |
| Event start earlier / later | `Alt+B` / `Alt+T` (or `[` / `]`) |
| Event end earlier / later | `Alt+Shift+B` / `Alt+Shift+T` (or `Shift+[` / `Shift+]`) |

The left-hand chords are the defaults; the arrow and bracket chords remain familiar alternatives for a keyboard-only pass. Dragging a control ball uses the same transforms; while a note-scale drag is active, hold `1` or `2` to anchor the left or right edge, and press `Esc` to cancel the drag. Those keys belong to the live gesture rather than the shortcut table.

## View and transport

| Action                         | Default                               |
| ------------------------------ | ------------------------------------- |
| Preview only / previous layout | `Ctrl+Space`                          |
| Note region                    | `Ctrl+Shift+Q`                        |
| Event region                   | `Ctrl+Shift+W`                        |
| Preview region                 | `Ctrl+Shift+E`                        |
| Notes and events together      | `Ctrl+Shift+R`                        |
| Reset the view                 | `Ctrl+Shift+F`                        |
| In-game UI                     | `Ctrl+Shift+G`                        |
| Play / pause                   | `Space`                               |
| Hold preview playback, return  | `T`                                   |
| Hold preview playback, stay    | `U`                                   |
| Timeline backward / forward    | `Wheel Down` / `Wheel Up`             |
| Fast seek backward / forward   | `Shift+Wheel Down` / `Shift+Wheel Up` |
| Next / previous judge line     | `Ctrl+Wheel Up` / `Ctrl+Wheel Down`   |
| Zoom timeline out / in         | `Alt+Wheel Down` / `Alt+Wheel Up`     |
| Settings                       | `Ctrl+K`                              |

`Ctrl+Space` uses a runtime-only preview overlay: from a normal layout it shows only the preview without rewriting the note, event, or preview switches, and the next press restores those switches. If the raw layout is already preview-only or empty, it restores the latest complete recorded snapshot instead. Note, event, and preview changes made within 500ms are committed as one snapshot, so intermediate combinations are not used as the return target. The preview and empty layouts are valid snapshots. Choosing the note or event region directly leaves the preview overlay and keeps the selected layout.

`T` and `U` are held audition gestures. While held they switch to the preview-only layout and play; releasing restores the layout. `T` also returns to the time where the hold began, while `U` stops at the release position. The toolbar's preview-audition button uses the `T` behavior.

Play/pause and undo/redo use workspace scope because they belong to the open document rather than the timeline. `Space`, `Ctrl+Z`, and `Ctrl+Shift+Z` / `Ctrl+Y` therefore work on the global and design pages while a chart is open. Text fields keep their native editing keys.

## File and application keys

| Action             | Default        |
| ------------------ | -------------- |
| New chart          | `Ctrl+N`       |
| Open chart         | `Ctrl+O`       |
| Save chart         | `Ctrl+S`       |
| Settings           | `Ctrl+K`       |
| Show chart library | `Ctrl+Shift+H` |

New chart, open, and settings work on the chart library page before a chart is open. Save requires an open document. The show-library action requires an open document and is enabled away from the library page.

## Developer mode

When the desktop host enables developer mode, or after the About logo is activated ten times, the developer settings page and its actions become available. Developer commands stay out of the application menu:

| Action              | Default |
| ------------------- | ------- |
| Toggle DevTools     | `F12`   |
| Performance monitor | `F3`    |

The performance monitor's `F3` binding is available in ordinary builds. DevTools and the developer settings page follow the host's developer policy or the About gesture.

## Scope rules

Bindings are registered in one of these scopes: `emergency`, `modal`, `surface`, `editor`, `workspace`, `app`, or `instrument`. Capture and urgent dialogs own the keyboard; editor shortcuts take first refusal while the edit workspace is active, and the most specific available scope wins when two commands share a binding. Text entry and open menus keep their native keys.

`Esc` is a fixed system cancel key rather than a registered shortcut: the surface that owns the current gesture consumes it, and it never appears in the shortcut editor.
