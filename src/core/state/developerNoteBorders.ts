/**
 * The persisted switch behind the developer note-border overlay.
 *
 * It is a developer preference rather than a chart value: it survives a restart
 * and is read by the preview surface without importing the settings page.
 */
import { PREFERENCE_SECTIONS } from "./preferences.ts";
import { defineValue } from "./values.ts";

/** Persisted value key for the note-border switch. */
const NOTE_BORDERS_ID = "settings.developer-note-borders";

/** Whether the preview draws debug borders around notes and holds. */
export const developerNoteBorders = defineValue<boolean>({
  id: NOTE_BORDERS_ID,
  initial: false,
  persist: PREFERENCE_SECTIONS.settings,
});
