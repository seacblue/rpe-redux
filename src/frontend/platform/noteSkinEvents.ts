/**
 * The interface event that announces a changed note skin.
 *
 * Kept separate from the loader so the startup/backend layer can announce the
 * event without importing the media, skin-package, or DOM bridge modules.
 */
export const NOTE_SKIN_EVENT = "redux:note-skin-changed";
