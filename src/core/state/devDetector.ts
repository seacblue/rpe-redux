/**
 * The persisted switch behind the developer findings detector.
 *
 * Capture also requires an open developer surface (host developer mode or the
 * About-page reveal); the frontend runtime combines both gates.
 */
import { PREFERENCE_SECTIONS } from "./preferences.ts";
import { defineValue } from "./values.ts";

/** Persisted value key for the detector switch. */
export const DEV_DETECTOR_ENABLED_ID = "settings.developer-detector";

/** Whether the developer findings detector collects data. */
export const devDetectorEnabled = defineValue<boolean>({
  id: DEV_DETECTOR_ENABLED_ID,
  initial: false,
  persist: PREFERENCE_SECTIONS.settings,
});
