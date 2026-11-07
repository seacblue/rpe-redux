# Keyboard

RPE Redux keeps the editing loop under the left hand. Q/W/E/R place notes and events, movement commands use the left half or the thumb, and the arrow keys remain familiar alternatives. Every binding is editable in **Settings → Shortcuts**. The declarations live beside their actions in `src/core/edit/shortcuts/` and the implementing modules; the shell dispatcher is `src/frontend/platform/shortcuts/editorKeyboard.ts`.

## Placement and editing

| Action                                  | Default                        |
| --------------------------------------- | ------------------------------ |
| Place Tap / anchor event                | `Q`                            |
| Place Drag                              | `W`                            |
| Place Flick                             | `E`                            |
| Place Hold / place event                | `R`                            |
| Delete selected objects / curve segment | `D`                            |
| Undo                                    | `Ctrl+Z`                       |
| Redo                                    | `Ctrl+Shift+Z`                 |
| Copy / cut / paste                      | `Ctrl+C` / `Ctrl+X` / `Ctrl+V` |
| Copy all event layers in the span       | `Ctrl+Shift+C`                 |
| Paste keeping time                      | `Ctrl+Shift+V`                 |
| Select all                              | `Ctrl+A`                       |
| Save chart                              | `Ctrl+S`                       |

`R` places a Hold over the note area and an event over the event area. `D` deletes the selected curve segment while the curve stage is open and selected objects otherwise.

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

`V` opens the workspace sampler for the selected event; the sampler then reads the pointer in the preview. `Alt+V` starts from the exact field that has focus, so editing an end anchor does not require leaving the keyboard. `F` applies a locked sample, and `Enter` does the same while the preview has focus. Sampling works on one selected event at a time.

## Movement and multi-line

| Action                           | Default                                                 |
| -------------------------------- | ------------------------------------------------------- |
| Previous / next line             | `Z` / `X` (or `←` / `→`)                                |
| Jump to a judge line             | Hold `Ctrl`, type a 0-based line number, release `Ctrl` |
| Nudge selection left / right     | `Z` / `X` (or `←` / `→`)                                |
| Nudge selection earlier / later  | `B` / `T` (or `↓` / `↑`)                                |
| Open multi-line editing          | `F`                                                     |
| Switch multi-line notes / events | `G`                                                     |

`Z`/`X` step between lines when nothing is selected and nudge the selection when something is selected. Multi-line shortcuts apply while the editor workspace has an open document.

Hold `Ctrl`, type a judge-line number, and release `Ctrl` to jump to that line and switch the timeline to a single-line selection. Line numbers are 0-based. An existing `Ctrl+number` command takes precedence over the gesture; an unavailable line number leaves the current line unchanged and shows a warning.

The stage drag handles remain; the same transforms are also available from the keyboard:

| Action | Default |
| --- | --- |
| Scale selected notes narrower / wider | `Alt+Z` / `Alt+X` (or `Alt+←` / `Alt+→`) |
| Move selection to previous / next line | `Alt+Shift+Z` / `Alt+Shift+X` (or `Alt+↑` / `Alt+↓`) |
| Event start earlier / later | `Alt+B` / `Alt+T` (or `[` / `]`) |
| Event end earlier / later | `Alt+Shift+B` / `Alt+Shift+T` (or `Shift+[` / `Shift+]`) |

The left-hand chords are the defaults; the arrow and bracket chords remain familiar alternatives for a keyboard-only pass.

## View and transport

| Action                         | Default                             |
| ------------------------------ | ----------------------------------- |
| Preview only / previous layout | `Ctrl+Space`                        |
| Note region                    | `Ctrl+Shift+Q`                      |
| Event region                   | `Ctrl+Shift+W`                      |
| Preview region                 | `Ctrl+Shift+E`                      |
| Notes and events together      | `Ctrl+Shift+R`                      |
| Reset the view                 | `Ctrl+Shift+F`                      |
| In-game UI                     | `Ctrl+Shift+G`                      |
| Play / pause                   | `Space`                             |
| Timeline backward / forward    | `Wheel Down` / `Wheel Up`           |
| Previous / next judge line     | `Ctrl+Wheel Up` / `Ctrl+Wheel Down` |
| Settings                       | `Ctrl+K`                            |

`Ctrl+Space` stores the complete region snapshot, shows only the preview, and restores the exact previous snapshot on the next press. Note, event, and preview changes made within 500ms are committed as one snapshot, so intermediate combinations are not used as the return target. The preview and empty layouts are valid snapshots. Choosing the note or event region directly leaves the preview layout and keeps the selected layout.

Play/pause and undo/redo use workspace scope because they belong to the open document rather than the timeline. `Space`, `Ctrl+Z`, and `Ctrl+Shift+Z` therefore work on the global and design pages while a chart is open. Text fields keep their native editing keys.

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

When the desktop host enables developer mode, or after the About logo is activated ten times, developer actions stay out of the application menu and use their shortcuts and the small overlay:

| Action                      | Default        |
| --------------------------- | -------------- |
| Toggle DevTools             | `F12`          |
| Inspect element             | `Ctrl+Shift+E` |
| Preview probe               | `Ctrl+Shift+P` |
| Copy selection              | `Ctrl+Shift+A` |
| Copy developer report       | `Ctrl+Shift+X` |
| Performance monitor         | `F3`           |
| Detach performance monitor  | —              |
| Show / copy diagnostics     | —              |
| Open app data folder / logs | —              |
| Reload interface            | —              |

The performance monitor's `F3` binding is available in ordinary builds; the other developer actions and the overlay follow the host's developer policy or the About gesture. DevTools, element inspection, and the preview probe remain subject to that policy. In probe mode, `Alt+wheel` cycles the hit hierarchy and a click copies the active hit.

## Scope rules

Bindings are registered in one of these scopes: `emergency`, `modal`, `surface`, `editor`, `workspace`, `app`, or `instrument`. Capture and urgent dialogs own the keyboard; editor shortcuts take first refusal while the edit workspace is active, and the most specific available scope wins when two commands share a binding. Text entry and open menus keep their native keys.
