# Mouse key icons

These nine PNGs draw mouse buttons (`MOUSE0`–`MOUSE4`) and wheel directions (`WHEELUP`, `WHEELDOWN`, `WHEELLEFT`, `WHEELRIGHT`) inside a shortcut chip. `mouseKeyIcons.ts` imports each PNG with Vite's `?inline` suffix, so the bytes live in the application bundle as data URLs. They are deliberately not theme masks: a theme package cannot recolour or replace them.

## Source and licence

The mouse body, button, and wheel-arrow geometry comes from [Kenney Input Prompts 1.1](https://kenney.nl/assets/input-prompts), `Keyboard & Mouse / Vector` (`mouse_left`, `mouse_right`, `mouse_scroll`, `mouse_scroll_up`, `mouse_scroll_down`, `mouse_vertical`). The pack is [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/); the bundled `LICENSE.txt` is its original licence file.

Local changes: the white body is fixed to a light ink with a thin dark outline, the highlight colour is fixed, and the middle button, side buttons, and wheel left/right arrows are composed on the same geometry. The SVGs beside the PNGs are those adapted sources; the PNGs are 48×48 renders of them.
