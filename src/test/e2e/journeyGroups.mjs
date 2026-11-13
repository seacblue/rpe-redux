/**
 * The P0 smoke suite: API/Extension contract, documents, settings pages,
 * session restore, and the experience journeys that drive the packaged window
 * through real keyboard and pointer input.
 *
 * Feature-specific journeys are not part of the default run. Their logic is
 * covered by unit suites, and the smoke run only proves the shared end-to-end
 * paths still connect the packaged app to the public API and the surfaces a user
 * touches.
 */
import {
  coldOpen,
  createChart,
  openExternalPackage,
  openResourceChart,
  roundtrip,
} from "./journeys.mjs";
import { apiContract, replacePolicy } from "./contractJourneys.mjs";
import { settingsSmoke } from "./settingsSmokeJourney.mjs";
import { sessionRestore } from "./sessionRestoreJourney.mjs";
import {
  experienceEventField,
  experienceFirstChart,
  experienceSettingsWindow,
} from "./experienceJourneys.mjs";

function sequence(steps) {
  return async (runner) => {
    for (const [name, step] of steps) {
      try {
        await step(runner);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`${name}: ${message}`, { cause: error });
      }
      await runner.evaluate(
        "document.querySelectorAll('dialog[open]').forEach((dialog) => dialog.close()); true",
      );
    }
  };
}

export const journeys = {
  "api-contract": apiContract,
  documents: sequence([
    ["cold-open", coldOpen],
    ["open-resource", openResourceChart],
    ["open-external-package", openExternalPackage],
    ["create", createChart],
    ["roundtrip", roundtrip],
    ["replace-policy", replacePolicy],
  ]),
  settings: settingsSmoke,
  "session-restore": sessionRestore,
  "experience-create": experienceFirstChart,
  "experience-events": experienceEventField,
  "experience-settings": experienceSettingsWindow,
};
